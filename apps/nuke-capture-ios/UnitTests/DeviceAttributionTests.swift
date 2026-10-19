// DeviceAttributionTests.swift — the two client checks behind filing and new vehicle profiles:
// the VIN check digit (an OCR run must be a VIN, not a 17-character part number) and the album
// label reader (an album named after a vehicle, not a client, a year or an org).

import XCTest
import Supabase
@testable import NukeCapture

@MainActor
final class DeviceAttributionTests: XCTestCase {
    private func capture(_ id: String, vin: String? = nil, exact: Bool = false,
                         time: String? = "2026-10-18T12:00:00Z", lat: Double? = 37,
                         lon: Double? = -122,
                         hash: String? = String(repeating: "a", count: 64),
                         vehicle: Bool = false, document: Bool = false,
                         sensitive: Bool = false) -> AttributionEngine.VINCaptureFrame {
        .init(imageID: id, vin: vin, exactVIN: exact, takenAt: time, latitude: lat, longitude: lon,
              fileHash: hash, isVehicle: vehicle,
              isDocument: document, isSensitive: sensitive)
    }

    func testDuplicateSerialClaimsDoNotChooseDatabaseOrder() {
        let entries = [(serial: "VIN12345678", vehicleId: "first"),
                       (serial: "vin12345678", vehicleId: "second"),
                       (serial: "UNIQUE12345", vehicleId: "third"),
                       (serial: "UNIQUE12345", vehicleId: "third")]
        for order in [entries, Array(entries.reversed())] {
            let result = AttributionEngine.unambiguousSerialVehicles(order)
            XCTAssertNil(result["VIN12345678"])
            XCTAssertEqual(result["UNIQUE12345"], "third")
        }
    }

    func testManualReviewFilesOnlyTheExplicitSelection() {
        let session = ["mustang", "corvette", "porsche"]
        XCTAssertEqual(AttributionEngine.reviewedPhotoIDs(["mustang", "mustang", "outside-session"], sessionIDs: session), ["mustang"])
        XCTAssertTrue(AttributionEngine.reviewedPhotoIDs([], sessionIDs: session).isEmpty)
    }

    func testMixedShopSessionFilesOnlyEachPhotosOwnSerialMatch() throws {
        let json = #"[{"id":"mustang","vehicle_id":null,"auto_suggested_vehicle_id":"vehicle-a","auto_suggestion_confidence":0.99,"auto_suggestion_reasons":["vin_ocr_match","edit_distance=0"]},{"id":"corvette","vehicle_id":null,"auto_suggested_vehicle_id":"vehicle-a","auto_suggestion_confidence":0.8,"auto_suggestion_reasons":["session_inheritance"]},{"id":"porsche","vehicle_id":null,"auto_suggested_vehicle_id":"vehicle-b","auto_suggestion_confidence":0.99,"auto_suggestion_reasons":["vin_ocr_match"]},{"id":"no-photo-evidence","vehicle_id":null,"auto_suggested_vehicle_id":null,"auto_suggestion_confidence":null,"auto_suggestion_reasons":null},{"id":"already-filed","vehicle_id":"vehicle-b","auto_suggested_vehicle_id":"vehicle-a","auto_suggestion_confidence":0.99,"auto_suggestion_reasons":["vin_ocr_match"]}]"#
        let rows = try JSONDecoder().decode([AttributionEngine.PhotoSuggestion].self, from: Data(json.utf8))
        let ids = Set(rows.map(\.id))
        XCTAssertEqual(AttributionEngine.photoBackedIDs(rows, requestedIDs: ids, vehicleId: "VEHICLE-A"), ["mustang"])
        XCTAssertEqual(AttributionEngine.photoBackedIDs(rows, requestedIDs: ids, vehicleId: "vehicle-b"), ["porsche"])
        XCTAssertTrue(AttributionEngine.photoBackedIDs(rows, requestedIDs: ["corvette", "no-photo-evidence"], vehicleId: "vehicle-a").isEmpty)
        XCTAssertTrue(AttributionEngine.photoBackedIDs(rows, requestedIDs: [], vehicleId: "vehicle-a").isEmpty)
    }

