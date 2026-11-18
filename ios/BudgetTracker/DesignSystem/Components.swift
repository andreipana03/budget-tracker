import BudgetTrackerCore
import SwiftUI

// MARK: - Category tile

/// Category tile (design § 6.6): a squircle in the hue's tile color with a white glyph
/// (black on yellow), or a monogram for subscriptions and merchants (never a logo).
/// Decorative: hidden from VoiceOver, so the category name must sit next to it.
struct CategoryTile: View {
    var color: CategoryColor?
    var icon: String? = nil
    var monogram: String? = nil
    /// An SF Symbol instead of a category icon name.
    var symbol: String? = nil
    var size: CGFloat = 30

    var body: some View {
        RoundedRectangle(cornerRadius: size * 0.27, style: .continuous)
            .fill(Hue.tile(color))
            .frame(width: size, height: size)
            .overlay {
                if let monogram {
                    Text(String(monogram.prefix(1)).uppercased())
                        .font(.system(size: size * 0.48, weight: .bold, design: .rounded))
                } else {
                    Image(systemName: symbol ?? CategoryIcon.symbol(icon))
                        .font(.system(size: size * 0.52, weight: .semibold))
                        .symbolRenderingMode(.monochrome)
                }
            }
            .foregroundStyle(Hue.glyph(color))
            .accessibilityHidden(true)
    }
}

// MARK: - Text bits

/// A small capsule label: "Pending" (tinted, it invites an action), "Fixed", "This Month".
struct Pill: View {
    var text: String
    var tinted = false

    var body: some View {
        Text(text)
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 7)
            .padding(.vertical, 2)
            .foregroundStyle(tinted ? Color.tintText : Color.label2)
            .background(tinted ? Color.tintSoft : Color.fill3, in: Capsule())
            .fixedSize()
    }
}

/// Section header (design § 6.4): title3 bold + an optional trailing "See All".
struct SectionHeader: View {
    var title: String
    var actionTitle: String? = nil
    var action: (() -> Void)? = nil

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title)
                .font(.title3.bold())
                .foregroundStyle(Color.label)
                .accessibilityAddTraits(.isHeader)
            Spacer()
            if let actionTitle, let action {
                Button(actionTitle, action: action)
                    .font(.subheadline)
                    .foregroundStyle(Color.tintText)
                    .buttonStyle(.borderless)
            }
        }
        .textCase(nil)
        .padding(.horizontal, -4)
    }
}

/// Money in a hero layout: big rounded integer, decimals at 0.6 em, the currency at
/// 0.45 em in `label-2` (design § 4.2).
struct HeroAmount: View {
    var parts: MoneyParts
    var size: CGFloat = 44
    var color: Color = .label
    @ScaledMetric(relativeTo: .largeTitle) private var scale: CGFloat = 1

    var body: some View {
        let s = size * scale
        let big = Font.system(size: s, weight: .bold, design: .rounded)
        let small = Font.system(size: s * 0.6, weight: .bold, design: .rounded)
        let currency = Font.system(size: s * 0.45, weight: .semibold, design: .rounded)
        let symbol = Text(parts.symbol).font(currency).foregroundStyle(Color.label2)
        let whole = Text(parts.approx + parts.sign + parts.integer).font(big).foregroundStyle(color)
        let fraction = Text(parts.decimalSeparator + parts.fraction).font(small).foregroundStyle(color)
        let space = Text(" ").font(currency)
        (parts.symbolBefore ? Text("\(symbol)\(space)\(whole)\(fraction)") : Text("\(whole)\(fraction)\(space)\(symbol)"))
            .monospacedDigit()
            .lineLimit(1)
            .minimumScaleFactor(0.5)
            .accessibilityLabel(parts.text)
    }
}

/// Three stats in a row (Budget / Spent / Left), values in rounded title3 bold.
struct StatRow: View {
    struct Item: Identifiable {
        var id: String { label }
        var label: String
        var parts: MoneyParts
        var color: Color = .label
    }

