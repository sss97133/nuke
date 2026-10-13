// LedgerMap.swift — the ledger as a map, the way nuke.ag's Market tab opens (web #1061,
// HomePage.tsx TreemapHomePage): every public vehicle record with a recorded price, by make,
// area = count, color = median recorded sale or asking price, drilling to models, years and
// the records themselves. The readers are the web's: treemap_by_brand, treemap_models_by_brand,
// treemap_years (three materialized views, refreshed by the 30-minute job `treemap-refresh`)
// and, at the leaf, the vehicles table with a recorded sale or sold price. The phone draws the
// same cells with the same captions and lands Explore on this map with the open board below it,
// as the web page is composed.

import SwiftUI
import Supabase

/// One cell of the ledger map as the three readers return it. Fields the year reader lacks are optional.
struct LedgerNode: Decodable, Identifiable, Hashable {
    let name: String
    let count: Int
    let value: Int
    let median_price: Int?
    let min_price: Int?
    let max_price: Int?
    let sold_count: Int?
    let auction_count: Int?
    let avg_bids: Int?
    let avg_watchers: Int?
    var id: String { name }
}

/// A record at the leaf, as the web's useTreemapVehicles selects it: area = recorded price.
struct LedgerVehicle: Decodable, Identifiable, Hashable {
    let id: UUID
    let year: Int?
    let make: String?
    let model: String?
    let listing_title: String?
    let bat_listing_title: String?
    let sale_price: Double?
    let sold_price: Double?
    let primary_image_url: String?
    let mileage: Int?
    var price: Double { (sale_price ?? 0) > 0 ? sale_price! : (sold_price ?? 0) }
    var name: String { [year.map(String.init), make, model].compactMap { $0 }.joined(separator: " ") }
    var headerRow: VehicleHeaderRow {
        VehicleHeaderRow(id: id, year: year, make: make, model: model, trim: nil, primary_image_url: primary_image_url, city: nil, state: nil)
    }
}

enum LedgerMap {
    private struct MakeParams: Encodable { let p_make: String }
    private struct YearParams: Encodable { let p_source: String?; let p_make: String; let p_model: String }

    static func makes() async throws -> [LedgerNode] {
        try await SupabaseService.client.rpc("treemap_by_brand").execute().value
    }
    static func models(make: String) async throws -> [LedgerNode] {
        try await SupabaseService.client.rpc("treemap_models_by_brand", params: MakeParams(p_make: make)).execute().value
    }
    static func years(make: String, model: String) async throws -> [LedgerNode] {
        try await SupabaseService.client.rpc("treemap_years", params: YearParams(p_source: nil, p_make: make, p_model: model)).execute().value
    }
    /// The web's leaf query, column for column: a recorded sale or sold price, not deleted, priciest first, 200 at most.
    static func vehicles(make: String, model: String, year: Int?) async throws -> [LedgerVehicle] {
        var q = SupabaseService.client.from("vehicles")
            .select("id,year,make,model,listing_title,bat_listing_title,sale_price,sold_price,primary_image_url,mileage")
            .ilike("make", value: make)
            .ilike("model", value: model)
            .or("sale_price.gt.0,sold_price.gt.0")
            .is("deleted_at", value: nil)
        if let year { q = q.eq("year", value: year) }
        return try await q.order("sale_price", ascending: false).limit(200).execute().value
    }

    /// The web's fmtMoney: $1.3B, $1.3M, $36K, $900. One decimal the way JavaScript's toFixed(1)
    /// rounds (a tie goes up: 1.25 → 1.3), not the C library's tie-to-even.
    static func oneDecimal(_ x: Double) -> String { String(format: "%.1f", (x * 10).rounded(.toNearestOrAwayFromZero) / 10) }
    static func money(_ n: Double) -> String {
        guard n > 0, n.isFinite else { return "--" }
        if n >= 1_000_000_000 { return "$" + oneDecimal(n / 1_000_000_000) + "B" }
        if n >= 1_000_000 { return "$" + oneDecimal(n / 1_000_000) + "M" }
        if n >= 1_000 { return "$\(Int((n / 1_000).rounded()).formatted())K" }
        return "$" + Int(n.rounded()).formatted()
    }

