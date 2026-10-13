// LiveInventoryMap.swift — the open board as the web Market tab draws it (#1043).
//
// nuke_frontend/src/pages/market/MarketInventoryMap.tsx and inventoryMap.ts: brands are boxes sized
// by their open lots; inside a brand box its decades are cells, each keeping its area down to the
// smallest, so a brand reads as a distribution (one decade dominating, a long tail). Boxes too small
// to identify keep their area as cells inside one combined box instead of vanishing into a count.
// The map and the list beneath it are one population: the board as market_pulse_live recorded it,
// never a second read. Tap a brand to narrow the list to it; tap a decade to narrow further.

import SwiftUI

enum LiveInventory {
    static func make(_ a: LiveAuction) -> String {
        let m = (a.make ?? "").trimmingCharacters(in: .whitespaces)
        return m.isEmpty ? "Make unrecorded" : m.uppercased()
    }

    /// "1970–1979", or "Year unrecorded" (the web's mapValue for era).
    static func decade(_ a: LiveAuction) -> String {
        guard let y = a.year, y > 0, y <= 9999 else { return "Year unrecorded" }
        let d = (y / 10) * 10
        return "\(d)–\(d + 9)"
    }

    struct Group: Identifiable {
        let key: String
        let lots: [LiveAuction]
        var id: String { key }
        var count: Int { lots.count }
    }

    static func groups(_ lots: [LiveAuction], by keyOf: (LiveAuction) -> String) -> [Group] {
        var order: [String] = []
        var map: [String: [LiveAuction]] = [:]
        for lot in lots {
            let k = keyOf(lot)
            if map[k] == nil { order.append(k) }
            map[k, default: []].append(lot)
        }
        let built: [Group] = order.map { Group(key: $0, lots: map[$0] ?? []) }
        return built.sorted { a, b in
            if a.count != b.count { return a.count > b.count }
            return a.key < b.key
        }
    }

    struct Cell<T> { let item: T; let rect: CGRect }

    /// Classic squarified layout over (item, area): near-square cells so labels stay readable.
    static func squarify<T>(_ items: [(item: T, area: Double)], in bounds: CGRect) -> [Cell<T>] {
        let items = items.filter { $0.area > 0 }
        guard !items.isEmpty, bounds.width > 0, bounds.height > 0 else { return [] }
        let total = items.reduce(0.0) { $0 + $1.area }
        let scale = Double(bounds.width * bounds.height) / total
        let scaled = items.map { (item: $0.item, area: $0.area * scale) }
        var result: [Cell<T>] = []
        var rect = bounds
        var row: [(item: T, area: Double)] = []
        func worst(_ r: [(item: T, area: Double)], _ w: Double) -> Double {
            guard !r.isEmpty, w > 0 else { return .infinity }
            let s = r.reduce(0.0) { $0 + $1.area }
            let mx = r.map(\.area).max() ?? 0, mn = r.map(\.area).min() ?? 0
            guard s > 0, mn > 0 else { return .infinity }
            return max(w * w * mx / (s * s), s * s / (w * w * mn))
        }
        func layoutRow(_ r: [(item: T, area: Double)]) {
            let s = r.reduce(0.0) { $0 + $1.area }
            guard s > 0 else { return }
            let horizontal = rect.width >= rect.height
            let thickness = s / Double(horizontal ? rect.height : rect.width)
            guard thickness > 0 else { return }
            var pos = horizontal ? Double(rect.minY) : Double(rect.minX)
            for it in r {
                let len = it.area / thickness
                let rr = horizontal
                    ? CGRect(x: rect.minX, y: pos, width: thickness, height: len)
                    : CGRect(x: pos, y: rect.minY, width: len, height: thickness)
                result.append(Cell(item: it.item, rect: rr))
                pos += len
            }
            if horizontal {
                rect = CGRect(x: rect.minX + thickness, y: rect.minY, width: rect.width - thickness, height: rect.height)
            } else {
                rect = CGRect(x: rect.minX, y: rect.minY + thickness, width: rect.width, height: rect.height - thickness)
            }
        }
        for it in scaled {
            let w = Double(min(rect.width, rect.height))
            if row.isEmpty || worst(row + [it], w) <= worst(row, w) {
                row.append(it)
            } else {
                layoutRow(row); row = [it]
            }
        }
        layoutRow(row)
        return result
    }

    /// The largest prefix of brands whose boxes stay identifiable; the rest keep their area inside one
    /// combined box (the web's readableInventoryLayout: 88 × 60 points per box as the floor).
    static func readable(_ groups: [Group], width: CGFloat, height: CGFloat) -> (shown: [Group], rest: [Group]) {
        guard width > 0, height > 0, !groups.isEmpty else { return ([], []) }
        let maxBoxes = max(1, Int(width * height / (88 * 60)))
        var shown = min(groups.count, maxBoxes)
        let total = Double(groups.reduce(0) { $0 + $1.count })
        while shown > 1 {
            let smallest = Double(groups[shown - 1].count)
            if smallest / total * Double(width * height) >= 88 * 60 { break }
            shown -= 1
        }
        if shown == groups.count { return (groups, []) }
        return (Array(groups.prefix(shown)), Array(groups.suffix(from: shown)))
    }
}

