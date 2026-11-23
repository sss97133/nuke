// ExplorePriceRail.swift — the one compact price state on a photo, and the stack behind it.
//
// The rail replaces the bare amount. It places the amount inside a range that has evidence behind it,
// and says which range it is:
//   • a classified ask: the fair range from close comparable sales, p25..p75, as `ask_close_comps` states it
//     (ExploreFairRange.swift; the rule of which sales are close lives in that reader). Labelled
//     "Fair range · N close sales". Any other answer, a missing reader or a failed read reads "No opinion yet".
//     The model family's whole sold spread (AskPosition) is never drawn in its place: it mixes trims and decades.
//   • an auction lot: the live finish estimate's low..high from FinishBoard (read once per feed load),
//     labelled "Projected hammer" with the point it projects ("Lands near $X"), only while the board is fresh
//     and the current bid sits at or under the band's top. No "heats up" zone: no validated reader states one
//     (supabase/drafts/auction-action-zone).
// A long press on the rail opens "Why this range" (ExploreWhySheet), which serves the rest of the evidence
// once: for asks the match, the close sales each with its date, price, venue and link, where the ask sits,
// adjustments and confidence; for lots the heat reading, model, grade, comps date, factors and the analog lots.

import SwiftUI

// MARK: Rail math (pure)

struct ExplorePriceRail: Equatable {
    enum Basis: Equatable { case closeComps, projected, none }

    let basis: Basis
    /// "Fair range · 9 close sales", "Projected hammer", "No opinion yet", or nil (a lot with no projection).
    let caption: String?
    let low: Double?
    let high: Double?
    /// The projected landing price (lots only): the estimate inside the band.
    var landing: Double? = nil
    /// 0...1 positions along the track.
    let bandStart: Double
    let bandEnd: Double
    let marker: Double

    var hasBand: Bool { basis != .none }

    static func plain(caption: String?) -> ExplorePriceRail {
        ExplorePriceRail(basis: .none, caption: caption, low: nil, high: nil, bandStart: 0, bandEnd: 0, marker: 0)
    }

    static func fairCaption(_ n: Int) -> String { "Fair range · \(n) close sale" + (n == 1 ? "" : "s") }
    static let projectedCaption = "Projected hammer"
    static let noOpinion = "No opinion yet"

    /// Where `v` sits on a track from `lo` to `hi`, held inside 0...1 (a value outside, or a track with no
    /// width, never leaves the track).
    static func fraction(_ v: Double, lo: Double, hi: Double) -> Double {
        guard v.isFinite, lo.isFinite, hi.isFinite, hi > lo else { return 0 }
        return min(1, max(0, (v - lo) / (hi - lo)))
    }

    /// The track runs a little beyond the band and the marker so neither sits on an end (AskPlacement's margins).
    private static func build(basis: Basis, caption: String, low: Double, high: Double, at: Double,
                              landing: Double? = nil) -> ExplorePriceRail {
        let lo = min(low, at) * 0.85
        let hi = max(high, at) * 1.1
        return ExplorePriceRail(basis: basis, caption: caption, low: low, high: high, landing: landing,
                                bandStart: fraction(low, lo: lo, hi: hi), bandEnd: fraction(high, lo: lo, hi: hi),
                                marker: fraction(at, lo: lo, hi: hi))
    }

    /// An ask against its close comparable sales' p25..p75, only on the reader's "range" verdict; everything
    /// else (no opinion, no reader, a failed read) reads "No opinion yet".
    static func fair(ask: Double?, range: AskFairRange?) -> ExplorePriceRail {
        guard let ask, ask.isFinite, ask > 0 else { return .plain(caption: nil) }
        guard let range, let b = range.band else { return .plain(caption: noOpinion) }
        return build(basis: .closeComps, caption: fairCaption(range.n), low: b.low, high: b.high, at: ask)
    }

    /// A current bid against the lot's projected hammer band; only from a fresh board, and only while the bid
    /// is positive and at or under the band's top.
    static func projected(bid: Double?, estimate: FinishEstimate?, fresh: Bool) -> ExplorePriceRail {
        guard fresh, let e = estimate, let bid, bid.isFinite, bid > 0,
              e.low > 0, e.high >= e.low, bid <= e.high else { return .plain(caption: nil) }
        let landing = e.estimate.isFinite && e.estimate >= e.low && e.estimate <= e.high ? e.estimate : nil
        return build(basis: .projected, caption: projectedCaption, low: e.low, high: e.high, at: bid, landing: landing)
    }