    /// The web's priceToColor steps (heat-0 … heat-6): the median price as a seven-step warmth.
    static func color(median: Int?) -> Color {
        guard let m = median, m > 0 else { return Color(.tertiarySystemFill) }
        let step: Double = m < 10_000 ? 1 : m < 25_000 ? 2 : m < 50_000 ? 3 : m < 100_000 ? 4 : m < 250_000 ? 5 : 6
        return Color.orange.opacity(0.12 + 0.13 * step)
    }
}

/// The map with its breadcrumb, count line and legend, drilling make → model → year → record.
struct LedgerMapView: View {
    private enum Level: Hashable {
        case makes
        case models(make: String, of: Int)
        case years(make: String, model: String, of: Int)
        case vehicles(make: String, model: String, year: Int?, of: Int)

        var crumb: String {
            switch self {
            case .makes: return "ALL MAKES"
            case .models(let m, _): return m.uppercased()
            case .years(_, let model, _): return model.uppercased()
            case .vehicles(_, _, let y, _): return y.map(String.init) ?? "ALL YEARS"
            }
        }
    }

    @State private var stack: [Level] = {
        #if DEBUG
        // Screenshot loop: NUKE_DEBUG_LEDGER_MAKE=Chevrolet opens that brand's models (DEBUG only).
        if let m = ProcessInfo.processInfo.environment["NUKE_DEBUG_LEDGER_MAKE"], !m.isEmpty { return [.makes, .models(make: m, of: 0)] }
        #endif
        return [.makes]
    }()
    @State private var nodes: [LedgerNode] = []
    @State private var vehicles: [LedgerVehicle] = []
    @State private var loading = false
    @State private var failed = false
    @State private var tailOpen = false

    private var level: Level { stack.last ?? .makes }
    private var isLeaf: Bool { if case .vehicles = level { return true } else { return false } }
    private var total: Int { isLeaf ? vehicles.count : nodes.reduce(0) { $0 + $1.count } }
    /// The parent's count when this level is capped by its reader (models: 200 a brand; records: 200 a model).
    private var capped: Int? {
        switch level {
        case .models(_, let of) where nodes.count >= 200 && of > 0: return of
        case .vehicles(_, _, _, let of) where vehicles.count >= 200 && of > 0: return of
        default: return nil
        }
    }
    private var countLine: String {
        let base = "\(total.formatted()) \(isLeaf ? "vehicles" : "vehicles with a recorded price")"
        if let of = capped { return base + " in the 200 \(isLeaf ? "priciest records" : "largest models") of \(of.formatted())" }
        return base
    }

