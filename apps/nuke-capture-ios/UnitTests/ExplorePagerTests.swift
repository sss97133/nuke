// ExplorePagerTests.swift — the pure rules behind Explore's swipe pager: which pages a card has, what the
// buyer's reading may say, how more / less / hide reorder the feed, and the local signal log.

import XCTest
@testable import NukeCapture

final class ExplorePagerTests: XCTestCase {
    private func item(_ id: String = "ask:1", kind: ExploreFeedItem.Kind = .classified, amount: Double? = 25_000,
                      make: String? = "Chevrolet", model: String? = "Corvette", link: URL? = URL(string: "https://example.com/l"),
                      listedAt: Date? = nil, endsAt: Date? = nil, lat: Double? = nil, lng: Double? = nil,
                      miles: Double? = nil, position: AskPosition? = nil, postedAt: Date? = nil) -> ExploreFeedItem {
        var out = ExploreFeedItem(id: id, kind: kind, title: id, image: "https://x/y.jpg", amount: amount,
                                  amountLabel: kind == .live ? "Current bid" : "Asking", endsAt: endsAt, source: "Craigslist",
                                  location: "Charlotte, NC", facts: nil, seen: nil, vehicleId: nil,
                                  year: 1968, make: make, model: model, link: link)
        out.listedAt = listedAt
        out.lat = lat; out.lng = lng
        out.miles = miles
        out.position = position
        out.postedAt = postedAt
        out.postedWord = postedAt == nil ? nil : "posted"
        return out
    }

    private func position(sales: Int = 12, basis: String? = "sold", thin: Bool = false, soldMilesN: Int = 9) -> AskPosition {
        var basisPart = ""
        if let basis { basisPart = "\"basis\":\"" + basis + "\"," }
        let json = """
        {"family":"C3 Corvette","cohort":"1968-72","match":"decade","sales":\(sales),"p25":20000,"p50":30000,"p75":40000,
         "rank":"within",\(basisPart)
         "sold":{"n":\(sales),"thin":\(thin),"p25":20000,"p50":30000,"p75":40000,"miles":{"n":\(soldMilesN),"p50":80000}}}
        """
        return try! JSONDecoder().decode(AskPosition.self, from: Data(json.utf8))
    }

    // MARK: Pages

    func testClassifiedWithCoordinatesAndLinkHasEveryPage() {
        let i = item(lat: 35.23, lng: -80.84)
        XCTAssertEqual(ExplorePagePlan.kinds(for: i), [.photos, .location, .analytics, .listing])
    }

    func testClassifiedWithoutCoordinatesOrLinkSkipsThosePages() {
        XCTAssertEqual(ExplorePagePlan.kinds(for: item(link: nil)), [.photos, .analytics])
    }

    func testPlaceholderAndOutOfRangeCoordinatesGiveNoMapPage() {
        XCTAssertFalse(ExplorePagePlan.hasCoordinates(item(lat: 0, lng: 0)))
        XCTAssertFalse(ExplorePagePlan.hasCoordinates(item(lat: 91, lng: 10)))
        XCTAssertFalse(ExplorePagePlan.hasCoordinates(item(lat: 35.2, lng: nil)))
        XCTAssertFalse(ExplorePagePlan.hasCoordinates(item(lat: .nan, lng: 10)))
        XCTAssertTrue(ExplorePagePlan.hasCoordinates(item(lat: 35.23, lng: -80.84)))
    }

    func testLiveLotHasAnAnalyticsPageOnlyWhenItHasSomethingNew() {
        let soon = Date().addingTimeInterval(3600)
        XCTAssertEqual(ExplorePagePlan.kinds(for: item(kind: .live, link: nil, endsAt: soon)), [.photos])
        let listed = Date().addingTimeInterval(-6 * 86_400)
        XCTAssertEqual(ExplorePagePlan.kinds(for: item(kind: .live, listedAt: listed, endsAt: soon)),
                       [.photos, .analytics, .listing])
    }

