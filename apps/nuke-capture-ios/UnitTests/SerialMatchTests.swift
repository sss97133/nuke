// SerialMatchTests.swift — the VIN / chassis-number matcher the phone files photos by.
//
// Before 2026-10-15 only 17-character runs were read, so the pre-1981 serials on most of the
// owner's trucks (13 characters on a 1977 K5, 11 on a 1971 Bronco) could never match. Short
// serials now match at their own length with fewer misreads allowed; these tests pin that a short
// serial still cannot match by accident.

import XCTest
@testable import NukeCapture

final class SerialMatchTests: XCTestCase {
    private let known = ["CKR187F127263", "U15GLK32565", "1GTGK24M1DJ514592", "AZ370615", "12345678"]

    func testSeventeenCharacterVINRecoversTwoMisreads() {
        let m = VisionEngine.matchSerial(in: ["VIN 1GTGK24M1DJ5I4S92"], known: known)
        XCTAssertEqual(m?.vin, "1GTGK24M1DJ514592")
        XCTAssertEqual(m?.editDistance, 2)
    }

    func testThirteenCharacterSerialMatchesInsideALineWithOneMisread() {
        let m = VisionEngine.matchSerial(in: ["SERIAL NO. CKR187F127Z63 GM"], known: known)
        XCTAssertEqual(m?.vin, "CKR187F127263")
        XCTAssertEqual(m?.editDistance, 1)
    }

    func testElevenCharacterSerialMatchesAcrossSpacesAndDashes() {
        XCTAssertEqual(VisionEngine.matchSerial(in: ["U15 GLK-32565"], known: known)?.vin, "U15GLK32565")
    }

    func testThirteenCharacterSerialWithTwoMisreadsDoesNotMatch() {
        XCTAssertNil(VisionEngine.matchSerial(in: ["CKR187F1Z7Z63"], known: known))
    }

    func testShortSerialNeedsAnExactRead() {
        XCTAssertEqual(VisionEngine.matchSerial(in: ["AZ370615"], known: known)?.vin, "AZ370615")
        XCTAssertNil(VisionEngine.matchSerial(in: ["AZ370616"], known: known))
    }

    func testDigitsOnlySerialNeverMatches() {
        XCTAssertNil(VisionEngine.matchSerial(in: ["CALL 12345678 TODAY"], known: known))
    }
}
