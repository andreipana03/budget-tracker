import BudgetTrackerCore
import SwiftUI

/// Home hero card (design § 6.15, § 3): what's left, the daily amount, the pace status
/// and the pace bar, or the no-budget, month-over and not-started-yet versions.
struct HomeHero: View {
    let budget: BudgetMonth
    /// The household's current budget month, "YYYY-MM".
    let currentMonth: String
    let goToCurrent: () -> Void

    @Environment(AppModel.self) private var app
    @Environment(\.money) private var f

    var body: some View {
        let period = budget.period
        let totals = budget.totals
        let cur = budget.homeCurrency
        let name = Day.monthName(period.month)

        VStack(alignment: .leading, spacing: 0) {
            if !budget.hasBudget {
                label(name)
                Text("Set a monthly budget to see what’s left")
                    .font(.title3.weight(.semibold))
                    .padding(.top, 4)
                sub("Give each category a limit and Budget Tracker shows how much you can still spend each day.")
                Button {
                    app.openBudgetEditor()
                } label: {
                    Label("Set Budget", systemImage: "plus")
                }
                .buttonStyle(.borderedProminent)
                .fontWeight(.semibold)
                .controlSize(.large)
                .padding(.top, 16)
            } else if period.state == .past {
                let left = totals.leftMinor
                let next = Day.addMonths(period.month, 1)
                label("\(name) is over")
                HeroAmount(parts: f.parts(totals.spentMinor, cur)).padding(.top, 2)
                Text("Spent of your \(f.money(totals.budgetMinor, cur, whole: true)) budget · \(left >= 0 ? Text("\(f.money(left, cur)) left over") : Text("\(f.money(-left, cur)) over").fontWeight(.semibold).foregroundStyle(Color.negative))")
                    .font(.subheadline)
                    .foregroundStyle(Color.label2)
                    .padding(.top, 4)
                paceBar(marker: nil)
                Button(next == currentMonth ? "Start \(Day.monthName(currentMonth))" : "Go to \(Day.monthName(currentMonth))",
                       action: goToCurrent)
                    .buttonStyle(.borderedProminent)
                    .fontWeight(.semibold)
                    .controlSize(.large)
                    .padding(.top, 20)
            } else if period.state == .future {
                label("Budget for \(name)")
                HeroAmount(parts: f.parts(totals.budgetMinor, cur)).padding(.top, 2)
                sub("Starts \(Day.short(period.startsOn, today: period.today)) · \(period.daysInPeriod) days")
                Button("Go to \(Day.monthName(currentMonth))", action: goToCurrent)
                    .buttonStyle(.bordered)
                    .controlSize(.large)
                    .padding(.top, 16)
            } else {
                let over = totals.status == .over
                label(over ? "Over budget in \(name)" : "Left to spend in \(name)")
                HeroAmount(parts: f.parts(abs(totals.leftMinor), cur), color: over ? .negative : .label)
                    .padding(.top, 2)
                if let perDay = totals.perDayMinor {
                    sub(Copy.perDay(perDay, daysLeft: period.daysLeft, currency: cur, f))
                }
                status(totals: totals, currency: cur)
                    .padding(.top, 14)
                paceBar(marker: totals.paceMarker)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func label(_ text: String) -> some View {
        Text(text).font(.subheadline.weight(.semibold)).foregroundStyle(Color.label2)
    }

    private func sub(_ text: String) -> some View {
        Text(text).font(.subheadline).foregroundStyle(Color.label2).padding(.top, 4)
    }

    @ViewBuilder
    private func status(totals: BudgetTotals, currency cur: String) -> some View {
        switch totals.status {
        case .over:
            HStack(spacing: 6) {
                Image(systemName: "exclamationmark.circle.fill")
                Text("\(Text("Over budget").fontWeight(.semibold)) · \(f.money(-totals.leftMinor, cur, whole: true)) over")
            }
            .foregroundStyle(Color.negative)
            .font(.subheadline)
        case .ahead:
            HStack(spacing: 6) {
                Image(systemName: "chart.line.uptrend.xyaxis")
                Text("\(Text("Ahead of pace").fontWeight(.semibold))\(Text(" · \(f.money(-(totals.underPaceMinor ?? 0), cur, whole: true)) over").foregroundStyle(Color.label2))")
            }
            .font(.subheadline)
        case .onTrack:
            HStack(spacing: 6) {
                Image(systemName: "checkmark.circle.fill").foregroundStyle(Color.positive)
                Text("\(Text("On track").fontWeight(.semibold))\(Text(" · \(f.money(totals.underPaceMinor ?? 0, cur, whole: true)) under pace").foregroundStyle(Color.label2))")
            }
            .font(.subheadline)
        }
    }

    private func paceBar(marker: Double?) -> some View {
        PaceBar(
            segments: budget.segments.map { .init(id: $0.category.id, color: $0.category.color, amountMinor: $0.amountMinor) },
            spentMinor: budget.totals.spentMinor,
            budgetMinor: budget.totals.budgetMinor,
            currency: budget.homeCurrency,
            marker: marker,
            animationKey: "home"
        )
        .padding(.top, 14)
    }
}

/// Loading shape of the hero: label, amount, daily line, status, bar and scale.
struct HeroSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Capsule().frame(width: 176, height: 14)
            RoundedRectangle(cornerRadius: 10).frame(width: 192, height: 44)
            Capsule().frame(width: 256, height: 14)
            Capsule().frame(width: 192, height: 16)
            Capsule().frame(height: 14).padding(.top, 16)
            HStack {
                Capsule().frame(width: 112, height: 12)
                Spacer()
                Capsule().frame(width: 96, height: 12)
            }
        }
        .foregroundStyle(Color.fill4)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Loading")
    }
}
