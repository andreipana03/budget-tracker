import BudgetTrackerAPI
import Foundation
import OpenAPIRuntime

/// A failed API call with the API's stable `code` and its readable `message`, which is
/// already in the app's voice so screens can show it as is.
///
///     if let e = error as? APIError, e.code == "version_conflict" { … }
struct APIError: Error, LocalizedError, Sendable, Equatable {
    struct Field: Sendable, Equatable {
        var field: String
        var code: String
        var message: String
    }

    var status: Int
    var code: String
    var message: String
    var fields: [Field] = []

    var errorDescription: String? { message }

    /// The message for one request field ("password"), if the API flagged it.
    func fieldMessage(_ field: String) -> String? {
        fields.first { $0.field == field }?.message
    }

    var isNetwork: Bool { status == 0 }

    static let network = APIError(status: 0, code: "network_error",
                                  message: "Couldn’t reach the server. Check your connection and try again.")
    static let sessionEnded = APIError(status: 401, code: "session_expired", message: "Your session has ended. Sign in again.")

    private static let fallback: [Int: String] = [
        401: "Your session has ended. Sign in again.",
        403: "You don’t have access to this.",
        404: "This couldn’t be found.",
        429: "Too many tries. Wait a moment and try again.",
        501: "This isn’t available yet.",
    ]

    static func from(_ status: Int, _ body: Components.Schemas._Error? = nil) -> APIError {
        if let body {
            return APIError(
                status: status,
                code: body.code,
                message: body.message.isEmpty ? (fallback[status] ?? "Something went wrong.") : body.message,
                fields: (body.fields ?? []).map { Field(field: $0.field, code: $0.code, message: $0.message) }
            )
        }
        return APIError(status: status, code: "http_\(status)", message: fallback[status] ?? "Something went wrong. Try again.")
    }

    static func from(_ status: Int, _ response: Components.Responses._Error) -> APIError {
        from(status, try? response.body.json)
    }

    /// Whatever a call threw → an APIError (network problems become `.network`).
    static func wrap(_ error: any Error) -> APIError {
        if let e = error as? APIError { return e }
        if let e = error as? ClientError { return wrap(e.underlyingError) }
        if error is URLError || (error as NSError).domain == NSURLErrorDomain { return .network }
        if error is CancellationError { return APIError(status: -1, code: "cancelled", message: "Cancelled.") }
        return APIError(status: 500, code: "internal", message: "Something went wrong. Try again.")
    }

    var isCancellation: Bool { code == "cancelled" }
}

/// The app's voice for codes people can hit on the sign-in screens (design § 8).
func friendlyMessage(_ error: any Error) -> String {
    let e = APIError.wrap(error)
    switch e.code {
    case "invalid_credentials": return "That email, username or password isn’t right."
    case "rate_limited": return "Too many tries. Wait a minute, then try again."
    case "google_not_configured": return "Google sign-in isn’t available right now. Use your email and password."
    default: return e.message
    }
}
