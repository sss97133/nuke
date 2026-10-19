// ProviderPlaceTests.swift — the job's who-and-where card: a pin, Directions and Call only for a storefront the
// server located, city-level areas for everything else, people kept apart by Sign versus recorded row, and
// tracker steps on the trust ladder with testimony counted beside them.

import XCTest
@testable import NukeCapture

final class ProviderPlaceTests: XCTestCase {
    private func decode(_ json: String) throws -> JobProviderPlace {
        try JobReaders.decode(JobProviderPlace.self, from: Data(json.utf8))
    }

    func testLegacyJobReadsAtCityLevelWithNoPinDirectionsOrCall() throws {
        let r = try decode(ProviderPlaceFixtures.legacy)
        XCTAssertEqual(r.shop.state, "public")
        XCTAssertEqual(r.shop.name, "Fixture Collection")
        XCTAssertEqual(r.shop.organizationId, ProviderPlaceFixtures.orgId)
        XCTAssertEqual(ProviderPlaceCopy.kind(r.shop.entityType), "Collection")
        XCTAssertEqual(ProviderPlaceCopy.rating(r.shop.rating), "Not rated")
        XCTAssertFalse(r.shop.hoursRecorded)
        XCTAssertEqual(r.shop.place?.precision, "city")
        XCTAssertNil(r.shop.place?.pin)
        XCTAssertEqual(ProviderPlaceCopy.placeLine(r.shop.place), "Reno, Nevada")
        XCTAssertEqual(ProviderPlaceCopy.precision(r.shop.place), "City-level · approximate")
        XCTAssertNil(ProviderPlaceCopy.directionsURL(r.shop.place, name: r.shop.name))
        XCTAssertNil(ProviderPlaceCopy.phoneURL(r.shop.place))
        XCTAssertEqual(ProviderPlaceCopy.workSite(r), "Not recorded")
        XCTAssertEqual(r.vehiclePlace?.cityLine, "Sparks, NV")
        XCTAssertEqual(JobPlaceMap.areas(for: r), [JobPlaceMap.Area(city: "Reno, Nevada", radiusMeters: 8_000, label: "shop city")])
    }

    func testRecordedAssignmentPeopleAreUnnamedAndNotSigned() throws {
        let r = try decode(ProviderPlaceFixtures.legacy)
        XCTAssertTrue(r.acceptedProviders.isEmpty)
        XCTAssertEqual(r.recordedPeople.count, 3)
        XCTAssertEqual(Set(r.recordedPeople.map(\.id)).count, 3)                       // identical rows stay distinct
        XCTAssertTrue(r.recordedPeople.allSatisfy { !$0.signed && $0.person.text == "Unnamed party" && $0.person.profileId == nil })
        XCTAssertEqual(ProviderPlaceCopy.role(r.recordedPeople[2]), "Lead · recorded assignment")
        XCTAssertEqual(ProviderPlaceCopy.statuses(r.recordedPeople[2].statuses), "completed 1 · in progress 5 · pending 1")
        XCTAssertNil(ProviderPlaceCopy.band(r.recordedPeople[0].serviceArea))          // not assessed says nothing
    }

    func testLegacyTrackerKeepsEvidenceAndTestimonyApart() throws {
        let r = try decode(ProviderPlaceFixtures.legacy)
        XCTAssertEqual(r.steps.map(\.key), ["requested", "quoted", "accepted", "in_progress", "done", "paid"])
        XCTAssertEqual(r.currentStep, "in_progress")
        let s = Dictionary(uniqueKeysWithValues: r.steps.map { ($0.key, $0) })
        XCTAssertEqual(ProviderPlaceCopy.rung(s["requested"]!), .attributed)
        XCTAssertEqual(ProviderPlaceCopy.rung(s["quoted"]!), .pending)
        XCTAssertEqual(ProviderPlaceCopy.rung(s["accepted"]!), .conflicting)
        XCTAssertEqual(ProviderPlaceCopy.rung(s["in_progress"]!), .attributed)
        XCTAssertEqual(ProviderPlaceCopy.rung(s["done"]!), .conflicting)
        XCTAssertNil(ProviderPlaceCopy.rung(s["paid"]!))
        XCTAssertEqual(s["accepted"]!.state, .statusOnly)
        XCTAssertEqual(ProviderPlaceCopy.stepState(s["accepted"]!), "Marked, nothing behind it")
        XCTAssertEqual(s["accepted"]!.reports, 3)
        XCTAssertEqual(s["done"]!.state, .notYet)                                        // three messages never fill Done
        XCTAssertEqual(ProviderPlaceCopy.reports(s["done"]!.reports), "3 messages say so — not signed")
        XCTAssertFalse(JobProgressTracker.filled(s["done"]!))
        XCTAssertEqual(ProviderPlaceCopy.stepState(s["in_progress"]!), "Recorded, not verified")
        XCTAssertEqual(ProviderPlaceCopy.stepState(s["paid"]!), "Shown to the people on this job")
        XCTAssertEqual(JobProgressTracker.symbol(s["paid"]!), "lock.circle")
        XCTAssertNil(ProviderPlaceCopy.reports(0))
    }

