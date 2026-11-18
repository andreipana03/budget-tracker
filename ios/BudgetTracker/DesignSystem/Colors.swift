import SwiftUI
import UIKit

/// Design tokens (docs/design § 4.1, ../DesignAssets/tokens/tokens.css) as dynamic colors:
/// light, dark, and Increase Contrast variants where the tokens define them.
///
/// Surfaces use the system grouped backgrounds (the tokens copy them exactly), so lists
/// and sheets get the right elevation by themselves. The text tokens are darker than
/// Apple's on purpose (WCAG contrast; the design says not to "fix" them back).
extension Color {
    // Surfaces
    static let appBackground = Color(uiColor: .systemGroupedBackground)
    static let surface = Color(uiColor: .secondarySystemGroupedBackground)
    static let surface2 = Color(uiColor: .tertiarySystemGroupedBackground)

    // Content
    static let label = Color(uiColor: .label)
    static let label2 = Color.dynamic(light: 0x6C6C70, dark: 0x98989D, contrastLight: 0x3A3A3C, contrastDark: 0xC7C7CC)
    static let label3 = Color(uiColor: .tertiaryLabel)
    static let hairline = Color(uiColor: .separator)
    static let fill3 = Color(uiColor: .tertiarySystemFill)
    static let fill4 = Color(uiColor: .quaternarySystemFill)

    // Tint: System Blue = "interactive", nothing else.
    static let tintFill = Color.dynamic(light: 0x007AFF, dark: 0x0A84FF, contrastLight: 0x0040DD, contrastDark: 0x409CFF)
    /// All blue text: links, "See All", plain text buttons.
    static let tintText = Color.dynamic(light: 0x0066CC, dark: 0x2997FF, contrastLight: 0x0040DD, contrastDark: 0x409CFF)
    static let tintSoft = Color.dynamic(light: 0x007AFF, dark: 0x0A84FF, lightAlpha: 0.12, darkAlpha: 0.22)

    // Signals: income/on track, over budget/destructive. No orange "warning".
    static let positive = Color.dynamic(light: 0x1E7E34, dark: 0x30D158, contrastLight: 0x146A2A, contrastDark: 0x30DB5B)
    static let negative = Color.dynamic(light: 0xD70015, dark: 0xFF453A, contrastLight: 0xB00012, contrastDark: 0xFF6961)

    /// The pill behind the selected tab inside the glass tab bar.
    static let glassSelected = Color.dynamic(light: 0x000000, dark: 0xFFFFFF, lightAlpha: 0.07, darkAlpha: 0.12)

    // Charts
    static let chartNeutral = Color(hex: 0x8E8E93)
    static let chartTrack = Color(uiColor: .tertiarySystemFill)
    /// The pace tick ("where you'd be today if you spent evenly").
    static let marker = Color.dynamic(light: 0x000000, dark: 0xFFFFFF, lightAlpha: 0.85, darkAlpha: 0.92)

    init(hex: UInt32, alpha: Double = 1) {
        self.init(uiColor: UIColor(hex: hex, alpha: alpha))
    }

    static func dynamic(light: UInt32, dark: UInt32, contrastLight: UInt32? = nil, contrastDark: UInt32? = nil,
                        lightAlpha: CGFloat = 1, darkAlpha: CGFloat = 1) -> Color
    {
        Color(uiColor: UIColor { traits in
            let isDark = traits.userInterfaceStyle == .dark
            let more = traits.accessibilityContrast == .high
            if isDark { return UIColor(hex: (more ? contrastDark : nil) ?? dark, alpha: darkAlpha) }
            return UIColor(hex: (more ? contrastLight : nil) ?? light, alpha: lightAlpha)
        })
    }
}

extension UIColor {
    convenience init(hex: UInt32, alpha: CGFloat = 1) {
        self.init(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255,
                  blue: CGFloat(hex & 0xFF) / 255, alpha: alpha)
    }
}

extension ShapeStyle where Self == Color {
    static var label2: Color { .label2 }
    static var tintText: Color { .tintText }
    static var positive: Color { .positive }
    static var negative: Color { .negative }
}
