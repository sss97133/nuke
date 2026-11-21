// GarageDayGrid.swift — one car's recorded activity as day squares, the web garage card's MiniBarcode:
// seven rows (Monday to Sunday), one column per week, the last 53 weeks ending today (UTC days). Every day
// that has happened is a heat-0 square; an active day steps through heat 3 … 6 at the garage-wide quartiles
// (GarageAxis), so two cards compare. The day of the photo on screen is outlined.
//
// Not BarcodeTimeline: that one is Sunday-anchored, scrolls and scales per car.

import SwiftUI

struct GarageDayGrid: View {
    let timeline: GarageTimeline?
    let axis: GarageAxis
    /// The day of the photo showing in the card's pager, when it falls in the window.
    var litDay: String? = nil

    private var cells: [(column: Int, row: Int, heat: Int)] {
        (timeline?.days ?? []).compactMap { d in
            guard d.total > 0, let at = BuildBarcode.epochDay(d.day), let c = axis.cell(at) else { return nil }
            return (c.column, c.row, axis.heat(d.total))
        }
    }

    private var activeDaysInWindow: Int { cells.count }

    var body: some View {
        let weeks = CGFloat(GarageAxis.weeks)
        Canvas { context, size in
            // A square is 0.84 of its cell, as on the web (viewBox units of one cell).
            let unit = min(size.width / (weeks - 0.16), size.height / 6.84)
            let side = unit * 0.84
            let radius = unit * 0.15
            func rect(_ column: Int, _ row: Int, inset: CGFloat = 0) -> CGRect {
                CGRect(x: CGFloat(column) * unit - inset, y: CGFloat(row) * unit - inset,
                       width: side + inset * 2, height: side + inset * 2)
            }
            let empty = HeatRamp.color(0)
            for i in 0..<axis.dayCount {
                context.fill(Path(roundedRect: rect(i / 7, i % 7), cornerRadius: radius), with: .color(empty))
            }
            for c in cells {
                context.fill(Path(roundedRect: rect(c.column, c.row), cornerRadius: radius), with: .color(HeatRamp.color(c.heat)))
            }
            if let litDay, let at = BuildBarcode.epochDay(litDay), let c = axis.cell(at) {
                context.stroke(Path(roundedRect: rect(c.column, c.row, inset: unit * 0.08), cornerRadius: unit * 0.2),
                               with: .color(.primary), lineWidth: max(1, unit * 0.16))
            }
        }
        .aspectRatio((weeks - 0.16) / 6.84, contentMode: .fit)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(Text("\(activeDaysInWindow) active \(activeDaysInWindow == 1 ? "day" : "days") recorded in the last year"))
    }
}
