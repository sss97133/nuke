// WorthBracketView.swift — worth as a HONEST modeled estimate, never a confident
// bracket that bypasses its own (often threadbare) backing.
//
// The make-or-break surface. A value backed by 1 input and 7 of 8 empty signals
// must NOT render as bold "$45,500 · 77% confident" — that's a facade, the cardinal
// sin on a provenance platform. So the headline reads honest-low when the model is
// thin (dim, "~", coverage stated), and the whole thing DRILLS into its machinery:
// the 8 signals (which fired, which are empty), the deal/heat scores, the method,
// the freshness. The absence of power becomes the disclosure. Renders nothing
// without a real value (honest blank).

import SwiftUI

struct WorthBracketView: View {
    let valuation: VehicleValuation
    /// compact = the hero title-card overlay (white on a dark scrim); full = the
    /// standalone profile section.
    var compact: Bool = false

    @State private var showDetail = false

    private var ink: Color { compact ? .white : .primary }
    private var dim: Color { compact ? .white.opacity(0.65) : .secondary }
    private var thin: Bool { valuation.isThin }

    var body: some View {
        if let mid = valuation.value, mid > 0 {
            Button { showDetail = true } label: {
                // BLOCKED: a comps-only / threadbare model must NOT put a price on a
                // documented build. Showing a wrong number is a liability (you don't
                // undervalue someone's belongings — Zillow-scale backlash). No number
                // until the analysis is real; until then, point at the documented
                // investment (the defensible figure) instead.
                if valuation.isThin { blockedContent } else { content(mid) }
            }
            .buttonStyle(.plain)
            .sheet(isPresented: $showDetail) {
                ValuationDetailSheet(valuation: valuation)
            }
        }
    }

    @ViewBuilder private var blockedContent: some View {
        VStack(alignment: .leading, spacing: compact ? 2 : 5) {
            if !compact {
                HStack(spacing: 6) {
                    Text("MARKET ESTIMATE")
                        .font(.system(.caption2, design: .monospaced)).foregroundStyle(.secondary)
                    Image(systemName: "chevron.right")
                        .font(.system(size: 9, weight: .semibold)).foregroundStyle(.tertiary)
                }
            }
            Text("Not priced yet")
                .font(compact ? .body.weight(.medium) : .title3.weight(.medium))
                .foregroundStyle(ink)
            if !compact {
                Text("A documented build isn't a comp average. We won't put a number on it until the analysis includes this build's investment — see the ledger below.")
                    .font(.system(.caption2, design: .monospaced))
                    .foregroundStyle(dim)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                Text("a build, not a comp")
                    .font(.system(.caption2, design: .monospaced))
                    .foregroundStyle(dim)
            }
        }
        .contentShape(Rectangle())
    }

    @ViewBuilder private func content(_ mid: Double) -> some View {
        VStack(alignment: .leading, spacing: compact ? 2 : 5) {
            if !compact {
                HStack(spacing: 6) {
                    Text("MARKET ESTIMATE")
                        .font(.system(.caption2, design: .monospaced))
                        .foregroundStyle(.secondary)
                    Image(systemName: "chevron.right")
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundStyle(.tertiary)
                }
            }
            // The headline. When the model is THIN, the mid number is NOT bold ink
            // — it's dim, prefixed "~", so it can never pose as a firm price.
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text((thin ? "~" : "") + money0(mid))
                    .font(headlineFont)
                    .monospacedDigit()
                    .foregroundStyle(thin ? dim : ink)
                Image(systemName: "hourglass").font(.caption2).foregroundStyle(dim)
            }
            // The band, always dim.
            if let lo = valuation.value_low, let hi = valuation.value_high, lo > 0, hi > 0 {
                Text("\(money0(lo)) – \(money0(hi))")
                    .font(.caption).monospacedDigit().foregroundStyle(dim)
            }
            // HONEST basis — signal coverage + inputs + freshness, NOT a misleading
            // "300 comps · 77% confident" (300 is the category pool, not 300 comps,
            // and the confidence is unjustified when 7/8 signals are empty).
            basisText
                .font(.system(.caption2, design: .monospaced))
                .fixedSize(horizontal: false, vertical: true)
        }
        .contentShape(Rectangle())
    }

    private var headlineFont: Font {
        if thin { return compact ? .body.weight(.regular) : .title3.weight(.regular) }
        return compact ? .title3.weight(.semibold) : .title2.weight(.semibold)
    }

    private var basisText: Text {
        var parts: [String] = [thin ? "rough est" : "est"]
        if valuation.signalsTotal > 0 {
            parts.append("\(valuation.signalsFired) of \(valuation.signalsTotal) signals")
        }
        if let n = valuation.input_count { parts.append("\(n) input\(n == 1 ? "" : "s")") }
        if valuation.is_stale != true, let at = valuation.calculated_at {
            parts.append("modeled \(String(at.prefix(10)))")
        }
        var t = Text(parts.joined(separator: " · ")).foregroundColor(dim)
        if valuation.is_stale == true {
            t = t + Text(" · stale").foregroundColor(compact ? .white.opacity(0.85) : .orange)
        }
        t = t + Text(" · tap").foregroundColor(dim)
        return t
    }

    private func money0(_ v: Double) -> String {
        v.formatted(.currency(code: "USD").precision(.fractionLength(0)))
    }
}

