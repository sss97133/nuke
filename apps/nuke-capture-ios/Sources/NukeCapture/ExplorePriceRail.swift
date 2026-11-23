// ExplorePriceRail.swift — the one compact price state on a photo, and the stack behind it.
//
// The rail replaces the bare amount. It places the amount inside a range that has evidence behind it,
// and says which range it is:
//   • a classified ask: the row's AskPosition sold slice, p25..p75, labelled "Rough · cohort sold range".
//     It is a cohort's sold spread, not a condition-adjusted value, so it never says "fair value". It shows
//     only with at least five sales and a slice not marked thin; otherwise the amount stands alone with
//     "No opinion yet".
//   • an auction lot: the live finish estimate's low..high from FinishBoard (read once per feed load),
//     labelled "Projected hammer", only while the board is fresh and the current bid sits at or under the
//     band's top. No action zone: the repo has no validated one.
// A long press on the rail opens "Why this range" (ExploreWhySheet), which serves the rest of the evidence
// once: cohort size and period, basis, venues, mileage, source, as-of; for lots the model, grade, comps
// date, factors and the analog lots with their links.

import SwiftUI

// MARK: Rail math (pure)

struct ExplorePriceRail: Equatable {
    enum Basis: Equatable { case cohort, projected, none }

    let basis: Basis
    /// "Rough · cohort sold range", "Projected hammer", "No opinion yet", or nil (a lot with no projection).
    let caption: String?
    let low: Double?
    let high: Double?
    /// 0...1 positions along the track.
    let bandStart: Double
    let bandEnd: Double
    let marker: Double

    var hasBand: Bool { basis != .none }

    static func plain(caption: String?) -> ExplorePriceRail {
        ExplorePriceRail(basis: .none, caption: caption, low: nil, high: nil, bandStart: 0, bandEnd: 0, marker: 0)
    }

    static let cohortCaption = "Rough · cohort sold range"
    static let projectedCaption = "Projected hammer"
    static let noOpinion = "No opinion yet"

    /// Where `v` sits on a track from `lo` to `hi`, held inside 0...1 (a value outside, or a track with no
    /// width, never leaves the track).
    static func fraction(_ v: Double, lo: Double, hi: Double) -> Double {
        guard v.isFinite, lo.isFinite, hi.isFinite, hi > lo else { return 0 }
        return min(1, max(0, (v - lo) / (hi - lo)))
    }

    /// The track runs a little beyond the band and the marker so neither sits on an end (AskPlacement's margins).
    private static func build(basis: Basis, caption: String, low: Double, high: Double, at: Double) -> ExplorePriceRail {
        let lo = min(low, at) * 0.85
        let hi = max(high, at) * 1.1
        return ExplorePriceRail(basis: basis, caption: caption, low: low, high: high,
                                bandStart: fraction(low, lo: lo, hi: hi), bandEnd: fraction(high, lo: lo, hi: hi),
                                marker: fraction(at, lo: lo, hi: hi))
    }

    /// An ask against its cohort's sold p25..p75; thin, short or missing cohorts read "No opinion yet".
    static func cohort(ask: Double?, position: AskPosition?) -> ExplorePriceRail {
        guard let ask, ask.isFinite, ask > 0 else { return .plain(caption: nil) }
        guard let b = ExploreAnalytics.soldBracket(position) else { return .plain(caption: noOpinion) }
        return build(basis: .cohort, caption: cohortCaption, low: b.p25, high: b.p75, at: ask)
    }

    /// A current bid against the lot's projected hammer band; only from a fresh board, and only while the bid
    /// is positive and at or under the band's top.
    static func projected(bid: Double?, estimate: FinishEstimate?, fresh: Bool) -> ExplorePriceRail {
        guard fresh, let e = estimate, let bid, bid.isFinite, bid > 0,
              e.low > 0, e.high >= e.low, bid <= e.high else { return .plain(caption: nil) }
        return build(basis: .projected, caption: projectedCaption, low: e.low, high: e.high, at: bid)
    }

    static func make(item: ExploreFeedItem, estimate: FinishEstimate?, fresh: Bool) -> ExplorePriceRail {
        switch item.kind {
        case .classified: return cohort(ask: item.amount, position: item.position)
        case .live: return projected(bid: item.amount, estimate: estimate, fresh: fresh)
        }
    }

    /// "$16k", "$16.5k", "$850": short enough for the photo.
    static func compact(_ v: Double) -> String {
        guard v.isFinite else { return "—" }
        guard v >= 1000 else { return "$" + Int(v.rounded()).formatted() }
        let k = v / 1000
        if k >= 100 || k.rounded() == k { return "$" + Int(k.rounded()).formatted() + "k" }
        return "$" + String(format: "%.1f", k) + "k"
    }

    var rangeText: String? {
        guard let low, let high else { return nil }
        return Self.compact(low) + " – " + Self.compact(high)
    }
}

