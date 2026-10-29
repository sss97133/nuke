// CaptureContextTests.swift — a classic serial's year/make from the capture session, not an album.
//
// The 2026-10-28 Firebird (a Trans Am clone) had a cowl tag `ST73 2FS87` and a PONTIAC badge in the
// same run, and no album. These pin the tag decoder, the context ranking (document > tag > badge),
// and when a classic serial group is eligible for a profile.

import XCTest
@testable import NukeCapture

@MainActor
final class CaptureContextTests: XCTestCase {
    private let makes = ["Pontiac", "Chevrolet", "Oldsmobile", "Buick", "Cadillac", "Ford"]
    private let sourceHash = String(repeating: "a", count: 64)

    private func frame(_ id: String, vin: String? = nil, time: String = "2026-10-18T12:00:00Z",
                       lat: Double = 37, vehicle: Bool = true, document: Bool = false) -> AttributionEngine.VINCaptureFrame {
        .init(imageID: id, vin: vin, exactVIN: vin != nil, takenAt: time, latitude: lat, longitude: -122,
              fileHash: sourceHash, isVehicle: vin == nil ? vehicle : false, isDocument: document, isSensitive: false,
              contextualYear: nil, contextualMake: nil, contextualModel: nil, albumContextAmbiguous: false)
    }
    private func read(_ id: String, _ method: CaptureContextMethod, make: String, year: Int? = nil,
                      model: String? = nil, serial: String? = nil, time: String = "2026-10-18T12:02:00Z",
                      lat: Double = 37) -> CaptureContextRead {
        .init(imageID: id, method: method, year: year, make: make, model: model, documentSerial: serial,
              takenAt: time, latitude: lat, longitude: -122)
    }

    // ─── Cowl tag decoder ────────────────────────────────────────────────────
    func testFisherTagDecodesYearMakeAndSeries() {
        let t = CaptureContextReader.decodeCowlTag(["BODY BY FISHER", "ST73 2FS87 N 189504 BDY", "TR 232 A51", "75 75 PNT"])
        XCTAssertEqual(t?.modelYear, 1973)
        XCTAssertEqual(t?.make, "Pontiac")
        XCTAssertEqual(t?.model, "Firebird")
        XCTAssertEqual(t?.code, "2FS87")
        XCTAssertEqual(t?.bodyLetter, "F")
    }

    func testTagWithoutFisherWordsStillReadsFromItsOwnFields() {
        let t = CaptureContextReader.decodeCowlTag(["ST 73-2FV87 N 123456 BDY", "TR 232", "PNT 75"])
        XCTAssertEqual(t?.model, "Firebird Trans Am")
        XCTAssertEqual(CaptureContextReader.decodeCowlTag(["ST73 1FQ87 BDY", "TR 711"])?.make, "Chevrolet")
    }

    func testUnknownSeriesDecodesMakeAndYearOnly() {
        let t = CaptureContextReader.decodeCowlTag(["BODY BY FISHER", "ST72 3AJ37"])
        XCTAssertEqual(t?.make, "Oldsmobile")
        XCTAssertEqual(t?.modelYear, 1972)
        XCTAssertNil(t?.model)
    }

    func testNotATagNoRead() {
        XCTAssertNil(CaptureContextReader.decodeCowlTag(["ST73 2FS87"]))            // no tag marker
        XCTAssertNil(CaptureContextReader.decodeCowlTag(["BODY BY FISHER", "ST73 5FS87"])) // no division 5
        XCTAssertNil(CaptureContextReader.decodeCowlTag(["BODY BY FISHER", "nothing here"]))
    }

    // ─── Badge + document reads ──────────────────────────────────────────────
    func testBadgeIsAWholeLineWordmark() {
        XCTAssertEqual(CaptureContextReader.badgeMake(["PONTIAC"], makes: makes), "Pontiac")
        XCTAssertNil(CaptureContextReader.badgeMake(["Pontiac parts catalog 1973"], makes: makes))
        XCTAssertNil(CaptureContextReader.badgeMake(["PONTIAC", "CHEVROLET"], makes: makes))
    }

    func testTitleDocumentReadsYearMakeAndSerial() {
        let d = CaptureContextReader.decodeDocument(["CERTIFICATE OF TITLE", "YEAR 1973 MAKE PONT",
                                                     "VIN 2S87R3N100001"], makes: makes)
        XCTAssertEqual(d?.year, 1973)
        XCTAssertEqual(d?.make, "Pontiac")
        XCTAssertNil(CaptureContextReader.decodeDocument(["INVOICE", "PONTIAC 1973"], makes: makes))
    }

    func testReadsAreGatedByFrameKind() {
        let tag = ["BODY BY FISHER", "ST73 2FS87 BDY", "TR 232"]
        XCTAssertEqual(CaptureContextReader.reads(imageID: "t", lines: tag, isVehicle: false, isDocument: false,
            takenAt: nil, latitude: nil, longitude: nil, makes: makes).map(\.method), [.cowlTag])
        XCTAssertTrue(CaptureContextReader.reads(imageID: "b", lines: ["PONTIAC"], isVehicle: false, isDocument: false,
            takenAt: nil, latitude: nil, longitude: nil, makes: makes).isEmpty)   // a badge needs a vehicle frame
    }

