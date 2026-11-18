import GoogleSignIn
import SwiftUI

@main
struct BudgetTrackerApp: App {
    @State private var app = AppModel(api: APIClient(baseURL: AppConfiguration.apiBaseURL))

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(app)
                .environment(\.money, app.money)
                .tint(Color.tintFill)
                .onOpenURL { url in
                    GIDSignIn.sharedInstance.handle(url)
                }
        }
    }
}
