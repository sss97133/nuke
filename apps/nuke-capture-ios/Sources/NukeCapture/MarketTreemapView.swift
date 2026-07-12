// MarketTreemapView — the market as a treemap, sized by inventory volume.
//
// A drill instrument, not decoration: makes (treemap_by_brand) → tap a make → its
// models (treemap_models_by_brand) → tap a model → its years (treemap_years) → tap a
// year → the CohortTerminal (via ExploreView's CohortTarget destination). Each cell
// is a real row; nothing renders that the RPC didn't return. Anon client only.
//
// Grammar per the design canon: Apple-stock components, mono digits, structure over
// color — a neutral fill with a hairline border, weight carried by AREA and the label.

import SwiftUI
import UIKit

/// One treemap cell. market_pulse / market_pulse_filtered — avg_year is present only
/// on the filtered path (nil on the fast matview), so it's optional.
struct TreemapNode: Decodable, Identifiable, Hashable {
    let name: String
    let count: Int
    let value: Int
    let median_price: Int?
    let sold_count: Int?
    let avg_year: Int?
    let image_url: String?     // representative car (the priciest in the group)
    let sell_through: Int?     // velocity % — drives the heatmap color at every level
    var id: String { name }
}

/// The pivot dimension — the same market grouped a different way. "Metros" used to be
/// one of these frozen into its own tab; here it's just one choice among five.
enum PulseDim: String, CaseIterable, Identifiable {
    case make, model, year, price, mileage, color, popularity, metro, dow
    var id: String { rawValue }
    var label: String {
        switch self {
        case .make: return "Make"
        case .model: return "Model"
        case .year: return "Year"
        case .price: return "Price"
        case .mileage: return "Mileage"
        case .color: return "Color"
        case .popularity: return "Popularity"
        case .metro: return "Metro"
        case .dow: return "Day"
        }
    }
}

/// One step down the recursive pulse: the accumulated filters + the dimension to group
/// by next (nil = we've narrowed to make·model·year, so the leaf is the cars). Rides
/// ExploreView's NavigationStack; Hashable so a tap pushes it.
struct TreemapStep: Hashable {
    let filters: [String: String]
    let groupBy: String?
}

/// The drill order — a pulse narrows through make → model → year, then the cars.
/// Tapping any cell adds its value as a filter and advances to the first of these
/// not yet pinned; when all three are pinned, the next step is the leaf grid.
func nextGroupBy(after filters: [String: String]) -> String? {
    ["make", "model", "year"].first { filters[$0] == nil }
}

/// Params for market_pulse (top-level) and market_pulse_filtered (drilled).
private struct MarketPulseParams: Encodable { let p_dimension: String; let p_limit: Int }
/// market_position — carries the velocity metric (sell_through) for the heatmap color.
private struct PositionRow: Decodable {
    let name: String; let volume: Int; let sell_through: Int
    let demand: Int?; let avg_year: Int?; let median_price: Int?
}
private struct PulseFilterParams: Encodable {
    let p_group_by: String
    let p_filters: [String: String]
    let p_limit: Int
}

struct MarketTreemapView: View {
    /// Accumulated pins (empty at the top of the pulse) and the dimension to group by
    /// when we're drilled (nil at top → the segmented picker chooses).
    var filters: [String: String] = [:]
    var fixedGroupBy: PulseDim? = nil

    @State private var dim: PulseDim = .make
    @State private var nodes: [TreemapNode] = []
    @State private var loading = true
    @State private var failed = false
    // The power-law tail we did NOT draw as cells (too many, too small) — surfaced as a
    // thin honest footer instead of a giant block that would dominate the head.
    @State private var tail: (groups: Int, cars: Int)? = nil

    private var isTop: Bool { filters.isEmpty && fixedGroupBy == nil }
    private var groupBy: PulseDim { fixedGroupBy ?? dim }

    private var maxCount: Int { nodes.map(\.count).max() ?? 1 }
    private var minCount: Int { nodes.map(\.count).min() ?? 0 }
    private func magnitude(_ c: Int) -> Double {
        let hi = Double(maxCount), lo = Double(minCount)
        guard hi > lo else { return 0.55 }
        return (Double(c) - lo) / (hi - lo)
    }
    // A designed neutral ramp (mode-independent): pale slate → deep ink. sqrt spreads
    // the crowded low end so mid-size cells still read as distinct.
    private func rampColor(_ t: Double) -> Color {
        let s = max(0, min(1, t)).squareRoot()
        func mix(_ a: Double, _ b: Double) -> Double { a + (b - a) * s }
        return Color(red: mix(0.95, 0.13), green: mix(0.95, 0.15), blue: mix(0.96, 0.19))
    }

