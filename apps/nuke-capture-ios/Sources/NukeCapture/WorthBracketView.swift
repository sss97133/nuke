// WorthBracketView.swift — worth as a BRACKET, never a scalar.
//
// A condition-blind comp average is not a fact about THIS asset, so it must read
// as a soft modeled estimate (the .projected rung of the trust ladder), shown as
// {low · mid · high} with its basis (comps · confidence · freshness) on the
// surface — never a bare number that poses as a price. Renders nothing without a
// real value (honest blank, the same guard as the old valuationSection).

import SwiftUI

struct WorthBracketView: View {
    let valuation: VehicleValuation
    /// compact = the hero title-card overlay (white on a dark scrim); full = the
    /// standalone profile section.
    var compact: Bool = false

    private var ink: Color { compact ? .white : .primary }
    private var dim: Color { compact ? .white.opacity(0.65) : .secondary }

    var body: some View {
        if let mid = valuation.value, mid > 0 {
            VStack(alignment: .leading, spacing: compact ? 2 : 5) {
                if !compact {
                    Text("MARKET ESTIMATE")
                        .font(.system(.caption2, design: .monospaced))
                        .foregroundStyle(.secondary)
                }
                // The bracket: low · MID · high. Mid is the headline; the band is dim.
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    if let lo = valuation.value_low, lo > 0 {
                        Text(money0(lo)).font(.caption).monospacedDigit().foregroundStyle(dim)
                        Text("·").font(.caption2).foregroundStyle(dim)
                    }
                    Text(money0(mid))
                        .font(compact ? .title3.weight(.semibold) : .title2.weight(.semibold))
                        .monospacedDigit().foregroundStyle(ink)
                    if let hi = valuation.value_high, hi > 0 {
                        Text("·").font(.caption2).foregroundStyle(dim)
                        Text(money0(hi)).font(.caption).monospacedDigit().foregroundStyle(dim)
                    }
                    // The .projected glyph — modeled, not a confirmed fact.
                    Image(systemName: "hourglass").font(.caption2).foregroundStyle(dim)
                }
                // Methodology on the surface — never a bare number.
                basisText
                    .font(.system(.caption2, design: .monospaced))
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    /// "est · N comps · C% confident · modeled YYYY-MM-DD" (or "· stale").
    private var basisText: Text {
        var parts: [String] = ["est"]
        if let n = valuation.comp_count, n > 0 { parts.append("\(n) comps") }
        if let c = valuation.confidence { parts.append("\(c)% confident") }
        if valuation.is_stale != true, let at = valuation.calculated_at {
            parts.append("modeled \(String(at.prefix(10)))")
        }
        var t = Text(parts.joined(separator: " · ")).foregroundColor(dim)
        if valuation.is_stale == true {
            t = t + Text(" · stale").foregroundColor(compact ? .white.opacity(0.85) : .orange)
        }
        return t
    }

    private func money0(_ v: Double) -> String {
        v.formatted(.currency(code: "USD").precision(.fractionLength(0)))
    }
}
