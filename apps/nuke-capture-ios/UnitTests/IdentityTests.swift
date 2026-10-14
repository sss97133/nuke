// IdentityTests.swift — the masthead title follows the web's identity rule (utils/vehicleIdentity.ts).
// Its own file so it never collides with other suites' insertions in DecodeTests.swift.

import XCTest
@testable import NukeCapture

final class IdentityTests: XCTestCase {
    func testVehicleIdentityTokensFollowTheWebRule() throws {
        // The K5: normalized model over model, series inside the model dropped, trim kept, an automatic Chevrolet gets no transmission token.
        let k5 = VehicleIdentity.tokens(year: 1977, make: "Chevrolet", model: "Blazer", normalizedModel: "K5 Blazer", series: "K5",
                                        trim: "Cheyenne", transmission: "Automatic", transmissionModel: "6L90")
        XCTAssertEqual(k5.all, ["1977", "Chevrolet", "K5 Blazer", "Cheyenne"])
        // A Porsche with a manual: the transmission is a differentiator, as on the web.
        let p = VehicleIdentity.tokens(year: 1989, make: "Porsche", model: "911", normalizedModel: nil, series: nil,
                                       trim: "Carrera", transmission: "5-speed manual", transmissionModel: nil)
        XCTAssertEqual(p.all, ["1989", "Porsche", "911", "Carrera", "5-speed manual"])
        // A listing-polluted model is sanitized: leading year and make, the site name, the lot number.
        XCTAssertEqual(VehicleIdentity.sanitize("1977 Chevrolet K5 Blazer (Lot #12345) | Bring a Trailer", year: 1977, make: "Chevrolet"), "K5 Blazer")
        XCTAssertEqual(VehicleIdentity.sanitize("42k-Mile 911 Carrera - $85,000 (Torrance)", year: nil, make: ""), "911 Carrera")
        // The title drops differentiators past 55 characters, never primary tokens.
        let long = VehicleIdentity.Tokens(primary: ["1969", "Chevrolet", "Camaro"], differentiators: ["Z/28 Rally Sport Package", "Hugger Orange Special", "4-speed manual"])
        XCTAssertEqual(VehicleIdentity.title(long), "1969 Chevrolet Camaro Z/28 Rally Sport Package")
        // Nothing known: no tokens, so the chips fall back to the row.
        XCTAssertEqual(VehicleIdentity.tokens(year: nil, make: nil, model: nil, normalizedModel: nil, series: nil, trim: nil, transmission: nil, transmissionModel: nil).all, [])
    }
}
