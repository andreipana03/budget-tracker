import SwiftUI

struct HealthView: View {
    @State var viewModel: HealthViewModel

    var body: some View {
        NavigationStack {
            List {
                switch viewModel.state {
                case .loading:
                    ProgressView("Checking…")
                case .unreachable:
                    StatusRow(label: "API", value: "unreachable", isHealthy: false)
                case .loaded(let health):
                    StatusRow(label: "API", value: health.status.rawValue, isHealthy: health.status == .ok)
                    StatusRow(label: "Database", value: health.database.rawValue, isHealthy: health.database == .up)
                }
            }
            .navigationTitle("Budget Tracker")
            .refreshable { await viewModel.refresh() }
            .task { await viewModel.refresh() }
        }
    }
}

private struct StatusRow: View {
    let label: String
    let value: String
    let isHealthy: Bool

    var body: some View {
        LabeledContent(label) {
            Text(value).foregroundStyle(isHealthy ? .green : .red)
        }
    }
}