    func testStorefrontGetsPinDirectionsAndCall() throws {
        let r = try decode(ProviderPlaceFixtures.storefront)
        let place = try XCTUnwrap(r.shop.place)
        XCTAssertEqual(place.pin?.latitude, 39.52)
        XCTAssertEqual(place.pin?.longitude, -119.81)
        XCTAssertEqual(ProviderPlaceCopy.placeLine(place), "1 Fixture Way, Reno, NV, 89501")
        XCTAssertEqual(ProviderPlaceCopy.precision(place), "Business location on record")
        let directions = try XCTUnwrap(ProviderPlaceCopy.directionsURL(place, name: r.shop.name))
        XCTAssertEqual(directions.host, "maps.apple.com")
        let items = URLComponents(url: directions, resolvingAgainstBaseURL: false)?.queryItems ?? []
        XCTAssertEqual(items.first { $0.name == "daddr" }?.value, "39.52,-119.81")
        XCTAssertEqual(items.first { $0.name == "q" }?.value, "Fixture Garage")
        XCTAssertEqual(ProviderPlaceCopy.phoneURL(place)?.absoluteString, "tel:+15550199000")
        XCTAssertTrue(r.shop.hoursRecorded)
        XCTAssertEqual(r.shop.hours.map(\.key), ["mon-fri", "sun"])
        XCTAssertEqual(r.shop.hours.map(\.value), ["8am-5pm", "closed"])
    }

    func testAcceptedProviderShowsHandleBandAndAvailabilityNeverAPin() throws {
        let r = try decode(ProviderPlaceFixtures.storefront)
        let p = try XCTUnwrap(r.acceptedProviders.first)
        XCTAssertTrue(p.signed)
        XCTAssertEqual(p.person.text, "@fixture_tech")
        XCTAssertEqual(p.person.profileId, ProviderPlaceFixtures.providerId)
        XCTAssertEqual(ProviderPlaceCopy.role(p), "Technician · accepted through Nuke")
        XCTAssertEqual(ProviderPlaceCopy.band(p.serviceArea), "Works within 25 mi of Sparks, NV · travels to the vehicle")
        XCTAssertEqual(p.availabilityDays, ["Mon 08:00–17:00", "Tue 08:00–12:00"])
        let areas = JobPlaceMap.areas(for: r)
        XCTAssertEqual(areas.count, 1)                                                   // the shop has a pin; the person a circle
        XCTAssertEqual(areas[0].city, "Sparks, NV")
        XCTAssertEqual(areas[0].radiusMeters, 25 * 1_609.34, accuracy: 0.01)
    }

    func testSignedTrackerStepsAreProvenAndKeylessStepsDrop() throws {
        let r = try decode(ProviderPlaceFixtures.storefront)
        XCTAssertEqual(r.steps.count, 6)
        XCTAssertEqual(r.currentStep, "accepted")
        XCTAssertEqual(ProviderPlaceCopy.rung(r.steps[1]), .proven)
        XCTAssertEqual(ProviderPlaceCopy.stepState(r.steps[2]), "Signed through Nuke")
        XCTAssertEqual(JobProgressTracker.symbol(r.steps[2]), "checkmark.seal.fill")
        XCTAssertNil(ProviderPlaceCopy.rung(r.steps[3]))
        XCTAssertEqual(ProviderPlaceCopy.stepState(r.steps[5]), "Not yet")
    }

    func testClientNeverPinsOrDirectsANonStorefront() {
        let p = JobProviderPlace.Place(city: "Reno", state: "NV", zipCode: nil, streetAddress: "1 Somewhere", latitude: 39.5, longitude: -119.8,
                                       precision: "coordinates", storefront: false, directions: true, phone: "+15550100", basis: nil,
                                       recordUpdatedAt: nil)
        XCTAssertNil(p.pin)
        XCTAssertNil(ProviderPlaceCopy.directionsURL(p, name: "x"))
        XCTAssertNil(ProviderPlaceCopy.phoneURL(p))
    }

    func testMissingBlocksReadAsNotReported() throws {
        let r = try decode("{}")
        XCTAssertEqual(r.shop.state, "not_reported")
        XCTAssertTrue(r.steps.isEmpty)
        XCTAssertTrue(r.acceptedProviders.isEmpty)
        XCTAssertEqual(ProviderPlaceCopy.workSite(r), "Not reported")
        XCTAssertEqual(ProviderPlaceCopy.rating(nil), "Not reported")
        XCTAssertThrowsError(try decode("\"not an object\""))
        XCTAssertEqual(JobProviderPlace.StepState("arrived"), .unknown("arrived"))
    }
}
