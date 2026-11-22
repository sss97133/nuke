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

    /// The reader's row for the test case: a 1967 Chevelle SS 396 asking $16k against nine close SS 396 sales.
    private func fairJSON(verdict: String = "range", reason: String? = nil, low: Double = 43_000, mid: Double = 54_000,
                          high: Double = 60_900, n: Int = 9) -> String {
        let r = reason.map { "\"" + $0 + "\"" } ?? "null"
        return """
        {"as_of":"2026-11-22T17:00:00Z","rows":[{"vehicle_id":"2A13D3BE-322A-420E-B974-7E82FF468318","verdict":"\(verdict)",
         "reason":\(r),"match":{"year_from":1967,"year_to":1967,"make":"Chevrolet","family":"Chevelle","tokens":["SS","396"],
         "window_from":"2024-12-12","window_to":"2026-01-06"},"n":\(n),"low":\(low),"mid":\(mid),"high":\(high),
         "venues":{"Bring a Trailer":9},"condition_known":0,
         "comps":[{"vehicle_id":"40ba4288-a634-438d-8aef-00af3a44ac2e","title":"1967 Chevrolet Chevelle SS 396 Sport Coupe 5-Speed",
                   "sold_on":"2026-01-06","price":63500,"venue":"Bring a Trailer","url":"https://bringatrailer.com/listing/1967-chevrolet-chevelle-ss-396-28/"},
                  {"vehicle_id":"a02816c3-db28-4f52-9d53-0040c41ef3a7","title":"1967 Chevrolet Chevelle SS 396 Sport Coupe",
                   "sold_on":"2025-01-22","price":"39000","venue":"Bring a Trailer","url":"javascript:alert(1)"},
                  {"title":"","url":null},
                  "junk"]},
         {"vehicle_id":"not-a-uuid","verdict":"range"}]}
        """
    }

    private func fair(_ json: String? = nil) -> AskFairRange? {
        AskFairBoard.decode(Data((json ?? fairJSON()).utf8))?.byId["2a13d3be-322a-420e-b974-7e82ff468318"]
    }

    func testFairBoardDecodesLossilyAndKeysByLowercasedId() throws {
        let board = try XCTUnwrap(AskFairBoard.decode(Data(fairJSON().utf8)))
        XCTAssertEqual(board.byId.count, 1, "a row without a real vehicle id is skipped")
        let f = try XCTUnwrap(board.range(for: UUID(uuidString: "2a13d3be-322a-420e-b974-7e82ff468318")))
        XCTAssertTrue(f.hasRange)
        XCTAssertEqual(f.n, 9)
        XCTAssertEqual(f.comps.count, 2, "an empty comp and a non-object are skipped")
        XCTAssertEqual(f.comps[1].price, 39_000, "a numeric string reads as a number")
        XCTAssertNil(f.comps[1].url, "only http(s) links open")
        XCTAssertEqual(f.matchText, "1967 Chevrolet Chevelle · SS 396")
        XCTAssertEqual(f.venues.first?.name, "Bring a Trailer")
        XCTAssertNil(AskFairBoard.decode(Data("[]".utf8)))
    }

    func testChevelleAskSitsBelowItsCloseSalesRange() throws {
        let r = ExplorePriceRail.fair(ask: 16_000, range: fair())
        XCTAssertEqual(r.basis, .closeComps)
        XCTAssertEqual(r.caption, "Fair range · 9 close sales")
        XCTAssertEqual(r.low, 43_000)
        XCTAssertEqual(r.high, 60_900)
        XCTAssertTrue(r.marker < r.bandStart, "a $16k ask sits under the close-sale band")
        XCTAssertTrue((0.0...1.0).contains(r.marker))
        XCTAssertEqual(try XCTUnwrap(fair()).askPlacement(16_000), "Below all 2 close sales")
    }

    func testNoRangeVerdictMissingReaderOrBadNumbersReadNoOpinionYet() {
        let cases: [AskFairRange?] = [
            nil,
            fair(fairJSON(verdict: "no_opinion", reason: "4 close sales in 3 years; 5 needed")),
            fair(fairJSON(low: 0)),
            fair(fairJSON(low: 70_000, high: 60_000)),
        ]
        for f in cases {
            let r = ExplorePriceRail.fair(ask: 16_000, range: f)
            XCTAssertEqual(r.basis, .none)
            XCTAssertFalse(r.hasBand)
            XCTAssertEqual(r.caption, ExplorePriceRail.noOpinion)
        }
        XCTAssertNil(ExplorePriceRail.fair(ask: nil, range: fair()).caption)
    }

    func testTheFamilyCohortIsNeverDrawnForAnAsk() {
        let ask = item(position: position())
        let r = ExplorePriceRail.make(item: ask, estimate: estimate(), fresh: true)
        XCTAssertEqual(r.basis, .none, "a family cohort alone gives no band")
        XCTAssertEqual(r.caption, ExplorePriceRail.noOpinion)
    }

    func testAuctionBandShowsOnlyFromAFreshBoardWithABidInsideIt() {
        let ok = ExplorePriceRail.projected(bid: 15_000, estimate: estimate(), fresh: true)
        XCTAssertEqual(ok.basis, .projected)
        XCTAssertEqual(ok.caption, "Projected hammer")
        XCTAssertEqual(ok.landing, 18_000)
        XCTAssertEqual(ok.landingText, "Lands near $18k")
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
        XCTAssertEqual(ExplorePriceRail.make(item: ask, estimate: estimate(), fresh: true, fair: fair()).basis, .closeComps)
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

    func testWhyStackServesCloseSalesOnceAndLinksEachSource() throws {
        let f = try XCTUnwrap(fair())
        let rows = ExploreWhyStack.rows(item: item(amount: 16_000, position: position()), estimate: nil, fresh: false, fair: f)
        let labels = rows.map(\.label)
        XCTAssertEqual(rows.first?.label, "Match")
        XCTAssertNotNil(rows.first?.cohort, "the match opens the existing cohort page")
        XCTAssertTrue(rows.first?.value.contains("SS 396") == true)
        XCTAssertEqual(rows.first { $0.label == "Close-sale median" }?.value, AskPlacement.dollars(54_000))
        XCTAssertEqual(rows.first { $0.label == "Adjustments" }?.value, ExploreWhyStack.noAdjustments)
        XCTAssertEqual(rows.first { $0.label == "Confidence" }?.value, "9 close sales · Bring a Trailer 9 · condition recorded on 0 of 9")
        XCTAssertEqual(rows.first { $0.label == "Source" }?.url, URL(string: "https://example.com/l"))
        XCTAssertFalse(labels.contains("Sales") || labels.contains("Basis"), "no family cohort rows")
        XCTAssertEqual(Set(labels).count, labels.count, "each fact once")
        let comps = ExploreWhyStack.compRows(f)
        XCTAssertEqual(comps.count, 2)
        XCTAssertEqual(comps[0].url, URL(string: "https://bringatrailer.com/listing/1967-chevrolet-chevelle-ss-396-28/"))
        XCTAssertTrue(comps[0].value.hasPrefix(AskPlacement.dollars(63_500)))
    }

    func testWhyStackWithoutARangeSaysWhy() throws {
        let f = try XCTUnwrap(fair(fairJSON(verdict: "no_opinion", reason: "4 close sales in 3 years; 5 needed", n: 4)))
        let rows = ExploreWhyStack.rows(item: item(position: position()), estimate: nil, fresh: false, fair: f)
        XCTAssertEqual(rows.first { $0.label == "No opinion yet" }?.value, "4 close sales in 3 years; 5 needed")
        XCTAssertNil(rows.first { $0.label == "Close-sale median" })
        let none = ExploreWhyStack.rows(item: item(position: position()), estimate: nil, fresh: false, fair: nil)
        XCTAssertEqual(none.first?.label, "No opinion yet")
        XCTAssertNotNil(none.first { $0.label == "Model sales" }?.cohort)
    }

    func testHeatLineCarriesTheBoardsReading() {
        let h = LiveAuction.Heat(ratio: 1.42, state: .hot, typicalNow: 31_000, share: 0.6, hoursLeft: 19.6)
        XCTAssertEqual(ExploreWhyStack.heatLine(h),
                       "Hot: the bid is 1.4× where comparable sold lots stood with 20 h left (\(AskPlacement.dollars(31_000)))")
        let lot = item("live:abc", kind: .live, amount: 15_000)
        let rows = ExploreWhyStack.rows(item: lot, estimate: estimate(), fresh: true, heat: "Hot: x")
        XCTAssertEqual(rows.first?.label, "Heat")
        XCTAssertNil(rows.first { $0.label == "Projection" }, "the rail carries the landing price")
        let above = ExploreWhyStack.rows(item: item("live:abc", kind: .live, amount: 30_000), estimate: estimate(), fresh: true)
        XCTAssertEqual(above.first { $0.label == "Projection" }?.value, AskPlacement.dollars(18_000), "said here when the rail cannot")
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

    func testUploadIsOnByDefaultAndCanBeTurnedOff() async {
        let defaults = UserDefaults(suiteName: "explore-signals-flag-\(UUID().uuidString)")!
        XCTAssertTrue(ExploreSignalLog.uploadEnabled(defaults), "absent key = on")
        defaults.set(false, forKey: ExploreSignalLog.uploadFlagKey)
        XCTAssertFalse(ExploreSignalLog.uploadEnabled(defaults))
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("explore-signals-\(UUID().uuidString).jsonl")
        defer { try? FileManager.default.removeItem(at: url) }
        let log = ExploreSignalLog(fileURL: url)
        await log.append(ExploreSignalEvent.make(.impression, item: item(), position: 0))
        await log.flushIfEnabled(defaults: defaults)   // turned off: returns without a request
        let count = await log.count
        XCTAssertEqual(count, 1)
        defaults.set(true, forKey: ExploreSignalLog.uploadFlagKey)
        XCTAssertTrue(ExploreSignalLog.uploadEnabled(defaults))
    }

    func testUploadBackoffDoublesAndCaps() {
        XCTAssertEqual(ExploreSignalLog.backoff(failures: 0), 0)
        XCTAssertEqual(ExploreSignalLog.backoff(failures: 1), 30)
        XCTAssertEqual(ExploreSignalLog.backoff(failures: 2), 60)
        XCTAssertEqual(ExploreSignalLog.backoff(failures: 4), 240)
        XCTAssertEqual(ExploreSignalLog.backoff(failures: 7), 1800)
        XCTAssertEqual(ExploreSignalLog.backoff(failures: 50), 1800)
    }

    func testSignalUploadCountsOnlyAnExplicitOk() {
        XCTAssertTrue(ExploreSignalLog.accepted(Data(#"{"ok":true,"accepted":3,"received":3}"#.utf8)))
        XCTAssertFalse(ExploreSignalLog.accepted(Data(#"{"ok":false,"error":"invalid_event"}"#.utf8)))
        XCTAssertFalse(ExploreSignalLog.accepted(Data("null".utf8)))
    }
}
