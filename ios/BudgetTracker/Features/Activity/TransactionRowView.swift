import BudgetTrackerCore
import SwiftUI

/// Two-line transaction row (design § 6.5): 40pt tile · title (+ Pending/Skipped) ·
/// "Category · Account" (or the note; ↻ for subscription charges) · the amount as
/// entered, with the home-currency value below for foreign currencies.
struct TransactionRowView: View {
    let t: Txn
    var showCategory = true
    @Environment(\.money) private var f

    var body: some View {
        TwoLineRow(
            leading: { CategoryTile(color: t.category.color, icon: t.category.icon, size: 40) },
            title: t.title,
            titleAccessory: t.status == .pending ? "Pending" : t.status == .skipped ? "Skipped" : nil,
            titleAccessoryTinted: t.status == .pending,
            subtitle: {
                HStack(spacing: 4) {
                    if showCategory { Text("\(t.category.name) ·").layoutPriority(1) }
                    if t.recurringId != nil {
                        Image(systemName: "arrow.triangle.2.circlepath").imageScale(.small).accessibilityLabel("Repeats")
                    }
                    Text(t.note?.isEmpty == false ? t.note! : t.account.name)
                }
            },
            trailing: { TxnAmount(t: t) },
            trailingSub: t.isForeign ? f.money(t.homeAmountMinor, t.homeCurrency) : nil
        )
        .accessibilityElement(children: .combine)
    }
}

/// The amount as entered: income with "+" in green; skipped ones struck through.
struct TxnAmount: View {
    let t: Txn
    @Environment(\.money) private var f

    var body: some View {
        Text(f.money(t.amountMinor, t.currency, income: t.kind == .income))
            .foregroundStyle(t.status == .skipped ? Color.label2 : t.kind == .income ? Color.positive : Color.label)
            .strikethrough(t.status == .skipped)
            .monospacedDigit()
    }
}

/// Day group header: "Today · Wed 18 Nov" (older days "Monday, 16 November") with the
/// day's total: "84,30 lei spent", or "850,00 lei received" on an income-only day.
struct DayHeading: View {
    let date: String
    let today: String
    let expenseMinor: Int64
    let incomeMinor: Int64
    let currency: String
    var incomeOnly = false
    @Environment(\.money) private var f

    var body: some View {
        let header = Day.header(date, today: today)
        let showIncome = incomeOnly || (expenseMinor == 0 && incomeMinor > 0)
        let total: String? = showIncome
            ? (incomeMinor > 0 ? "\(f.money(incomeMinor, currency)) received" : nil)
            : (expenseMinor > 0 ? "\(f.money(expenseMinor, currency)) spent" : nil)
        HStack(alignment: .firstTextBaseline) {
            Text("\(Text(header.title).foregroundStyle(Color.label))\(Text(header.detail.map { " · \($0)" } ?? "").fontWeight(.regular).foregroundStyle(Color.label2))")
                .font(.headline)
                .lineLimit(1)
            Spacer()
            if let total {
                Text(total).font(.subheadline).foregroundStyle(Color.label2).monospacedDigit()
            }
        }
        .textCase(nil)
        .padding(.horizontal, -4)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}
