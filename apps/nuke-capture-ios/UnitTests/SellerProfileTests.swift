// SellerProfileTests.swift — the shapes bat_seller_profile / bat_market_baseline / bat_listing_cohort return,
// and the comparison math the seller page prints from them. A missing number must stay missing.

import XCTest
@testable import NukeCapture

final class SellerProfileTests: XCTestCase {
    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try JSONDecoder().decode(T.self, from: Data(json.utf8))
    }

    func testProfileDecodesStatsListingsAndNulls() throws {
        let json = """
        {"handle":"VivaLasVegasAutos",
         "all_time":{"listings":68,"sold":47,"not_sold":19,"live":0,"unresolved":2,"sell_through":0.7121,
                     "median_sold":32000,"avg_sold":40255,"max_sold":132000,"min_sold":5100,"total_sold_usd":1891964,
                     "first_listing":"2016-07-18T00:00:00+00:00","last_listing":"2026-10-03T17:06:00+00:00"},
         "last_12m":{"closed":18,"sold":12,"not_sold":6,"sell_through":0.6667,"median_sold":43750,"avg_sold":43224},
         "listings":[
          {"vehicle_id":"4917e856-2e13-4507-81a7-f221fcb80d08","url":"https://bringatrailer.com/listing/1977-international-harvester-super-scout-ii-8",
           "year":1977,"make":"International Harvester","model":"Scout II 4×4","image_url":"https://bringatrailer.com/wp-content/uploads/a.jpeg",
           "status":"sold","price":63665,"ends_at":"2026-09-23T20:09:42+00:00","bids":24},
          {"vehicle_id":"2e61fa34-c5b4-4709-9636-4823546a5bc4","url":null,"year":null,"make":null,"model":null,
           "image_url":null,"status":"unresolved","price":null,"ends_at":null,"bids":null}]}
        """
        let profile = try decode(SellerProfile.self, json)
        XCTAssertEqual(profile.all_time?.listings, 68)
        XCTAssertEqual(profile.all_time?.sell_through, 0.7121)
        XCTAssertEqual(profile.listings?.count, 2)
        XCTAssertTrue(profile.listings?[0].isSold == true)
        XCTAssertEqual(profile.listings?[0].title, "1977 International Harvester Scout II 4×4")
        XCTAssertNil(profile.listings?[1].price)
        XCTAssertEqual(profile.listings?[1].title, "")
    }

    func testEmptyProfileAndCohortWithheldBelowFiveComparables() throws {
        let empty = try decode(SellerProfile.self, #"{"handle":"nobody","all_time":{"listings":0},"last_12m":null,"listings":[]}"#)
        XCTAssertEqual(empty.all_time?.listings, 0)
        XCTAssertNil(empty.all_time?.median_sold)
        let cohort = try decode(SellerListingCohort.self, #"{"basis":"x","n":3,"median":null,"avg":null,"n_same_year":0,"median_same_year":null}"#)
        XCTAssertEqual(cohort.n, 3)
        XCTAssertNil(cohort.median)
        let market = try decode(SellerMarketBaseline.self, #"{"months":12,"sold":38332,"not_sold":7996,"sell_through":0.8274,"median_sold":23250,"avg_sold":49572}"#)
        XCTAssertEqual(market.median_sold, 23250)
    }

    func testComparisonMath() {
        XCTAssertEqual(SellerCompare.percentDelta(32000, 23250) ?? 0, 37.634, accuracy: 0.01)
        XCTAssertNil(SellerCompare.percentDelta(nil, 23250))
        XCTAssertNil(SellerCompare.percentDelta(32000, nil))
        XCTAssertNil(SellerCompare.percentDelta(32000, 0))
        XCTAssertEqual(SellerCompare.pointDelta(0.7121, 0.8274) ?? 0, -11.53, accuracy: 0.01)
        XCTAssertEqual(SellerCompare.percentText(37.6), "+38% vs")
        XCTAssertEqual(SellerCompare.percentText(-12.2), "-12% vs")
        XCTAssertEqual(SellerCompare.percentText(0.2), "in line with")
        XCTAssertEqual(SellerCompare.pointsText(-11.53), "-12 pts vs")
        XCTAssertNil(SellerCompare.percentText(nil))
        XCTAssertEqual(SellerCompare.dollars(nil), "—")
        XCTAssertEqual(SellerCompare.rate(nil), "—")
        XCTAssertEqual(SellerCompare.rate(0.8274), "83%")
    }

    func testBaTImageQueryIsReplacedBySizedRequest() {
        let url = SellerCompare.imageURL("https://bringatrailer.com/wp-content/uploads/2026/09/a.jpg?w=470&h=318&crop=1", width: 480)
        XCTAssertEqual(url?.absoluteString, "https://bringatrailer.com/wp-content/uploads/2026/09/a.jpg?w=480")
        XCTAssertNil(SellerCompare.imageURL(nil, width: 480))
        XCTAssertNil(SellerCompare.imageURL("", width: 480))
    }
}
