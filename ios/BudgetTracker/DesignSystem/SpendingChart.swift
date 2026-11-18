import BudgetTrackerCore
import Charts
import SwiftUI

/// Spending bar chart (design § 6.14) with Swift Charts: past bars neutral, the current
/// bar in tint with its value above it, the projection as a dashed outline over
/// tint-soft, an "Avg" dashed rule, y labels on the trailing side with ≤ 3 gridlines.
/// Always paired with a headline that states the takeaway.
struct SpendingChart: View {
    struct Bar: Identifiable {
        var id: Int
        /// X label: "Nov", "Mon", "18".
        var label: String
        /// For VoiceOver: "November 2026".
        var name: String
        var spentMinor: Int64
        var current = false
        var projectedMinor: Int64? = nil
    }

    var bars: [Bar]
    var currency: String
    var averageMinor: Int64?
    /// Opening of the VoiceOver sentence: "Monthly spending, June to November 2026."
    var description: String
    var compact = true

    @Environment(\.money) private var f

    private func whole(_ minor: Int64) -> Int64 { MoneyFormatter.roundToWhole(minor, currency) }

    var body: some View {
        let values = bars.flatMap { [whole($0.spentMinor), whole($0.projectedMinor ?? 0)] } + [whole(averageMinor ?? 0)]
        let maxValue = Double(max(values.max() ?? 1, 1))
        let step = Self.niceStep(maxValue / 2.4)
        let yMax = max(maxValue * 1.05, step)
        let ticks = [0, step, step * 2].filter { $0 <= yMax }
        let labelEvery = bars.count > 16 ? Int((Double(bars.count) / 8).rounded(.up)) : 1

        Chart {
            ForEach(bars) { bar in
                if bar.current, let projected = bar.projectedMinor, whole(projected) > whole(bar.spentMinor) {
                    // Explicit yStart/yEnd: two marks on one x would otherwise stack.
                    BarMark(x: .value("Period", String(bar.id)), yStart: .value("Start", 0.0),
                            yEnd: .value("Projected", Double(whole(projected))), width: .ratio(0.56))
                        .foregroundStyle(Color.tintSoft)
                        .cornerRadius(6)
                }
                BarMark(x: .value("Period", String(bar.id)), yStart: .value("Start", 0.0),
                        yEnd: .value("Spent", Double(whole(bar.spentMinor))), width: .ratio(0.56))
                    .foregroundStyle(bar.current ? Color.tintFill : Color.chartNeutral)
                    .cornerRadius(6)
                    .annotation(position: .top, spacing: 4) {
                        if bar.current {
                            Text(f.integer(whole(bar.spentMinor)))
                                .font(.caption2.bold())
                                .foregroundStyle(Color.tintText)
                        }
                    }
            }
            if let averageMinor {
                RuleMark(y: .value("Average", Double(whole(averageMinor))))
                    .foregroundStyle(Color.label2)
                    .lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 3]))
                    .annotation(position: .top, alignment: .leading, spacing: 2) {
                        Text("Avg \(f.integer(whole(averageMinor)))")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(Color.label2)
                    }
            }
        }
        .chartYScale(domain: 0...yMax)
        .chartYAxis {
            AxisMarks(position: .trailing, values: ticks) { value in
                AxisGridLine(stroke: StrokeStyle(lineWidth: value.as(Double.self) == 0 ? 1 : 0.5))
                    .foregroundStyle(Color.hairline)
                AxisValueLabel {
                    if let v = value.as(Double.self) { Text(f.integer(Int64(v))).font(.caption2).foregroundStyle(Color.label2) }
                }
            }
        }
        .chartXAxis {
            AxisMarks(values: bars.map { String($0.id) }) { value in
                AxisValueLabel {
                    if let id = value.as(String.self).flatMap(Int.init), let bar = bars.first(where: { $0.id == id }),
                       bar.current || id % labelEvery == 0
                    {
                        Text(bar.label)
                            .font(.caption2.weight(bar.current ? .bold : .regular))
                            .foregroundStyle(bar.current ? Color.tintText : Color.label2)
                    }
                }
            }
        }
        .chartOverlay { proxy in
            // The projection's dashed outline sits exactly over its bar.
            GeometryReader { geo in
                if let bar = bars.first(where: { $0.current }), let projected = bar.projectedMinor,
                   whole(projected) > whole(bar.spentMinor),
                   let x = proxy.position(forX: String(bar.id)), let top = proxy.position(forY: Double(whole(projected))),
                   let bottom = proxy.position(forY: 0.0), let plot = proxy.plotFrame
                {
                    let origin = geo[plot].origin
                    let slot = geo[plot].width / CGFloat(max(bars.count, 1))
                    let w = slot * 0.56
                    RoundedRectangle(cornerRadius: 6)
                        .strokeBorder(Color.tintFill, style: StrokeStyle(lineWidth: 1.5, dash: [4, 3]))
                        .frame(width: w, height: max(0, bottom - top))
                        .position(x: origin.x + x, y: origin.y + (top + bottom) / 2)
                        .allowsHitTesting(false)
                }
            }
        }
        .frame(height: compact ? 196 : 250)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilitySentence)
    }

    private var accessibilitySentence: String {
        let items = bars.map { b in
            let spent = f.money(b.spentMinor, currency, whole: true)
            if b.current, let p = b.projectedMinor { return "\(b.name) \(spent) so far, projected \(f.money(p, currency, whole: true))" }
            return "\(b.name) \(spent)"
        }
        var s = "\(description) \(items.joined(separator: ", "))."
        if let averageMinor { s += " Average \(f.money(averageMinor, currency, whole: true))." }
        return s
    }

    /// A "nice" step (1, 2, 2.5, 5 × 10ⁿ) closest to `raw` in log space.
    static func niceStep(_ raw: Double) -> Double {
        guard raw > 0 else { return 1 }
        let base = pow(10, floor(log10(raw)))
        return [1, 2, 2.5, 5, 10].map { $0 * base }.min { abs(log($0 / raw)) < abs(log($1 / raw)) } ?? base
    }
}

