import XCTest
@testable import NukeCapture

final class PhotoVehicleCheckTests: XCTestCase {
    private func h(_ make: String?, _ model: String? = nil) -> PhotoVehicleCheck.Hint { .init(make: make, model: model) }

    func testMustangPhotosOnAChevroletTruckConflict() {
        let v = PhotoVehicleCheck.verdict(hints: [h("Ford", "Mustang"), h("Ford", "Mustang"), h("Chevrolet")],
                                          make: "Chevrolet", model: "C10")
        XCTAssertEqual(v, .conflicts(readAs: "Ford Mustang", count: 2, of: 3))
    }

    func testMatchingMakeAgrees() {
        XCTAssertEqual(PhotoVehicleCheck.verdict(hints: [h("Chevrolet", "C10"), h("chevy")], make: "Chevrolet", model: "C10"), .agrees(1))
    }

    func testReadsWithoutAMakeSayNothing() {
        XCTAssertEqual(PhotoVehicleCheck.verdict(hints: [h(nil), h("")], make: "Ford", model: nil), .noReads)
        XCTAssertEqual(PhotoVehicleCheck.verdict(hints: [], make: "Ford", model: nil), .noReads)
    }
}
