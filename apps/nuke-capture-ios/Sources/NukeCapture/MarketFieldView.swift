// MarketFieldView — the market as a POSITIONED field, not a decorated ranking.
//
// The lesson that produced this: a treemap/donut/spiral all encode ONE number (count)
// in geometry — a ranked bar chart in a costume, no insight. An intelligent graph uses
// POSITION (the highest-accuracy channel; Cleveland & McGill) for TWO real variables so
// STRUCTURE appears. Here each make is a point:
//   x = inventory volume (log)      — how much is out there
//   y = sell-through %  (velocity)  — how fast it actually moves
//   size = demand (avg watchers)    — how coveted
//   color = typical era (avg_year)  — classic ↔ modern
// You read structure a list can't give: the big slow commodity pool (Chevy/GMC, high
// volume / low velocity), the liquid European mass (Porsche/BMW, high both), the coveted
// thin frontier (Ferrari — low velocity, huge demand). Honest: renders only returned
// data, no fabrication, no average price printed. anon, read-only.

import SwiftUI
import UIKit

struct MarketFieldView: View {
    private struct Row: Decodable, Identifiable {
        let name: String; let volume: Int; let sell_through: Int
        let demand: Int?; let avg_year: Int?; let median_price: Int?
        var id: String { name }
    }
    private struct Params: Encodable { let p_dimension: String; let p_limit: Int }

    @State private var rows: [Row] = []
    @State private var loading = true
    @State private var failed = false
    @State private var selected: String?
    private let haptic = UIImpactFeedbackGenerator(style: .light)

