import SwiftUI

/// API status (the web app's `/status`), pushed from Settings. Handy on a physical
/// iPhone to check that `API_BASE_URL` points at a reachable server.
struct HealthView: View {
    @State var viewModel: HealthViewModel

    var body: some View {
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
            Section {
                LabeledContent("Server", value: AppConfiguration.apiBaseURL.absoluteString)
            }
        }
        .navigationTitle("API Status")
        .refreshable { await viewModel.refresh() }
        .task { await viewModel.refresh() }
    }
}

private struct StatusRow: View {
    let label: String
    let value: String
    let isHealthy: Bool

    var body: some View {
        LabeledContent(label) {
            Text(value).foregroundStyle(isHealthy ? Color.positive : Color.negative)
        }
    }
}
