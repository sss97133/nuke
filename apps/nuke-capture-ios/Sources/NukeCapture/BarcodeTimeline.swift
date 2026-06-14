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

// ─── Bucket model ────────────────────────────────────────────────────────────

struct TimelineBucket: Identifiable {
    let id: String          // ISO bucket key used as ScrollViewReader anchor
    let count: Int          // sum of ALL day counts in bucket (the pinned grid signal)
    let photos: Int         // per-facet sub-counts
    let work: Int
    let latestDay: String   // "yyyy-MM-dd" of the most-recent nonzero day in bucket
    let yearBoundary: Int?  // unused in calendar mode; kept for API compatibility

    func count(for filter: String) -> Int {
        switch filter {
        case "photos": return photos
        case "work":   return work
        default:       return count
        }
    }
}

// ─── Facets ──────────────────────────────────────────────────────────────────

struct TimelineFacet: Identifiable {
    let key: String
    let label: String
    let color: Color
    var id: String { key }
}

let timelineFacets: [TimelineFacet] = [
    .init(key: "all",    label: "ALL",    color: .primary),
    .init(key: "photos", label: "PHOTOS", color: .green),
    .init(key: "work",   label: "WORK",   color: .orange),
]

// ─── Calendar cell model ─────────────────────────────────────────────────────

private struct CalCell: Identifiable {
    let id: String          // "yyyy-MM-dd"
    let date: Date
    let inRange: Bool       // false = padding cell before/after data range
    let count: Int          // ALL-facet count for this day
    let photos: Int
    let work: Int

    func count(for filter: String) -> Int {
        switch filter {
        case "photos": return photos
        case "work":   return work
        default:       return count
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
    for d in days {
        countByDay[d.day] = d.photos + d.events + d.work
        photosByDay[d.day] = d.photos
        workByDay[d.day] = d.work
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
                work: inRange ? (workByDay[key] ?? 0) : 0
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
        VStack(alignment: .leading, spacing: 6) {
            filterPills
            calendarGrid
        }
        .onAppear { recompute() }
        .onChange(of: days.count) { _, _ in recompute() }
    }

    // ─── Filter pills ─────────────────────────────────────────────────────────

    @ViewBuilder private var filterPills: some View {
        let totals = facetTotals
        let shown = timelineFacets.filter { $0.key == "all" || (totals[$0.key] ?? 0) > 0 }
        if shown.count > 1 {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(shown) { facet in
                        let active = activeFilter == facet.key
                        Text("\(facet.label) (\(totals[facet.key] ?? 0))")
                            .font(.caption2.weight(.semibold))
                            .monospacedDigit()
                            .padding(.horizontal, 9)
                            .padding(.vertical, 4)
                            .foregroundStyle(active ? Color(.systemBackground) : facet.color)
                            .background { Capsule().fill(active ? facet.color : Color.clear) }
                            .overlay { Capsule().stroke(facet.color.opacity(active ? 0 : 0.5), lineWidth: 1) }
                            .contentShape(Capsule())
                            .onTapGesture { activeFilter = facet.key }
                    }
                }
                .padding(.horizontal, 12)
            }
        }
    }

    // ─── Calendar grid ────────────────────────────────────────────────────────

    // Cell geometry — matches web: 11×11 px squares, 2 px gap
    private let cellSide: CGFloat = 11
    private let cellGap:  CGFloat = 2
    private let dayLabelW: CGFloat = 10   // left column for S/M/T labels

    // Height of the 7-row grid
    private var gridH: CGFloat { 7 * cellSide + 6 * cellGap }

    // Height of the month-label row above the grid
    private let monthRowH: CGFloat = 12
    // Height of year label row (rendered inline in first column of new year)
    private let yearRowH: CGFloat = 0   // year shown as column overlay, not a row

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

    // Web --heat palette (ContributionTimeline.tsx):
    //   empty #ebedf0 | bucket1 #d9f99d | bucket2 #a7f3d0
    //   bucket3 #34d399 | bucket4 #059669 | bucket5 #047857
    // Dark mode: same greens with reduced opacity on a #2d2d30 base.
    private var fillColor: Color {
        guard cell.inRange else {
            return Color(hex: "#ebedf0").opacity(0.25)   // out-of-range: very faint
        }
        switch facetCount {
        case 0:      return Color.clear
        case 1:      return Color(hex: "#d9f99d")
        case 2:      return Color(hex: "#a7f3d0")
        case 3:      return Color(hex: "#34d399")
        case 4:      return Color(hex: "#059669")
        default:     return Color(hex: "#047857")
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
