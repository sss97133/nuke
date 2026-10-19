// GarageTests.swift — the garage's readers decode their live shapes, and ownership stays the server's
// word: an owned vehicle offers "Post a job", a contribution or past car does not.

import XCTest
@testable import NukeCapture

final class GarageTests: XCTestCase {
    private let clock = Date(timeIntervalSince1970: 1_792_400_000)

    private func garage() throws -> [GarageVehicle] {
        try JSONDecoder().decode([GarageVehicle].self, from: Data(GarageFixtures.garage.utf8))
    }

    func testUnorganizedCountAtTheCapReadsAsAtLeast() throws {
        guard case .loaded(let capped) = GarageReaders.unorganizedLoad(from: Data(GarageFixtures.unorganizedAtCap.utf8), readAt: clock) else {
            return XCTFail("a bare integer decodes")
        }
        XCTAssertTrue(capped.atCap)
        XCTAssertEqual(capped.value, "\(1000.formatted())+")
        XCTAssertTrue(capped.coverage.hasPrefix("your uploads from any source, counted to \(1000.formatted()) · as of "))

        guard case .loaded(let some) = GarageReaders.unorganizedLoad(from: Data(GarageFixtures.unorganizedSome.utf8), readAt: clock) else {
            return XCTFail("a bare integer decodes")
        }
        XCTAssertFalse(some.atCap)
        XCTAssertEqual(some.value, "37")
    }