/// The map: brand boxes with their decades inside, plus one box for the long tail.
struct LiveInventoryMapView: View {
    let lots: [LiveAuction]
    var height: CGFloat = 250
    var onSelect: (_ make: String?, _ decade: String?) -> Void = { _, _ in }

    private struct Box: Identifiable {
        let id: String
        let title: String
        let count: Int
        let make: String?          // nil for the combined long-tail box
        let cells: [LiveInventory.Cell<(key: String, count: Int, make: String?)>]
        let rect: CGRect
    }

    private func boxes(in size: CGSize) -> [Box] {
        let groups = LiveInventory.groups(lots, by: LiveInventory.make)
        let (shown, rest) = LiveInventory.readable(groups, width: size.width, height: size.height)
        var items: [(item: (title: String, count: Int, make: String?, children: [LiveInventory.Group]), area: Double)] = shown.map {
            (item: (title: $0.key, count: $0.count, make: $0.key, children: LiveInventory.groups($0.lots, by: LiveInventory.decade)), area: Double($0.count))
        }
        if !rest.isEmpty {
            let n = rest.reduce(0) { $0 + $1.count }
            items.append((item: (title: "+\(rest.count) brands", count: n, make: nil, children: rest), area: Double(n)))
        }
        let laid = LiveInventory.squarify(items, in: CGRect(origin: .zero, size: size))
        return laid.map { cell in
            let inner = cell.rect.insetBy(dx: 2, dy: 2)
            let body = CGRect(x: inner.minX, y: inner.minY + 18, width: inner.width, height: max(0, inner.height - 18))
            let children: [LiveInventory.Cell<(key: String, count: Int, make: String?)>] = body.height > 10 && body.width > 10
                ? LiveInventory.squarify(cell.item.children.map { (item: (key: $0.key, count: $0.count, make: cell.item.make ?? $0.key), area: Double($0.count)) }, in: body)
                : []
            return Box(id: cell.item.title, title: cell.item.title, count: cell.item.count, make: cell.item.make, cells: children, rect: cell.rect)
        }
    }

    var body: some View {
        GeometryReader { geo in
            let bs = boxes(in: geo.size)
            ZStack(alignment: .topLeading) {
                ForEach(bs) { box in
                    boxView(box)
                        .frame(width: max(0, box.rect.width - 2), height: max(0, box.rect.height - 2))
                        .clipped()
                        .position(x: box.rect.midX, y: box.rect.midY)
                }
            }
        }
        .frame(height: height)
    }

    /// The brand box: a titled frame whose title row opens the brand's lots, with its decade cells inside.
    @ViewBuilder private func boxView(_ box: Box) -> some View {
        ZStack(alignment: .topLeading) {
            RoundedRectangle(cornerRadius: 4).fill(Color(uiColor: .secondarySystemGroupedBackground))
            ForEach(Array(box.cells.enumerated()), id: \.offset) { _, c in
                cellView(c, in: box)
            }
            HStack(spacing: 4) {
                Text(box.title).font(.system(size: 9, weight: .semibold)).lineLimit(1)
                Text(box.count.formatted()).font(.system(size: 8, design: .monospaced)).foregroundStyle(.secondary)
            }
            .padding(.horizontal, 4)
            .frame(height: 16)
            .contentShape(Rectangle())
            .onTapGesture { onSelect(box.make, nil) }
        }
    }

    /// One decade cell (or one brand cell inside the long-tail box), shaded by its share of the box.
    @ViewBuilder private func cellView(_ c: LiveInventory.Cell<(key: String, count: Int, make: String?)>, in box: Box) -> some View {
        let r = c.rect.insetBy(dx: 1, dy: 1)
        let share = min(1.0, Double(c.item.count) / Double(max(1, box.count)))
        let opacity: Double = box.make == nil ? 0.18 : 0.12 + 0.5 * share
        let label: String = box.make == nil ? c.item.key.capitalized : c.item.key
        Rectangle()
            .fill(Color.accentColor.opacity(opacity))
            .frame(width: max(0, r.width), height: max(0, r.height))
            .overlay(alignment: .topLeading) {
                if r.width >= 40 && r.height >= 12 {
                    Text(label)
                        .font(.system(size: 7, design: .monospaced))
                        .lineLimit(1)
                        .foregroundStyle(.primary)
                        .padding(2)
                }
            }
            .position(x: r.midX - box.rect.minX, y: r.midY - box.rect.minY)
            .contentShape(Rectangle())
            .onTapGesture {
                if box.make == nil { onSelect(c.item.key, nil) } else { onSelect(box.make, c.item.key) }
            }
    }
}
