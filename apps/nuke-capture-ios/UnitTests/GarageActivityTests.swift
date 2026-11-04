// GarageActivityTests.swift — the garage activity feed's grouping, ordering and wording.
//
// Pure parts only: events are built from reader-shaped rows and grouped against a fixed clock in a
// fixed calendar, so nothing here depends on the day the tests run. The rule under test: the feed
// is placed by the event clock (taken_at, event_date, posted_at, the source's observed time),
// never the upload clock, and an event that cannot be placed or worded is left out, not invented.

import XCTest
@testable import NukeCapture

final class GarageActivityTests: XCTestCase {
    private var calendar: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "UTC")!
        return c
    }()
    /// Tuesday 2026-11-03 21:40 UTC.
    private let now = Date(timeIntervalSince1970: 1_793_742_000)
    private let mustang = "00000000-0000-4000-8000-0000000000a1"
    private let coupe = "00000000-0000-4000-8000-0000000000a2"
    private let wagon = "00000000-0000-4000-8000-0000000000a3"

    private func iso(hoursAgo h: Double) -> String {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime]
        return f.string(from: now.addingTimeInterval(-h * 3600))
    }

    private func vehicle(_ id: String, _ model: String, cover: String? = nil) -> GarageVehicle {
        GarageVehicle(vehicle_id: id, year: 1967, make: "Ford", model: model, trim_name: nil, image_url: cover,
                      current_value: nil, image_count: 0, relationship: "owner")
    }

    private var vehicles: GarageActivityVehicles {
        GarageActivityVehicles([vehicle(mustang, "Mustang", cover: "https://img.example/mustang.jpg"),
                                vehicle(coupe, "Coupe"), vehicle(wagon, "Wagon")])
    }

    private func event(_ id: String, vehicle: String, hoursAgo h: Double, kind: GarageActivityEvent.Kind = .timeline) -> GarageActivityEvent {
        GarageActivityEvent(id: id, vehicleId: vehicle, kind: kind, at: now.addingTimeInterval(-h * 3600), headline: id,
                            vehicleTitle: nil, detail: nil, imageURL: nil)
    }

    // MARK: Photos

    func testPhotosAreGroupedPerVehicleDayAndPlacedByTakenAtNotUpload() {
        let rows = [
            GarageActivityPhotoRow(id: "p1", vehicle_id: mustang, image_url: "https://img.example/1.jpg", thumbnail_url: nil,
                                   taken_at: iso(hoursAgo: 3), source: "capture_relay_ios", photo_imported_at: nil),
            GarageActivityPhotoRow(id: "p2", vehicle_id: mustang, image_url: "https://img.example/2.jpg", thumbnail_url: nil,
                                   taken_at: iso(hoursAgo: 2), source: "capture_relay_ios", photo_imported_at: nil),
            GarageActivityPhotoRow(id: "p3", vehicle_id: mustang, image_url: "https://img.example/3.jpg", thumbnail_url: nil,
                                   taken_at: iso(hoursAgo: 1), source: nil, photo_imported_at: nil),
            // Taken three days ago (uploaded today by a backlog): its own day, not today.
            GarageActivityPhotoRow(id: "p4", vehicle_id: mustang, image_url: "https://img.example/4.jpg", thumbnail_url: nil,
                                   taken_at: iso(hoursAgo: 72), source: nil, photo_imported_at: nil),
        ]
        let events = GarageActivityBuild.photoEvents(rows, vehicles: vehicles, now: now, calendar: calendar)
            .sorted { $0.at > $1.at }
        XCTAssertEqual(events.count, 2)
        XCTAssertEqual(events[0].headline, "3 new photos on 1967 Ford Mustang")
        XCTAssertEqual(events[0].at, now.addingTimeInterval(-3600), "the group sits at its newest taken_at")
        XCTAssertEqual(events[0].imageURL, "https://img.example/3.jpg")
        XCTAssertEqual(events[1].headline, "1 new photo on 1967 Ford Mustang")
        XCTAssertEqual(GarageActivityFeed.group(events, now: now, calendar: calendar).today.count, 1)
    }

    func testPhotoWithoutTakenAtOrFromAnImportOrInTheFutureIsNotPlaced() {
        let rows = [
            GarageActivityPhotoRow(id: "undated", vehicle_id: mustang, image_url: "u", thumbnail_url: nil,
                                   taken_at: nil, source: nil, photo_imported_at: nil),
            GarageActivityPhotoRow(id: "import", vehicle_id: mustang, image_url: "u", thumbnail_url: nil,
                                   taken_at: iso(hoursAgo: 1), source: "bat_import", photo_imported_at: nil),
            GarageActivityPhotoRow(id: "stamped", vehicle_id: mustang, image_url: "u", thumbnail_url: nil,
                                   taken_at: iso(hoursAgo: 1), source: nil, photo_imported_at: iso(hoursAgo: 1)),
            GarageActivityPhotoRow(id: "future", vehicle_id: mustang, image_url: "u", thumbnail_url: nil,
                                   taken_at: iso(hoursAgo: -30), source: nil, photo_imported_at: nil),
            GarageActivityPhotoRow(id: "novehicle", vehicle_id: nil, image_url: "u", thumbnail_url: nil,
                                   taken_at: iso(hoursAgo: 1), source: nil, photo_imported_at: nil),
        ]
        XCTAssertTrue(GarageActivityBuild.photoEvents(rows, vehicles: vehicles, now: now, calendar: calendar).isEmpty)
    }

    func testAnUnnamedVehicleIsHiddenNotInvented() {
        let none = GarageActivityVehicles([vehicle(wagon, "")]).titles
        XCTAssertEqual(none[wagon], "1967 Ford", "the parts that exist are the name")
        XCTAssertEqual(GarageActivityFeed.photosHeadline(count: 2, vehicleTitle: nil), "2 new photos")
        XCTAssertEqual(GarageActivityFeed.photosHeadline(count: 1, vehicleTitle: "  "), "1 new photo")
    }

    func testAPhotoGroupFallsBackToTheVehicleCoverOnlyWhenItHasNoImage() {
        let row = GarageActivityPhotoRow(id: "p", vehicle_id: mustang, image_url: nil, thumbnail_url: nil,
                                         taken_at: iso(hoursAgo: 1), source: nil, photo_imported_at: nil)
        let events = GarageActivityBuild.photoEvents([row], vehicles: vehicles, now: now, calendar: calendar)
        XCTAssertEqual(events.first?.imageURL, "https://img.example/mustang.jpg")
    }

    // MARK: Comments, timeline, listings

    func testCommentsGroupPerVehicleDay() {
        let rows = [GarageActivityCommentRow(id: "c1", vehicle_id: coupe, posted_at: iso(hoursAgo: 5)),
                    GarageActivityCommentRow(id: "c2", vehicle_id: coupe, posted_at: iso(hoursAgo: 4)),
                    GarageActivityCommentRow(id: "c3", vehicle_id: coupe, posted_at: nil)]
        let events = GarageActivityBuild.commentEvents(rows, vehicles: vehicles, now: now, calendar: calendar)
        XCTAssertEqual(events.map(\.headline), ["2 new comments on 1967 Ford Coupe"])
        XCTAssertEqual(events.first?.at, now.addingTimeInterval(-4 * 3600))
    }

    func testTimelineSkipsPhotoTypesUntitledRowsAndUndatedRows() {
        let rows = [
            GarageActivityTimelineRow(id: "t1", vehicle_id: mustang, event_type: "work_completed", event_date: iso(hoursAgo: 2), title: "Brakes done"),
            GarageActivityTimelineRow(id: "t2", vehicle_id: mustang, event_type: "photo_session", event_date: iso(hoursAgo: 2), title: "Photo session"),
            GarageActivityTimelineRow(id: "t3", vehicle_id: mustang, event_type: "image_upload", event_date: iso(hoursAgo: 2), title: "Uploaded"),
            GarageActivityTimelineRow(id: "t4", vehicle_id: mustang, event_type: "maintenance", event_date: iso(hoursAgo: 2), title: "  "),
            GarageActivityTimelineRow(id: "t5", vehicle_id: mustang, event_type: "maintenance", event_date: nil, title: "No clock"),
            GarageActivityTimelineRow(id: "t6", vehicle_id: mustang, event_type: "auction_sold", event_date: iso(hoursAgo: 6), title: "Sold at auction"),
        ]
        let events = GarageActivityBuild.timelineEvents(rows, vehicles: vehicles, now: now)
        XCTAssertEqual(events.map(\.headline).sorted(), ["Brakes done", "Sold at auction"])
        XCTAssertEqual(events.first { $0.headline == "Sold at auction" }?.kind, .listing)
        XCTAssertEqual(events.first { $0.headline == "Brakes done" }?.kind, .timeline)
    }

    func testListingEventsAreChangesBetweenObservationsNeverTheFirstSighting() {
        func row(_ id: String, hoursAgo: Double, price: Double?, status: String? = "active") -> GarageActivityListingRow {
            GarageActivityListingRow(id: id, vehicle_id: mustang, source_platform: "bat", source_listing_id: "L1",
                                     current_price: price, event_status: status, source_observed_at: iso(hoursAgo: hoursAgo))
        }
        let rows = [
            row("o1", hoursAgo: 48, price: 30_000),          // first sighting: not an event
            row("o2", hoursAgo: 24, price: 30_000),          // unchanged: not an event
            row("o3", hoursAgo: 2, price: 28_500),           // price change
            row("o4", hoursAgo: 1, price: nil, status: "sold"),   // status change, no price stated
        ]
        let events = GarageActivityBuild.listingEvents(rows, vehicles: vehicles, now: now).sorted { $0.at < $1.at }
        XCTAssertEqual(events.map(\.headline), ["Price changed from $30,000 to $28,500", "Listing marked sold"])
        XCTAssertTrue(events.allSatisfy { $0.kind == .listing })
    }

    func testListingRowWithoutAnObservedClockIsLeftOut() {
        let rows = [
            GarageActivityListingRow(id: "a", vehicle_id: mustang, source_platform: "bat", source_listing_id: "L1",
                                     current_price: 1000, event_status: "active", source_observed_at: nil),
            GarageActivityListingRow(id: "b", vehicle_id: mustang, source_platform: "bat", source_listing_id: "L1",
                                     current_price: 2000, event_status: "active", source_observed_at: nil),
        ]
        XCTAssertTrue(GarageActivityBuild.listingEvents(rows, vehicles: vehicles, now: now).isEmpty)
    }

    // MARK: Grouping

    func testGroupsTodayYesterdayAndThisWeekAndDropsTheRest() {
        // now is 21:40, so 2h ago is today and 22h ago is yesterday.
        let events = [
            event("today-a", vehicle: mustang, hoursAgo: 2),
            event("today-b", vehicle: coupe, hoursAgo: 5),
            event("yesterday", vehicle: mustang, hoursAgo: 22),
            event("week", vehicle: wagon, hoursAgo: 24 * 4),
            event("old", vehicle: wagon, hoursAgo: 24 * 8),
        ]
        let g = GarageActivityFeed.group(events, now: now, calendar: calendar)
        XCTAssertEqual(g.today.map(\.id), ["today-a", "today-b"], "newest first")
        XCTAssertEqual(g.yesterday.map(\.id), ["yesterday"])
        XCTAssertEqual(g.thisWeek.map(\.id), ["week"])
        XCTAssertNil(g.latestWhenQuiet, "there is news today")
    }

    func testMidnightBoundariesFollowTheCalendarDay() {
        let startOfToday = calendar.startOfDay(for: now)
        let atMidnight = GarageActivityEvent(id: "m", vehicleId: mustang, kind: .timeline, at: startOfToday, headline: "m",
                                             vehicleTitle: nil, detail: nil, imageURL: nil)
        let justBefore = GarageActivityEvent(id: "j", vehicleId: mustang, kind: .timeline, at: startOfToday.addingTimeInterval(-1),
                                             headline: "j", vehicleTitle: nil, detail: nil, imageURL: nil)
        let g = GarageActivityFeed.group([atMidnight, justBefore], now: now, calendar: calendar)
        XCTAssertEqual(g.today.map(\.id), ["m"])
        XCTAssertEqual(g.yesterday.map(\.id), ["j"])
    }

    func testAQuietDayCarriesTheLatestItemOnceAndKeepsTheOtherGroups() {
        let events = [event("y1", vehicle: mustang, hoursAgo: 22), event("y2", vehicle: coupe, hoursAgo: 30),
                      event("week", vehicle: wagon, hoursAgo: 24 * 4)]
        let g = GarageActivityFeed.group(events, now: now, calendar: calendar)
        XCTAssertTrue(g.isQuietToday)
        XCTAssertEqual(g.latestWhenQuiet?.id, "y1")
        XCTAssertEqual(g.yesterday.map(\.id), ["y2"], "the latest item is not repeated below")
        XCTAssertEqual(g.thisWeek.map(\.id), ["week"])
    }

    func testAQuietWeekStillOffersTheLatestOlderItem() {
        let g = GarageActivityFeed.group([event("old", vehicle: mustang, hoursAgo: 24 * 12)], now: now, calendar: calendar)
        XCTAssertTrue(g.isQuietToday)
        XCTAssertEqual(g.latestWhenQuiet?.id, "old")
        XCTAssertTrue(g.yesterday.isEmpty && g.thisWeek.isEmpty)
    }

    func testNoEventsIsEmptyNotInvented() {
        let g = GarageActivityFeed.group([], now: now, calendar: calendar)
        XCTAssertTrue(g.isQuietToday)
        XCTAssertNil(g.latestWhenQuiet)
        XCTAssertTrue(g.isEmpty)
    }

    func testFutureClocksAndDuplicateIdsAreDropped() {
        let events = [event("future", vehicle: mustang, hoursAgo: -3), event("dup", vehicle: mustang, hoursAgo: 2),
                      event("dup", vehicle: mustang, hoursAgo: 2)]
        XCTAssertEqual(GarageActivityFeed.ordered(events, now: now).map(\.id), ["dup"])
    }

    func testEqualClocksOrderByIdSoTheListIsStable() {
        let events = [event("a", vehicle: mustang, hoursAgo: 1), event("b", vehicle: coupe, hoursAgo: 1)]
        XCTAssertEqual(GarageActivityFeed.ordered(events, now: now).map(\.id), ["b", "a"])
        XCTAssertEqual(GarageActivityFeed.ordered(events.reversed(), now: now).map(\.id), ["b", "a"])
    }

    // MARK: Vehicle order and the card line

    func testVehiclesSortByMostRecentActivityWithUnknownLastInServerOrder() {
        let list = [vehicle(wagon, "Wagon"), vehicle(mustang, "Mustang"), vehicle("00000000-0000-4000-8000-0000000000a4", "Quiet"),
                    vehicle(coupe, "Coupe"), vehicle("00000000-0000-4000-8000-0000000000a5", "Silent")]
        let events = [event("m", vehicle: mustang.uppercased(), hoursAgo: 1), event("c", vehicle: coupe, hoursAgo: 30),
                      event("m-old", vehicle: mustang, hoursAgo: 90)]
        let sorted = GarageActivityFeed.byRecentActivity(list, latest: GarageActivityFeed.latestByVehicle(events))
        XCTAssertEqual(sorted.map { $0.model ?? "" }, ["Mustang", "Coupe", "Wagon", "Quiet", "Silent"])
    }

    func testWithNoActivityTheServerOrderIsKept() {
        let list = [vehicle(wagon, "Wagon"), vehicle(mustang, "Mustang")]
        XCTAssertEqual(GarageActivityFeed.byRecentActivity(list, latest: [:]).map(\.vehicle_id), [wagon, mustang])
    }

    func testTiedVehiclesKeepTheirServerOrder() {
        let list = [vehicle(coupe, "Coupe"), vehicle(mustang, "Mustang")]
        let at = now.addingTimeInterval(-3600)
        let sorted = GarageActivityFeed.byRecentActivity(list, latest: [coupe: at, mustang: at])
        XCTAssertEqual(sorted.map(\.vehicle_id), [coupe, mustang])
    }

    func testLastActivityWording() {
        func text(_ seconds: TimeInterval) -> String? { GarageActivityFeed.lastActivity(now.addingTimeInterval(-seconds), now: now) }
        XCTAssertEqual(text(20), "Last activity just now")
        XCTAssertEqual(text(-30), "Last activity just now", "a slightly early clock is not negative time")
        XCTAssertEqual(text(5 * 60), "Last activity 5m ago")
        XCTAssertEqual(text(2 * 3600 + 120), "Last activity 2h ago")
        XCTAssertEqual(text(26 * 3600), "Last activity 1d ago")
        XCTAssertEqual(text(6 * 86_400), "Last activity 6d ago")
        XCTAssertTrue(text(40 * 86_400)?.hasPrefix("Last activity ") == true)
        XCTAssertNil(GarageActivityFeed.lastActivity(nil, now: now), "no activity on record shows no line")
    }

    func testUnavailableSourcesAreListedInPlainWords() {
        XCTAssertEqual(GarageActivityFeed.listed([]), "")
        XCTAssertEqual(GarageActivityFeed.listed(["comments"]), "comments")
        XCTAssertEqual(GarageActivityFeed.listed(["comments", "jobs"]), "comments and jobs")
        XCTAssertEqual(GarageActivityFeed.listed(["photos", "comments", "jobs"]), "photos, comments, and jobs")
    }

    func testReaderRowsDecodeFromTheirLiveShapes() throws {
        let photos = #"[{"id":"i1","vehicle_id":"v1","image_url":"https://x/y.jpg","thumbnail_url":null,"taken_at":"2026-11-03T20:00:00+00:00","source":"capture_relay_ios","photo_imported_at":null,"extra":1}]"#
        let rows = try JSONDecoder().decode([GarageActivityPhotoRow].self, from: Data(photos.utf8))
        XCTAssertEqual(rows.first?.taken_at, "2026-11-03T20:00:00+00:00")
        XCTAssertEqual(rows.first?.isImported, false)
        let listing = #"[{"id":"e1","vehicle_id":"v1","source_platform":"bat","source_listing_id":null,"current_price":12500.5,"event_status":null,"source_observed_at":"2026-11-03T19:00:00Z"}]"#
        XCTAssertEqual(try JSONDecoder().decode([GarageActivityListingRow].self, from: Data(listing.utf8)).first?.current_price, 12500.5)
    }
}