    // ─── Ranking ─────────────────────────────────────────────────────────────
    func testStrongestMethodWins() {
        let reads = [read("badge", .badge, make: "Chevrolet"),
                     read("tag", .cowlTag, make: "Pontiac", year: 1973, model: "Firebird"),
                     read("title", .document, make: "Pontiac", year: 1973)]
        let c = CaptureContextReader.resolve(reads, serial: "2S87R3N100001")
        XCTAssertEqual(c?.method, .document)
        XCTAssertEqual(c?.make, "Pontiac")
        XCTAssertEqual(c?.year, 1973)
        XCTAssertEqual(c?.model, "Firebird")     // filled from the agreeing tag
        XCTAssertEqual(c?.imageIDs, ["title"])
    }

    func testDocumentForAnotherSerialIsSkipped() {
        let reads = [read("title", .document, make: "Ford", year: 1970, serial: "0F02H100001"),
                     read("tag", .cowlTag, make: "Pontiac", year: 1973)]
        XCTAssertEqual(CaptureContextReader.resolve(reads, serial: "2S87R3N100001")?.method, .cowlTag)
    }

    func testDisagreeingReadsAtTheTopAreAmbiguous() {
        XCTAssertNil(CaptureContextReader.resolve([read("a", .badge, make: "Pontiac"), read("b", .badge, make: "Chevrolet")],
                                                  serial: nil))
    }

    func testContextEvidenceNamesFramesAndMethod() {
        let e = CaptureContextReader.resolve([read("tag", .cowlTag, make: "Pontiac", year: 1973)], serial: nil)!.evidence
        XCTAssertEqual(e["identity_context_method"], "cowl_tag_ocr")
        XCTAssertEqual(e["identity_context_image_ids"], "tag")
        XCTAssertEqual(e["identity_context_year"], "1973")
    }

    // ─── Group eligibility ───────────────────────────────────────────────────
    private let serial = "2S87R3N100001"

    func testClassicSerialWithNoContextIsNotEligible() {
        let frames = [frame("plate", vin: serial), frame("front", time: "2026-10-18T12:01:00Z")]
        XCTAssertTrue(AttributionEngine.vinAnchoredCaptureGroups(frames).isEmpty)
    }

    func testClassicSerialPlusDocumentContextMakesAGroup() {
        let frames = [frame("plate", vin: serial), frame("front", time: "2026-10-18T12:01:00Z"),
                      frame("title", time: "2026-10-18T12:02:00Z", vehicle: false, document: true)]
        let reads = [read("title", .document, make: "Pontiac", year: 1973, serial: serial)]
        let g = AttributionEngine.vinAnchoredCaptureGroups(frames, contexts: reads)
        XCTAssertEqual(g.count, 1)
        XCTAssertEqual(g.first?.make, "Pontiac")
        XCTAssertEqual(g.first?.year, 1973)
        XCTAssertEqual(g.first?.imageIDs, ["front", "plate"])   // the document is context, never a member
        XCTAssertEqual(g.first?.context?.method, .document)
    }

    func testClassicSerialPlusCowlTagMakesAGroup() {
        let frames = [frame("plate", vin: serial), frame("tag", time: "2026-10-18T12:02:00Z"),
                      frame("rear", time: "2026-10-18T12:04:00Z")]
        let reads = [read("tag", .cowlTag, make: "Pontiac", year: 1973, model: "Firebird")]
        let g = AttributionEngine.vinAnchoredCaptureGroups(frames, contexts: reads).first
        XCTAssertEqual(g?.make, "Pontiac")
        XCTAssertEqual(g?.model, "Firebird")
        XCTAssertEqual(g?.context?.imageIDs, ["tag"])
    }

    func testContextFromAnotherRunDoesNotCount() {
        let frames = [frame("plate", vin: serial), frame("front", time: "2026-10-18T12:01:00Z")]
        let farAway = [read("tag", .cowlTag, make: "Pontiac", year: 1973, time: "2026-10-18T15:00:00Z")]
        XCTAssertTrue(AttributionEngine.vinAnchoredCaptureGroups(frames, contexts: farAway).isEmpty)
    }

    func testTagOnlySessionCreatesNoProfileAndAsksForThePlate() {
        let frames = [frame("tag"), frame("hood", time: "2026-10-18T12:01:00Z"), frame("seat", time: "2026-10-18T12:03:00Z")]
        let reads = [read("tag", .cowlTag, make: "Pontiac", year: 1973, model: "Firebird", time: "2026-10-18T12:00:00Z")]
        XCTAssertTrue(AttributionEngine.vinAnchoredCaptureGroups(frames, contexts: reads).isEmpty)
        let pending = AttributionEngine.pendingIdentifiers(frames: frames, reads: reads, groups: [])
        XCTAssertEqual(pending.count, 1)
        XCTAssertEqual(pending.first?.framesWaiting, 3)
        XCTAssertEqual(pending.first?.line, "1973 Pontiac Firebird: needs the VIN plate · 3 photos waiting")
    }

    func testASessionWithASerialReadIsNotPending() {
        let frames = [frame("plate", vin: serial), frame("tag", time: "2026-10-18T12:01:00Z")]
        let reads = [read("tag", .cowlTag, make: "Pontiac", year: 1973)]
        XCTAssertTrue(AttributionEngine.pendingIdentifiers(frames: frames, reads: reads, groups: []).isEmpty)
    }
}
