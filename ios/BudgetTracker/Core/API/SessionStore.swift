import BudgetTrackerAPI
import Foundation

/// The signed-in session, shared by every request.
///
/// - The access token (15-minute JWT) lives only in memory.
/// - The refresh token lives in the Keychain. POST /auth/refresh with `platform: ios`
///   returns a fresh access token and a rotated refresh token in the body.
/// - Refreshes are single-flight: requests that hit an expired token at the same time
///   wait for one refresh, so a rotated token is never presented twice.
actor SessionStore {
    enum RefreshResult: Sendable {
        case signedIn(AuthResponse)
        /// The session is gone (expired, revoked or reused): sign in again.
        case signedOut
        /// Couldn't reach the server, or it failed: the session may still be fine.
        case failed(APIError)
    }

    private static let refreshKey = "refreshToken"

    private var accessToken: String?
    private var accessExpiresAt = Date.distantPast
    private var refreshTask: Task<RefreshResult, Never>?
    private var onSignedOut: (@Sendable () async -> Void)?
    /// A plain client without the auth middleware, for /auth/refresh itself.
    private let client: Client

    init(baseURL: URL) {
        client = Client(baseURL: baseURL)
    }

    func setOnSignedOut(_ handler: @escaping @Sendable () async -> Void) {
        onSignedOut = handler
    }

    var hasRefreshToken: Bool { Keychain.read(Self.refreshKey) != nil }
    var currentAccessToken: String? { accessToken }

    /// Store what /auth/login, /auth/register, /auth/google or /auth/refresh returned.
    func apply(_ response: AuthResponse) {
        accessToken = response.accessToken
        accessExpiresAt = response.accessTokenExpiresAt
        if let refresh = response.refreshToken { Keychain.write(refresh, for: Self.refreshKey) }
    }

    /// The refresh token, for POST /auth/logout.
    var refreshToken: String? { Keychain.read(Self.refreshKey) }

    func clear() {
        accessToken = nil
        accessExpiresAt = .distantPast
        Keychain.delete(Self.refreshKey)
    }

    /// An access token good for at least 30 more seconds, refreshing first when needed.
    func validAccessToken() async -> String? {
        if let accessToken, accessExpiresAt.timeIntervalSinceNow > 30 { return accessToken }
        guard hasRefreshToken else { return accessToken }
        _ = await refresh()
        return accessToken
    }

    /// After a 401: refresh unless another request already did since `usedToken` was sent.
    func refreshAfterUnauthorized(usedToken: String?) async -> String? {
        if let accessToken, accessToken != usedToken, accessExpiresAt.timeIntervalSinceNow > 30 { return accessToken }
        if case .signedIn = await refresh() { return accessToken }
        return nil
    }

    func refresh() async -> RefreshResult {
        if let refreshTask { return await refreshTask.value }
        let task = Task { await runRefresh() }
        refreshTask = task
        let result = await task.value
        refreshTask = nil
        return result
    }

    private func runRefresh() async -> RefreshResult {
        guard let token = Keychain.read(Self.refreshKey) else { return .signedOut }
        do {
            let output = try await client.refreshSession(body: .json(.init(platform: .ios, refreshToken: token)))
            switch output {
            case .ok(let ok):
                let response = try ok.body.json
                apply(response)
                return .signedIn(response)
            case .default(let status, let body):
                return await settle(APIError.from(status, body))
            }
        } catch {
            return .failed(APIError.wrap(error))
        }
    }

    /// 4xx: the session is over. 5xx: keep it and let the caller retry later.
    private func settle(_ error: APIError) async -> RefreshResult {
        guard (400..<500).contains(error.status) else { return .failed(error) }
        clear()
        await onSignedOut?()
        return .signedOut
    }
}

/// Adds the bearer token to every non-public operation, and when the API answers 401
/// (expired access token) refreshes the session once and retries the request.
struct AuthMiddleware: ClientMiddleware {
    let session: SessionStore

    /// Operations with `security: []` in the spec (backend `publicOperations`).
    static let publicOperations: Set<String> = [
        "getHealth", "register", "login", "signInWithGoogle", "refreshSession", "signOut",
        "verifyEmail", "requestPasswordReset", "resetPassword", "checkUsername",
    ]

    func intercept(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL: URL,
        operationID: String,
        next: @Sendable (HTTPRequest, HTTPBody?, URL) async throws -> (HTTPResponse, HTTPBody?)
    ) async throws -> (HTTPResponse, HTTPBody?) {
        if Self.publicOperations.contains(operationID) { return try await next(request, body, baseURL) }

        var authorized = request
        let token = await session.validAccessToken()
        if let token { authorized.headerFields[.authorization] = "Bearer \(token)" }
        let (response, responseBody) = try await next(authorized, body, baseURL)

        // A wrong current password (POST /me/password) is a 401 too, but a fresh token
        // won't change the answer, and retrying would count as a second attempt.
        guard response.status.code == 401, operationID != "changePassword" else { return (response, responseBody) }
        guard let fresh = await session.refreshAfterUnauthorized(usedToken: token) else { return (response, responseBody) }
        var retry = request
        retry.headerFields[.authorization] = "Bearer \(fresh)"
        return try await next(retry, body, baseURL)
    }
}
