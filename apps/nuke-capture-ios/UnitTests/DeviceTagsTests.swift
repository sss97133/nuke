import XCTest
@testable import NukeCapture

final class DeviceTagsTests: XCTestCase {
    private func row(_ labels: [String], person: Bool? = true) -> LocalStore.TagSyncRow {
        LocalStore.TagSyncRow(localIdentifier: "A/L0/001", labels: labels, isVehicle: true, isPersonal: false,
                              ownerVerdict: nil, hasPerson: person)
    }

    func testRecordCarriesTheFreeReadsAndTheModel() {
        let r = DeviceTags.record(row(["car", " Wheel ", "wheel", ""]), facts: nil, revision: 2, osVersion: "iOS 26.1.0")
        XCTAssertEqual(r.local_id, "A/L0/001")
        XCTAssertEqual(r.labels, ["car", "Wheel"])
        XCTAssertEqual(r.has_person, true)
        XCTAssertEqual(r.source, "apple_vision")
        XCTAssertEqual(r.model, "VNClassifyImageRequest")
        XCTAssertEqual(r.model_revision, 2)
        XCTAssertNil(r.photokit)
    }

    func testPhotoKitFactsRideAlong() {
        var f = DeviceAssetFacts()
        f.isScreenshot = true; f.burstId = "B1"; f.pixelWidth = 4032; f.pixelHeight = 3024
        f.takenAt = Date(timeIntervalSince1970: 0); f.latitude = 34.1; f.longitude = -118.3
        let pk = DeviceTags.record(row(["document"], person: nil), facts: f).photokit
        XCTAssertEqual(pk?.is_screenshot, true)
        XCTAssertEqual(pk?.burst_id, "B1")
        XCTAssertEqual(pk?.taken_at, "1970-01-01T00:00:00Z")
        XCTAssertEqual(pk?.latitude, 34.1)
    }

    func testLabelsAreCapped() {
        let r = DeviceTags.record(row((0..<100).map { "label\($0)" }), facts: nil)
        XCTAssertEqual(r.labels.count, 40)
    }

    func testFlagIsOffByDefault() {
        UserDefaults.standard.removeObject(forKey: DeviceTags.flagKey)
        XCTAssertFalse(DeviceTags.uploadEnabled)
    }
}