    // MARK: Buyer's reading

    func testEnoughSalesPlacesTheAskAndAddsMileage() {
        let now = Date()
        let r = ExploreAnalytics.reading(for: item(amount: 20_000, miles: 60_000, position: position(),
                                                   postedAt: now.addingTimeInterval(-3 * 3600)), now: now)
        XCTAssertNotNil(r.placement)
        XCTAssertNil(r.placementNote)
        XCTAssertEqual(r.age, "posted 3h ago")
        XCTAssertTrue(r.mileage?.contains("25% below") == true, r.mileage ?? "nil")
    }

    func testThinOrShortCohortSaysSoAndShowsNoNumber() {
        for pos in [position(thin: true), position(sales: 4), position(basis: "asked"), nil] {
            let r = ExploreAnalytics.reading(for: item(miles: 60_000, position: pos), now: Date())
            XCTAssertNil(r.placement)
            XCTAssertEqual(r.placementNote, ExploreAnalytics.notEnoughSales)
            XCTAssertNil(r.mileage, "no cohort mileage without a cohort that can be shown")
        }
    }

    func testMileageNeedsEnoughSoldMilesAndNamesNearMedian() {
        XCTAssertNil(ExploreAnalytics.mileage(miles: 60_000, cohort: position(soldMilesN: 3)))
        XCTAssertTrue(ExploreAnalytics.mileage(miles: 80_500, cohort: position())?.contains("near the sold median") == true)
        XCTAssertTrue(ExploreAnalytics.mileage(miles: 100_000, cohort: position())?.contains("25% above") == true)
        XCTAssertNil(ExploreAnalytics.mileage(miles: nil, cohort: position()))
    }

    func testAskWithoutAPriceIsNotPlaced() {
        let r = ExploreAnalytics.reading(for: item(amount: nil, position: position()), now: Date())
        XCTAssertNil(r.placement)
        XCTAssertNotNil(r.placementNote)
    }

    func testAgoPhrases() {
        let now = Date()
        XCTAssertEqual(ExploreAnalytics.ago(now.addingTimeInterval(-20), now: now), "just now")
        XCTAssertEqual(ExploreAnalytics.ago(now.addingTimeInterval(120), now: now), "just now")
        XCTAssertEqual(ExploreAnalytics.ago(now.addingTimeInterval(-12 * 60), now: now), "12m ago")
        XCTAssertEqual(ExploreAnalytics.ago(now.addingTimeInterval(-5 * 3600), now: now), "5h ago")
        XCTAssertEqual(ExploreAnalytics.ago(now.addingTimeInterval(-3 * 86_400), now: now), "3d ago")
    }

    func testLiveLotReadingIsListedDateAndLengthOnly() {
        let now = Date()
        let listed = now.addingTimeInterval(-86_400)
        let r = ExploreAnalytics.reading(for: item(kind: .live, listedAt: listed, endsAt: listed.addingTimeInterval(7 * 86_400)), now: now)
        XCTAssertNotNil(r.listed)
        XCTAssertEqual(r.length, "7 days")
        XCTAssertNil(r.placement)
        XCTAssertNil(r.placementNote)
    }

    // MARK: Decoding

