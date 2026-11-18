import Foundation

/// Dates in the app's voice (design § 8): English words, Romania-style order, weeks
/// start on Monday.
///
/// The API sends calendar days as "YYYY-MM-DD" (`occurredOn`, `nextDueOn`,
/// `household.today`). They are *days*, not instants, so every helper here works on
/// plain calendar days with integer math and never involves a time zone. "Today" should
/// come from `household.today` (the household's time zone); `Day.localToday()` is the
/// fallback.
///
///     Day.relative("2026-11-18", today: "2026-11-18")  → "Today"   ("Yesterday", "Tomorrow", else "Mon 16 Nov")
///     Day.short("2026-11-16")                          → "Mon 16 Nov"
///     Day.header("2026-11-18", today: …)               → ("Today", "Wed 18 Nov")
///     Day.long("2026-11-18")                           → "Wednesday, 18 November"
///     Day.due("2026-11-21", today: …)                  → "In 3 days · Sat 21 Nov"
///     Day.medium("2026-11-17")                         → "17 Nov 2026"
public enum Day {
    public static let weekdaysShort = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    public static let weekdaysLong = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
    public static let monthsShort = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    public static let monthsLong = ["January", "February", "March", "April", "May", "June", "July", "August",
                                    "September", "October", "November", "December"]
    /// "Mon"…"Sun", Monday first (chart labels).
    public static let weekdayLabelsMondayFirst = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

    public struct YMD: Sendable, Equatable {
        public var y: Int
        public var m: Int
        public var d: Int
    }

