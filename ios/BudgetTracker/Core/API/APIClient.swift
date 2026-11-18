import BudgetTrackerAPI
import Foundation

/// Every endpoint the app uses, typed from the generated client. Each method returns the
/// response model or throws an `APIError` (network problems included), so screens never
/// see the generated output enums.
///
///     let home = try await api.home(month: "2026-11")
final class APIClient: Sendable {
    let session: SessionStore
    private let client: Client

    init(baseURL: URL) {
        let session = SessionStore(baseURL: baseURL)
        self.session = session
        self.client = Client(baseURL: baseURL, middlewares: [AuthMiddleware(session: session)])
    }

    /// Runs one call, turning anything thrown into an `APIError`.
    private func run<T: Sendable>(_ call: () async throws -> T) async throws -> T {
        do { return try await call() } catch { throw APIError.wrap(error) }
    }

    // MARK: System

    func health() async throws -> Components.Schemas.HealthResponse {
        try await run {
            switch try await client.getHealth() {
            case .ok(let r): try r.body.json
            case .serviceUnavailable(let r): try r.body.json
            case .undocumented(let s, _): throw APIError.from(s)
            }
        }
    }

    // MARK: Auth

    func login(identifier: String, password: String, deviceName: String) async throws -> AuthResponse {
        try await run {
            switch try await client.login(body: .json(.init(identifier: identifier, password: password, platform: .ios, deviceName: deviceName))) {
            case .ok(let r): try r.body.json
            case .default(let s, let r): throw APIError.from(s, r)
            }
        }
    }

    func register(email: String, username: String, password: String, deviceName: String) async throws -> AuthResponse {
        try await run {
            switch try await client.register(body: .json(.init(email: email, username: username, password: password, platform: .ios, deviceName: deviceName))) {
            case .created(let r): try r.body.json
            case .default(let s, let r): throw APIError.from(s, r)
            }
        }
    }

    func signInWithGoogle(idToken: String, deviceName: String) async throws -> AuthResponse {
        try await run {
            switch try await client.signInWithGoogle(body: .json(.init(idToken: idToken, platform: .ios, deviceName: deviceName))) {
            case .ok(let r): try r.body.json
            case .default(let s, let r): throw APIError.from(s, r)
            }
        }
    }

    func logout(refreshToken: String?) async throws {
        try await run {
            switch try await client.signOut(body: .json(.init(refreshToken: refreshToken))) {
            case .noContent: ()
            case .default(let s, let r): throw APIError.from(s, r)
            }
        }
    }

    func requestPasswordReset(email: String) async throws {
        try await run {
            switch try await client.requestPasswordReset(body: .json(.init(email: email))) {
            case .noContent: ()
            case .default(let s, let r): throw APIError.from(s, r)
            }
        }
    }

    func usernameAvailable(_ username: String) async throws -> Components.Schemas.UsernameAvailability {
        try await run {
            switch try await client.checkUsername(query: .init(username: username)) {
            case .ok(let r): try r.body.json
            case .default(let s, let r): throw APIError.from(s, r)
            }
        }
    }

    // MARK: Me

    func me() async throws -> User {
        try await run {
            switch try await client.getMe() {
            case .ok(let r): try r.body.json
            case .default(let s, let r): throw APIError.from(s, r)
            }
        }
    }

    func updateMe(displayName: String? = nil, username: String? = nil, region: String? = nil) async throws -> User {
        try await run {
            switch try await client.updateMe(body: .json(.init(displayName: displayName, username: username, region: region))) {
            case .ok(let r): try r.body.json
            case .default(let s, let r): throw APIError.from(s, r)
            }
        }
    }

    func deleteMe() async throws {
        try await run {
            switch try await client.deleteMe() {
            case .noContent: ()
            case .default(let s, let r): throw APIError.from(s, r)
            }
        }
    }

    func changePassword(current: String?, new: String) async throws {
        try await run {
            switch try await client.changePassword(body: .json(.init(currentPassword: current, newPassword: new))) {
            case .noContent: ()
            case .default(let s, let r): throw APIError.from(s, r)
            }
        }
    }

    func resendVerification() async throws {
        try await run {
            switch try await client.resendVerification() {
            case .noContent: ()
            case .default(let s, let r): throw APIError.from(s, r)
            }
        }
    }

    // MARK: Household & reference

    func household() async throws -> Household {
        try await run {
            switch try await client.getHousehold() {
            case .ok(let r): try r.body.json
            case .default(let s, let r): throw APIError.from(s, r)
            }
        }
    }

