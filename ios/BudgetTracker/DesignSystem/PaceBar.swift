import BudgetTrackerCore
import SwiftUI

/// Bars grow in once per screen per app run (design § 3 Motion): never again on
/// re-render, refresh, month switch or tab switch. Off under Reduce Motion.
@MainActor
enum PaceAnimation {
    private static var played: Set<String> = []

    /// True the first time `key` asks; false afterwards.
    static func shouldPlay(_ key: String?) -> Bool {
        guard let key else { return true }
        return played.insert(key).inserted
    }
}

/// The signature pace bar (design § 3): category segments, the gray rest, the "Today"
/// tick where total spending would be if you spent evenly, and the scale line.
/// Read by VoiceOver as one sentence.
struct PaceBar: View {
    struct Segment: Identifiable {
        var id: String
        var color: CategoryColor
        /// min(spent, limit) for the category (API PaceSegment.amountMinor).
        var amountMinor: Int64
    }

    var segments: [Segment]
    var spentMinor: Int64
    var budgetMinor: Int64
    var currency: String
    /// 0–1 (API totals.paceMarker); nil hides the tick (past or future month).
    var marker: Double?
    var animationKey: String?

    @Environment(\.money) private var f
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var grown = false
    @ScaledMetric(relativeTo: .caption2) private var labelHeight: CGFloat = 16

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            GeometryReader { geo in
                bar(width: geo.size.width)
            }
            .frame(height: labelHeight + 4 + 22)

            HStack(alignment: .firstTextBaseline) {
                Text("\(Text(f.money(spentMinor, currency)).fontWeight(.semibold).foregroundStyle(Color.label)) spent")
                Spacer(minLength: 12)
                Text("\(f.money(budgetMinor, currency, whole: true)) budget")
            }
            .font(.footnote)
            .foregroundStyle(Color.label2)
            .monospacedDigit()
            .accessibilityHidden(true)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(sentence)
        .onAppear {
            let play = PaceAnimation.shouldPlay(animationKey) && !reduceMotion
            if play {
                withAnimation(.timingCurve(0.23, 1, 0.32, 1, duration: 0.6)) { grown = true }
            } else {
                grown = true
            }
        }
    }

    private var sentence: String {
        var s = "Spent \(f.money(spentMinor, currency)) of \(f.money(budgetMinor, currency))."
        if let marker {
            let even = Int64((marker * Double(budgetMinor)).rounded())
            s += " If you spent evenly you’d be at \(f.money(even, currency, whole: true)) today."
        }
        return s
    }

    @ViewBuilder
    private func bar(width w: CGFloat) -> some View {
        let total = Double(max(budgetMinor, 1))
        let visible = segments.filter { $0.amountMinor > 0 }
        let trackTop = labelHeight + 4 + 4
        ZStack(alignment: .topLeading) {
            HStack(spacing: 2) {
                ForEach(Array(visible.enumerated()), id: \.element.id) { i, s in
                    Rectangle()
                        .fill(Hue.mark(s.color))
                        .frame(width: max(2, w * min(Double(s.amountMinor), total) / total))
                        .scaleEffect(x: grown ? 1 : 0, anchor: .leading)
                        .animation(grown ? .timingCurve(0.23, 1, 0.32, 1, duration: 0.6).delay(Double(i) * 0.04) : nil, value: grown)
                }
                Rectangle().fill(Color.chartTrack)
            }
            .frame(width: w, height: 14, alignment: .leading)
            .clipShape(Capsule())
            .offset(y: trackTop)

            if let marker {
                let x = w * min(max(marker, 0), 1)
                VStack(spacing: 1) {
                    Text("Today")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(Color.label2)
                        .fixedSize()
                        .frame(height: labelHeight)
                    RoundedRectangle(cornerRadius: 1)
                        .fill(Color.marker)
                        .frame(width: 2, height: 22)
                        .background(RoundedRectangle(cornerRadius: 2).fill(Color.surface).padding(-1.5))
                }
                .position(x: x, y: (labelHeight + 1 + 22) / 2 + 3)
            }
        }
    }
}

/// The mini pace bar in budget rows: 6pt track, fill in the category color, tick at
/// `elapsed` for flexible categories. Decorative: the row's text carries the numbers.
struct MiniPace: View {
    var spentMinor: Int64
    var limitMinor: Int64?
    var elapsed: Double?
    var fixed = false
    var color: CategoryColor
    var animationKey: String?

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var grown = false

