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
    let count: Int          // sum of all day counts in bucket
    let latestDay: String   // "yyyy-MM-dd" of the most-recent nonzero day in bucket
    let yearBoundary: Int?  // set on the first bucket of a new year (the year value)
}

// ─── Builder ─────────────────────────────────────────────────────────────────

enum BucketUnit { case day, week, month }

private func buildBuckets(days: [DayRecord]) -> (buckets: [TimelineBucket], unit: BucketUnit) {
    guard !days.isEmpty else { return ([], .day) }

    let fmt = DateFormatter()
    fmt.dateFormat = "yyyy-MM-dd"
    fmt.locale = Locale(identifier: "en_US_POSIX")

    // Build a lookup: "yyyy-MM-dd" → total count
    var countByDay: [String: Int] = [:]
    for d in days { countByDay[d.day] = d.photos + d.events + d.work }

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
        var latest = ""
        var scanCursor = cursor
        while scanCursor <= min(bucketEnd, today) {
            let key = fmt.string(from: scanCursor)
            if let c = countByDay[key], c > 0 {
                total += c
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

        buckets.append(TimelineBucket(id: bucketKey, count: total, latestDay: latest, yearBoundary: yearBoundary))

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
    @State private var buckets: [TimelineBucket] = []
    @State private var maxCount: Int = 1

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
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .bottom, spacing: barGap) {
                    ForEach(buckets) { bucket in
                        VStack(alignment: .leading, spacing: 2) {
                            // Bar
                            let h = barHeight(bucket.count)
                            Rectangle()
                                .fill(bucket.count > 0 ? Color.primary : Color.clear)
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
        .onAppear { recompute() }
        .onChange(of: days.count) { _, _ in recompute() }
    }

    private func recompute() {
        let (b, _) = buildBuckets(days: days)
        buckets = b
        maxCount = b.map(\.count).max() ?? 1
    }

    private func barHeight(_ count: Int) -> CGFloat {
        guard count > 0, maxCount > 0 else { return maxH }  // invisible bar for empty
        let ratio = sqrt(Double(count)) / sqrt(Double(maxCount))
        return max(minH, CGFloat(ratio) * maxH)
    }
}