    func updateHousehold(_ body: Components.Schemas.UpdateHouseholdRequest) async throws -> Household {
        try await run {
            switch try await client.updateHousehold(body: .json(body)) {
            case .ok(let r): try r.body.json
            case .default(let s, let r): throw APIError.from(s, r)
            }
        }
    }

    func currencies() async throws -> [Currency] {
        try await run {
            switch try await client.listCurrencies() {
            case .ok(let r): try r.body.json
            case .default(let s, let r): throw APIError.from(s, r)
            }
        }
    }

    func fxQuote(from: String, to: String, on: String?, amountMinor: Int64?) async throws -> FxQuote {
        try await run {
            switch try await client.getFxQuote(query: .init(from: from, to: to, on: on, amountMinor: amountMinor)) {
            case .ok(let r): try r.body.json
            case .default(let s, let r): throw APIError.from(s, r)
            }
        }
    }

    // MARK: Accounts

    func accounts(includeArchived: Bool = false) async throws -> AccountList {
        try await run {
            switch try await client.listAccounts(query: .init(includeArchived: includeArchived)) {
            case .ok(let r): try r.body.json
            case .default(let s, let r): throw APIError.from(s, r)
            }
        }
    }

    func createAccount(_ body: Components.Schemas.CreateAccountRequest) async throws -> Account {
        try await run {
            switch try await client.createAccount(body: .json(body)) {
            case .created(let r): try r.body.json
            case .default(let s, let r): throw APIError.from(s, r)
            }
        }
    }

    func updateAccount(id: String, _ body: Components.Schemas.UpdateAccountRequest) async throws -> Account {
        try await run {
            switch try await client.updateAccount(path: .init(id: id), body: .json(body)) {
            case .ok(let r): try r.body.json
            case .default(let s, let r): throw APIError.from(s, r)
            }
        }
    }

    func deleteAccount(id: String) async throws -> DeleteOutcome {
        try await run {
            switch try await client.deleteAccount(path: .init(id: id)) {
            case .ok(let r): try r.body.json.outcome
            case .default(let s, let r): throw APIError.from(s, r)
            }
        }
    }

    // MARK: Categories

    func categories(includeArchived: Bool = false) async throws -> [Category] {
        try await run {
            switch try await client.listCategories(query: .init(includeArchived: includeArchived)) {
            case .ok(let r): try r.body.json
            case .default(let s, let r): throw APIError.from(s, r)
            }
        }
    }

    func createCategory(_ body: Components.Schemas.CreateCategoryRequest) async throws -> Category {
        try await run {
            switch try await client.createCategory(body: .json(body)) {
            case .created(let r): try r.body.json
            case .default(let s, let r): throw APIError.from(s, r)
            }
        }
    }

    func updateCategory(id: String, _ body: Components.Schemas.UpdateCategoryRequest) async throws -> Category {
        try await run {
            switch try await client.updateCategory(path: .init(id: id), body: .json(body)) {
            case .ok(let r): try r.body.json
            case .default(let s, let r): throw APIError.from(s, r)
            }
        }
    }

    func deleteCategory(id: String) async throws -> DeleteOutcome {
        try await run {
            switch try await client.deleteCategory(path: .init(id: id)) {
            case .ok(let r): try r.body.json.outcome
            case .default(let s, let r): throw APIError.from(s, r)
            }
        }
    }

    // MARK: Transactions

    struct TxnQuery: Hashable, Sendable {
        var kind: EntryKind?
        var status: TxnStatus?
        var categoryId: String?
        var accountId: String?
        var month: String?
        var q: String?
        var limit: Int = 50
    }

    func transactions(_ q: TxnQuery, cursor: String? = nil) async throws -> TxnPage {
        try await run {
            let query = Operations.ListTransactions.Input.Query(
                kind: q.kind, status: q.status, categoryId: q.categoryId, accountId: q.accountId,
                month: q.month, q: q.q, cursor: cursor, limit: q.limit
            )
            return switch try await client.listTransactions(query: query) {
            case .ok(let r): try r.body.json
            case .default(let s, let r): throw APIError.from(s, r)
            }
        }
    }

    func transaction(id: String) async throws -> Txn {
        try await run {
            switch try await client.getTransaction(path: .init(id: id)) {
            case .ok(let r): try r.body.json
            case .default(let s, let r): throw APIError.from(s, r)
            }
        }
    }

