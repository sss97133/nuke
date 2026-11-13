// ProfilePhotoHistory.swift — the profile's headline: the photo record over time.
//
// "Good to see the 82k images. Bad everything else" (owner, 2026-11-12). The photo record is what a
// builder's profile proves, so it leads: the count on the record, how long it has been kept, and a
// photos-per-month chart across every year, with the newest real photos beneath. A tap goes deeper
// (year → day → the day's receipt), never to the same numbers again.
//
// Every value is computed from the profile's one calendar read (get_user_contribution_calendar:
// vehicle_images per day by taken_at, or upload time when the file has no capture date). Nothing is
// sampled or padded. A missing read is said to be unknown, never zero.
//
// Tenure ("since 2017") is deterministic: the month holding the record's 1st-percentile photo, so a
// handful of misdated files (a 1981 timestamp) do not stretch the span. Those earlier photos are
// counted, shown in the year list, and named under the chart — never dropped.

import SwiftUI

// ─── The pure model (unit-tested in UnitTests/ProfilePhotoHistoryTests.swift) ──────────────────

struct PhotoHistory: Equatable {
    struct YearMonth: Equatable, Hashable, Comparable {
        let year: Int
        let month: Int          // 1…12
        var index: Int { year * 12 + (month - 1) }
        static func < (a: YearMonth, b: YearMonth) -> Bool { a.index < b.index }
        func next() -> YearMonth { month == 12 ? YearMonth(year: year + 1, month: 1) : YearMonth(year: year, month: month + 1) }
        var shortTitle: String { "\(Self.monthNames[month - 1]) \(year)" }
        static let monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    }
    struct Month: Equatable, Identifiable {
        let at: YearMonth
        let photos: Int
        let days: Int
        var id: Int { at.index }
    }
    struct Year: Equatable, Identifiable {
        let year: Int
        let photos: Int
        let days: Int
        let activeMonths: Int
        var id: Int { year }
    }

    /// Photos on the record (every dated day the calendar returned).
    let total: Int
    /// Days with at least one photo.
    let photoDays: Int
    /// Start of the tenure span: the month holding the 1st-percentile photo.
    let since: YearMonth
    /// Photos dated before `since` (still in `years`).
    let earlier: Int
    /// Every month from `since` through the current month, inclusive. A month with no photo rows is 0.
    let months: [Month]
    /// Every year with a photo, newest first, including years before `since`.
    let years: [Year]

    var activeMonths: Int { months.filter { $0.photos > 0 }.count }
    var peakMonth: Month? { months.max { $0.photos < $1.photos } }
    var bestYear: Year? { years.max { $0.photos < $1.photos } }
    /// Whole years elapsed from the tenure start month to the last month ("9 yrs" for Apr 2017 → Nov 2026).
    var spanYears: Int { max(months.count - 1, 0) / 12 }

    /// The 1st-percentile rule, shared with the vehicle timeline: the first key whose cumulative count
    /// exceeds 1% of the total. Keys must be ascending.
    static func percentileStart<K>(_ ascending: [(K, Int)], fraction: Double = 0.01) -> K? {
        let total = ascending.reduce(0) { $0 + $1.1 }
        guard total > 0 else { return nil }
        let threshold = Double(total) * fraction
        var running = 0
        for (key, n) in ascending where n > 0 {
            running += n
            if Double(running) > threshold { return key }
        }
        return ascending.last(where: { $0.1 > 0 })?.0
    }

    /// "yyyy-MM-dd" → (year, month); nil when the string isn't a calendar day.
    static func yearMonth(_ day: String) -> YearMonth? {
        let parts = day.prefix(10).split(separator: "-")
        guard parts.count == 3, let y = Int(parts[0]), let m = Int(parts[1]), (1...12).contains(m), y > 1900 else { return nil }
        return YearMonth(year: y, month: m)
    }

