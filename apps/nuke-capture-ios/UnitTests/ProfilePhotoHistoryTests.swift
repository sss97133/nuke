// ProfilePhotoHistoryTests.swift — the profile's headline is computed from the calendar, never padded.
//
// Fixture: the owner's photo record per year as prod held it on 2026-11-12 (vehicle_images by
// coalesce(taken_at, created_at)), each year's photos placed on one day so the arithmetic is visible.

import XCTest
@testable import NukeCapture

final class ProfilePhotoHistoryTests: XCTestCase {
    private let perYear: [(Int, Int)] = [
        (1981, 1), (2004, 2), (2005, 6), (2006, 6), (2007, 13), (2008, 12), (2009, 21), (2010, 10), (2011, 15),
        (2012, 11), (2013, 8), (2014, 10), (2015, 6), (2016, 20), (2017, 1672), (2018, 4119), (2019, 2610),
        (2020, 1464), (2021, 2260), (2022, 798), (2023, 1022), (2024, 3871), (2025, 4952), (2026, 6840),
    ]
    private var utc: Calendar { var c = Calendar(identifier: .gregorian); c.timeZone = TimeZone(identifier: "UTC")!; return c }
    private let now = Date(timeIntervalSince1970: 1_794_484_800)   // 2026-11-12 12:00 UTC

    private var days: [DayRecord] { perYear.map { DayRecord(day: "\($0.0)-06-15", photos: $0.1) } }

    func testHeadlineIsTheRecordsOwnTotal() throws {
        let h = try XCTUnwrap(PhotoHistory(days: days, now: now, calendar: utc))
        XCTAssertEqual(h.total, 29_749)
        XCTAssertEqual(h.photoDays, 24)
        XCTAssertEqual(h.years.count, 24, "every year with a photo is listed, including those before the span")
        XCTAssertEqual(h.years.first?.year, 2026)
        XCTAssertEqual(h.bestYear?.year, 2026)
        XCTAssertEqual(h.bestYear?.photos, 6_840)
    }

    func testTenureStartsAtTheFirstPercentileNotAMisdatedFile() throws {
        let h = try XCTUnwrap(PhotoHistory(days: days, now: now, calendar: utc))
        XCTAssertEqual(h.since, PhotoHistory.YearMonth(year: 2017, month: 6))
        XCTAssertEqual(h.earlier, 141, "the 141 photos dated 1981–2016 are counted, not dropped")
        XCTAssertEqual(PhotoHistoryCopy.tenure(h), "Since 2017 · 9 yrs")
        XCTAssertEqual(PhotoHistoryCopy.earlierNote(h), "141 earlier photos dated before Jun 2017 are in the year list.")
    }

    func testMonthsAreContinuousThroughTheCurrentMonth() throws {
        let h = try XCTUnwrap(PhotoHistory(days: days, now: now, calendar: utc))
        XCTAssertEqual(h.months.first?.at, PhotoHistory.YearMonth(year: 2017, month: 6))
        XCTAssertEqual(h.months.last?.at, PhotoHistory.YearMonth(year: 2026, month: 11))
        XCTAssertEqual(h.months.count, 114)
        XCTAssertEqual(h.activeMonths, 10)
        XCTAssertEqual(PhotoHistoryCopy.consistency(h), "10 of 114 months")
        XCTAssertEqual(h.months.reduce(0) { $0 + $1.photos } + h.earlier, h.total)
    }

    func testNoPhotoDayMeansNoHeadlineNeverZero() {
        XCTAssertNil(PhotoHistory(days: [], now: now, calendar: utc))
        XCTAssertNil(PhotoHistory(days: [DayRecord(day: "2026-11-01", work: 2, workMinutes: 90)], now: now, calendar: utc))
        XCTAssertNil(PhotoHistory(days: [DayRecord(day: "not-a-day", photos: 4)], now: now, calendar: utc))
    }

    func testAFutureDatedFileExtendsTheSpanRatherThanVanishing() throws {
        let h = try XCTUnwrap(PhotoHistory(days: [DayRecord(day: "2026-10-01", photos: 50),
                                                 DayRecord(day: "2027-02-01", photos: 50)], now: now, calendar: utc))
        XCTAssertEqual(h.months.last?.at, PhotoHistory.YearMonth(year: 2027, month: 2))
        XCTAssertEqual(PhotoHistoryCopy.tenure(h), "Since Oct 2026")
    }

    func testYearTicksThinOutOnALongSpan() throws {
        let h = try XCTUnwrap(PhotoHistory(days: days, now: now, calendar: utc))
        let ticks = PhotoHistoryCopy.yearTicks(h)
        XCTAssertLessThanOrEqual(ticks.count, 6)
        XCTAssertEqual(ticks.first?.year, 2018)
        XCTAssertTrue(ticks.allSatisfy { $0.month == 1 })
    }

    func testPercentileStartIgnoresEmptyKeys() {
        XCTAssertNil(PhotoHistory.percentileStart([(1, 0), (2, 0)]))
        XCTAssertEqual(PhotoHistory.percentileStart([(1, 0), (2, 5)]), 2)
        XCTAssertEqual(PhotoHistory.percentileStart([(1985, 1), (2017, 99), (2018, 100)]), 2017)
    }
}
