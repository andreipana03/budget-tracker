import SwiftUI

/// Category hues (design § 4.1, § 12). The API stores a category's color as a hue name;
/// each hue has a mark color (bars, chart marks; adapts to dark) and a tile color (the
/// same in both appearances, like Settings icons). Color is identity, never status:
/// a category is never tinted red because it's over.
enum Hue {
    static func mark(_ color: CategoryColor?) -> Color {
        switch color ?? .gray {
        case .mint: .dynamic(light: 0x00C7BE, dark: 0x63E6E2)
        case .orange: .dynamic(light: 0xFF9500, dark: 0xFF9F0A)
        case .indigo: .dynamic(light: 0x5856D6, dark: 0x5E5CE6)
        case .cyan: .dynamic(light: 0x32ADE6, dark: 0x64D2FF)
        case .purple: .dynamic(light: 0xAF52DE, dark: 0xBF5AF2)
        case .pink: .dynamic(light: 0xFF2D55, dark: 0xFF375F)
        case .brown: .dynamic(light: 0xA2845E, dark: 0xAC8E68)
        case .gray: .dynamic(light: 0x8E8E93, dark: 0x98989D)
        case .teal: .dynamic(light: 0x30B0C7, dark: 0x40CBE0)
        case .yellow: .dynamic(light: 0xFFCC00, dark: 0xFFD60A)
        case .green: .dynamic(light: 0x34C759, dark: 0x30D158)
        }
    }

    static func tile(_ color: CategoryColor?) -> Color {
        switch color ?? .gray {
        case .mint: Color(hex: 0x00C7BE)
        case .orange: Color(hex: 0xFF9500)
        case .indigo: Color(hex: 0x5856D6)
        case .cyan: Color(hex: 0x32ADE6)
        case .purple: Color(hex: 0xAF52DE)
        case .pink: Color(hex: 0xFF2D55)
        case .brown: Color(hex: 0xA2845E)
        case .gray: Color(hex: 0x8E8E93)
        case .teal: Color(hex: 0x30B0C7)
        case .yellow: Color(hex: 0xFFCC00)
        case .green: Color(hex: 0x34C759)
        }
    }

    /// White glyphs, except black on yellow (white would be ~1.6:1).
    static func glyph(_ color: CategoryColor?) -> Color {
        color == .yellow ? .black : .white
    }

    static let names: [CategoryColor: String] = [
        .mint: "Mint", .orange: "Orange", .indigo: "Indigo", .cyan: "Cyan", .purple: "Purple", .pink: "Pink",
        .brown: "Brown", .gray: "Gray", .teal: "Teal", .yellow: "Yellow", .green: "Green",
    ]

    static let all: [CategoryColor] = [.mint, .orange, .indigo, .cyan, .purple, .pink, .brown, .gray, .teal, .yellow, .green]
    /// Expense categories never get green (income); blue and red aren't in the palette at all.
    static let expense: [CategoryColor] = all.filter { $0 != .green }
    static let income: [CategoryColor] = [.green] + all.filter { $0 != .green }
}

/// Category icons. The API stores Phosphor names (what the web app draws); on iOS each
/// maps to the closest SF Symbol. Keep the keys in sync with web/src/components/ui/icons.ts.
enum CategoryIcon {
    static let choices = [
        "shopping-cart", "fork-knife", "house-line", "bus", "ticket", "shopping-bag", "book-open", "dots-three",
        "graduation-cap", "hand-coins", "briefcase", "gift", "arrow-down-left", "coffee", "hamburger", "pizza",
        "wine", "car", "airplane", "train", "bicycle", "gas-pump", "taxi", "first-aid", "pill", "barbell",
        "game-controller", "film-slate", "music-notes", "television", "device-mobile", "laptop", "wifi-high",
        "lightning", "drop", "lightbulb", "t-shirt", "scissors", "paw-print", "baby", "plant", "cake", "palette",
        "camera", "heart", "umbrella", "wrench", "piggy-bank", "bank", "wallet", "coins", "storefront", "basket", "tag",
    ]

    static let symbols: [String: String] = [
        "shopping-cart": "cart.fill", "fork-knife": "fork.knife", "house-line": "house.fill", "bus": "bus.fill",
        "ticket": "ticket.fill", "shopping-bag": "bag.fill", "book-open": "book.fill", "dots-three": "ellipsis",
        "graduation-cap": "graduationcap.fill", "hand-coins": "banknote.fill", "briefcase": "briefcase.fill",
        "gift": "gift.fill", "arrow-down-left": "arrow.down.left", "coffee": "cup.and.saucer.fill",
        "hamburger": "takeoutbag.and.cup.and.straw.fill", "pizza": "fork.knife.circle.fill", "wine": "wineglass.fill",
        "car": "car.fill", "airplane": "airplane", "train": "tram.fill", "bicycle": "bicycle", "gas-pump": "fuelpump.fill",
        "taxi": "car.side.fill", "first-aid": "cross.case.fill", "pill": "pills.fill", "barbell": "dumbbell.fill",
        "game-controller": "gamecontroller.fill", "film-slate": "film.fill", "music-notes": "music.note",
        "television": "tv.fill", "device-mobile": "iphone", "laptop": "laptopcomputer", "wifi-high": "wifi",
        "lightning": "bolt.fill", "drop": "drop.fill", "lightbulb": "lightbulb.fill", "t-shirt": "tshirt.fill",
        "scissors": "scissors", "paw-print": "pawprint.fill", "baby": "stroller.fill", "plant": "leaf.fill",
        "cake": "birthday.cake.fill", "palette": "paintpalette.fill", "camera": "camera.fill", "heart": "heart.fill",
        "umbrella": "umbrella.fill", "wrench": "wrench.fill", "piggy-bank": "tray.and.arrow.down.fill",
        "bank": "building.columns.fill", "wallet": "wallet.bifold.fill", "coins": "centsign.circle.fill",
        "storefront": "storefront.fill", "basket": "basket.fill", "tag": "tag.fill",
        // Non-category names the screens use.
        "arrows-clockwise": "arrow.triangle.2.circlepath", "calendar-blank": "calendar", "money": "banknote.fill",
        "credit-card": "creditcard.fill", "clock": "clock.fill",
    ]

    static func symbol(_ name: String?) -> String {
        symbols[name ?? ""] ?? "ellipsis"
    }
}

/// Account types with their label and icon (Settings › Accounts).
enum AccountTypeStyle {
    static let all: [(type: AccountType, label: String, symbol: String)] = [
        (.cash, "Cash", "banknote.fill"),
        (.bank, "Bank", "building.columns.fill"),
        (.creditCard, "Credit Card", "creditcard.fill"),
        (.savings, "Savings", "tray.and.arrow.down.fill"),
        (.other, "Other", "wallet.bifold.fill"),
    ]

    static func label(_ type: AccountType) -> String { all.first { $0.type == type }?.label ?? "Other" }
    static func symbol(_ type: AccountType) -> String { all.first { $0.type == type }?.symbol ?? "wallet.bifold.fill" }
}
