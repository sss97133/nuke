// SyncLandingTests.swift — every own-camera frame lands; only what goes up changes with where it was
// taken. From 2026-11-04 the owner's phone sent nothing while he was more than 25 km from his three
// sites: the site gate threw every frame away on the phone.

import XCTest
@testable import NukeCapture

final class SyncLandingTests: XCTestCase {
    private func land(_ p: SyncEngine.Placement, hold: Bool = false, eligible: Bool, vehicle: Bool) -> SyncEngine.Landing {
        SyncEngine.landing(placement: p, contributorHold: hold, pixelsEligible: eligible, isVehicle: vehicle)
    }

    func testAtSiteWorkFrameUploadsPixels() {
        XCTAssertEqual(land(.atSite, eligible: true, vehicle: false), .init(pixels: true, coarsePlace: false))
    }

    func testOffSiteVehicleUploadsPixels() {
        XCTAssertEqual(land(.offSite, eligible: true, vehicle: true), .init(pixels: true, coarsePlace: false))
        XCTAssertEqual(land(.noLocation, eligible: true, vehicle: true), .init(pixels: true, coarsePlace: false))
    }

    func testOffSiteNonVehicleLandsTimeAndRoughPlaceOnly() {
        XCTAssertEqual(land(.offSite, eligible: true, vehicle: false), .init(pixels: false, coarsePlace: true))
        XCTAssertEqual(land(.offSite, eligible: false, vehicle: true), .init(pixels: false, coarsePlace: true))
    }

    func testNoLocationNonVehicleLandsTimeOnly() {
        XCTAssertEqual(land(.noLocation, eligible: true, vehicle: false), .init(pixels: false, coarsePlace: false))
    }

    func testPersonalFrameAtSiteKeepsPixelsOnPhone() {
        XCTAssertEqual(land(.atSite, eligible: false, vehicle: false), .init(pixels: false, coarsePlace: false))
    }

    func testContributorHoldNeverSendsPixels() {
        XCTAssertFalse(land(.atSite, hold: true, eligible: true, vehicle: true).pixels)
        XCTAssertEqual(land(.offSite, hold: true, eligible: true, vehicle: true), .init(pixels: false, coarsePlace: true))
    }

    func testCoarseRoundsToAboutAKilometre() {
        XCTAssertEqual(SyncEngine.coarse(36.123456), 36.12)
        XCTAssertEqual(SyncEngine.coarse(-115.178901), -115.18)
        XCTAssertNil(SyncEngine.coarse(nil))
    }
}
