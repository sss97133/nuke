// MapLiveActivityTests.swift — the pieces that make the Explore map feel live and fast: the default 7-day window,
// map_zip_activity decoding and the last-24h fold, viewport snapping (small pans must not re-project), and the
// on-device ZIP polygon cache. Missing data must stay missing: no row means no activity, never an invented count.

import MapKit
import XCTest
@testable import NukeCapture

final class MapLiveActivityTests: XCTestCase {
    private func utc(_ y: Int, _ m: Int, _ d: Int, _ h: Int = 0) -> Date {
        var parts = DateComponents(); parts.year = y; parts.month = m; parts.day = d; parts.hour = h
        return AuctionLocationClock.calendar.date(from: parts)!
    }

    // MARK: windows

    func testLastSevenDaysCoversTodayAndSixPriorUTCDays() {
        let window = MapObservationWindow.lastDays(7, now: utc(2026, 11, 1, 22))
        XCTAssertEqual(window.start, utc(2026, 10, 26))
        XCTAssertEqual(window.end, utc(2026, 11, 2))   // exclusive: all of Nov 1 is inside
        XCTAssertTrue(window.isServerEligible)
        XCTAssertEqual(MapObservationWindow.lastDays(7).displayLabel, "Last 7 days")
        XCTAssertEqual(MapObservationWindow.lastDays(30).displayLabel, "Last 30 days")
        XCTAssertEqual(MapObservationWindow.all.displayLabel, "All time")
    }

    func testWindowEligibilityAndKeys() {
        XCTAssertFalse(MapObservationWindow.all.isServerEligible)
        XCTAssertEqual(MapObservationWindow.all.cacheKey, "all")
        let long = MapObservationWindow(start: utc(2026, 1, 1), end: utc(2026, 11, 1))
        XCTAssertFalse(long.isServerEligible, "windows past 90 days keep the raw-row path")
        let inverted = MapObservationWindow(start: utc(2026, 11, 2), end: utc(2026, 11, 1))
        XCTAssertFalse(inverted.isServerEligible)
        let a = MapObservationWindow.lastDays(7, now: utc(2026, 11, 1))
        let b = MapObservationWindow.lastDays(7, now: utc(2026, 11, 2))
        XCTAssertNotEqual(a.cacheKey, b.cacheKey, "a new UTC day is a different window")
        XCTAssertEqual(a.cacheKey, MapObservationWindow.lastDays(7, now: utc(2026, 11, 1, 17)).cacheKey)
    }

    // MARK: rows and fold

    private func row(_ zip: String, county: String? = "32003", make: String? = "Porsche",
                     windowed: Int = 0, sold: Int = 0, listed: Int = 0) -> ZIPActivityRow {
        ZIPActivityRow(county_fips: county, zip: zip, make: make, windowed: windowed,
                       sold_24h: sold, listed_24h: listed, fresh_24h: sold + listed)
    }

    func testActivityRowDecodesAndMapsToCountRow() throws {
        let json = """
        [{"county_fips":"32003","zip":"89005","make":"Porsche","windowed":4,"sold_24h":1,"listed_24h":2,"fresh_24h":3},
         {"county_fips":null,"zip":"89101","make":null,"windowed":0,"sold_24h":0,"listed_24h":0,"fresh_24h":0}]
        """
        let rows = try JSONDecoder().decode([ZIPActivityRow].self, from: Data(json.utf8))
        XCTAssertEqual(rows.count, 2)
        XCTAssertEqual(rows[0].countRow, ZIPCountRow(county_fips: "32003", zip: "89005", make: "Porsche", vehicles: 4))
        XCTAssertNil(rows[1].make)
    }

    func testFoldCountsOnlyVisibleZIPsInTheirPartition() {
        let rows = [row("89005", sold: 1, listed: 2), row("89005", make: "Ford", listed: 1),
                    row("89101", sold: 4), row("89999", sold: 9)]
        let crosswalk = ["89005": "32003", "89101": "32003", "89999": "32003"]
        let result = LiveActivityFold.fold(rows, make: nil, crosswalk: crosswalk,
                                           countyZIPs: ["32003": ["89005", "89101", "89999"]], visible: ["89005", "89101"])
        XCTAssertEqual(result.byZIP["89005"], LiveActivity(fresh: 4, sold: 1, listed: 3))
        XCTAssertEqual(result.byZIP["89101"], LiveActivity(fresh: 4, sold: 4, listed: 0))
        XCTAssertNil(result.byZIP["89999"], "off-screen ZIPs are not counted")
        XCTAssertEqual(result.total, LiveActivity(fresh: 8, sold: 5, listed: 3))
    }

