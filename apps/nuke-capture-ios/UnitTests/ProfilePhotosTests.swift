// ProfilePhotosTests.swift — presentation rules for the owner's photos on the profile.

import XCTest
@testable import NukeCapture

final class ProfilePhotosTests: XCTestCase {
    private let car = UUID(uuidString: "00000000-0000-0000-0000-0000000000aa")!
    private let quarantine = UUID(uuidString: "14447ecd-0000-0000-0000-000000000000")!
    private var utc: Calendar { var c = Calendar(identifier: .gregorian); c.timeZone = TimeZone(identifier: "UTC")!; return c }

    private func photo(_ n: Int, _ taken: String?, vehicle: UUID? = nil, hash: String? = nil, created: String? = nil,
                       dup: Bool? = nil, superseded: Bool? = nil, status: String? = nil,
                       make: String? = nil, model: String? = nil) -> ProfilePhoto {
        ProfilePhoto(id: UUID(uuidString: String(format: "00000000-0000-0000-0000-%012d", n))!, url: "u\(n)", thumb: nil,
                     vehicle_id: vehicle, taken_at: taken, created_at: created, file_hash: hash, is_duplicate: dup,
                     is_superseded: superseded, match_status: status, vehicle_make: make, vehicle_model: model)
    }

    func testPlaceholderDetectionIsByNameNotId() {
        XCTAssertTrue(PhotoPresentation.isPlaceholderVehicle(make: "UNRESOLVED", model: "Intake Quarantine (gate-rejected, awaiting re-homing)"))
        XCTAssertTrue(PhotoPresentation.isPlaceholderVehicle(make: nil, model: "intake quarantine"))
        XCTAssertFalse(PhotoPresentation.isPlaceholderVehicle(make: "Porsche", model: "911"))
        XCTAssertFalse(PhotoPresentation.isPlaceholderVehicle(make: nil, model: nil))
    }

    func testCopiesCollapseToOneTile() {
        let rows = [
            photo(1, "2026-10-01T10:00:00Z", hash: "h", created: "2026-10-01T11:00:00Z"),
            photo(2, "2026-10-01T10:00:00Z", hash: "h", created: "2026-10-02T11:00:00Z"),
            photo(3, "2026-10-01T10:00:00Z", dup: true),
            photo(4, "2026-10-01T10:00:00Z", superseded: true),
            photo(5, "2026-10-01T09:00:00Z")
        ]
        XCTAssertEqual(PhotoPresentation.collapse(rows).map(\.url), ["u1", "u5"])
    }

    func testUnrelatedAndPlaceholderRowsLeaveVehicleGroups() {
        let rows = [
            photo(1, "2026-10-01T10:00:00Z", vehicle: car, make: "Ford", model: "Bronco"),
            photo(2, "2026-10-01T10:05:00Z", vehicle: car, status: "unrelated", make: "Ford", model: "Bronco"),
            photo(3, "2026-10-01T10:10:00Z", vehicle: quarantine, make: "UNRESOLVED", model: "Intake Quarantine")
        ]
        let l = PhotoPresentation.layout(rows, calendar: utc)
        XCTAssertEqual(l.vehicles.map(\.title), ["Ford Bronco"])
        XCTAssertEqual(l.vehicles.first?.photos.map(\.url), ["u1"])
        XCTAssertEqual(l.held, 1); XCTAssertEqual(l.unrelated, 1)
        XCTAssertEqual(Set(l.needsSorting.flatMap(\.photos).map(\.url)), ["u2", "u3"])
    }

    func testGarageSuppliedPlaceholderIdsAndNames() {
        let rows = [photo(1, "2026-10-01T10:00:00Z", vehicle: quarantine), photo(2, "2026-10-01T10:00:00Z", vehicle: car)]
        let l = PhotoPresentation.layout(rows, names: [car: "1972 Chevrolet K10"], placeholders: [quarantine], calendar: utc)
        XCTAssertEqual(l.vehicles.map(\.title), ["1972 Chevrolet K10"]); XCTAssertEqual(l.held, 1)
    }

    func testMonthSectionsKeepOldBackfillApart() {
        let rows = [
            photo(1, "2026-10-05T10:00:00Z", vehicle: car), photo(2, "2017-06-01T10:00:00Z", vehicle: car),
            photo(3, "2026-10-01T10:00:00Z", vehicle: car), photo(4, nil, vehicle: car), photo(5, "2019-01-01T10:00:00Z", vehicle: car)
        ]
        let sections = PhotoPresentation.monthSections(rows, calendar: utc)
        XCTAssertEqual(sections.map(\.id), ["2026-10", "2019-01", "2017-06", "undated"])
        XCTAssertEqual(sections[0].photos.map(\.url), ["u1", "u3"])
    }

    func testNeedsSortingGroupsIntoShoots() {
        let rows = [
            photo(1, "2026-10-01T10:00:00Z"), photo(2, "2026-10-01T10:30:00Z"),   // shoot A
            photo(3, "2026-10-01T15:00:00Z"),                                     // shoot B (gap > 2h)
            photo(4, "2026-09-30T23:50:00Z"),                                     // shoot C (different day)
            photo(5, nil)
        ]
        let shoots = PhotoPresentation.shoots(rows, calendar: utc)
        XCTAssertEqual(shoots.map { $0.photos.map(\.url) }, [["u3"], ["u2", "u1"], ["u4"], ["u5"]])
        XCTAssertEqual(shoots[1].start, PhotoPresentation.date("2026-10-01T10:00:00Z"))
    }

    func testDecodesReaderRow() throws {
        let json = #"[{"id":"00000000-0000-0000-0000-000000000001","url":"a","thumb":"b","vehicle_id":null,"taken_at":"2026-10-01T10:00:00+00:00","created_at":"2026-10-01T10:00:00.123+00:00","file_name":"x.jpg","file_hash":"h","is_duplicate":false,"is_superseded":false,"duplicate_of":null,"match_status":"unrelated","source":"capture_relay_ios","vehicle_year":null,"vehicle_make":null,"vehicle_model":null,"vehicle_is_draft":null}]"#
        let rows = try JSONDecoder().decode([ProfilePhoto].self, from: Data(json.utf8))
        XCTAssertEqual(rows.first?.file_hash, "h"); XCTAssertTrue(rows.first?.isUnrelated == true)
        XCTAssertNotNil(rows.first?.takenDate)
    }
}
