import BudgetTrackerAPI
import BudgetTrackerCore
import SwiftUI
import UIKit

/// The four tabs. Add is a separate button, not a tab (design § 5.2).
enum AppTab: Hashable {
    case home, activity, budgets, insights
}

/// Screens pushed inside a tab's navigation stack.
enum Route: Hashable {
    case transaction(String)
    case category(id: String, month: String?)
    case subscriptions
    case settings
    case accounts
    case categories
    case status
}

/// Opens the global Add / Edit sheet (design § 6.11).
struct AddRequest: Identifiable, Equatable {
    let id = UUID()
    var kind: EntryKind = .expense
    var transactionId: String? = nil
    var categoryId: String? = nil
}

/// App-wide state: the session, data every screen shares (household, categories,
/// accounts, currencies), navigation, toasts, and `moneyVersion`, the signal screens
/// reload on after any write (the web app's `invalidateMoney`).
@MainActor
@Observable
final class AppModel {
    enum Phase: Equatable {
        case launching, signedOut, signedIn
        /// Signed in on this device, but the server can't be reached right now.
        case unreachable
    }

    let api: APIClient
    let deviceName: String
    let toasts = ToastCenter()

    var phase = Phase.launching
    var user: User?
    var household: Household?
    /// Active categories of both kinds, in sort order.
    var categories: [Category] = []
    var accountList: AccountList?
    var currencies: [Currency] = []

    /// Bumped after every write that moves money: screens reload on it.
    private(set) var moneyVersion = 0

    var tab = AppTab.home
    var paths: [AppTab: [Route]] = [:]
    var addRequest: AddRequest?
    /// The budget month Home and Budgets show; nil = the household's current month.
    var month: String?
    /// A status filter for Activity, set from Subscriptions' "waiting for confirmation".
    var activityStatus: TxnStatus?
    /// Set by Home's "Set Budget": Budgets opens Edit Budgets when it sees it.
    var editBudgetsRequested = false

    init(api: APIClient) {
        self.api = api
        self.deviceName = UIDevice.current.name
    }

    var money: MoneyFormatter { MoneyFormatter(region: user?.region) }
    var today: String { household?.today ?? Day.localToday() }
    var currentMonth: String { household?.currentMonth ?? Day.monthOf(today) }
    var homeCurrency: String { household?.homeCurrency ?? accountList?.homeCurrency ?? "RON" }
    /// Accounts offered in pickers (not archived).
    var accounts: [Account] { accountList?.items.filter { !$0.archived } ?? [] }

    // MARK: Session

    func start() async {
        await api.session.setOnSignedOut { [weak self] in await self?.sessionEnded() }
        guard await api.session.hasRefreshToken else {
            phase = .signedOut
            return
        }
        phase = .launching
        switch await api.session.refresh() {
        case .signedIn(let response):
            user = response.user
            phase = .signedIn
            await loadShared()
        case .signedOut:
            phase = .signedOut
        case .failed:
            phase = .unreachable
        }
    }

    /// Store a sign-in / sign-up response and show the app.
    func signedIn(_ response: AuthResponse) async {
        await api.session.apply(response)
        user = response.user
        tab = .home
        paths = [:]
        month = nil
        phase = .signedIn
        await loadShared()
    }

    func signOut() async {
        let token = await api.session.refreshToken
        try? await api.logout(refreshToken: token)
        await api.session.clear()
        reset()
    }

    /// The refresh token stopped working (expired, revoked, or the password changed elsewhere).
    func sessionEnded() {
        guard phase == .signedIn else { return }
        reset()
        toasts.show("Your session has ended. Sign in again.")
    }

    private func reset() {
        user = nil
        household = nil
        categories = []
        accountList = nil
        addRequest = nil
        paths = [:]
        month = nil
        activityStatus = nil
        tab = .home
        phase = .signedOut
    }

    // MARK: Shared data

    /// Household, categories, accounts and currencies, in parallel. Failures keep what we had.
    func loadShared() async {
        let api = api
        async let household = try? api.household()
        async let categories = try? api.categories()
        async let accounts = try? api.accounts()
        async let currencies = try? api.currencies()
        async let me = try? api.me()
        if let value = await household { self.household = value }
        if let value = await categories { self.categories = value }
        if let value = await accounts { self.accountList = value }
        if let value = await currencies {
            self.currencies = value
            Currencies.register(value.map { ($0.code, $0.minorUnits) })
        }
        if let value = await me { self.user = value }
    }

    /// Call after any write that moves money or changes how it's grouped: every screen
    /// that shows it reloads, and the shared lists refresh.
    func moneyChanged() {
        moneyVersion += 1
        Task { await loadShared() }
    }

    // MARK: Navigation

    func push(_ route: Route) {
        paths[tab, default: []].append(route)
    }

    func show(tab: AppTab) {
        self.tab = tab
        paths[tab] = []
    }

    /// Home's "Set Budget" (the web app's `/budgets?edit=1`).
    func openBudgetEditor() {
        show(tab: .budgets)
        editBudgetsRequested = true
    }

    func openAdd(kind: EntryKind = .expense, categoryId: String? = nil) {
        addRequest = AddRequest(kind: kind, categoryId: categoryId)
    }

    func openEdit(_ t: Txn) {
        addRequest = AddRequest(kind: t.kind, transactionId: t.id)
    }

    // MARK: Transaction actions (Activity, detail, Home)

    /// Soft delete right away; the toast offers Undo. Returns false if the delete failed.
    @discardableResult
    func delete(_ t: Txn) async -> Bool {
        let noun = t.kind.noun
        do {
            try await api.deleteTransaction(id: t.id)
        } catch let e as APIError where e.status != 404 {
            toasts.show("Couldn’t delete this \(noun.lowercased())")
            moneyChanged()
            return false
        } catch {}
        moneyChanged()
        toasts.show("\(noun) deleted", actionTitle: "Undo") { [weak self] in
            Task { await self?.restore(t) }
        }
        return true
    }

    private func restore(_ t: Txn) async {
        do {
            try await api.restoreTransaction(id: t.id)
        } catch {
            toasts.show("Couldn’t restore this \(t.kind.noun.lowercased())")
        }
        moneyChanged()
    }

    @discardableResult
    func confirm(_ t: Txn) async -> Bool {
        defer { moneyChanged() }
        do {
            try await api.confirmTransaction(id: t.id)
            toasts.show("Payment confirmed")
            return true
        } catch {
            toasts.show((error as? APIError)?.code == "not_pending" ? "This payment was already handled" : "Couldn’t confirm this payment")
            return false
        }
    }

    @discardableResult
    func skip(_ t: Txn) async -> Bool {
        defer { moneyChanged() }
        do {
            try await api.skipTransaction(id: t.id)
            toasts.show("Payment skipped")
            return true
        } catch {
            toasts.show((error as? APIError)?.code == "not_pending" ? "This payment was already handled" : "Couldn’t skip this payment")
            return false
        }
    }
}

extension EnvironmentValues {
    /// Money formatting in the signed-in person's region (`User.region`).
    @Entry var money = MoneyFormatter(region: nil)
}

/// Loads one value for a screen and keeps the previous one on screen while it reloads.
@MainActor
@Observable
final class Loader<Value: Sendable> {
    var value: Value?
    private(set) var error: APIError?
    private(set) var isLoading = false

    func load(_ fetch: @Sendable () async throws -> Value) async {
        isLoading = true
        defer { isLoading = false }
        do {
            value = try await fetch()
            error = nil
        } catch {
            let e = APIError.wrap(error)
            if !e.isCancellation { self.error = e }
        }
    }
}
