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

/// The COLOR LENS — what the cell fill encodes. Area is always inventory (the one thing
/// measured cleanly); color is a SELECTABLE second variable so the map shows what the
/// data can do. Only lenses we can defend from real coverage: Era (year, 92%), Price
/// (sold comps, 74%), Size (inventory, ~100%). No fake "velocity" — sold-flag coverage
/// is a data artifact, not liquidity (241/5185 Mustangs flagged sold), so it's gone.
enum ColorLens: String, CaseIterable, Identifiable {
    case era, price
    var id: String { rawValue }
    var label: String {
        switch self { case .era: return "Era"; case .price: return "Price" }
    }
    var lo: String {
        switch self { case .era: return "CLASSIC"; case .price: return "VALUE" }
    }
    var hi: String {
        switch self { case .era: return "MODERN"; case .price: return "PREMIUM" }
    }
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

/// The folded tail: makes too small to draw legibly at this size, collected into one
/// honest, drillable cell. Tapping it opens a treemap of ONLY those makes, where they
/// finally have room. Nothing hidden — everything is one tap away, never sub-pixel confetti.
struct PulseTailPage: Hashable {
    let nodes: [TreemapNode]
    let filters: [String: String]
    let groupBy: String
    let title: String
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
    /// When set, this treemap renders these nodes directly (the folded-tail sub-page) —
    /// no RPC, no pivot bar, just a titled treemap of the makes that didn't fit above.
    var injectedNodes: [TreemapNode]? = nil
    var injectedTitle: String? = nil

    @State private var dim: PulseDim = .make
    // The color lens — persisted so the market keeps reading the same variable across
    // launches. Selection is haptic (the whole point: the metric IS a control).
    @AppStorage("pulse.colorLens") private var lensRaw: String = ColorLens.era.rawValue
    private var lens: ColorLens { ColorLens(rawValue: lensRaw) ?? .era }
    // The phone is a WINDOW onto a larger canvas, not a frame the market is squeezed into.
    // The treemap lays out taller-than-screen (scroll) and pinch-zooms (the fold is
    // zoom-adaptive: pinch in → the canvas grows → fewer makes fold → the tail emerges).
    @State private var zoom: CGFloat = 1
    @State private var pan: CGSize = .zero
    @State private var gZoomBase: CGFloat? = nil   // zoom at pinch start
    @State private var gPanBase: CGSize = .zero    // pan at pinch start
    @State private var dragBase: CGSize? = nil     // pan at drag start
    @State private var nodes: [TreemapNode] = []
    @State private var loading = true
    @State private var failed = false
    // The power-law tail we did NOT draw as cells (too many, too small) — surfaced as a
    // thin honest footer instead of a giant block that would dominate the head.
    @State private var tail: (groups: Int, cars: Int)? = nil

    private var isTop: Bool { filters.isEmpty && fixedGroupBy == nil && injectedNodes == nil }
    private var groupBy: PulseDim { fixedGroupBy ?? dim }

    // ─── Legibility floor: never draw a cell too small to read. Sub-floor makes fold
    // into ONE drillable tail cell. A treemap cell's area ≈ value/total × canvas, so we
    // can decide the fold before layout. Keeps the head honest (bigger) and kills confetti.
    private func pack(_ ns: [TreemapNode], canvas: Double) -> (head: [TreemapNode], tail: [TreemapNode]) {
        guard canvas > 0, ns.count > 6 else { return (ns, []) }
        let total = ns.reduce(0.0) { $0 + Double(max($1.value, 0)) }
        guard total > 0 else { return (ns, []) }
        let minArea = 2900.0                      // ≈ 62×46 pt — room for a label without slivers
        // ns is sorted desc, so the first sub-floor cell marks where the tail begins.
        let cut = ns.firstIndex { Double($0.value) / total * canvas < minArea } ?? ns.count
        // Only fold if the tail is worth folding (≥3 makes); else draw them all.
        guard cut < ns.count - 2 else { return (ns, []) }
        return (Array(ns[..<cut]), Array(ns[cut...]))
    }
    private func tailNode(_ tail: [TreemapNode]) -> TreemapNode {
        TreemapNode(name: "＋\(tail.count) \(groupBy.label.lowercased())s",
                    count: tail.reduce(0) { $0 + $1.count },
                    value: tail.reduce(0) { $0 + max($1.value, 0) },
                    median_price: nil, sold_count: nil, avg_year: nil,
                    image_url: nil, sell_through: nil)
    }
    private func isTail(_ n: TreemapNode) -> Bool { n.name.hasPrefix("＋") }

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

