// VideoCaptureMatcherTests.swift — time and GPS only NARROW a clip's candidate vehicles; they never attribute.
// Owner rule (2026-11-04): a clip is attributed by its frames' content (MediaAttributionGateTests), not here.

import XCTest
@testable import NukeCapture

final class VideoCaptureMatcherTests: XCTestCase {
    private let t0 = Date(timeIntervalSince1970: 1_790_000_000)
    private let lat = 35.977, lon = -114.854

    private func camera(duration: TimeInterval = 40, gps: Bool = true) -> VideoCandidate {
        VideoCandidate(assetKey: "k", kind: .cameraVideo, startedAt: t0, duration: duration,
                       latitude: gps ? lat : nil, longitude: gps ? lon : nil)
    }
    private func photo(_ vehicle: String = "V1", offset: TimeInterval = 0, dLat: Double = 0) -> FiledPhotoAnchor {
        FiledPhotoAnchor(vehicleID: vehicle, takenAt: t0.addingTimeInterval(offset), latitude: lat + dLat, longitude: lon)
    }

    func testAFiledPhotoNearbyMakesItsVehicleACandidateNotAMatch() {
        let n = VideoCaptureMatcher.narrow(camera(), photos: [photo(offset: -600)])
        XCTAssertEqual(n, .candidates(["V1"], anchors: 1))
        XCTAssertTrue(n.isReadable, "readable means frames may be read on the phone; it attributes nothing")
    }

    func testTimeWindowIsThirtyMinutesEitherSideOfTheClip() {
        let clipEnd: TimeInterval = 40
        XCTAssertTrue(VideoCaptureMatcher.narrow(camera(), photos: [photo(offset: -1800)]).isReadable)
        XCTAssertTrue(VideoCaptureMatcher.narrow(camera(), photos: [photo(offset: clipEnd + 1800)]).isReadable)
        XCTAssertEqual(VideoCaptureMatcher.narrow(camera(), photos: [photo(offset: -1801)]), .skip(.noFiledPhotoNearby))
        XCTAssertEqual(VideoCaptureMatcher.narrow(camera(), photos: [photo(offset: clipEnd + 1801)]), .skip(.noFiledPhotoNearby))
    }

    func testRadiusIsOneHundredFiftyMeters() {
        // 0.001 degrees of latitude is about 111 m; 0.002 is about 222 m.
        XCTAssertTrue(VideoCaptureMatcher.narrow(camera(), photos: [photo(dLat: 0.001)]).isReadable)
        XCTAssertEqual(VideoCaptureMatcher.narrow(camera(), photos: [photo(dLat: 0.002)]), .skip(.noFiledPhotoNearby))
    }

    func testSeveralVehiclesNearbyAreAllCandidatesAndTheFramesChoose() {
        let n = VideoCaptureMatcher.narrow(camera(), photos: [photo("V1"), photo("V2"), photo("V2", offset: 60)])
        XCTAssertEqual(n, .candidates(["V1", "V2"], anchors: 3))
    }

    func testNoGPSMeansNoCandidatesAndTheClipIsNotRead() {
        XCTAssertEqual(VideoCaptureMatcher.narrow(camera(gps: false), photos: [photo()]), .skip(.noLocation))
    }

    func testNoFiledPhotoMeansNoCandidatesAndTheClipIsNotRead() {
        XCTAssertEqual(VideoCaptureMatcher.narrow(camera(), photos: []), .skip(.noFiledPhotoNearby))
        XCTAssertTrue(VideoCaptureMatcher.narrow(camera(), photos: []).vehicleIDs.isEmpty)
    }

    func testScreenRecordingsAreNeverReadWhateverIsNearby() {
        let screen = VideoCandidate(assetKey: "s", kind: .screenRecording, startedAt: t0, duration: 90, latitude: lat, longitude: lon)
        XCTAssertEqual(VideoCaptureMatcher.narrow(screen, photos: [photo()]), .skip(.screenCapture))
    }

    func testVeryLongOrEmptyClipsAreNotRead() {
        XCTAssertEqual(VideoCaptureMatcher.narrow(camera(duration: 601), photos: [photo()]), .skip(.badDuration))
        XCTAssertEqual(VideoCaptureMatcher.narrow(camera(duration: 600), photos: [photo()]), .candidates(["V1"], anchors: 1))
        XCTAssertEqual(VideoCaptureMatcher.narrow(camera(duration: 0), photos: [photo()]), .skip(.badDuration))
    }

    func testDistanceIsHaversineMeters() {
        XCTAssertEqual(VideoCaptureMatcher.distanceMeters(0, 0, 0, 0), 0, accuracy: 0.001)
        XCTAssertEqual(VideoCaptureMatcher.distanceMeters(0, 0, 0.001, 0), 111.2, accuracy: 1)
    }
}
