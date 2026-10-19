// RelationWeightTests.swift — the organization page and the profile's organization list decode the server's
// relation readers (get_org_page, user_org_relations, migration 20261017170000) and show the state the server cut
// from the weight. The JSON is the shape a rolled-back run of those functions returned as the owner on 2026-10-15.

import XCTest
@testable import NukeCapture

final class RelationWeightTests: XCTestCase {
    private let page = """
    {"org":{"id":"c433d27e-2159-4f8c-b4ae-32a5e44a77cf","name":"Viva! Las Vegas Autos","type":"dealership","city":"Boulder City","state":"NV"},
     "as_of":"2026-10-15T23:10:00.123456+00:00","half_life_hours":6,"dormant_below":0.0625,
     "basis":["photos within 150 m of the organization's locations","organization images","timeline events","contractor work"],
     "you":{"role":"board_member","relation":{"state":"dormant","weight":0,"last_by_source":{},"contributions_24h":0,
            "last_contribution_at":null,"unresolved_shared_site_photos_24h":5}},
     "vehicles":[{"vehicle_id":"0d6f3d52-0000-4000-8000-000000000001","year":2004,"make":"Chevrolet","model":"Corvette Z06",
                  "relationship_type":"consigner","image_url":null,
                  "relation":{"weight":0.5,"state":"live","last_contribution_at":"2026-10-15T17:10:00+00:00","contributions_24h":2}}],
     "vehicles_considered":179,"vehicles_total":179}
    """

    func testOrgPageDecodesAndReadsTheServersState() throws {
        let p = try JSONDecoder().decode(OrgPage.self, from: Data(page.utf8))
        XCTAssertEqual(p.org.name, "Viva! Las Vegas Autos")
        XCTAssertEqual(p.you?.role, "board_member")
        XCTAssertEqual(p.you.map { RelationWeight.word($0.relation) }, "Dormant")
        XCTAssertEqual(p.you?.relation.unresolved_shared_site_photos_24h, 5)
        XCTAssertNil(p.you?.relation.last_contribution_at)
        XCTAssertEqual(p.vehicles.first.map { RelationWeight.word($0.relation) }, "Live")
        XCTAssertEqual(p.vehicles.first?.title, "2004 Chevrolet Corvette Z06")
    }

    func testProfileRelationsDecodeWithoutTheOptionalCount() throws {
        let json = """
        {"as_of":"2026-10-15T23:10:00+00:00","half_life_hours":6,"dormant_below":0.0625,"window_hours":48,
         "relations":[{"organization_id":"f32ea08c-c2c5-4ca9-896d-cb99ce6c7bfb","name":"Nuke","type":"other","role":"owner",
                       "membership_status":"active","start_date":"2026-01-01","end_date":null,
                       "relation":{"weight":0.0625,"state":"stalling","last_contribution_at":"2026-10-14 23:10:00+00","contributions_24h":1}}]}
        """
        struct Payload: Decodable { let relations: [OrgAffiliationsSection.Row] }
        let rows = try JSONDecoder().decode(Payload.self, from: Data(json.utf8)).relations
        XCTAssertEqual(rows.count, 1)
        XCTAssertEqual(RelationWeight.word(rows[0].relation), "Stalling")
        XCTAssertNil(rows[0].relation.unresolved_shared_site_photos_24h)
        // Postgres' space-separated timestamp still reads as a date.
        XCTAssertNotNil(RelationWeight.date(rows[0].relation.last_contribution_at))
    }
}