    var body: some View {
        GeometryReader { geo in
            let used = (limitMinor ?? 0) > 0 ? min(Double(spentMinor) / Double(limitMinor!), 1) : 0
            ZStack(alignment: .leading) {
                Capsule().fill(Color.chartTrack).frame(height: 6)
                if used > 0 {
                    Capsule()
                        .fill(Hue.mark(color))
                        .frame(width: max(6, geo.size.width * used), height: 6)
                        .scaleEffect(x: grown ? 1 : 0, anchor: .leading)
                }
                if !fixed, let elapsed {
                    RoundedRectangle(cornerRadius: 1)
                        .fill(Color.marker)
                        .frame(width: 2, height: 12)
                        .background(RoundedRectangle(cornerRadius: 2).fill(Color.surface).padding(-1.5))
                        .position(x: geo.size.width * min(max(elapsed, 0), 1), y: 6)
                }
            }
            .frame(height: 12)
        }
        .frame(height: 12)
        .accessibilityHidden(true)
        .onAppear {
            if PaceAnimation.shouldPlay(animationKey) && !reduceMotion {
                withAnimation(.timingCurve(0.23, 1, 0.32, 1, duration: 0.6)) { grown = true }
            } else {
                grown = true
            }
        }
    }
}

/// Budget row (design § 6.5, § 3): name + "353,60 lei left" (or "27,50 lei over" in
/// red), the mini pace bar, then the status note:
///   over     → ⚠ Over budget · 327,50 of 300 lei   (red, semibold)
///   ahead    → ↗ Ahead of pace · 169,90 of 250 lei (label, semibold: a nudge, no color)
///   on track → 246,40 of 600 lei (· Fixed)
struct BudgetRowView: View {
    var line: BudgetLine
    var currency: String
    var elapsed: Double?
    var animationKey: String?

    @Environment(\.money) private var f

    var body: some View {
        let fixed = line.category.isFixed
        let limit = line.limitMinor
        let left = (limit ?? 0) - line.spentMinor
        let isOver = limit != nil && (line.status == .over || left < 0)
        let ofText = limit.map { "\(f.number(line.spentMinor, currency)) of \(f.money($0, currency, whole: true))" }
            ?? "\(f.money(line.spentMinor, currency)) spent"

        HStack(alignment: .top, spacing: 12) {
            CategoryTile(color: line.category.color, icon: line.category.icon).padding(.top, 1)
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    Text(line.category.name).font(.body).lineLimit(1)
                    Spacer(minLength: 0)
                    if limit != nil {
                        if isOver {
                            Text(f.over(left, currency)).font(.subheadline.weight(.semibold)).foregroundStyle(Color.negative)
                        } else {
                            Text("\(Text(f.money(left, currency)).fontWeight(.semibold).foregroundStyle(Color.label)) left")
                                .font(.subheadline)
                                .foregroundStyle(Color.label2)
                        }
                    }
                }
                .monospacedDigit()
                MiniPace(spentMinor: line.spentMinor, limitMinor: limit, elapsed: fixed ? nil : elapsed, fixed: fixed,
                         color: line.category.color, animationKey: animationKey)
                    .padding(.top, 4)
                Group {
                    if isOver {
                        Label("Over budget · \(ofText)", systemImage: "exclamationmark.circle.fill")
                            .fontWeight(.semibold)
                            .foregroundStyle(Color.negative)
                    } else if line.status == .ahead && !fixed {
                        HStack(spacing: 4) {
                            Image(systemName: "chart.line.uptrend.xyaxis")
                            Text("Ahead of pace ·").fontWeight(.semibold)
                            Text(ofText).foregroundStyle(Color.label2)
                        }
                        .foregroundStyle(Color.label)
                    } else {
                        Text((limit == nil ? "No budget · " : "") + ofText + (fixed ? " · Fixed" : ""))
                            .foregroundStyle(Color.label2)
                    }
                }
                .labelStyle(TightLabelStyle())
                .font(.footnote)
                .monospacedDigit()
                .padding(.top, 4)
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText(left: left, isOver: isOver))
    }

    private func accessibilityText(left: Int64, isOver: Bool) -> String {
        let name = line.category.name
        guard let limit = line.limitMinor else { return "\(name): no budget, \(f.money(line.spentMinor, currency)) spent" }
        let state = isOver ? "\(f.money(-left, currency)) over budget" : "\(f.money(left, currency)) left"
        return "\(name): \(state), \(f.money(line.spentMinor, currency)) spent of \(f.money(limit, currency))"
            + (line.status == .ahead ? ", ahead of pace" : "") + (line.category.isFixed ? ", fixed" : "")
    }
}

/// Icon + text with a 4pt gap (status notes).
struct TightLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 4) {
            configuration.icon
            configuration.title
        }
    }
}