    static func make(item: ExploreFeedItem, estimate: FinishEstimate?, fresh: Bool,
                     fair: AskFairRange? = nil) -> ExplorePriceRail {
        switch item.kind {
        case .classified: return Self.fair(ask: item.amount, range: fair)
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

    var landingText: String? { landing.map { "Lands near " + Self.compact($0) } }
}

// MARK: The rail on the photo

struct ExplorePriceRailView: View {
    let item: ExploreFeedItem
    let rail: ExplorePriceRail

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(item.amountLabel)
                .font(.system(.caption, design: .rounded).weight(.semibold))
                .foregroundStyle(.white.opacity(0.85))
            Text(LiveBoardView.bidNumber(item.amount))
                .font(.nukeBigNumber)
                .foregroundStyle(.white)
            if rail.hasBand {
                GeometryReader { geo in
                    let w = geo.size.width
                    ZStack(alignment: .leading) {
                        Capsule().fill(.white.opacity(0.3)).frame(height: 4)
                        Capsule().fill(.white.opacity(0.8))
                            .frame(width: max(3, w * (rail.bandEnd - rail.bandStart)), height: 6)
                            .offset(x: w * rail.bandStart)
                        Circle().fill(.white)
                            .overlay(Circle().stroke(.black.opacity(0.45), lineWidth: 1))
                            .frame(width: 10, height: 10)
                            .offset(x: min(max(0, w * rail.marker - 5), max(0, w - 10)))
                    }
                    .frame(maxHeight: .infinity)
                }
                .frame(height: 12)
                if let range = rail.rangeText {
                    Text(range).font(.caption2.monospacedDigit()).foregroundStyle(.white.opacity(0.9))
                }
                if let landing = rail.landingText {
                    Text(landing).font(.caption2.monospacedDigit().weight(.semibold)).foregroundStyle(.white)
                }
            }
            if let caption = rail.caption {
                Text(caption).font(.caption2).foregroundStyle(.white.opacity(0.75))
            }
        }
        .frame(maxWidth: 200, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(accessibility))
        .accessibilityHint(Text(rail.hasBand || item.kind == .classified ? "Long press for why this range." : ""))
    }

    private var accessibility: String {
        var parts = ["\(item.amountLabel), \(LiveBoardView.bidNumber(item.amount))"]
        if let caption = rail.caption { parts.append(caption) }
        if let range = rail.rangeText { parts.append(range) }
        if let landing = rail.landingText { parts.append(landing) }
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
    var id: String { label + "|" + value + "|" + (url?.absoluteString ?? "") }
}

enum ExploreWhyStack {
    static func dollars(_ v: Double?) -> String? { v.flatMap { $0.isFinite && $0 > 0 ? AskPlacement.dollars($0) : nil } }

    static let noAdjustments = "None. Close sales are shown as sold, not adjusted for condition or mileage."
    /// What every price in the range is (ask_close_comps reads gross sale prices only, never mixing bases).
    static let basis = "Sold at auction, what the buyer paid with premium, in US dollars"

    /// "Jan 6, 2026" from the reader's ISO day; the raw text when it is not a day.
    static func day(_ s: String?) -> String? {
        guard let s, !s.isEmpty else { return nil }
        let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "yyyy-MM-dd"
        guard let d = f.date(from: String(s.prefix(10))) else { return s }
        let out = DateFormatter(); out.locale = Locale(identifier: "en_US"); out.timeZone = TimeZone(identifier: "UTC")
        out.dateStyle = .medium
        return out.string(from: d)
    }

    /// "Hot: the bid is 1.4× where comparable lots stood with 20 h left ($31,000)". The curve and the hot/cold
    /// thresholds are the board's (LiveAuction.heat, the web's heatOf), never set here.
    static func heatLine(_ h: LiveAuction.Heat) -> String {
        let word: String = { switch h.state { case .hot: return "Hot"; case .cold: return "Cold"; case .inLine: return "In line" } }()
        let ratio = h.ratio.formatted(.number.precision(.fractionLength(1)))
        let hours = Int(h.hoursLeft.rounded())
        let typical = dollars(h.typicalNow).map { " (\($0))" } ?? ""
        return "\(word): the bid is \(ratio)× where comparable sold lots stood with \(hours) h left\(typical)"
    }

