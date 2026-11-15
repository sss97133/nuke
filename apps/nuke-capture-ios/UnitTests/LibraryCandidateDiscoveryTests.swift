import XCTest
@testable import NukeCapture

final class LibraryCandidateDiscoveryTests: XCTestCase {
    private func asset(_ id: String, _ time: String, labels: [String] = [],
                       exact: [String] = [], lat: Double? = nil, lon: Double? = nil) -> LibraryCandidateDiscovery.Asset {
        .init(id: id, sourceVersion: "v1", captureAt: time, latitude: lat, longitude: lon,
              labels: labels, exactVehicleIds: exact, reviewSourceVersion: "v1")
    }

    func testMissingGPSWorkSequenceAndDifferentCarStaySeparate() {
        let assets = [
            asset("hood", "2025-05-13T17:47:00Z", labels: ["hood"], exact: ["firebird"], lat: 35.97, lon: -114.85),
            asset("decal-start", "2025-05-13T21:34:00Z", labels: ["paint"], lat: 35.97, lon: -114.85),
            asset("transfer", "2025-05-13T21:40:00Z", labels: ["paper"]),
            asset("finished", "2025-05-13T23:01:00Z", labels: ["decal"]),
            asset("other-car", "2025-05-13T21:35:00Z", labels: ["car"], exact: ["mustang"], lat: 35.97, lon: -114.85),
        ]
        let output = LibraryCandidateDiscovery.discover(.init(assets: assets, targetVehicleId: "firebird",
            timeZoneIdentifier: "America/Los_Angeles"))
        XCTAssertEqual(Set(output.candidates.map(\.id)), Set(assets.map(\.id)))
        XCTAssertTrue(output.candidates.first { $0.id == "transfer" }!.reasons.contains(.missingGPS))
        XCTAssertEqual(output.candidates.first { $0.id == "other-car" }!.conflictingVehicleIds, ["mustang"])
        XCTAssertTrue(output.candidates.allSatisfy(\.needsReview))
    }

    func testSameTimestampKeepsDistinctSourcesAndWithdrawalRemovesOnlyOne() {
        let timestamp = "2025-05-13T21:40:00Z"
        let anchor = asset("seed", timestamp, exact: ["firebird"])
        let first = asset("transfer-A", timestamp)
        let second = asset("transfer-B", timestamp)
        let input = LibraryCandidateDiscovery.Input(assets: [anchor, first, second], targetVehicleId: "firebird",
            timeZoneIdentifier: "UTC")
        let result = LibraryCandidateDiscovery.discover(input)
        XCTAssertEqual(Set(result.candidates.map(\.id)), ["seed", "transfer-A", "transfer-B"])
        XCTAssertEqual(result.candidates, LibraryCandidateDiscovery.discover(input).candidates)
        let withdrawn = LibraryCandidateDiscovery.discover(.init(assets: [anchor, second],
            targetVehicleId: "firebird", timeZoneIdentifier: "UTC"))
        XCTAssertFalse(withdrawn.unplaced.contains { $0.id == "transfer-A" })
        XCTAssertTrue(withdrawn.candidates.contains { $0.id == "transfer-B" })
    }

    func testUnreadHistoricalAssociationsRemainControlsButDoNotAnchor() {
        var old = asset("old", "2025-05-13T21:40:00Z")
        old.recordedVehicleIds = ["mustang", "firebird"]
        let neighbor = asset("neighbor", "2025-05-13T21:41:00Z")
        let result = LibraryCandidateDiscovery.discover(.init(assets: [old, neighbor],
            targetVehicleId: "firebird", timeZoneIdentifier: "UTC"))
        XCTAssertEqual(result.anchors, 0)
        XCTAssertTrue(result.candidates.isEmpty)
        let control = result.unplaced.first { $0.id == "old" }!
        XCTAssertTrue(control.reasons.contains(.existingBinding))
        XCTAssertTrue(control.reasons.contains(.conflictingIdentity))
        XCTAssertEqual(control.conflictingVehicleIds, ["mustang"])
        XCTAssertEqual(result.unplaced.count, 2)
        let untargeted = LibraryCandidateDiscovery.discover(.init(assets: [old],
            targetVehicleId: "", timeZoneIdentifier: "UTC"))
        XCTAssertEqual(untargeted.unplaced[0].conflictingVehicleIds, ["firebird", "mustang"])
    }

    func testUntargetedMultipleExactSerialMatchesRemainAmbiguous() {
        let ambiguous = asset("serial", "2025-05-13T21:40:00Z", labels: ["car"], exact: ["car-b", "car-a"])
        let result = LibraryCandidateDiscovery.discover(.init(assets: [ambiguous], targetVehicleId: "",
            timeZoneIdentifier: "UTC"))
        let control = result.unplaced[0]
        XCTAssertEqual(control.conflictingVehicleIds, ["car-a", "car-b"])
        XCTAssertTrue(control.reasons.contains(.conflictingIdentity))
        XCTAssertTrue(control.reasons.contains(.exactSerial))
        XCTAssertEqual(result.workPool[0].conflictingVehicleIds, ["car-a", "car-b"])
    }

    func testCheapBadgeCountMatchesSelectionWithStaleReview() {
        var stale = asset("stale", "2025-05-13T21:40:00Z", labels: ["hood"])
        stale.reviewSourceVersion = "older"
        var personal = asset("personal", "2025-05-13T21:41:00Z", labels: ["car"])
        personal.isPersonal = true
        let current = asset("current", "2025-05-13T21:42:00Z", labels: ["decal"])
        let assets = [stale, personal, current]
        let selected = LibraryCandidateDiscovery.discover(.init(assets: assets,
            targetVehicleId: "", timeZoneIdentifier: "UTC"))
        XCTAssertEqual(LibraryCandidateDiscovery.workPoolCount(assets), selected.workPool.count)
        XCTAssertEqual(selected.workPool.map(\.id), ["current"])
    }
}
