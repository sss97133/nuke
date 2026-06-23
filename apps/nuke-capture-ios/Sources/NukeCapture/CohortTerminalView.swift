// CohortTerminalView.swift — the COHORT instrument. When a search parses to a
// clean year-make-model, the top result is not a single vehicle but the cohort
// itself: every 1966 Ford Mustang the substrate has seen, read as one population.
//
// RUNS ON: get_make_model_terminal(p_make,p_model,p_year) — a live prod RPC that
// ASSEMBLES aggregates from the substrate (vehicle_events, cohort_members,
// vehicle_production_data, comment_discoveries). Register-then-fetch, the same
// pattern the web uses: register_make_model_subject seeds the subject so a
// first-ever view resolves, then get_make_model_terminal reads it.
//
// DESIGN CANON (CONSTRAINTS C4/C5, the codex amendment): native Apple material —
// stock List/Section grammar, system grouped background, mono digits for every
// number (NUKE's signature lives in the digits, not a skin). Each block carries a
// `populated` flag from the RPC; a false flag renders an HONEST empty line ("Not
// recorded yet"), NEVER a fabricated number or a bare "—" posing as data (the
// cardinal rule). Every comp row DRILLS to its VehicleDetailView source (C10) via
// the SAME .navigationDestination(for: VehicleHeaderRow.self) the host stack
// already registers — the cohort is a lens onto real records, not a dead-end
// dashboard. Proven substrate aggregates and projected/modeled values stay
// visually distinct (a quarterly median is labeled as flow, never as a price).

import SwiftUI
import Charts

// ─── The envelope — get_make_model_terminal's JSON object, decoded exactly.
// Every numeric field is optional: the RPC returns null/absent when a block is an
// intake gap, and an optional that stays nil renders the honest empty state. No
// optional is ever defaulted to a number — that would fabricate data.

struct CohortTerminal: Decodable {
    let resolved: Bool
    let subject_id: String?
    let cohort: Cohort?
    let cohort_count: PopulatedInt?
    let price_distribution: PriceDistribution?
    let price_points: PricePoints?
    let market_flow: MarketFlow?
    let sentiment: Sentiment?
    let dealer_flow: DealerFlow?
    let production: Production?
    let survival: Survival?
    let comps: Comps?

    struct Cohort: Decodable {
        let make: String?
        let model: String?
        let year: Int?
        let grain: String?
    }

    /// cohort_count: { populated, value } — a populated count or an honest gap.
    struct PopulatedInt: Decodable {
        let populated: Bool?
        let value: Int?
    }

    struct PriceDistribution: Decodable {
        let populated: Bool?
        let n: Int?
        let median: Double?
        let p25: Double?
        let p75: Double?
        let min: Double?
        let max: Double?
    }

    // Every priced sale, uncapped + unbiased (NOT the top-N-by-price comps). The honest
    // population for the scatter. n_dated exposes the time-coverage gap so undated sales
    // are SHOWN (in a gutter), never dropped off a time axis.
    struct PricePoints: Decodable {
        let populated: Bool?
        let n: Int?
        let n_dated: Int?
        let points: [Point]?
        struct Point: Decodable, Identifiable {
            let vehicle_id: String?
            let price: Double?
            let date: String?      // "yyyy-MM-dd" or null
            let source: String?
            let miles: Int?
            let url: String?
            var id: String { (vehicle_id ?? "") + (date ?? "") + String(price ?? 0) }
        }
    }

    struct MarketFlow: Decodable {
        let populated: Bool?
        let series: [FlowPoint]?
        struct FlowPoint: Decodable {
            let quarter: String?
            let sales: Int?
            let median_price: Double?
        }
    }

    struct Sentiment: Decodable {
        let populated: Bool?
        let avg_sentiment_score: Double?
        let n: Int?
    }

    struct DealerFlow: Decodable {
        let populated: Bool?
        let top: [Seller]?
        struct Seller: Decodable, Identifiable {
            let seller: String?
            let events: Int?
            let median_price: Double?
            var id: String { (seller ?? "?") }
        }
    }

    struct Production: Decodable {
        let populated: Bool?
        let total_produced: Int?
        let min_produced: Int?
        let max_produced: Int?
        let verified: Bool?
        let rarity_level: String?
        let source_url: String?
    }

    struct Survival: Decodable {
        let populated: Bool?
        let floor_known_members: Int?
    }

    struct Comps: Decodable {
        let populated: Bool?
        let n: Int?
        let rows: [CompRow]?
        struct CompRow: Decodable, Identifiable {
            let vehicle_id: String?
            let year: Int?
            let make: String?
            let model: String?
            let trim: String?
            let sale_price: Double?
            let miles: Int?
            let platform: String?
            let sold_date: String?
            let listing_url: String?
            let image_url: String?
            // Stable identity for ForEach — vehicle_id when present, else a
            // synthesized key so two null-id comps don't collide.
            var id: String {
                if let vid = vehicle_id { return vid }
                let price = sale_price.map { String($0) } ?? ""
                return "\(make ?? "")\(model ?? "")\(price)\(sold_date ?? "")"
            }
        }
    }
}

/// The production-provenance sheet a tapped metric/identity opens. Identifiable so it
/// drives a `.sheet(item:)`; id keyed on the triple so re-tapping is a no-op. Carries the
/// RPC's already-assembled summary so the sheet shows the survival framing without a
/// refetch, then loads the per-row estimates itself to expose the conflict the RPC collapses.
struct ProductionDrill: Identifiable, Hashable {
    let make: String
    let model: String
    let year: Int
    let documented: Int
    let minProduced: Int?
    let maxProduced: Int?
    var id: String { "\(year)|\(make)|\(model)" }
}

struct CohortTerminalView: View {
    let make: String
    let model: String
    let year: Int

    @State private var terminal: CohortTerminal?
    @State private var sentiment: CohortSentiment?   // per-comment 2-axis map (get_make_model_sentiment_points)
    @State private var loaded = false
    @State private var loadError = false
    @State private var drillVehicle: VehicleHeaderRow?   // a comp row / card → its real vehicle record
    @State private var cardSale: SalePoint?              // a tapped dot → its snapshot card
    @State private var pendingPush: String?              // card → "open full profile" after dismiss
    @State private var productionDrill: ProductionDrill? // metric / identity → production provenance

