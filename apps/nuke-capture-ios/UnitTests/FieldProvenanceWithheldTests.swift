// FieldProvenanceWithheldTests.swift — get_field_provenance's withheld shape (20261125175500) decodes and reads in the
// same words as the web (nuke_frontend/src/pages/vehicle-profile/hooks/useFieldProvenance.ts withheldFieldWords).

import XCTest
@testable import NukeCapture

final class FieldProvenanceWithheldTests: XCTestCase {
    func testWithheldShapeDecodesAndSaysPrivate() throws {
        let json = #"{"field":"owner_name","vehicle_id":"00000000-0000-0000-0000-0000000000a1","value":null,"withheld":true,"withheld_reason":"column_not_public","inline_source":null,"inline_confidence":null,"source_image_url":null,"current_correction":null,"coverage":null,"evidence":[],"observations":[],"image_observations":[]}"#
        let p = try JSONDecoder().decode(FieldProvenance.self, from: Data(json.utf8))
        XCTAssertEqual(p.withheld, true)
        XCTAssertEqual(FieldProvenance.withheldWords(p.withheld_reason), "Private: only the owner and the people tied to this car can see this field.")
        XCTAssertEqual(FieldProvenance.withheldWords("field_not_recognized"), "This record has no field by that name.")
    }

    func testAnOrdinaryAnswerIsNotWithheld() throws {
        let json = #"{"field":"vin","value":"X","inline_source":"vin_decode","source_image_url":null,"evidence":[],"observations":[],"image_observations":[]}"#
        let p = try JSONDecoder().decode(FieldProvenance.self, from: Data(json.utf8))
        XCTAssertNil(p.withheld)
    }
}