    // ─── Color lens: fill encodes the SELECTED variable (area is always inventory). ──
    // Price domain is log-scaled across what's on screen (prices span 3 orders of
    // magnitude); era is a fixed classic→modern window so the hue means the same thing
    // regardless of which cohort is shown.
    private var priceLogs: [Double] { nodes.compactMap { $0.median_price }.filter { $0 > 0 }.map { log10(Double($0)) } }
    private var priceLo: Double { priceLogs.min() ?? 3 }
    private var priceHi: Double { priceLogs.max() ?? 5 }

    /// Normalized [0,1] position of a node on the current lens — nil when the node lacks
    /// the datum (→ a neutral cell, never a fabricated color).
    private func lensT(_ n: TreemapNode) -> Double? {
        switch lens {
        case .era:
            guard let y = n.avg_year else { return nil }
            return max(0, min(1, (Double(y) - 1955) / (2010 - 1955)))
        case .price:
            guard let p = n.median_price, p > 0, priceHi > priceLo else {
                return (n.median_price ?? 0) > 0 ? 0.5 : nil
            }
            return max(0, min(1, (log10(Double(p)) - priceLo) / (priceHi - priceLo)))
        }
    }

    /// Perceptually-graded ramps: hue AND lightness move together (the expert fix — a
    /// heatmap needs value contrast, not hue-only). Both lenses share one lightness
    /// envelope (dark low → light high) so switching feels like the same instrument.
    private func lensRamp(_ t: Double) -> Color {
        let s = max(0, min(1, t))
        func m(_ a: Double, _ b: Double) -> Double { a + (b - a) * s }
        switch lens {
        case .era:   // classic deep amber → modern light teal (lightness climbs with year)
            return Color(red: m(0.42, 0.42), green: m(0.24, 0.74), blue: m(0.14, 0.80))
        case .price: // value deep green → premium bright gold (lightness climbs with price)
            return Color(red: m(0.10, 0.92), green: m(0.34, 0.74), blue: m(0.24, 0.20))
        }
    }

    /// Cell fill for the current lens; a flat elevated neutral when the datum is missing
    /// (never a fabricated color, never a redundant size-ramp).
    private func cellFill(_ n: TreemapNode) -> Color {
        guard let t = lensT(n) else { return Color(uiColor: .tertiarySystemFill) }
        return lensRamp(t)
    }
    /// Contrast-correct text for any fill (luminance test) — works across every ramp.
    private func fg(on fill: Color) -> Color {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        UIColor(fill).getRed(&r, green: &g, blue: &b, alpha: &a)
        return (0.299 * r + 0.587 * g + 0.114 * b) > 0.62 ? Color(white: 0.12) : .white
    }

