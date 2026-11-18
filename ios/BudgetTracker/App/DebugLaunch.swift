#if DEBUG
import Foundation

/// Debug builds only: sign in and open a screen from launch environment variables, so
/// screens can be screenshotted from the command line without tapping:
///
///     SIMCTL_CHILD_BT_SIGN_IN='admin-test:AdminTest@123' \
///     SIMCTL_CHILD_BT_SCREEN=budgets xcrun simctl launch booted com.andreipana.budgettracker
///
/// BT_SCREEN: home, activity, budgets, insights, subscriptions, settings, accounts,
/// categories, add, income, edit-budgets, category, transaction, sign-out.
@MainActor
enum DebugLaunch {
    static func run(_ app: AppModel) async {
        let env = ProcessInfo.processInfo.environment
        let screen = env["BT_SCREEN"]
        if screen == "sign-out" {
            await app.signOut()
            return
        }
        if app.phase != .signedIn, let credentials = env["BT_SIGN_IN"], let colon = credentials.firstIndex(of: ":") {
            let id = String(credentials[..<colon])
            let password = String(credentials[credentials.index(after: colon)...])
            if let response = try? await app.api.login(identifier: id, password: password, deviceName: app.deviceName) {
                await app.signedIn(response)
            }
        }
        guard app.phase == .signedIn, let screen else { return }
        switch screen {
        case "activity": app.show(tab: .activity)
        case "budgets": app.show(tab: .budgets)
        case "insights": app.show(tab: .insights)
        case "subscriptions": app.push(.subscriptions)
        case "settings": app.push(.settings)
        case "accounts": app.paths[.home] = [.settings, .accounts]
        case "categories": app.paths[.home] = [.settings, .categories]
        case "add": app.openAdd()
        case "income": app.openAdd(kind: .income)
        case "edit-budgets": app.openBudgetEditor()
        case "category":
            if let line = try? await app.api.home(month: nil).attention.first {
                app.push(.category(id: line.category.id, month: nil))
            }
        case "transaction":
            if let t = try? await app.api.transactions(.init(limit: 1)).items.first {
                app.push(.transaction(t.id))
            }
        default: break
        }
    }
}
#endif
