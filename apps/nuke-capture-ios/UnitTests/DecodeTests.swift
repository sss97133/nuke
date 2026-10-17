// DecodeTests.swift — the payload shapes the phone reads, decoded the way the server sends them.
//
// Every reader the app calls returns JSON the server can change; a struct that throws on a null
// the server started sending (CalendarDay.work_cost after #1048) silently took every non-owner's
// calendar down. These tests pin the shapes: a document with a section the app does not know, a
// claim with a source kind it does not know, a board with a drifted and a broken row, a masked
// calendar day. They run on every iOS pull request (.github/workflows/ios-build.yml).

import XCTest
@testable import NukeCapture

final class DecodeTests: XCTestCase {
    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try JSONDecoder().decode(T.self, from: Data(json.utf8))
    }

    func testProfileReadDecodesSectionsAndToleratesAnUnknownKind() throws {
        let json = """
        {"vehicle_id":"e08bf694-970f-4cbe-8a74-8715158a0f2e","viewer":"anon","read_at":"2026-10-13T16:14:39.360102+00:00",
         "sections":[
          {"kind":"masthead","identity_source":{"year":1977,"make":"Chevrolet","model":"Blazer","normalized_model":"K5 Blazer","series":"K5","trim":"Cheyenne","transmission":"Automatic","transmission_model":"6L90"},
           "year":1977,"make":"Chevrolet","model":"Blazer","price":null,"priceLabel":null},
          {"kind":"strip","coverage":{"n":1,"of":5,"grain":"facts attributed","as_of":"2026-06-23T22:24:03.266022+00:00"},
           "facets":[{"dimension":"engine","label":"6.2L V8","member":{"value":"6.2L V8","source":{"kind":"image","label":"ls3 documentation corpus pixel verified","method":"ls3_documentation_corpus_pixel_verified"},"observed_at":"2026-06-23T22:24:03.266022+00:00","trust":0.95}},
                     {"dimension":"body_style","label":"SUV","member":{"value":"SUV","source":{"kind":"legacy","label":"vehicle record"},"observed_at":null,"trust":0.3}}],
           "odometer":null},
          {"kind":"timeline","coverage":{"n":257,"of":257,"grain":"events dated","as_of":"2026-06-01T01:13:32.823938+00:00"},
           "days":[{"day":"2026-02-01","kinds":{"service":10,"modification":1}}]},
          {"kind":"hologram","anything":true}
         ]}
        """
        let read = try decode(ProfileRead.self, json)
        XCTAssertEqual(read.viewer, .anon)
        XCTAssertEqual(read.sections.count, 4)
        XCTAssertNotNil(read.masthead)
        XCTAssertEqual(read.strip?.facets.count, 2)
        XCTAssertEqual(read.strip?.coverage.sentence, "1 of 5 facts attributed · as of Jun 23, 2026")
        XCTAssertEqual(read.timeline?.days.first?.kinds["service"], 10)
        if case .unknown(let kind) = read.sections[3] { XCTAssertEqual(kind, "hologram") } else { XCTFail("unknown section must decode as .unknown") }
        let legacy = try XCTUnwrap(read.strip?.facets[1].member)
        XCTAssertEqual(legacy.rootStatus, .recorded)
        XCTAssertEqual(legacy.decayLine, "vehicle record · trust 30%")
    }

    func testClaimWithAnUnknownSourceKindOrViewerDecodes() throws {
        let claim = try decode(Claim.self, #"{"value":12.5,"unit":"mi","source":{"kind":"sensor","label":"obd"},"observed_at":"2026-10-13T00:00:00+00:00","trust":0.5}"#)
        XCTAssertEqual(claim.source.kind, .legacy)   // an unknown class is read as the record, never as a crash
        XCTAssertEqual(claim.value.text, "12.5")
        let read = try decode(ProfileRead.self, #"{"vehicle_id":"x","viewer":"auditor","read_at":"t","sections":[]}"#)
        XCTAssertEqual(read.viewer, .anon)           // an unknown viewer fails closed
    }

    func testClaimValueTextDoesNotTrapOnLargeNumbers() throws {
        let big = try decode(Claim.self, #"{"value":1e30,"source":{"kind":"model"},"observed_at":null,"trust":0.4}"#)
        XCTAssertFalse(big.value.text.isEmpty)
        let whole = try decode(Claim.self, #"{"value":24000,"source":{"kind":"listing"},"observed_at":null,"trust":0.9}"#)
        XCTAssertEqual(whole.value.text, "24000")
    }

    func testLiveBoardSkipsBrokenRowsAndReadsDriftedValuesAsMissing() throws {
        let json = """
        {"synced_at":"2026-10-13T16:40:00.496962+00:00","source":"test","auctions":[
          ["69c01291-6232-4df8-ad9e-82eaac792462",1989,"LAMBORGHINI","Countach",576000,"2026-10-13T17:00:00+00:00","2026-10-13T16:40:00+00:00","2026-10-02T00:30:08+00:00","https://bringatrailer.com/x.jpg",false,"https://bringatrailer.com/listing/x","Countach",450000,605000,938000,"d",41],
          ["11111111-1111-1111-1111-111111111111","1990","PORSCHE",null,"not-a-number",null,null,null,null,"yes",null,null,null,null,null,null,null],
          {"kind":"object row"},
          ["not-a-uuid",2001,"FORD","F-150",1000,"2026-10-13T18:00:00+00:00",null,null,null,false,null,null,null,null,null,null,null]
        ]}
        """
        let board = try decode(LiveBoard.self, json)
        XCTAssertEqual(board.auctions.count, 3)
        XCTAssertEqual(board.skippedRows, 1)
        XCTAssertEqual(board.auctions[0].currentBid, 576000)
        XCTAssertNotNil(board.auctions[0].endsAtDate)
        XCTAssertEqual(board.auctions[1].year, 1990)        // a numeric string is read
        XCTAssertNil(board.auctions[1].currentBid)           // a non-number is missing, not fatal
        XCTAssertFalse(board.auctions[1].noReserve)
        XCTAssertNil(board.auctions[2].vehicleUUID)          // a bad id opens nothing
        // A non-scalar in a slot is consumed as one position; a non-finite number reads as missing, never traps.
        let odd = try decode(LiveBoard.self, #"{"synced_at":null,"source":"t","auctions":[["69c01291-6232-4df8-ad9e-82eaac792462",{"year":1},["x"],"M3","nan","2026-10-13T18:00:00+00:00",null,null,null,false,null,"Title",1,2,3,"d","1e400"]]}"#)
        XCTAssertEqual(odd.auctions.count, 1)
        XCTAssertNil(odd.auctions[0].year)
        XCTAssertEqual(odd.auctions[0].model, "M3")
        XCTAssertNil(odd.auctions[0].currentBid)
        XCTAssertEqual(odd.auctions[0].title, "Title")
        XCTAssertEqual(odd.auctions[0].band?.p50, 2)
        XCTAssertEqual(odd.auctions[0].band?.comps, 0)
        XCTAssertEqual(board.open(at: Date(timeIntervalSince1970: 1_792_000_000)).count, 0)
    }

    func testLiveBoardReadsTheBandCurveAndBaselineAndGradesHeatAsTheWebDoes() throws {
        let json = """
        {"synced_at":"2026-10-13T22:00:00+00:00","source":"test",
         "curve":{"d":[[168,0.4505],[120,0.6076],[96,0.6392],[72,0.6632],[48,0.6902],[24,0.70],[12,0.75],[1,0.80]]},
         "baseline":{"week_ago":{"n":1100,"at":"2026-10-06T21:00:00+00:00","bids":37600000,"source":"live"}},
         "auctions":[
          ["69c01291-6232-4df8-ad9e-82eaac792462",2023,"PORSCHE","911",650000,"2026-10-14T16:45:00+00:00",null,null,null,false,null,"Sport Classic",478000,552000,700000,"d",15],
          ["11111111-1111-1111-1111-111111111111",1953,"ALFA ROMEO","1900C",40000,"2026-10-14T16:50:00+00:00",null,null,null,false,null,null,null,null,null,null,null],
          ["22222222-2222-2222-2222-222222222222",1990,"BMW","M3",30000,"2026-10-21T00:00:00+00:00",null,null,null,false,null,null,20000,30000,40000,"d",9]
        ]}
        """
        let board = try decode(LiveBoard.self, json)
        let now = try XCTUnwrap(ProfileClock.date("2026-10-13T22:06:40+00:00"))
        XCTAssertEqual(board.auctions[0].band?.p50, 552000)        // after three nulls and a false: every position still its own
        XCTAssertEqual(board.auctions[0].title, "Sport Classic")
        XCTAssertEqual(board.auctions[0].band?.comps, 15)
        XCTAssertNil(board.auctions[1].band)                       // no p10/p50/p90: no band, as useMarketPulse maps it
        XCTAssertEqual(board.weekAgo?.bids, 37_600_000)
        let hot = try XCTUnwrap(board.auctions[0].heat(curve: board.curve, at: now))
        XCTAssertEqual(hot.state, .hot)
        XCTAssertEqual(hot.hoursLeft, 18.64, accuracy: 0.01)
        // 18.64 h sits between the 24 h (0.70) and 12 h (0.75) marks: 0.70 + 0.05 × (24 − 18.64) / 12
        XCTAssertEqual(hot.share, 0.7223, accuracy: 0.001)
        XCTAssertEqual(hot.ratio, 650000 / (552000 * 0.7223), accuracy: 0.01)
        XCTAssertNil(board.auctions[1].heat(curve: board.curve, at: now))   // no band, no verdict
        XCTAssertNil(board.auctions[2].heat(curve: board.curve, at: now))   // 170 h left: past the 120 h ceiling, no verdict
        XCTAssertEqual(LiveBoardView.multiple(1.602), "1.6×")
        XCTAssertEqual(LiveBoardView.multiple(3.4), "3×+")
        XCTAssertEqual(LiveBoardView.bidNumber(650000), "$650,000")
        XCTAssertEqual(LiveBoardView.bidNumber(37_600_000, compact: true), "$37.6M")
        XCTAssertEqual(LiveBoardView.about(405_720), 406_000)
        let broken = try decode(LiveBoard.self, #"{"synced_at":null,"source":"t","curve":{"d":"not points"},"baseline":{"week_ago":{"bids":"x"}},"auctions":[]}"#)
        XCTAssertEqual(broken.curve?.tiers.isEmpty, true)          // a malformed curve reads as absent, never as a crash
        XCTAssertNil(broken.weekAgo)
    }

    func testLedgerMapRowsDecodeAtEveryLevelAndFormatAsTheWebDoes() throws {
        // treemap_by_brand carries min and max; treemap_years does not. Both decode to the same node.
        let brand = try decode([LedgerNode].self, #"[{"name":"CHEVROLET","count":151479,"value":5400000000,"median_price":36000,"min_price":100,"max_price":3500000,"sold_count":40000,"auction_count":9000,"avg_bids":12,"avg_watchers":400}]"#)
        XCTAssertEqual(brand.first?.median_price, 36000)
        let year = try decode([LedgerNode].self, #"[{"name":"1969","count":812,"value":40600000,"median_price":50000,"sold_count":300,"auction_count":100,"avg_bids":10,"avg_watchers":200}]"#)
        XCTAssertNil(year.first?.min_price)
        XCTAssertEqual(year.first?.count, 812)
        // The leaf: a recorded sale price wins, else the sold price, as the web's useTreemapVehicles maps it.
        let leaf = try decode([LedgerVehicle].self, #"[{"id":"e08bf694-970f-4cbe-8a74-8715158a0f2e","year":1977,"make":"Chevrolet","model":"Blazer","listing_title":null,"bat_listing_title":null,"sale_price":null,"sold_price":42000,"primary_image_url":null,"mileage":null}]"#)
        XCTAssertEqual(leaf.first?.price, 42000)
        XCTAssertEqual(leaf.first?.name, "1977 Chevrolet Blazer")
        XCTAssertEqual(LedgerMap.money(36_000), "$36K")
        XCTAssertEqual(LedgerMap.money(1_250_000), "$1.3M")
        XCTAssertEqual(LedgerMap.money(0), "--")
    }

    func testCalendarDayDecodesTheMaskedShapeFor1048() throws {
        let day = try decode(CalendarDay.self, #"{"day":"2026-02-02","photos":3,"events":0,"work":2,"work_minutes":120,"work_cost":null,"money_masked":true}"#)
        XCTAssertNil(day.work_cost)
        XCTAssertEqual(day.money_masked, true)
        let owner = try decode(CalendarDay.self, #"{"day":"2026-02-02","photos":3,"events":0,"work":2,"work_minutes":120,"work_cost":410}"#)
        XCTAssertEqual(owner.work_cost, 410)
    }

    func testDayReceiptDecodesWithoutMoneyForNonOwners() throws {
        let receipt = try decode(DayReceipt.self, #"{"date":"2026-02-02","is_owner_view":false,"photos":[],"work_sessions":[{"id":"6a4f3b2e-0000-4000-8000-000000000001","title":"Dash","duration_minutes":60,"total_job_cost":null}],"receipts":[]}"#)
        XCTAssertEqual(receipt.is_owner_view, false)
        XCTAssertNil(receipt.work_sessions.first?.total_job_cost)
    }

    func testProfileReadDecodesDescriptionAndTestimonySummary() throws {
        let json = """
        {"vehicle_id":"e08bf694-970f-4cbe-8a74-8715158a0f2e","viewer":"owner","read_at":"2026-10-17T12:00:00+00:00",
         "sections":[],
         "description":{"text":"One-owner 911 Carrera 4S finished in Arctic Silver.","length":51,
                        "source":{"kind":"listing","url":"https://bringatrailer.com/listing/2003-porsche-911","method":"bat_description","label":"Bring a Trailer"},
                        "observed_at":"2026-10-16T00:00:00+00:00"}}
        """
        let read = try decode(ProfileRead.self, json)
        XCTAssertEqual(read.viewer, .owner)
        XCTAssertEqual(read.description?.length, 51)
        XCTAssertEqual(read.description?.source.kind, .listing)
        XCTAssertEqual(read.description?.source.openableURL?.absoluteString, "https://bringatrailer.com/listing/2003-porsche-911")

        let testimony = try decode(VehicleTestimonySummary.self, #"{"total":42,"events":3,"images":28,"observations":8,"documents":2,"service":1}"#)
        XCTAssertEqual(testimony.total, 42)
        XCTAssertTrue(testimony.sentence.contains("42 testimony items"))
        XCTAssertTrue(testimony.sentence.contains("28 photos"))
    }

    func testGroupRepeatedObservationsCollapsesIdenticalListingClaims() throws {
        let obs1 = FieldProvenance.Observation(
            id: UUID(uuidString: "11111111-1111-1111-1111-111111111111")!,
            content: "6-speed manual transmission",
            value: "6-Speed Manual",
            confidence: 0.95,
            observed_at: "2026-10-01T12:00:00Z",
            ingested_at: "2026-10-01T12:05:00Z",
            extraction_method: "bat_listing_scrape",
            kind: "specification",
            source_slug: "bat",
            trust: 0.9,
            source_url: "https://bringatrailer.com/listing/test"
        )
        let obs2 = FieldProvenance.Observation(
            id: UUID(uuidString: "22222222-2222-2222-2222-222222222222")!,
            content: "6-speed manual transmission",
            value: "6-Speed Manual",
            confidence: 0.95,
            observed_at: "2026-10-05T12:00:00Z",
            ingested_at: "2026-10-05T12:05:00Z",
            extraction_method: "bat_listing_scrape",
            kind: "specification",
            source_slug: "bat",
            trust: 0.9,
            source_url: "https://bringatrailer.com/listing/test"
        )
        let obs3 = FieldProvenance.Observation(
            id: UUID(uuidString: "33333333-3333-3333-3333-333333333333")!,
            content: "Confirmed on build sheet",
            value: "6-Speed Manual",
            confidence: 1.0,
            observed_at: "2026-10-06T12:00:00Z",
            ingested_at: "2026-10-06T12:05:00Z",
            extraction_method: "owner_document",
            kind: "specification",
            source_slug: "owner",
            trust: 1.0,
            source_url: nil
        )
        let grouped = FieldProvenance.groupRepeatedObservations([obs1, obs2, obs3])
        XCTAssertEqual(grouped.count, 2)
        XCTAssertEqual(grouped[0].repeatCount, 2)
        XCTAssertEqual(grouped[0].firstObservedAt, "2026-10-01T12:00:00Z")
        XCTAssertEqual(grouped[0].latestObservedAt, "2026-10-05T12:00:00Z")
        XCTAssertEqual(grouped[1].repeatCount, 1)
    }

    func testLedgerMapCanonicalHierarchyAndScaleMath() throws {
        let refreshJSON = """
        {"refreshed_at":"2026-10-17T08:00:00Z",
         "populations":{
           "measure":"confirmed_sale_v1",
           "public_records":615420,
           "mapped_sales":412300,
           "by_house":[
             {"house":"bat","sales":152000,"amount":12500000000},
             {"house":"mecum","sales":128000,"amount":4800000000},
             {"house":"cars_and_bids","sales":42000,"amount":1400000000}
           ]
         }}
        """
        let receipt = try decode(LedgerRefreshReceipt.self, refreshJSON)
        XCTAssertTrue(receipt.isConfirmedSaleMeasure)
        XCTAssertEqual(receipt.populations?.mapped_sales, 412300)
        XCTAssertEqual(receipt.populations?.by_house?.first?.house, "bat")

        let brandJSON = """
        [{"brand":"PORSCHE","sales":45000,"usd":4200000000,"sold_any":45000,"offered":56000,
          "dated":44000,"sold_12m":4200,"sold_prior_12m":3500,"usd_12m":386400000,"usd_prior_12m":294000000}]
        """
        let brands = try decode([BrandMarketRow].self, brandJSON)
        let p = try XCTUnwrap(brands.first)
        XCTAssertEqual(p.brand, "PORSCHE")
        XCTAssertEqual(p.sales, 45000)
        XCTAssertEqual(p.sold_12m, 4200)

        let famJSON = """
        [{"family_key":"911-997","family_name":"911 (997)","models":4,"sales":3200,"usd":290000000,
          "median_price":82000,"min_price":28000,"max_price":450000,"sold_any":3200,"offered":4100,
          "dated":3100,"sold_12m":310,"sold_prior_12m":260,"usd_12m":27900000,"usd_prior_12m":21320000}]
        """
        let fams = try decode([FamilyMarketRow].self, famJSON)
        let famNode = try XCTUnwrap(fams.first?.toLedgerNode())
        XCTAssertEqual(famNode.familyKey, "911-997")
        XCTAssertEqual(famNode.count, 3200)
        XCTAssertEqual(famNode.area(basis: .ledger, isBrandOrFamily: true), 290_000_000)
        XCTAssertEqual(famNode.area(basis: .bat12, isBrandOrFamily: true), 27_900_000)

        let moversJSON = """
        {"market":{"sold":4000,"prior":4000,"move":0.0},"candidates":120,
         "gaining":[{"brand":"PORSCHE","family_key":"911-997","family":"911 (997)","sold":50,"prior":25,"usd":4400000,"usd_prior":2050000,"ratio":2.0,"lo":1.35,"hi":2.96,"move":1.0,"se":0.2,"z":2.5}],
         "losing":[]}
        """
        let movers = try XCTUnwrap(ShareMoversRead.parse(Data(moversJSON.utf8)))
        XCTAssertEqual(movers.gaining.count, 1)
        XCTAssertEqual(movers.gaining[0].familyKey, "911-997")
        XCTAssertEqual(movers.gaining[0].ratio, 2.0)

        let idxJSON = """
        {"fitted_at":"2026-10-17T06:00:00Z","period_kind":"quarter","stale":false,
         "counts":{"n_last12":90,"n_prior12":85,"n_total":420},
         "change":{"verdict":"up","change_12m":0.064,"lo":0.012,"hi":0.118,"n_last12":90,"n_prior12":85,"raw_change":0.081,"pairs":14,"rs_change":0.059,
                   "chips":[{"key":"carrera-s-manual","label":"Carrera S · Manual","change_12m":0.092,"lo":0.03,"hi":0.15,"n_last12":35,"n_prior12":32,"verdict":"up"}]},
         "series":[{"period_start":"2026-07-01","index_usd":86000,"lo_usd":81000,"hi_usd":91000,"n":45,"raw_median_usd":88000}]}
        """
        let idx = try XCTUnwrap(FamilyIndex.parse(Data(idxJSON.utf8)))
        XCTAssertEqual(idx.verdict, "up")
        XCTAssertEqual(idx.change, 0.064)
        XCTAssertEqual(idx.segments.first?.label, "Carrera S · Manual")
        XCTAssertEqual(idx.series.count, 1)
    }

    func testFinishBoardAskBoardCalendarAndSourcesDecode() throws {
        let finishJSON = """
        {"fresh":true,"writer_at":"2026-10-17T12:00:00Z",
         "columns":["vehicle_id","estimate","low","high","grade","coverage","sentence","estimated_at","bid_at_estimate","comps_through"],
         "rows":[["69c01291-6232-4df8-ad9e-82eaac792462",115000,98000,136000,"A",0.82,"82% of comparable lots landed inside this band","2026-10-17T11:58:00Z",84000,"2026-10-16"]],
         "analogs":{"69c01291-6232-4df8-ad9e-82eaac792462":[{"url":"https://bringatrailer.com/listing/analog-1","title":"1996 Porsche 911 Turbo","closed":"2026-09-12","bid":82000,"final":118000,"outcome":"sold"}]}}
        """
        let finishData = Data(finishJSON.utf8)
        let finishBoard = FinishBoard.decode(finishData)
        XCTAssertTrue(finishBoard.fresh)
        let est = try XCTUnwrap(finishBoard.byId["69c01291-6232-4df8-ad9e-82eaac792462"])
        XCTAssertEqual(est.estimate, 115000)
        XCTAssertEqual(est.grade, "A")
        let analogs = FinishBoard.decodeAnalogs(finishData, vehicleId: "69c01291-6232-4df8-ad9e-82eaac792462")
        XCTAssertEqual(analogs.count, 1)
        XCTAssertEqual(analogs[0].finalPrice, 118000)

        let askJSON = """
        {"as_of":"2026-10-17T12:00:00Z","window_hours":72,"tier":null,"sort":"newest",
         "population":{"listings":120,"filtered":120,"with_position":85,"below_p25":22,"by_source":{"craigslist":80,"facebook_marketplace":40},"by_tier":{"15k_40k":50},"median_ask":24500,"newest_seen_at":"2026-10-17T11:55:00Z"},
         "price_population":{"measure":"confirmed_sale_v1","refreshed_at":"2026-10-17T08:00:00Z","sales":412300,"families":1850},
         "rows":[
           {"event_id":"ev-1","vehicle_id":"69c01291-6232-4df8-ad9e-82eaac792462","source":"craigslist","url":"https://sfbay.craigslist.org/sfc/cto/d/san-francisco-1999-porsche-911/7777777777.html","seen_at":"2026-10-17T11:50:00Z","year":1999,"make":"PORSCHE","model":"911","title":"1999 Porsche 911 Carrera","ask":22000,"miles":88000,"odometer":"broken","condition":"good","title_status":"salvage","image":null,"location":"San Francisco, CA",
            "position":{"family":"911","cohort":"1999","match":"year","sales":140,"p25":25000,"p50":32000,"p75":41000,"ratio":0.6875,"rank":"below_p25","median_miles":64000,"share_36m":0.45,"houses":{"bat":95,"cars_and_bids":45}}}
         ]}
        """
        let askBoard = try decode(AskBoard.self, askJSON)
        XCTAssertEqual(askBoard.rows.count, 1)
        let askRow = askBoard.rows[0]
        // Broken odometer says "odometer broken" instead of printing 88,000 mi
        XCTAssertEqual(askRow.listingFacts, "odometer broken · salvage title · good")
        let placement = try XCTUnwrap(AskPlacement.placement(pos: askRow.position, ask: askRow.ask))
        XCTAssertEqual(placement.tone, .below)
        XCTAssertEqual(placement.headline, "31% below the 1999 911 median ($32,000)")
        XCTAssertEqual(placement.milesLine, "Sold median 64,000 mi")
        XCTAssertEqual(placement.venuesLine, "Recorded on BaT (95), Cars & Bids (45)")

        let calJSON = """
        {"as_of":"2026-10-17T12:00:00Z","horizon_days":200,
         "population":{"lots":1450,"sales":6,"houses":3,"seen_before":210,"no_reserve":680,"first_seen_7d":190,"updated_at":"2026-10-17T11:00:00Z","listed":1800},
         "sales":[{"house":"mecum","sale_key":"kissimmee-2027","sale_name":"Kissimmee 2027","location":"Kissimmee, FL","starts_on":"2027-01-05","ends_on":"2027-01-17","lots":850,"seen_before":120,"no_reserve":400,"first_seen_at":"2026-09-01T00:00:00Z","first_seen_7d":90,"updated_at":"2026-10-17T11:00:00Z","run_days":[{"day":"2027-01-05","lots":100}],"lots_listed":1000,"listed_at":"2026-10-17T06:00:00Z","prior_sale":{"sale_key":"kissimmee-2026","lots":3200,"vehicle_lots":2800,"sold":2100,"bid_goes_on":700,"median_price":48000,"ends_on":"2026-01-18"}}],
         "unplaced":[],"roster":null}
        """
        let cal = try decode(AuctionCalendar.self, calJSON)
        XCTAssertEqual(cal.sales.count, 1)
        XCTAssertEqual(AuctionCalendar.priorSaleLine(house: "mecum", prior: cal.sales[0].prior_sale),
                       "Mecum ran 3,200 lots at Kissimmee 2026 · 75% of its vehicles sold")

        let sourcesJSON = """
        {"as_of":"2026-10-17T12:00:00Z","day":"2026-10-17",
         "columns":["source","name","category","house","held_lots","held_at","population","population_method","map_sales","map_usd","sales_12m","usd_12m","sales_prior_12m","usd_prior_12m","live_lots","landed_24h","landed_7d","last_landed","logo_url","business_type"],
         "rows":[["bat","Bring a Trailer (BaT)","online_auction","bat",165000,"2026-10-17T12:00:00Z",166000,"enumerated",152000,12500000000,32000,2800000000,29000,2500000000,980,145,980,"2026-10-17T11:58:00Z",null,"online_auction"]],
         "not_ranked":{"pcarmarket":4200}}
        """
        let sb = try XCTUnwrap(SourcesBoardData.parse(Data(sourcesJSON.utf8)))
        XCTAssertEqual(sb.rows.count, 1)
        XCTAssertEqual(sb.rows[0].shortName, "Bring a Trailer")
        XCTAssertEqual(sb.rows[0].heldShareText, "99% of 166,000")
        XCTAssertEqual(sb.notRanked["pcarmarket"], 4200)
    }
}
