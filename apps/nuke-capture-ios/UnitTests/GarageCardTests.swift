// GarageCardTests.swift — the garage cards' pure rules, against the readers' live shapes (GarageCardFixtures):
// the batch day reader decodes, the order and year headings match the web, the day grid's window and quartile
// steps match garageAxis, the lane and "Active …" words match the web card, the header takes only the masthead
// price Claim, and the log book decodes a null answer as an empty book.

import XCTest
@testable import NukeCapture

final class GarageCardTests: XCTestCase {
    /// Friday 2026-11-20 12:00 UTC.
    private let now = ISO8601DateFormatter().date(from: "2026-11-20T12:00:00Z")!

    private func garage() throws -> [GarageVehicle] {
        try JSONDecoder().decode([GarageVehicle].self, from: Data(GarageCardFixtures.garage(now: now).utf8))
    }

    private func timelines() throws -> [String: GarageTimeline] {
        try GarageTimelineReader.decode(Data(GarageCardFixtures.timelines(now: now).utf8))
    }

    // MARK: Batch reader

    func testBatchReaderDecodesTheLiveRowShape() throws {
        let map = try timelines()
        XCTAssertEqual(map.count, 4)
        let owned = try XCTUnwrap(map[GarageCardFixtures.owned])
        XCTAssertEqual(owned.first_day, "2021-03-14")
        XCTAssertEqual(owned.last_day, "2026-11-18")
        XCTAssertEqual(owned.work_days, 7)
        XCTAssertEqual(owned.days.first, GarageTimelineDay(day: "2021-03-14", photos: 6, work: 0, events: 0, documents: 0))
        XCTAssertEqual(owned.days.count, 15)
        XCTAssertNil(map[GarageCardFixtures.undated], "a car with no dated activity has no row")
    }

    func testBatchReaderDropsAMalformedRowAndKeepsTheRest() throws {
        let json = """
        [{"vehicle_id":"A","first_day":"not a day","last_day":"2026-01-01","days":[]},
         {"vehicle_id":"B","first_day":"2026-01-01","last_day":"2026-01-02","active_days":2,"photos":3,"work_days":0,
          "events":0,"documents":0,"days":[["2026-01-01", 1, 0, 0, 0], "junk", ["bad", 1, 1, 1, 1], ["2026-01-02", 2.0, 0, 0, 0]]}]
        """
        let map = try GarageTimelineReader.decode(Data(json.utf8))
        XCTAssertEqual(Array(map.keys), ["b"])
        XCTAssertEqual(map["b"]?.days.map(\.day), ["2026-01-01", "2026-01-02"])
        XCTAssertEqual(map["b"]?.days.last?.photos, 2)
        XCTAssertThrowsError(try GarageTimelineReader.decode(Data("{}".utf8)), "a non-array answer is a failed read")
    }

    // MARK: Order and year headings

    func testNewestActivityFirstUndatedLastUnderYearHeadings() throws {
        let groups = GarageOrder.grouped(try garage(), timelines: try timelines())
        XCTAssertEqual(groups.map(\.label), ["2026", "2024", "2023", "No dated activity"])
        XCTAssertEqual(groups.map { $0.vehicles.map(\.vehicle_id) }, [
            [GarageCardFixtures.owned, GarageCardFixtures.contributed],
            [GarageCardFixtures.older],
            [GarageCardFixtures.previous],   // dated by its timeline: last_activity_at is null
            [GarageCardFixtures.undated],
        ])
    }

    func testTheServersActivityClockLeadsTheTimeline() throws {
        var v = try garage()[0]
        v.last_activity_at = "2025-02-03T23:59:00+00:00"
        let t = GarageTimeline(vehicle_id: v.vehicle_id, first_day: "2020-01-01", last_day: "2026-01-01", days: [])
        XCTAssertEqual(GarageOrder.lastDay(v, timeline: t), "2025-02-03")
        v.last_activity_at = "garbage"
        XCTAssertEqual(GarageOrder.lastDay(v, timeline: t), "2026-01-01")
        v.last_activity_at = nil
        XCTAssertNil(GarageOrder.lastDay(v, timeline: nil))
    }