extension ExploreAnalytics {
    /// The sold slice a rail may show: at least five sales, not thin, sold basis, with p25 and p75.
    static func soldBracket(_ pos: AskPosition?) -> (n: Int, p25: Double, p50: Double?, p75: Double,
                                                      slice: AskPosition.PopulationSlice?)? {
        guard let pos = usableCohort(pos) else { return nil }
        if let s = pos.sold {
            guard s.thin != true, s.n >= minSales, let a = s.p25, let b = s.p75, a > 0, b >= a else { return nil }
            return (s.n, a, s.p50, b, s)
        }
        guard pos.asked == nil, pos.p25 > 0, pos.p75 >= pos.p25 else { return nil }
        return (pos.sales, pos.p25, pos.p50, pos.p75, nil)
    }
}

// MARK: The rail on the photo

struct ExplorePriceRailView: View {
    let item: ExploreFeedItem
    let rail: ExplorePriceRail
    /// The card's price chip draws the label (with its chevron) itself.
    var showsLabel = true

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            if showsLabel {
                Text(item.amountLabel)
                    .font(.system(.caption, design: .rounded).weight(.semibold))
                    .foregroundStyle(.white.opacity(0.85))
            }
            Text(LiveBoardView.bidNumber(item.amount))
                .font(.nukeBigNumber)
                .foregroundStyle(.white)
            if rail.hasBand {
                GeometryReader { geo in
                    let w = geo.size.width
                    // One track: the dim line is the scale, the bright segment is the range named below, and the
                    // ringed dot is this price. Nothing else is drawn on it.
                    ZStack(alignment: .leading) {
                        Capsule().fill(.white.opacity(0.25)).frame(height: 4)
                        Capsule().fill(Color.accentColor.opacity(0.95))
                            .frame(width: max(4, w * (rail.bandEnd - rail.bandStart)), height: 8)
                            .offset(x: w * rail.bandStart)
                        Circle().fill(.white)
                            .overlay(Circle().stroke(.black.opacity(0.6), lineWidth: 1.5))
                            .frame(width: 12, height: 12)
                            .offset(x: min(max(0, w * rail.marker - 6), max(0, w - 12)))
                    }
                    .frame(maxHeight: .infinity)
                }
                .frame(height: 14)
            }
            // What the bright segment is, and its ends, in one line ("Projected hammer · $14k – $22k").
            if let line = ExplorePriceRailView.legend(rail) {
                Text(line).font(.caption2.weight(.medium).monospacedDigit()).foregroundStyle(.white.opacity(0.9))
                    .lineLimit(1).minimumScaleFactor(0.8)
            }
        }
        .frame(maxWidth: 200, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(accessibility))
        .accessibilityHint(Text(rail.hasBand || item.kind == .classified ? "Tap for why this range." : ""))
    }

    static func legend(_ rail: ExplorePriceRail) -> String? {
        switch (rail.caption, rail.hasBand ? rail.rangeText : nil) {
        case let (c?, r?): return c + " · " + r
        case let (c?, nil): return c
        case let (nil, r?): return r
        default: return nil
        }
    }

    private var accessibility: String {
        var parts = ["\(item.amountLabel), \(LiveBoardView.bidNumber(item.amount))"]
        if let caption = rail.caption { parts.append(caption) }
        if let range = rail.rangeText { parts.append(range) }
        return parts.joined(separator: ", ")
    }
}

// MARK: Why this range (pure rows)

struct ExploreWhyRow: Equatable, Identifiable {
    let label: String
    let value: String
    /// A row that opens its source listing.
    var url: URL? = nil
    /// A row that opens the existing cohort page.
    var cohort: CohortTarget? = nil
    var id: String { label + "|" + value }
}

enum ExploreWhyStack {
    static func dollars(_ v: Double?) -> String? { v.flatMap { $0.isFinite && $0 > 0 ? AskPlacement.dollars($0) : nil } }

