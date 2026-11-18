import BudgetTrackerCore
import SwiftUI

/// Home (design § 7): how much is left, and am I on pace?
/// Title "November ⌄" (month menu) with today's date · hero · Budgets (4 flexible ones,
/// ranked by attention) · Upcoming (charges waiting for you, then what's due in 7 days)
/// · Recent (4). Every number comes from GET /home.
struct HomeView: View {
    @Environment(AppModel.self) private var app
    @State private var home = Loader<Home>()
    @State private var months = Loader<MonthList>()

    var body: some View {
        let data = home.value
        let today = data?.budget.period.today ?? app.today
        let shown = data?.budget.period.month ?? app.month ?? app.currentMonth

        List {
            if let error = home.error, data == nil {
                Section { InlineErrorView(message: error.isNetwork ? nil : error.message) { reload() } }
            } else {
                Section {
                    if let budget = data?.budget {
                        HomeHero(budget: budget, currentMonth: app.currentMonth) { app.month = nil }
                    } else {
                        HeroSkeleton()
                    }
                }
                .listRowInsets(EdgeInsets(top: 18, leading: 20, bottom: 20, trailing: 20))

                budgetsSection(data)
                upcomingSection(data, today: today)
                recentSection(data)
            }
        }
        .listSectionSpacing(28)
        .navigationTitle(Day.monthName(shown))
        .navigationSubtitle(Day.long(today))
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
                NavigationLink(value: Route.settings) {
                    Image(systemName: "person.crop.circle")
                }
                .accessibilityLabel("Profile and Settings")
            }
        }
        .refreshable { await load() }
        .task(id: "\(app.moneyVersion)|\(app.month ?? "")") { await load() }
    }

    private func load() async {
        let api = app.api
        let month = app.month
        async let a: Void = home.load { try await api.home(month: month) }
        async let b: Void = months.load { try await api.months() }
        _ = await (a, b)
    }

    private func reload() {
        Task { await load() }
    }

    // MARK: Sections

    @ViewBuilder
    private func budgetsSection(_ data: Home?) -> some View {
        let budget = data?.budget
        let elapsed = budget?.period.state == .current ? budget?.period.elapsed : nil
        let attention = Array((data?.attention ?? []).filter { !$0.category.isFixed }.prefix(4))
        Section {
            if data == nil {
                SkeletonRows(count: 4, double: false)
            } else if attention.isEmpty {
                HStack(spacing: 4) {
                    Text("No category has a budget this month.").foregroundStyle(Color.label2)
                    Button("Set Budget") { app.openBudgetEditor() }
                        .foregroundStyle(Color.tintText)
                        .buttonStyle(.borderless)
                }
                .font(.subheadline)
            } else {
                ForEach(attention, id: \.category.id) { line in
                    NavigationLink(value: Route.category(id: line.category.id, month: app.month)) {
                        BudgetRowView(line: line, currency: budget?.homeCurrency ?? app.homeCurrency, elapsed: elapsed, animationKey: "home")
                    }
                }
            }
        } header: {
            SectionHeader(title: "Budgets", actionTitle: "See All") { app.show(tab: .budgets) }
        }
    }

    @ViewBuilder
    private func upcomingSection(_ data: Home?, today: String) -> some View {
        let pending = data?.pending ?? []
        let dueSoon = data?.upcoming.filter { $0.daysUntilDue <= 7 } ?? []
        let upcoming = (dueSoon.isEmpty && pending.isEmpty) ? Array((data?.upcoming ?? []).prefix(2)) : dueSoon
        Section {
            if data == nil {
                SkeletonRows(count: 3)
            } else if pending.isEmpty && upcoming.isEmpty {
                Text("Nothing due in the next 7 days.").font(.subheadline).foregroundStyle(Color.label2)
            } else {
                if !pending.isEmpty {
                    Text("Waiting for You")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(Color.label2)
                        .listRowSeparator(.hidden, edges: .bottom)
                        .accessibilityAddTraits(.isHeader)
                }
                ForEach(pending, id: \.id) { t in
                    PendingRow(t: t, today: today)
                }
                ForEach(upcoming, id: \.id) { s in
                    NavigationLink(value: Route.subscriptions) {
                        UpcomingRow(s: s, today: today, homeCurrency: data?.budget.homeCurrency ?? app.homeCurrency)
                    }
                }
            }
        } header: {
            SectionHeader(title: "Upcoming", actionTitle: "See All") { app.push(.subscriptions) }
        }
    }

    @ViewBuilder
    private func recentSection(_ data: Home?) -> some View {
        let recent = Array((data?.recent ?? []).prefix(4))
        Section {
            if data == nil {
                SkeletonRows(count: 4)
            } else if recent.isEmpty {
                EmptyStateView(title: "No Expenses Yet", message: "Add your first expense with the + button.",
                               actionTitle: "Add Expense",
                               // Without a budget, the hero's "Set Budget" is the view's prominent action.
                               prominent: data?.budget.hasBudget == true) { app.openAdd() }
            } else {
                ForEach(recent, id: \.id) { t in
                    NavigationLink(value: Route.transaction(t.id)) { TransactionRowView(t: t) }
                }
            }
        } header: {
            SectionHeader(title: "Recent", actionTitle: "See All") { app.show(tab: .activity) }
        }
    }
}

