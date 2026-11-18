import Foundation

/// The app's copy (design § 8) where it depends on numbers: facts, not judgment.
/// Same sentences as the web app, so both clients read the same.
public enum Copy {
    // MARK: Home

    /// "About 55 lei a day for the next 13 days" — whole units, singular on the last day.
    public static func perDay(_ perDayMinor: Int64, daysLeft: Int, currency: String, _ f: MoneyFormatter) -> String {
        if perDayMinor <= 0 {
            return daysLeft == 1
                ? "Nothing left for flexible spending today"
                : "Nothing left for flexible spending for the next \(daysLeft) days"
        }
        let amount = f.money(perDayMinor, currency, whole: true)
        return daysLeft == 1 ? "About \(amount) for today, the last day" : "About \(amount) a day for the next \(daysLeft) days"
    }

    // MARK: Subscriptions

    public enum Frequency: String, Sendable, CaseIterable {
        case weekly, monthly, yearly
    }

    /// "Monthly", "Weekly", "Yearly", "Every 2 weeks", "Every 3 months".
    public static func repeatText(_ frequency: Frequency, interval: Int = 1) -> String {
        if interval <= 1 {
            return switch frequency { case .weekly: "Weekly"; case .monthly: "Monthly"; case .yearly: "Yearly" }
        }
        return "Every \(interval) \(unit(frequency, plural: true))"
    }

    /// "1 month", "2 months"…
    public static func intervalLabel(_ frequency: Frequency, _ n: Int) -> String {
        "\(n) \(unit(frequency, plural: n != 1))"
    }

    /// Sensible maximum interval per frequency for the picker.
    public static func maxInterval(_ frequency: Frequency) -> Int {
        switch frequency { case .weekly: 8; case .monthly: 12; case .yearly: 5 }
    }

    private static func unit(_ f: Frequency, plural: Bool) -> String {
        let base = switch f { case .weekly: "week"; case .monthly: "month"; case .yearly: "year" }
        return plural ? base + "s" : base
    }

    /// When something repeats next: "today", "tomorrow", "on Saturday", "on 2 Dec".
    public static func renewsWhen(_ nextDueOn: String, today: String) -> String {
        let d = Day.between(today, nextDueOn)
        if d <= 0 { return "today" }
        if d == 1 { return "tomorrow" }
        if d < 7 { return "on \(Day.weekdayName(nextDueOn))" }
        return "on \(Day.dayMonth(nextDueOn))"
    }

    // MARK: Transactions

    /// The rate as people read it, from the API's decimal string, without floats:
    /// "4.9800000000" → "4,98"; "4.97731" → "4,9773" (2–4 decimals, region separator).
    public static func rate(_ rate: String, decimalSeparator: String = ",") -> String {
        let parts = rate.trimmingCharacters(in: .whitespaces).split(separator: ".", omittingEmptySubsequences: false)
        let int = parts.first.map(String.init) ?? "0"
        let frac = parts.count > 1 ? String(parts[1]) : ""
        guard !int.isEmpty, int.allSatisfy(\.isNumber), frac.allSatisfy(\.isNumber),
              let scaled5 = Int64(int + frac.padding(toLength: 5, withPad: "0", startingAt: 0))
        else { return rate }
        let scaled = (scaled5 + 5) / 10 // round half up to 4 decimals
        var s = String(scaled)
        if s.count < 5 { s = String(repeating: "0", count: 5 - s.count) + s }
        var f = String(s.suffix(4))
        while f.hasSuffix("0") { f.removeLast() }
        if f.count < 2 { f = f.padding(toLength: 2, withPad: "0", startingAt: 0) }
        return "\(s.dropLast(4))\(decimalSeparator)\(f)"
    }

    // MARK: Add sheet

    /// The live hint under the amount (design § 6.11, "the app's main moment of delight"):
    ///     "329,10 lei left in Groceries after this"
    ///     "This puts Eating Out 52,00 lei over"     (over = true → red)
    public static func hint(categoryName: String, limitMinor: Int64?, spentMinor: Int64, amountHomeMinor: Int64,
                            alreadyCountedMinor: Int64 = 0, homeCurrency: String, approx: Bool = false,
                            _ f: MoneyFormatter) -> (text: String, over: Bool)?
    {
        guard let limit = limitMinor else { return nil }
        let left = limit - (spentMinor - alreadyCountedMinor) - amountHomeMinor
        if left < 0 {
            return ("This puts \(categoryName) \(f.money(-left, homeCurrency, approx: approx)) over", true)
        }
        let leftText = f.money(left, homeCurrency, approx: approx)
        return (amountHomeMinor > 0 ? "\(leftText) left in \(categoryName) after this" : "\(leftText) left in \(categoryName)", false)
    }

