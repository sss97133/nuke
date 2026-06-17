// BarcodeTimeline.swift — 365-day calendar squares instrument.
//
// Grammar ported from nuke_frontend/src/components/profile/ContributionTimeline.tsx:
//   • 7 rows (Sun–Sat) × week columns, Sunday-anchored
//   • square cells 11×11 pt, gap 2 pt
//   • 5-bucket intensity: empty outline → .primary at 4 opacities
//   • month labels above the grid (J F M A … )
//   • day-of-week labels at left (S M T W T F S), alternating
//   • horizontally scrollable; auto-scrolls to today (trailing edge)
//   • tapping a nonzero day → onSelect with the DayRecord
//
// Span: continuous week-columns from the earliest DayRecord through today —
// can cover many years, no year-switching UI needed.
//
// Filter pills (ALL / PHOTOS / WORK) recolor cells without rebuilding the grid.

import SwiftUI

// ─── Hex color helper ────────────────────────────────────────────────────────

extension Color {
    /// Init from a CSS hex string (e.g. "#34d399" or "34d399").
    /// Supports 6-digit RGB only. Falls back to clear on bad input.
    init(hex: String) {
        let h = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
        guard h.count == 6, let value = UInt64(h, radix: 16) else {
            self = .clear; return
        }
        let r = Double((value >> 16) & 0xFF) / 255
        let g = Double((value >>  8) & 0xFF) / 255
        let b = Double( value        & 0xFF) / 255
        self = Color(red: r, green: g, blue: b)
    }
}


// ─── Facets ──────────────────────────────────────────────────────────────────

struct TimelineFacet: Identifiable {
    let key: String
    let label: String
    let color: Color
    var id: String { key }
}

// Pills are FILTERS (which count drives cell intensity), not a color key. They
// render in achromatic ink — the cells are always the green heat ramp regardless
// of filter, so a green/orange pill would lie about the cells it controls.
let timelineFacets: [TimelineFacet] = [
    .init(key: "all",    label: "ALL",    color: .primary),
    .init(key: "photos", label: "PHOTOS", color: .primary),
    .init(key: "work",   label: "WORK",   color: .primary),
]

// ─── Calendar cell model ─────────────────────────────────────────────────────

private struct CalCell: Identifiable {
    let id: String          // "yyyy-MM-dd"
    let date: Date
    let inRange: Bool       // false = padding cell before/after data range
    let count: Int          // ALL-facet count for this day
    let photos: Int
    let work: Int           // confirmed work SESSIONS
    let workMinutes: Int    // confirmed labor minutes — the value spine
    let workCost: Int       // job dollars on confirmed work

    func count(for filter: String) -> Int {
        switch filter {
        case "photos": return photos
        case "work":   return work
        default:       return count
        }
    }

    /// Confirmed labor "hours" of this day — minutes + a money term. A logged job
    /// is the real productivity signal; a pile of photos is not.
    private var laborHours: Double {
        Double(workMinutes) / 60.0 + min(4.0, Double(workCost) / 250.0)  // $1000 job → +4
    }

    /// Heat for the active facet. The DEFAULT/ALL facet is VALUE-weighted: a day
    /// of confirmed labor runs the full heat range; a day of only photos is capped
    /// cool (≤3) so 60 selfies can NEVER read as hot as a logged welding job — the
    /// core fix for "a documentation day looks as valuable as a money day." The
    /// PHOTOS facet is the explicit documentation lens; WORK is pure labor.
    func hours(for filter: String) -> Double {
        switch filter {
        case "photos":
            return photos > 0 ? min(12.0, Double(photos) / 20.0 + 0.25) : 0
        case "work":
            return min(12.0, laborHours)
        default:
            if laborHours > 0 { return min(12.0, laborHours + 0.5) }
            // No confirmed labor → photo/event density, capped LOW. Keeps the
            // strip informative (and vehicle timelines, which surface no labor,
            // still show gradients) without ever out-heating real work.
            let events = max(0, count - photos - work)
            var h = 0.0
            if photos > 0 { h += min(2.3, Double(photos) / 24.0) + 0.2 }
            h += 0.2 * Double(events)
            return min(3.0, h)
        }
    }
}

// ─── Week column model ────────────────────────────────────────────────────────

private struct WeekCol: Identifiable {
    var id: String { anchorDay }
    let anchorDay: String   // Sunday of this week "yyyy-MM-dd"
    let cells: [CalCell]    // always 7, Sun first
    let monthLabel: String? // e.g. "J" — set on first week of a new month
    let yearLabel: Int?     // set on first week of a new year
}

// ─── Builder ─────────────────────────────────────────────────────────────────