    var body: some View {
        Group {
            if let t = terminal, t.resolved {
                resolvedBody(t)
            } else if loadError {
                ContentUnavailableView {
                    Label("Couldn't load the cohort", systemImage: "wifi.exclamationmark")
                } description: {
                    Text("Check your connection.")
                } actions: {
                    Button("Retry") { Task { await load() } }
                        .buttonStyle(.borderedProminent)
                }
            } else if terminal != nil {
                // resolved == false — a clean, honest "not tracked yet" state, NOT
                // an error. The cohort is real; the substrate just hasn't met it.
                ContentUnavailableView {
                    Label("\(titleString) isn't tracked yet", systemImage: "binoculars")
                } description: {
                    Text("No sales, production, or cohort data for this year-make-model has reached the substrate yet.")
                }
            } else {
                VStack(spacing: 10) {
                    ProgressView()
                    Text("Assembling the cohort…")
                        .font(.system(.footnote, design: .monospaced))
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .navigationTitle("Cohort")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: "\(make)|\(model)|\(year)") { await load() }
        .task(id: "sent|\(make)|\(model)|\(year)") { await loadSentiment() }
    }

    private var titleString: String {
        "\(year) \(make) \(model)".uppercased()
    }

    // ─── The resolved instrument — stock grouped List, block by block. ───────
    @ViewBuilder private func resolvedBody(_ t: CohortTerminal) -> some View {
        List {
            headerSection(t)
            salesSection(t.price_points)
            sentimentSection(t.sentiment)   // 1-axis today; the 2-axis alignment map is data-gated
            compsSection(t.comps)
            // Dealer flow removed (not relevant to a collectible cohort). Production +
            // survival folded into the "Documented of built" header ratio above.
        }
        .listStyle(.insetGrouped)
        // Scatter dots + comp rows drill to the real vehicle record (own destination so
        // it works regardless of how the cohort was reached — push, sheet, or debug root).
        .navigationDestination(item: $drillVehicle) { v in
            VehicleDetailView(vehicleId: v.id.uuidString.lowercased(), embedInNavigationStack: false)
        }
        // A dot opens a SNAPSHOT CARD (key factors) first — not a hard jump. From the
        // card you choose to open the full profile, which pushes after the sheet closes.
        .sheet(item: $cardSale, onDismiss: {
            if let vid = pendingPush, let u = UUID(uuidString: vid) {
                pendingPush = nil
                drillVehicle = VehicleHeaderRow(id: u, year: nil, make: nil, model: nil,
                                                trim: nil, primary_image_url: nil, city: nil, state: nil)
            }
        }) { sale in
            SaleCard(sale: sale, onOpenProfile: { vid in pendingPush = vid; cardSale = nil })
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
        // Production metric / identity word → the provenance sheet (the conflict + the
        // citation gap that the calm face deliberately doesn't carry).
        .sheet(item: $productionDrill) { d in
            ProductionProvenanceSheet(drill: d)
        }
    }

    // ─── HEADER — the cohort identity + the two headline numbers (population,
    // median). The cohort name is the subject; the count and median are its
    // vital signs. Both honor their populated flag.
    @ViewBuilder private func headerSection(_ t: CohortTerminal) -> some View {
        Section {
            // Identity as DRILLABLE chips (reuse BuildStoryHero.IdentityChips), on a
            // grouped-list plate. Tapping any word opens the production provenance —
            // the identity IS the door, same as the hero. Flat (no fake affordance)
            // unless we have a production node to drill to.
            IdentityChips(year: year, make: make, model: model, trim: nil,
                          onScrim: false, onDrill: productionDrillAction(t))
                .padding(.vertical, 2)

            // The vital sign — calm and confident on the face: "68 of ~15–30k built".
            // The hedge (uncited, conflicting, where a citation would come from) lives
            // in the DRILL, not here. Chevron only when there's a production node.
            if let c = t.cohort_count, c.populated == true, let v = c.value {
                if let pr = t.production, pr.populated == true, let made = pr.total_produced {
                    let lo = pr.min_produced ?? made, hi = pr.max_produced ?? made
                    let built = lo == hi ? "~\(kNum(hi))" : "~\(kNum(lo))–\(kNum(hi))"
                    Button { productionDrill = drill(from: t) } label: {
                        metricRow("Documented", "\(int(v)) of \(built) built",
                                  sub: pr.rarity_level?.replacingOccurrences(of: "_", with: " ").capitalized,
                                  drillable: true)
                    }
                    .buttonStyle(.plain)
                } else {
                    metricRow("Documented", int(v), sub: "examples · production count not recorded")
                }
            } else {
                emptyRow("Documented")
            }
        }
    }

    /// Production-drill action for the identity chips — nil (flat, no fake affordance)
    /// unless the RPC carries a production node. Same gate as the metric row.
    private func productionDrillAction(_ t: CohortTerminal) -> (() -> Void)? {
        guard let pr = t.production, pr.populated == true, pr.total_produced != nil else { return nil }
        return { productionDrill = drill(from: t) }
    }

    private func drill(from t: CohortTerminal) -> ProductionDrill {
        // Use the RPC's CANONICAL identity ("K5 Blazer"), not the raw caller string
        // ("Blazer") — the production rows are keyed canonically, so a raw eq misses them.
        ProductionDrill(make: t.cohort?.make ?? make,
                        model: t.cohort?.model ?? model,
                        year: t.cohort?.year ?? year,
                        documented: t.cohort_count?.value ?? 0,
                        minProduced: t.production?.min_produced,
                        maxProduced: t.production?.max_produced)
    }

    // ─── SALES — every individual sale as a dot, colored by source. NO median, NO
    // average: a collectible is individuated; a central tendency averaging a project
    // and a restomod describes neither. Dated sales sit on a time axis (the cloud IS
    // the trend); undated sales are SHOWN in a labeled gutter, never dropped off the
    // axis. Sources are toggleable. The coverage line owns what we don't have.
    @ViewBuilder private func salesSection(_ pp: CohortTerminal.PricePoints?) -> some View {
        Section("SALES") {
            if let pp, pp.populated == true, let raw = pp.points, !raw.isEmpty {
                SalesScatter(points: raw, nDated: pp.n_dated ?? 0, onPeek: { cardSale = $0 })
                    .padding(.vertical, 4)
                    .listRowSeparator(.hidden)
            } else {
                emptyRow("Sales")
            }
        }
    }

    // ─── SENTIMENT — the alignment map. Every real comment is a POINT on two axes:
    // X = polarity (negative ↔ positive), Y = community stance (challenges ↔ vouches the
    // car's claims — the repass axis). The quadrants read like an alignment chart; the
    // signal lives in the minority that adjudicate authenticity, not the enthusiast cloud.
    @ViewBuilder private func sentimentSection(_ s: CohortTerminal.Sentiment?) -> some View {
        Section("SENTIMENT · ALIGNMENT MAP") {
            if let sent = sentiment, let cp = sent.comment_points, cp.populated == true,
               let pts = cp.points, !pts.isEmpty {
                SentimentMap(points: pts,
                             vouch: sent.second_axis?.n_vouch ?? 0,
                             challenge: sent.second_axis?.n_challenge ?? 0,
                             nStance: cp.n_stance ?? 0)
                    .padding(.vertical, 4)
                    .listRowSeparator(.hidden)
            } else if let s, s.populated == true, let score = s.avg_sentiment_score {
                // Fallback: the cohort lacks per-comment scoring — show the one honest scalar.
                metricRow("Discussion tone", sentimentWord(score),
                          sub: s.n.map { "avg over \(int($0)) comments" })
            } else {
                emptyRow("Sentiment")
            }
        }
    }

    private func loadSentiment() async {
        struct P: Encodable { let p_make: String; let p_model: String; let p_year: Int }
        sentiment = try? await SupabaseService.client
            .rpc("get_make_model_sentiment_points", params: P(p_make: make, p_model: model, p_year: year))
            .execute().value
    }

    // ─── DEALER FLOW — the top sellers moving this cohort. Each is an org-entity
    // with an observed service profile (events count, median price), not a
    // hardcoded registry. A null median renders honestly, never a fake 0.
    @ViewBuilder private func dealerSection(_ d: CohortTerminal.DealerFlow?) -> some View {
        Section("DEALER FLOW") {
            if let d, d.populated == true, let top = d.top, !top.isEmpty {
                // Who's MOVING this cohort, ranked — a horizontal bar reads the
                // pecking order instantly where stacked rows don't. Bar length =
                // observed events (the service profile), median price annotated.
                let data: [DealerDatum] = top.compactMap { s in
                    guard let name = s.seller, let e = s.events else { return nil }
                    return DealerDatum(id: name, seller: name, events: e, median: s.median_price)
                }
                if !data.isEmpty {
                    Chart(data) { row in
                        BarMark(
                            x: .value("Events", row.events),
                            y: .value("Seller", row.seller)
                        )
                        .foregroundStyle(Color.accentColor.opacity(0.65))
                        .cornerRadius(3)
                        .annotation(position: .trailing, alignment: .leading) {
                            Text(row.median.map { moneyK($0) } ?? "\(row.events)")
                                .font(.system(size: 10, design: .monospaced))
                                .foregroundStyle(.secondary)
                        }
                    }
                    .chartXAxis(.hidden)
                    .chartYAxis {
                        AxisMarks(position: .leading) { _ in
                            AxisValueLabel(horizontalSpacing: 6)
                        }
                    }
                    .frame(height: CGFloat(data.count) * 34 + 10)
                    .padding(.vertical, 4)
                    .listRowSeparator(.hidden)
                } else {
                    emptyRow("Dealer flow")
                }
            } else {
                emptyRow("Dealer flow")
            }
        }
    }

    // ─── PRODUCTION — total produced + rarity. SOURCED ONLY: rendered only when
    // the RPC carries a source_url (the cardinal rule applied to provenance — a
    // production figure with no citation is not shown). The source is a tappable
    // link (C10: the value drills to where it came from).
    @ViewBuilder private func productionSection(_ p: CohortTerminal.Production?) -> some View {
        Section("PRODUCTION") {
            if let p, p.populated == true, let total = p.total_produced, let src = p.source_url,
               let url = URL(string: src) {
                metricRow("Total produced", int(total), sub: nil)
                if let r = p.rarity_level {
                    plainRow("Rarity", r.replacingOccurrences(of: "_", with: " ").capitalized)
                }
                Link(destination: url) {
                    HStack {
                        Text("Source").font(.footnote)
                        Spacer()
                        Image(systemName: "arrow.up.right.square").font(.caption)
                    }
                }
            } else {
                emptyRow("Production")
            }
        }
    }

    // ─── SURVIVAL — the known floor: at least this many are documented to exist.
    // A FLOOR, never a total (the substrate can only count what it has seen).
    @ViewBuilder private func survivalSection(_ s: CohortTerminal.Survival?) -> some View {
        Section("SURVIVAL") {
            if let s, s.populated == true, let floor = s.floor_known_members {
                metricRow("Known to exist", "≥ \(int(floor))", sub: "documented floor")
            } else {
                emptyRow("Survival floor")
            }
        }
    }

    // ─── COMPS — the real recent sales behind the median. Each row DRILLS to its
    // VehicleDetailView via the host stack's .navigationDestination(for:
    // VehicleHeaderRow.self) — built from the comp's vehicle_id, so the cohort is
    // a lens onto real records, not a terminal page. A comp without a vehicle_id
    // renders as a non-drillable record line (honest: nothing to drill to).
    @ViewBuilder private func compsSection(_ c: CohortTerminal.Comps?) -> some View {
        Section(c?.n.map { "COMPARABLE SALES · \(int($0))" } ?? "COMPARABLE SALES") {
            if let c, c.populated == true, let rows = c.rows, !rows.isEmpty {
                ForEach(rows) { comp in
                    if let vid = comp.vehicle_id, let header = headerRow(for: comp, id: vid) {
                        NavigationLink(value: header) { compRow(comp) }
                    } else {
                        compRow(comp)   // no source row to drill to — honest non-link
                    }
                }
            } else {
                emptyRow("Comparable sales")
            }
        }
    }

    // One comp — thumbnail · title · sold price + miles/platform/date. Mono digits.
    @ViewBuilder private func compRow(_ comp: CohortTerminal.Comps.CompRow) -> some View {
        HStack(spacing: 10) {
            Color(.secondarySystemFill)
                .frame(width: 56, height: 56)
                .overlay {
                    CachedAsyncImage(url: NukeImage.thumb(comp.image_url, width: 160)) { img in
                        img.resizable().scaledToFill()
                    } placeholder: {
                        Image(systemName: "car.side").foregroundStyle(.secondary)
                    }
                }
                .clipped()
                .cornerRadius(4)

            VStack(alignment: .leading, spacing: 3) {
                Text(compTitle(comp))
                    .font(.footnote.weight(.medium))
                    .lineLimit(2)
                HStack(spacing: 6) {
                    if let p = comp.sale_price {
                        Text(money(p))
                            .font(.system(.footnote, design: .monospaced))
                            .foregroundStyle(.primary)
                    }
                    if let m = comp.miles {
                        Text("· \(int(m)) mi")
                            .font(.system(size: 11, design: .monospaced))
                            .foregroundStyle(.secondary)
                    }
                }
                HStack(spacing: 6) {
                    if let plat = comp.platform {
                        Text(plat.uppercased())
                            .font(.system(size: 9, design: .monospaced))
                            .foregroundStyle(.tertiary)
                    }
                    if let d = comp.sold_date {
                        Text(String(d.prefix(10)))
                            .font(.system(size: 9, design: .monospaced))
                            .foregroundStyle(.tertiary)
                    }
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 2)
    }

    private func compTitle(_ comp: CohortTerminal.Comps.CompRow) -> String {
        var parts: [String] = []
        if let y = comp.year { parts.append(String(y)) }
        if let mk = comp.make, !mk.isEmpty { parts.append(mk) }
        if let md = comp.model, !md.isEmpty { parts.append(md) }
        if let tr = comp.trim, !tr.isEmpty { parts.append(tr) }
        return parts.joined(separator: " ")
    }

    /// Build the VehicleHeaderRow the host stack pushes to VehicleDetailView. Only
    /// the id is load-bearing for the drill (VehicleDetailView re-fetches the row
    /// by id); the rest seeds a sensible back-title. nil when the id isn't a UUID.
    private func headerRow(for comp: CohortTerminal.Comps.CompRow, id: String) -> VehicleHeaderRow? {
        guard let uuid = UUID(uuidString: id) else { return nil }
        return VehicleHeaderRow(
            id: uuid,
            year: comp.year,
            make: comp.make,
            model: comp.model,
            trim: comp.trim,
            primary_image_url: comp.image_url,
            city: nil,
            state: nil
        )
    }

    // ─── Shared row primitives (Apple-stock LabeledContent, mono value). ─────
    @ViewBuilder private func metricRow(_ label: String, _ value: String, sub: String?,
                                        drillable: Bool = false) -> some View {
        LabeledContent {
            HStack(spacing: 6) {
                VStack(alignment: .trailing, spacing: 1) {
                    Text(value)
                        .font(.system(.body, design: .monospaced).weight(.medium))
                        .foregroundStyle(.primary)
                    if let sub {
                        Text(sub)
                            .font(.system(size: 10, design: .monospaced))
                            .foregroundStyle(.tertiary)
                    }
                }
                if drillable {
                    Image(systemName: "chevron.right")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.tertiary)
                }
            }
        } label: {
            Text(label).font(.footnote).foregroundStyle(.secondary)
        }
    }

    @ViewBuilder private func priceRow(_ label: String, _ value: Double?, emphasize: Bool = false) -> some View {
        LabeledContent {
            if let v = value {
                Text(money(v))
                    .font(.system(.footnote, design: .monospaced).weight(emphasize ? .semibold : .regular))
                    .foregroundStyle(.primary)
            } else {
                Text("not recorded")
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(.tertiary)
            }
        } label: {
            Text(label).font(.footnote).foregroundStyle(.secondary)
        }
    }

    @ViewBuilder private func plainRow(_ label: String, _ value: String) -> some View {
        LabeledContent {
            Text(value)
                .font(.system(.footnote, design: .monospaced))
                .foregroundStyle(.primary)
                .multilineTextAlignment(.trailing)
        } label: {
            Text(label).font(.footnote).foregroundStyle(.secondary)
        }
    }

    /// The HONEST empty state — a block whose populated flag is false. Reads as an
    /// intake gap ("not recorded yet"), never as a number, never as a bare "—".
    @ViewBuilder private func emptyRow(_ what: String) -> some View {
        LabeledContent {
            Text("not recorded yet")
                .font(.system(.footnote, design: .monospaced))
                .foregroundStyle(.tertiary)
        } label: {
            Text(what).font(.footnote).foregroundStyle(.secondary)
        }
    }

    // ─── Formatting — locale-correct, mono-friendly. ─────────────────────────
    private func money(_ v: Double) -> String {
        v.formatted(.currency(code: "USD").precision(.fractionLength(0)))
    }
    private func int(_ v: Int) -> String { v.formatted(.number.grouping(.automatic)) }
    private func kNum(_ v: Int) -> String {   // 30000 → "30k", 1500 → "1.5k"
        v >= 1000 ? "\((Double(v)/1000).formatted(.number.precision(.fractionLength(v < 10000 ? 1 : 0))))k" : int(v)
    }

    /// Compact money for axis ticks + distribution labels: $31,000 → "$31k".
    private func moneyK(_ v: Double) -> String {
        if abs(v) >= 1000 {
            let k = v / 1000
            return "$\(k.formatted(.number.precision(.fractionLength(k < 10 ? 1 : 0))))k"
        }
        return money(v)
    }

    /// A labeled price tick under the distribution bar. `hi` renders a range (the IQR).
    @ViewBuilder private func valueTick(_ label: String, _ v: Double, hi: Double? = nil,
                                        align: HorizontalAlignment = .leading) -> some View {
        VStack(alignment: align, spacing: 1) {
            Text(hi.map { "\(moneyK(v))–\(moneyK($0))" } ?? moneyK(v))
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(.primary)
            Text(label)
                .font(.system(size: 9, design: .monospaced))
                .foregroundStyle(.tertiary)
        }
    }

    /// Sentiment color/word — the color IS the data (an honest encoding, not decoration).
    private func sentimentColor(_ score: Double) -> Color {
        switch score {
        case ..<0.4: return .red
        case ..<0.6: return .orange
        default:     return .green
        }
    }
    private func sentimentWord(_ score: Double) -> String {
        switch score {
        case ..<0.4: return "Negative"
        case ..<0.6: return "Mixed"
        default:     return "Positive"
        }
    }

    /// "2025-10-01T..." → "Q4 2025" — the human-readable quarter.
    private func quarterLabel(_ raw: String) -> String {
        let date = String(raw.prefix(10))
        let parts = date.split(separator: "-")
        guard parts.count >= 2, let y = Int(parts[0]), let mo = Int(parts[1]) else { return date }
        let q = (mo - 1) / 3 + 1
        return "Q\(q) \(y)"
    }

    /// A 0…1 sentiment score → a labeled reading + the raw value (honest, not a
    /// bare adjective). 0.74 → "Positive (0.74)".
    private func sentimentLabel(_ score: Double) -> String {
        let word: String
        switch score {
        case ..<0.4:  word = "Negative"
        case ..<0.6:  word = "Mixed"
        default:      word = "Positive"
        }
        return "\(word) (\(score.formatted(.number.precision(.fractionLength(2)))))"
    }

    // ─── Register-then-fetch — the web's pattern. register seeds the subject so a
    // first-ever view resolves; its result/errors are ignored on purpose. Then the
    // terminal fetch reads the assembled aggregates.
    private func load() async {
        loadError = false
        struct RegisterParams: Encodable { let p_make: String; let p_model: String; let p_year: Int }
        // Best-effort seed — never blocks or fails the fetch.
        _ = try? await SupabaseService.client
            .rpc("register_make_model_subject",
                 params: RegisterParams(p_make: make, p_model: model, p_year: year))
            .execute()
        do {
            let result: CohortTerminal = try await SupabaseService.client
                .rpc("get_make_model_terminal",
                     params: RegisterParams(p_make: make, p_model: model, p_year: year))
                .execute()
                .value
            terminal = result
            loaded = true
            #if DEBUG
            // Screenshot loop: auto-open a sale's snapshot card (cliclick can't hit a dot).
            if ProcessInfo.processInfo.environment["NUKE_DEBUG_PEEK"] == "1",
               let p = (result.price_points?.points ?? []).first(where: { $0.source == "bat" && $0.vehicle_id != nil })
                       ?? result.price_points?.points?.first(where: { $0.vehicle_id != nil }) {
                cardSale = SalePoint(id: p.id, price: p.price ?? 0, source: p.source ?? "?", x: 0.5,
                                     vehicleId: p.vehicle_id, miles: p.miles, dateStr: p.date, url: p.url)
            }
            if ProcessInfo.processInfo.environment["NUKE_DEBUG_PRODDRILL"] == "1" {
                productionDrill = drill(from: result)
            }
            #endif
        } catch {
            loadError = true
            NSLog("NukeCapture cohort terminal load failed: %@", String(describing: error))
        }
    }
}

// ─── Chart data + the distribution bar (file scope) ──────────────────────────
private struct FlowDatum: Identifiable { let id: Int; let price: Double; let quarter: String }
private struct DealerDatum: Identifiable { let id: String; let seller: String; let events: Int; let median: Double? }

// ─── SALES SCATTER ───────────────────────────────────────────────────────────
/// Every priced sale as a dot, colored by source. Dated sales on a time axis; undated
/// sales in a left "no date" gutter (SHOWN, never dropped). x is precomputed over the
/// FULL set so dots don't move when sources toggle. The cloud is the trend — no median.
private struct SalePoint: Identifiable {
    let id: String
    let price: Double
    let source: String
    let x: Double          // normalized 0…1: <0.16 = undated gutter, ≥0.22 = by date
    let vehicleId: String?
    let miles: Int?
    let dateStr: String?
    let url: String?
}

private struct SalesScatter: View {
    let points: [CohortTerminal.PricePoints.Point]
    let nDated: Int
    let onPeek: (SalePoint) -> Void        // tap a dot → its snapshot card (not a hard jump)
    @State private var focus: String? = nil   // tap a source chip to isolate it; nil = all

    private static let isoFmt: DateFormatter = {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.locale = Locale(identifier: "en_US_POSIX"); return f
    }()
    private static let palette: [Color] = [.blue, .orange, .green, .purple, .red, .teal, .pink, .indigo, .brown, .cyan, .mint, .yellow]

    private var sources: [String] {
        var counts: [String: Int] = [:]
        for p in points { counts[p.source ?? "unknown", default: 0] += 1 }
        return counts.keys.sorted { a, b in
            let ca = counts[a] ?? 0, cb = counts[b] ?? 0
            return ca != cb ? ca > cb : a < b
        }
    }
    private func color(_ s: String) -> Color {
        guard let i = sources.firstIndex(of: s) else { return .gray }
        return Self.palette[i % Self.palette.count]
    }
    private func count(_ s: String) -> Int { points.filter { ($0.source ?? "unknown") == s }.count }

    private var allPoints: [SalePoint] {
        let dates = points.compactMap { $0.date.flatMap { Self.isoFmt.date(from: $0) } }
        let minD = dates.min(); let maxD = dates.max()
        let span = (minD != nil && maxD != nil) ? max(maxD!.timeIntervalSince(minD!), 1) : 1
        return points.map { p in
            let src = p.source ?? "unknown"
            let price = p.price ?? 0
            if let ds = p.date, let d = Self.isoFmt.date(from: ds), let mn = minD {
                let frac = (maxD == minD) ? 0.6 : (d.timeIntervalSince(mn) / span)
                return SalePoint(id: p.id, price: price, source: src, x: 0.22 + 0.76 * frac,
                                 vehicleId: p.vehicle_id, miles: p.miles, dateStr: p.date, url: p.url)
            } else {
                // No date = no time position. ONE vertical line (varies only by price),
                // never a horizontal spread — a fake x would imply a trend it can't have.
                return SalePoint(id: p.id, price: price, source: src, x: 0.06,
                                 vehicleId: p.vehicle_id, miles: p.miles, dateStr: p.date, url: p.url)
            }
        }
    }
    private var visible: [SalePoint] { allPoints }   // nothing hidden; focus dims, never drops

    private var yearRange: (String, String) {
        let dates = points.compactMap { $0.date.flatMap { Self.isoFmt.date(from: $0) } }
        let cal = Calendar.current
        return (dates.min().map { String(cal.component(.year, from: $0)) } ?? "",
                dates.max().map { String(cal.component(.year, from: $0)) } ?? "")
    }

    var body: some View {
        let undatedN = points.count - nDated
        VStack(alignment: .leading, spacing: 10) {
            Chart {
                ForEach(visible) { p in
                    PointMark(x: .value("when", p.x), y: .value("price", p.price))
                        // One restrained ink — no amateur rainbow. Source is a FILTER
                        // (tap a chip to isolate), so color isn't carrying 9 categories.
                        .foregroundStyle(Color.accentColor.opacity(focus == nil || focus == p.source ? 0.8 : 0.12))
                        .symbolSize(focus == p.source ? 130 : 95)
                }
                RuleMark(x: .value("divider", 0.17))
                    .lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 3]))
                    .foregroundStyle(.secondary.opacity(0.3))
            }
            .chartLegend(.hidden)
            .chartXScale(domain: 0...1)
            .chartXAxis {
                AxisMarks(values: [0.06, 0.22, 0.98]) { v in
                    AxisValueLabel {
                        if let d = v.as(Double.self) {
                            if d < 0.16 { Text("no date").font(.system(size: 9, design: .monospaced)) }
                            else if d < 0.6 { Text(yearRange.0).font(.system(size: 9, design: .monospaced)) }
                            else { Text(yearRange.1).font(.system(size: 9, design: .monospaced)) }
                        }
                    }
                }
            }
            .chartYAxis {
                AxisMarks(position: .leading, values: .automatic(desiredCount: 4)) { v in
                    AxisGridLine()
                    AxisValueLabel { if let d = v.as(Double.self) { Text(Self.kMoney(d)) } }
                }
            }
            .frame(height: 300)
            // Every dot is a button: tap → the nearest sale's real vehicle record.
            // A datum you can't drill is a facade; trust comes from reaching the source.
            .chartOverlay { proxy in
                GeometryReader { geo in
                    Rectangle().fill(.clear).contentShape(Rectangle())
                        .onTapGesture { loc in
                            guard let plot = proxy.plotFrame else { return }
                            let o = geo[plot].origin
                            guard let xv: Double = proxy.value(atX: loc.x - o.x),
                                  let yv: Double = proxy.value(atY: loc.y - o.y) else { return }
                            let maxP = max(visible.map(\.price).max() ?? 1, 1)
                            let nearest = visible.min { a, b in
                                (pow(a.x - xv, 2) + pow((a.price - yv)/maxP, 2))
                                  < (pow(b.x - xv, 2) + pow((b.price - yv)/maxP, 2))
                            }
                            if let n = nearest, let vid = n.vehicleId, !vid.isEmpty { _ = vid; onPeek(n) }
                        }
                }
            }

            FlowLayout(spacing: 6) {
                ForEach(sources, id: \.self) { s in
                    let on = (focus == s)
                    Button { focus = on ? nil : s } label: {
                        HStack(spacing: 5) {
                            Text(Self.pretty(s)).font(.system(size: 11, design: .monospaced))
                            Text("\(count(s))").font(.system(size: 10, design: .monospaced))
                                .foregroundStyle(on ? Color.accentColor : .secondary)
                        }
                        .padding(.horizontal, 8).padding(.vertical, 3)
                        .foregroundStyle(on ? Color.accentColor : .primary)
                        .background(Capsule().fill(on ? Color.accentColor.opacity(0.14) : Color(.secondarySystemFill)))
                        .overlay(Capsule().strokeBorder(on ? Color.accentColor.opacity(0.5) : Color.clear, lineWidth: 0.5))
                    }
                    .buttonStyle(.plain)
                }
            }

            Text("\(points.count) sales · \(sources.count) sources · \(nDated) carry a sale date"
                 + (undatedN > 0 ? " · \(undatedN) arrived without one (left of the line)" : ""))
                .font(.system(size: 10, design: .monospaced))
                .foregroundStyle(.tertiary)
        }
    }

    private static func kMoney(_ v: Double) -> String {
        abs(v) >= 1000 ? "$\((v/1000).formatted(.number.precision(.fractionLength(0))))k"
                       : "$\(v.formatted(.number.precision(.fractionLength(0))))"
    }
    private static func pretty(_ s: String) -> String {
        switch s {
        case "bat": return "BaT"
        case "mecum": return "Mecum"
        case "barrettjackson": return "Barrett-Jackson"
        case "gaa-classic-cars": return "GAA"
        case "facebook-saved", "facebook_marketplace": return "Facebook"
        case "craigslist": return "Craigslist"
        case "ClassicCars.com": return "ClassicCars"
        case "user-submission": return "Owner"
        default: return s
        }
    }
}

/// A horizontal box-and-whisker for a five-number price summary. Whisker track =
/// the full range (min→max); the filled box = the inter-quartile range (p25→p75)
/// where the market clusters; the bold tick = the median. Every position is an
/// exact proportion of the real numbers — nothing interpolated or invented.
private struct DistributionBar: View {
    let min: Double, p25: Double, median: Double, p75: Double, max: Double
    var body: some View {
        let span = Swift.max(max - min, 1)
        GeometryReader { geo in
            let w = geo.size.width
            let x: (Double) -> CGFloat = { CGFloat(($0 - min) / span) * w }
            ZStack(alignment: .leading) {
                Capsule()
                    .fill(Color(.tertiarySystemFill))
                    .frame(height: 5)
                RoundedRectangle(cornerRadius: 5)
                    .fill(Color.accentColor.opacity(0.22))
                    .overlay(
                        RoundedRectangle(cornerRadius: 5)
                            .strokeBorder(Color.accentColor.opacity(0.45), lineWidth: 1)
                    )
                    .frame(width: Swift.max(x(p75) - x(p25), 3), height: 28)
                    .offset(x: x(p25))
                Rectangle()
                    .fill(Color.accentColor)
                    .frame(width: 2.5, height: 36)
                    .offset(x: x(median) - 1.25)
            }
        }
        .frame(height: 40)
    }
}

// ─── SNAPSHOT CARD ───────────────────────────────────────────────────────────
/// A tapped sale dot opens THIS — a snapshot of the vehicle's most important
/// factors (photo · sold price · miles · source · date), not a hard jump. From here
/// you choose to open the full profile. Fetches the photo + identity by vehicle_id;
/// the sale facts (price/miles/source/date) come straight from the point.
private struct VehicleSnapshot: Decodable {
    let year: Int?; let make: String?; let model: String?; let trim: String?
    let primary_image_url: String?
}

private struct SaleCard: View {
    let sale: SalePoint
    let onOpenProfile: (String) -> Void
    @State private var v: VehicleSnapshot?
    @State private var loaded = false