    func createTransaction(_ body: Components.Schemas.CreateTransactionRequest) async throws -> Txn {
        try await run {
            switch try await client.createTransaction(body: .json(body)) {
            case .created(let r): try r.body.json
            case .default(let s, let r): throw APIError.from(s, r)
            }
        }
    }

    func updateTransaction(id: String, _ body: Components.Schemas.UpdateTransactionRequest) async throws -> Txn {
        try await run {
            switch try await client.updateTransaction(path: .init(id: id), body: .json(body)) {
            case .ok(let r): try r.body.json
            case .default(let s, let r): throw APIError.from(s, r)
            }
        }
    }

    func deleteTransaction(id: String) async throws {
        try await run {
            switch try await client.deleteTransaction(path: .init(id: id)) {
            case .noContent: ()
            case .default(let s, let r): throw APIError.from(s, r)
            }
        }
    }

    func restoreTransaction(id: String) async throws {
        try await run {
            switch try await client.restoreTransaction(path: .init(id: id)) {
            case .ok: ()
            case .default(let s, let r): throw APIError.from(s, r)
            }
        }
    }

    func confirmTransaction(id: String) async throws {
        try await run {
            switch try await client.confirmTransaction(path: .init(id: id), body: .json(.init())) {
            case .ok: ()
            case .default(let s, let r): throw APIError.from(s, r)
            }
        }
    }

    func skipTransaction(id: String) async throws {
        try await run {
            switch try await client.skipTransaction(path: .init(id: id)) {
            case .ok: ()
            case .default(let s, let r): throw APIError.from(s, r)
            }
        }
    }

    // MARK: Budgets & screens

    func budgets(month: String?) async throws -> BudgetMonth {
        try await run {
            switch try await client.getBudgets(query: .init(month: month)) {
            case .ok(let r): try r.body.json
            case .default(let s, let r): throw APIError.from(s, r)
            }
        }
    }

    func setBudgets(month: String, scope: BudgetScope, items: [(categoryId: String, amountMinor: Int64?)]) async throws -> BudgetMonth {
        let body = Components.Schemas.SetBudgetsRequest(
            month: month, scope: scope,
            items: items.map { .init(categoryId: $0.categoryId, amountMinor: $0.amountMinor) }
        )
        return try await run {
            switch try await client.setBudgets(body: .json(body)) {
            case .ok(let r): try r.body.json
            case .default(let s, let r): throw APIError.from(s, r)
            }
        }
    }

    func home(month: String?) async throws -> Home {
        try await run {
            switch try await client.getHome(query: .init(month: month)) {
            case .ok(let r): try r.body.json
            case .default(let s, let r): throw APIError.from(s, r)
            }
        }
    }

    func months() async throws -> MonthList {
        try await run {
            switch try await client.listMonths() {
            case .ok(let r): try r.body.json
            case .default(let s, let r): throw APIError.from(s, r)
            }
        }
    }

    func insights(period: InsightsPeriod, categoryId: String? = nil) async throws -> Insights {
        try await run {
            switch try await client.getInsights(query: .init(period: period, categoryId: categoryId)) {
            case .ok(let r): try r.body.json
            case .default(let s, let r): throw APIError.from(s, r)
            }
        }
    }

    // MARK: Subscriptions

    func subscriptions() async throws -> SubscriptionList {
        try await run {
            switch try await client.listSubscriptions() {
            case .ok(let r): try r.body.json
            case .default(let s, let r): throw APIError.from(s, r)
            }
        }
    }

    func createSubscription(_ body: Components.Schemas.CreateSubscriptionRequest) async throws -> Subscription {
        try await run {
            switch try await client.createSubscription(body: .json(body)) {
            case .created(let r): try r.body.json
            case .default(let s, let r): throw APIError.from(s, r)
            }
        }
    }

    func updateSubscription(id: String, _ body: Components.Schemas.UpdateSubscriptionRequest) async throws -> Subscription {
        try await run {
            switch try await client.updateSubscription(path: .init(id: id), body: .json(body)) {
            case .ok(let r): try r.body.json
            case .default(let s, let r): throw APIError.from(s, r)
            }
        }
    }

    func deleteSubscription(id: String) async throws {
        try await run {
            switch try await client.deleteSubscription(path: .init(id: id)) {
            case .noContent: ()
            case .default(let s, let r): throw APIError.from(s, r)
            }
        }
    }
}
