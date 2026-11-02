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
    private let client: Client

    init(client: Client) {
        self.client = client
    }

    func refresh() async {
        do {
            switch try await client.getHealth() {
            case .ok(let response):
                state = .loaded(try response.body.json)
            case .serviceUnavailable(let response):
                // A 503 is still a valid health report.
                state = .loaded(try response.body.json)
            case .undocumented:
                state = .unreachable
            }
        } catch {
            state = .unreachable
        }
    }
}
