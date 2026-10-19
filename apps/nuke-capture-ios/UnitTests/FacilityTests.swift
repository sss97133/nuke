// FacilityTests.swift — shop space, the day strip, booking requests and confirmations.
// No writer is called; bodies are built and checked locally.

import XCTest
import Supabase
@testable import NukeCapture

final class FacilityTests: XCTestCase {
    private let utc = TimeZone(identifier: "UTC")!

    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try JobReaders.decode(T.self, from: Data(json.utf8))
    }

    func testFacilityReadsAssetsLicensesAndMembers() throws {
        let f = try decode(FacilityRead.self, FacilityFixtures.read(party: false))
        XCTAssertEqual(f.organizationName, "Fixture Garage")
        XCTAssertEqual(f.groups.map(\.kind), ["bay", "lift"])
        XCTAssertEqual(f.groups[1].capacityTotal, 2)
        XCTAssertEqual(f.groups[1].assets.map(\.label), ["Lift A", "Lift B"])           // the row without an id is dropped alone
        XCTAssertEqual(f.groups[1].assets[0].kind, "lift")
        XCTAssertNil(f.groups[1].assets[0].busy[0].workOrderId)                          // visitors see "Busy" only
        XCTAssertNil(f.declareAction)
        XCTAssertEqual(f.licenses.map(FacilityCopy.license), [
            "Licensed: Auto repair, valid until Mar 1, 2027",
            "Licensed: Paint spray, no expiry on record",
            "License expired: Smog check, Jan 31, 2025",
        ])
        XCTAssertEqual(FacilityCopy.licenseDetail(f.licenses[0]), "issued by State of Nevada · as stated by the shop, not checked")
        XCTAssertEqual(f.members.map { $0.person.text }, ["@fixture_owner", "@fixture_tech"])
        XCTAssertEqual(f.membersUnnamed, 1)
        let party = try decode(FacilityRead.self, FacilityFixtures.read(party: true))
        XCTAssertEqual(party.groups[1].assets[0].busy[0].workOrderId, FacilityFixtures.workOrderId)
        XCTAssertEqual(party.declareAction?.args["p_organization_id"]?.stringValue, FacilityFixtures.orgId)
        let empty = try decode(FacilityRead.self, FacilityFixtures.empty)
        XCTAssertTrue(empty.groups.isEmpty)
        XCTAssertTrue(empty.members.isEmpty)
    }

    func testWindowsAndTheDayStrip() throws {
        XCTAssertEqual(FacilityCopy.window("2026-10-21T16:00:00+00:00", "2026-10-21T19:00:00+00:00", timeZone: utc), "Wed Oct 21, 4 PM–7 PM")
        XCTAssertEqual(FacilityCopy.window("2026-10-28T15:00:00Z", "2026-10-30T23:30:00Z", timeZone: utc), "Wed Oct 28, 3 PM – Fri Oct 30, 11:30 PM")
        let f = try decode(FacilityRead.self, FacilityFixtures.read(party: false))
        let start = try XCTUnwrap(FacilityCopy.date("2026-10-19T12:00:00Z"))
        XCTAssertEqual(FacilityCopy.busyDays(f.groups[1].assets[0].busy, start: start, timeZone: utc), [2, 9, 10, 11])
        XCTAssertEqual(FacilityCopy.capacity(1), "one at a time")
        XCTAssertEqual(FacilityCopy.capacity(3), "3 at a time")
    }

    func testFacilityInputReadsPlainly() throws {
        let m = try decode(FacilityMatches.self, FacilityFixtures.open).byRequirement
        XCTAssertEqual(m.count, 3)                                                         // the skill row has no facility input
        let pass = try XCTUnwrap(m["rf1"])
        XCTAssertEqual(pass.assets.map(\.label), ["Lift A", "Lift B"])
        XCTAssertEqual(pass.assets[0].organizationName, "Fixture Garage")
        XCTAssertEqual(FacilityCopy.match(pass), "A matching lift is free then at a shop you can use")
        XCTAssertEqual(FacilityCopy.match(try XCTUnwrap(m["rf2"])), "Every matching paint booth is booked then")
        XCTAssertEqual(FacilityCopy.match(try XCTUnwrap(m["rf3"])), "No shop you can use has listed a bay yet")
        XCTAssertEqual(OfferCopy.reason(MatchInput(input: "facility", result: "pass", reason: "not required for a skill requirement", next: nil)),
                       "Not needed for this")
    }

    func testReservationAnswer() throws {
        XCTAssertEqual(FacilityCopy.requested(shop: "Fixture Garage", window: nil), "Requested at Fixture Garage — waiting for the shop")
        let r = try decode(FacilityReservation.self, FacilityFixtures.reserved)
        XCTAssertEqual(r.state, "requested")
        XCTAssertEqual(r.organizationId, FacilityFixtures.orgId)
        XCTAssertEqual(r.from, "2026-10-21T16:00:00+00:00")
    }

    func testBookingRequestBody() throws {
        let now = try XCTUnwrap(FacilityCopy.date("2026-10-19T12:00:00Z"))
        let from = now.addingTimeInterval(2 * 86_400), until = from.addingTimeInterval(3 * 3600)
        guard case .success(let p) = FacilityDrafting.reserve(workOrderId: "w", assetId: "a", from: from, until: until, basis: .hourly,
                                                              amount: " 40 ", currency: "usd", now: now) else { return XCTFail("refused") }
        XCTAssertEqual(p.p_terms, .init(basis: "hourly", amount: 40, currency: "USD"))
        XCTAssertEqual(p.p_from, "2026-10-21T12:00:00Z")
        guard case .success(let free) = FacilityDrafting.reserve(workOrderId: "w", assetId: "a", from: from, until: until, basis: .none,
                                                                 amount: "", currency: "", now: now) else { return XCTFail("refused") }
        XCTAssertNil(free.p_terms)
        let body = try XCTUnwrap(String(data: JSONEncoder().encode(free), encoding: .utf8))
        XCTAssertFalse(body.contains("p_terms"))                                             // omitted: the server's default (no fee)
        func refusal(_ r: Result<FacilityDrafting.ReserveParams, JobSignFailure>) -> String? { if case .failure(let f) = r { return f.text } else { return nil } }
        XCTAssertEqual(refusal(FacilityDrafting.reserve(workOrderId: "w", assetId: nil, from: from, until: until, basis: .none, amount: "", currency: "", now: now)),
                       "Choose a space.")
        XCTAssertEqual(refusal(FacilityDrafting.reserve(workOrderId: "w", assetId: "a", from: until, until: from, basis: .none, amount: "", currency: "", now: now)),
                       "The end has to be after the start.")
        XCTAssertEqual(refusal(FacilityDrafting.reserve(workOrderId: "w", assetId: "a", from: now.addingTimeInterval(-7200), until: now.addingTimeInterval(-3600),
                                                        basis: .none, amount: "", currency: "", now: now)), "Pick a time in the future.")
        XCTAssertEqual(refusal(FacilityDrafting.reserve(workOrderId: "w", assetId: "a", from: from, until: from.addingTimeInterval(32 * 86_400),
                                                        basis: .none, amount: "", currency: "", now: now)), "A booking can be at most 31 days.")
        XCTAssertEqual(refusal(FacilityDrafting.reserve(workOrderId: "w", assetId: "a", from: from, until: until, basis: .day_rate,
                                                        amount: "200", currency: "dollars", now: now)), "Currency is a 3-letter code, like USD.")
        XCTAssertEqual(FacilityCopy.requestSays.count, 2)
        XCTAssertTrue(FacilityCopy.requestDoesNotSay.contains { $0.hasPrefix("Any payment") })
    }

    func testDeclarationBody() throws {
        let read = try decode(FacilityRead.self, FacilityFixtures.read(party: true))
        let action = try XCTUnwrap(read.declareAction)
        guard case .success(let p) = FacilityDrafting.declare(action: action, kind: "lift", label: "  Lift C ", capacity: 2,
                                                              evidenceLink: "https://example.com/lift-c") else { return XCTFail("refused") }
        XCTAssertEqual(p.p_organization_id, FacilityFixtures.orgId)
        XCTAssertEqual(p.p_label, "Lift C")
        XCTAssertEqual(p.p_evidence, [.init(kind: "url", url: "https://example.com/lift-c")])
        guard case .success(let bare) = FacilityDrafting.declare(action: action, kind: "bay", label: "Bay 2", capacity: 1, evidenceLink: "") else {
            return XCTFail("refused")
        }
        XCTAssertNil(bare.p_evidence)
        if case .failure(let f) = FacilityDrafting.declare(action: action, kind: "lift", label: "Lift", capacity: 1, evidenceLink: "http://x.com") {
            XCTAssertEqual(f.text, "The link has to start with https://.")
        } else { XCTFail("http accepted") }
        if case .success = FacilityDrafting.declare(action: action, kind: "spaceship", label: "x", capacity: 1, evidenceLink: "") { XCTFail("bad kind accepted") }
        if case .success = FacilityDrafting.declare(action: action, kind: "lift", label: "x", capacity: 501, evidenceLink: "") { XCTFail("capacity accepted") }
        XCTAssertTrue(FacilityCopy.declareSays[1].contains("never guesses assets from photos"))
    }

    func testConfirmIsPinnedToTheQueueItem() throws {
        let q = try decode(SignatureQueue.self, FacilityFixtures.queue)
        let item = try XCTUnwrap(q.items.first)
        XCTAssertTrue(SignatureKinds.isKnown(item.kind))
        XCTAssertEqual(JobCopy.action(item.kind), "Confirm a booking")
        XCTAssertEqual(item.facilityRequest?.asset?.label, "Lift A")
        XCTAssertEqual(item.facilityRequest?.requestedBy?.text, "@fixture_customer")
        XCTAssertEqual(FacilityCopy.terms(basis: "hourly", amount: 40, currency: "USD"), "$40.00 / hour")
        XCTAssertEqual(FacilityCopy.window(item.windowFrom, item.windowUntil, timeZone: utc), "Wed Oct 21, 4 PM–7 PM")
        XCTAssertEqual(FacilityDrafting.confirm(item), .init(p_reservation_id: FacilityFixtures.reservationId, p_hash: FacilityFixtures.hash))
        XCTAssertEqual(item.sign?.bindsList.map(FacilityCopy.signBinds), [
            "One space on this asset is held for this job at that time.",
            "Your shop offers this space on the job, at the requested fee.",
        ])
        XCTAssertEqual(item.sign?.doesNotBind.map(FacilityCopy.signDoesNotBind), ["Any payment", "Access to the vehicle", "Any other time"])
        let other = FacilityFixtures.queue.replacingOccurrences(of: "\"ref_id\":\"\(FacilityFixtures.reservationId)\"", with: "\"ref_id\":\"someone-else\"")
        XCTAssertNil(FacilityDrafting.confirm(try XCTUnwrap(decode(SignatureQueue.self, other).items.first)))   // never a hash for another request
        XCTAssertEqual(FacilityCopy.failure(PostgrestError(code: "23514", message: "Reservation hash does not match this request")),
                       "This request changed since you opened it. Refresh and review it again.")
        XCTAssertEqual(FacilityCopy.failure(PostgrestError(code: "23P01", message: "Asset fully booked for that window (capacity 1)")),
                       "That space is fully booked for that time.")
        XCTAssertEqual(FacilityCopy.failure(PostgrestError(code: "42501", message: "Only the customer or an accepted provider reserves a facility for this job")),
                       "Only the customer or a technician accepted on this job can book shop space.")
    }
}
