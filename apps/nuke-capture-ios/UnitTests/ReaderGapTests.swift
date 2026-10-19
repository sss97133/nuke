// ReaderGapTests.swift — booking requests from the job's own reader, vouches you've given,
// co-signing capacity and release conditions. No writer is called.

import XCTest
@testable import NukeCapture

final class ReaderGapTests: XCTestCase {
    private let utc = TimeZone(identifier: "UTC")!

    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try JobReaders.decode(T.self, from: Data(json.utf8))
    }

    func testPartiesSeeEveryRequestWithItsState() throws {
        let r = try decode(JobReservations.self, ReaderGapFixtures.reservationsParty)
        XCTAssertTrue(r.party)
        XCTAssertEqual(r.items.map { FacilityCopy.reservation($0, timeZone: utc) }, [
            "Booked: Lift A, Wed Oct 21, 4 PM–7 PM",
            "Requested at Fixture Garage — waiting for the shop · Bay 1, Fri Oct 23, 3 PM–8 PM",
            "Cancelled: Lift A, Tue Oct 20, 4 PM–7 PM",
        ])
        XCTAssertEqual(FacilityCopy.reservationDetail(r.items[0]), "at Fixture Garage · asked by @fixture_customer (the customer) · fee $40.00 / hour")
        XCTAssertEqual(FacilityCopy.reservationDetail(r.items[1]), "asked by @fixture_customer (the customer)")
        let reserve = try XCTUnwrap(r.reserveAction)
        XCTAssertEqual(reserve.facilityRequirementId, "rf1")
        XCTAssertEqual(reserve.facilities.map(\.id), [ReaderGapFixtures.orgId])
        XCTAssertNotNil(r.cancelAction(for: "rv2"))
        XCTAssertNil(r.cancelAction(for: "rv3"))                                  // a cancelled request can't be cancelled again
        XCTAssertNil(r.cancelAction(for: nil))
    }

    func testVisitorsSeeBusyWindowsOnly() throws {
        let r = try decode(JobReservations.self, ReaderGapFixtures.reservationsVisitor)
        XCTAssertFalse(r.party)
        XCTAssertNil(r.reserveAction)
        XCTAssertNil(r.items[0].reservationId)
        XCTAssertEqual(FacilityCopy.reservation(r.items[0], timeZone: utc), "Busy: Lift A, Wed Oct 21, 4 PM–7 PM")
        XCTAssertEqual(FacilityCopy.reservationDetail(r.items[0]), "at Fixture Garage")      // no requester, no fee
        let f = JobFacility(requirements: [], reservations: r, choices: [])
        XCTAssertFalse(f.isEmpty)
        XCTAssertNil(f.reserveAction)                                             // no Book a bay without the server's action
    }

    func testVouchesYouveGiven() throws {
        let v = try decode(MyVouches.self, ReaderGapFixtures.myVouches)
        XCTAssertEqual(v.items.map(VouchCopy.line), ["For @fixture_tech: supervision, suitability", "For Unnamed party: availability"])
        XCTAssertEqual(v.items.map { VouchCopy.status($0.status) }, ["Standing", "Withdrawn"])
        XCTAssertEqual(VouchCopy.signer(v.items[0]), "Fixture Garage's vouch, signed by you")
        XCTAssertEqual(VouchCopy.signer(v.items[1]), "Signed by you")
        XCTAssertEqual(VouchCopy.withdraw(v.items[0].withdrawAction, vouchId: "v1"), .init(p_id: "v1"))
        XCTAssertNil(v.items[1].withdrawAction)
        XCTAssertNil(VouchCopy.withdraw(v.items[0].withdrawAction, vouchId: "v2"))   // never another vouch's id
        let p = try decode(ProviderProfile.self, CosignFixtures.vouches)
        XCTAssertTrue(p.vouches[0].isMine)
        XCTAssertNotNil(p.vouches[0].withdrawAction)
        XCTAssertFalse(p.vouches[1].isMine)
        XCTAssertNil(p.vouches[1].withdrawAction)
    }

    func testReleaseConditionsReadPlainly() throws {
        let q = try decode(JobQuotes.self, ReaderGapFixtures.quotesWithRelease)
        let conditions = try XCTUnwrap(q.currentQuote?.releaseConditions)
        XCTAssertEqual(ReleaseCopy.line(conditions),
                       "Payment is released when: the customer confirms the work is done; 7 days have passed since the work was signed off; photos are taken in the job window")
        XCTAssertEqual(q.release?.declaredBy, "platform_standard")
        XCTAssertEqual(ReleaseCopy.applies(q.release, accepted: false), "Until a quote with conditions is accepted, Nuke's standard conditions apply.")
        XCTAssertNil(try decode(JobQuotes.self, JobFixtures.quotesForCustomer).currentQuote?.releaseConditions)
        XCTAssertEqual(ReleaseCondition.list(.array([.string("inspector_attestation")]))?.map(ReleaseCopy.condition), ["an inspector signs off on the work"])
        XCTAssertNil(ReleaseCondition.list(.null))
    }
}