// ─── The drill — the machinery the headline used to bury. Every signal, the deal
// and heat scores, the method, the freshness, the integrity flags. The honest
// answer to "where does this number come from."
private struct ValuationDetailSheet: View {
    let valuation: VehicleValuation
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section {
                    if let mid = valuation.value {
                        HStack(alignment: .firstTextBaseline) {
                            Text((valuation.isThin ? "~" : "") + money0(mid))
                                .font(.title2.weight(.semibold)).monospacedDigit()
                            if let lo = valuation.value_low, let hi = valuation.value_high {
                                Text("\(money0(lo)) – \(money0(hi))")
                                    .font(.caption).monospacedDigit().foregroundStyle(.secondary)
                            }
                        }
                    }
                    if valuation.isThin {
                        Label("Rough placeholder — most of the model has no data for this vehicle yet. Not a valuation.",
                              systemImage: "exclamationmark.triangle")
                            .font(.caption).foregroundStyle(.orange)
                    }
                } header: { Text("Estimate") }

                // The 8 signals — which fired (green, with sources), which are empty.
                // This is the disclosure: the absence of power, made visible.
                Section {
                    ForEach(valuation.signals ?? []) { s in
                        HStack {
                            Image(systemName: s.fired == true ? "checkmark.circle.fill" : "circle.dashed")
                                .foregroundStyle(s.fired == true ? .green : .secondary)
                            Text(s.name.replacingOccurrences(of: "_", with: " ").capitalized)
                                .foregroundStyle(s.fired == true ? .primary : .secondary)
                            Spacer()
                            if let w = s.weight {
                                Text("\(Int((w * 100).rounded()))%")
                                    .font(.caption2.monospaced()).foregroundStyle(.tertiary)
                            }
                            Text(s.fired == true ? "\(s.source_count ?? 0) src" : "no data")
                                .font(.caption2.monospaced())
                                .foregroundStyle(s.fired == true ? .secondary : .tertiary)
                        }
                    }
                } header: {
                    Text("Model signals · \(valuation.signalsFired) of \(valuation.signalsTotal) firing")
                } footer: {
                    Text("Each signal's % is its weight in the model. Empty signals contribute nothing — the estimate leans only on what fired.")
                }

                Section {
                    if let label = valuation.deal_score_label, let score = valuation.deal_score {
                        row("Deal", dealText(label, score), warn: score < -50)
                    }
                    if let h = valuation.heat_score_label {
                        row("Demand", h.capitalized)
                    }
                    if let m = valuation.comp_method { row("Comp method", m.capitalized) }
                    if let v = valuation.model_version { row("Model", v) }
                    if let c = valuation.confidence {
                        let ci = valuation.confidence_interval_pct.map { " · ±\(Int($0))%" } ?? ""
                        row("Model confidence", "\(c)%\(ci)")
                    }
                    if let at = valuation.calculated_at {
                        row("Modeled", String(at.prefix(10)) + (valuation.is_stale == true ? " · stale" : ""),
                            warn: valuation.is_stale == true)
                    }
                    if valuation.is_circular == true {
                        Label("Circular — derived from this vehicle's own asking price, not independent comps.",
                              systemImage: "arrow.triangle.2.circlepath")
                            .font(.caption).foregroundStyle(.orange)
                    }
                } header: { Text("Market read") }
            }
            .navigationTitle("How it's modeled")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } } }
        }
        .presentationDetents([.medium, .large])
    }

    @ViewBuilder private func row(_ label: String, _ value: String, warn: Bool = false) -> some View {
        LabeledContent(label) {
            Text(value).font(.callout).foregroundStyle(warn ? .orange : .primary)
        }
    }

    /// A very negative deal score means the model scored this an outlier vs comps —
    /// disclose it plainly, don't bury it.
    private func dealText(_ label: String, _ score: Double) -> String {
        let base = label.replacingOccurrences(of: "_", with: " ")
        return score < -50 ? "outlier vs comps (\(Int(score)))" : base
    }

    private func money0(_ v: Double) -> String {
        v.formatted(.currency(code: "USD").precision(.fractionLength(0)))
    }
}