    private var title: String {
        let parts = [v?.year.map(String.init), v?.make, v?.model, v?.trim].compactMap { $0 }.filter { !$0.isEmpty }
        return parts.isEmpty ? "Vehicle" : parts.joined(separator: " ")
    }
    private var dateLabel: String { sale.dateStr.map { String($0.prefix(10)) } ?? "no sale date" }
    private func money(_ p: Double) -> String { p.formatted(.currency(code: "USD").precision(.fractionLength(0))) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                ZStack {
                    Color(.secondarySystemFill)
                    if let url = v?.primary_image_url {
                        CachedAsyncImage(url: NukeImage.thumb(url, width: 900)) { i in
                            i.resizable().scaledToFill()
                        } placeholder: { ProgressView() }
                    } else if loaded {
                        Image(systemName: "car.side").font(.largeTitle).foregroundStyle(.secondary)
                    } else { ProgressView() }
                }
                .frame(maxWidth: .infinity).frame(height: 200).clipped()

                VStack(alignment: .leading, spacing: 16) {
                    Text(title).font(.title3.weight(.semibold))

                    // The snapshot — the factors that matter, read at a glance.
                    HStack(alignment: .top, spacing: 0) {
                        factor("SOLD", money(sale.price))
                        factor("MILES", sale.miles.map { "\($0.formatted(.number))" } ?? "—")
                    }
                    HStack(alignment: .top, spacing: 0) {
                        factor("SOURCE", prettySource(sale.source))
                        factor("DATE", dateLabel)
                    }

                    Button { onOpenProfile(sale.vehicleId ?? "") } label: {
                        HStack { Text("Open full profile"); Spacer(); Image(systemName: "arrow.right") }
                            .font(.callout.weight(.medium))
                            .padding()
                            .frame(maxWidth: .infinity)
                            .background(Color.accentColor.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
                    }
                    .buttonStyle(.plain)
                    .disabled(sale.vehicleId == nil)

                    // The price's OWN evidence: the listing where this sale happened.
                    // A price with no reachable source is an assertion; this makes the
                    // dot drill to the auction page that proves it. Absent url → no
                    // fake affordance (honest: the sale carries no captured source).
                    if let u = sale.url, !u.isEmpty, let url = URL(string: u) {
                        Link(destination: url) {
                            HStack { Text("View listing"); Spacer()
                                Text(prettySource(sale.source)).foregroundStyle(.secondary)
                                Image(systemName: "arrow.up.right") }
                                .font(.callout.weight(.medium))
                                .padding()
                                .frame(maxWidth: .infinity)
                                .background(Color(.tertiarySystemFill), in: RoundedRectangle(cornerRadius: 12))
                        }
                    }
                }
                .padding(16)
            }
        }
        .task {
            defer { loaded = true }
            guard let vid = sale.vehicleId else { return }
            let snap: VehicleSnapshot? = try? await SupabaseService.client
                .from("vehicles").select("year,make,model,trim,primary_image_url")
                .eq("id", value: vid).single().execute().value
            v = snap
        }
    }