    var items: [Item]

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            ForEach(items) { item in
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.label)
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(Color.label2)
                    let value = Text(item.parts.approx + item.parts.sign + item.parts.integer + item.parts.decimalSeparator + item.parts.fraction)
                        .foregroundStyle(item.color)
                    let symbol = Text(" " + item.parts.symbol).font(.system(.subheadline, design: .rounded, weight: .semibold))
                        .foregroundStyle(Color.label2)
                    Text("\(value)\(symbol)")
                        .font(.system(.title3, design: .rounded, weight: .bold))
                        .monospacedDigit()
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("\(item.label): \(item.parts.text)")
            }
        }
    }
}

// MARK: - States

/// Empty state, centered (design § 6.16): tile-style icon, title, one line, an action.
struct EmptyStateView: View {
    var symbol = "list.bullet.rectangle.portrait"
    var title: String
    var message: String? = nil
    var actionTitle: String? = nil
    var prominent = true
    var action: (() -> Void)? = nil

    var body: some View {
        VStack(spacing: 0) {
            RoundedRectangle(cornerRadius: 13, style: .continuous)
                .fill(Color.fill3)
                .frame(width: 48, height: 48)
                .overlay(Image(systemName: symbol).font(.title2).foregroundStyle(Color.label2))
                .accessibilityHidden(true)
            Text(title)
                .font(.title3.bold())
                .multilineTextAlignment(.center)
                .padding(.top, 16)
            if let message {
                Text(message)
                    .font(.subheadline)
                    .foregroundStyle(Color.label2)
                    .multilineTextAlignment(.center)
                    .padding(.top, 4)
            }
            if let actionTitle, let action {
                Group {
                    if prominent {
                        Button(actionTitle, action: action).buttonStyle(.borderedProminent).fontWeight(.semibold)
                    } else {
                        Button(actionTitle, action: action).buttonStyle(.bordered)
                    }
                }
                .controlSize(.large)
                .padding(.top, 20)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 36)
        .padding(.horizontal, 12)
    }
}

/// Inline, recoverable error in the app's voice (design § 6.16), never an alert:
/// "Couldn't load your budgets. Check your connection and try again. · Try Again"
struct InlineErrorView: View {
    var what: String? = nil
    var message: String? = nil
    var retry: (() -> Void)? = nil

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Image(systemName: "exclamationmark.circle.fill").foregroundStyle(Color.label2)
            VStack(alignment: .leading, spacing: 4) {
                Text(message ?? "Couldn’t load \(what ?? "this"). Check your connection and try again.")
                    .foregroundStyle(Color.label2)
                if let retry {
                    Button("Try Again", action: retry)
                        .fontWeight(.semibold)
                        .foregroundStyle(Color.tintText)
                        .buttonStyle(.borderless)
                }
            }
        }
        .font(.subheadline)
        .padding(.vertical, 4)
    }
}

/// Loading rows with the shape of the real ones (no spinners for local data).
struct SkeletonRows: View {
    var count = 3
    var double = true

    var body: some View {
        ForEach(0..<count, id: \.self) { i in
            HStack(spacing: 12) {
                RoundedRectangle(cornerRadius: double ? 11 : 8, style: .continuous)
                    .frame(width: double ? 40 : 30, height: double ? 40 : 30)
                VStack(alignment: .leading, spacing: 8) {
                    Capsule().frame(width: i.isMultiple(of: 2) ? 130 : 96, height: 13)
                    if double { Capsule().frame(width: 160, height: 11) }
                }
                Spacer()
                Capsule().frame(width: 64, height: 13)
            }
            .foregroundStyle(Color.fill4)
            .padding(.vertical, 2)
            .accessibilityHidden(true)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Loading")
    }
}

// MARK: - Small charts

/// A horizontal bar (By Category): fill in the category color on the track.
struct HorizontalBar: View {
    var ratio: Double
    var color: Color

