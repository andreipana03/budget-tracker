import BudgetTrackerCore
import Foundation

/// Insights copy and chart shaping (design § 6.14, § 8): facts only, no judgment, no
/// exclamation marks. The same sentences as web/src/features/insights/insights-text.ts.
enum InsightsText {
    static let periods: [(InsightsPeriod, String)] = [(.week, "Week"), (.month, "Month"), (.sixMonths, "6 Months"), (.year, "Year")]

    /// "You’ve spent 8% less than at this point in October."
    static func headline(_ i: Insights, _ f: MoneyFormatter) -> String {
        Copy.insightsHeadline(isWeek: i.period == .week, currentMinor: i.headline.currentMinor,
                              previousMinor: i.headline.previousMinor, changeRatio: i.headline.changeRatio,
                              comparedTo: i.headline.comparedTo, currency: i.homeCurrency, f)
    }

    /// First day of the unit the headline measures (the week or budget month containing today).
    static func currentUnitStart(_ i: Insights) -> String {
        if i.period == .week || i.period == .month { return i.startsOn }
        return i.bars.first(where: \.isCurrent)?.startsOn ?? i.startsOn
    }

    /// 6 Months / Year: "On pace for about 1.970 lei · your average month is 1.987 lei".
    /// Otherwise: "1.234 lei so far · 1.342 lei by 18 Oct".
    static func supportingLine(_ i: Insights, today: String, _ f: MoneyFormatter) -> String {
        let whole = { (m: Int64) in f.money(m, i.homeCurrency, whole: true) }
        if i.period == .sixMonths || i.period == .year {
            var parts: [String] = []
            if let projected = i.bars.first(where: \.isCurrent)?.projectedMinor { parts.append("On pace for about \(whole(projected))") }
            if let avg = i.averageMinor { parts.append("\(parts.isEmpty ? "Your" : "your") average month is \(whole(avg))") }
            if !parts.isEmpty { return parts.joined(separator: " · ") }
        }
        var parts = ["\(whole(i.headline.currentMinor)) so far"]
        if let previous = i.headline.previousMinor {
            let offset = max(0, Day.between(currentUnitStart(i), today))
            parts.append("\(whole(previous)) by \(Day.dayMonth(Day.add(i.headline.comparedTo, offset)))")
        }
        return parts.joined(separator: " · ")
    }

    /// week → "Mon"…"Sun" · month → "1"…"30" · six_months → "Jun"…"Nov" · year → "J F M…" when compact.
    static func bars(_ i: Insights, compact: Bool) -> [SpendingChart.Bar] {
        i.bars.enumerated().map { index, b in
            let label: String
            let name: String
            switch i.period {
            case .week:
                label = Day.weekdayLabelsMondayFirst[Day.weekdayMondayFirst(b.startsOn)]
                name = Day.long(b.startsOn)
            case .month:
                label = String(Day.parse(b.startsOn).d)
                name = Day.dayMonth(b.startsOn)
            case .sixMonths:
                label = Day.monthShort(b.startsOn)
                name = Day.monthYear(b.startsOn)
            case .year:
                label = compact ? String(Day.monthShort(b.startsOn).prefix(1)) : Day.monthShort(b.startsOn)
                name = Day.monthYear(b.startsOn)
            }
            return SpendingChart.Bar(id: index, label: label, name: name, spentMinor: b.spentMinor, current: b.isCurrent,
                                     projectedMinor: b.isCurrent ? b.projectedMinor : nil)
        }
    }

    /// Opening of the chart's VoiceOver sentence.
    static func chartDescription(_ i: Insights) -> String {
        guard let first = i.bars.first?.startsOn, let last = i.bars.last?.startsOn else { return "Spending." }
        switch i.period {
        case .week: return "Daily spending, week of \(Day.dayMonth(first))."
        case .month: return "Daily spending, \(Day.dayMonth(first)) to \(Day.dayMonth(last))."
        default:
            let firstYear = first.prefix(4) != last.prefix(4) ? " \(first.prefix(4))" : ""
            return "Monthly spending, \(Day.monthName(first))\(firstYear) to \(Day.monthYear(last))."
        }
    }

    /// "327,50 lei so far, against 248 lei by this point last month."
    static func changeBody(_ i: Insights, _ c: BiggestChange, _ f: MoneyFormatter) -> String {
        let unit = i.period == .week ? "last week" : "last month"
        return "\(f.money(c.currentMinor, i.homeCurrency)) so far, against \(f.money(c.previousMinor, i.homeCurrency, whole: true)) by this point \(unit)."
    }

    /// "Friday, 13 November" (with the year when it isn't this year).
    static func biggestDayTitle(_ d: BiggestDay, today: String) -> String {
        let base = Day.long(d.date)
        return d.date.prefix(4) == today.prefix(4) ? base : "\(base) \(d.date.prefix(4))"
    }

    /// "214,60 lei, mostly Shopping and Eating Out."
    static func biggestDayBody(_ d: BiggestDay, currency: String, _ f: MoneyFormatter) -> String {
        let amount = f.money(d.spentMinor, currency)
        let names = d.topCategories.map(\.name)
        return names.isEmpty ? "\(amount)." : "\(amount), mostly \(names.joined(separator: " and "))."
    }

    /// "≈ 162,87 lei a month"
    static func subscriptionsTitle(_ s: SubscriptionsHighlight, currency: String, _ f: MoneyFormatter) -> String {
        "\(f.money(s.perMonthMinor, currency, approx: s.isApproximate)) a month"
    }

    /// "6 active · Netflix renews on Saturday."
    static func subscriptionsBody(_ s: SubscriptionsHighlight, today: String) -> String {
        var parts = ["\(s.activeCount) active"]
        if let next = s.next {
            parts.append("\(next.title) \(next.kind == .income ? "arrives" : "renews") \(Copy.renewsWhen(next.nextDueOn, today: today))")
        }
        return parts.joined(separator: " · ") + "."
    }

    /// Nothing to show yet: no spending in the range at all.
    static func isEmpty(_ i: Insights) -> Bool {
        i.byCategory.isEmpty && i.bars.allSatisfy { $0.spentMinor == 0 }
    }

    /// The Share text: the headline plus the supporting numbers.
    static func share(_ i: Insights, today: String, _ f: MoneyFormatter) -> String {
        let label = periods.first { $0.0 == i.period }?.1 ?? ""
        return ["Budget Tracker · \(label)", headline(i, f), supportingLine(i, today: today, f)].joined(separator: "\n")
    }
}