    /// Cells too small to label are folded into one box that holds its own cells, the way the phone's
    /// inventory map draws its long tail (web #1043): area stays honest (the box is the tail's count),
    /// the larger tail members stay visible and tappable inside it, and the box's title opens the whole
    /// list. The web draws every cell on a canvas five times this size and needs no fold.
    private static let labelWidth: CGFloat = 56, labelHeight: CGFloat = 30
    private struct Laid { let shown: [LiveInventory.Cell<LedgerNode>]; let tail: [LedgerNode]; let tailRect: CGRect? }
    private func layout(_ sorted: [LedgerNode], in size: CGSize) -> Laid {
        let bounds = CGRect(origin: .zero, size: size)
        var kept = sorted
        var tail: [LedgerNode] = []
        for _ in 0..<4 {
            let count = tail.reduce(0) { $0 + $1.count }
            let marker = LedgerNode(name: "+more", count: count, value: 0, median_price: nil, min_price: nil, max_price: nil, sold_count: nil, auction_count: nil, avg_bids: nil, avg_watchers: nil)
            let items = (tail.isEmpty ? kept : kept + [marker]).map { (item: $0, area: Double($0.count)) }
            let cells = LiveInventory.squarify(items, in: bounds)
            let small = cells.filter { $0.item.id != marker.id && ($0.rect.width < Self.labelWidth || $0.rect.height < Self.labelHeight) }.map(\.item.id)
            if small.isEmpty || kept.count <= 2 {
                return Laid(shown: cells.filter { $0.item.id != marker.id }, tail: tail, tailRect: tail.isEmpty ? nil : cells.first { $0.item.id == marker.id }?.rect)
            }
            let smallSet = Set(small)
            tail = kept.filter { smallSet.contains($0.id) } + tail
            kept = kept.filter { !smallSet.contains($0.id) }
        }
        return Laid(shown: LiveInventory.squarify(kept.map { (item: $0, area: Double($0.count)) }, in: bounds), tail: tail, tailRect: nil)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            // Breadcrumb: each crumb goes back up, as the web's drill stack.
            HStack(spacing: 6) {
                ForEach(Array(stack.enumerated()), id: \.offset) { i, lvl in
                    if i > 0 { Text("›").font(.caption2).foregroundStyle(.tertiary) }
                    Button(lvl.crumb) { stack = Array(stack.prefix(i + 1)) }
                        .font(.caption2.monospaced().weight(i == stack.count - 1 ? .semibold : .regular))
                        .buttonStyle(.plain)
                        .foregroundStyle(i == stack.count - 1 ? Color.primary : Color.secondary)
                }
                Spacer(minLength: 0)
                if loading { ProgressView().controlSize(.mini) }
            }
            .lineLimit(1)
            // The count line on its own row so a capped level's denominator is never cut off.
            if !loading {
                Text(countLine).font(.caption2.monospaced()).foregroundStyle(.secondary).lineLimit(2)
            }
            GeometryReader { geo in
                if failed {
                    ContentUnavailableView { Label("Couldn't read the ledger's views", systemImage: "wifi.exclamationmark") } actions: {
                        Button("Retry") { Task { await load() } }
                    }
                } else if isLeaf {
                    let cells = LiveInventory.squarify(vehicles.map { (item: $0, area: $0.price) }, in: CGRect(origin: .zero, size: geo.size))
                    ForEach(Array(cells.enumerated()), id: \.offset) { _, c in
                        NavigationLink(value: c.item.headerRow) { cell(name: c.item.name, line2: LedgerMap.money(c.item.price), line3: nil, median: Int(c.item.price), rect: c.rect) }
                            .buttonStyle(.plain)
                    }
                } else {
                    // The web sorts by area inside its squarify (lib/squarify.ts); so does this layout.
                    let laid = layout(nodes.sorted { $0.count > $1.count }, in: geo.size)
                    let all = max(1, total)
                    ForEach(Array(laid.shown.enumerated()), id: \.offset) { _, c in
                        Button { descend(into: c.item) } label: {
                            cell(name: c.item.name,
                                 line2: "\(c.item.count.formatted()) vehicles",
                                 line3: [c.item.median_price.map { LedgerMap.money(Double($0)) + " med" }, String(format: "%.1f%%", Double(c.item.count) / Double(all) * 100)].compactMap { $0 }.joined(separator: " · "),
                                 median: c.item.median_price, rect: c.rect)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("\(c.item.name), \(c.item.count.formatted()) vehicles")
                    }
                    if let r = laid.tailRect {
                        tailBox(laid.tail, rect: r, all: all)
                    }
                }
            }
            .frame(height: 320)
            Text(isLeaf ? "area = recorded price · tap to open the record"
                        : "area = vehicles with a recorded price · color = median recorded sale or asking price · tap to go down · as of the last refresh of the ledger's views (a 30-minute job; its last run is not recorded)")
                .font(.system(size: 9, design: .monospaced)).foregroundStyle(.tertiary)
        }
        .task(id: stack) { await load() }
    }

    private func descend(into node: LedgerNode) {
        switch level {
        case .makes: stack.append(.models(make: node.name, of: node.count))
        case .models(let make, _): stack.append(.years(make: make, model: node.name, of: node.count))
        case .years(let make, let model, _): stack.append(.vehicles(make: make, model: model, year: Int(node.name), of: node.count))
        case .vehicles: break
        }
    }

