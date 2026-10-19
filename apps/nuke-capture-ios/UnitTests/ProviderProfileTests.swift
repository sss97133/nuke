// ProviderProfileTests.swift — the provider face: claims apart from evidence, sightings as
// sightings, shops filtered to active relations, the work record, and jobs on record.

import XCTest
import Supabase
@testable import NukeCapture

final class ProviderProfileTests: XCTestCase {
    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try JobReaders.decode(T.self, from: Data(json.utf8))
    }

    func testProfileDecodesTheShippedShape() throws {
        let p = try decode(ProviderProfile.self, ProviderFixtures.profile(context: "visitor"))
        XCTAssertFalse(p.isSelf)
        XCTAssertEqual(p.subject?.name, "@fixture_tech")
        XCTAssertEqual(p.subject?.place, "Fixture City, NV")
        XCTAssertEqual(p.capabilities.count, 2)                                 // a broken row is skipped
        XCTAssertEqual(p.capabilities[0].evidenceCount, 14)
        XCTAssertEqual(p.tools?.seenInFrame?.occurrences, 312)
        XCTAssertEqual(p.tools?.seenInFrame?.topLabels.first?.label, "floor jack")
        XCTAssertEqual(p.tools?.supportingAttestations, 0)
        XCTAssertEqual(p.facilities.count, 3)
        XCTAssertEqual(p.identityBridgeState, "claimed")
        XCTAssertEqual(p.workDays?.signedWorkDays, 2)
        XCTAssertEqual(p.workDays?.captureSpanHours, 1395.9)
        XCTAssertEqual(p.jobs?.byRole["shop_owner"], 2)
        XCTAssertEqual(p.jobs?.completionStatusOnly, 1)
        XCTAssertEqual(p.jobs?.inconsistencies, 2)
        XCTAssertFalse(p.contactAvailable)
        XCTAssertTrue(try decode(ProviderProfile.self, ProviderFixtures.profile(context: "self")).isSelf)
    }

    func testWhatTheySayStaysSelfDescribed() throws {
        let p = try decode(ProviderProfile.self, ProviderFixtures.profile(context: "visitor"))
        let rows = ProviderFaceContent.claimRows(p.claims)
        // role and user_type are platform account settings: never shown to a visitor as self-description.
        XCTAssertEqual(rows.map(\.label), ["Trade", "Expertise", "Specialties", "Makes", "Eras", "Experience"])
        XCTAssertEqual(rows[0].value, "Restoration")
        XCTAssertEqual(rows[1].value, "Engines, Fabrication")
        XCTAssertEqual(rows[0].basis, "self-described")
        XCTAssertEqual(rows[2].basis, "stated on their technician profile")
        XCTAssertEqual(rows.last?.value, "12 years")
        XCTAssertTrue(ProviderFaceContent.claimRows(nil).isEmpty)
        let mine = ProviderFaceContent.claimRows(p.claims, isSelf: true)
        XCTAssertEqual(mine.map(\.label), ["Trade", "Expertise", "Account role", "Account type", "Specialties", "Makes", "Eras", "Experience"])
        XCTAssertEqual(mine[2].basis, "account setting, not shown to visitors")
        XCTAssertEqual(mine[4].basis, "stated on your technician profile")
    }

    func testRecordShowsEvidenceWithCounts() throws {
        let p = try decode(ProviderProfile.self, ProviderFixtures.profile(context: "visitor"))
        XCTAssertEqual(ProviderFaceContent.capabilityLabel(p.capabilities[0]), "Engine rebuild · advanced")
        XCTAssertEqual(ProviderFaceContent.capabilityLabel(p.capabilities[1]), "Exhaust fabrication")
        XCTAssertEqual(ProviderFaceContent.evidenceText(14), "14 pieces of evidence")
        XCTAssertEqual(ProviderFaceContent.evidenceText(1), "1 piece of evidence")
        XCTAssertEqual(JobCopy.day(p.capabilities[0].lastDemonstrated), "Sep 30, 2026")
    }

    func testToolSightingsCarryTheirCoverage() throws {
        let p = try decode(ProviderProfile.self, ProviderFixtures.profile(context: "visitor"))
        let seen = try XCTUnwrap(p.tools?.seenInFrame)
        XCTAssertEqual(ProviderFaceContent.seenCoverage(seen), "from 181 of 420 analysed photos · latest 1,000 of 3,200 photos")
        let owned = try XCTUnwrap(p.tools?.claimedOwned)
        XCTAssertEqual(owned.categories.first?.category, "hand tools")
        XCTAssertEqual(owned.categories.first?.records, 42)
    }

    func testShopsShowActiveRelationsAndOwnershipOnly() throws {
        let p = try decode(ProviderProfile.self, ProviderFixtures.profile(context: "visitor"))
        let active = p.facilities.filter(\.isActive)
        XCTAssertEqual(active.map(\.name), ["Fixture Garage", "Fixture Fab LLC"])
        XCTAssertEqual(ProviderFaceContent.facilityValue(active[0]), "Technician")
        XCTAssertEqual(ProviderFaceContent.facilityValue(active[1]), "Owner")
        XCTAssertEqual(JobCopy.relationState("live"), "active now")
        XCTAssertFalse(ProviderFaceContent.showsShops(p, isOwn: false))           // 2026-06-13: organizations off the visitor face
        XCTAssertTrue(ProviderFaceContent.showsShops(p, isOwn: true))
        let mine = try decode(ProviderProfile.self, ProviderFixtures.profile(context: "self"))
        XCTAssertTrue(ProviderFaceContent.showsShops(mine, isOwn: false))
    }

    func testActorProfileMarksPhotoAndDayBlocksNotAssessed() throws {
        let p = try decode(ProviderProfile.self, ProviderFixtures.actorProfile)
        XCTAssertEqual(p.subject?.name, "Unnamed party")
        XCTAssertEqual(p.tools?.seenInFrame?.state, "not_assessed")
        XCTAssertEqual(p.tools?.claimedOwned?.state, "not_assessed")
        XCTAssertEqual(p.workDays?.state, "not_assessed")
        XCTAssertEqual(p.tools?.supportingAttestations, 1)
        XCTAssertNil(p.claims?.account)
        XCTAssertEqual(ProviderFaceContent.claimRows(p.claims).map(\.label), ["Specialties"])
    }

    func testTechnicianLinkInTheThirdPerson() {
        XCTAssertEqual(JobCopy.technicianLinkOf("claimed"), "Linked by them — not yet backed by work")
        XCTAssertEqual(JobCopy.technicianLinkOf("evidenced"), "Linked to a technician profile, backed by their work")
        XCTAssertEqual(JobCopy.technicianLinkOf("none"), "Not linked to a technician profile")
        XCTAssertEqual(JobCopy.hours(1395.9), "1,396 h")
        XCTAssertEqual(JobCopy.role("shop_owner"), "shop owner")
        XCTAssertEqual(JobCopy.role("performer"), "technician")
    }

    func testJobRecordRowsAndPaging() throws {
        let page = try decode(ProviderJobRecord.self, ProviderFixtures.jobRecord)
        XCTAssertEqual(page.rows.count, 2)
        XCTAssertEqual(page.unreadableRows, 1)
        XCTAssertEqual(page.sentence, "Showing 2 of 5 jobs")
        XCTAssertEqual(page.nextAfter, "00000000-0000-4000-8000-000000000002")
        let first = page.rows[0]
        XCTAssertEqual(first.headline, "Exhaust fabrication")
        XCTAssertEqual(first.stageStates[.accounting], .withheld)
        XCTAssertEqual(ProviderJobRowView.detail(first),
                       "As shop owner · install 3 · paint 1 · Customer signed · Vouched 1× · completed Oct 9, 2026")
        XCTAssertEqual(first.inconsistencies.count, 1)
        XCTAssertEqual(page.rows[1].headline, "1969 Ford Mustang")
        XCTAssertEqual(ProviderJobRowView.detail(page.rows[1]), "As technician")
        let merged = page.appending(page)
        XCTAssertEqual(merged.rows.count, 2)                                    // no duplicate rows
    }

    func testUnavailableProfileReadsPlainly() {
        let r = JobReaders.refusal(ProviderReaders.profileName, PostgrestError(code: "P0001", message: "Profile unavailable"))
        XCTAssertEqual(r.kind, .unavailable)
        XCTAssertEqual(r.title, "Profile not available")
        XCTAssertEqual(try decode(JobPerson.self, #"{"kind":"user","profile_id":"p1","handle":"tech"}"#).profileId, "p1")
    }
}
