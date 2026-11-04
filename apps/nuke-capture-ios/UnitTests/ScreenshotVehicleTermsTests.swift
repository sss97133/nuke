// ScreenshotVehicleTermsTests — what on-device text may let a screenshot leave the phone.

import XCTest
@testable import NukeCapture

final class ScreenshotVehicleTermsTests: XCTestCase {
    func testAValidVINMatches() {
        XCTAssertEqual(ScreenshotVehicleTerms.hit(in: "VIN: 1M8GDM9AXKP042788\nMileage 82,000")?.classes, ["vin"])
    }

    func testAVINWithABadCheckDigitDoesNot() {
        XCTAssertNil(ScreenshotVehicleTerms.hit(in: "1M8GDM9A1KP042788"))
    }

    func testOCRConfusionsOfIOAndQAreRead() {
        // The valid VIN with its zero misread as the letter O: 042788 -> O42788.
        XCTAssertNotNil(ScreenshotVehicleTerms.hit(in: "1M8GDM9AXKPO42788"))
    }

    func testALongRunOfDigitsIsNotAVIN() {
        XCTAssertNil(ScreenshotVehicleTerms.hit(in: "tracking 11111111111111111"))
    }

    func testYearAndMakeMatch() {
        XCTAssertEqual(ScreenshotVehicleTerms.hit(in: "Asking $18,500 for the 1972 Chevrolet C10")?.classes, ["year_make"])
        XCTAssertNotNil(ScreenshotVehicleTerms.hit(in: "2004 bmw 330ci"))
        XCTAssertNotNil(ScreenshotVehicleTerms.hit(in: "1969 Land Rover Series IIA"))
    }

    func testBothClassesAreReported() {
        XCTAssertEqual(ScreenshotVehicleTerms.hit(in: "1991 Ford F-150\n1M8GDM9AXKP042788")?.classes, ["vin", "year_make"])
    }

    func testOrdinaryTextDoesNotMatch() {
        XCTAssertNil(ScreenshotVehicleTerms.hit(in: "Running late, can you grab the truck? Dinner at 7."))
        XCTAssertNil(ScreenshotVehicleTerms.hit(in: "In 1972 we moved. My ford is a river crossing."), "year then a make word only when adjacent")
        XCTAssertNil(ScreenshotVehicleTerms.hit(in: "Meeting 2031 Ford"), "year out of range")
        XCTAssertNil(ScreenshotVehicleTerms.hit(in: ""))
    }

    func testTheCheckDigitRoutine() {
        XCTAssertTrue(ScreenshotVehicleTerms.checkDigitIsValid("1M8GDM9AXKP042788"))
        XCTAssertFalse(ScreenshotVehicleTerms.checkDigitIsValid("1M8GDM9AXKP04278"), "16 characters")
        XCTAssertFalse(ScreenshotVehicleTerms.checkDigitIsValid("1M8GDM9AXKPI42788"), "I is not allowed in a VIN")
    }
}
