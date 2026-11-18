import BudgetTrackerCore
import SwiftUI

/// Category detail (pushed from Budgets, Home and Insights): Spent / Budget / Left with
/// the mini pace bar and its status note, the last six months, this month's
/// transactions, and "Change Budget" (amount + "Only {Month}").
struct CategoryDetailView: View {
    let categoryId: String
    let month: String?
    @Environment(AppModel.self) private var app
    @Environment(\.money) private var f
    @State private var budgets = Loader<BudgetMonth>()
    @State private var history = Loader<Insights>()
    @State private var transactions = Loader<TxnPage>()
    @State private var changing = false

    var body: some View {
        let data = budgets.value
        let line = data?.allLines.first { $0.category.id == categoryId }
        List {
            if let error = budgets.error, data == nil {
                Section { InlineErrorView(what: "this category", message: error.isNetwork ? nil : error.message) { reload() } }
            } else if let data {
                if let line {
                    header(line, data)
                    historySection(currency: data.homeCurrency)
                    transactionsSection(data)
                } else {
                    Section {
                        EmptyStateView(symbol: "chart.pie", title: "Category Not Found",
                                       message: "It may have been archived, or it isn’t an expense category.")
                    }
                }
            } else {
                Section { HeroSkeleton() }
            }
        }
        .listSectionSpacing(28)
        .navigationTitle(line?.category.name ?? "Category")
        .navigationSubtitle(data.map { Day.monthLabel($0.period.month, today: $0.period.today) } ?? "")
        .toolbar {
            if line != nil {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Edit") { changing = true }
                        .accessibilityLabel(line?.limitMinor == nil ? "Set Budget" : "Change Budget")
                }
            }
        }
        .sheet(isPresented: $changing) {
            if let line, let data {
                ChangeBudgetSheet(line: line, month: data.period.month, currency: data.homeCurrency)
            }
        }
        .refreshable { await load() }
        .task(id: app.moneyVersion) { await load() }
    }

    private func load() async {
        let api = app.api
        let month = month
        let id = categoryId
        async let a: Void = budgets.load { try await api.budgets(month: month) }
        async let b: Void = history.load { try await api.insights(period: .sixMonths, categoryId: id) }
        async let c: Void = transactions.load { try await api.transactions(.init(categoryId: id, month: month, limit: 50)) }
        _ = await (a, b, c)
    }

    private func reload() {
        Task { await load() }
    }

    // MARK: Parts

    private func header(_ line: BudgetLine, _ data: BudgetMonth) -> some View {
        let cur = data.homeCurrency
        let fixed = line.category.isFixed
        let name = Day.monthLabel(data.period.month, today: data.period.today)
        let over = line.limitMinor != nil && line.status == .over
        let scopeText = line.limitMinor == nil ? "No budget for \(name)"
            : line.scope == .singleMonth ? "Budget for \(name) only" : "Monthly budget"
        return Section {
            VStack(alignment: .leading, spacing: 18) {
                HStack(spacing: 12) {
                    CategoryTile(color: line.category.color, icon: line.category.icon, size: 40)
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 8) {
                            Text(scopeText).font(.headline).lineLimit(1)
                            if fixed { Pill(text: "Fixed") }
                        }
                        Text(fixed ? "Counted in full from the 1st" : "Spent through the month")
                            .font(.subheadline)
                            .foregroundStyle(Color.label2)
                    }
                }
                if let limit = line.limitMinor, let left = line.leftMinor {
                    StatRow(items: [
                        .init(label: "Spent", parts: f.parts(line.spentMinor, cur)),
                        .init(label: "Budget", parts: f.parts(limit, cur)),
                        .init(label: over ? "Over" : "Left", parts: f.parts(abs(left), cur), color: over ? .negative : .label),
                    ])
                    VStack(alignment: .leading, spacing: 8) {
                        MiniPace(spentMinor: line.spentMinor, limitMinor: limit,
                                 elapsed: !fixed && data.period.state == .current ? data.period.elapsed : nil,
                                 fixed: fixed, color: line.category.color)
                        statusNote(line, ofText: "\(f.number(line.spentMinor, cur)) of \(f.money(limit, cur, whole: true))")
                    }
                } else {
                    StatRow(items: [.init(label: "Spent", parts: f.parts(line.spentMinor, cur))])
                }
            }
            .padding(.vertical, 6)
        }
    }

    @ViewBuilder
    private func statusNote(_ line: BudgetLine, ofText: String) -> some View {
        Group {
            if line.status == .over {
                Label("Over budget · \(ofText)", systemImage: "exclamationmark.circle.fill")
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.negative)
            } else if line.status == .ahead && !line.category.isFixed {
                HStack(spacing: 4) {
                    Image(systemName: "chart.line.uptrend.xyaxis")
                    Text("Ahead of pace ·").fontWeight(.semibold)
                    Text(ofText).foregroundStyle(Color.label2)
                }
            } else {
                Text(ofText).foregroundStyle(Color.label2)
            }
        }
        .labelStyle(TightLabelStyle())
        .font(.footnote)
        .monospacedDigit()
    }

    private func historySection(currency: String) -> some View {
        Section {
            if let d = history.value {
                VStack(alignment: .leading, spacing: 12) {
                    Text(InsightsText.headline(d, f)).font(.headline)
                    SpendingChart(bars: InsightsText.bars(d, compact: true), currency: currency,
                                  averageMinor: d.averageMinor, description: InsightsText.chartDescription(d))
                }
                .padding(.vertical, 6)
            } else if history.error != nil {
                InlineErrorView(what: "the last six months") { reload() }
            } else {
                RoundedRectangle(cornerRadius: 10).fill(Color.fill4).frame(height: 180)
            }
        } header: {
            SectionHeader(title: "Last 6 Months")
        }
    }

    private func transactionsSection(_ data: BudgetMonth) -> some View {
        let name = Day.monthLabel(data.period.month, today: data.period.today)
        return Section {
            if let page = transactions.value {
                if page.items.isEmpty {
                    Text("No transactions in \(name).").font(.subheadline).foregroundStyle(Color.label2)
                        .frame(maxWidth: .infinity)
                } else {
                    ForEach(page.items, id: \.id) { t in
                        NavigationLink(value: Route.transaction(t.id)) {
                            TwoLineRow(
                                leading: { CategoryTile(color: t.category.color, monogram: t.title, size: 40) },
                                title: t.title,
                                titleAccessory: t.status == .pending ? "Pending" : nil,
                                titleAccessoryTinted: true,
                                subtitle: { Text("\(Day.relative(t.occurredOn, today: data.period.today)) · \(t.account.name)") },
                                trailing: { TxnAmount(t: t) },
                                trailingSub: t.isForeign ? f.money(t.homeAmountMinor, t.homeCurrency) : nil
                            )
                            .accessibilityElement(children: .combine)
                        }
                    }
                }
            } else if transactions.error != nil {
                InlineErrorView(what: "these transactions") { reload() }
            } else {
                SkeletonRows(count: 4)
            }
        } header: {
            SectionHeader(title: "In \(name)")
        }
    }
}
