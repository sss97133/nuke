import XCTest
@testable import NukeCapture

final class HeroImageSelectionTests: XCTestCase {
    private func image(_ fields: [String: Any] = [:]) throws -> VehicleGalleryImage {
        let base: [String: Any] = ["id": UUID().uuidString, "image_url": "https://example.test/photo.jpg"]
        return try JSONDecoder().decode(VehicleGalleryImage.self, from: JSONSerialization.data(withJSONObject: base.merging(fields) { _, new in new }))
    }
    func testUnclassifiedGalleryCannotSupplyAnArbitraryInvoiceLead() throws {
        let unread = try image(["is_document": false])
        XCTAssertNil(VehicleGalleryImage.chooseHero(cover: nil, candidates: [], gallery: [unread]))
    }
    func testExplicitPermittedCoverWinsOverUnclassifiedGallery() throws {
        let cover = try image(["is_primary": true])
        let unread = try image(["created_at": "2026-10-18T12:00:00Z"])
        XCTAssertEqual(VehicleGalleryImage.chooseHero(cover: cover, candidates: [], gallery: [unread])?.id, cover.id)
    }
    func testDocumentSignalsVetoEveryHeroRouteEvenIfMarkedExteriorOrPrimary() throws {
        let cases: [[String: Any]] = [["is_document": true], ["image_category": "documentation"],
            ["vision_gate_agent_reasoning": "Photograph of a restoration invoice"], ["labels": ["scene:receipt"]]]
        for fields in cases {
            let document = try image(["image_category": "exterior_body", "is_primary": true].merging(fields) { _, new in new })
            XCTAssertNil(VehicleGalleryImage.chooseHero(cover: document, candidates: [document], gallery: [document]))
        }
    }
    func testClassifiedVehiclePhotoRemainsAvailableWhenCoverIsRejected() throws {
        let invoice = try image(["image_category": "documentation"])
        let car = try image(["image_category": "exterior_body"])
        XCTAssertEqual(VehicleGalleryImage.chooseHero(cover: invoice, candidates: [car], gallery: [invoice])?.id, car.id)
    }
}