    /// Nil when the calendar holds no photo day: no headline, no chart, never a zero.
    init?(days: [DayRecord], now: Date = Date(), calendar: Calendar = .current) {
        var byMonth: [YearMonth: (photos: Int, days: Int)] = [:]
        for d in days where d.photos > 0 {
            guard let ym = Self.yearMonth(d.day) else { continue }
            let cur = byMonth[ym] ?? (0, 0)
            byMonth[ym] = (cur.photos + d.photos, cur.days + 1)
        }
        guard !byMonth.isEmpty else { return nil }
        let ascending = byMonth.keys.sorted()
        guard let since = Self.percentileStart(ascending.map { ($0, byMonth[$0]!.photos) }) else { return nil }

        let comps = calendar.dateComponents([.year, .month], from: now)
        var end = YearMonth(year: comps.year ?? ascending.last!.year, month: comps.month ?? 12)
        if let last = ascending.last, last > end { end = last }   // a future-dated file still shows

        var months: [Month] = []
        var cursor = since
        while cursor <= end {
            let v = byMonth[cursor]
            months.append(Month(at: cursor, photos: v?.photos ?? 0, days: v?.days ?? 0))
            cursor = cursor.next()
        }

        var years: [Int: (photos: Int, days: Int, months: Int)] = [:]
        for (ym, v) in byMonth {
            let cur = years[ym.year] ?? (0, 0, 0)
            years[ym.year] = (cur.photos + v.photos, cur.days + v.days, cur.months + 1)
        }

        self.total = byMonth.values.reduce(0) { $0 + $1.photos }
        self.photoDays = byMonth.values.reduce(0) { $0 + $1.days }
        self.since = since
        self.earlier = ascending.filter { $0 < since }.reduce(0) { $0 + byMonth[$1]!.photos }
        self.months = months
        self.years = years.map { Year(year: $0.key, photos: $0.value.photos, days: $0.value.days, activeMonths: $0.value.months) }
            .sorted { $0.year > $1.year }
    }
}

/// The hero's strings, as pure functions.
enum PhotoHistoryCopy {
    /// "Since 2017 · 9 yrs"; "Since Nov 2026" when the record began this year.
    static func tenure(_ h: PhotoHistory) -> String {
        h.spanYears >= 1 ? "Since \(h.since.year) · \(h.spanYears) yr\(h.spanYears == 1 ? "" : "s")" : "Since \(h.since.shortTitle)"
    }

    /// "112 of 117 months" — how consistently the record was kept across the span.
    static func consistency(_ h: PhotoHistory) -> String {
        "\(h.activeMonths.formatted()) of \(h.months.count.formatted()) months"
    }

    /// "141 earlier photos are dated before Mar 2017"; nil when there are none.
    static func earlierNote(_ h: PhotoHistory) -> String? {
        guard h.earlier > 0 else { return nil }
        return "\(NukeDisplay.count(h.earlier, "earlier photo")) dated before \(h.since.shortTitle) \(h.earlier == 1 ? "is" : "are") in the year list."
    }

    /// The year labels the chart can fit: every year when there's room, else every other one.
    static func yearTicks(_ h: PhotoHistory, maxLabels: Int = 6) -> [PhotoHistory.YearMonth] {
        let januaries = h.months.map(\.at).filter { $0.month == 1 }
        guard januaries.count > maxLabels else { return januaries }
        let step = Int((Double(januaries.count) / Double(maxLabels)).rounded(.up))
        return januaries.enumerated().filter { $0.offset % step == 0 }.map(\.element)
    }
}

// ─── The chart: photos per month across the whole span ──────────────────────────────────────────

struct PhotoMonthChart: View {
    let history: PhotoHistory
    var height: CGFloat = 96

    var body: some View {
        let months = history.months
        let peak = max(history.peakMonth?.photos ?? 1, 1)
        VStack(spacing: 4) {
            Canvas { ctx, size in
                guard !months.isEmpty else { return }
                let slot = size.width / CGFloat(months.count)
                let gap: CGFloat = slot > 3 ? 1 : 0
                for (i, m) in months.enumerated() {
                    let x = CGFloat(i) * slot
                    // Baseline tick for an empty month: the span is continuous, a gap is a real month.
                    let h = m.photos > 0 ? max(2, size.height * CGFloat(m.photos) / CGFloat(peak)) : 1
                    let rect = CGRect(x: x, y: size.height - h, width: max(slot - gap, 0.5), height: h)
                    let isLast = i == months.count - 1
                    ctx.fill(Path(rect), with: .color(m.photos > 0
                        ? (isLast ? Color.accentColor : Color.accentColor.opacity(0.72))
                        : Color.secondary.opacity(0.25)))
                }
            }
            .frame(height: height)

            GeometryReader { geo in
                let slot = geo.size.width / CGFloat(max(months.count, 1))
                ForEach(PhotoHistoryCopy.yearTicks(history), id: \.index) { tick in
                    let i = tick.index - history.since.index
                    Text(String(tick.year))
                        .font(.caption2).monospacedDigit()
                        .foregroundStyle(.tertiary)
                        .fixedSize()
                        .position(x: min(max(CGFloat(i) * slot + 12, 12), geo.size.width - 12), y: 6)
                }
            }
            .frame(height: 12)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Photos per month, \(history.since.shortTitle) to now")
        .accessibilityValue(history.peakMonth.map { "Busiest month \($0.at.shortTitle), \($0.photos.formatted()) photos" } ?? "")
    }
}

// ─── The newest real photos ─────────────────────────────────────────────────────────────────────

/// Owner-only read (get_user_profile_photos gates on auth.uid() = p_user_id): the newest frames on the
/// record, copies collapsed. A visitor's profile shows no mosaic rather than a stand-in.
enum RecentPhotoReader {
    private struct Params: Encodable { let p_user_id: String; let p_limit: Int }