private func buildWeekCols(days: [DayRecord]) -> [WeekCol] {
    guard !days.isEmpty else { return [] }

    let cal = Calendar.current
    let fmt = DateFormatter()
    fmt.dateFormat = "yyyy-MM-dd"
    fmt.locale = Locale(identifier: "en_US_POSIX")

    // Lookup maps
    var countByDay: [String: Int] = [:]
    var photosByDay: [String: Int] = [:]
    var workByDay: [String: Int] = [:]
    var minutesByDay: [String: Int] = [:]
    var costByDay: [String: Int] = [:]
    for d in days {
        countByDay[d.day] = d.photos + d.events + d.work
        photosByDay[d.day] = d.photos
        workByDay[d.day] = d.work
        minutesByDay[d.day] = d.workMinutes
        costByDay[d.day] = d.workCost
    }

    // Date range: earliest day → today
    let sortedDays = days.map(\.day).sorted()
    guard let firstStr = sortedDays.first,
          let earliest = fmt.date(from: firstStr) else { return [] }

    let today = cal.startOfDay(for: Date())

    // Sunday on or before earliest
    func startOfWeekSunday(_ d: Date) -> Date {
        var comps = cal.dateComponents([.yearForWeekOfYear, .weekOfYear, .weekday], from: d)
        comps.weekday = 1   // Sunday
        return cal.date(from: comps) ?? d
    }

    var cursor = startOfWeekSunday(earliest)
    var weekCols: [WeekCol] = []
    var prevMonth: Int? = nil
    var prevYear: Int? = nil

    let monthLabels = ["J","F","M","A","M","J","J","A","S","O","N","D"]

    while cursor <= today {
        var cells: [CalCell] = []
        var monthLabel: String? = nil
        var yearLabel: Int? = nil

        for d in 0..<7 {
            let cellDate = cal.date(byAdding: .day, value: d, to: cursor)!
            let key = fmt.string(from: cellDate)
            let inRange = cellDate <= today && cellDate >= earliest

            cells.append(CalCell(
                id: key,
                date: cellDate,
                inRange: inRange,
                count: inRange ? (countByDay[key] ?? 0) : 0,
                photos: inRange ? (photosByDay[key] ?? 0) : 0,
                work: inRange ? (workByDay[key] ?? 0) : 0,
                workMinutes: inRange ? (minutesByDay[key] ?? 0) : 0,
                workCost: inRange ? (costByDay[key] ?? 0) : 0
            ))

            // Month label on Sunday of the first week that touches a new month
            if d == 0 {
                let m = cal.component(.month, from: cellDate)
                let y = cal.component(.year, from: cellDate)
                if prevMonth != m {
                    monthLabel = monthLabels[m - 1]
                    prevMonth = m
                }
                if prevYear != y {
                    yearLabel = y
                    prevYear = y
                }
            }
        }

        weekCols.append(WeekCol(
            anchorDay: fmt.string(from: cursor),
            cells: cells,
            monthLabel: monthLabel,
            yearLabel: yearLabel
        ))

        cursor = cal.date(byAdding: .weekOfYear, value: 1, to: cursor) ?? today
    }

    return weekCols
}

// ─── View ─────────────────────────────────────────────────────────────────────

struct BarcodeTimeline: View {
    let days: [DayRecord]
    var onSelect: (DayRecord) -> Void

    // Pinned grid built once from ALL data; filter only recolors
    @State private var weekCols: [WeekCol] = []
    @State private var activeFilter = "all"

    // Day index for onSelect
    private var dayIndex: [String: DayRecord]

    init(days: [DayRecord], onSelect: @escaping (DayRecord) -> Void) {
        self.days = days
        self.onSelect = onSelect
        var idx: [String: DayRecord] = [:]
        for d in days { idx[d.day] = d }
        self.dayIndex = idx
    }

    // Per-facet totals → which pills to show
    private var facetTotals: [String: Int] {
        var all = 0, photos = 0, work = 0
        for d in days { all += d.photos + d.events + d.work; photos += d.photos; work += d.work }
        return ["all": all, "photos": photos, "work": work]
    }

    var body: some View {
        // No ALL/PHOTOS/WORK filter pills — they read as clutter (Skylar, repeatedly).
        // The grid shows all activity on the value-weighted heat; activeFilter stays "all".
        calendarGrid
            .onAppear { recompute() }
            .onChange(of: days.count) { _, _ in recompute() }
    }

    // ─── Calendar grid ────────────────────────────────────────────────────────

    // Cell geometry — matches web: 11×11 px squares, 2 px gap
    private let cellSide: CGFloat = 11
    private let cellGap:  CGFloat = 2
    private let dayLabelW: CGFloat = 10   // left column for S/M/T labels

    // Height of the month-label row above the grid
    private let monthRowH: CGFloat = 12