    func testEqualDaysKeepTheServersOrder() throws {
        let base = try garage()
        var a = base[0], b = base[1], c = base[2]
        a.last_activity_at = "2026-01-01T00:00:00Z"; b.last_activity_at = "2026-01-01T09:00:00Z"; c.last_activity_at = "2026-01-01T03:00:00Z"
        XCTAssertEqual(GarageOrder.ordered([a, b, c], timelines: [:]).map(\.vehicle_id), [a, b, c].map(\.vehicle_id))
    }

    func testActivityClockSurvivesTheOfflineCache() throws {
        let v = try garage().first { $0.vehicle_id == GarageCardFixtures.owned }!
        let round = try JSONDecoder().decode(GarageVehicle.self, from: JSONEncoder().encode(v))
        XCTAssertEqual(round.last_activity_at, "2026-11-18T15:00:00+00:00")
        let old = #"{"vehicle_id":"x","year":null,"make":null,"model":null,"trim_name":null,"image_url":null,"current_value":null,"image_count":0,"relationship":"owner"}"#
        XCTAssertNil(try JSONDecoder().decode(GarageVehicle.self, from: Data(old.utf8)).last_activity_at, "rows cached by older builds still decode")
    }

    // MARK: Day grid axis

    func testAxisIsFiftyThreeMondayWeeksEndingToday() {
        let axis = GarageAxis.make([], now: now)
        XCTAssertEqual(GarageAxis.weekday(axis.end), 4, "2026-11-20 is a Friday")
        XCTAssertEqual(GarageAxis.weekday(axis.start), 0, "the window opens on a Monday")
        XCTAssertEqual(axis.dayCount, 52 * 7 + 5)
        XCTAssertEqual(axis.cell(axis.end)?.column, 52)
        XCTAssertEqual(axis.cell(axis.end)?.row, 4)
        XCTAssertEqual(axis.cell(BuildBarcode.epochDay("2025-11-17")!)?.column, 0, "Monday 2025-11-17 opens the window")
        XCTAssertNil(axis.cell(axis.end + 1), "tomorrow is not drawn")
        XCTAssertNil(axis.cell(axis.start - 1))
        XCTAssertEqual(axis.steps, [1, 1, 1], "an empty garage steps at 1, as the web does")
        XCTAssertEqual(axis.heat(1), 3)
        XCTAssertEqual(axis.heat(2), 6)
    }

    func testAxisStepsAtTheGaragesQuartilesInsideTheWindow() {
        let days = (1...8).map { GarageTimelineDay(day: GarageCardFixtures.day($0, now: now), photos: $0, work: 0, events: 0, documents: 0) }
        let outside = [GarageTimelineDay(day: "2020-01-01", photos: 999, work: 0, events: 0, documents: 0),
                       GarageTimelineDay(day: GarageCardFixtures.day(3, now: now), photos: 0, work: 0, events: 0, documents: 0)]
        let axis = GarageAxis.make([
            GarageTimeline(vehicle_id: "a", first_day: "2020-01-01", last_day: "2026-11-19", days: Array(days.prefix(4)) + outside),
            GarageTimeline(vehicle_id: "b", first_day: "2026-11-01", last_day: "2026-11-15", days: Array(days.dropFirst(4))),
        ], now: now)
        // Totals 1…8: floor(q·8) picks indexes 2, 4 and 6.
        XCTAssertEqual(axis.steps, [3, 5, 7])
        XCTAssertEqual([1, 3, 4, 5, 6, 7, 8].map(axis.heat), [3, 3, 4, 4, 5, 5, 6])
    }

    // MARK: Words

    func testActiveAgoUsesTheWebsThresholds() {
        func ago(_ d: Int) -> String? { GarageCardText.activeAgo(GarageCardFixtures.day(d, now: now), now: now) }
        XCTAssertEqual(ago(0), "Active today")
        XCTAssertEqual(ago(19), "Active 19d ago")
        XCTAssertEqual(ago(59), "Active 59d ago")
        XCTAssertEqual(ago(60), "Active 2mo ago")
        XCTAssertEqual(ago(729), "Active 24mo ago")
        XCTAssertEqual(ago(730), "Active 2y ago")
        XCTAssertNil(GarageCardText.activeAgo(nil, now: now))
        XCTAssertNil(GarageCardText.activeAgo("soon", now: now))
    }

