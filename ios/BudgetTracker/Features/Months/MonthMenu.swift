import BudgetTrackerCore
import SwiftUI

/// The calendar button on Home and Budgets: the month picker, visible. (The same menu is
/// on the title, but large titles show no chevron, so it needs a button too.)
struct MonthButton: View {
    let months: MonthList?
    let selected: String
    @Environment(AppModel.self) private var app

    var body: some View {
        Menu {
            MonthMenu(months: months, selected: selected) { m in
                app.month = m == app.currentMonth ? nil : m
            }
        } label: {
            Image(systemName: "calendar")
        }
        .accessibilityLabel("Choose Month, \(Day.monthYear(selected)) shown")
    }
}

/// The month picker behind the title on Home and Budgets ("November ⌄"): months from
/// GET /months grouped by year, newest first, each with what was spent and the budget;
/// the shown month is checked and the current one says "This Month".
struct MonthMenu: View {
    let months: MonthList?
    let selected: String
    let onSelect: (String) -> Void
    @Environment(\.money) private var f

    var body: some View {
        if let months {
            let years = Dictionary(grouping: months.items) { String($0.month.prefix(4)) }
            ForEach(years.keys.sorted(by: >), id: \.self) { year in
                Section(year) {
                    ForEach(years[year]!.sorted { $0.month > $1.month }, id: \.month) { m in
                        Button {
                            onSelect(m.month)
                        } label: {
                            if m.month == selected {
                                Label(Day.monthName(m.month), systemImage: "checkmark")
                            } else {
                                Text(Day.monthName(m.month))
                            }
                            Text(summary(m, currency: months.homeCurrency, current: months.current))
                        }
                    }
                }
            }
        } else {
            Text("Loading months…")
        }
    }

    /// "This Month · 1.234 lei spent · 2.000 lei budget"
    private func summary(_ m: MonthSummary, currency: String, current: String) -> String {
        var parts = ["\(f.money(m.spentMinor, currency, whole: true)) spent"]
        if let budget = m.budgetMinor { parts.append("\(f.money(budget, currency, whole: true)) budget") }
        if m.month == current { parts.insert("This Month", at: 0) }
        return parts.joined(separator: " · ")
    }
}