/// Legend under the chart: This month · Projected · Past · Average.
struct ChartLegend: View {
    var hasProjection: Bool
    var hasAverage: Bool
    var pastLabel: String
    var currentLabel = "Spent"

    var body: some View {
        HStack(spacing: 14) {
            item(Color.tintFill, currentLabel)
            if hasProjection {
                HStack(spacing: 5) {
                    RoundedRectangle(cornerRadius: 3)
                        .strokeBorder(Color.tintFill, style: StrokeStyle(lineWidth: 1.2, dash: [2.5, 2]))
                        .background(RoundedRectangle(cornerRadius: 3).fill(Color.tintSoft))
                        .frame(width: 10, height: 10)
                    Text("Projected")
                }
            }
            item(Color.chartNeutral, pastLabel)
            if hasAverage {
                HStack(spacing: 5) {
                    Line().stroke(Color.label2, style: StrokeStyle(lineWidth: 1, dash: [3, 2])).frame(width: 14, height: 1)
                    Text("Average")
                }
            }
        }
        .font(.footnote)
        .foregroundStyle(Color.label2)
        .accessibilityHidden(true)
    }

    private func item(_ color: Color, _ text: String) -> some View {
        HStack(spacing: 5) {
            RoundedRectangle(cornerRadius: 3).fill(color).frame(width: 10, height: 10)
            Text(text)
        }
    }

    private struct Line: Shape {
        func path(in rect: CGRect) -> Path {
            Path { p in
                p.move(to: CGPoint(x: 0, y: rect.midY))
                p.addLine(to: CGPoint(x: rect.width, y: rect.midY))
            }
        }
    }
}
