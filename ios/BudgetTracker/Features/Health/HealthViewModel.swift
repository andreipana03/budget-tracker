import BudgetTrackerAPI
import Observation

@MainActor
@Observable
final class HealthViewModel {
    enum State {
        case loading
        case loaded(Components.Schemas.HealthResponse)
        case unreachable
    }

    private(set) var state = State.loading
    private let api: APIClient

    init(api: APIClient) {
        self.api = api
    }

    func refresh() async {
        do {
            // A 503 is still a valid health report.
            state = .loaded(try await api.health())
        } catch {
            state = .unreachable
        }
    }
}