    func testAskRowCarriesRoundedCoordinatesToTheCard() throws {
        let json = #"{"event_id":"e1","source":"craigslist","seen_at":"2026-11-20T00:00:00Z","lat":35.23,"lng":-80.84,"city":"Charlotte","region":"NC"}"#
        let row = try JSONDecoder().decode(AskRow.self, from: Data(json.utf8))
        XCTAssertEqual(row.lat, 35.23)
        let card = ExploreFeedItem.from(row)
        XCTAssertEqual(card.lat, 35.23)
        XCTAssertEqual(card.lng, -80.84)
        let none = try JSONDecoder().decode(AskRow.self, from: Data(#"{"event_id":"e2","source":"craigslist","seen_at":"2026-11-20T00:00:00Z"}"#.utf8))
        XCTAssertNil(ExploreFeedItem.from(none).lat)
    }

    // MARK: More / less / hide

    private var feed: [ExploreFeedItem] {
        [item("a", make: "Chevrolet", model: "Corvette"), item("b", make: "Ford", model: "Mustang"),
         item("c", make: "Chevrolet", model: "Camaro"), item("d", make: "Chevrolet", model: "Corvette"),
         item("e", make: "Ford", model: "F-100")]
    }

    func testKeyNormalises() {
        XCTAssertEqual(ExplorePreferences.key(make: " Chevrolet ", model: "CORVETTE"), "chevrolet|corvette")
        XCTAssertEqual(ExplorePreferences.key(make: "Ford", model: nil), "ford|")
        XCTAssertNil(ExplorePreferences.key(make: nil, model: "X"))
    }

    func testMoreMovesLaterCardsOfTheSameMakeAndModelRightAfterThisOne() {
        let out = ExplorePreferences.promote(feed, after: "b", key: "chevrolet|corvette")
        XCTAssertEqual(out.map(\.id), ["a", "b", "d", "c", "e"])
    }

    func testMoreWithoutAModelMatchesTheWholeMake() {
        let out = ExplorePreferences.promote(feed, after: "a", key: "ford|")
        XCTAssertEqual(out.map(\.id), ["a", "b", "e", "c", "d"])
    }

    func testLessRemovesThisCardAndLaterCardsOfThatMakeAndModelOnly() {
        let out = ExplorePreferences.demote(feed, removing: "a", key: "chevrolet|corvette")
        XCTAssertEqual(out.map(\.id), ["b", "c", "e"])
        let earlier = ExplorePreferences.demote(feed, removing: "d", key: "chevrolet|corvette")
        XCTAssertEqual(earlier.map(\.id), ["a", "b", "c", "e"], "an earlier, already-seen card stays")
    }

    func testHideRemovesOnlyThatCard() {
        XCTAssertEqual(ExplorePreferences.removing(feed, id: "c").map(\.id), ["a", "b", "d", "e"])
    }

    func testSavedPreferencesApplyOnTheNextLoad() {
        var p = ExplorePreferences()
        p.hide("b")
        p.avoid("ford|f-100")
        p.prefer("chevrolet|camaro")
        XCTAssertEqual(ExplorePreferences.apply(feed, p).map(\.id), ["c", "a", "d"])
        XCTAssertEqual(ExplorePreferences.apply(feed, ExplorePreferences()).map(\.id), ["a", "b", "c", "d", "e"])
    }

    func testTheLatestWordOnATasteWins() {
        var p = ExplorePreferences()
        p.prefer("ford|mustang")
        p.avoid("ford|mustang")
        XCTAssertEqual(p.less, ["ford|mustang"])
        XCTAssertTrue(p.more.isEmpty)
        p.prefer("ford|mustang")
        XCTAssertEqual(p.more, ["ford|mustang"])
        XCTAssertTrue(p.less.isEmpty)
    }

    func testHiddenListIsCappedKeepingTheNewest() {
        var p = ExplorePreferences()
        for i in 0..<(ExplorePreferences.hiddenCap + 10) { p.hide("id\(i)") }
        XCTAssertEqual(p.hidden.count, ExplorePreferences.hiddenCap)
        XCTAssertEqual(p.hidden.last, "id\(ExplorePreferences.hiddenCap + 9)")
    }

    func testPreferencesSurviveARoundTripThroughDefaults() throws {
        let defaults = try XCTUnwrap(UserDefaults(suiteName: "explore-pager-tests-\(UUID().uuidString)"))
        var p = ExplorePreferences()
        p.hide("x"); p.prefer("ford|"); p.avoid("chevrolet|camaro")
        p.save(defaults: defaults)
        XCTAssertEqual(ExplorePreferences.load(defaults: defaults), p)
        XCTAssertEqual(ExplorePreferences.load(defaults: UserDefaults(suiteName: "explore-pager-empty-\(UUID().uuidString)")!), ExplorePreferences())
    }

    // MARK: Photos

    func testPhotoListHasTheCoverFirstOnceEachAndIsCapped() {
        let reel = (0..<80).map { GarageReelPhoto(image_url: "https://x/\($0).jpg", taken_at: nil, is_sensitive: false) }
        let urls = ExplorePhotos.urls(cover: "https://x/5.jpg", reel: reel)
        XCTAssertEqual(urls.count, ExplorePhotos.cap)
        XCTAssertEqual(urls.first, "https://x/5.jpg")
        XCTAssertEqual(Set(urls).count, urls.count)
        let sensitive = [GarageReelPhoto(image_url: "https://x/s.jpg", taken_at: nil, is_sensitive: true)]
        XCTAssertEqual(ExplorePhotos.urls(cover: "https://x/c.jpg", reel: sensitive), ["https://x/c.jpg"])
    }

    func testCounterShowsOnlyOnceTheCountIsKnown() {
        XCTAssertNil(ExplorePhotos.counter(index: 0, total: 14, reelKnown: false))
        XCTAssertNil(ExplorePhotos.counter(index: 0, total: 1, reelKnown: true))
        XCTAssertEqual(ExplorePhotos.counter(index: 2, total: 14, reelKnown: true), "3 / 14")
    }

    // MARK: Signals

    func testEventEncodesWithWireNamesAndLeavesAbsentFieldsOut() throws {
        var e = ExploreSignalEvent.make(.openListing, item: item("ask:9"), position: 3)
        e.pageKind = "listing"
        let line = try XCTUnwrap(ExploreSignalLog.encode(e))
        XCTAssertFalse(line.contains("\n"))
        XCTAssertTrue(line.contains("\"kind\":\"open_listing\""), line)
        XCTAssertTrue(line.contains("\"item_id\":\"ask:9\""), line)
        XCTAssertTrue(line.contains("\"page_kind\":\"listing\""), line)
        XCTAssertTrue(line.contains("\"session_id\":\"\(ExploreSignalLog.sessionID)\""), line)
        XCTAssertFalse(line.contains("dwell_ms"))
        XCTAssertEqual(ExploreSignalLog.decode(line), e)
    }

    func testTrimKeepsTheNewest() {
        XCTAssertEqual(ExploreSignalLog.trimmed(Array(0..<10), keep: 3), [7, 8, 9])
        XCTAssertEqual(ExploreSignalLog.trimmed([1, 2], keep: 5), [1, 2])
        XCTAssertEqual(ExploreSignalLog.maxEvents, 5_000)
    }

    func testLogPersistsEventsAcrossInstances() async throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("explore-signals-\(UUID().uuidString).jsonl")
        defer { try? FileManager.default.removeItem(at: url) }
        let first = ExploreSignalLog(fileURL: url)
        await first.append(ExploreSignalEvent.make(.impression, item: item("ask:1"), position: 0))
        await first.append(ExploreSignalEvent.make(.dwell, item: item("ask:1"), position: 0))
        let second = ExploreSignalLog(fileURL: url)
        let events = await second.events()
        XCTAssertEqual(events.map(\.kind), [.impression, .dwell])
        let count = await second.count
        XCTAssertEqual(count, 2)
    }

    func testUploadIsOffByDefault() async {
        let defaults = UserDefaults(suiteName: "explore-signals-flag-\(UUID().uuidString)")!
        XCTAssertFalse(defaults.bool(forKey: ExploreSignalLog.uploadFlagKey))
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("explore-signals-\(UUID().uuidString).jsonl")
        defer { try? FileManager.default.removeItem(at: url) }
        let log = ExploreSignalLog(fileURL: url)
        await log.append(ExploreSignalEvent.make(.impression, item: item(), position: 0))
        await log.flushIfEnabled(defaults: defaults)   // flag off: returns without a request
        let count = await log.count
        XCTAssertEqual(count, 1)
    }
}