    @ViewBuilder private func factor(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label).font(.system(size: 10, design: .monospaced)).foregroundStyle(.tertiary)
            Text(value).font(.system(.title3, design: .monospaced).weight(.medium))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Source slug → display label (shared by the scatter chips + the snapshot card).
private func prettySource(_ s: String) -> String {
    switch s {
    case "bat": return "Bring a Trailer"
    case "mecum": return "Mecum"
    case "barrettjackson": return "Barrett-Jackson"
    case "gaa-classic-cars": return "GAA"
    case "facebook-saved", "facebook_marketplace": return "Facebook"
    case "craigslist": return "Craigslist"
    case "ClassicCars.com": return "ClassicCars"
    case "user-submission": return "Owner"
    default: return s
    }
}

// ─── PRODUCTION PROVENANCE SHEET ─────────────────────────────────────────────
/// Opened by tapping "Documented … built" or any header identity word. Shows the
/// survival framing (N documented of ~X built), EVERY production estimate as its own
/// row (the conflict the cohort RPC collapses), and the citation status + where a
/// citation would come from. Provenance lives HERE, not hedged on the calm face. Reads
/// the real rows directly (no RPC); a failed/empty fetch is an honest gap, never faked.
private struct ProdEstimate: Decodable, Identifiable {
    let id: String
    let total_produced: Int?
    let rarity_level: String?
    let rarity_reason: String?
    let trim_level: String?
    let engine_option: String?
    let msrp: Double?
    let data_source: String?
    let source_url: String?
    let verified_by: String?
}

struct ProductionProvenanceSheet: View {
    let drill: ProductionDrill
    @Environment(\.dismiss) private var dismiss
    @State private var rows: [ProdEstimate] = []
    @State private var loaded = false
    @State private var loadFailed = false