    func testAHighScoreDoesNotTurnSessionInheritanceIntoPhotoEvidence() {
        let row = AttributionEngine.PhotoSuggestion(id: "a", vehicle_id: nil, auto_suggested_vehicle_id: "v",
            auto_suggestion_confidence: 0.99, auto_suggestion_reasons: ["vin_ocr_match", "session_inheritance"])
        XCTAssertTrue(AttributionEngine.photoBackedIDs([row], requestedIDs: ["a"], vehicleId: "v").isEmpty)
        let invalid = AttributionEngine.PhotoSuggestion(id: "a", vehicle_id: nil, auto_suggested_vehicle_id: "v",
            auto_suggestion_confidence: 1.5, auto_suggestion_reasons: ["vin_ocr_match"])
        XCTAssertTrue(AttributionEngine.photoBackedIDs([invalid], requestedIDs: ["a"], vehicleId: "v").isEmpty)
    }

    func testAProfileRequestCountsOnlyPhotosTheServerActuallyFiled() throws {
        func response(_ json: String) throws -> AnyJSON { try JSONDecoder().decode(AnyJSON.self, from: Data(json.utf8)) }
        let partial = try response(#"{"status":"created","filing":{"results":[{"image_id":"a","status":"filed"},{"image_id":"b","status":"deferred"},{"image_id":"c","status":"gate_rejected"},{"image_id":"d","status":"already"}]}}"#)
        XCTAssertEqual(AttributionEngine.profileFiledIDs(from: partial), ["a", "d"])
        XCTAssertTrue(AttributionEngine.profileFiledIDs(from: try response(#"{"status":"ambiguous","candidates":["vehicle-a","vehicle-b"]}"#)).isEmpty)
        XCTAssertTrue(AttributionEngine.profileFiledIDs(from: try response(#"{"status":"created","filing":{}}"#)).isEmpty)
    }

    func testFreshExactVINFoldsNearbyVehicleFramesFromTheSameReadRun() {
        let vin = "1GCEK14L9EJ147915"
        let frames = [capture("plate", vin: vin, exact: true),
                      capture("front", time: "2026-10-18T12:03:00Z", lat: 37.0001, vehicle: true),
                      capture("rear", time: "2026-10-18T12:04:00Z", lat: 37.0002, vehicle: true)]
        XCTAssertEqual(AttributionEngine.vinAnchoredCaptureGroups(frames), [
            .init(vin: vin, anchorImageID: "plate", imageIDs: ["front", "plate", "rear"], vehicleFrameCount: 2)
        ])
    }

    func testContextFoldUsesWalkaroundScaleAndRejectsCompetingVINAnchors() {
        let vinA = "1GCEK14L9EJ147915", vinB = "JT6HJ88J4V0178097"
        XCTAssertTrue(AttributionEngine.vinAnchoredCaptureGroups([
            capture("plate", vin: vinA, exact: true),
            capture("next-bay", time: "2026-10-18T12:01:00Z", lat: 37.0003, vehicle: true)
        ]).isEmpty, "a neighboring bay must not inherit this VIN")
        XCTAssertTrue(AttributionEngine.vinAnchoredCaptureGroups([
            capture("plate-a", vin: vinA, exact: true),
            capture("plate-b", vin: vinB, exact: true, time: "2026-10-18T12:01:00Z", lat: 37.0001),
            capture("front-a", time: "2026-10-18T12:00:30Z", lat: 37, vehicle: true)
        ]).isEmpty, "two VIN anchors in one walkaround neighborhood make the context ambiguous")
    }

    func testInvoiceLabelsAreNeverVehicleIdentityAnchors() {
        for label in ["invoice", "receipt", "document", "form"] {
            XCTAssertTrue(VisionEngine.isIdentityDocument(labels: [label, "car"], isScreenshot: false, ocrLines: []))
        }
        XCTAssertTrue(VisionEngine.isIdentityDocument(labels: ["paper"], isScreenshot: false,
            ocrLines: ["Invoice Number: 10", "Description Quantity Unit Price Cost"]))
        XCTAssertTrue(VisionEngine.isIdentityDocument(labels: ["automobile"], isScreenshot: false,
            ocrLines: ["Description Quantity Unit Price Cost Tax"]))
        XCTAssertFalse(VisionEngine.isIdentityDocument(labels: ["pickup truck"], isScreenshot: false,
            ocrLines: ["VIN 1GCEK14L9EJ147915"]))
    }

    func testIdentityFoldRejectsDocumentsStaleReadsAndAmbiguousVINNeighborhoods() {
        let vinA = "1GCEK14L9EJ147915", vinB = "JT6HJ88J4V0178097"
        for invalidAnchor in [
            capture("old-cache", vin: vinA, exact: true, hash: nil),
            capture("document-vin", vin: vinA, exact: true, document: true),
            capture("sensitive-vin", vin: vinA, exact: true, sensitive: true),
            capture("invalid-vin", vin: "1GCEK14L9EJ147916", exact: true),
        ] {
            XCTAssertTrue(AttributionEngine.vinAnchoredCaptureGroups([
                invalidAnchor, capture("front", vehicle: true)
            ]).isEmpty)
        }
        XCTAssertTrue(AttributionEngine.vinAnchoredCaptureGroups([
            capture("plate", vin: vinA, exact: true),
            capture("late", time: "2026-10-18T12:16:00Z", vehicle: true)
        ]).isEmpty)
        XCTAssertEqual(AttributionEngine.vinAnchoredCaptureGroups([
            capture("plate", vin: vinA, exact: true),
            capture("front", vehicle: true)
        ]).count, 1, "the run plus capture neighborhood is the relation; camera model metadata is not")
        XCTAssertTrue(AttributionEngine.vinAnchoredCaptureGroups([
            capture("plate-a", vin: vinA, exact: true),
            capture("plate-b", vin: vinB, exact: true, time: "2026-10-18T12:01:00Z", lat: 37.0001),
            capture("shared", time: "2026-10-18T12:00:30Z", lat: 37.00005, vehicle: true)
        ]).isEmpty)
    }

    func testCaptureSessionRequestCarriesSourceBoundAnchorAndFreshRunKey() throws {
        let request = AttributionEngine.DeviceProfileRequest(basis: "capture_session", vin: "1GCEK14L9EJ147915",
            serial: nil, year: nil, make: nil, model: nil, album_name: nil, album_native_id: nil,
            image_ids: ["plate", "front"], evidence: [
                "context_method": "vin_capture_session_v1",
                "identifier_read": "1GCEK14L9EJ147915",
                "edit_distance": "0",
                "identifier_legibility": "clear",
                "identity_run_id": UUID().uuidString,
                "identity_method_version": LibraryIngest.identityMethodVersion,
                "anchor_image_id": "plate",
                "anchor_source_sha256": String(repeating: "a", count: 64),
                "read_at": "2026-10-18T12:00:00Z",
            ])
        let json = try JSONSerialization.jsonObject(with: JSONEncoder().encode(request)) as! [String: Any]
        XCTAssertEqual(json["basis"] as? String, "capture_session")
        let evidence = json["evidence"] as? [String: String]
        XCTAssertEqual(evidence?["anchor_image_id"], "plate")
        XCTAssertEqual(evidence?["identity_method_version"], LibraryIngest.identityMethodVersion)
        XCTAssertNotNil(evidence?["identity_run_id"])
        XCTAssertNotEqual(LibraryIngest.identityMethodVersion, LibraryIngest.albumMethodVersion)
    }

    private func album(_ id: String, _ name: String) -> LocalPhotoAlbum {
        LocalPhotoAlbum(id: id, name: name, folderPath: [], sourceKind: "album", photos: [])
    }

    func testMappedAlbumSurvivesDeviceIdentifiersAndWhitespace() {
        let rows = [AttributionEngine.AlbumMapRow(apple_album_id: "ios-source:device:old-id",
                    apple_album_name: "1966 Ford Mustang Cpe Blk", vehicle_id: "vehicle-a")]
        let map = AttributionEngine.albumMap(rows)
        XCTAssertEqual(AttributionEngine.mappedVehicles(for: [album("new-id", " 1966 Ford  Mustang\u{00a0}Cpe BLK ")], in: map), ["vehicle-a"])
        XCTAssertEqual(AttributionEngine.mappedVehicles(for: [album("old-id", "Renamed")], in: map), ["vehicle-a"])
    }

    func testConflictingNamesRemainUnresolvedInEitherDatabaseOrder() {
        let rows = [
            AttributionEngine.AlbumMapRow(apple_album_id: "a", apple_album_name: "1966 Ford Mustang", vehicle_id: "vehicle-a"),
            AttributionEngine.AlbumMapRow(apple_album_id: "b", apple_album_name: "1966  FORD Mustang", vehicle_id: "vehicle-b")
        ]
        for order in [rows, rows.reversed().map { $0 }] {
            let map = AttributionEngine.albumMap(order)
            XCTAssertEqual(AttributionEngine.mappedVehicles(for: [album("new-id", "1966 Ford Mustang")], in: map), ["vehicle-a", "vehicle-b"])
            XCTAssertEqual(AttributionEngine.mappedVehicles(for: [album("a", "1966 Ford Mustang")], in: map), ["vehicle-a"])
        }
    }

    func testOverlappingAlbumsAndUnmappedAlbumsDoNotChooseAVehicle() {
        let rows = [
            AttributionEngine.AlbumMapRow(apple_album_id: "a", apple_album_name: "A", vehicle_id: "vehicle-a"),
            AttributionEngine.AlbumMapRow(apple_album_id: "b", apple_album_name: "B", vehicle_id: "vehicle-b")
        ]
        let map = AttributionEngine.albumMap(rows)
        XCTAssertEqual(AttributionEngine.mappedVehicles(for: [album("a", "A"), album("b", "B")], in: map).count, 2)
        XCTAssertTrue(AttributionEngine.mappedVehicles(for: [album("c", "Unknown")], in: map).isEmpty)
    }

    func testValidVINsPassTheCheckDigit() {
        XCTAssertTrue(VisionEngine.isValidVIN("1GCEK14L9EJ147915"))   // a 1984 K10 on the owner's record
        XCTAssertTrue(VisionEngine.isValidVIN("JT6HJ88J4V0178097"))   // 1997 LX450
        XCTAssertTrue(VisionEngine.isValidVIN("1M8GDM9AXKP042788"))   // check digit X
    }

    func testOneMisreadFailsTheCheckDigit() {
        XCTAssertFalse(VisionEngine.isValidVIN("1GCEK14L9EJ147916"))   // one digit off
        XCTAssertFalse(VisionEngine.isValidVIN("1GCEK14L9EJI47915"))   // I never appears
        XCTAssertFalse(VisionEngine.isValidVIN("CKR187F127263"))       // pre-1981, not 17
    }

    func testVehicleAlbumNamesParse() {
        XCTAssertEqual(AlbumLabel.parse("1973 Dodge charger 360"), AlbumLabel(year: 1973, make: "Dodge", model: "charger 360"))
        XCTAssertEqual(AlbumLabel.parse("1977 K5 Chevrolet Blazer"), AlbumLabel(year: 1977, make: "Chevrolet", model: "K5 Blazer"))
        XCTAssertEqual(AlbumLabel.parse("1983 GMC K2500 BLUE"), AlbumLabel(year: 1983, make: "GMC", model: "K2500 BLUE"))
        XCTAssertEqual(AlbumLabel.parse("1966 Ford Mustang Cpe Blk")?.model, "Mustang Cpe Blk")
    }

    func testNonVehicleAlbumNamesDoNotParse() {
        XCTAssertNil(AlbumLabel.parse("Heidi Reese 2025 ♥️"))
        XCTAssertNil(AlbumLabel.parse("Mr. Logan 2024 Part 1"))
        XCTAssertNil(AlbumLabel.parse("2022"))
        XCTAssertNil(AlbumLabel.parse("VLVA"))
        XCTAssertNil(AlbumLabel.parse("WhatsApp"))
    }
}