    /// What stands behind the rail, one fact per row, each served here and not on the rail. Nothing is invented:
    /// a row appears only when the record carries it.
    static func rows(item: ExploreFeedItem, estimate: FinishEstimate?, fresh: Bool, now: Date = Date()) -> [ExploreWhyRow] {
        var out: [ExploreWhyRow] = []
        switch item.kind {
        case .classified:
            let cohortTarget: CohortTarget? = {
                guard let y = item.year, let mk = item.make, !mk.isEmpty, let md = item.model, !md.isEmpty else { return nil }
                return CohortTarget(year: y, make: mk, model: md)
            }()
            if let b = ExploreAnalytics.soldBracket(item.position), let pos = ExploreAnalytics.usableCohort(item.position) {
                let name = [pos.cohort, pos.family].map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }.joined(separator: " ")
                out.append(ExploreWhyRow(label: "Cohort", value: name.isEmpty ? "Recorded sales" : name, cohort: cohortTarget))
                out.append(ExploreWhyRow(label: "Sales", value: b.n.formatted()))
                if let a = b.slice?.first_on, let z = b.slice?.last_on {
                    out.append(ExploreWhyRow(label: "Period", value: "\(a) to \(z)"))
                } else if let span = b.slice?.yearSpan {
                    out.append(ExploreWhyRow(label: "Model years", value: span))
                }
                out.append(ExploreWhyRow(label: "Basis", value: "Sold prices, not asking prices"))
                if let m = dollars(b.p50) { out.append(ExploreWhyRow(label: "Cohort median", value: m)) }
                if let ask = item.amount, let place = AskPlacement.placement(pos: pos, ask: ask) {
                    out.append(ExploreWhyRow(label: "This ask", value: place.headline))
                }
                if let venues = AskPlacement.formatHouses(b.slice?.by_source ?? pos.houses) {
                    out.append(ExploreWhyRow(label: "By venue", value: venues))
                }
                if let m = ExploreAnalytics.mileage(miles: item.miles, cohort: pos) {
                    out.append(ExploreWhyRow(label: "Mileage", value: m))
                }
            } else {
                out.append(ExploreWhyRow(label: "Cohort", value: ExploreAnalytics.notEnoughSales, cohort: cohortTarget))
            }
            out.append(ExploreWhyRow(label: "Source", value: item.source, url: item.link))
            if let asOf = item.asOf {
                out.append(ExploreWhyRow(label: "As of", value: asOf.formatted(date: .abbreviated, time: .shortened)))
            }
        case .live:
            if fresh, let e = estimate {
                if let m = e.model { out.append(ExploreWhyRow(label: "Model", value: m)) }
                if let p = dollars(e.estimate) { out.append(ExploreWhyRow(label: "Projection", value: p)) }
                if let g = e.grade {
                    let cov = e.coverage.map { " · coverage " + $0.formatted(.number.precision(.fractionLength(0...2))) } ?? ""
                    out.append(ExploreWhyRow(label: "Grade", value: g + cov))
                }
                if let c = e.compsThrough { out.append(ExploreWhyRow(label: "Comps through", value: c)) }
                for f in e.factors { out.append(ExploreWhyRow(label: "Factor", value: f)) }
                if let b = dollars(e.bidAtEstimate) { out.append(ExploreWhyRow(label: "Bid at estimate", value: b)) }
                out.append(ExploreWhyRow(label: "Estimated", value: e.estimatedAt.formatted(date: .abbreviated, time: .shortened)))
            } else {
                out.append(ExploreWhyRow(label: "Projection", value: "No fresh projection for this lot"))
            }
            out.append(ExploreWhyRow(label: "Source", value: item.source, url: item.link))
        }
        return out
    }
}

// MARK: Why this range (sheet)

struct ExploreWhy: Identifiable, Equatable {
    let item: ExploreFeedItem
    let estimate: FinishEstimate?
    let fresh: Bool
    var id: String { item.id }
}

struct ExploreWhySheet: View {
    let why: ExploreWhy
    /// Opens the existing cohort page; the feed closes this sheet first.
    let onCohort: (CohortTarget) -> Void
    @State private var analogs: [FinishAnalog] = []
    @State private var analogsRead = false
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(ExploreWhyStack.rows(item: why.item, estimate: why.estimate, fresh: why.fresh)) { row in
                        rowView(row)
                    }
                } footer: {
                    Text(why.item.kind == .live
                         ? "A projection from comparable finished lots. It is not a guarantee."
                         : "A cohort's sold spread. It is not a condition-adjusted value.")
                }
                if why.item.kind == .live {
                    Section("Comparable lots") {
                        if analogs.isEmpty {
                            if analogsRead { Text("No comparable lots are recorded for this one.").font(.footnote).foregroundStyle(.secondary) }
                            else { ProgressView() }
                        }
                        ForEach(analogs) { a in analogView(a) }
                    }
                }
            }
            .navigationTitle("Why this range")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .task { await loadAnalogs() }
        }
        .presentationDetents([.medium, .large])
    }

    @ViewBuilder private func rowView(_ row: ExploreWhyRow) -> some View {
        let content = VStack(alignment: .leading, spacing: 2) {
            Text(row.label.uppercased()).font(.caption2.monospaced()).foregroundStyle(.secondary)
            Text(row.value).font(.footnote)
        }
        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
        .contentShape(Rectangle())
        if let c = row.cohort {
            Button { onCohort(c) } label: { content }.buttonStyle(.plain)
        } else if let url = row.url {
            Link(destination: url) { content }
        } else {
            content
        }
    }

    @ViewBuilder private func analogView(_ a: FinishAnalog) -> some View {
        let line = [a.closed.map { "Closed " + $0 }, ExploreWhyStack.dollars(a.finalPrice).map { "Final " + $0 }]
            .compactMap { $0 }.joined(separator: " · ")
        let content = VStack(alignment: .leading, spacing: 2) {
            Text(a.title).font(.footnote.weight(.semibold)).lineLimit(2)
            if !line.isEmpty { Text(line).font(.caption).foregroundStyle(.secondary) }
        }
        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
        .contentShape(Rectangle())
        if let s = a.url, let url = URL(string: s) {
            Link(destination: url) { content }
        } else {
            content
        }
    }

    /// The same read the Market board's bid sheet makes; lots only, one vehicle.
    private func loadAnalogs() async {
        defer { analogsRead = true }
        guard why.item.kind == .live, let id = why.item.lotId else { return }
        analogs = await FinishBoard.fetchAnalogs(vehicleId: id)
    }
}
