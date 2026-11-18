import BudgetTrackerCore
import SwiftUI

/// Subscriptions (design § 7): what will be charged, and when?
/// "≈ 162,87 lei per month · 1.954 lei a year · 6 active", charges waiting for
/// confirmation, then Next 7 Days · Later · Paused. Pushed from Insights and Home.
struct SubscriptionsView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.money) private var f
    @State private var subs = Loader<SubscriptionList>()
    @State private var sheet: SubscriptionSheet.Target?

    var body: some View {
        let data = subs.value
        List {
            if let error = subs.error, data == nil {
                Section { InlineErrorView(what: "your subscriptions", message: error.isNetwork ? nil : error.message) { reload() } }
            } else if let data {
                if data.all.isEmpty && data.pendingCount == 0 {
                    Section {
                        EmptyStateView(symbol: "arrow.triangle.2.circlepath", title: "No Subscriptions Yet",
                                       message: "Add payments that repeat, like a phone plan or streaming, to see what’s coming and when.",
                                       actionTitle: "New Subscription") { sheet = .new }
                    }
                } else {
                    summary(data)
                    if data.pendingCount > 0 { pendingRow(data.pendingCount) }
                    groups(data)
                }
            } else {
                Section { HeroSkeleton() }
                Section { SkeletonRows(count: 4) }
            }
        }
        .listSectionSpacing(28)
        .navigationTitle("Subscriptions")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("New Subscription", systemImage: "plus") { sheet = .new }
            }
        }
        .sheet(item: $sheet) { target in
            SubscriptionSheet(target: target)
        }
        .refreshable { await load() }
        .task(id: app.moneyVersion) { await load() }
    }

    private func load() async {
        let api = app.api
        await subs.load { try await api.subscriptions() }
    }

    private func reload() {
        Task { await load() }
    }

    // MARK: Parts

    private func summary(_ data: SubscriptionList) -> some View {
        Section {
            VStack(alignment: .leading, spacing: 2) {
                Text("Per month").font(.subheadline.weight(.semibold)).foregroundStyle(Color.label2)
                HeroAmount(parts: f.parts(data.perMonthMinor, data.homeCurrency, approx: data.isApproximate), size: 34)
                Text("\(f.money(data.perYearMinor, data.homeCurrency, whole: true)) a year · \(data.activeCount) active")
                    .font(.subheadline)
                    .foregroundStyle(Color.label2)
                    .monospacedDigit()
                    .padding(.top, 2)
            }
            .padding(.vertical, 6)
            .accessibilityElement(children: .combine)
        }
    }

    private func pendingRow(_ count: Int) -> some View {
        Section {
            Button {
                app.activityStatus = .pending
                app.show(tab: .activity)
            } label: {
                HStack(spacing: 12) {
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(Color.tintSoft)
                        .frame(width: 30, height: 30)
                        .overlay(Image(systemName: "clock.fill").foregroundStyle(Color.tintText))
                        .accessibilityHidden(true)
                    Text("\(count) waiting for confirmation").foregroundStyle(Color.label)
                    Spacer()
                    Text("Review").foregroundStyle(Color.label2)
                    Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(Color.label3)
                }
            }
        }
    }

    @ViewBuilder
    private func groups(_ data: SubscriptionList) -> some View {
        let groups = [("Next 7 Days", data.nextSevenDays), ("Later", data.later), ("Paused", data.paused)].filter { !$0.1.isEmpty }
        ForEach(Array(groups.enumerated()), id: \.element.0) { index, group in
            Section {
                ForEach(group.1, id: \.id) { s in
                    Button { sheet = .edit(s) } label: { row(s, home: data.homeCurrency) }
                        .foregroundStyle(Color.label)
                }
            } header: {
                SectionHeader(title: group.0)
            } footer: {
                if index == groups.count - 1, let note = convertedNote(data) { Text(note) }
            }
        }
    }

    private func row(_ s: Subscription, home: String) -> some View {
        let due = Day.dueParts(s.nextDueOn, today: app.today)
        let converted = s.currency != home && s.amountHomeMinor != nil
        return TwoLineRow(
            leading: { CategoryTile(color: s.category.color, monogram: s.title, size: 40) },
            title: s.title,
            subtitle: {
                if !s.isActive {
                    Text("Paused")
                } else if s.daysUntilDue <= 7, let relative = due.relative {
                    Text("\(Text(relative).fontWeight(.semibold).foregroundStyle(Color.label)) · \(due.date)")
                } else {
                    Text(due.date)
                }
            },
            trailing: {
                Text(f.money(s.amountMinor, s.currency, income: s.kind == .income))
                    .foregroundStyle(s.kind == .income ? Color.positive : Color.label)
            },
            trailingSub: converted ? f.money(s.amountHomeMinor!, home, income: s.kind == .income, approx: true) : s.repeatText
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(s.title), \(f.money(s.amountMinor, s.currency, income: s.kind == .income)), \(s.repeatText), "
            + (s.isActive ? "next \(Day.short(s.nextDueOn, today: app.today))" : "paused"))
        .accessibilityHint("Edit Subscription")
    }

    /// "Amounts in euros are converted to lei at today’s rate."
    private func convertedNote(_ data: SubscriptionList) -> String? {
        let foreign = Set(data.all.map(\.currency).filter { $0 != data.homeCurrency })
        guard !foreign.isEmpty else { return nil }
        let what = foreign == ["EUR"] ? "euros" : "other currencies"
        return "Amounts in \(what) are converted to \(f.symbol(data.homeCurrency)) at today’s rate."
    }
}
