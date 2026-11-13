// VehicleLocationTests.swift — the vehicle page's "Where it's been" card decodes the area reader
// (vehicle_location_areas / get_field_provenance location_areas) and never invents a place.

import XCTest
@testable import NukeCapture

final class VehicleLocationTests: XCTestCase {
    private let cityArea = """
    {"city":"Boulder City","days":6,"zcta":null,"label":"Boulder City, NV","level":"city","photos":451,
     "centroid":{"lat":35.9787,"lng":-114.834,"basis":"city_centroid","source":"city_geocode_lookup"},
     "confidence":0.7,"county_fips":"32003","county_name":"Clark","region_code":"NV",
     "last_taken_at":"2026-11-02T19:25:16+00:00","first_taken_at":"2025-10-06T16:53:09.259+00:00",
     "observation_ids":["d4c81bbd-ad34-ec63-0b2b-d0ff8a31b9cb"]}
    """

    private func decode(_ json: String) throws -> VehicleLocationArea {
        try JSONDecoder().decode(VehicleLocationArea.self, from: Data(json.utf8))
    }

    func testCityAreaMarksItsCentroid() throws {
        let a = try decode(cityArea)
        XCTAssertEqual(a.mark?.latitude ?? 0, 35.9787, accuracy: 1e-6)
        XCTAssertNil(a.point)
        XCTAssertEqual(VehicleLocationCard.title(a), "Boulder City, NV")
        XCTAssertTrue(a.summary.hasPrefix("451 photos over 6 days, "))
        XCTAssertTrue(a.summary.contains("Oct 2025"))
    }

    func testOwnerPointWinsOverCentroid() throws {
        let json = cityArea.replacingOccurrences(of: "\"zcta\":null", with: "\"zcta\":\"89005\",\"point\":{\"lat\":35.97,\"lng\":-114.83,\"photos\":451}")
        let a = try decode(json)
        XCTAssertEqual(a.mark?.latitude ?? 0, 35.97, accuracy: 1e-6)
        XCTAssertEqual(VehicleLocationCard.title(a), "Boulder City, NV · 89005")
    }

    func testCountyAreaHasNoMarkAndNamesTheCounty() throws {
        let a = try decode("""
        {"label":null,"level":"county","county_fips":"32003","county_name":"Clark","region_code":"NV","photos":3,"days":1,"centroid":null}
        """)
        XCTAssertNil(a.mark)
        XCTAssertEqual(VehicleLocationCard.title(a), "Clark County, NV")
        XCTAssertEqual(a.summary, "3 photos over 1 day")
    }

    func testSameLabelDifferentZIPAreDistinct() throws {
        let a = try decode(cityArea)
        let b = try decode(cityArea.replacingOccurrences(of: "\"zcta\":null", with: "\"zcta\":\"89005\""))
        XCTAssertNotEqual(a.id, b.id)
    }
}
