import BudgetTrackerCore
import SwiftUI

/// Budgets (design § 7): where am I against each limit?
/// Summary (Budget / Spent / Left + pace bar), Flexible (over first, then by % used)
/// with the tick footnote, Fixed, and Not Budgeted. "Edit" opens Edit Budgets; the title
/// opens the month menu. Every number comes from GET /budgets.
struct BudgetsView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.money) private var f
    @State private var budgets = Loader<BudgetMonth>()
    @State private var months = Loader<MonthList>()
    @State private var editing = false
    @State private var setBudgetFor: BudgetLine?

    var body: some View {
        let data = budgets.value
        let today = data?.period.today ?? app.today
        let shown = data?.period.month ?? app.month ?? app.currentMonth

        List {
            if let error = budgets.error, data == nil {
                Section { InlineErrorView(what: "your budgets", message: error.isNetwork ? nil : error.message) { reload() } }
            } else if let data {
                if data.period.state != .current {
                    Section { monthStateNote(data) }
                }
                if data.hasBudget {
                    summary(data)
                    lists(data)
                } else {
                    Section {
                        EmptyStateView(symbol: "chart.pie", title: "No Budgets Yet",
                                       message: "Set a monthly limit for each category to see what’s left in \(Day.monthLabel(data.period.month, today: today)).",
                                       actionTitle: "Set Budgets") { editing = true }
                    }
                    if data.unbudgeted.contains(where: { $0.spentMinor > 0 }) { notBudgeted(data) }
                }
            } else {
                Section { HeroSkeleton() }
                Section { SkeletonRows(count: 5, double: false) }
            }
        }
        .listSectionSpacing(28)
        .navigationTitle("Budgets")
        .navigationSubtitle(Day.monthLabel(shown, today: today))
        .toolbarTitleMenu {
            MonthMenu(months: months.value, selected: shown) { m in
                app.month = m == app.currentMonth ? nil : m
            }
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                MonthButton(months: months.value, selected: shown)
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button("Edit") { editing = true }.disabled(data == nil)
            }
        }
        .sheet(isPresented: $editing) {
            if let data { EditBudgetsSheet(data: data) }
        }
        .sheet(item: $setBudgetFor) { line in
            ChangeBudgetSheet(line: line, month: data?.period.month ?? shown, currency: data?.homeCurrency ?? app.homeCurrency)
        }
        .refreshable { await load() }
        .task(id: "\(app.moneyVersion)|\(app.month ?? "")") { await load() }
        .onChange(of: app.editBudgetsRequested, initial: true) { _, requested in
            guard requested else { return }
            app.editBudgetsRequested = false
            Task {
                if budgets.value == nil { await load() }
                editing = budgets.value != nil
            }
        }
    }

    private func load() async {
        let api = app.api
        let month = app.month
        async let a: Void = budgets.load { try await api.budgets(month: month) }
        async let b: Void = months.load { try await api.months() }
        _ = await (a, b)
    }

    private func reload() {
        Task { await load() }
    }

    // MARK: Parts

    /// Past or future month: say so, and offer the way back. Facts only.
    private func monthStateNote(_ data: BudgetMonth) -> some View {
        let name = Day.monthLabel(data.period.month, today: data.period.today)
        return VStack(alignment: .leading, spacing: 4) {
            Label(data.period.state == .past ? "\(name) is over. These are its final numbers." : "\(name) hasn’t started yet.",
                  systemImage: data.period.state == .past ? "checkmark.circle" : "calendar")
                .foregroundStyle(Color.label2)
            Button("Go to \(Day.monthName(data.period.today))") { app.month = nil }
                .foregroundStyle(Color.tintText)
                .buttonStyle(.borderless)
        }
        .font(.subheadline)
        .listRowBackground(Color.clear)
        .listRowInsets(EdgeInsets(top: 0, leading: 4, bottom: 0, trailing: 4))
    }

    private func summary(_ data: BudgetMonth) -> some View {
        let t = data.totals
        let cur = data.homeCurrency
        return Section {
            VStack(alignment: .leading, spacing: 16) {
                StatRow(items: [
                    .init(label: "Budget", parts: f.parts(t.budgetMinor, cur)),
                    .init(label: "Spent", parts: f.parts(t.spentMinor, cur)),
                    .init(label: t.leftMinor < 0 ? "Over" : "Left", parts: f.parts(abs(t.leftMinor), cur),
                          color: t.leftMinor < 0 ? .negative : .label),
                ])
                PaceBar(
                    segments: data.segments.map { .init(id: $0.category.id, color: $0.category.color, amountMinor: $0.amountMinor) },
                    spentMinor: t.spentMinor, budgetMinor: t.budgetMinor, currency: cur,
                    marker: data.period.state == .current ? t.paceMarker : nil, animationKey: "budgets"
                )
            }
            .padding(.vertical, 6)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Summary")
    }

    @ViewBuilder
    private func lists(_ data: BudgetMonth) -> some View {
        let elapsed = data.period.state == .current ? data.period.elapsed : nil
        if !data.flexible.isEmpty {
            Section {
                ForEach(data.flexible, id: \.category.id) { line in
                    NavigationLink(value: Route.category(id: line.category.id, month: app.month)) {
                        BudgetRowView(line: line, currency: data.homeCurrency, elapsed: elapsed, animationKey: "budgets")
                    }
                }
            } header: {
                SectionHeader(title: "Flexible")
            } footer: {
                if data.period.state == .current {
                    Text("The tick on each bar marks where you’d be today if you spent evenly through the month.")
                }
            }
        }
        if !data.fixed.isEmpty {
            Section {
                ForEach(data.fixed, id: \.category.id) { line in
                    NavigationLink(value: Route.category(id: line.category.id, month: app.month)) {
                        BudgetRowView(line: line, currency: data.homeCurrency, elapsed: nil, animationKey: "budgets")
                    }
                }
            } header: {
                SectionHeader(title: "Fixed")
            } footer: {
                Text("Fixed costs like rent and phone are counted in full and don’t change your daily amount.")
            }
        }
        if !data.unbudgeted.isEmpty { notBudgeted(data) }
    }

    private func notBudgeted(_ data: BudgetMonth) -> some View {
        Section {
            ForEach(data.unbudgeted, id: \.category.id) { line in
                HStack(spacing: 12) {
                    NavigationLink(value: Route.category(id: line.category.id, month: app.month)) {
                        HStack(spacing: 12) {
                            CategoryTile(color: line.category.color, icon: line.category.icon)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(line.category.name).lineLimit(1)
                                Text("\(f.money(line.spentMinor, data.homeCurrency)) spent")
                                    .font(.footnote)
                                    .foregroundStyle(Color.label2)
                                    .monospacedDigit()
                            }
                        }
                    }
                    Button("Set Budget") { setBudgetFor = line }
                        .font(.subheadline)
                        .foregroundStyle(Color.tintText)
                        .buttonStyle(.borderless)
                        .accessibilityLabel("Set Budget for \(line.category.name)")
                }
            }
        } header: {
            SectionHeader(title: "Not Budgeted")
        } footer: {
            Text("Spending here still counts in Activity and Insights, but not against a limit.")
        }
    }
}

extension BudgetLine: @retroactive Identifiable {
    public var id: String { category.id }
}