    private var anyCited: Bool { rows.contains { ($0.source_url?.isEmpty == false) } }
    private var conflicting: Bool { Set(rows.compactMap { $0.total_produced }).count > 1 }

    var body: some View {
        NavigationStack {
            List {
                survivalSection
                estimatesSection
                citationSection
            }
            .listStyle(.insetGrouped)
            .navigationTitle("Production")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } } }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .task { await load() }
    }

    @ViewBuilder private var survivalSection: some View {
        Section("SURVIVAL") {
            let lo = drill.minProduced, hi = drill.maxProduced
            let builtStr: String = {
                switch (lo, hi) {
                case let (l?, h?) where l != h: return "~\(kk(l))–\(kk(h))"
                case let (_, h?): return "~\(kk(h))"
                case let (l?, _): return "~\(kk(l))"
                default: return "an unrecorded number"
                }
            }()
            VStack(alignment: .leading, spacing: 6) {
                Text("\(drill.documented.formatted(.number)) documented")
                    .font(.system(.title3, design: .monospaced).weight(.semibold))
                Text("of \(builtStr) estimated built")
                    .font(.system(.body, design: .monospaced)).foregroundStyle(.secondary)
                Text("Documented is a floor — the count the substrate has actually met, not a survival estimate. Built is an estimate (below).")
                    .font(.footnote).foregroundStyle(.tertiary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.vertical, 2)
        }
    }

    @ViewBuilder private var estimatesSection: some View {
        Section(rows.count > 1 ? "ESTIMATES · \(rows.count) CONFLICTING" : "ESTIMATE") {
            if loadFailed {
                Label("Couldn't load the production records", systemImage: "wifi.exclamationmark")
                    .font(.footnote).foregroundStyle(.secondary)
            } else if !rows.isEmpty {
                if conflicting {
                    Text("The records disagree. Both are shown — neither is promoted to fact, because neither is cited.")
                        .font(.footnote).foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                        .listRowSeparator(.hidden)
                }
                ForEach(rows) { r in estimateRow(r) }
            } else if loaded {
                Text("No production estimate has reached the substrate for this year-make-model yet.")
                    .font(.footnote).foregroundStyle(.tertiary)
            } else {
                HStack(spacing: 8) { ProgressView(); Text("Loading records…").font(.footnote).foregroundStyle(.secondary) }
            }
        }
    }

    @ViewBuilder private func estimateRow(_ r: ProdEstimate) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(alignment: .firstTextBaseline) {
                Text(r.total_produced.map { "\($0.formatted(.number)) built" } ?? "count not recorded")
                    .font(.system(.body, design: .monospaced).weight(.medium))
                Spacer()
                if let rl = r.rarity_level {
                    Text(rl.replacingOccurrences(of: "_", with: " ").capitalized)
                        .font(.system(size: 11, design: .monospaced).weight(.semibold))
                        .padding(.horizontal, 7).padding(.vertical, 2)
                        .background(Capsule().fill(Color(.tertiarySystemFill)))
                }
            }
            let qual = [r.trim_level, r.engine_option].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
            if !qual.isEmpty {
                Text(qual).font(.system(size: 11, design: .monospaced)).foregroundStyle(.secondary)
            }
            if let reason = r.rarity_reason, !reason.isEmpty {
                Text(reason).font(.footnote).foregroundStyle(.tertiary)
            }
            HStack(spacing: 10) {
                if let m = r.msrp {
                    Text("MSRP " + m.formatted(.currency(code: "USD").precision(.fractionLength(0))))
                        .font(.system(size: 10, design: .monospaced)).foregroundStyle(.tertiary)
                }
                if let u = r.source_url, !u.isEmpty, let url = URL(string: u) {
                    Link(destination: url) {
                        HStack(spacing: 3) { Text(r.data_source ?? "source"); Image(systemName: "arrow.up.right") }
                            .font(.system(size: 10, design: .monospaced))
                    }
                } else {
                    Text("uncited" + (r.data_source.map { " · \($0)" } ?? ""))
                        .font(.system(size: 10, design: .monospaced)).foregroundStyle(.orange)
                }
            }
        }
        .padding(.vertical, 3)
    }

    @ViewBuilder private var citationSection: some View {
        Section("CITATION") {
            if anyCited {
                Label("At least one estimate carries a source link.", systemImage: "checkmark.seal")
                    .font(.footnote).foregroundStyle(.secondary)
            } else if !rows.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Label("These figures are uncited.", systemImage: "exclamationmark.triangle")
                        .font(.footnote.weight(.medium)).foregroundStyle(.orange)
                    Text("They were seeded into the registry without a reference. Until one is attached, the range is shown but not promoted to a verified fact.")
                        .font(.footnote).foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                    Text("A citation would come from a marque production reference — a factory build record, a marque registry, or a primary source (e.g. Wikipedia, a model-specific registry) — recorded as a named source with a URL, the form other production figures in the substrate already carry.")
                        .font(.footnote).foregroundStyle(.tertiary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.vertical, 2)
            }
        }
    }

    private func kk(_ v: Int) -> String {
        v >= 1000 ? "\((Double(v)/1000).formatted(.number.precision(.fractionLength(v < 10000 ? 1 : 0))))k"
                  : v.formatted(.number)
    }

    private func load() async {
        defer { loaded = true }
        do {
            let r: [ProdEstimate] = try await SupabaseService.client
                .from("vehicle_production_data")
                .select("id,total_produced,rarity_level,rarity_reason,trim_level,engine_option,msrp,data_source,source_url,verified_by")
                .eq("make", value: drill.make)
                .eq("model", value: drill.model)
                .eq("year", value: drill.year)
                .order("total_produced", ascending: true)
                .execute().value
            rows = r
        } catch {
            loadFailed = true
            NSLog("NukeCapture production provenance load failed: %@", String(describing: error))
        }
    }
}