    var body: some View {
        Group {
            if loading && rows.isEmpty {
                VStack(spacing: 10) { ProgressView(); Text("Mapping the market…")
                    .font(.system(.footnote, design: .monospaced)).foregroundStyle(.secondary) }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if failed && rows.isEmpty {
                ContentUnavailableView { Label("Couldn't load", systemImage: "wifi.exclamationmark") }
                actions: { Button("Retry") { Task { await load() } }.buttonStyle(.borderedProminent) }
            } else {
                field
            }
        }
        .task { await load() }
    }

    // Axis domains (log X for the power-law volume; linear Y for %).
    private var vLo: Double { log10(Double(max(1, rows.map(\.volume).min() ?? 1))) }
    private var vHi: Double { log10(Double(max(2, rows.map(\.volume).max() ?? 2))) }
    private var sHi: Double { Double(max(1, rows.map(\.sell_through).max() ?? 1)) }
    private var dHi: Double { Double(max(1, rows.compactMap { $0.demand }.max() ?? 1)) }

    private var field: some View {
        VStack(spacing: 0) {
            HStack(alignment: .firstTextBaseline) {
                Text("MARKET").font(.system(.subheadline, design: .monospaced)).tracking(2).foregroundStyle(.secondary)
                Text("· where the action is").font(.system(.caption, design: .monospaced)).foregroundStyle(.tertiary)
                Spacer()
                Text("\(rows.count) makes").font(.system(.caption, design: .monospaced)).foregroundStyle(.tertiary)
            }.padding(.horizontal, 14).padding(.top, 4).padding(.bottom, 2)

            GeometryReader { geo in
                let plot = CGRect(x: 44, y: 12, width: geo.size.width - 58, height: geo.size.height - 46)
                Canvas { ctx, _ in draw(ctx, plot: plot) }
                    .contentShape(Rectangle())
                    .onTapGesture { tap($0, plot: plot) }
                    .overlay(alignment: .topLeading) { legend.padding(.leading, 52).padding(.top, 16) }
                    .overlay(alignment: .bottom) { readout }
            }
        }
    }

    // ─── position mapping ───────────────────────────────────────────────────────
    private func px(_ v: Int, _ plot: CGRect) -> Double {
        let t = (log10(Double(max(1, v))) - vLo) / max(0.001, vHi - vLo)
        return plot.minX + t * plot.width
    }
    private func py(_ s: Int, _ plot: CGRect) -> Double {
        let t = Double(s) / max(1, sHi)
        return plot.maxY - t * plot.height          // higher sell-through = higher up
    }
    private func radius(_ d: Int?) -> Double {
        let t = (Double(d ?? 0)).squareRoot() / max(1, dHi.squareRoot())
        return 4 + 15 * max(0, min(1, t))
    }
    // era ramp: classic (warm amber) → modern (cool blue).
    private func eraColor(_ y: Int?) -> Color {
        let t = max(0, min(1, (Double(y ?? 1990) - 1965) / 50))
        func mix(_ a: Double, _ b: Double) -> Double { a + (b - a) * t }
        return Color(red: mix(0.93, 0.20), green: mix(0.62, 0.52), blue: mix(0.24, 0.86))
    }

    private func draw(_ ctx: GraphicsContext, plot: CGRect) {
        // grid + axis ticks
        let axis = GraphicsContext.Shading.color(.primary.opacity(0.12))
        for dec in stride(from: ceil(vLo), through: floor(vHi), by: 1) {   // 10,100,1k,10k,100k
            let x = plot.minX + (dec - vLo) / max(0.001, vHi - vLo) * plot.width
            var l = Path(); l.move(to: CGPoint(x: x, y: plot.minY)); l.addLine(to: CGPoint(x: x, y: plot.maxY))
            ctx.stroke(l, with: axis, lineWidth: 0.5)
            let lab = pow(10, dec)
            ctx.draw(Text(shortNum(lab)).font(.system(size: 9, design: .monospaced)).foregroundColor(.secondary),
                     at: CGPoint(x: x, y: plot.maxY + 10), anchor: .center)
        }
        for pct in stride(from: 0, through: Int(sHi), by: max(10, Int(sHi) / 4 / 10 * 10 + 10)) {
            let y = py(pct, plot)
            var l = Path(); l.move(to: CGPoint(x: plot.minX, y: y)); l.addLine(to: CGPoint(x: plot.maxX, y: y))
            ctx.stroke(l, with: axis, lineWidth: 0.5)
            ctx.draw(Text("\(pct)%").font(.system(size: 9, design: .monospaced)).foregroundColor(.secondary),
                     at: CGPoint(x: plot.minX - 6, y: y), anchor: .trailing)
        }
        ctx.draw(Text("inventory →").font(.system(size: 9, design: .monospaced)).foregroundColor(Color(white: 0.55)),
                 at: CGPoint(x: plot.maxX, y: plot.maxY + 22), anchor: .trailing)
        ctx.draw(Text("↑ sells").font(.system(size: 9, design: .monospaced)).foregroundColor(Color(white: 0.55)),
                 at: CGPoint(x: plot.minX - 30, y: plot.minY + 4), anchor: .center)

        // points (big/behind first so small ones stay clickable on top)
        for r in rows.sorted(by: { $0.volume > $1.volume }) {
            let c = CGPoint(x: px(r.volume, plot), y: py(r.sell_through, plot))
            let rad = radius(r.demand)
            let sel = (r.name == selected)
            let rect = CGRect(x: c.x - rad, y: c.y - rad, width: rad * 2, height: rad * 2)
            ctx.fill(Path(ellipseIn: rect), with: .color(eraColor(r.avg_year).opacity(0.82)))
            ctx.stroke(Path(ellipseIn: rect), with: .color(sel ? .primary : .white.opacity(0.7)),
                       lineWidth: sel ? 2 : 0.6)
            // label only the notable ones (big, or extreme velocity/demand) — no clutter.
            let notable = r.volume > Int(pow(10, vLo + (vHi - vLo) * 0.62))
                || r.sell_through >= Int(sHi * 0.85) || (r.demand ?? 0) >= Int(dHi * 0.85)
            if notable || sel {
                ctx.draw(Text(r.name).font(.system(size: 9.5, weight: .semibold))
                    .foregroundColor(sel ? .primary : Color(white: 0.2)),
                    at: CGPoint(x: c.x, y: c.y - rad - 7), anchor: .center)
            }
        }
    }

    private var legend: some View {
        HStack(spacing: 10) {
            HStack(spacing: 3) { Circle().fill(eraColor(1970)).frame(width: 8, height: 8)
                Text("classic").font(.system(size: 9, design: .monospaced)) }
            HStack(spacing: 3) { Circle().fill(eraColor(2010)).frame(width: 8, height: 8)
                Text("modern").font(.system(size: 9, design: .monospaced)) }
            Text("· size = demand").font(.system(size: 9, design: .monospaced)).foregroundStyle(.secondary)
        }
        .padding(.horizontal, 8).padding(.vertical, 4)
        .background(.ultraThinMaterial, in: Capsule())
        .foregroundStyle(.secondary)
    }

    @ViewBuilder private var readout: some View {
        if let n = selected, let r = rows.first(where: { $0.name == n }) {
            HStack(spacing: 14) {
                Text(r.name).font(.system(.subheadline).weight(.semibold))
                stat("\(r.volume.formatted())", "listed")
                stat("\(r.sell_through)%", "sells")
                if let d = r.demand { stat("\(d)", "watching") }
                if let y = r.avg_year { stat("~'\(String(format: "%02d", y % 100))", "era") }
            }
            .padding(.horizontal, 12).padding(.vertical, 7)
            .background(.ultraThinMaterial, in: Capsule())
            .padding(.bottom, 8)
        }
    }
    private func stat(_ v: String, _ k: String) -> some View {
        VStack(spacing: 0) {
            Text(v).font(.system(.footnote, design: .monospaced).weight(.semibold))
            Text(k).font(.system(size: 8, design: .monospaced)).foregroundStyle(.secondary)
        }
    }

    private func tap(_ loc: CGPoint, plot: CGRect) {
        var best: (String, Double)?
        for r in rows {
            let c = CGPoint(x: px(r.volume, plot), y: py(r.sell_through, plot))
            let d = Double((c.x - loc.x) * (c.x - loc.x) + (c.y - loc.y) * (c.y - loc.y))
            if best == nil || d < best!.1 { best = (r.name, d) }
        }
        if let b = best, b.1 < 1600 { if selected != b.0 { haptic.impactOccurred() }; selected = b.0 }
        else { selected = nil }
    }

    private func shortNum(_ v: Double) -> String {
        v >= 1000 ? "\(Int(v / 1000))k" : "\(Int(v))"
    }

    private func load() async {
        loading = true; failed = false
        do {
            rows = try await SupabaseService.client
                .rpc("market_position", params: Params(p_dimension: "make", p_limit: 120)).execute().value
            haptic.prepare()
            loading = false
        } catch { failed = true; loading = false }
    }
}
