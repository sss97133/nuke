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
    /// The vehicle's identity — threaded through so the "comps" signal can drill
    /// to the ACTUAL sold comparables (get_comps_scored), not dead-end at a count.
    var make: String? = nil
    var model: String? = nil
    var year: Int? = nil
    var excludeId: String? = nil

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
                ValuationDetailSheet(valuation: valuation, make: make, model: model,
                                     year: year, excludeId: excludeId)
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
    var make: String? = nil
    var model: String? = nil
    var year: Int? = nil
    var excludeId: String? = nil
    @Environment(\.dismiss) private var dismiss
    @State private var compsSignal: VehicleValuation.Signal?   // the signal being drilled

    /// The comps signal can drill to its real evidence iff we know the vehicle's
    /// year/make to query get_comps_scored. Other signals have no live accessor
    /// yet — they stay honest informational rows, never a tap onto nothing.
    private func canDrill(_ s: VehicleValuation.Signal) -> Bool {
        s.name == "comps" && s.fired == true && make != nil && year != nil
    }

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
                        if canDrill(s) {
                            // The comps signal drills to its ACTUAL evidence — the
                            // sold comparables that fired it — each linking to its source.
                            Button { compsSignal = s } label: {
                                HStack(spacing: 8) {
                                    signalRow(s)
                                    Image(systemName: "chevron.right")
                                        .font(.system(size: 11, weight: .semibold))
                                        .foregroundStyle(.tertiary)
                                }
                            }
                            .buttonStyle(.plain)
                        } else {
                            signalRow(s)
                        }
                    }
                } header: {
                    Text("Model signals · \(valuation.signalsFired) of \(valuation.signalsTotal) firing")
                } footer: {
                    Text("Each signal's % is its weight in the model. Empty signals contribute nothing — the estimate leans only on what fired.")
                }

                Section {
                    if valuation.isThin {
                        // We have no authority to call demand "cold" or the price an
                        // "outlier" or claim 77% confidence — those need market data we
                        // haven't pulled. The honesty: it's OUR intake gap, not a verdict
                        // on the vehicle. (Deal/Demand/Confidence are suppressed while thin.)
                        Label("Not measured yet — the deal, demand, and confidence read need market data we haven't pulled. That's an intake gap on our side, not a verdict on this vehicle.",
                              systemImage: "tray")
                            .font(.caption).foregroundStyle(.secondary)
                    } else {
                        if let label = valuation.deal_score_label, let score = valuation.deal_score {
                            row("Deal", dealText(label, score), warn: score < -50)
                        }
                        if let h = valuation.heat_score_label { row("Demand", h.capitalized) }
                        if let c = valuation.confidence {
                            let ci = valuation.confidence_interval_pct.map { " · ±\(Int($0))%" } ?? ""
                            row("Model confidence", "\(c)%\(ci)")
                        }
                    }
                    // Factual provenance — always honest to show.
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
            .sheet(item: $compsSignal) { _ in
                CompsDrillView(make: make ?? "", model: model, year: year ?? 0, excludeId: excludeId)
            }
        }
        .presentationDetents([.medium, .large])
    }

    /// One signal row: fired/empty mark, name, weight %, and the source count
    /// (which, for comps, is the drillable handle).
    @ViewBuilder private func signalRow(_ s: VehicleValuation.Signal) -> some View {
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

// ─── The comps drill — the evidence behind "comps · N src". The ACTUAL sold
// comparables the model leaned on (get_comps_scored), each a real vehicle with
// its sale price, platform, sold date, and a link to its source listing. This
// is the dead-end fixed: the count becomes the rows it counts.
private struct Comp: Decodable, Identifiable {
    let vehicle_id: String?
    let yr: Int?
    let mk: String?
    let mdl: String?
    let tr: String?
    let sale_price: Double?
    let miles: Int?
    let image_url: String?
    let listing_url: String?
    let platform: String?
    let sold_date: String?
    let similarity_score: Double?
    var id: String { (vehicle_id ?? listing_url ?? UUID().uuidString) }
}

/// get_comps_scored named params — optionals omit (encodeIfPresent) so the SQL
/// defaults apply (e.g. nil model → make-only).
private struct CompsParams: Encodable {
    let p_make: String
    let p_model: String?
    let p_year: Int
    let p_exclude_vehicle_id: String?
    let p_limit: Int
}

struct CompsDrillView: View {
    let make: String
    var model: String? = nil
    let year: Int
    var excludeId: String? = nil

    @Environment(\.dismiss) private var dismiss
    @State private var comps: [Comp] = []
    @State private var loaded = false
    @State private var loadError = false

    var body: some View {
        NavigationStack {
            List {
                if !comps.isEmpty {
                    Section {
                        ForEach(comps) { compRow($0) }
                    } header: {
                        Text("\(comps.count) sold comparables")
                    } footer: {
                        Text("Recently sold \(year)-era \(make)\(model.map { " " + $0 } ?? "") — the real sales the estimate leaned on. Tap one to open its listing.")
                    }
                } else if loadError {
                    ContentUnavailableView {
                        Label("Couldn't load comps", systemImage: "wifi.exclamationmark")
                    } description: { Text("Check your connection.") } actions: {
                        Button("Retry") { Task { loaded = false; loadError = false; await load() } }
                            .buttonStyle(.borderedProminent)
                    }
                } else if loaded {
                    Text("No sold comparables on record for this build yet.")
                        .font(.footnote).foregroundStyle(.secondary)
                } else {
                    HStack(spacing: 8) {
                        ProgressView()
                        Text("Loading comparables…").font(.footnote).foregroundStyle(.secondary)
                    }
                }
            }
            .navigationTitle("Comparables")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } } }
        }
        .presentationDetents([.large])
        .task { await load() }
    }

    @ViewBuilder private func compRow(_ c: Comp) -> some View {
        let title = [c.yr.map(String.init), c.mk, c.mdl, c.tr].compactMap { $0 }.joined(separator: " ")
        if let s = c.listing_url, let url = URL(string: s) {
            Link(destination: url) { compRowContent(c, title: title, linky: true) }
        } else {
            compRowContent(c, title: title, linky: false)
        }
    }

    @ViewBuilder private func compRowContent(_ c: Comp, title: String, linky: Bool) -> some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title.isEmpty ? "Comparable" : title)
                    .font(.subheadline).foregroundStyle(.primary).lineLimit(1)
                HStack(spacing: 8) {
                    if let p = c.platform, !p.isEmpty {
                        Text(p.uppercased()).font(.caption2).foregroundStyle(.secondary)
                    }
                    if let d = c.sold_date {
                        Text(String(d.prefix(10))).font(.caption2.monospaced()).foregroundStyle(.tertiary)
                    }
                    if let m = c.miles, m > 0 {
                        Text("\(m.formatted()) mi").font(.caption2.monospaced()).foregroundStyle(.tertiary)
                    }
                }
            }
            Spacer()
            if let price = c.sale_price, price > 0 {
                Text(price.formatted(.currency(code: "USD").precision(.fractionLength(0))))
                    .font(.callout.monospacedDigit()).foregroundStyle(.primary)
            }
            if linky {
                Image(systemName: "arrow.up.right").font(.caption2).foregroundStyle(.tertiary)
            }
        }
    }

    private func load() async {
        do {
            comps = try await SupabaseService.client
                .rpc("get_comps_scored",
                     params: CompsParams(p_make: make, p_model: model, p_year: year,
                                         p_exclude_vehicle_id: excludeId, p_limit: 24))
                .execute()
                .value
        } catch {
            loadError = true
            NSLog("NukeCapture comps drill failed: %@", String(describing: error))
        }
        loaded = true
    }
}
