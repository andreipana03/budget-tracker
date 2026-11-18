import Foundation
import Synchronization

/// Region → number-format locale. The UI language is always English; numbers and
/// currencies follow the person's *region* (`User.region`, design § 1, § 6.7), like
/// iOS Settings › Language & Region: "RO" → ro_RO → "1.234,29 lei".
public enum Region {
    public static let fallback = "RO"

    /// The device's region ("US" for en_US), or "RO" when it can't be read.
    public static var device: String {
        Locale.current.region?.identifier ?? fallback
    }

    private static let cache = Mutex<[String: Locale]>([:])

    /// "RO" → ro_RO, "DE" → de_DE, "US" → en_US. Empty or nil → the device's region.
    public static func locale(for region: String?) -> Locale {
        let key = ((region?.isEmpty == false) ? region! : device).uppercased()
        if let cached = cache.withLock({ $0[key] }) { return cached }
        let maximal = Locale.Language(identifier: "und-\(key)").maximalIdentifier
        let language = Locale.Language(identifier: maximal).languageCode?.identifier
        let locale: Locale
        if let language, language != "und", key.count == 2 {
            locale = Locale(identifier: "\(language)_\(key)")
        } else {
            locale = Locale(identifier: "ro_RO")
        }
        cache.withLock { $0[key] = locale }
        return locale
    }

    /// "RO" → "Romania" (English names, the app's language).
    public static func name(_ code: String) -> String {
        Locale(identifier: "en_US").localizedString(forRegionCode: code) ?? code
    }

    /// Regions offered for number formatting (ISO 3166). The person's own is added if missing.
    public static let formatRegions = ["RO", "MD", "DE", "FR", "IT", "ES", "NL", "AT", "CH", "GB", "IE", "US"]

    public static func options(current: String?) -> [(code: String, name: String)] {
        var codes = formatRegions
        if let current, !current.isEmpty, !codes.contains(current) { codes.insert(current, at: 0) }
        return codes.map { ($0, name($0)) }.sorted { $0.name < $1.name }
    }
}

extension String {
    /// Formatter output uses no-break spaces (U+00A0, U+202F); the app shows plain spaces.
    var normalizingSpaces: String {
        replacingOccurrences(of: "\u{00A0}", with: " ").replacingOccurrences(of: "\u{202F}", with: " ")
    }
}
