import SwiftUI

// ─── The build barcode ────────────────────────────────────────────────────────
//
// The COLLAPSED form of the build instrument — the same green heat the calendar
// (BarcodeTimeline) shows, suppressed from a 2-D grid to a 1-D strip. Faithful to
// the web's collapsed `barcode-strip` (nuke_frontend/.../BarcodeTimeline.tsx +
// styles/vehicle-profile.css): a flush row of FULL-HEIGHT weekly stripes, each
// colored by that week's labor level on the green ramp (empty weeks blank), so the
// collapsed barcode and the expanded calendar read as one instrument. Color, not
// bar height, carries the heat — the same ramp + metric BarcodeTimeline uses, so
// the two states never disagree.
struct BuildBarcode: View {
    let days: [DayRecord]
    var height: CGFloat = 13

    var body: some View {
        Canvas { ctx, size in
            let cols = Self.weekColors(days)
            guard !cols.isEmpty else { return }
            let bw = size.width / CGFloat(cols.count)
            // Empty weeks render as a QUIET adaptive bar (not blank, not a slab) so
            // the band reads as filled-vs-empty density on ANY surface — the GitHub
            // model. Adaptive system fill → correct in light AND dark mode; the green
            // ramp stays the themeable colorway layer. No foreign field needed.
            let empty = Color(uiColor: .quaternarySystemFill)
            for (i, c) in cols.enumerated() {
                let x = CGFloat(i) * bw
                let rect = CGRect(x: x, y: 0, width: bw + 0.6, height: size.height)
                ctx.fill(Path(rect), with: .color(c ?? empty)) // full-height, flush
            }
        }
        .frame(height: height)
    }

    // Short, human-typable origin from the UUID head → "NK·83F6·F033". The vehicle's
    // fingerprint; resolves (with the full id) to nuke.ag/vehicle/<id>.
    static func originCode(_ vehicleId: String) -> String {
        let hex = vehicleId.replacingOccurrences(of: "-", with: "").uppercased()
        let head = Array(hex.prefix(8))
        guard head.count == 8 else { return "NK·\(vehicleId.prefix(8).uppercased())" }
        return "NK·\(String(head[0..<4]))·\(String(head[4..<8]))"
    }

    // One color per calendar week across the build span (earliest day → latest),
    // nil = no activity that week. A week's color is its hottest day on the green
    // ramp — mirrors the web's "max level per week" + the iOS heatmap's hours→color.
    static func weekColors(_ days: [DayRecord]) -> [Color?] {
        let withDay = days.compactMap { d -> (Int, DayRecord)? in epochDay(d.day).map { ($0, d) } }
        guard let lo = withDay.map(\.0).min(),
              let hi = withDay.map(\.0).max() else { return [] }
        let weeks = (hi - lo) / 7 + 1
        var maxHours = Array(repeating: 0.0, count: weeks)
        for (ep, d) in withDay {
            let w = (ep - lo) / 7
            maxHours[w] = Swift.max(maxHours[w], dayHours(d))
        }
        return maxHours.map { heatColor($0) }
    }

    // The heatmap's value-weighted "hours" for a day (BarcodeTimeline CalCell, ALL
    // facet): confirmed labor runs the full range; a pile of photos is capped cool.
    private static func dayHours(_ d: DayRecord) -> Double {
        let labor = Double(d.workMinutes) / 60.0 + Swift.min(4.0, Double(d.workCost) / 250.0)
        if labor > 0 { return Swift.min(12.0, labor + 0.5) }
        var h = 0.0
        if d.photos > 0 { h += Swift.min(2.3, Double(d.photos) / 24.0) + 0.2 }
        h += 0.2 * Double(d.events)
        return Swift.min(3.0, h)
    }

    // The exact green ramp BarcodeTimeline + the web use. nil = empty (blank).
    private static func heatColor(_ hours: Double) -> Color? {
        guard hours > 0 else { return nil }
        switch hours {
        case ..<1:  return Color(hex: "#d9f99d")
        case ..<3:  return Color(hex: "#a7f3d0")
        case ..<6:  return Color(hex: "#34d399")
        case ..<12: return Color(hex: "#059669")
        default:    return Color(hex: "#047857")
        }
    }

    // Days since 1970-01-01 from "yyyy-MM-dd" (Howard Hinnant's civil algorithm) —
    // exact, no DateFormatter, so weekly bucketing lands on real week boundaries.
    static func epochDay(_ s: String) -> Int? {
        let p = s.split(separator: "-")
        guard p.count == 3, let y0 = Int(p[0]), let m = Int(p[1]), let d = Int(p[2]) else { return nil }
        let y = m <= 2 ? y0 - 1 : y0
        let era = (y >= 0 ? y : y - 399) / 400
        let yoe = y - era * 400
        let doy = (153 * (m > 2 ? m - 3 : m + 9) + 2) / 5 + d - 1
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
        return era * 146097 + doe - 719468
    }
}