    static func load(userId: String, count: Int = 12) async throws -> [ProfilePhoto] {
        let rows: [ProfilePhoto] = try await SupabaseService.client
            .rpc("get_user_profile_photos", params: Params(p_user_id: userId, p_limit: count * 3))
            .execute().value
        return Array(PhotoPresentation.collapse(rows).filter { ($0.thumb ?? $0.url)?.isEmpty == false }.prefix(count))
    }
}

struct RecentPhotoMosaic: View {
    let photos: [ProfilePhoto]
    var columns = 6

    var body: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 2), count: columns), spacing: 2) {
            ForEach(photos) { p in
                NukePhoto(url: NukeImage.thumb(p.thumb ?? p.url, width: 200), maxPixel: 240, emptyIcon: "photo")
                    .aspectRatio(1, contentMode: .fit)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: NukeRadius.small, style: .continuous))
        .accessibilityHidden(true)
    }
}

// ─── The hero ───────────────────────────────────────────────────────────────────────────────────

struct ProfilePhotoRecordHero: View {
    /// Nil while the calendar loads or when it holds no photo day.
    let history: PhotoHistory?
    /// True once the calendar read settled (loaded or failed).
    let settled: Bool
    /// The producer signals' photo total: the fallback headline when the calendar failed.
    let fallbackTotal: Int?
    /// Owner only: photos this phone's library lets the app read (the on-device catalog).
    let libraryCount: Int?
    let name: String?
    let handle: String?
    let recent: [ProfilePhoto]
    /// The person's own photo and words, only when they set them; never a placeholder face.
    var avatarURL: URL? = nil
    var bio: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: NukeSpace.md) {
            if name != nil || handle != nil {
                HStack(spacing: 8) {
                    if let avatarURL {
                        NukePhoto(url: avatarURL, maxPixel: 120, emptyIcon: "person")
                            .frame(width: 28, height: 28)
                            .clipShape(Circle())
                    }
                    if let name { Text(name).font(.nukeCardTitle).foregroundStyle(Color.primary).lineLimit(1) }
                    if let handle { Text("@\(handle)").font(.subheadline).foregroundStyle(.secondary).lineLimit(1) }
                }
            }
            if let bio, !bio.isEmpty {
                Text(bio).font(.footnote).foregroundStyle(.secondary).lineLimit(2)
            }

            HStack(alignment: .firstTextBaseline, spacing: NukeSpace.lg) {
                VStack(alignment: .leading, spacing: 0) {
                    headline
                    Text(subline).font(.caption).foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
                if let libraryCount, libraryCount > 0 {
                    VStack(alignment: .trailing, spacing: 0) {
                        Text(libraryCount.formatted())
                            .font(.system(.title3, design: .rounded).weight(.bold)).monospacedDigit()
                            .foregroundStyle(Color.primary)
                        Text("in this phone's library").font(.caption).foregroundStyle(.secondary)
                    }
                }
            }

            if let history {
                PhotoMonthChart(history: history)
                HStack(spacing: NukeSpace.xl) {
                    metric(history.photoDays.formatted(), "photo days")
                    metric(PhotoHistoryCopy.consistency(history), "documented")
                    if let best = history.bestYear { metric(String(best.year), "best year · \(best.photos.formatted())") }
                }
            } else if !settled {
                NukeSkeletonBlock(height: 96)
            }

            if !recent.isEmpty { RecentPhotoMosaic(photos: recent) }
        }
        .padding(.vertical, NukeSpace.xs)
    }

    @ViewBuilder private var headline: some View {
        let font = Font.system(size: 44, weight: .bold, design: .rounded).monospacedDigit()
        if let history {
            Text(history.total.formatted()).font(font).foregroundStyle(Color.primary)
        } else if let fallbackTotal {
            Text(fallbackTotal.formatted()).font(font).foregroundStyle(Color.primary)
        } else if settled {
            Text("Unknown").font(.system(size: 34, weight: .bold, design: .rounded)).foregroundStyle(.secondary)
        } else {
            NukeSkeletonBlock(height: 44).frame(maxWidth: 200)
        }
    }

    private var subline: String {
        if let history { return "photos on the record · \(PhotoHistoryCopy.tenure(history))" }
        if fallbackTotal != nil { return "photos on the record" }
        return settled ? "photo record unavailable" : "photos on the record"
    }

    @ViewBuilder private func metric(_ value: String, _ label: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(value).font(.subheadline.weight(.semibold)).monospacedDigit().foregroundStyle(Color.primary)
            Text(label).font(.caption2).foregroundStyle(.secondary)
        }
    }
}

