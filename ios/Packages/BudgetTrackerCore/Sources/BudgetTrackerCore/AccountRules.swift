import Foundation

/// The password policy, mirrored from the API (backend/internal/auth/rules.go) so the
/// checklist ticks off as people type. The API stays the judge: it re-checks on submit.
public enum PasswordRules {
    public static let minLength = 8
    public static let maxLength = 128

    public struct Rule: Sendable, Equatable, Identifiable {
        public var id: String
        /// Sentence case, reads as a requirement: "An uppercase letter".
        public var label: String
        public var met: Bool
    }

    /// True when the password matches the username, the email or the email's local part.
    public static func sameAsIdentity(_ password: String, username: String?, email: String?) -> Bool {
        let p = password.trimmingCharacters(in: .whitespaces).lowercased()
        guard !p.isEmpty else { return false }
        if let u = username?.trimmingCharacters(in: .whitespaces).lowercased(), !u.isEmpty, p == u { return true }
        if let e = email?.trimmingCharacters(in: .whitespaces).lowercased(), !e.isEmpty {
            let local = e.split(separator: "@").first.map(String.init) ?? ""
            if p == e || (!local.isEmpty && p == local) { return true }
        }
        return false
    }

    /// Every rule and whether `password` meets it. Pass the identity to include
    /// "Different from your username and email".
    public static func rules(_ password: String, username: String? = nil, email: String? = nil, checkIdentity: Bool = true) -> [Rule] {
        var upper = false, lower = false, digit = false, symbol = false
        for scalar in password.unicodeScalars {
            // Same order as the API: a character counts once; spaces never count as a symbol.
            switch scalar.properties.generalCategory {
            case .uppercaseLetter: upper = true
            case .lowercaseLetter: lower = true
            case .decimalNumber: digit = true
            default: if !scalar.properties.isWhitespace { symbol = true }
            }
        }
        let count = password.unicodeScalars.count
        var list = [
            Rule(id: "length", label: "\(minLength) to \(maxLength) characters", met: count >= minLength && count <= maxLength),
            Rule(id: "uppercase", label: "An uppercase letter", met: upper),
            Rule(id: "lowercase", label: "A lowercase letter", met: lower),
            Rule(id: "digit", label: "A number", met: digit),
            Rule(id: "symbol", label: "A symbol, like ! or #", met: symbol),
        ]
        if checkIdentity {
            list.append(Rule(id: "different", label: "Different from your username and email",
                             met: !password.isEmpty && !sameAsIdentity(password, username: username, email: email)))
        }
        return list
    }

    public static func isAcceptable(_ password: String, username: String? = nil, email: String? = nil, checkIdentity: Bool = true) -> Bool {
        rules(password, username: username, email: email, checkIdentity: checkIdentity).allSatisfy(\.met)
    }
}

/// Same rule as the API: 3–30 of a–z 0–9 . _ - (compared lowercased).
public enum UsernameRules {
    public static func isValid(_ username: String) -> Bool {
        username.wholeMatch(of: /[a-z0-9._-]{3,30}/) != nil
    }

    /// What people type → what gets stored: lowercase, no spaces.
    public static func normalize(_ value: String) -> String {
        value.lowercased().filter { !$0.isWhitespace }
    }

    /// Still typing the first characters: don't nag yet.
    public static func isTooEarlyToJudge(_ value: String) -> Bool {
        value.count < 3 && value.wholeMatch(of: /[a-z0-9._-]*/) != nil
    }

    public static let invalidMessage = "Use 3–30 letters, numbers, dots, dashes or underscores."
    public static let takenMessage = "This username is taken. Try another one."
    public static let reservedMessage = "This username isn’t available. Try another one."

    public static func isEmailShaped(_ email: String) -> Bool {
        email.trimmingCharacters(in: .whitespaces).wholeMatch(of: /[^\s@]+@[^\s@]+\.[^\s@]+/) != nil
    }
}

/// RFC 9562 UUIDv7: 48-bit Unix milliseconds, version 7, variant 10, 74 random bits.
/// The API expects client-made ids to be v7 (sortable by creation time), and a create
/// sent twice with the same id is idempotent, so a form makes one id and reuses it on
/// retries.
public enum UUIDv7 {
    public static func make(now: Date = Date()) -> String {
        var bytes = [UInt8](repeating: 0, count: 16)
        var ts = UInt64(max(0, (now.timeIntervalSince1970 * 1000).rounded(.down)))
        for i in stride(from: 5, through: 0, by: -1) {
            bytes[i] = UInt8(ts & 0xFF)
            ts >>= 8
        }
        var rng = SystemRandomNumberGenerator()
        for i in 6..<16 { bytes[i] = UInt8.random(in: 0...255, using: &rng) }
        bytes[6] = 0x70 | (bytes[6] & 0x0F)
        bytes[8] = 0x80 | (bytes[8] & 0x3F)
        let hex = bytes.map { String(format: "%02x", $0) }.joined()
        let h = Array(hex)
        return [String(h[0..<8]), String(h[8..<12]), String(h[12..<16]), String(h[16..<20]), String(h[20..<32])].joined(separator: "-")
    }

    /// The millisecond timestamp inside a UUIDv7.
    public static func milliseconds(_ id: String) -> UInt64 {
        UInt64(id.replacingOccurrences(of: "-", with: "").prefix(12), radix: 16) ?? 0
    }
}
