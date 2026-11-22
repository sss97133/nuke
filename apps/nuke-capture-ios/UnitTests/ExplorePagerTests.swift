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
        let i = item(lat: 35.23, lng: -80.84, postedAt: Date().addingTimeInterval(-3600))
        XCTAssertEqual(ExplorePagePlan.kinds(for: i), [.photos, .location, .analytics, .listing])
    }

    func testClassifiedWithoutCoordinatesOrLinkSkipsThosePages() {
        XCTAssertEqual(ExplorePagePlan.kinds(for: item(link: nil, postedAt: Date().addingTimeInterval(-3600))), [.photos, .analytics])
    }

    func testClassifiedWithoutAListingClockHasNoAnalyticsPage() {
        // The cohort evidence is on the price rail and its stack, so a card with no listing clock has no page for it.
        XCTAssertEqual(ExplorePagePlan.kinds(for: item(link: nil, position: position())), [.photos])
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

    // MARK: Price rail

    private func estimate(low: Double = 14_000, est: Double = 18_000, high: Double = 22_000) -> FinishEstimate {
        FinishEstimate(vehicleId: "v1", estimate: est, low: low, high: high, grade: "B", coverage: 0.8, sentence: nil,
                       estimatedAt: Date(), bidAtEstimate: 12_000, compsThrough: "2026-11-01",
                       model: "33", factors: ["era: 1.02"])
    }

    func testFractionIsClampedToTheTrack() {
        XCTAssertEqual(ExplorePriceRail.fraction(-5, lo: 0, hi: 10), 0)
        XCTAssertEqual(ExplorePriceRail.fraction(15, lo: 0, hi: 10), 1)
        XCTAssertEqual(ExplorePriceRail.fraction(5, lo: 0, hi: 10), 0.5, accuracy: 1e-9)
        XCTAssertEqual(ExplorePriceRail.fraction(5, lo: 10, hi: 10), 0, "a track with no width never moves the marker")
        XCTAssertEqual(ExplorePriceRail.fraction(.nan, lo: 0, hi: 10), 0)
    }

    func testAskRailPlacesTheMarkerInsideTheCohortBracket() {
        let r = ExplorePriceRail.cohort(ask: 30_000, position: position())
        XCTAssertEqual(r.basis, .cohort)
        XCTAssertEqual(r.caption, ExplorePriceRail.cohortCaption)
        XCTAssertEqual(r.low, 20_000)
        XCTAssertEqual(r.high, 40_000)
        XCTAssertTrue(r.bandStart < r.marker && r.marker < r.bandEnd)
        XCTAssertTrue((0.0...1.0).contains(r.bandStart) && (0.0...1.0).contains(r.bandEnd) && (0.0...1.0).contains(r.marker))
    }

    func testAskFarOutsideTheBracketStaysOnTheTrack() {
        let below = ExplorePriceRail.cohort(ask: 1_000, position: position())
        let above = ExplorePriceRail.cohort(ask: 900_000, position: position())
        XCTAssertTrue(below.marker < below.bandStart)
        XCTAssertTrue(above.marker > above.bandEnd)
        XCTAssertTrue((0.0...1.0).contains(below.marker) && (0.0...1.0).contains(above.marker))
    }

    func testThinOrShortCohortGivesNoRangeAndNoOpinionYet() {
        for pos in [position(thin: true), position(sales: 4), position(basis: "asked"), nil] {
            let r = ExplorePriceRail.cohort(ask: 30_000, position: pos)
            XCTAssertEqual(r.basis, .none)
            XCTAssertFalse(r.hasBand)
            XCTAssertNil(r.low)
            XCTAssertEqual(r.caption, ExplorePriceRail.noOpinion)
        }
        XCTAssertNil(ExplorePriceRail.cohort(ask: nil, position: position()).caption)
    }

    func testAuctionBandShowsOnlyFromAFreshBoardWithABidInsideIt() {
        let ok = ExplorePriceRail.projected(bid: 15_000, estimate: estimate(), fresh: true)
        XCTAssertEqual(ok.basis, .projected)
        XCTAssertEqual(ok.caption, "Projected hammer")
        XCTAssertEqual(ok.low, 14_000)
        XCTAssertEqual(ok.high, 22_000)
        XCTAssertTrue(ok.bandStart < ok.marker && ok.marker < ok.bandEnd)
        XCTAssertFalse(ExplorePriceRail.projected(bid: 15_000, estimate: estimate(), fresh: false).hasBand, "stale board")
        XCTAssertFalse(ExplorePriceRail.projected(bid: 15_000, estimate: nil, fresh: true).hasBand, "no reading for this lot")
        XCTAssertFalse(ExplorePriceRail.projected(bid: 30_000, estimate: estimate(), fresh: true).hasBand, "bid above the band's top")
        XCTAssertFalse(ExplorePriceRail.projected(bid: 0, estimate: estimate(), fresh: true).hasBand)
        XCTAssertFalse(ExplorePriceRail.projected(bid: 15_000, estimate: estimate(low: 0), fresh: true).hasBand)
        XCTAssertNil(ExplorePriceRail.projected(bid: 15_000, estimate: nil, fresh: true).caption)
    }

    func testRailChoosesBySourceKind() {
        let ask = item(position: position())
        XCTAssertEqual(ExplorePriceRail.make(item: ask, estimate: estimate(), fresh: true).basis, .cohort)
        let lot = item("live:abc", kind: .live, amount: 15_000)
        XCTAssertEqual(ExplorePriceRail.make(item: lot, estimate: estimate(), fresh: true).basis, .projected)
        XCTAssertEqual(lot.lotId, "abc")
        XCTAssertNil(ask.lotId)
    }

    func testCompactMoney() {
        XCTAssertEqual(ExplorePriceRail.compact(850), "$850")
        XCTAssertEqual(ExplorePriceRail.compact(16_000), "$16k")
        XCTAssertEqual(ExplorePriceRail.compact(16_500), "$16.5k")
        XCTAssertEqual(ExplorePriceRail.compact(125_400), "$125k")
    }

    // MARK: Why this range

    func testWhyStackServesTheCohortOnceAndLinksTheSource() {
        let rows = ExploreWhyStack.rows(item: item(position: position()), estimate: nil, fresh: false)
        let labels = rows.map(\.label)
        XCTAssertTrue(labels.contains("Sales"))
        XCTAssertTrue(labels.contains("Basis"))
        XCTAssertTrue(labels.contains("Source"))
        XCTAssertEqual(rows.first { $0.label == "Source" }?.url, URL(string: "https://example.com/l"))
        XCTAssertNotNil(rows.first { $0.label == "Cohort" }?.cohort, "year, make and model give the existing cohort page")
    }

    func testWhyStackForAThinCohortSaysSoWithoutNumbers() {
        let rows = ExploreWhyStack.rows(item: item(position: position(thin: true)), estimate: nil, fresh: false)
        XCTAssertEqual(rows.first { $0.label == "Cohort" }?.value, ExploreAnalytics.notEnoughSales)
        XCTAssertFalse(rows.map(\.label).contains("Sales"))
    }

    func testWhyStackForALotNeedsAFreshBoard() {
        let lot = item("live:abc", kind: .live, amount: 15_000)
        let fresh = ExploreWhyStack.rows(item: lot, estimate: estimate(), fresh: true).map(\.label)
        XCTAssertTrue(fresh.contains("Model") && fresh.contains("Grade") && fresh.contains("Comps through") && fresh.contains("Factor"))
        let stale = ExploreWhyStack.rows(item: lot, estimate: estimate(), fresh: false)
        XCTAssertEqual(stale.first?.value, "No fresh projection for this lot")
    }

    func testFactorLinesReadDictionariesAndLists() {
        let dict: [String: Any] = ["b_two": 1.5, "a_one": "x"]
        XCTAssertEqual(FinishBoard.factorLines(dict), ["a one: x", "b two: 1.5"])
        let named: [String: Any] = ["name": "mileage", "value": -0.04]
        let list: [Any] = [named, "era"]
        XCTAssertEqual(FinishBoard.factorLines(list), ["mileage: -0.04", "era"])
        XCTAssertEqual(FinishBoard.factorLines(nil), [])
    }

    // MARK: Tuning

    func testTuningFiltersByEraMakeAndPrice() {
        var t = ExploreTuning()
        XCTAssertFalse(t.isActive)
        XCTAssertEqual(t.apply(feed).count, feed.count)
        t.make = "chevrolet corvette"
        XCTAssertEqual(t.apply(feed).map(\.id), ["a", "d"])
        t.eraFrom = 1970
        XCTAssertTrue(t.apply(feed).isEmpty, "feed items are 1968")
        t.eraFrom = 1960; t.eraTo = 1969
        t.priceMax = 20_000
        XCTAssertTrue(t.apply(feed).isEmpty, "feed items ask 25,000")
        t.priceMax = 30_000; t.priceMin = 20_000
        XCTAssertEqual(t.apply(feed).map(\.id), ["a", "d"])
    }

    func testTuningPlaceGoesToTheReadRoundedAndClamped() {
        var t = ExploreTuning()
        XCTAssertNil(t.place)
        t.homeLat = 35.2271; t.homeLng = -80.8431; t.radiusMiles = 900
        XCTAssertEqual(t.place?.lat, 35.23)
        XCTAssertEqual(t.place?.lng, -80.84)
        XCTAssertEqual(t.place?.radius, 500)
        t.homeLat = 120
        XCTAssertNil(t.place)
        XCTAssertFalse(t.hasLocalFilters, "place narrows the read, not the rows")
    }

    func testTuningChangesAreNamedNeverValued() {
        var a = ExploreTuning()
        var b = a
        XCTAssertTrue(b.changedFields(from: a).isEmpty)
        b.radiusMiles = 200; b.make = "ford"; b.priceMin = 5_000
        XCTAssertEqual(b.changedFields(from: a), ["radius", "make", "price"])
        a.homeLat = 1; a.homeLng = 2
        XCTAssertTrue(b.changedFields(from: a).contains("place"))
        let line = ExploreSignalLog.encode(ExploreSignalEvent.makeTune(["radius", "make"])) ?? ""
        XCTAssertTrue(line.contains("\"kind\":\"tune\""), line)
        XCTAssertTrue(line.contains("\"tuned\":\"radius,make\""), line)
    }

    func testTuningSurvivesARoundTripThroughDefaults() throws {
        let defaults = try XCTUnwrap(UserDefaults(suiteName: "explore-tuning-tests-\(UUID().uuidString)"))
        var t = ExploreTuning()
        t.homeLabel = "Charlotte, NC"; t.homeLat = 35.2; t.homeLng = -80.8; t.eraFrom = 1965; t.priceMax = 40_000
        t.save(defaults: defaults)
        XCTAssertEqual(ExploreTuning.load(defaults: defaults), t)
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

    func testSignalUploadCountsOnlyAnExplicitOk() {
        XCTAssertTrue(ExploreSignalLog.accepted(Data(#"{"ok":true,"accepted":3,"received":3}"#.utf8)))
        XCTAssertFalse(ExploreSignalLog.accepted(Data(#"{"ok":false,"error":"invalid_event"}"#.utf8)))
        XCTAssertFalse(ExploreSignalLog.accepted(Data("null".utf8)))
    }
}
