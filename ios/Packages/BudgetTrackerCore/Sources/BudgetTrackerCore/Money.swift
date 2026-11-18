import Foundation
import Synchronization

/// Digits after the decimal point per currency, exactly as the API stores amounts
/// (`currencies.minor_units`). This must come from the API, not from the system: CLDR
/// says the Serbian dinar has 0 decimals while the database keeps 2. Seeded with the
/// database's currencies; `register` adds whatever GET /currencies returns.
public enum Currencies {
    private static let known = Mutex<[String: Int]>(
        Dictionary(uniqueKeysWithValues:
            ["RON", "EUR", "USD", "GBP", "CHF", "HUF", "PLN", "CZK", "MDL", "RSD", "UAH", "TRY", "SEK", "NOK", "DKK", "CAD", "AUD", "CNY"]
                .map { ($0, 2) } + [("JPY", 0)])
    )

    public static func register(_ currencies: [(code: String, minorUnits: Int)]) {
        known.withLock { map in
            for c in currencies { map[c.code] = c.minorUnits }
        }
    }

    /// RON 2, EUR 2, JPY 0. Unknown currencies: 2 until the API says otherwise.
    public static func minorUnits(_ currency: String) -> Int {
        known.withLock { $0[currency] } ?? 2
    }
}

/// Money split into the pieces the hero layouts style separately.
public struct MoneyParts: Sendable, Equatable {
    /// "", "+" or "−"
    public var sign: String
    /// "≈ " or ""
    public var approx: String
    /// "1.234"
    public var integer: String
    /// "," or "" for whole amounts and zero-decimal currencies
    public var decimalSeparator: String
    /// "29" or ""
    public var fraction: String
    /// "lei", "€"
    public var symbol: String
    /// "$1.00" → true; "1,00 €" → false
    public var symbolBefore: Bool
    /// The whole string, same as `MoneyFormatter.money`.
    public var text: String
}

/// Money formatting (design § 6.7, § 8). Amounts arrive as integer minor units + an
/// ISO currency code and are never turned into floating point: they become a `Decimal`
/// exactly and are formatted in the region's locale.
///
///     let f = MoneyFormatter(region: "RO")
///     f.money(123429, "RON")                    // "1.234,29 lei"
///     f.money(999, "EUR")                       // "9,99 €"
///     f.money(85000, "RON", income: true)       // "+850,00 lei"
///     f.money(200000, "RON", whole: true)       // "2.000 lei"
///     f.money(388230, "RON", approx: true)      // "≈ 3.882,30 lei"
///     f.over(2750, "RON")                       // "27,50 lei over"
///
/// Expenses never get a minus sign (Apple Wallet convention); a genuinely negative value
/// (an overdrawn account) gets U+2212 "−". Spaces are plain U+0020.
public struct MoneyFormatter: Sendable, Equatable {
    public let region: String
    public let locale: Locale

    public init(region: String?) {
        let r = (region?.isEmpty == false) ? region!.uppercased() : Region.device
        self.region = r
        self.locale = Region.locale(for: r)
    }

    // MARK: Money

    public func parts(_ minor: Int64, _ currency: String, income: Bool = false, whole: Bool = false, approx: Bool = false) -> MoneyParts {
        let digits = whole ? 0 : Currencies.minorUnits(currency)
        let value: Int64 = whole ? MoneyFormatter.roundToWhole(minor, currency) : minor
        let style = Decimal.FormatStyle.Currency(code: currency, locale: locale)
            .presentation(.narrow)
            .precision(.fractionLength(digits))
        let body = MoneyFormatter.decimal(value.magnitude, digits: digits).formatted(style).normalizingSpaces

        // Split "1.234,29 lei" / "$1,234.29" into prefix · number · suffix around the digits.
        let chars = Array(body)
        let first = chars.firstIndex(where: \.isNumber) ?? 0
        let last = chars.lastIndex(where: \.isNumber) ?? max(chars.count - 1, 0)
        let prefix = String(chars[..<first]).trimmingCharacters(in: .whitespaces)
        let suffix = last + 1 < chars.count ? String(chars[(last + 1)...]).trimmingCharacters(in: .whitespaces) : ""
        let number = first <= last && !chars.isEmpty ? Array(chars[first...last]) : []
        var integer = String(number)
        var separator = ""
        var fraction = ""
        if digits > 0, number.count > digits + 1 {
            fraction = String(number.suffix(digits))
            separator = String(number[number.count - digits - 1])
            integer = String(number.prefix(number.count - digits - 1))
        }
        let sign = value < 0 ? "−" : (income && value != 0 ? "+" : "")
        let approxText = approx ? "≈ " : ""
        return MoneyParts(
            sign: sign,
            approx: approxText,
            integer: integer,
            decimalSeparator: separator,
            fraction: fraction,
            symbol: prefix.isEmpty ? suffix : prefix,
            symbolBefore: !prefix.isEmpty,
            text: approxText + sign + body
        )
    }