    func testUnorganizedCountThatIsNotANumberRefuses() {
        guard case .refused(let r) = GarageReaders.unorganizedLoad(from: Data(#"{"n":3}"#.utf8), readAt: clock) else {
            return XCTFail("no count is invented")
        }
        XCTAssertEqual(r.reader, "my_unorganized_photo_count")
        XCTAssertEqual(r.kind, .failed)
    }

    func testVehicleRowKeepsIdentityAndVisibilityOnly() throws {
        guard case .loaded(let row) = GarageReaders.vehicleRowLoad(from: Data(GarageFixtures.vehicleRow.utf8)) else {
            return XCTFail("the whole row decodes")
        }
        XCTAssertEqual(row.title, "1966 Fixture Coupe")
        XCTAssertTrue(row.isPublic)
        XCTAssertEqual(GarageCopy.visibility(row), "Public — anyone can open its profile")
        XCTAssertNil(GarageCopy.removal(row))
    }

    func testVehicleRowMissingFlagIsPrivateAndMergeIsSaid() throws {
        guard case .loaded(let row) = GarageReaders.vehicleRowLoad(from: Data(GarageFixtures.vehicleRowPrivateMerged.utf8)) else {
            return XCTFail("the row decodes")
        }
        XCTAssertEqual(row.title, "Fixture Pickup Custom")
        XCTAssertFalse(row.isPublic)
        XCTAssertEqual(GarageCopy.visibility(row), "Private — only you and accounts it's shared with")
        XCTAssertEqual(GarageCopy.removal(row), "Merged into another vehicle record")
    }

    func testHiddenVehicleRowIsUnavailableNotEmpty() {
        guard case .refused(let r) = GarageReaders.vehicleRowLoad(from: Data(GarageFixtures.vehicleRowHidden.utf8)) else {
            return XCTFail("null is a refusal")
        }
        XCTAssertEqual(r.kind, .unavailable)
        XCTAssertEqual(r.title, "Vehicle not available")
    }

    func testSectionsFollowTheServersRelationships() throws {
        let s = GarageSections(try garage())
        XCTAssertEqual(s.owned.map(\.make), ["Fixture"])
        XCTAssertEqual(s.owned.map(\.model), ["Coupe"])
        XCTAssertEqual(s.previouslyOwned.map(\.model), ["Roadster"])
        XCTAssertEqual(s.contributed.map(\.model), ["Hot Rod"])
        XCTAssertTrue(s.other.isEmpty)
        XCTAssertEqual(s.total, 3)
        XCTAssertEqual(s.parts, "1 owned · 1 previously owned · 1 contributed")
        XCTAssertTrue(s.coverage(readAt: clock).hasPrefix("3 vehicles the record relates to your account: 1 owned · 1 previously owned · 1 contributed · as of "))
        XCTAssertTrue(s.coverage(readAt: clock, cachedAt: clock).hasSuffix(", may be out of date"))
        XCTAssertTrue(GarageSections([]).coverage(readAt: nil).hasPrefix("0 vehicles the record relates to your account: 0 owned"))
    }

    func testOwnerPostsAJobContributorOrdersAnInspection() throws {
        let rows = try garage()
        let owned = try XCTUnwrap(rows.first { $0.relationship == "owner" })
        let past = try XCTUnwrap(rows.first { $0.relationship == "previously_owned" })
        let contributed = try XCTUnwrap(rows.first { $0.relationship == "contributor" })
        XCTAssertEqual(GarageRelation.postEntry(owned, signedIn: true), .post)
        XCTAssertEqual(GarageRelation.postEntry(past, signedIn: true), .inspect)
        XCTAssertEqual(GarageRelation.postEntry(contributed, signedIn: true), .inspect)
        XCTAssertEqual(GarageRelation.postEntry(owned, signedIn: false), .none)
        XCTAssertEqual(GarageRelation.line(owned), "Owned")
        XCTAssertEqual(GarageRelation.line(contributed), "Your photos or records — not recorded as yours")
        XCTAssertEqual(GarageRelation.line(past), "Previously owned")
    }

    func testDisputedStatementTakesTheCarOutOfOwned() throws {
        let corrections = try JSONDecoder().decode([GarageOwnerCorrection].self, from: Data(GarageFixtures.disputedOwnerStatement.utf8))
        let rows = GarageVehicle.applying(corrections, to: try garage())
        let s = GarageSections(rows)
        XCTAssertTrue(s.owned.isEmpty)
        XCTAssertEqual(s.other.map(\.relationship), ["claimed_interest"])
        XCTAssertEqual(s.other.first?.label, "Claimed interest")
        XCTAssertEqual(s.parts, "0 owned · 1 other interest · 1 previously owned · 1 contributed")
        let claimed = try XCTUnwrap(s.other.first?.vehicles.first)
        XCTAssertEqual(GarageRelation.postEntry(claimed, signedIn: true), .inspect)
    }

    func testStatementOnlyVehicleJoinsForReview() throws {
        let metadata = [
            GarageReaders.Metadata(id: "00000000-0000-4000-8000-000000000001", year: 1966, make: "Fixture", model: "coupe",
                                   normalized_model: "Coupe", trim: nil, vin: "FIXTUREVIN0000001", primary_image_url: nil, image_count: 1863),
            GarageReaders.Metadata(id: "00000000-0000-4000-8000-000000000009", year: 1972, make: "Fixture", model: "Wagon",
                                   normalized_model: nil, trim: nil, vin: nil, primary_image_url: nil, image_count: nil),
        ]
        let rows = GarageReaders.merging(metadata, into: try garage())
        XCTAssertEqual(rows.count, 4)
        XCTAssertEqual(rows.first { $0.vehicle_id.hasSuffix("0001") }?.vin, "FIXTUREVIN0000001")
        let review = try XCTUnwrap(rows.first { $0.vehicle_id.hasSuffix("0009") })
        XCTAssertEqual(review.relationship, "relationship_review")
        XCTAssertFalse(GarageRelation.isOwned(review))
    }

    func testGetWorkDoneOffersOnlyOwnedVehicles() throws {
        let targets = try JSONDecoder().decode([SupabaseService.RelinkTarget].self, from: Data(GarageFixtures.garage.utf8))
        XCTAssertEqual(targets.count, 3)
        XCTAssertEqual(ClientFaceSection.postable(targets).map(\.model), ["Coupe"])
    }
}
