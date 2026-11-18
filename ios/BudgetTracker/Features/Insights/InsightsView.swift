import BudgetTrackerCore
import SwiftUI

/// Insights (design § 7): what changed?
/// Period (default 6 Months) · the chart card with the takeaway headline · By Category
/// (amount, bar, share of spending) · Highlights (biggest change, biggest day,
/// subscriptions) · Subscriptions, which is pushed from here on iPhone.
struct InsightsView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.money) private var f
    @State private var period = InsightsPeriod.sixMonths
    @State private var insights = Loader<Insights>()

    var body: some View {
        let data = insights.value
        List {
            Section {
                Picker("Period", selection: $period) {
                    ForEach(InsightsText.periods, id: \.0) { Text($0.1).tag($0.0) }
                }
                .pickerStyle(.segmented)
                .listRowInsets(EdgeInsets())
                .listRowBackground(Color.clear)
            }
            if let error = insights.error, data == nil {
                Section { InlineErrorView(what: "your insights", message: error.isNetwork ? nil : error.message) { reload() } }
            } else if let data {
                if InsightsText.isEmpty(data) {
                    Section {
                        EmptyStateView(symbol: "chart.bar", title: "No Spending Yet",
                                       message: "Insights appear here once you add a few expenses.",
                                       actionTitle: "Add Expense") { app.openAdd() }
                    }
                } else {
                    chartCard(data)
                    byCategory(data)
                    highlights(data)
                }
            } else {
                Section {
                    VStack(alignment: .leading, spacing: 10) {
                        Capsule().frame(width: 260, height: 20)
                        Capsule().frame(width: 200, height: 14)
                        RoundedRectangle(cornerRadius: 10).frame(height: 176).padding(.top, 8)
                    }
                    .foregroundStyle(Color.fill4)
                    .padding(.vertical, 6)
                }
            }
            Section {
                NavigationLink(value: Route.subscriptions) {
                    HStack(spacing: 12) {
                        CategoryTile(color: .gray, symbol: "arrow.triangle.2.circlepath")
                        Text("View Subscriptions")
                    }
                }
            }
        }
        .listSectionSpacing(28)
        .navigationTitle("Insights")
        .toolbar {
            if let data, !InsightsText.isEmpty(data) {
                ToolbarItem(placement: .topBarTrailing) {
                    ShareLink(item: InsightsText.share(data, today: app.today, f)) {
                        Image(systemName: "square.and.arrow.up")
                    }
                    .accessibilityLabel("Share Insights")
                }
            }
        }
        .refreshable { await load() }
        .task(id: "\(app.moneyVersion)|\(period.rawValue)") { await load() }
    }

    private func load() async {
        let api = app.api
        let period = period
        await insights.load { try await api.insights(period: period) }
    }

    private func reload() {
        Task { await load() }
    }

    // MARK: Parts

    private func chartCard(_ data: Insights) -> some View {
        let daily = data.period == .week || data.period == .month
        let hasProjection = data.bars.contains { $0.isCurrent && $0.projectedMinor != nil }
        return Section {
            VStack(alignment: .leading, spacing: 4) {
                Text(InsightsText.headline(data, f))
                    .font(.title3.weight(.semibold))
                Text(InsightsText.supportingLine(data, today: app.today, f))
                    .font(.subheadline)
                    .foregroundStyle(Color.label2)
                SpendingChart(bars: InsightsText.bars(data, compact: true), currency: data.homeCurrency,
                              averageMinor: data.averageMinor, description: InsightsText.chartDescription(data))
                    .padding(.top, 14)
                ChartLegend(hasProjection: hasProjection, hasAverage: data.averageMinor != nil,
                            pastLabel: daily ? "Past days" : "Past months")
                    .padding(.top, 8)
            }
            .padding(.vertical, 6)
        }
    }

    @ViewBuilder
    private func byCategory(_ data: Insights) -> some View {
        if !data.byCategory.isEmpty {
            let maxValue = Double(data.byCategory.map(\.spentMinor).max() ?? 1)
            Section {
                ForEach(data.byCategory, id: \.category.id) { c in
                    NavigationLink(value: Route.category(id: c.category.id, month: nil)) {
                        HStack(alignment: .top, spacing: 12) {
                            CategoryTile(color: c.category.color, icon: c.category.icon).padding(.top, 1)
                            VStack(alignment: .leading, spacing: 6) {
                                HStack(alignment: .firstTextBaseline) {
                                    Text(c.category.name).lineLimit(1)
                                    Spacer()
                                    Text(f.money(c.spentMinor, data.homeCurrency))
                                        .font(.subheadline.weight(.semibold))
                                        .monospacedDigit()
                                }
                                HorizontalBar(ratio: Double(c.spentMinor) / max(maxValue, 1), color: Hue.mark(c.category.color))
                                Text("\(MoneyFormatter.percent(c.share)) of spending")
                                    .font(.footnote)
                                    .foregroundStyle(Color.label2)
                            }
                        }
                        .padding(.vertical, 4)
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel("\(c.category.name): \(f.money(c.spentMinor, data.homeCurrency)), \(MoneyFormatter.percent(c.share)) of spending")
                    }
                }
            } header: {
                SectionHeader(title: "By Category")
            }
        }
    }

    @ViewBuilder
    private func highlights(_ data: Insights) -> some View {
        let cur = data.homeCurrency
        let daily = data.period == .week || data.period == .month
        // Sparks stop at the current bar: days after today are empty, not zero spending.
        let currentIndex = data.bars.firstIndex(where: \.isCurrent)
        let upTo = currentIndex.map { $0 + 1 } ?? data.bars.count
        let subs = data.subscriptions
        let showSubs = subs.activeCount > 0 || subs.perMonthMinor > 0
        if data.biggestChange != nil || data.biggestDay != nil || showSubs {
            Section {
                if let change = data.biggestChange {
                    let spark = Array(change.spark.prefix(min(upTo, change.spark.count)))
                    HighlightCard(kickerSymbol: CategoryIcon.symbol(change.category.icon), kicker: change.category.name,
                                  kickerColor: change.category.color,
                                  title: Copy.changeTitle(isWeek: data.period == .week, changeRatio: change.changeRatio, comparedTo: change.comparedTo),
                                  bodyText: InsightsText.changeBody(data, change, f),
                                  spark: spark.count > 1 ? (spark, spark.count - 1, Hue.mark(change.category.color)) : nil)
                        .padding(.vertical, 6)
                }
                if let day = data.biggestDay {
                    let dayIndex = daily ? data.bars.firstIndex { $0.startsOn == day.date } : nil
                    HighlightCard(kickerSymbol: "calendar", kicker: "Biggest Day",
                                  title: InsightsText.biggestDayTitle(day, today: app.today),
                                  bodyText: InsightsText.biggestDayBody(day, currency: cur, f),
                                  spark: dayIndex.flatMap { $0 < upTo ? (data.bars.prefix(upTo).map(\.spentMinor), $0, Color.label) : nil })
                        .padding(.vertical, 6)
                }
                if showSubs {
                    HighlightCard(kickerSymbol: "arrow.triangle.2.circlepath", kicker: "Subscriptions",
                                  title: InsightsText.subscriptionsTitle(subs, currency: cur, f),
                                  bodyText: InsightsText.subscriptionsBody(subs, today: app.today))
                        .padding(.vertical, 6)
                }
            } header: {
                SectionHeader(title: "Highlights")
            }
        }
    }
}