    // ─── Hybrid layout (treemap-expert verdict) ──────────────────────────────────
    // The head is EXACTLY area-proportional (squarified) down to the count where an
    // honest cell would fall below a text-legible floor; below that, every make gets a
    // uniform labeled box with its TRUE count printed, joined by a seam that discloses
    // where the area channel stops. No fold. Every box holds text. Honest: distortion is
    // quarantined to a zone that openly renounces area, never silently faked in the head.
    private struct PlacedCell: Identifiable {
        let node: TreemapNode; let rect: CGRect; let proportional: Bool
        var id: String { node.name }
    }
    private func hybridLayout(_ ns: [TreemapNode], width W: CGFloat, screenH: CGFloat)
    -> (cells: [PlacedCell], seamY: CGFloat?, height: CGFloat) {
        guard let top = ns.first?.count, top > 0, W > 0 else { return ([], nil, screenH) }
        let minW: CGFloat = 108, minH: CGFloat = 60, cols = 3          // text-legible floor
        let aFloor = Double(minW * minH)
        let s = Double(W) * 0.34 * Double(screenH) / Double(top)        // pt² per car, hero-pinned
        let nStar = aFloor / max(s, 0.0001)                            // crossover count
        let headEnd = ns.firstIndex { Double($0.count) < nStar } ?? ns.count
        let head = Array(ns[..<headEnd]), tail = Array(ns[headEnd...])

        var cells: [PlacedCell] = []
        var hHead: CGFloat = 0
        if !head.isEmpty {
            let headSum = head.reduce(0.0) { $0 + Double($1.count) }
            hHead = CGFloat(s * headSum) / W
            let laid = squarify(head, in: CGRect(x: 0, y: 0, width: W, height: hHead))
            cells = laid.map { PlacedCell(node: $0.node, rect: $0.rect, proportional: true) }
        }
        // Tail: uniform labeled grid, still strictly count-descending.
        let cellW = W / CGFloat(cols)
        for (i, n) in tail.enumerated() {
            let r = i / cols, c = i % cols
            cells.append(PlacedCell(node: n,
                rect: CGRect(x: CGFloat(c) * cellW, y: hHead + CGFloat(r) * minH,
                             width: cellW, height: minH),
                proportional: false))
        }
        let tailRows = Int(ceil(Double(tail.count) / Double(cols)))
        let height = hHead + CGFloat(tailRows) * minH
        return (cells, tail.isEmpty ? nil : hHead, max(height, screenH))
    }

    // Hold the canvas within the viewport (pan ≤ 0; centered when content < viewport).
    private func clampPan(_ p: CGSize, content: CGSize, viewport: CGSize) -> CGSize {
        let minX = min(0, viewport.width - content.width)
        let minY = min(0, viewport.height - content.height)
        return CGSize(width: max(minX, min(0, p.width)), height: max(minY, min(0, p.height)))
    }

    // A drill cell (head or tail): tap → deeper, long-press → instrument menu, felt weight.
    @ViewBuilder private func drillCell(_ n: TreemapNode) -> some View {
        let s = step(n)
        NavigationLink(value: s) { cellBody(n) }
            .buttonStyle(.plain)
            .contextMenu { cellMenu(n) }
            .simultaneousGesture(TapGesture().onEnded {
                if s.groupBy == nil { Haptics.landing() } else { Haptics.drill(depth: s.filters.count - 1) }
            })
    }
    // The honest seam: where exact area stops and equal-sized labels begin.
    private func seam(width: CGFloat) -> some View {
        VStack(spacing: 3) {
            Rectangle().fill(Color.secondary.opacity(0.35)).frame(height: 0.5)
            Text("equal size below — the number is the true count")
                .font(.system(size: 9, design: .monospaced)).foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading).padding(.leading, 8)
        }
        .frame(width: width)
    }

    // The instrument menu — every make/model/cohort is a thing you can watch, save, share.
    @ViewBuilder private func cellMenu(_ n: TreemapNode) -> some View {
        let watched = lists.watched.contains(n.name)
        let saved = lists.saved.contains(n.name)
        Section(n.name) {
            Button {
                watched ? Haptics.watchOff() : Haptics.watchOn(); lists.toggleWatch(n.name)
            } label: {
                Label(watched ? "Watching" : "Watch", systemImage: watched ? "eye.fill" : "eye")
            }
            Button {
                saved ? Haptics.saveOff() : Haptics.saveOn(); lists.toggleSave(n.name)
            } label: {
                Label(saved ? "Saved" : "Save", systemImage: saved ? "bookmark.fill" : "bookmark")
            }
        }
        ShareLink(item: shareText(n)) { Label("Share", systemImage: "square.and.arrow.up") }
    }
    private func shareText(_ n: TreemapNode) -> String {
        var s = "\(n.name) — \(n.count.formatted()) in the market"
        if let y = n.avg_year { s += " · typ. '\(String(format: "%02d", y % 100))" }
        return s
    }

