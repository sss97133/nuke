// CandidateRoutingTests.swift — local-day keys, shoot segmentation, the hard constraint layer and
// the clear-margin rule behind candidate-set routing (CandidateRouting.swift).

import XCTest
@testable import NukeCapture

final class CandidateRoutingTests: XCTestCase {
    private let la = TimeZone(identifier: "America/Los_Angeles")!
    private func t(_ s: String) -> Date { LocalDay.parse(s)! }
    private func photo(_ id: String, _ time: String, lat: Double = 35.9730, lon: Double = -114.8550,
                       labels: [String] = ["machine", "engine_vehicle"], kind: PhotoKind = .work,
                       vin: String? = nil, filed: String? = nil) -> RoutingPhoto {
        RoutingPhoto(id: id, takenAt: t(time), latitude: lat, longitude: lon, labels: labels, kind: kind,
                     identifierVehicleID: vin, filedVehicleID: filed)
    }

    // MARK: local day

    func testLocalDayUsesLosAngelesNotUTC() {
        // 2026-06-14 01:30 UTC is still the evening of June 13 in the shop.
        XCTAssertEqual(LocalDay.key(taken: "2026-06-14T01:30:00Z", timeZone: la), "2026-06-13")
        XCTAssertEqual(LocalDay.key(taken: "2026-06-13T18:05:00.123Z", timeZone: la), "2026-06-13")
        XCTAssertEqual(LocalDay.key(taken: nil, timeZone: la), "nodate")
    }

    func testSessionKeyUsesLocalDay() {
        let key = AttributionEngine.sessionKey(takenAt: "2026-10-16T02:00:00Z", latitude: 35.97312, longitude: -114.85549, timeZone: la)
        XCTAssertEqual(key, "2026-10-15|35.973,-114.855")
    }

    // MARK: shoots

    func testShootSplitsOnGapAndMove() {
        let shoots = ShootSegmenter.segment([
            photo("a", "2026-10-15T17:00:00Z"),
            photo("b", "2026-10-15T17:15:00Z"),                         // 15 min: same shoot
            photo("c", "2026-10-15T17:40:00Z"),                         // 25 min gap: new shoot
            photo("d", "2026-10-15T17:41:00Z", lat: 35.9760),           // ~330 m away: new shoot
            RoutingPhoto(id: "undated", takenAt: nil, latitude: nil, longitude: nil),
        ])
        XCTAssertEqual(shoots.map { $0.map(\.id) }, [["a", "b"], ["c"], ["d"]])
    }

    // MARK: photo kind and body class

    func testNonVehiclePhotosAreDropped() {
        XCTAssertEqual(PhotoKind.of(labels: ["Outdoor", "Sky", "Blue Sky", "Palm Tree", "Plant"], isDocument: false), .outdoorOnly)
        XCTAssertEqual(PhotoKind.of(labels: ["People", "Adult", "Container", "Luggage", "Backpack"], isDocument: false), .people)
        XCTAssertEqual(PhotoKind.of(labels: ["Document", "Printed Page"], isDocument: false), .document)
        XCTAssertEqual(PhotoKind.of(labels: ["Material", "Textile", "Tool", "Knife"], isDocument: false), .work)
        XCTAssertEqual(PhotoKind.of(labels: ["Machine", "Wheel", "Tire"], isDocument: true), .document)
    }

    func testBodyClass() {
        XCTAssertEqual(BodyClass.ofLabels(["Machine", "Automobile", "Car", "Wheel"]), .unknown)   // trucks get "Car" too
        XCTAssertEqual(BodyClass.ofLabels(["Machine", "Vehicle", "Sportscar"]), .car)
        XCTAssertEqual(BodyClass.ofLabels(["Pickup Truck", "Wheel"]), .truck)
        XCTAssertEqual(BodyClass.ofVehicle(bodyStyle: "Pickup", model: "R3500 Cheyenne"), .truck)
        XCTAssertEqual(BodyClass.ofVehicle(bodyStyle: nil, model: "356C Karmann Coupe"), .car)
        XCTAssertEqual(BodyClass.ofVehicle(bodyStyle: nil, model: "Mustang"), .unknown)
    }

    // MARK: constraints

    func testConstraintsDenyAndAbstainWithCitations() {
        let truckPhoto = ConstraintSubject(at: nil, bodyClass: .truck, identifierBoundary: nil)
        XCTAssertEqual(BodyClassConstraint().evaluate(truckPhoto, RoutingCandidate(vehicleID: "mustang", bodyClass: .car)),
                       .deny("body_class truck≠car"))
        XCTAssertEqual(BodyClassConstraint().evaluate(truckPhoto, RoutingCandidate(vehicleID: "x")), .abstain("body_class_unknown"))
        XCTAssertEqual(PossessionConstraint().evaluate(truckPhoto, RoutingCandidate(vehicleID: "x", possession: .notHeld)),
                       .deny("not_held_at_moment"))
        XCTAssertEqual(PossessionConstraint().evaluate(truckPhoto, RoutingCandidate(vehicleID: "x", activeThatDay: true)),
                       .allow("activity_that_day"))
        let bounded = ConstraintSubject(at: nil, bodyClass: .unknown, identifierBoundary: ["k10"])
        XCTAssertEqual(ShootBoundaryConstraint().evaluate(bounded, RoutingCandidate(vehicleID: "mustang")),
                       .deny("shoot_anchored_to_other_vehicle"))
        XCTAssertTrue(ShootBoundaryConstraint().evaluate(bounded, RoutingCandidate(vehicleID: "k10")).citation.hasPrefix("allow:"))
        let (allowed, denied) = ConstraintLayer.filter(bounded, [RoutingCandidate(vehicleID: "k10"), RoutingCandidate(vehicleID: "mustang")])
        XCTAssertEqual(allowed.map(\.0.vehicleID), ["k10"])
        XCTAssertEqual(denied, ["mustang:deny:shoot_anchored_to_other_vehicle"])
    }

