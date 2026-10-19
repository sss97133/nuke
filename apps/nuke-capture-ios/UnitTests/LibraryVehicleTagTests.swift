// LibraryVehicleTagTests.swift — which vehicle a Library photo shows, from its uploaded rows.
//
// Attached (vehicle_id), suggested (auto_suggested_vehicle_id / suggested_vehicle_id) and nothing
// stay distinct; superseded rows never count; a vision gate hold is carried on the attachment.
// Synthetic ids only.

import XCTest
@testable import NukeCapture

final class LibraryVehicleTagTests: XCTestCase {
    private let photo = "00000000-0000-4000-8000-000000000001/L0/001"
    private let other = "00000000-0000-4000-8000-000000000002/L0/001"
    private let blazer = "10000000-0000-4000-8000-00000000000a"
    private let bronco = "10000000-0000-4000-8000-00000000000b"

    private func row(_ id: String, _ lid: String?, vehicle: String? = nil, suggested: String? = nil,
                     auto: String? = nil, gate: String? = nil, superseded: Bool? = nil) -> LibraryVehicleRow {
        LibraryVehicleRow(id: id, local_uuid: lid, vehicle_id: vehicle, suggested_vehicle_id: suggested,
                          auto_suggested_vehicle_id: auto, vision_gate_status: gate, is_superseded: superseded)
    }

    func testAttachedRowIsConfirmed() {
        let tags = LibraryVehicleTags.resolve([row("r1", photo, vehicle: blazer, gate: "approved")])
        XCTAssertEqual(tags[photo], .attached(vehicleId: blazer, hold: nil))
    }

    func testRowWithoutVehicleOrSuggestionHasNoTag() {
        let tags = LibraryVehicleTags.resolve([row("r1", photo, gate: "pending"), row("r2", nil, vehicle: blazer)])
        XCTAssertTrue(tags.isEmpty)
    }

    func testSupersededRowNeverCounts() {
        let tags = LibraryVehicleTags.resolve([
            row("r1", photo, vehicle: blazer, superseded: true),
            row("r2", photo),
        ])
        XCTAssertNil(tags[photo])
    }

    func testAttachedWinsOverSuggestion() {
        let tags = LibraryVehicleTags.resolve([
            row("r1", photo, vehicle: blazer),
            row("r2", photo, suggested: bronco),
        ])
        XCTAssertEqual(tags[photo], .attached(vehicleId: blazer, hold: nil))
    }

    func testMatcherSuggestionIsNotConfirmed() {
        let tags = LibraryVehicleTags.resolve([row("r1", photo, suggested: blazer, gate: "pending")])
        XCTAssertEqual(tags[photo], .suggested(vehicleId: blazer, source: .matcher))
    }

    func testAttributionSuggestionNamesItsSource() {
        let tags = LibraryVehicleTags.resolve([row("r1", photo, suggested: blazer, auto: blazer)])
        XCTAssertEqual(tags[photo], .suggested(vehicleId: blazer, source: .attribution))
    }

    func testDisagreeingSuggestionsChooseNone() {
        let tags = LibraryVehicleTags.resolve([row("r1", photo, suggested: blazer, auto: bronco)])
        XCTAssertEqual(tags[photo], .several(vehicleIds: [bronco, blazer], confirmed: false))
    }

    func testTwoAttachedVehiclesChooseNone() {
        let tags = LibraryVehicleTags.resolve([
            row("r1", photo, vehicle: blazer),
            row("r2", photo, vehicle: bronco),
        ])
        XCTAssertEqual(tags[photo], .several(vehicleIds: [blazer, bronco], confirmed: true))
    }

    func testVehicleIdsCompareCaseInsensitively() {
        let tags = LibraryVehicleTags.resolve([
            row("r1", photo, vehicle: blazer.uppercased()),
            row("r2", photo, vehicle: blazer),
        ])
        XCTAssertEqual(tags[photo], .attached(vehicleId: blazer, hold: nil))
    }

    func testGateRejectionIsCarriedOnTheAttachment() {
        let tags = LibraryVehicleTags.resolve([
            row("r1", photo, vehicle: blazer, gate: "rejected_misattributed"),
            row("r2", other, vehicle: blazer, gate: "rejected_personal"),
        ])
        XCTAssertEqual(tags[photo], .attached(vehicleId: blazer, hold: .differentVehicle))
        XCTAssertEqual(tags[other], .attached(vehicleId: blazer, hold: .personal))
    }

    func testOneUnheldDuplicateClearsTheHold() {
        let tags = LibraryVehicleTags.resolve([
            row("r1", photo, vehicle: blazer, gate: "rejected_misattributed"),
            row("r2", photo, vehicle: blazer, gate: "approved"),
        ])
        XCTAssertEqual(tags[photo], .attached(vehicleId: blazer, hold: nil))
    }