    var body: some View {
        GeometryReader { geo in
            Capsule()
                .fill(Color.chartTrack)
                .overlay(alignment: .leading) {
                    Capsule().fill(color).frame(width: max(ratio > 0 ? 4 : 0, geo.size.width * min(max(ratio, 0), 1)))
                }
        }
        .frame(height: 6)
        .accessibilityHidden(true)
    }
}

/// 36pt spark bars for highlight cards: past bars neutral, the highlighted one colored.
struct SparkBars: View {
    var values: [Int64]
    var highlight: Int
    var color: Color = .label

    var body: some View {
        let maxValue = max(values.max() ?? 1, 1)
        HStack(alignment: .bottom, spacing: 3) {
            ForEach(Array(values.enumerated()), id: \.offset) { i, v in
                RoundedRectangle(cornerRadius: 2)
                    .fill(i == highlight ? color : Color.chartNeutral.opacity(0.55))
                    .frame(height: max(3, 36 * CGFloat(v) / CGFloat(maxValue)))
            }
        }
        .frame(height: 36, alignment: .bottom)
        .accessibilityHidden(true)
    }
}

/// Highlight card (design § 6.15): kicker (icon + topic), title, one sentence, optional sparks.
struct HighlightCard<Footer: View>: View {
    var kickerSymbol: String
    var kicker: String
    var kickerColor: CategoryColor? = nil
    var title: String
    var bodyText: String
    var spark: (values: [Int64], highlight: Int, color: Color)? = nil
    @ViewBuilder var footer: Footer

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                if let kickerColor {
                    CategoryTile(color: kickerColor, symbol: kickerSymbol, size: 20)
                } else {
                    Image(systemName: kickerSymbol).foregroundStyle(Color.label2)
                }
                Text(kicker)
            }
            .font(.footnote.weight(.semibold))
            .foregroundStyle(Color.label2)
            Text(title).font(.headline).padding(.top, 2)
            Text(bodyText).font(.subheadline).foregroundStyle(Color.label2)
            if let spark, spark.values.count > 1 {
                SparkBars(values: spark.values, highlight: spark.highlight, color: spark.color).padding(.top, 8)
            }
            footer
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

extension HighlightCard where Footer == EmptyView {
    init(kickerSymbol: String, kicker: String, kickerColor: CategoryColor? = nil, title: String, bodyText: String,
         spark: (values: [Int64], highlight: Int, color: Color)? = nil)
    {
        self.init(kickerSymbol: kickerSymbol, kicker: kicker, kickerColor: kickerColor, title: title, bodyText: bodyText,
                  spark: spark) { EmptyView() }
    }
}

// MARK: - Rows

/// Two-line row (design § 6.5): 40pt tile · title (semibold) · subtitle · trailing amount
/// with an optional second line.
struct TwoLineRow<Leading: View, Subtitle: View, Trailing: View>: View {
    @ViewBuilder var leading: Leading
    var title: String
    var titleAccessory: String? = nil
    var titleAccessoryTinted = false
    @ViewBuilder var subtitle: Subtitle
    @ViewBuilder var trailing: Trailing
    var trailingSub: String? = nil

    var body: some View {
        HStack(spacing: 12) {
            leading
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(title).font(.body.weight(.semibold)).lineLimit(1)
                    if let titleAccessory { Pill(text: titleAccessory, tinted: titleAccessoryTinted) }
                }
                subtitle
                    .font(.subheadline)
                    .foregroundStyle(Color.label2)
                    .lineLimit(1)
            }
            .layoutPriority(1)
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 2) {
                trailing.font(.body).monospacedDigit()
                if let trailingSub {
                    Text(trailingSub).font(.subheadline).foregroundStyle(Color.label2).monospacedDigit()
                }
            }
            .fixedSize()
        }
        .padding(.vertical, 2)
    }
}
