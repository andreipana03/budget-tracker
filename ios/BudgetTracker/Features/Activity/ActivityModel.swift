import BudgetTrackerCore
import Foundation

/// Activity's list: GET /transactions a page at a time (keyset cursor), newest first.
/// Keeps the previous results on screen while a new search or filter loads.
@MainActor
@Observable
final class ActivityModel {
    struct DayGroup: Identifiable {
        var id: String { date }
        var date: String
        var items: [Txn]
        /// Posted expenses / income of the day matching the filters (API dayTotals).
        var expenseMinor: Int64
        var incomeMinor: Int64
    }

    private(set) var items: [Txn] = []
    private(set) var totals: [String: DayTotal] = [:]
    private(set) var nextCursor: String?
    private(set) var error: APIError?
    private(set) var loaded = false
    private(set) var loadingMore = false
    private var query: APIClient.TxnQuery?
    private var generation = 0

    func load(api: APIClient, query: APIClient.TxnQuery) async {
        generation += 1
        let g = generation
        self.query = query
        do {
            let page = try await api.transactions(query)
            guard g == generation else { return }
            items = page.items
            totals = Dictionary(page.dayTotals.map { ($0.date, $0) }, uniquingKeysWith: { a, _ in a })
            nextCursor = page.nextCursor
            error = nil
            loaded = true
        } catch {
            let e = APIError.wrap(error)
            if g == generation, !e.isCancellation { self.error = e }
        }
    }

    func loadMore(api: APIClient) async {
        guard let cursor = nextCursor, let query, !loadingMore else { return }
        loadingMore = true
        defer { loadingMore = false }
        let g = generation
        guard let page = try? await api.transactions(query, cursor: cursor), g == generation else { return }
        let seen = Set(items.map(\.id))
        items += page.items.filter { !seen.contains($0.id) }
        for d in page.dayTotals where totals[d.date] == nil { totals[d.date] = d }
        nextCursor = page.nextCursor
    }

    /// Drop a row right away (delete); the reload after the write brings it back if it failed.
    func remove(_ id: String) {
        items.removeAll { $0.id == id }
    }

    /// Group by calendar day, keeping the API order. Days without a total sum the posted items.
    var groups: [DayGroup] {
        var groups: [DayGroup] = []
        var index: [String: Int] = [:]
        for t in items {
            if let i = index[t.occurredOn] {
                groups[i].items.append(t)
            } else {
                index[t.occurredOn] = groups.count
                let total = totals[t.occurredOn]
                groups.append(DayGroup(date: t.occurredOn, items: [t], expenseMinor: total?.expenseHomeMinor ?? -1,
                                       incomeMinor: total?.incomeHomeMinor ?? -1))
            }
        }
        for i in groups.indices where groups[i].expenseMinor < 0 || groups[i].incomeMinor < 0 {
            let posted = groups[i].items.filter { $0.status == .posted }
            groups[i].expenseMinor = posted.filter { $0.kind == .expense }.reduce(0) { $0 + $1.homeAmountMinor }
            groups[i].incomeMinor = posted.filter { $0.kind == .income }.reduce(0) { $0 + $1.homeAmountMinor }
        }
        return groups
    }
}

/// Recent Activity searches on this device (a convenience, like the web app's localStorage).
enum RecentSearches {
    private static let key = "bt.recentSearches"
    private static let max = 5

    static func read() -> [String] {
        UserDefaults.standard.stringArray(forKey: key) ?? []
    }

    /// Put `q` first (case-insensitive dedupe), keep the newest five.
    @discardableResult
    static func add(_ q: String) -> [String] {
        let term = q.trimmingCharacters(in: .whitespaces)
        guard !term.isEmpty else { return read() }
        let next = Array(([term] + read().filter { $0.lowercased() != term.lowercased() }).prefix(max))
        UserDefaults.standard.set(next, forKey: key)
        return next
    }

    static func clear() {
        UserDefaults.standard.removeObject(forKey: key)
    }
}
