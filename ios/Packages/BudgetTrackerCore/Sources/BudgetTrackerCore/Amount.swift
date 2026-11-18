import Foundation

/// Typed amounts ↔ integer minor units, by string handling only (never floating point).
///
///     Amount.parse("24,50", "RON")    → 2450
///     Amount.parse("24.5", "RON")     → 2450
///     Amount.parse("1.234,56", "RON") → 123456
///     Amount.parse("12,", "RON")      → 1200   (mid-typing)
///     Amount.parse("1,234", "RON")    → nil    (3 decimals; RON allows 2)
///     Amount.parse("500", "JPY")      → 500
///
/// Either "," or "." is the decimal separator: the last separator in the string is the
/// decimal one unless it appears more than once ("1.234.567" is grouping). Earlier
/// separators are grouping and must sit between groups of three digits.
public enum Amount {
    /// Keeps every result well inside Int64 and the API's 10^15 maximum.
    static let maxDigits = 15

    public static func parse(_ input: String, _ currency: String) -> Int64? {
        let digits = Currencies.minorUnits(currency)
        let s = input.filter { !$0.isWhitespace && $0 != "'" }
        guard !s.isEmpty, s.allSatisfy({ $0.isASCII && ($0.isNumber || $0 == "." || $0 == ",") }) else { return nil }

        var intPart = s
        var frac = ""
        if let lastSep = s.lastIndex(where: { $0 == "," || $0 == "." }) {
            let sepChar = s[lastSep]
            let other: Character = sepChar == "," ? "." : ","
            let groupingOnly = s.filter { $0 == sepChar }.count > 1 && !s.contains(other)
            if !groupingOnly {
                intPart = String(s[..<lastSep])
                frac = String(s[s.index(after: lastSep)...])
            }
        }
        if frac.contains(where: { $0 == "," || $0 == "." }) { return nil }
        if intPart.contains(where: { $0 == "," || $0 == "." }) {
            guard isGrouped(intPart) else { return nil }
            intPart.removeAll { $0 == "," || $0 == "." }
        }
        if frac.count > digits { return nil }
        if intPart.isEmpty && frac.isEmpty { return nil }

        var all = (intPart.isEmpty ? "0" : intPart) + frac.padding(toLength: digits, withPad: "0", startingAt: 0)
        while all.count > 1 && all.first == "0" { all.removeFirst() }
        guard all.count <= maxDigits else { return nil }
        return Int64(all)
    }

    /// "1.234" / "1,234,567": 1–3 digits, then groups of exactly three.
    private static func isGrouped(_ s: String) -> Bool {
        let groups = s.split(separator: ".", omittingEmptySubsequences: false)
            .flatMap { $0.split(separator: ",", omittingEmptySubsequences: false) }
        guard let first = groups.first, (1...3).contains(first.count) else { return false }
        return groups.dropFirst().allSatisfy { $0.count == 3 }
    }

    /// Minor units → the text to put back in an amount field, with the region's decimal
    /// separator and no grouping: 2450 → "24,50" (RO). A trailing ",00" is dropped: 2400 → "24".
    public static func inputText(_ minor: Int64, _ currency: String, decimalSeparator: String) -> String {
        let digits = Currencies.minorUnits(currency)
        let raw = String(minor.magnitude)
        guard digits > 0 else { return raw }
        let padded = String(repeating: "0", count: max(0, digits + 1 - raw.count)) + raw
        let i = String(padded.dropLast(digits))
        let f = String(padded.suffix(digits))
        return f.allSatisfy { $0 == "0" } ? i : "\(i)\(decimalSeparator)\(f)"
    }

    /// Whole-unit digits allowed while typing (9.999.999.999 is plenty for a student budget).
    static let maxIntegerDigits = 10

    /// Live clean-up of what people type in the Add sheet:
    ///
    ///     sanitize("24.5", "RON", ",")   → "24,5"   (either separator, shown the region's way)
    ///     sanitize("24,567", "RON", ",") → "24,56"  (max decimals = the currency's minor units)
    ///     sanitize("1.500", "JPY", ",")  → "1500"   (no minor units → separators are grouping)
    ///     sanitize("007", "RON", ",")    → "7"
    public static func sanitize(_ raw: String, _ currency: String, decimalSeparator: String) -> String {
        let digits = Currencies.minorUnits(currency)
        let cleaned = raw.filter { $0.isASCII && ($0.isNumber || (digits > 0 && ($0 == "." || $0 == ","))) }
        var int: Substring
        var frac: String?
        if let sep = cleaned.firstIndex(where: { $0 == "." || $0 == "," }) {
            int = cleaned[..<sep]
            frac = cleaned[cleaned.index(after: sep)...].filter { $0 != "." && $0 != "," }
        } else {
            int = cleaned[...]
        }
        var intText = String(int)
        while intText.count > 1 && intText.first == "0" { intText.removeFirst() }
        intText = String(intText.prefix(maxIntegerDigits))
        if var f = frac {
            f = String(f.prefix(digits))
            if intText.isEmpty { intText = "0" }
            return "\(intText)\(decimalSeparator)\(f)"
        }
        return intText
    }

    /// The typed text → minor units (0 while empty or incomplete).
    public static func minor(fromInput text: String, _ currency: String) -> Int64 {
        text.isEmpty ? 0 : (parse(text, currency) ?? 0)
    }

    /// Split typed text for display: integer part with the region's grouping ("1.234"),
    /// the separator and the decimals typed so far.
    public static func displayParts(_ text: String, decimalSeparator: String, groupingSeparator: String)
        -> (integer: String, separator: String, fraction: String)
    {
        let int: String
        let fraction: String
        let hasSep: Bool
        if let r = text.range(of: decimalSeparator) {
            int = String(text[..<r.lowerBound])
            fraction = String(text[r.upperBound...])
            hasSep = true
        } else {
            int = text
            fraction = ""
            hasSep = false
        }
        var grouped = ""
        for (i, c) in int.reversed().enumerated() {
            if i > 0 && i % 3 == 0 { grouped.insert(contentsOf: groupingSeparator, at: grouped.startIndex) }
            grouped.insert(c, at: grouped.startIndex)
        }
        return (grouped, hasSep ? decimalSeparator : "", fraction)
    }

    /// A typed opening balance → signed minor units. Empty is 0; a leading "-" or "−"
    /// makes it negative (credit cards). nil when it isn't an amount.
    public static func parseSigned(_ input: String, _ currency: String) -> Int64? {
        let s = input.trimmingCharacters(in: .whitespaces)
        if s.isEmpty { return 0 }
        let negative = s.hasPrefix("-") || s.hasPrefix("−")
        let rest = negative ? String(s.dropFirst()).trimmingCharacters(in: .whitespaces) : s
        if rest.isEmpty { return 0 }
        guard let minor = parse(rest, currency) else { return nil }
        return negative && minor != 0 ? -minor : minor
    }

    /// Signed minor units → the field's text ("−" kept as "-" so it can be edited).
    public static func signedInputText(_ minor: Int64, _ currency: String, decimalSeparator: String) -> String {
        if minor == 0 { return "" }
        let text = inputText(Int64(minor.magnitude), currency, decimalSeparator: decimalSeparator)
        return minor < 0 ? "-\(text)" : text
    }
}