    // Interaction layer: every cell is a tradeable instrument you can watch/save (right-
    // click / long-press), with haptics. Persisted locally, real state.
    @StateObject private var lists = PulseLists.shared
    private let haptic = UIImpactFeedbackGenerator(style: .medium)

    // Diverging heatmap: stagnant (low sell-through) = muted red → slate → liquid = green.
    // All tones dark enough for white text. Anchored on a fixed 0–55% scale so color means
    // the same thing regardless of which makes are on screen.
    private func velocityColor(_ pct: Int) -> Color {
        let t = max(0, min(1, Double(pct) / 55.0))
        func m(_ a: Double, _ b: Double, _ u: Double) -> Double { a + (b - a) * u }
        if t < 0.5 { let u = t / 0.5
            return Color(red: m(0.62, 0.34, u), green: m(0.20, 0.36, u), blue: m(0.22, 0.40, u)) }
        let u = (t - 0.5) / 0.5
        return Color(red: m(0.34, 0.13, u), green: m(0.36, 0.52, u), blue: m(0.40, 0.30, u))
    }
    // The cell's fill + whether text should be light. Velocity heatmap where we have it,
    // else the neutral magnitude ramp.
    private func cellColor(_ n: TreemapNode) -> (fill: Color, dark: Bool) {
        if let s = n.sell_through { return (velocityColor(s), true) }
        let t = magnitude(n.count); return (rampColor(t), t.squareRoot() > 0.46)
    }
    private var hasVelocity: Bool { nodes.contains { $0.sell_through != nil } }

    // The instrument menu — every make/model/cohort is a thing you can watch, save, share.
    @ViewBuilder private func cellMenu(_ n: TreemapNode) -> some View {
        let watched = lists.watched.contains(n.name)
        let saved = lists.saved.contains(n.name)
        Section(n.name) {
            Button {
                haptic.impactOccurred(); lists.toggleWatch(n.name)
            } label: {
                Label(watched ? "Watching" : "Watch", systemImage: watched ? "eye.fill" : "eye")
            }
            Button {
                haptic.impactOccurred(); lists.toggleSave(n.name)
            } label: {
                Label(saved ? "Saved" : "Save", systemImage: saved ? "bookmark.fill" : "bookmark")
            }
        }
        ShareLink(item: shareText(n)) { Label("Share", systemImage: "square.and.arrow.up") }
    }
    private func shareText(_ n: TreemapNode) -> String {
        var s = "\(n.name) — \(n.count.formatted()) in the market"
        if let v = n.sell_through { s += " · \(v)% sell-through" }
        return s
    }