    /// What stands behind the rail, one fact per row, each served here and not on the rail. Nothing is invented:
    /// a row appears only when a reader carries it.
    static func rows(item: ExploreFeedItem, estimate: FinishEstimate?, fresh: Bool, fair: AskFairRange? = nil,
                     heat: String? = nil, now: Date = Date()) -> [ExploreWhyRow] {
        var out: [ExploreWhyRow] = []
        switch item.kind {
        case .classified:
            let cohortTarget: CohortTarget? = {
                guard let y = item.year, let mk = item.make, !mk.isEmpty, let md = item.model, !md.isEmpty else { return nil }
                return CohortTarget(year: y, make: mk, model: md)
            }()
            if let fair {
                var match = fair.matchText
                if let a = day(fair.match.windowFrom), let z = day(fair.match.windowTo) { match += " · sold \(a) to \(z)" }
                out.append(ExploreWhyRow(label: "Match", value: match, cohort: cohortTarget))
                if fair.band == nil {
                    out.append(ExploreWhyRow(label: "No opinion yet", value: fair.reason ?? "Too few close sales to say"))
                } else if let m = dollars(fair.mid) {
                    out.append(ExploreWhyRow(label: "Close-sale median", value: m))
                }
                if let place = fair.askPlacement(item.amount) { out.append(ExploreWhyRow(label: "This ask", value: place)) }
                out.append(ExploreWhyRow(label: "Basis", value: basis))
                out.append(ExploreWhyRow(label: "Adjustments", value: noAdjustments))
                var conf = ["\(fair.n.formatted()) close sale" + (fair.n == 1 ? "" : "s")]
                if !fair.venues.isEmpty {
                    conf.append(fair.venues.prefix(3).map { "\($0.name) \($0.n)" }.joined(separator: ", "))
                }
                if let c = fair.conditionKnown { conf.append("condition recorded on \(c) of \(fair.n)") }
                out.append(ExploreWhyRow(label: "Confidence", value: conf.joined(separator: " · ")))
            } else {
                out.append(ExploreWhyRow(label: "No opinion yet", value: "Close sales could not be read for this listing"))
                if let c = cohortTarget {
                    out.append(ExploreWhyRow(label: "Model sales", value: "All \(c.year) \(c.make) \(c.model) sales", cohort: c))
                }
            }
            out.append(ExploreWhyRow(label: "Source", value: item.source, url: item.link))
            if let asOf = item.asOf {
                out.append(ExploreWhyRow(label: "As of", value: asOf.formatted(date: .abbreviated, time: .shortened)))
            }
        case .live:
            if let heat { out.append(ExploreWhyRow(label: "Heat", value: heat)) }
            if fresh, let e = estimate {
                // The rail carries the landing price when the bid sits inside the band; otherwise it is said here once.
                if ExplorePriceRail.projected(bid: item.amount, estimate: e, fresh: fresh).landing == nil,
                   let p = dollars(e.estimate) {
                    out.append(ExploreWhyRow(label: "Projection", value: p))
                }
                if let m = e.model { out.append(ExploreWhyRow(label: "Model", value: m)) }
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

    /// The close sales behind an ask's range, newest first as the reader sends them, each opening its listing.
    static func compRows(_ fair: AskFairRange?) -> [ExploreWhyRow] {
        (fair?.comps ?? []).map { c in
            let value = [dollars(c.price), c.venue, c.title].compactMap { $0 }.joined(separator: " · ")
            return ExploreWhyRow(label: day(c.soldOn) ?? "Undated", value: value, url: c.url)
        }
    }
}

// MARK: Why this range (sheet)

struct ExploreWhy: Identifiable, Equatable {
    let item: ExploreFeedItem
    let estimate: FinishEstimate?
    let fresh: Bool
    var fair: AskFairRange? = nil
    /// The lot's heat line (ExploreWhyStack.heatLine), when the board's curve covers this many hours left.
    var heat: String? = nil
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
                    ForEach(ExploreWhyStack.rows(item: why.item, estimate: why.estimate, fresh: why.fresh,
                                                 fair: why.fair, heat: why.heat)) { row in
                        rowView(row)
                    }
                } footer: {
                    Text(why.item.kind == .live
                         ? "A projection from comparable finished lots, not a guarantee. No price zone for where bidding heats up is drawn: no reader for it has passed validation."
                         : "Built only from close comparable auction sales: where cars like this sold, not what this one is worth. An asking price is not a sale.")
                }
                if why.item.kind == .classified, let fair = why.fair, !fair.comps.isEmpty {
                    Section("Close sales") {
                        ForEach(ExploreWhyStack.compRows(fair)) { row in rowView(row) }
                    }
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