    func testRowDecodesFromTheReaderShape() throws {
        let json = """
        [{"id":"r1","local_uuid":"\(photo)","vehicle_id":null,"suggested_vehicle_id":"\(blazer)",
          "auto_suggested_vehicle_id":null,"vision_gate_status":"pending","is_superseded":false}]
        """
        let rows = try JSONDecoder().decode([LibraryVehicleRow].self, from: Data(json.utf8))
        XCTAssertEqual(LibraryVehicleTags.resolve(rows)[photo], .suggested(vehicleId: blazer, source: .matcher))
    }

    // MARK: Merges and placeholder records

    private let quarantine = "10000000-0000-4000-8000-00000000000c"
    private let mergedAway = "10000000-0000-4000-8000-00000000000d"
    private var names: [String: LibraryVehicleName] {
        [quarantine: LibraryVehicleName(id: quarantine, year: nil, make: "UNRESOLVED", model: "Intake Quarantine"),
         mergedAway: LibraryVehicleName(id: mergedAway, year: 1971, make: "Ford", model: "Bronco", merged_into_vehicle_id: bronco),
         bronco: LibraryVehicleName(id: bronco, year: 1971, make: "Ford", model: "Bronco")]
    }

    func testVehicleIdsCollectsEveryNamedVehicleOnce() {
        let rows = [row("r1", photo, vehicle: blazer, suggested: bronco), row("r2", other, auto: blazer.uppercased())]
        XCTAssertEqual(LibraryVehicleTags.vehicleIds(in: rows), [blazer, bronco])
    }

    func testPlaceholderAttachmentIsNotAVehicleTag() {
        let rows = [row("r1", photo, vehicle: quarantine, gate: "rejected_misattributed")]
        let tags = LibraryVehicleTags.resolve(LibraryVehicleTags.restated(rows, names: names))
        XCTAssertNil(tags[photo])
        XCTAssertEqual(LibraryVehicleTags.placeholdered(rows, names: names), [photo])
    }

    func testPlaceholderAttachmentLeavesTheSuggestionVisible() {
        let rows = [row("r1", photo, vehicle: quarantine, suggested: blazer)]
        let tags = LibraryVehicleTags.resolve(LibraryVehicleTags.restated(rows, names: names))
        XCTAssertEqual(tags[photo], .suggested(vehicleId: blazer, source: .matcher))
        XCTAssertTrue(LibraryVehicleTags.placeholdered(rows, names: names).isEmpty)
    }

    func testMergedVehicleShowsAsItsSurvivor() {
        let rows = [row("r1", photo, suggested: mergedAway), row("r2", other, vehicle: mergedAway, gate: "rejected_personal"),
                    row("r3", other, vehicle: bronco, gate: "rejected_personal")]
        let tags = LibraryVehicleTags.resolve(LibraryVehicleTags.restated(rows, names: names))
        XCTAssertEqual(tags[photo], .suggested(vehicleId: bronco, source: .matcher))
        XCTAssertEqual(tags[other], .attached(vehicleId: bronco, hold: .personal))
    }

    // MARK: Labels (Garage format)

    func testFullLabelMatchesGarageTitle() {
        let name = LibraryVehicleName(id: blazer, year: 1972, make: "Chevrolet", model: "K5 Blazer", trim: "Cheyenne")
        XCTAssertEqual(name.full, "1972 Chevrolet K5 Blazer Cheyenne")
        let garage = GarageVehicle(vehicle_id: blazer, year: 1972, make: "Chevrolet", model: "K5 Blazer",
                                   trim_name: "Cheyenne", image_url: nil, current_value: nil, image_count: 0, relationship: "owner")
        XCTAssertEqual(name.full, garage.title)
    }

    func testShortLabelIsYearAndModel() {
        XCTAssertEqual(LibraryVehicleName(id: blazer, year: 1972, make: "Chevrolet", model: "K5 Blazer").short, "1972 K5 Blazer")
        XCTAssertEqual(LibraryVehicleName(id: blazer, year: 1971, make: "Ford", model: nil).short, "1971 Ford")
        XCTAssertEqual(LibraryVehicleName(id: blazer, year: nil, make: "Ford", model: "Bronco").short, "Bronco")
    }

    func testPlaceholderNamesAreNotLabels() {
        let placeholder = LibraryVehicleName(id: blazer, year: nil, make: "UNRESOLVED", model: " ")
        XCTAssertNil(placeholder.full)
        XCTAssertNil(placeholder.short)
        XCTAssertNil(LibraryVehicleName(id: blazer, year: 1972, make: nil, model: nil).short)
    }
}