    var body: some View {
        VStack(spacing: 0) {
            if !nodes.isEmpty { pulseHeader }

            HStack(spacing: 8) {
                if isTop {
                    // GROUP BY: one market, regrouped by whatever the question needs.
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 7) {
                            ForEach(PulseDim.allCases) { d in
                                let on = (d == dim)
                                Button { Haptics.tick(); dim = d } label: {
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
                        .padding(.leading, 12)
                    }
                } else {
                    breadcrumb
                }
                if !nodes.isEmpty { colorMenu.padding(.trailing, 12) }
            }
            .padding(.vertical, 6)

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
                    GeometryReader { geo in
                        // A REAL treemap laid out ONCE at zoom-1. The canvas W×(2.6·H) is
                        // self-similar under zoom, so every cell is a pure ×zoom scale — crisp
                        // labels, exact focal math. We manage pan+zoom ourselves (not a
                        // ScrollView) so pinch zooms WHERE THE FINGERS ARE (Photos-style), and
                        // every NavigationLink/contextMenu/haptic on the cells stays intact.
                        let W = geo.size.width, VH = geo.size.height
                        let canvasH = VH * 2.6
                        let laid = squarify(nodes, in: CGRect(x: 0, y: 0, width: W, height: canvasH))
                        ZStack(alignment: .topLeading) {
                            ForEach(laid, id: \.node.id) { item in
                                drillCell(item.node)
                                    .frame(width: item.rect.width * zoom, height: item.rect.height * zoom)
                                    .offset(x: item.rect.minX * zoom, y: item.rect.minY * zoom)
                            }
                        }
                        .frame(width: W * zoom, height: canvasH * zoom, alignment: .topLeading)
                        .offset(pan)
                        .frame(width: W, height: VH, alignment: .topLeading)
                        .clipped()
                        .contentShape(Rectangle())
                        .background(Color(uiColor: .systemGroupedBackground))
                        .gesture(
                            MagnifyGesture(minimumScaleDelta: 0)
                                .onChanged { v in
                                    if gZoomBase == nil { gZoomBase = zoom; gPanBase = pan }
                                    let base = gZoomBase ?? zoom
                                    let f = v.startLocation
                                    let zNew = min(8, max(1, base * v.magnification))
                                    // keep the point under the fingers fixed as scale changes
                                    let np = CGSize(width: f.x - (f.x - gPanBase.width) * (zNew / base),
                                                    height: f.y - (f.y - gPanBase.height) * (zNew / base))
                                    zoom = zNew
                                    pan = clampPan(np, content: CGSize(width: W * zNew, height: canvasH * zNew),
                                                   viewport: geo.size)
                                }
                                .onEnded { _ in gZoomBase = nil }
                                .simultaneously(with:
                                    DragGesture(minimumDistance: 12)
                                        .onChanged { d in
                                            if dragBase == nil { dragBase = pan }
                                            let b = dragBase ?? pan
                                            pan = clampPan(CGSize(width: b.width + d.translation.width,
                                                                  height: b.height + d.translation.height),
                                                           content: CGSize(width: W * zoom, height: canvasH * zoom),
                                                           viewport: geo.size)
                                        }
                                        .onEnded { d in
                                            let b = dragBase ?? pan
                                            let target = clampPan(CGSize(width: b.width + d.predictedEndTranslation.width,
                                                                         height: b.height + d.predictedEndTranslation.height),
                                                                  content: CGSize(width: W * zoom, height: canvasH * zoom),
                                                                  viewport: geo.size)
                                            withAnimation(.easeOut(duration: 0.4)) { pan = target }   // flick momentum
                                            dragBase = nil
                                        })
                        )
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
        let head = injectedTitle ?? pins.joined(separator: " › ")
        return HStack(spacing: 6) {
            Text(head)
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
    // A drawn cell: a normal make/model/cohort (tap → drill, long-press → instrument
    // menu) or the folded-tail cell (tap → a treemap of just those makes).
    @ViewBuilder private func cell(for n: TreemapNode, tail: [TreemapNode]) -> some View {
        if isTail(n) {
            NavigationLink(value: PulseTailPage(nodes: tail, filters: filters,
                                                groupBy: groupBy.rawValue, title: n.name)) {
                foldCell(n, tail: tail)
            }
            .buttonStyle(.plain)
            .simultaneousGesture(TapGesture().onEnded { Haptics.drawer() })
        } else {
            let s = step(n)
            NavigationLink(value: s) { cellBody(n) }
                .buttonStyle(.plain)
                .contextMenu { cellMenu(n) }
                // The drill gets a felt weight: LANDING when the next step is the cars,
                // else a DROP that deepens with each level. (Was silent — the app's most
                // important gesture.)
                .simultaneousGesture(TapGesture().onEnded {
                    if s.groupBy == nil { Haptics.landing() }
                    else { Haptics.drill(depth: s.filters.count - 1) }
                })
        }
    }

    // The fold cell as a DOORWAY, not a void (the experts' #1 make-page fix): a live mosaic
    // of the makes folded inside (real areas, current lens colors) under a recessed scrim,
    // with the marquee of what's in the drawer + an Explore affordance. It reads as "a whole
    // world, folded" — the eye is pulled toward the one cell that used to repel it.
    @ViewBuilder private func foldCell(_ n: TreemapNode, tail: [TreemapNode]) -> some View {
        GeometryReader { g in
            let top = Array(tail.prefix(48))
            let laid = squarify(top, in: CGRect(origin: .zero, size: g.size))
            let big = g.size.width >= 144 && g.size.height >= 92
            ZStack(alignment: .topLeading) {
                // The mosaic: each folded make as a tiny tile, colored by the active lens.
                Canvas { ctx, _ in
                    for item in laid {
                        let r = item.rect.insetBy(dx: 0.5, dy: 0.5)
                        guard r.width > 0, r.height > 0 else { continue }
                        ctx.fill(Path(roundedRect: r, cornerRadius: 1), with: .color(cellFill(item.node)))
                    }
                }
                // Recessed scrim — sits the cell BELOW the plane of the solid tiles and makes
                // the overlaid text legible on any mosaic.
                LinearGradient(colors: [.black.opacity(0.10), .black.opacity(0.42)],
                               startPoint: .top, endPoint: .bottom)
                VStack(alignment: .leading, spacing: 2) {
                    Text(n.name)
                        .font(.system(size: big ? 21 : 15, weight: .semibold))
                        .foregroundStyle(.white).lineLimit(1).minimumScaleFactor(0.5)
                    Text(n.count.formatted())
                        .font(.system(size: big ? 14 : 11, weight: .regular).monospacedDigit())
                        .foregroundStyle(.white.opacity(0.65))
                    if big {
                        Text(tail.prefix(6).map(\.name).joined(separator: " · ") + " …")
                            .font(.system(size: 12)).foregroundStyle(.white.opacity(0.72))
                            .lineLimit(2).padding(.top, 2)
                    }
                    Spacer(minLength: 0)
                    HStack {
                        Spacer()
                        Text("Explore →")
                            .font(.system(size: 12, weight: .semibold))
                            .padding(.horizontal, 10).padding(.vertical, 5)
                            .background(.ultraThinMaterial, in: Capsule())
                            .foregroundStyle(.white)
                    }
                }
                .padding(big ? 12 : 6)
            }
            .overlay(Rectangle().stroke(.black.opacity(0.06), lineWidth: 0.5))
            .contentShape(Rectangle())
        }
    }

    @ViewBuilder private func cellBody(_ n: TreemapNode, tail: Bool = false) -> some View {
        let fill: Color = tail ? Color(uiColor: .systemFill) : cellFill(n)
        let ink: Color = tail ? .primary : fg(on: fill)
        GeometryReader { g in
            let big = g.size.width >= 144 && g.size.height >= 92
            let mid = g.size.height >= 50 && g.size.width >= 80
            // Name + number as one block, vertically CENTERED — balanced whitespace on
            // any cell shape (no one-sided void in tall-thin cells).
            // The MAKE is the headline; the count is a quiet caption beneath it (never
            // larger — area already carries the quantity). Top-left anchored, instrument
            // grammar. (Expert-unanimous fix: kill the 90pt billboard number.)
            VStack(alignment: .leading, spacing: 2) {
                Text(n.name)
                    .font(.system(size: big ? 21 : (mid ? 15 : 12), weight: .semibold))
                    .lineLimit(1).minimumScaleFactor(0.5).allowsTightening(true)
                    .foregroundStyle(ink)
                if mid {
                    Text(n.count.formatted())
                        .font(.system(size: big ? 14 : 11, weight: .regular).monospacedDigit())
                        .foregroundStyle(ink.opacity(0.6))
                        .lineLimit(1).minimumScaleFactor(0.7)
                }
            }
            .padding(big ? 12 : 6)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background(fill)
            .overlay(alignment: .bottomTrailing) {
                if tail {
                    Image(systemName: "chevron.right.circle.fill")
                        .font(.system(size: 15)).foregroundStyle(.secondary).padding(6)
                }
            }
            .overlay(alignment: .topTrailing) {
                if mid, lists.watched.contains(n.name) || lists.saved.contains(n.name) {
                    Image(systemName: lists.watched.contains(n.name) ? "eye.fill" : "bookmark.fill")
                        .font(.system(size: 8)).foregroundStyle(ink)
                        .padding(5)
                }
            }
            .overlay(Rectangle().stroke(.black.opacity(0.06), lineWidth: 0.5))
            .contentShape(Rectangle())
        }
    }

    // Orientation: what am I looking at? Total supply + the encoding key, stated once
    // (the experts' "no title/verdict" fix). Area = inventory (honest: this is supply,
    // a census — a true movement 'pulse' needs data we don't yet defend). Color = lens.
    private var pulseHeader: some View {
        let total = nodes.reduce(0) { $0 + $1.count }
        return HStack(spacing: 8) {
            Text(total.formatted()).font(.system(.subheadline, design: .rounded).weight(.semibold))
                .monospacedDigit()
            Text("listed").font(.system(.caption)).foregroundStyle(.secondary)
            Spacer(minLength: 6)
            // The live color key — endpoints + the current ramp.
            Text(lens.lo).font(.system(size: 9, weight: .semibold, design: .monospaced))
                .foregroundStyle(.secondary)
            LinearGradient(colors: [lensRamp(0), lensRamp(0.5), lensRamp(1)],
                           startPoint: .leading, endPoint: .trailing)
                .frame(width: 42, height: 6).clipShape(Capsule())
            Text(lens.hi).font(.system(size: 9, weight: .semibold, design: .monospaced))
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 14).padding(.top, 6).padding(.bottom, 2)
    }

    // COLOR BY: a compact menu, not a competing chip row — resolves the duplicate-"Price"
    // collision the experts flagged. Haptic on change. Swatch shows the current lens.
    private var colorMenu: some View {
        Menu {
            Picker("Color by", selection: $lensRaw) {
                ForEach(ColorLens.allCases) { l in Text(l.label).tag(l.rawValue) }
            }
        } label: {
            HStack(spacing: 5) {
                Circle().fill(lensRamp(0.8)).frame(width: 10, height: 10)
                    .overlay(Circle().stroke(.white.opacity(0.5), lineWidth: 0.5))
                Text(lens.label).font(.system(.subheadline).weight(.medium))
                Image(systemName: "chevron.down").font(.system(size: 9, weight: .semibold))
            }
            .foregroundStyle(.primary)
            .padding(.horizontal, 11).padding(.vertical, 6)
            .background(Color(uiColor: .secondarySystemFill), in: Capsule())
        }
        .onChange(of: lensRaw) { _, _ in Haptics.tick() }
        .onAppear { Haptics.warm() }
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
        // The folded-tail sub-page renders injected nodes directly — no RPC.
        if let injected = injectedNodes {
            nodes = injected.sorted { $0.count > $1.count }
            tail = nil; loading = false; failed = false
            return
        }
        loading = true; failed = false
        do {
            // The un-pinned MAKE view is the make-level pulse (market_position carries
            // avg_year + median_price so the Era/Price lenses work at the top level).
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