    // MARK: Budgets

    public static let invalidAmount = "Enter an amount like 250 or 250,50."

    /// One limit field's text → minor units: `.some(nil)` for empty (no limit), `nil` when invalid.
    public static func parseLimit(_ text: String, _ currency: String) -> Int64?? {
        if text.trimmingCharacters(in: .whitespaces).isEmpty { return .some(nil) }
        guard let v = Amount.parse(text, currency) else { return nil }
        return .some(v)
    }

    public struct BudgetDiff: Sendable, Equatable {
        /// Changed categories only, in the order given; nil amount = remove the limit.
        public var items: [(categoryId: String, amountMinor: Int64?)]
        /// categoryId → message for fields that don't parse.
        public var errors: [String: String]
        /// Sum of every field that has a valid amount (the live total).
        public var totalMinor: Int64

        public static func == (a: BudgetDiff, b: BudgetDiff) -> Bool {
            a.errors == b.errors && a.totalMinor == b.totalMinor && a.items.count == b.items.count
                && zip(a.items, b.items).allSatisfy { $0.categoryId == $1.categoryId && $0.amountMinor == $1.amountMinor }
        }
    }

    /// Compare typed drafts with the current limits (Edit Budgets).
    public static func diffBudgets(limits: [String: Int64?], drafts: [String: String], currency: String, order: [String]) -> BudgetDiff {
        var diff = BudgetDiff(items: [], errors: [:], totalMinor: 0)
        for id in order {
            let before = limits[id] ?? nil
            guard let parsed = parseLimit(drafts[id] ?? "", currency) else {
                diff.errors[id] = invalidAmount
                if let before { diff.totalMinor += before }
                continue
            }
            if let p = parsed { diff.totalMinor += p }
            if parsed != before { diff.items.append((id, parsed)) }
        }
        return diff
    }

    // MARK: Settings

    /// Footer for "Month Starts On":
    ///   (10, "2026-11") → "With 10, the November budget runs 10 Nov – 9 Dec."
    ///   (1, "2026-11")  → "The November budget runs 1 – 30 Nov, like the calendar."
    public static func monthStartExample(day: Int, month: String) -> String {
        let name = Day.monthName(month)
        let short = Day.monthShort(month)
        if day <= 1 {
            let last = Day.add(Day.addMonths(month, 1) + "-01", -1)
            return "The \(name) budget runs 1 – \(Day.parse(last).d) \(short), like the calendar."
        }
        let next = Day.monthShort(Day.addMonths(month, 1))
        return "With \(day), the \(name) budget runs \(day) \(short) – \(day - 1) \(next)."
    }

    // MARK: Insights

    /// The chart headline: the takeaway in one sentence.
    ///   "You’ve spent 8% less than at this point in October."
    ///   "About the same as at this point last week."   (|change| < 1%)
    ///   "You’ve spent 1.234 lei so far."                (no previous data)
    public static func insightsHeadline(isWeek: Bool, currentMinor: Int64, previousMinor: Int64?, changeRatio: Double?,
                                        comparedTo: String, currency: String, _ f: MoneyFormatter) -> String
    {
        guard let changeRatio, previousMinor != nil else {
            return "You’ve spent \(f.money(currentMinor, currency, whole: true)) so far."
        }
        let point = "at this point \(isWeek ? "last week" : "in \(Day.monthName(comparedTo))")"
        if abs(changeRatio) < 0.01 { return "About the same as \(point)." }
        let pct = max(1, Int((abs(changeRatio) * 100).rounded()))
        return "You’ve spent \(pct)% \(changeRatio < 0 ? "less" : "more") than \(point)."
    }

    /// "Up 32% from October" / "Down 12% from last week"
    public static func changeTitle(isWeek: Bool, changeRatio: Double, comparedTo: String) -> String {
        let pct = max(1, Int((abs(changeRatio) * 100).rounded()))
        return "\(changeRatio < 0 ? "Down" : "Up") \(pct)% from \(isWeek ? "last week" : Day.monthName(comparedTo))"
    }
}