    func testIdentifierBoundaryIsNearestReadsEitherSide() {
        let shoot = [photo("v1", "2026-10-15T17:50:00Z", vin: "corvette"), photo("x", "2026-10-15T17:54:00Z"),
                     photo("v2", "2026-10-15T17:56:00Z", vin: "porsche"), photo("y", "2026-10-15T17:58:00Z")]
        XCTAssertEqual(CandidateRouter.identifierBoundary(for: shoot[1], in: shoot), ["corvette", "porsche"])
        XCTAssertEqual(CandidateRouter.identifierBoundary(for: shoot[3], in: shoot), ["porsche"])
        XCTAssertNil(CandidateRouter.identifierBoundary(for: shoot[1], in: [shoot[1]]))
    }

    // MARK: scoring and margin

    func testClearMarginWhenOneVehicleAnchorsTheShoot() {
        let shoot = [photo("vin", "2026-06-13T18:05:00Z", vin: "k10"), photo("close", "2026-06-13T18:07:00Z")]
        let d = CandidateRouter.decide(shoot[1], shoot: shoot, candidates: [
            RoutingCandidate(vehicleID: "k10", activeThatDay: true),
            RoutingCandidate(vehicleID: "r3500", recentAtLocation: true),   // locked out by the identifier boundary
        ])
        guard case .clear(let v, let c, let reasons) = d else { return XCTFail("expected clear, got \(d)") }
        XCTAssertEqual(v, "k10")
        XCTAssertGreaterThanOrEqual(c, 0.85)
        XCTAssertTrue(reasons.contains("denied r3500:deny:shoot_anchored_to_other_vehicle"))
        XCTAssertTrue(reasons.contains("clear_margin"))
    }

    func testContestedCloseUpGoesToReview() {
        // Between a Corvette read and a Porsche read two minutes either side: both allowed, no margin.
        let shoot = [photo("a", "2026-10-15T17:52:00Z", vin: "corvette"), photo("x", "2026-10-15T17:54:00Z"),
                     photo("b", "2026-10-15T17:56:00Z", vin: "porsche")]
        let d = CandidateRouter.decide(shoot[1], shoot: shoot, candidates: [
            RoutingCandidate(vehicleID: "corvette", activeThatDay: true), RoutingCandidate(vehicleID: "porsche", activeThatDay: true)])
        guard case .review(_, _, let reasons) = d else { return XCTFail("expected review, got \(d)") }
        XCTAssertTrue(reasons.contains("needs_review"))
    }

    func testBodyClassLocksOutTheMustangForATruckPhoto() {
        let shoot = [photo("f1", "2026-06-13T23:05:00Z", filed: "mustang"),
                     photo("p", "2026-06-13T23:09:00Z", labels: ["Pickup Truck", "Wheel"])]
        let d = CandidateRouter.decide(shoot[1], shoot: shoot, candidates: [
            RoutingCandidate(vehicleID: "mustang", bodyClass: .car, activeThatDay: true),
            RoutingCandidate(vehicleID: "r3500", bodyClass: .truck, activeThatDay: true)])
        XCTAssertEqual(d.lead?.0, "r3500")
        XCTAssertFalse(d.isClear)   // no anchor near the truck: a lead for review, not a filing
    }

    func testScenerySkippedAndPersistedRoutingIgnoresStrangers() {
        let s = photo("sky", "2026-06-14T00:44:00Z", labels: ["Outdoor", "Sky"], kind: .outdoorOnly)
        XCTAssertNil(CandidateRouter.decide(s, shoot: [s], candidates: [RoutingCandidate(vehicleID: "r3500")]).lead)

        let out = AttributionEngine.routeCloseUps(
            inputs: [.init(id: "close", takenAt: "2026-06-13T18:07:00Z", latitude: 35.973, longitude: -114.855,
                           labels: ["Machine", "Wheel"], isDocument: false, identifierVehicleID: nil),
                     .init(id: "vin", takenAt: "2026-06-13T18:05:00Z", latitude: 35.973, longitude: -114.855,
                           labels: ["Machine"], isDocument: false, identifierVehicleID: "k10")],
            filed: [.init(id: "old", vehicle_id: "someone-elses", taken_at: "2026-06-13T18:06:00Z", latitude: 35.973, longitude: -114.855)],
            bodyByVehicle: ["k10": .truck], albumVehicleByImage: [:], timeZone: la)
        XCTAssertEqual(out["close"]?.candidateCount, 2)
        XCTAssertEqual(out["close"]?.decision.lead?.0, "k10")
        XCTAssertTrue(out["close"]?.decision.isClear == true)
        XCTAssertNil(out["vin"])   // a photo with its own identifier is not routed here
    }
}