    func testLaneDropsFromTheEndLongestFirst() {
        let items = GarageCardText.laneItems(relationship: "Owned", active: "Active 2d ago", facets: ["455 V8", "", "RWD"])
        XCTAssertEqual(items, ["Owned", "Active 2d ago", "455 V8", "RWD"])
        XCTAssertEqual(GarageCardText.lanePrefixes(items).map(\.count), [4, 3, 2, 1])
        XCTAssertEqual(GarageCardText.lanePrefixes(items).last, ["Owned"])
        XCTAssertEqual(GarageCardText.laneItems(relationship: "Contributed", active: nil, facets: []), ["Contributed"])
    }

    func testRecordLineStatesSpanAndOnlyNonZeroCounts() throws {
        let map = try timelines()
        XCTAssertEqual(GarageCardText.span(map[GarageCardFixtures.owned]), "Mar 2021 – Nov 2026")
        XCTAssertEqual(GarageCardText.counts(map[GarageCardFixtures.owned], imageCount: 240),
                       ["240 photos", "7 work days", "4 events", "3 papers"])
        XCTAssertEqual(GarageCardText.span(map[GarageCardFixtures.older]), "May 2024")
        XCTAssertEqual(GarageCardText.counts(map[GarageCardFixtures.older], imageCount: 0), ["12 photos"])
        XCTAssertEqual(GarageCardText.counts(nil, imageCount: 1), ["1 photo"])
        XCTAssertEqual(GarageCardText.counts(nil, imageCount: 0), [])
    }

    // MARK: Header and reel

    func testHeaderTakesTheMastheadClaimAndDropsBodyStyle() throws {
        let read = try JSONDecoder().decode(ProfileRead.self, from: Data(GarageCardFixtures.profileRead(GarageCardFixtures.owned).utf8))
        let header = GarageCardHeader(read)
        XCTAssertEqual(header.price?.value.number, 41500)
        XCTAssertEqual(header.priceLabel, "Last recorded sale")
        XCTAssertEqual(header.facets, ["455 V8", "4-speed Manual", "RWD", "Las Vegas, NV"])
        let other = try JSONDecoder().decode(ProfileRead.self, from: Data(GarageCardFixtures.profileRead(GarageCardFixtures.contributed).utf8))
        XCTAssertNil(GarageCardHeader(other).price, "no masthead price means no price, never current_value")
    }

    func testReelLeadsWithTheCoverOnceAndCarriesItsDay() {
        let reel = [GarageReelPhoto(image_url: "b", taken_at: "2026-11-01T10:00:00Z", is_sensitive: nil),
                    GarageReelPhoto(image_url: "a", taken_at: "2026-10-01T10:00:00Z", is_sensitive: false),
                    GarageReelPhoto(image_url: "b", taken_at: nil, is_sensitive: nil),
                    GarageReelPhoto(image_url: "s", taken_at: nil, is_sensitive: true)]
        let pages = GarageCardReads.pages(cover: "a", reel: reel)
        XCTAssertEqual(pages.map(\.url), ["a", "b"])
        XCTAssertEqual(pages.map(\.day), ["2026-10-01", "2026-11-01"])
        XCTAssertEqual(GarageCardReads.pages(cover: nil, reel: []).count, 0)
        XCTAssertEqual(GarageCardReads.pages(cover: "c", reel: []).map(\.url), ["c"])
    }

    // MARK: Log book

    func testLogBookDecodesStatementsAndANullAnswer() throws {
        let book = try GarageStatements.decode(Data(GarageCardFixtures.statements.utf8))
        XCTAssertEqual(book.statements.count, 1)
        XCTAssertEqual(book.statements[0].line, "2026-11-18 · owner · recollection")
        XCTAssertEqual(try GarageStatements.decode(Data("null".utf8)).statements.count, 0)
        let v = try garage()
        XCTAssertEqual(GarageLogBookView.defaultRole(v.first { $0.relationship == "owner" }!), "owner")
        XCTAssertEqual(GarageLogBookView.defaultRole(v.first { $0.relationship == "previously_owned" }!), "previous_owner")
        XCTAssertEqual(GarageLogBookView.defaultRole(v.first { $0.relationship == "contributor" }!), "representative")
    }
}
