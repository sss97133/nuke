import XCTest
import SwiftUI
@testable import NukeCapture

@MainActor
final class LocalDocumentContextTests: XCTestCase {
    private let header = ["CERTIFICATE OF TITLE", "YEAR", "1973", "MAKE", "PONT"]
    private func review(_ lines: [String], version: String? = "current", method: String = "current", id: String = "asset") -> LocalAlbumImageReview {
        .init(id: "fixture", localIdentifier: id, sourceVersion: version, inputSHA256: String(repeating: "a", count: 64),
              methodVersion: method, analyzedAt: Date(timeIntervalSince1970: 12345), isVehicle: false, hasPerson: false,
              labelsJSON: "[]", vinCandidatesJSON: "[]", textLinesJSON: String(decoding: try! JSONEncoder().encode(lines), as: UTF8.self))
    }
    private func read(_ review: LocalAlbumImageReview?) -> LocalDocumentContext {
        .read(review, assetId: "asset", sourceVersion: "current", method: "current", makes: ["Pontiac"])
    }

    func testCurrentDocumentHasVehicleContextOnly() {
        let context = read(review(header + ["VIN", "2S87R3N100001", "OWNER", "PRIVATE PERSON", "PRIVATE ADDRESS"]))
        XCTAssertEqual(context, .init(state: .decoded, year: 1973, make: "Pontiac", printedIdentifier: "2S87R3N100001"))
    }

    func testCompetingOrUnreadableIdentifierSuppressesDocumentContext() {
        for fields in [["VIN", "2S87R3N100001", "VIN 2S87R3N100009"], ["VIN", "unreadable"]] {
            let context = read(review(header + fields))
            XCTAssertEqual(context.state, .unresolved)
            XCTAssertNil(context.printedIdentifier)
            XCTAssertNil(context.make)
        }
    }

    func testNoCurrentSourceCannotExposeEarlierDocumentFields() {
        for value in [nil, review(header, version: nil), review(header, version: "old"), review(header, method: "old"), review(header, id: "other")] {
            XCTAssertEqual(read(value), .init(state: .unavailable))
        }
    }

    func testReceiptWithoutVehicleContextDoesNotExposeItsPersonalText() {
        XCTAssertEqual(read(review(["RECEIPT", "PRIVATE PERSON", "PRIVATE ADDRESS"])), .init(state: .unresolved))
    }

    func testLocalOnlyDocumentAndUnknownContextNeverRenderRetainedCloudNarrative() {
        for context in [read(review(header + ["VIN", "2S87R3N100001"])),
                        read(review(["RECEIPT", "PRIVATE PERSON"])), read(nil), read(review(header, version: "old"))] {
            XCTAssertFalse(context.showsRetainedNarrative(localOnly: true, isPersonal: false, labels: [], isScreenshot: false))
        }
        XCTAssertTrue(read(review(["PONTIAC BADGE"])).showsRetainedNarrative(localOnly: true, isPersonal: false, labels: [], isScreenshot: false))
    }

    func testNormalPhotoWithoutAlbumReadKeepsQualifiedRetainedAnalysis() {
        let context = read(nil)
        XCTAssertTrue(context.showsRetainedNarrative(localOnly: false, isPersonal: false, labels: ["car"], isScreenshot: false))
        XCTAssertFalse(context.showsRetainedNarrative(localOnly: true, isPersonal: false, labels: ["car"], isScreenshot: false))
        XCTAssertFalse(context.showsRetainedNarrative(localOnly: false, isPersonal: true, labels: ["car"], isScreenshot: false))
        XCTAssertFalse(context.showsRetainedNarrative(localOnly: false, isPersonal: false, hasPerson: true, labels: ["car"], isScreenshot: false))
        XCTAssertFalse(context.showsRetainedNarrative(localOnly: false, isPersonal: false, labels: ["document"], isScreenshot: false))
        let document = read(review(header + ["VIN", "2S87R3N100001"]))
        XCTAssertFalse(document.showsRetainedNarrative(localOnly: false, isPersonal: false, labels: ["car"], isScreenshot: false))
    }

    func testContextViewRendersLimitsAndNoPersonalFields() throws {
        let context = read(review(header + ["VIN", "2S87R3N100001", "PRIVATE PERSON"]))
        let renderer = ImageRenderer(content: LocalDocumentContextRows(context: context)
            .padding().frame(width: 380).background(Color.white).environment(\.colorScheme, .light))
        renderer.scale = 2
        let image = try XCTUnwrap(renderer.uiImage)
        let attachment = XCTAttachment(image: image)
        attachment.name = "local-document-context-limits"
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
