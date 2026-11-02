import BudgetTrackerAPI
import SwiftUI

@main
struct BudgetTrackerApp: App {
    private let client = Client(baseURL: AppConfiguration.apiBaseURL)

    var body: some Scene {
        WindowGroup {
            HealthView(viewModel: HealthViewModel(client: client))
        }
    }
}