    var body: some View {
        VStack(spacing: 0) {
            if isTop {
                // The pivot: one market, grouped by whatever the question needs — a
                // scrolling bar of dimensions (too many now for a segmented control).
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 7) {
                        ForEach(PulseDim.allCases) { d in
                            let on = (d == dim)
                            Button { dim = d } label: {
                                Text(d.label)
                                    .font(.system(.subheadline).weight(on ? .semibold : .regular))
                                    .padding(.horizontal, 13).padding(.vertical, 6)
                                    .background(on ? Color.primary : Color(uiColor: .secondarySystemFill),
                                                in: Capsule())
                                    .foregroundStyle(on ? Color(uiColor: .systemBackground) : .primary)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, 12)
                }
                .padding(.top, 4).padding(.bottom, 6)
            } else {
                breadcrumb
            }

            Group {
                if loading && nodes.isEmpty {
                    VStack(spacing: 10) {
                        ProgressView()
                        Text("Reading the market…")
                            .font(.system(.footnote, design: .monospaced))
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if failed && nodes.isEmpty {
                    ContentUnavailableView {
                        Label("Couldn't load", systemImage: "wifi.exclamationmark")
                    } actions: {
                        Button("Retry") { Task { await load() } }.buttonStyle(.borderedProminent)
                    }
                } else if nodes.isEmpty {
                    ContentUnavailableView("No data", systemImage: "square.grid.2x2")
                } else {
                    VStack(spacing: 0) {
                        GeometryReader { geo in
                            let laid = squarify(nodes, in: CGRect(origin: .zero, size: geo.size))
                            ZStack(alignment: .topLeading) {
                                ForEach(laid, id: \.node.id) { item in
                                    // Tap → deeper treemap / the cars. Long-press (right-
                                    // click) → the instrument menu: watch, save, share.
                                    NavigationLink(value: step(item.node)) { cellBody(item.node) }
                                        .buttonStyle(.plain)
                                        .contextMenu { cellMenu(item.node) }
                                        .frame(width: max(item.rect.width - 1, 0),
                                               height: max(item.rect.height - 1, 0))
                                        .offset(x: item.rect.minX, y: item.rect.minY)
                                }
                            }
                        }
                        .padding(1)
                        .background(Color(uiColor: .systemGroupedBackground))
                        .overlay(alignment: .topTrailing) { if hasVelocity { heatLegend } }
                        tailFooter
                    }
                }
            }
        }
        .task(id: "\(groupBy.rawValue)|\(filters.sorted { $0.key < $1.key }.map { "\($0)=\($1)" }.joined(separator: ","))") {
            await load()
        }
    }

    // The pin path so a drilled treemap says where it is: "Chevrolet › Corvette · by year".
    private var breadcrumb: some View {
        let pins = ["make", "model", "year", "metro", "dow"].compactMap { filters[$0] }
        return HStack(spacing: 6) {
            Text(pins.joined(separator: " › "))
                .font(.system(.subheadline).weight(.semibold)).lineLimit(1)
            Spacer(minLength: 8)
            Text("by \(groupBy.label)")
                .font(.system(.caption, design: .monospaced)).foregroundStyle(.secondary)
        }
        .padding(.horizontal, 14).padding(.top, 4).padding(.bottom, 6)
    }

    // The next step: pin this cell's value, advance the group-by; nil group-by = the cars.
    private func step(_ n: TreemapNode) -> TreemapStep {
        var f = filters
        f[groupBy.rawValue] = n.name
        return TreemapStep(filters: f, groupBy: nextGroupBy(after: f))
    }

    // The cell. Surface tinted by magnitude (deep = big) so hierarchy reads instantly;
    // the name anchors the top and the big TABULAR count anchors the BOTTOM, so the
    // stat spans the cell height instead of floating in a void. Contrast-aware text,
    // single-line name (scaled to fit — never a mid-word hyphen).
    @ViewBuilder private func cellBody(_ n: TreemapNode) -> some View {
        let (fill, dark) = cellColor(n)
        GeometryReader { g in
            let big = g.size.width >= 144 && g.size.height >= 92
            let mid = g.size.height >= 50 && g.size.width >= 80
            let fg: Color = dark ? .white : Color(white: 0.12)
            // Name + number as one block, vertically CENTERED — balanced whitespace on
            // any cell shape (no one-sided void in tall-thin cells).
            VStack(alignment: .leading, spacing: big ? 4 : 1) {
                Text(n.name)
                    .font(.system(big ? .title3 : (mid ? .subheadline : .caption)).weight(.semibold))
                    .lineLimit(1).minimumScaleFactor(0.45).allowsTightening(true)
                    .foregroundStyle(fg)
                if mid {
                    Text(n.count.formatted())
                        .font(.system(size: big ? 34 : 15, weight: .semibold).monospacedDigit())
                        .foregroundStyle(fg.opacity(0.9))
                        .lineLimit(1).minimumScaleFactor(0.5)
                }
            }
            .padding(big ? 11 : 6)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            .background(fill)
            .overlay(alignment: .topTrailing) {
                if mid, lists.watched.contains(n.name) || lists.saved.contains(n.name) {
                    Image(systemName: lists.watched.contains(n.name) ? "eye.fill" : "bookmark.fill")
                        .font(.system(size: 8)).foregroundStyle(dark ? .white : Color(white: 0.2))
                        .padding(5)
                }
            }
            .overlay(Rectangle().stroke(.black.opacity(0.06), lineWidth: 0.5))
            .contentShape(Rectangle())
        }
    }

    // What the color means: sell-through velocity, slow (red) → fast (green).
    private var heatLegend: some View {
        HStack(spacing: 5) {
            Text("SLOW").font(.system(size: 8, weight: .semibold, design: .monospaced))
            LinearGradient(colors: [velocityColor(5), velocityColor(28), velocityColor(52)],
                           startPoint: .leading, endPoint: .trailing)
                .frame(width: 40, height: 5).clipShape(Capsule())
            Text("FAST").font(.system(size: 8, weight: .semibold, design: .monospaced))
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 8).padding(.vertical, 4)
        .background(.black.opacity(0.35), in: Capsule())
        .padding(8)
    }

    // The tail as an honest one-line footer — never a proportional block that would
    // swamp the head (the tail is often a third of the market).
    @ViewBuilder private var tailFooter: some View {
        if let t = tail {
            HStack {
                Text("+\(t.groups) more \(groupBy.label.lowercased())s · \(t.cars.formatted()) cars not shown")
                    .font(.system(.caption2, design: .monospaced))
                    .foregroundStyle(.secondary)
                Spacer()
            }
            .padding(.horizontal, 12).padding(.vertical, 5)
            .background(Color(uiColor: .systemGroupedBackground))
        }
    }

    private func load() async {
        loading = true; failed = false
        do {
            // The un-pinned MAKE view is the full heatmap: area = inventory, color =
            // sell-through velocity (market_position). Every other lens is the neutral
            // magnitude ramp (no velocity metric baked for those dims yet).
            if isTop && groupBy == .make {
                let prows: [PositionRow] = try await SupabaseService.client
                    .rpc("market_position", params: MarketPulseParams(p_dimension: "make", p_limit: 250))
                    .execute().value
                let sorted = prows.filter { $0.volume > 0 }.sorted { $0.volume > $1.volume }
                nodes = sorted.map { TreemapNode(name: $0.name, count: $0.volume, value: $0.volume,
                                                 median_price: $0.median_price, sold_count: nil,
                                                 avg_year: $0.avg_year, image_url: nil,
                                                 sell_through: $0.sell_through) }
                tail = nil; loading = false
                return
            }
            let rows: [TreemapNode]
            // Fast matview for the un-pinned landing (except model, whose matview name is
            // "Make Model" and can't be re-filtered); everything drilled goes live+filtered.
            if filters.isEmpty && groupBy != .model {
                rows = try await SupabaseService.client
                    .rpc("market_pulse", params: MarketPulseParams(p_dimension: groupBy.rawValue, p_limit: 300))
                    .execute().value
            } else {
                rows = try await SupabaseService.client
                    .rpc("market_pulse_filtered",
                         params: PulseFilterParams(p_group_by: groupBy.rawValue, p_filters: filters, p_limit: 300))
                    .execute().value
            }
            // Industry standard (finviz market heatmap): show EVERY category, sized to
            // scale — no "Other" bucket, no data hidden. The power-law tail is small
            // cells (that's the truth), labeled only where they fit; drill for the rest.
            nodes = rows.filter { $0.count > 0 }.sorted { $0.count > $1.count }
            tail = nil
            loading = false
        } catch {
            failed = true; loading = false
        }
    }
}

// ─── Squarified treemap layout ───────────────────────────────────────────────────
private struct Laid { let node: TreemapNode; let rect: CGRect }

/// Classic squarified treemap — keeps cells near-square so labels stay readable.
private func squarify(_ nodes: [TreemapNode], in bounds: CGRect) -> [Laid] {
    let items = nodes.filter { $0.value > 0 }
    guard !items.isEmpty, bounds.width > 0, bounds.height > 0 else { return [] }
    let total = items.reduce(0.0) { $0 + Double($1.value) }
    let scale = Double(bounds.width * bounds.height) / total
    var areas = items.map { (node: $0, area: Double($0.value) * scale) }

    var result: [Laid] = []
    var rect = bounds
    var row: [(node: TreemapNode, area: Double)] = []

    func shortSide() -> Double { Double(min(rect.width, rect.height)) }
    func worst(_ r: [(node: TreemapNode, area: Double)], _ w: Double) -> Double {
        guard !r.isEmpty, w > 0 else { return .infinity }
        let s = r.reduce(0.0) { $0 + $1.area }
        let mx = r.map(\.area).max() ?? 0, mn = r.map(\.area).min() ?? 0
        guard s > 0, mn > 0 else { return .infinity }
        let w2 = w * w, s2 = s * s
        return max(w2 * mx / s2, s2 / (w2 * mn))
    }
    func layoutRow(_ r: [(node: TreemapNode, area: Double)]) {
        let s = r.reduce(0.0) { $0 + $1.area }
        guard s > 0 else { return }
        let horizontal = rect.width >= rect.height
        // A wide rect lays a column spanning its HEIGHT (thickness = area / height);
        // a tall rect lays a row spanning its WIDTH. Dividing by the wrong side leaves
        // the rect unconsumed — the empty grey box.
        let thickness = s / Double(horizontal ? rect.height : rect.width)
        guard thickness > 0 else { return }
        var pos = horizontal ? Double(rect.minY) : Double(rect.minX)
        for it in r {
            let len = it.area / thickness
            let rr: CGRect = horizontal
                ? CGRect(x: rect.minX, y: pos, width: thickness, height: len)
                : CGRect(x: pos, y: rect.minY, width: len, height: thickness)
            result.append(Laid(node: it.node, rect: rr))
            pos += len
        }
        if horizontal {
            rect = CGRect(x: rect.minX + thickness, y: rect.minY, width: rect.width - thickness, height: rect.height)
        } else {
            rect = CGRect(x: rect.minX, y: rect.minY + thickness, width: rect.width, height: rect.height - thickness)
        }
    }

    while !areas.isEmpty {
        let next = areas[0]
        if row.isEmpty || worst(row, shortSide()) >= worst(row + [next], shortSide()) {
            row.append(next); areas.removeFirst()
        } else {
            layoutRow(row); row = []
        }
    }
    if !row.isEmpty { layoutRow(row) }
    return result
}

// ─── Leaf: a fully-narrowed pulse → the actual cars ──────────────────────────────
/// The cars behind an accumulated filter set (vehicles_by_filters) — same photo grid
/// + same VehicleDetailView destination as search, so the pulse flows all the way to
/// one car.
struct FilteredVehicleGrid: View {
    let filters: [String: String]
    @State private var rows: [VehicleHeaderRow] = []
    @State private var loading = true
    @State private var failed = false
    private let columns = Array(repeating: GridItem(.flexible(), spacing: 2), count: 3)

    private var title: String {
        ["make", "model", "year", "metro", "dow"].compactMap { filters[$0] }.joined(separator: " ")
    }

    var body: some View {
        Group {
            if loading && rows.isEmpty {
                VStack(spacing: 10) {
                    ProgressView()
                    Text("Loading cars…")
                        .font(.system(.footnote, design: .monospaced)).foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if failed && rows.isEmpty {
                ContentUnavailableView {
                    Label("Couldn't load", systemImage: "wifi.exclamationmark")
                } actions: {
                    Button("Retry") { Task { await load() } }.buttonStyle(.borderedProminent)
                }
            } else if rows.isEmpty {
                ContentUnavailableView("No photographed cars", systemImage: "car.side")
            } else {
                ScrollView {
                    LazyVGrid(columns: columns, spacing: 2) {
                        ForEach(rows) { v in
                            NavigationLink(value: v) { cell(v) }.buttonStyle(.plain)
                        }
                    }
                }
            }
        }
        .navigationTitle(title.isEmpty ? "Cars" : title)
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    @ViewBuilder private func cell(_ v: VehicleHeaderRow) -> some View {
        Color(.secondarySystemFill)
            .aspectRatio(1, contentMode: .fit)
            .overlay {
                CachedAsyncImage(url: NukeImage.thumb(v.primary_image_url, width: 200)) { img in
                    img.resizable().scaledToFill()
                } placeholder: {
                    Image(systemName: "car.side").font(.title2).foregroundStyle(.secondary)
                }
            }
            .clipped()
            .contentShape(Rectangle())
    }

    private func load() async {
        loading = true; failed = false
        do {
            rows = try await SupabaseService.client
                .rpc("vehicles_by_filters", params: VehiclesByFiltersParams(p_filters: filters))
                .execute().value
            loading = false
        } catch {
            failed = true; loading = false
        }
    }
}

/// Params for vehicles_by_filters — p_filters lands as jsonb.
private struct VehiclesByFiltersParams: Encodable {
    let p_filters: [String: String]
}

// ─── Watchlist + saved: real, persisted (UserDefaults). Every pulse cell is a thing
// you can track. Shared so the badges + menu stay in sync across views. ────────────
final class PulseLists: ObservableObject {
    static let shared = PulseLists()
    @Published private(set) var watched: Set<String>
    @Published private(set) var saved: Set<String>
    private let d = UserDefaults.standard
    private init() {
        watched = Set(d.stringArray(forKey: "pulse.watched") ?? [])
        saved = Set(d.stringArray(forKey: "pulse.saved") ?? [])
    }
    func toggleWatch(_ n: String) {
        if watched.contains(n) { watched.remove(n) } else { watched.insert(n) }
        d.set(Array(watched), forKey: "pulse.watched")
    }
    func toggleSave(_ n: String) {
        if saved.contains(n) { saved.remove(n) } else { saved.insert(n) }
        d.set(Array(saved), forKey: "pulse.saved")
    }
}
