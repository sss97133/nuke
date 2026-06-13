// BarcodeTimeline.swift — horizontal barcode instrument for the profile.
//
// Bucketing logic:
//   span ≤ 400 days  → one bar per day
//   span ≤ 3000 days → one bar per week (Mon-anchored ISO week)
//   span  > 3000 days → one bar per month
//
// Bar height: sqrt(count) normalised to [4, 64] pt.
// Bar width: 3pt, gap: 1pt, color: .primary, bg: clear.
// Tap: exposes the most-recent DayRecord inside the bucket via the
//      provided onSelect callback (caller owns the sheet).

import SwiftUI

// ─── Bucket model ────────────────────────────────────────────────────────────

struct TimelineBucket: Identifiable {
    let id: String          // ISO bucket key used as ScrollViewReader anchor
    let count: Int          // sum of ALL day counts in bucket (the pinned grid signal)
    let photos: Int         // per-facet sub-counts — colors/heights recolor off these
    let work: Int           // never rebuild the grid; filters read these instead
    let latestDay: String   // "yyyy-MM-dd" of the most-recent nonzero day in bucket
    let yearBoundary: Int?  // set on the first bucket of a new year (the year value)

    /// The count for a given filter key — ALL is the pinned superset.
    func count(for filter: String) -> Int {
        switch filter {
        case "photos": return photos
        case "work":   return work
        default:       return count
        }
    }
}

// ─── Facets ──────────────────────────────────────────────────────────────────
// Mirrors nuke_frontend/src/pages/user-profile/UserBarcodeTimeline.tsx FILTERS:
// a pill renders ONLY when its facet's total > 0 (skill-fingerprint doctrine).
// iOS surfaces the three facets the contribution-day record actually carries
// (photo · event/work). Colors are the iOS analogue of the web --heat scale.

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

// ─── Builder ─────────────────────────────────────────────────────────────────

enum BucketUnit { case day, week, month }

private func buildBuckets(days: [DayRecord]) -> (buckets: [TimelineBucket], unit: BucketUnit) {
    guard !days.isEmpty else { return ([], .day) }

    let fmt = DateFormatter()
    fmt.dateFormat = "yyyy-MM-dd"
    fmt.locale = Locale(identifier: "en_US_POSIX")

    // Build a lookup: "yyyy-MM-dd" → total count, plus per-facet sub-counts.
    // The grid (positions/widths/ticks) is built from the ALL total ONLY; the
    // per-facet maps just recolor/rescale the same fixed grid on filter.
    var countByDay: [String: Int] = [:]
    var photosByDay: [String: Int] = [:]
    var workByDay: [String: Int] = [:]
    for d in days {
        countByDay[d.day] = d.photos + d.events + d.work
        photosByDay[d.day] = d.photos
        workByDay[d.day] = d.work
    }

    // Full date range: earliest day in the data → today
    let sortedDays = days.map(\.day).sorted()
    guard let firstStr = sortedDays.first,
          let earliest = fmt.date(from: firstStr) else { return ([], .day) }

    let today = Calendar.current.startOfDay(for: Date())
    let span = Calendar.current.dateComponents([.day], from: earliest, to: today).day ?? 0

    let unit: BucketUnit = span > 3000 ? .month : span > 400 ? .week : .day

    // Generate all calendar dates from earliest → today
    var buckets: [TimelineBucket] = []
    var cursor = earliest
    var lastYear: Int? = nil

    while cursor <= today {
        let bucketKey: String
        let bucketEnd: Date

        switch unit {
        case .day:
            bucketKey = fmt.string(from: cursor)
            bucketEnd = cursor
        case .week:
            // ISO week Monday anchor
            var comps = Calendar.current.dateComponents([.yearForWeekOfYear, .weekOfYear], from: cursor)
            bucketKey = "W\(comps.yearForWeekOfYear!)-\(String(format: "%02d", comps.weekOfYear!))"
            bucketEnd = Calendar.current.date(byAdding: .day, value: 6, to: cursor) ?? cursor
        case .month:
            let comps = Calendar.current.dateComponents([.year, .month], from: cursor)
            bucketKey = "\(comps.year!)-\(String(format: "%02d", comps.month!))"
            // last day of the month
            let nextMonth = Calendar.current.date(byAdding: .month, value: 1, to: cursor)!
            bucketEnd = Calendar.current.date(byAdding: .day, value: -1, to: nextMonth) ?? cursor
        }

        // Sum all days in this bucket window
        var total = 0
        var photosTotal = 0
        var workTotal = 0
        var latest = ""
        var scanCursor = cursor
        while scanCursor <= min(bucketEnd, today) {
            let key = fmt.string(from: scanCursor)
            if let c = countByDay[key], c > 0 {
                total += c
                photosTotal += photosByDay[key] ?? 0
                workTotal += workByDay[key] ?? 0
                if key > latest { latest = key }
            }
            scanCursor = Calendar.current.date(byAdding: .day, value: 1, to: scanCursor) ?? scanCursor
        }
        if latest.isEmpty { latest = fmt.string(from: cursor) }  // fallback for empty buckets

        // Year boundary tick
        let yearComps = Calendar.current.dateComponents([.year], from: cursor)
        let year = yearComps.year!
        let yearBoundary: Int? = (lastYear == nil || year != lastYear!) ? year : nil
        lastYear = year

        buckets.append(TimelineBucket(id: bucketKey, count: total, photos: photosTotal,
                                      work: workTotal, latestDay: latest, yearBoundary: yearBoundary))

        // Advance cursor to next bucket start
        switch unit {
        case .day:   cursor = Calendar.current.date(byAdding: .day, value: 1, to: cursor) ?? today
        case .week:  cursor = Calendar.current.date(byAdding: .weekOfYear, value: 1, to: cursor) ?? today
        case .month: cursor = Calendar.current.date(byAdding: .month, value: 1, to: cursor) ?? today
        }
    }

    return (buckets, unit)
}