    private var calendarGrid: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .top, spacing: 0) {
                    // Day-of-week labels column (S M T W T F S, alternating shown)
                    VStack(spacing: 0) {
                        // spacer for month label row
                        Color.clear.frame(width: dayLabelW, height: monthRowH)
                        ForEach(0..<7, id: \.self) { i in
                            let labels = ["S","M","T","W","T","F","S"]
                            Text(i % 2 == 1 ? labels[i] : " ")
                                .font(.system(size: 7))
                                .foregroundStyle(.secondary)
                                .frame(width: dayLabelW, height: cellSide)
                            if i < 6 {
                                Spacer().frame(height: cellGap)
                            }
                        }
                    }

                    // Week columns
                    HStack(alignment: .top, spacing: cellGap) {
                        ForEach(weekCols) { week in
                            WeekColView(
                                week: week,
                                cellSide: cellSide,
                                cellGap: cellGap,
                                monthRowH: monthRowH,
                                activeFilter: activeFilter,
                                onTap: { date in
                                    if let d = dayIndex[date] {
                                        onSelect(d)
                                    }
                                }
                            )
                        }
                    }
                    .id("grid")
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
            }
            .onAppear {
                proxy.scrollTo("grid", anchor: .trailing)
            }
            .onChange(of: weekCols.count) { _, _ in
                proxy.scrollTo("grid", anchor: .trailing)
            }
        }
    }

    private func recompute() {
        weekCols = buildWeekCols(days: days)
    }
}

// ─── Single week column ───────────────────────────────────────────────────────

private struct WeekColView: View {
    let week: WeekCol
    let cellSide: CGFloat
    let cellGap: CGFloat
    let monthRowH: CGFloat
    let activeFilter: String
    let onTap: (String) -> Void

    var body: some View {
        VStack(spacing: 0) {
            // Month label row — shown on first week of each month
            ZStack(alignment: .bottomLeading) {
                Color.clear.frame(width: cellSide, height: monthRowH)
                if let label = week.monthLabel {
                    Text(label)
                        .font(.system(size: 8))
                        .foregroundStyle(.secondary)
                }
            }

            // 7 day cells
            VStack(spacing: cellGap) {
                ForEach(week.cells) { cell in
                    CellView(
                        cell: cell,
                        side: cellSide,
                        activeFilter: activeFilter,
                        onTap: onTap
                    )
                }
            }

            // Year label below grid on the first week of a new year
            if let year = week.yearLabel {
                Text(String(year))
                    .font(.system(size: 7))
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
                    .frame(width: cellSide * 2.5, alignment: .leading)
                    .padding(.top, 2)
            }
        }
    }
}

// ─── Single day cell ─────────────────────────────────────────────────────────

private struct CellView: View {
    let cell: CalCell
    let side: CGFloat
    let activeFilter: String
    let onTap: (String) -> Void

    private var facetCount: Int { cell.count(for: activeFilter) }

    // Web --heat palette + the web's HOURS thresholds (ContributionTimeline.tsx
    // colorForHours: <1 | <3 | <6 | <12 | 12+). The old code bucketed on raw
    // count (1/2/3/4/5+) so any active day (Skylar logs 8-60 photos/day)
    // instantly saturated to the darkest green — the strip read as a flat dark
    // wall, the "uninformative" complaint. Coloring on the same estimated-hours
    // transform the web uses restores a real gradient where light and heavy
    // days are visibly different.
    //   empty #ebedf0 | <1h #d9f99d | <3h #a7f3d0 | <6h #34d399 | <12h #059669 | 12h #047857
    private var fillColor: Color {
        guard cell.inRange else {
            return Color(hex: "#ebedf0").opacity(0.25)   // out-of-range: very faint
        }
        let h = cell.hours(for: activeFilter)
        switch h {
        case ..<0.0001: return Color.clear
        case ..<1:      return Color(hex: "#d9f99d")
        case ..<3:      return Color(hex: "#a7f3d0")
        case ..<6:      return Color(hex: "#34d399")
        case ..<12:     return Color(hex: "#059669")
        default:        return Color(hex: "#047857")
        }
    }

    private var strokeColor: Color {
        guard cell.inRange else { return Color.clear }
        // empty cells: the web's #ebedf0 outline
        return facetCount == 0 ? Color(hex: "#ebedf0") : Color.clear
    }

    var body: some View {
        Rectangle()
            .fill(fillColor)
            .frame(width: side, height: side)
            .overlay(Rectangle().stroke(strokeColor, lineWidth: 0.5))
            .contentShape(Rectangle())
            .onTapGesture {
                guard cell.inRange && cell.count > 0 else { return }
                onTap(cell.id)
            }
    }
}
