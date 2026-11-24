import XCTest
import CoreLocation
@testable import NukeCapture

final class PhotoCohortsTests: XCTestCase {
    private let me = "0b9f107a-d124-49de-9ded-94698f63c1c4"

    func testMustangPhotoReachesEveryGroupItHas() {
        let read = PhotoCohortRead(onRecord: true, imageId: "img", uploaderId: me,
            vehicle: .init(id: "veh", year: 1967, make: "Ford", model: "Mustang"),
            orgs: [.init(id: "org", name: "Viva", role: "service_provider")], privateOrgCount: 1,
            latitude: 34.05, longitude: -118.24, sets: [.init(id: "s", name: nil, sessionKind: "work_session")])
        let edges = PhotoCohorts.edges(read, viewerId: me)
        XCTAssertEqual(edges.map(\.kind), [.vehicle, .uploader, .organization, .organization, .make, .model, .cohort, .place, .session])
        XCTAssertEqual(edges[0].target, .vehicle("veh"))
        XCTAssertEqual(edges[0].title, "1967 Ford Mustang")
        XCTAssertEqual(edges[1].title, "You")
        XCTAssertEqual(edges[1].target, .profile(me))
        XCTAssertEqual(edges[2].target, .organization(id: "org", name: "Viva"))
        XCTAssertNil(edges[3].target, "a private organization is counted, never named or opened")
        XCTAssertEqual(edges[4].target, .vehicles(filters: ["make": "Ford"], title: "Ford"))
        XCTAssertEqual(edges[5].target, .vehicles(filters: ["make": "Ford", "model": "Mustang"], title: "Ford Mustang"))
        XCTAssertEqual(edges[6].target, .cohort(make: "Ford", model: "Mustang", year: 1967))
        XCTAssertEqual(edges[7].target, .place(latitude: 34.05, longitude: -118.24))
        XCTAssertFalse(edges.contains { $0.missing })
    }

    func testUnfiledPhotoNamesTheGapsInsteadOfGuessing() {
        let read = PhotoCohortRead(onRecord: true, imageId: "img", uploaderId: me)
        let edges = PhotoCohorts.edges(read, viewerId: me)
        XCTAssertEqual(edges.first?.title, "Not filed to a vehicle")
        XCTAssertEqual(edges.first?.missing, true)
        XCTAssertFalse(edges.contains { $0.kind == .make || $0.kind == .model || $0.kind == .cohort || $0.kind == .organization })
        XCTAssertEqual(edges.first { $0.kind == .place }?.title, "No GPS")
        XCTAssertEqual(edges.first { $0.kind == .session }?.missing, true)
    }

    func testPhotoNotOnRecordUsesOnlyThePhonesOwnFacts() {
        let edges = PhotoCohorts.edges(PhotoCohortRead(onRecord: false), viewerId: me,
                                       deviceLocation: CLLocationCoordinate2D(latitude: 1, longitude: 2))
        XCTAssertEqual(edges.map(\.kind), [.vehicle, .place])
        XCTAssertEqual(edges[0].title, "Not on your Nuke record yet")
        XCTAssertEqual(edges[1].target, .place(latitude: 1, longitude: 2))
    }

    func testMakeWithoutModelDoesNotInventACohort() {
        let read = PhotoCohortRead(onRecord: true, imageId: "img", uploaderId: me,
                                   vehicle: .init(id: "veh", year: 1967, make: "Ford", model: nil))
        let edges = PhotoCohorts.edges(read, viewerId: me)
        XCTAssertEqual(edges.first { $0.kind == .model }?.title, "Model unknown")
        XCTAssertFalse(edges.contains { $0.kind == .cohort })
    }
}