// ─── SENTIMENT ALIGNMENT MAP ─────────────────────────────────────────────────
/// get_make_model_sentiment_points — per-comment points on two REAL axes: X polarity
/// (sentiment_score), Y community stance (the repass: challenges ↔ vouches the claims).
struct CohortSentiment: Decodable {
    let resolved: Bool?
    let spectrum: Spectrum?
    let comment_points: CommentPoints?
    let second_axis: SecondAxis?
    struct Spectrum: Decodable { let populated: Bool?; let mean: Double?; let n_positive: Int?; let n_negative: Int?; let n_neutral: Int? }
    struct SecondAxis: Decodable { let populated: Bool?; let label: String?; let n_vouch: Int?; let n_challenge: Int?; let mean: Double? }
    struct CommentPoints: Decodable {
        let populated: Bool?; let n: Int?; let n_stance: Int?; let points: [Pt]?
        struct Pt: Decodable, Identifiable {
            let comment_id: String?; let sentiment: Double?; let stance: Double?
            let kind: String?; let is_seller: Bool?; let author: String?; let likes: Int?; let text: String?
            let source_url: String?   // the listing where this comment was said (drill-to-source)
            var id: String { comment_id ?? "\(author ?? "")\(sentiment ?? 0)\(stance ?? 0)" }
        }
    }
}