    public static func parse(_ day: String) -> YMD {
        let parts = day.prefix(10).split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return YMD(y: 1970, m: 1, d: 1) }
        return YMD(y: parts[0], m: parts[1], d: parts[2])
    }

    public static func string(_ y: Int, _ m: Int, _ d: Int) -> String {
        String(format: "%04d-%02d-%02d", y, m, d)
    }

    /// Days since 1970-01-01 (Howard Hinnant's days_from_civil).
    public static func number(_ day: String) -> Int {
        let p = parse(day)
        let y = p.m <= 2 ? p.y - 1 : p.y
        let era = (y >= 0 ? y : y - 399) / 400
        let yoe = y - era * 400
        let mp = (p.m + 9) % 12
        let doy = (153 * mp + 2) / 5 + p.d - 1
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
        return era * 146_097 + doe - 719_468
    }

    public static func fromNumber(_ n: Int) -> String {
        let z = n + 719_468
        let era = (z >= 0 ? z : z - 146_096) / 146_097
        let doe = z - era * 146_097
        let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
        let mp = (5 * doy + 2) / 153
        let d = doy - (153 * mp + 2) / 5 + 1
        let m = mp < 10 ? mp + 3 : mp - 9
        let y = yoe + era * 400 + (m <= 2 ? 1 : 0)
        return string(y, m, d)
    }

    /// 0 = Sunday … 6 = Saturday
    public static func weekday(_ day: String) -> Int {
        ((number(day) % 7) + 7 + 4) % 7
    }

    /// 0 = Monday … 6 = Sunday
    public static func weekdayMondayFirst(_ day: String) -> Int {
        (weekday(day) + 6) % 7
    }

    /// Today on this device. Prefer `household.today` from the API.
    public static func localToday(_ now: Date = Date(), calendar: Calendar = .current) -> String {
        let c = calendar.dateComponents([.year, .month, .day], from: now)
        return string(c.year ?? 1970, c.month ?? 1, c.day ?? 1)
    }

    /// b − a in whole days.
    public static func between(_ a: String, _ b: String) -> Int {
        number(b) - number(a)
    }

    public static func add(_ day: String, _ n: Int) -> String {
        fromNumber(number(day) + n)
    }

    /// The Monday on or before `day`.
    public static func startOfWeek(_ day: String) -> String {
        add(day, -weekdayMondayFirst(day))
    }

    /// "2026-11-18" → "2026-11"
    public static func monthOf(_ day: String) -> String {
        String(day.prefix(7))
    }

    /// "2026-11" + n months → "2027-01"
    public static func addMonths(_ month: String, _ n: Int) -> String {
        let p = month.split(separator: "-").compactMap { Int($0) }
        guard p.count >= 2 else { return month }
        let index = p[0] * 12 + (p[1] - 1) + n
        let y = Int((Double(index) / 12).rounded(.down))
        let m = index - y * 12 + 1
        return String(format: "%04d-%02d", y, m)
    }

    /// "Mon 16 Nov" (adds the year when it differs from `today`'s: "Mon 16 Nov 2025").
    public static func short(_ day: String, today: String? = nil) -> String {
        let p = parse(day)
        let base = "\(weekdaysShort[weekday(day)]) \(p.d) \(monthsShort[p.m - 1])"
        if let today, parse(today).y != p.y { return "\(base) \(p.y)" }
        return base
    }

    /// "Today", "Yesterday", "Tomorrow", else "Mon 16 Nov".
    public static func relative(_ day: String, today: String) -> String {
        switch between(today, day) {
        case 0: "Today"
        case -1: "Yesterday"
        case 1: "Tomorrow"
        default: short(day, today: today)
        }
    }

    /// "Wednesday, 18 November"
    public static func long(_ day: String) -> String {
        let p = parse(day)
        return "\(weekdaysLong[weekday(day)]), \(p.d) \(monthsLong[p.m - 1])"
    }

    /// Activity day group header: ("Today", "Wed 18 Nov"), ("Monday, 16 November", nil).
    public static func header(_ day: String, today: String) -> (title: String, detail: String?) {
        switch between(today, day) {
        case 0: return ("Today", short(day))
        case -1: return ("Yesterday", short(day))
        default:
            let long = long(day)
            return (parse(day).y == parse(today).y ? long : "\(long) \(parse(day).y)", nil)
        }
    }

    /// When something is due. `relative` is set within the next 7 days and for overdue
    /// days; it's the emphasized part in the design.
    public static func dueParts(_ day: String, today: String) -> (relative: String?, date: String) {
        let diff = between(today, day)
        let date = short(day, today: today)
        let relative: String? = switch diff {
        case 0: "Today"
        case 1: "Tomorrow"
        case 2...7: "In \(diff) days"
        case -1: "Yesterday"
        case ..<(-1): "\(-diff) days ago"
        default: nil
        }
        return (relative, date)
    }

    /// "In 3 days · Sat 21 Nov", "Tomorrow · Thu 19 Nov", "Tue 1 Dec"
    public static func due(_ day: String, today: String) -> String {
        let p = dueParts(day, today: today)
        return p.relative.map { "\($0) · \(p.date)" } ?? p.date
    }

    /// "17 Nov 2026"
    public static func medium(_ day: String) -> String {
        let p = parse(day)
        return "\(p.d) \(monthsShort[p.m - 1]) \(p.y)"
    }

    /// "18 Oct"
    public static func dayMonth(_ day: String) -> String {
        let p = parse(day)
        return "\(p.d) \(monthsShort[p.m - 1])"
    }

    /// "2026-11" or a day → "November"
    public static func monthName(_ monthOrDay: String) -> String {
        let p = monthOrDay.split(separator: "-").compactMap { Int($0) }
        guard p.count >= 2, (1...12).contains(p[1]) else { return monthOrDay }
        return monthsLong[p[1] - 1]
    }

    /// "2026-11" → "Nov"
    public static func monthShort(_ monthOrDay: String) -> String {
        String(monthName(monthOrDay).prefix(3))
    }

    /// "2026-11" → "November 2026"
    public static func monthYear(_ monthOrDay: String) -> String {
        "\(monthName(monthOrDay)) \(monthOrDay.prefix(4))"
    }

    /// "November", or "November 2025" when it isn't `today`'s year.
    public static func monthLabel(_ month: String, today: String) -> String {
        month.prefix(4) == today.prefix(4) ? monthName(month) : monthYear(month)
    }

    /// "Saturday"
    public static func weekdayName(_ day: String) -> String {
        weekdaysLong[weekday(day)]
    }

    /// A timestamp → "17 Nov 2026, 21:14" in the given IANA zone (default: the device's).
    public static func dateTime(_ date: Date, timeZone: String? = nil) -> String {
        var calendar = Calendar(identifier: .gregorian)
        if let timeZone, let tz = TimeZone(identifier: timeZone) { calendar.timeZone = tz }
        let c = calendar.dateComponents([.year, .month, .day, .hour, .minute], from: date)
        return String(format: "%d %@ %d, %02d:%02d", c.day ?? 1, monthsShort[(c.month ?? 1) - 1], c.year ?? 1970, c.hour ?? 0, c.minute ?? 0)
    }

    /// "2026-11-18" → a Date at noon UTC, for date pickers (never shifts a day).
    public static func date(_ day: String) -> Date {
        Date(timeIntervalSince1970: TimeInterval(number(day)) * 86_400 + 43_200)
    }

    /// A date picker's Date → "YYYY-MM-DD" in the calendar it was picked in.
    public static func fromDate(_ date: Date, calendar: Calendar = .current) -> String {
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        return string(c.year ?? 1970, c.month ?? 1, c.day ?? 1)
    }

    /// True for "YYYY-MM-DD".
    public static func isValid(_ day: String) -> Bool {
        day.count == 10 && day.wholeMatch(of: /\d{4}-\d{2}-\d{2}/) != nil
    }
}
