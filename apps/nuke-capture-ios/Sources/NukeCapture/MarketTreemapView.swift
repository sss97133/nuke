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
                                    // Tap → deeper treemap, or the cars at the leaf.
                                    NavigationLink(value: step(item.node)) { cellBody(item.node) }
                                        .buttonStyle(.plain)
                                        .frame(width: max(item.rect.width - 1, 0),
                                               height: max(item.rect.height - 1, 0))
                                        .offset(x: item.rect.minX, y: item.rect.minY)
                                }
                            }
                        }
                        .padding(1)
                        .background(Color(uiColor: .systemGroupedBackground))
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
        let t = magnitude(n.count)
        let dark = t.squareRoot() > 0.46
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
            .background(rampColor(t))
            .overlay(Rectangle().stroke(.black.opacity(0.06), lineWidth: 0.5))
            .contentShape(Rectangle())
        }
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
            // Draw the top cells at a readable size; the power-law tail becomes a thin
            // footer, not slivers and not a dominating block.
            let sorted = rows.filter { $0.count > 0 }.sorted { $0.count > $1.count }
            let cap = 16
            nodes = Array(sorted.prefix(cap))
            let rest = sorted.dropFirst(cap)
            tail = rest.isEmpty ? nil : (groups: rest.count, cars: rest.reduce(0) { $0 + $1.count })
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
