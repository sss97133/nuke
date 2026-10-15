// DeviceAttributionTests.swift — the two client checks behind filing and new vehicle profiles:
// the VIN check digit (an OCR run must be a VIN, not a 17-character part number) and the album
// label reader (an album named after a vehicle, not a client, a year or an org).

import XCTest
@testable import NukeCapture

final class DeviceAttributionTests: XCTestCase {
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