/// The alignment map — every comment a point in polarity × stance space. Restrained
/// 3-tone (vouch / challenge / neutral) since the stance IS the data; position carries
/// the rest. Tap a point → read the actual comment (everything drills to its source).
private struct SentimentMap: View {
    let points: [CohortSentiment.CommentPoints.Pt]
    let vouch: Int
    let challenge: Int
    let nStance: Int
    @State private var selected: CohortSentiment.CommentPoints.Pt?

    private func tone(_ p: CohortSentiment.CommentPoints.Pt) -> Color {
        guard let st = p.stance else { return .gray }
        return st > 0.2 ? .blue : st < -0.2 ? .orange : Color.secondary
    }

    private func edgeLabel(_ s: String) -> some View {
        Text(s).font(.system(size: 9, weight: .semibold, design: .monospaced))
            .foregroundStyle(.tertiary).padding(3)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Chart {
                RuleMark(x: .value("zero", 0)).foregroundStyle(.secondary.opacity(0.25)).lineStyle(StrokeStyle(lineWidth: 0.5))
                RuleMark(y: .value("zero", 0)).foregroundStyle(.secondary.opacity(0.25)).lineStyle(StrokeStyle(lineWidth: 0.5))
                ForEach(points) { p in
                    PointMark(x: .value("Sentiment", p.sentiment ?? 0), y: .value("Stance", p.stance ?? 0))
                        .foregroundStyle(tone(p).opacity(0.75))
                        .symbolSize(p.id == selected?.id ? 150 : 65)
                }
            }
            .chartXScale(domain: -1.05...1.05)
            .chartYScale(domain: -1.05...1.05)
            .chartXAxis(.hidden)   // axis meaning reads from the compass labels (no clipping tick text)
            .chartYAxis(.hidden)
            .frame(height: 300)
            .overlay(alignment: .top)      { edgeLabel("vouches") }
            .overlay(alignment: .bottom)   { edgeLabel("challenges") }
            .overlay(alignment: .leading)  { edgeLabel("negative") }
            .overlay(alignment: .trailing) { edgeLabel("positive") }
            .chartOverlay { proxy in
                GeometryReader { geo in
                    Rectangle().fill(.clear).contentShape(Rectangle())
                        .onTapGesture { loc in
                            guard let plot = proxy.plotFrame else { return }
                            let o = geo[plot].origin
                            guard let xv: Double = proxy.value(atX: loc.x - o.x),
                                  let yv: Double = proxy.value(atY: loc.y - o.y) else { return }
                            selected = points.min { a, b in
                                (pow((a.sentiment ?? 0)-xv, 2)+pow((a.stance ?? 0)-yv, 2))
                                  < (pow((b.sentiment ?? 0)-xv, 2)+pow((b.stance ?? 0)-yv, 2)) }
                        }
                }
            }

            Text("\(points.count) comments · \(vouch) vouch · \(challenge) challenge · tap a point to read it")
                .font(.system(size: 10, design: .monospaced)).foregroundStyle(.tertiary)
        }
        .sheet(item: $selected) { p in CommentPeek(p: p) }
    }
}