    func testFoldAppliesMakeFilterAndMembershipGuard() {
        let rows = [row("89005", sold: 2), row("89005", make: "Ford", listed: 3), row("89005", county: "06037", sold: 7)]
        let crosswalk = ["89005": "32003"]
        let ford = LiveActivityFold.fold(rows, make: " ford ", crosswalk: crosswalk,
                                         countyZIPs: ["32003": ["89005"], "06037": []], visible: ["89005"])
        XCTAssertEqual(ford.total, LiveActivity(fresh: 3, sold: 0, listed: 3))
        let all = LiveActivityFold.fold(rows, make: nil, crosswalk: crosswalk,
                                        countyZIPs: ["32003": ["89005"], "06037": []], visible: ["89005"])
        XCTAssertEqual(all.total.fresh, 5, "a partition whose ZCTA list lacks the ZIP does not add to it")
    }

    func testFoldWithNoRowsIsAnHonestZero() {
        let result = LiveActivityFold.fold([row("89005", windowed: 3)], make: nil, crosswalk: ["89005": "32003"],
                                           countyZIPs: [:], visible: ["89005"])
        XCTAssertEqual(result.total, LiveActivity())
        XCTAssertTrue(result.byZIP.isEmpty, "windowed-only rows are not 'new today'")
    }

    // MARK: viewport snapping

    private func rect(_ x: Double, _ y: Double, _ w: Double, _ h: Double) -> MKMapRect { MKMapRect(x: x, y: y, width: w, height: h) }

    func testSmallPanKeepsKeyButRealMoveAndZoomChangeIt() {
        let base = rect(1_000_000, 2_000_000, 400_000, 700_000)
        let tiny = rect(1_000_000 + 1_000, 2_000_000 + 1_000, 400_000, 700_000)
        XCTAssertEqual(ViewportSnap(base), ViewportSnap(tiny))
        let far = rect(1_000_000 + 900_000, 2_000_000, 400_000, 700_000)
        XCTAssertNotEqual(ViewportSnap(base), ViewportSnap(far))
        let zoomed = rect(1_000_000, 2_000_000, 100_000, 175_000)
        XCTAssertNotEqual(ViewportSnap(base), ViewportSnap(zoomed))
        XCTAssertNil(ViewportSnap(nil))
        XCTAssertNil(ViewportSnap(rect(0, 0, 0, 0)))
    }

    // MARK: polygon disk cache

    private func makeCache(maxFiles: Int = 80) -> ZIPPolygonDiskCache {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("zip-cache-\(UUID().uuidString)", isDirectory: true)
        var cache = ZIPPolygonDiskCache(directory: dir); cache.maxFiles = maxFiles
        addTeardownBlock { try? FileManager.default.removeItem(at: dir) }
        return cache
    }

    func testDiskCacheRoundTripsAndRejectsBadKeys() {
        let cache = makeCache()
        XCTAssertNil(cache.read("32003"))
        let payload = Data("{\"type\":\"FeatureCollection\",\"features\":[]}".utf8)
        cache.write(payload, fips: "32003")
        XCTAssertEqual(cache.read("32003"), payload)
        cache.write(payload, fips: "../etc")     // not a county code: ignored
        cache.write(Data(), fips: "06037")       // empty: ignored
        XCTAssertNil(cache.read("06037"))
        XCTAssertNil(cache.read("../etc"))
        cache.remove("32003")
        XCTAssertNil(cache.read("32003"))
    }

    func testDiskCacheKeepsOnlyTheNewestFiles() throws {
        let cache = makeCache(maxFiles: 2)
        for (index, fips) in ["01001", "01003", "01005"].enumerated() {
            cache.write(Data("x\(index)".utf8), fips: fips)
            let url = cache.directory.appendingPathComponent("\(fips).geojson")
            try FileManager.default.setAttributes([.modificationDate: Date(timeIntervalSince1970: Double(1_000 + index))], ofItemAtPath: url.path)
            cache.trim()
        }
        XCTAssertNil(cache.read("01001"), "oldest county is evicted")
        XCTAssertNotNil(cache.read("01003"))
        XCTAssertNotNil(cache.read("01005"))
    }

    func testPulseAnnotationDescribesRealCounts() {
        let pulse = ZIPPulseAnnotation(zip: "89005", coordinate: CLLocationCoordinate2D(latitude: 35.9, longitude: -114.9),
                                       fresh: 3, sold: 1, listed: 2)
        XCTAssertEqual(pulse.summary, "ZIP 89005: 3 new in the last 24 hours, 1 sold, 2 newly listed")
        XCTAssertNotEqual(pulse.key, ZIPPulseAnnotation(zip: "89005", coordinate: pulse.coordinate, fresh: 4, sold: 1, listed: 3).key)
    }
}