    /// "1.234,29 lei" — see the type's comment for the options.
    public func money(_ minor: Int64, _ currency: String, income: Bool = false, whole: Bool = false, approx: Bool = false) -> String {
        parts(minor, currency, income: income, whole: whole, approx: approx).text
    }

    /// "27,50 lei over": always the absolute amount; pair it with red and an icon.
    public func over(_ minor: Int64, _ currency: String, whole: Bool = false) -> String {
        "\(money(Int64(minor.magnitude), currency, whole: whole)) over"
    }

    /// An amount without its currency, for "327,50 of 300 lei" or legend values "246".
    public func number(_ minor: Int64, _ currency: String, whole: Bool = false) -> String {
        let digits = whole ? 0 : Currencies.minorUnits(currency)
        let value = whole ? MoneyFormatter.roundToWhole(minor, currency) : minor
        let s = MoneyFormatter.decimal(value.magnitude, digits: digits)
            .formatted(Decimal.FormatStyle(locale: locale).precision(.fractionLength(digits)))
            .normalizingSpaces
        return (value < 0 ? "−" : "") + s
    }

    /// A plain integer in the region's grouping: 1987 → "1.987" (chart axes, "Avg 1.987").
    public func integer(_ value: Int64) -> String {
        let s = Decimal(value.magnitude).formatted(Decimal.FormatStyle(locale: locale).precision(.fractionLength(0)))
        return (value < 0 ? "−" : "") + s.normalizingSpaces
    }

    /// The currency's short symbol in this region: RON → "lei", EUR → "€".
    public func symbol(_ currency: String) -> String {
        let s = parts(0, currency).symbol
        return s.isEmpty ? currency : s
    }

    /// The decimal separator people expect in this region ("," for RO).
    public var decimalSeparator: String {
        let s = Decimal(string: "1.5")!.formatted(Decimal.FormatStyle(locale: locale).precision(.fractionLength(1)))
        return s.first(where: { !$0.isNumber }).map(String.init) ?? ","
    }

    /// The grouping separator ("." for RO, "," for US; spaces are plain).
    public var groupingSeparator: String {
        let s = Decimal(10000).formatted(Decimal.FormatStyle(locale: locale).grouping(.automatic)).normalizingSpaces
        return s.first(where: { !$0.isNumber }).map(String.init) ?? "."
    }

    // MARK: Helpers

    /// 0.27 → "27%" (rounded to a whole percent).
    public static func percent(_ ratio: Double) -> String {
        "\(Int((ratio * 100).rounded()))%"
    }

    /// Minor units → whole major units, rounded half away from zero (integer math).
    public static func roundToWhole(_ minor: Int64, _ currency: String) -> Int64 {
        let factor = pow10(Currencies.minorUnits(currency))
        let whole = (Int64(minor.magnitude) + factor / 2) / factor
        return minor < 0 ? -whole : whole
    }

    static func pow10(_ n: Int) -> Int64 {
        var r: Int64 = 1
        for _ in 0..<max(n, 0) { r *= 10 }
        return r
    }

    /// 123429, 2 → 1234.29 exactly.
    static func decimal(_ magnitude: UInt64, digits: Int) -> Decimal {
        Decimal(sign: .plus, exponent: -digits, significand: Decimal(magnitude))
    }
}