private struct CommentPeek: View {
    let p: CohortSentiment.CommentPoints.Pt
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    HStack(spacing: 6) {
                        Text(p.author ?? "anon").font(.subheadline.weight(.semibold))
                        if p.is_seller == true {
                            Text("SELLER").font(.system(size: 9, design: .monospaced))
                                .padding(.horizontal, 5).padding(.vertical, 2)
                                .background(Capsule().fill(Color(.tertiarySystemFill)))
                        }
                        Spacer()
                        if let l = p.likes, l > 0 {
                            Label("\(l)", systemImage: "hand.thumbsup").font(.caption2).foregroundStyle(.secondary)
                        }
                    }
                    Text(p.text ?? "").font(.body).fixedSize(horizontal: false, vertical: true)
                    HStack(spacing: 20) {
                        axisChip("polarity", p.sentiment)
                        axisChip("stance", p.stance)
                    }
                    // Drill to where it was said — the listing this comment lives on.
                    // A scored comment with no reachable source is an unfalsifiable claim.
                    if let u = p.source_url, !u.isEmpty, let url = URL(string: u) {
                        Link(destination: url) {
                            HStack { Image(systemName: "text.bubble"); Text("Read in context"); Spacer()
                                Image(systemName: "arrow.up.right") }
                                .font(.callout.weight(.medium))
                                .padding()
                                .frame(maxWidth: .infinity)
                                .background(Color(.tertiarySystemFill), in: RoundedRectangle(cornerRadius: 12))
                        }
                        .padding(.top, 4)
                    }
                }
                .padding()
            }
            .navigationTitle("Comment").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } } }
        }
        .presentationDetents([.medium])
        .presentationDragIndicator(.visible)
    }
    @ViewBuilder private func axisChip(_ label: String, _ v: Double?) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.system(size: 9, design: .monospaced)).foregroundStyle(.tertiary)
            Text(v.map { String(format: "%+.2f", $0) } ?? "—")
                .font(.system(.body, design: .monospaced).weight(.medium))
        }
    }
}
