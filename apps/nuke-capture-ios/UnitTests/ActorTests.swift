// ActorTests.swift — the actor document as actor_profile_read returns it (supabase/sql/test_actor_profile_read.sql
// pins the server side): it decodes into the kit twin, every measure prints with its unit, and a rank shows only
// above the floor.

import XCTest
@testable import NukeCapture

final class ActorTests: XCTestCase {
    func testTheActorDocumentDecodesAndPrintsAsTheReadIntends() throws {
        let json = """
        {"subject":{"kind":"organization","id":"c433d27e-2159-4f8c-b4ae-32a5e44a77cf","name":"Viva! Las Vegas Autos","type":"dealer","place":"Boulder City, NV","zip":"89005"},
         "viewer":"anon","read_at":"2026-10-14T00:30:00+00:00",
         "sections":[
          {"kind":"measures","stack":"performance","title":"Selling",
           "coverage":{"n":36,"of":72,"grain":"listings with a recorded outcome","as_of":"2026-10-13T23:50:13.125758+00:00"},
           "items":[
            {"label":"Sell-through","unit":"%","value":86.1,"method":"sold ÷ (sold + unsold)","coverage":{"n":36,"of":72,"grain":"listings with a recorded outcome","as_of":"2026-10-13T23:50:13+00:00"},"rank":{"p":59.0,"n":211}},
            {"label":"Listings","unit":"listings","value":72,"method":"attributed","coverage":{"n":72,"of":72,"grain":"attributed listings","as_of":null},"rank":{"p":42.0,"n":3}}]},
          {"kind":"measures","stack":"specialization","title":"What they handle","coverage":{"n":137,"of":137,"grain":"public vehicles","as_of":null},
           "items":[{"label":"1970s","unit":"× market","value":2.0,"method":"share ÷ share","coverage":{"n":35,"of":137,"grain":"vehicles with a year","as_of":null},"rank":null}]},
          {"kind":"measures","stack":"open_books","title":"Open books","coverage":{"n":0,"of":0,"grain":"public vehicles with money recorded","as_of":null},"items":[
            {"label":"Return computable","unit":"vehicles","value":1,"method":"both","coverage":{"n":1,"of":137,"grain":"public vehicles","as_of":null},"rank":null}]},
          {"kind":"table","title":"Vehicles by role","coverage":{"n":231,"of":231,"grain":"links to public vehicles","as_of":null},"columns":["Role","Active","Past or sold"],
           "rows":[[{"value":"work_location","source":{"kind":"legacy","label":"organization_vehicles"},"observed_at":null,"trust":1},
                    {"value":78,"source":{"kind":"legacy","label":"organization_vehicles"},"observed_at":null,"trust":1},
                    {"value":0,"source":{"kind":"legacy","label":"organization_vehicles"},"observed_at":null,"trust":1}]]},
          {"kind":"hologram"}]}
        """
        let read = try JSONDecoder().decode(ActorRead.self, from: Data(json.utf8))
        XCTAssertEqual(read.subject.name, "Viva! Las Vegas Autos")
        XCTAssertEqual(read.subject.typeLabel, "Dealer")
        XCTAssertEqual(read.sections.count, 5)
        guard case .measures(let selling) = read.sections[0] else { return XCTFail("first section is the selling measures") }
        XCTAssertEqual(selling.items[0].valueText, "86.1%")
        XCTAssertEqual(selling.items[0].rankText, "P59 of 211")
        XCTAssertEqual(selling.items[1].valueText, "72 listings")
        XCTAssertNil(selling.items[1].rankText)                         // three peers: below the floor, no rank
        XCTAssertEqual(selling.coverage.sentence, "36 of 72 listings with a recorded outcome · as of Oct 13, 2026")
        guard case .measures(let spec) = read.sections[1] else { return XCTFail("specialization") }
        XCTAssertEqual(spec.items[0].valueText, "2× market")
        guard case .measures(let books) = read.sections[2] else { return XCTFail("open books") }
        XCTAssertEqual(books.items[0].valueText, "1 vehicle")
        guard case .table(let table) = read.sections[3] else { return XCTFail("table") }
        XCTAssertEqual(table.rows[0][0].value.text, "work_location")
        XCTAssertEqual(table.rows[0][1].value.text, "78")
        if case .unknown = read.sections[4] {} else { XCTFail("an unknown section decodes as unknown") }
    }

    func testAMarketParticipantReadsAsAnIdentity() throws {
        let subject = try JSONDecoder().decode(ActorSubject.self, from: Data(#"{"kind":"identity","id":"a6f5b702-7611-42b7-befd-f91175a5244e","name":"VivaLasVegasAutos","type":"bat","place":null,"zip":null,"handle":"VivaLasVegasAutos"}"#.utf8))
        XCTAssertEqual(subject.typeLabel, "Bring a Trailer member @VivaLasVegasAutos")
        // The door's identity hit id is "external_<uuid>"; the route carries the bare id and the identity kind.
        let hit = try JSONDecoder().decode(UniversalSearchHit.self, from: Data(#"{"id":"external_a6f5b702-7611-42b7-befd-f91175a5244e","type":"external_identity","title":"VivaLasVegasAutos","subtitle":"bat @VivaLasVegasAutos"}"#.utf8))
        XCTAssertEqual(hit.actorRoute, ActorRoute(kind: "identity", id: "a6f5b702-7611-42b7-befd-f91175a5244e", name: "VivaLasVegasAutos"))
        let org = try JSONDecoder().decode(UniversalSearchHit.self, from: Data(#"{"id":"C433D27E-2159-4F8C-B4AE-32A5E44A77CF","type":"organization","title":"Viva! Las Vegas Autos"}"#.utf8))
        XCTAssertEqual(org.actorRoute?.kind, "organization")
        XCTAssertEqual(org.actorRoute?.id, "c433d27e-2159-4f8c-b4ae-32a5e44a77cf")
    }

    func testAVehiclesOrganizationsReadAsOneRowEachWithTheVenueSaid() {
        XCTAssertEqual(VehicleActorLinks.line(roles: ["sold_by", "consigner"], type: "dealer"), "Sold and consigned by")
        XCTAssertEqual(VehicleActorLinks.line(roles: ["sold_by"], type: "auction_house"), "Sold on")
        // A platform is the venue whatever role the record gives it, and a platform typed wrong is caught by name.
        XCTAssertEqual(VehicleActorLinks.line(roles: ["consigner"], type: "auction_house", name: "Bring a Trailer"), "Listed on")
        XCTAssertEqual(VehicleActorLinks.line(roles: ["service_provider"], type: "auction_house"), "Listed on")
        XCTAssertEqual(VehicleActorLinks.line(roles: ["consigner"], type: "collection", name: "Facebook Marketplace"), "Listed on")
        XCTAssertTrue(VehicleActorLinks.isVenue(type: "collection", name: " Facebook Marketplace "))
        XCTAssertFalse(VehicleActorLinks.isVenue(type: "dealer", name: "Viva! Las Vegas Autos"))
        XCTAssertEqual(VehicleActorLinks.line(roles: ["owner"], type: "dealer"), "Owned by")
        XCTAssertEqual(VehicleActorLinks.line(roles: ["service_provider"], type: "shop"), "Serviced by")
    }
}
