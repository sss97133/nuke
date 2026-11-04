// VideoCaptureMatcherTests.swift — which videos may leave the phone at all.
// Owner scope (2026-11-04): no bulk video sync. A clip is picked up only inside an existing vehicle
// capture context; everything else stays on the phone and never uploads.

import XCTest
@testable import NukeCapture

final class VideoCaptureMatcherTests: XCTestCase {
    private var utc: Calendar {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "UTC")!
        return c
    }
    private let t0 = Date(timeIntervalSince1970: 1_790_000_000)
    private let lat = 35.977, lon = -114.854

    private func camera(duration: TimeInterval = 40) -> VideoCandidate {
        VideoCandidate(assetKey: "k", kind: .cameraVideo, startedAt: t0, duration: duration, latitude: lat, longitude: lon)
    }
    private func screen(at start: Date, duration: TimeInterval = 90) -> VideoCandidate {
        VideoCandidate(assetKey: "s", kind: .screenRecording, startedAt: start, duration: duration, latitude: nil, longitude: nil)
    }
    private func photo(_ vehicle: String = "V1", offset: TimeInterval = 0, dLat: Double = 0) -> FiledPhotoAnchor {
        FiledPhotoAnchor(vehicleID: vehicle, takenAt: t0.addingTimeInterval(offset), latitude: lat + dLat, longitude: lon)
    }

    // ─── Camera video: filed photo, 30 min, 150 m ────────────────────────────

    func testCameraVideoMatchesAFiledPhotoInTimeAndPlace() {
        let m = VideoCaptureMatcher.evaluate(camera(), photos: [photo(offset: -600)], acquisitions: [], calendar: utc)
        XCTAssertEqual(m, .matched(vehicleID: "V1", rule: .filedPhotoTimeAndPlace, anchors: 1))
    }

    func testTimeWindowIsThirtyMinutesEitherSideOfTheClip() {
        let clipEnd: TimeInterval = 40
        // 30 min before the start and 30 min after the END both count; a minute further does not.
        XCTAssertNotNil(VideoCaptureMatcher.evaluate(camera(), photos: [photo(offset: -1800)], acquisitions: [], calendar: utc).vehicleID)
        XCTAssertNotNil(VideoCaptureMatcher.evaluate(camera(), photos: [photo(offset: clipEnd + 1800)], acquisitions: [], calendar: utc).vehicleID)
        XCTAssertEqual(VideoCaptureMatcher.evaluate(camera(), photos: [photo(offset: -1861)], acquisitions: [], calendar: utc),
                       .unmatched(.noFiledPhotoNearby))
        XCTAssertEqual(VideoCaptureMatcher.evaluate(camera(), photos: [photo(offset: clipEnd + 1801)], acquisitions: [], calendar: utc),
                       .unmatched(.noFiledPhotoNearby))
    }

    func testRadiusIsOneHundredFiftyMeters() {
        // 0.001 degrees of latitude is about 111 m; 0.002 is about 222 m.
        XCTAssertNotNil(VideoCaptureMatcher.evaluate(camera(), photos: [photo(dLat: 0.001)], acquisitions: [], calendar: utc).vehicleID)
        XCTAssertEqual(VideoCaptureMatcher.evaluate(camera(), photos: [photo(dLat: 0.002)], acquisitions: [], calendar: utc),
                       .unmatched(.noFiledPhotoNearby))
    }

    func testCameraVideoWithoutGPSNeverMatches() {
        let v = VideoCandidate(assetKey: "k", kind: .cameraVideo, startedAt: t0, duration: 40, latitude: nil, longitude: nil)
        XCTAssertEqual(VideoCaptureMatcher.evaluate(v, photos: [photo()], acquisitions: [], calendar: utc), .unmatched(.noLocation))
    }

    func testTwoVehiclesNearTheClipIsAmbiguousSoItStaysOnThePhone() {
        let m = VideoCaptureMatcher.evaluate(camera(), photos: [photo("V1"), photo("V2")], acquisitions: [], calendar: utc)
        XCTAssertEqual(m, .unmatched(.ambiguousVehicles))
    }

    func testNoFiledPhotosMeansNoMatch() {
        XCTAssertEqual(VideoCaptureMatcher.evaluate(camera(), photos: [], acquisitions: [], calendar: utc), .unmatched(.noFiledPhotoNearby))
    }

    func testAnAcquisitionDateDoesNotMatchACameraVideo() {
        let a = AcquisitionAnchor(vehicleID: "V1", purchaseDay: t0)
        XCTAssertEqual(VideoCaptureMatcher.evaluate(camera(), photos: [], acquisitions: [a], calendar: utc), .unmatched(.noFiledPhotoNearby))
    }

    // ─── Screen recording: acquisition window ────────────────────────────────

    func testScreenRecordingMatchesInsideTheAcquisitionWindow() {
        let day = Date(timeIntervalSince1970: 1_790_000_000)       // the purchase day
        let a = AcquisitionAnchor(vehicleID: "V1", purchaseDay: day)
        let during = day.addingTimeInterval(-3 * 86_400)
        XCTAssertEqual(VideoCaptureMatcher.evaluate(screen(at: during), photos: [], acquisitions: [a], calendar: utc),
                       .matched(vehicleID: "V1", rule: .acquisitionWindow, anchors: 1))
    }

    func testAcquisitionWindowIsSevenDaysBeforeThroughTwoDaysAfter() {
        let day = utc.startOfDay(for: Date(timeIntervalSince1970: 1_790_000_000))
        let w = VideoCaptureMatcher.acquisitionWindow(purchaseDay: day.addingTimeInterval(3600), calendar: utc)
        XCTAssertEqual(w.lowerBound, day.addingTimeInterval(-7 * 86_400))
        XCTAssertEqual(w.upperBound, day.addingTimeInterval(3 * 86_400), "end of the second day after the purchase day")
        let a = AcquisitionAnchor(vehicleID: "V1", purchaseDay: day)
        XCTAssertNotNil(VideoCaptureMatcher.evaluate(screen(at: w.lowerBound), photos: [], acquisitions: [a], calendar: utc).vehicleID)
        XCTAssertEqual(VideoCaptureMatcher.evaluate(screen(at: w.lowerBound.addingTimeInterval(-1)), photos: [], acquisitions: [a], calendar: utc),
                       .unmatched(.outsideAcquisitionWindow))
        XCTAssertNotNil(VideoCaptureMatcher.evaluate(screen(at: w.upperBound.addingTimeInterval(-1)), photos: [], acquisitions: [a], calendar: utc).vehicleID)
        XCTAssertEqual(VideoCaptureMatcher.evaluate(screen(at: w.upperBound), photos: [], acquisitions: [a], calendar: utc),
                       .unmatched(.outsideAcquisitionWindow))
    }

    func testScreenRecordingWithNoVehicleStaysOnThePhone() {
        XCTAssertEqual(VideoCaptureMatcher.evaluate(screen(at: t0), photos: [photo()], acquisitions: [], calendar: utc),
                       .unmatched(.outsideAcquisitionWindow), "filed photos alone never match a screen recording")
    }

    func testOverlappingAcquisitionWindowsAreAmbiguous() {
        let a = AcquisitionAnchor(vehicleID: "V1", purchaseDay: t0)
        let b = AcquisitionAnchor(vehicleID: "V2", purchaseDay: t0.addingTimeInterval(86_400))
        XCTAssertEqual(VideoCaptureMatcher.evaluate(screen(at: t0), photos: [], acquisitions: [a, b], calendar: utc),
                       .unmatched(.ambiguousVehicles))
    }

    // ─── Both kinds ──────────────────────────────────────────────────────────

    func testLongOrEmptyClipsNeverMatch() {
        XCTAssertEqual(VideoCaptureMatcher.evaluate(camera(duration: 601), photos: [photo()], acquisitions: [], calendar: utc), .unmatched(.badDuration))
        XCTAssertEqual(VideoCaptureMatcher.evaluate(camera(duration: 0), photos: [photo()], acquisitions: [], calendar: utc), .unmatched(.badDuration))
        let a = AcquisitionAnchor(vehicleID: "V1", purchaseDay: t0)
        XCTAssertEqual(VideoCaptureMatcher.evaluate(screen(at: t0, duration: 900), photos: [], acquisitions: [a], calendar: utc), .unmatched(.badDuration))
    }

    func testDistanceIsHaversine() {
        XCTAssertEqual(VideoCaptureMatcher.distanceMeters(0, 0, 0, 0), 0, accuracy: 0.001)
        XCTAssertEqual(VideoCaptureMatcher.distanceMeters(35.0, -114.0, 35.001, -114.0), 111.2, accuracy: 1.0)
    }

    // ─── Screenshots ─────────────────────────────────────────────────────────

    private func shot(_ start: Date? = nil, lat: Double? = nil, lon: Double? = nil) -> VideoCandidate {
        VideoCandidate(assetKey: "ss", kind: .screenshot, startedAt: start ?? t0, duration: 0, latitude: lat, longitude: lon)
    }

    func testAScreenshotWithoutGPSMatchesAFiledPhotoByTimeAlone() {
        let m = VideoCaptureMatcher.evaluate(shot(), photos: [photo(offset: -1500)], acquisitions: [], calendar: utc)
        XCTAssertEqual(m, .matched(vehicleID: "V1", rule: .filedPhotoTime, anchors: 1))
    }

    func testAScreenshotIsNotSubjectToTheClipDurationBounds() {
        XCTAssertNotEqual(VideoCaptureMatcher.evaluate(shot(), photos: [photo()], acquisitions: [], calendar: utc),
                          .unmatched(.badDuration))
    }

    func testAScreenshotWithGPSMustBeWithinOneHundredFiftyMeters() {
        XCTAssertEqual(VideoCaptureMatcher.evaluate(shot(lat: lat, lon: lon), photos: [photo(dLat: 0.001)], acquisitions: [], calendar: utc),
                       .matched(vehicleID: "V1", rule: .filedPhotoTimeAndPlace, anchors: 1))
        XCTAssertEqual(VideoCaptureMatcher.evaluate(shot(lat: lat, lon: lon), photos: [photo(dLat: 0.002)], acquisitions: [], calendar: utc),
                       .unmatched(.noFiledPhotoNearby))
    }

    func testAScreenshotOutsideThirtyMinutesOfAFiledPhotoStaysOnThePhone() {
        XCTAssertEqual(VideoCaptureMatcher.evaluate(shot(), photos: [photo(offset: -1801)], acquisitions: [], calendar: utc),
                       .unmatched(.noFiledPhotoNearby))
        XCTAssertEqual(VideoCaptureMatcher.evaluate(shot(), photos: [photo(offset: 1801)], acquisitions: [], calendar: utc),
                       .unmatched(.noFiledPhotoNearby))
        XCTAssertNotNil(VideoCaptureMatcher.evaluate(shot(), photos: [photo(offset: 1800)], acquisitions: [], calendar: utc).vehicleID)
    }

    func testAScreenshotMatchesTheAcquisitionWindowToo() {
        let a = AcquisitionAnchor(vehicleID: "V9", purchaseDay: t0)
        XCTAssertEqual(VideoCaptureMatcher.evaluate(shot(t0.addingTimeInterval(-2 * 86_400)), photos: [], acquisitions: [a], calendar: utc),
                       .matched(vehicleID: "V9", rule: .acquisitionWindow, anchors: 1))
        XCTAssertEqual(VideoCaptureMatcher.evaluate(shot(t0.addingTimeInterval(-9 * 86_400)), photos: [], acquisitions: [a], calendar: utc),
                       .unmatched(.noFiledPhotoNearby))
    }

    func testAScreenshotNearTwoVehiclesIsAmbiguous() {
        XCTAssertEqual(VideoCaptureMatcher.evaluate(shot(), photos: [photo("V1"), photo("V2")], acquisitions: [], calendar: utc),
                       .unmatched(.ambiguousVehicles))
    }

    func testAnUnrelatedScreenshotMatchesNothing() {
        XCTAssertEqual(VideoCaptureMatcher.evaluate(shot(), photos: [], acquisitions: [], calendar: utc),
                       .unmatched(.noFiledPhotoNearby))
    }
}