// ─── View ─────────────────────────────────────────────────────────────────────

struct BarcodeTimeline: View {
    let days: [DayRecord]
    /// Called when a nonzero bar is tapped; passes the most-recent DayRecord
    /// inside the bucket so the caller can present its existing day sheet.
    var onSelect: (DayRecord) -> Void

    private let barWidth: CGFloat = 3
    private let barGap:   CGFloat = 1
    private let maxH:     CGFloat = 64
    private let minH:     CGFloat = 4

    // Precompute once; DayRecord is a value type so Equatable derivation
    // is automatic — but we key off days.count as a cheap change signal.
    //
    // PINNED WINDOW: `buckets` is built ONCE from the ALL set. `activeFilter`
    // only recolors the bars and rescales their height (per-facet max) — it
    // never rebuilds the grid, so positions / widths / year ticks never move.
    @State private var buckets: [TimelineBucket] = []
    @State private var maxCount: Int = 1
    @State private var activeFilter = "all"

    /// Per-facet totals from the ALL set — drives which pills render. A facet
    /// with zero events never shows a pill (skill fingerprint, web parity).
    private var facetTotals: [String: Int] {
        var photos = 0, work = 0, all = 0
        for b in buckets { all += b.count; photos += b.photos; work += b.work }
        return ["all": all, "photos": photos, "work": work]
    }

    /// Max count for the active facet — bar heights rescale to fill the
    /// instrument for whatever facet is selected (the ALL grid stays pinned).
    private var activeMax: Int {
        max(1, buckets.map { $0.count(for: activeFilter) }.max() ?? 1)
    }

    // Lookup by day string for onSelect
    private var dayIndex: [String: DayRecord] = [:]

    init(days: [DayRecord], onSelect: @escaping (DayRecord) -> Void) {
        self.days = days
        self.onSelect = onSelect
        var idx: [String: DayRecord] = [:]
        for d in days { idx[d.day] = d }
        self.dayIndex = idx
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            filterPills
            barcode
        }
        .onAppear { recompute() }
        .onChange(of: days.count) { _, _ in recompute() }
    }

    // ─── Filter pills — only facets with data; ALL/PHOTOS/WORK, web parity ───
    @ViewBuilder private var filterPills: some View {
        let totals = facetTotals
        let shown = timelineFacets.filter { ($0.key == "all") || (totals[$0.key] ?? 0) > 0 }
        if shown.count > 1 {   // a lone ALL pill is noise — only show when there's a real choice
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
                            .background {
                                Capsule().fill(active ? facet.color : Color.clear)
                            }
                            .overlay {
                                Capsule().stroke(facet.color.opacity(active ? 0 : 0.5), lineWidth: 1)
                            }
                            .contentShape(Capsule())
                            .onTapGesture { activeFilter = facet.key }
                    }
                }
                .padding(.horizontal, 12)
            }
        }
    }

    // ─── The barcode itself — grid pinned, color/height react to filter ──────
    private var barcode: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .bottom, spacing: barGap) {
                    ForEach(buckets) { bucket in
                        VStack(alignment: .leading, spacing: 2) {
                            // Bar — height/fill come from the ACTIVE facet's
                            // count; the bucket's x-position and width never move.
                            let facetCount = bucket.count(for: activeFilter)
                            let h = barHeight(facetCount)
                            let facetColor = timelineFacets.first { $0.key == activeFilter }?.color ?? .primary
                            Rectangle()
                                .fill(facetCount > 0 ? facetColor
                                                     : (bucket.count > 0 ? Color.primary.opacity(0.12) : Color.clear))
                                .frame(width: barWidth, height: h)
                                .contentShape(Rectangle().size(CGSize(width: barWidth, height: maxH)))
                                .onTapGesture {
                                    guard bucket.count > 0 else { return }
                                    if let d = dayIndex[bucket.latestDay] {
                                        onSelect(d)
                                    }
                                }

                            // Year tick — String(year), never "\(year)":
                            // interpolation hits LocalizedStringKey and
                            // locale-formats the Int as "2,017".
                            if let year = bucket.yearBoundary {
                                Text(String(year))
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                                    .monospacedDigit()
                                    .fixedSize()
                                    .frame(width: 28, alignment: .leading)
                                    .offset(x: 0)
                            } else {
                                // Placeholder keeps the year-row height stable
                                Color.clear
                                    .frame(width: barWidth, height: 12)
                            }
                        }
                        .id(bucket.id)
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
            }
            .onAppear {
                // Scroll to trailing end (today)
                if let last = buckets.last {
                    proxy.scrollTo(last.id, anchor: .trailing)
                }
            }
            .onChange(of: buckets.count) { _, _ in
                if let last = buckets.last {
                    proxy.scrollTo(last.id, anchor: .trailing)
                }
            }
        }
    }

    private func recompute() {
        let (b, _) = buildBuckets(days: days)
        buckets = b
        maxCount = b.map(\.count).max() ?? 1
    }

    private func barHeight(_ count: Int) -> CGFloat {
        // Zero in the active facet → a short ghost tick (the bar's fill decides
        // whether it shows as faint or clear). Scale against the ACTIVE facet's
        // max so the selected facet fills the instrument; the grid is pinned.
        guard count > 0 else { return minH }
        let ratio = sqrt(Double(count)) / sqrt(Double(activeMax))
        return max(minH, CGFloat(ratio) * maxH)
    }
}