    /// The tail's box: a title row (tap for the list) over the tail's own cells, labeled where they fit.
    private func tailBox(_ tail: [LedgerNode], rect: CGRect, all: Int) -> some View {
        let title: CGFloat = 18
        let inner = CGRect(x: 0, y: 0, width: max(0, rect.width - 4), height: max(0, rect.height - title - 4))
        let cells = LiveInventory.squarify(tail.sorted { $0.count > $1.count }.map { (item: $0, area: Double($0.count)) }, in: inner)
        return ZStack(alignment: .topLeading) {
            RoundedRectangle(cornerRadius: 3).fill(Color(.secondarySystemFill))
            VStack(alignment: .leading, spacing: 0) {
                Button { tailOpen = true } label: {
                    HStack(spacing: 6) {
                        Text("+\(tail.count.formatted()) more").font(.system(size: 10, weight: .semibold))
                        Text("\(tail.reduce(0) { $0 + $1.count }.formatted()) vehicles · list").font(.system(size: 8, design: .monospaced)).foregroundStyle(.secondary)
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, 4).frame(height: title)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                ZStack(alignment: .topLeading) {
                    ForEach(Array(cells.enumerated()), id: \.offset) { _, c in
                        Button { descend(into: c.item) } label: {
                            cell(name: c.item.name, line2: "\(c.item.count.formatted()) vehicles",
                                 line3: c.item.median_price.map { LedgerMap.money(Double($0)) + " med" }, median: c.item.median_price, rect: c.rect)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .frame(width: inner.width, height: inner.height)
                .padding(2)
            }
        }
        .frame(width: max(0, rect.width - 2), height: max(0, rect.height - 2))
        .position(x: rect.midX, y: rect.midY)
        .sheet(isPresented: $tailOpen) { tailList(tail, all: all) }
    }

    /// The folded tail as a list: every name, its count, its median, each a way down.
    private func tailList(_ tail: [LedgerNode], all: Int) -> some View {
        NavigationStack {
            List(tail) { n in
                Button { tailOpen = false; descend(into: n) } label: {
                    HStack {
                        Text(n.name).font(.subheadline)
                        Spacer()
                        Text("\(n.count.formatted()) · \(n.median_price.map { LedgerMap.money(Double($0)) + " med" } ?? "no median") · \(String(format: "%.1f%%", Double(n.count) / Double(all) * 100))")
                            .font(.caption2.monospaced()).foregroundStyle(.secondary)
                    }
                }
                .buttonStyle(.plain)
            }
            .navigationTitle("\(tail.count.formatted()) more, by count")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { tailOpen = false } } }
        }
    }

    private func load() async {
        loading = true; failed = false
        defer { loading = false }
        do {
            switch level {
            case .makes: nodes = try await LedgerMap.makes().filter { $0.count > 0 }
            case .models(let make, _): nodes = try await LedgerMap.models(make: make).filter { $0.count > 0 }
            case .years(let make, let model, _): nodes = try await LedgerMap.years(make: make, model: model).filter { $0.count > 0 }
            case .vehicles(let make, let model, let year, _): vehicles = try await LedgerMap.vehicles(make: make, model: model, year: year).filter { $0.price > 0 }
            }
        } catch {
            failed = true
            NSLog("NukeCapture ledger map read failed: %@", String(describing: error))
        }
    }

    /// A cell: name on top, count and median under it, labels only where they fit (the web labels the same way).
    private func cell(name: String, line2: String, line3: String?, median: Int?, rect: CGRect) -> some View {
        ZStack(alignment: .topLeading) {
            RoundedRectangle(cornerRadius: 3).fill(LedgerMap.color(median: median))
            if rect.width >= 56, rect.height >= 30 {
                VStack(alignment: .leading, spacing: 1) {
                    Text(name).font(.system(size: 10, weight: .semibold)).lineLimit(1)
                    if rect.height >= 44 { Text(line2).font(.system(size: 8, design: .monospaced)).foregroundStyle(.secondary).lineLimit(1) }
                    if let line3, rect.height >= 58 { Text(line3).font(.system(size: 8, design: .monospaced)).foregroundStyle(.secondary).lineLimit(1) }
                }
                .padding(4)
            } else if rect.width >= 40, rect.height >= 12 {
                // The inventory map's floor: a name alone, small, where a full label would not fit.
                Text(name).font(.system(size: 7, weight: .semibold)).lineLimit(1).padding(2)
            }
        }
        .frame(width: max(0, rect.width - 2), height: max(0, rect.height - 2))
        .contentShape(Rectangle())
        .position(x: rect.midX, y: rect.midY)
    }
}