// ─── The drill: by year → by day → the day's receipt ────────────────────────────────────────────

struct ProfilePhotoHistoryView<Ledger: View>: View {
    let userId: String
    let history: PhotoHistory?
    let days: [DayRecord]
    let isOwn: Bool
    /// Owner only: uploads, filing and on-device reads (ProfilePhotoRecordView).
    let record: AnyView?
    /// Owner only: the phone ↔ record sync ledger.
    @ViewBuilder let ledger: () -> Ledger

    var body: some View {
        List {
            if let history {
                Section {
                    PhotoMonthChart(history: history, height: 120)
                        .padding(.vertical, NukeSpace.sm)
                } footer: {
                    Text(PhotoHistoryCopy.earlierNote(history) ?? "Every month since \(history.since.shortTitle); a flat tick is a month with no photo on the record.")
                }

                Section {
                    let peak = max(history.bestYear?.photos ?? 1, 1)
                    ForEach(history.years) { y in
                        NavigationLink {
                            ProfilePhotoYearView(userId: userId, year: y.year, days: days)
                        } label: {
                            yearRow(y, peak: peak)
                        }
                    }
                } header: {
                    Text("By year")
                } footer: {
                    Text("Counted from your photos' capture dates (upload time when a file has none), one row per photo on the record.")
                }
            } else {
                Section { Text("No dated photos on the record yet.").font(.footnote).foregroundStyle(.secondary) }
            }

            if isOwn, let record {
                Section {
                    NavigationLink { record } label: {
                        Label("Uploads, filing and on-device reads", systemImage: "square.stack.3d.up")
                    }
                }
            }
            ledger()
        }
        .navigationTitle("Photo record")
        .navigationBarTitleDisplayMode(.inline)
    }

    @ViewBuilder private func yearRow(_ y: PhotoHistory.Year, peak: Int) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline) {
                Text(String(y.year)).font(.nukeCardTitle).monospacedDigit()
                Spacer()
                Text(y.photos.formatted()).font(.subheadline.weight(.semibold)).monospacedDigit()
            }
            GeometryReader { geo in
                Capsule().fill(Color.accentColor.opacity(0.72))
                    .frame(width: max(3, geo.size.width * CGFloat(y.photos) / CGFloat(peak)), height: 4)
            }
            .frame(height: 4)
            Text("\(NukeDisplay.count(y.days, "photo day")) · \(y.activeMonths) of 12 months")
                .font(.caption).monospacedDigit().foregroundStyle(.secondary)
        }
        .padding(.vertical, 2)
    }
}

/// One year's photo days, by month, newest first. Each day opens its receipt (photos, work, receipts).
struct ProfilePhotoYearView: View {
    let userId: String
    let year: Int
    let days: [DayRecord]
    @State private var receiptDay: DayRecord?

    private struct MonthDays: Identifiable {
        let month: Int
        let days: [DayRecord]
        var id: Int { month }
    }

    private var months: [MonthDays] {
        let inYear = days.filter { $0.photos > 0 && PhotoHistory.yearMonth($0.day)?.year == year }
        let grouped = Dictionary(grouping: inYear) { (d: DayRecord) in PhotoHistory.yearMonth(d.day)?.month ?? 0 }
        return grouped.keys.sorted(by: >).map { m in
            MonthDays(month: m, days: (grouped[m] ?? []).sorted { a, b in a.day > b.day })
        }
    }

    var body: some View {
        List {
            ForEach(months) { m in
                Section {
                    ForEach(m.days) { d in
                        Button { receiptDay = d } label: {
                            HStack {
                                Text(d.day).monospacedDigit().foregroundStyle(Color.primary)
                                Spacer()
                                Text(NukeDisplay.count(d.photos, "photo")).monospacedDigit().foregroundStyle(.secondary)
                                if d.workMinutes > 0 {
                                    Text("· \(d.workMinutes / 60)h \(d.workMinutes % 60)m logged").monospacedDigit().foregroundStyle(.tertiary)
                                }
                            }
                            .font(.subheadline)
                            .frame(minHeight: NukeSize.minTap)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                } header: {
                    let total = m.days.reduce(0) { $0 + $1.photos }
                    Text("\(PhotoHistory.YearMonth.monthNames[max(m.month - 1, 0)]) · \(total.formatted()) photos")
                }
            }
        }
        .navigationTitle(String(year))
        .navigationBarTitleDisplayMode(.inline)
        .sheet(item: $receiptDay) { day in
            DayReceiptView(userId: userId, date: day.day)
                .presentationDetents([.medium, .large])
        }
    }
}