/// A subscription charge waiting for confirmation: monogram tile, "25,00 lei · Yesterday",
/// a Confirm button and a ⋯ menu with Skip This Time and Details. Pending charges never
/// count as spent until confirmed.
struct PendingRow: View {
    let t: Txn
    let today: String
    @Environment(AppModel.self) private var app
    @Environment(\.money) private var f
    @State private var busy = false

    var body: some View {
        HStack(spacing: 12) {
            CategoryTile(color: t.category.color, monogram: t.title, size: 40)
            VStack(alignment: .leading, spacing: 2) {
                Text(t.title).font(.body.weight(.semibold)).lineLimit(1)
                Text("\(f.money(t.amountMinor, t.currency, income: t.kind == .income)) · \(Day.relative(t.occurredOn, today: today))")
                    .font(.subheadline)
                    .foregroundStyle(Color.label2)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            Button("Confirm") { run { await app.confirm(t) } }
                .font(.subheadline.weight(.semibold))
                .buttonStyle(.bordered)
                .buttonBorderShape(.capsule)
                .controlSize(.small)
            Menu {
                Button("Skip This Time", systemImage: "xmark") { run { await app.skip(t) } }
                Button("Details", systemImage: "info.circle") { app.push(.transaction(t.id)) }
            } label: {
                Image(systemName: "ellipsis")
                    .font(.body.weight(.semibold))
                    .foregroundStyle(Color.label2)
                    .frame(width: 32, height: 44)
            }
            .accessibilityLabel("More for \(t.title)")
        }
        .buttonStyle(.borderless)
        .disabled(busy)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("\(t.title), waiting for you")
    }

    private func run(_ action: @escaping () async -> Void) {
        busy = true
        Task {
            await action()
            busy = false
        }
    }
}

/// An upcoming subscription charge: "In 3 days · Sat 21 Nov" (the relative part
/// emphasized within the next 7 days), the amount and the cadence, or the ≈ home value.
struct UpcomingRow: View {
    let s: Subscription
    let today: String
    let homeCurrency: String
    @Environment(\.money) private var f

    var body: some View {
        let due = Day.dueParts(s.nextDueOn, today: today)
        let soon = due.relative != nil && (0...7).contains(s.daysUntilDue)
        TwoLineRow(
            leading: { CategoryTile(color: s.category.color, monogram: s.title, size: 40) },
            title: s.title,
            subtitle: {
                if soon, let relative = due.relative {
                    Text("\(Text(relative).fontWeight(.semibold).foregroundStyle(Color.label)) · \(due.date)")
                } else {
                    Text(due.date)
                }
            },
            trailing: {
                Text(f.money(s.amountMinor, s.currency, income: s.kind == .income))
                    .foregroundStyle(s.kind == .income ? Color.positive : Color.label)
            },
            trailingSub: s.currency != homeCurrency && s.amountHomeMinor != nil
                ? f.money(s.amountHomeMinor!, homeCurrency, approx: true)
                : s.repeatText
        )
        .accessibilityElement(children: .combine)
    }
}
