// OnDeviceAnalysisTests.swift — VIN check digit, OCR confusion fixes, and the observation payload.

import XCTest
@testable import NukeCapture

final class OnDeviceAnalysisTests: XCTestCase {
    private let vin = "1HGCM82633A004352"   // a published valid example: check digit 3
    private let source = OnDeviceObservation.Source(framework: "Apple Vision", model: "VNRecognizeTextRequest",
                                                    revision: 3, os_version: "iOS 26.0.0", method: "nuke-ondevice-v1")

    // MARK: ISO 3779 check digit

    func testCheckDigitMatchesPositionNine() {
        XCTAssertEqual(OnDeviceAnalysis.checkDigit(vin), "3")
        XCTAssertTrue(OnDeviceAnalysis.isValidVIN(vin))
        XCTAssertTrue(VisionEngine.isValidVIN(vin.lowercased()))
    }

    func testWrongCheckDigitOrIllegalLetterIsInvalid() {
        XCTAssertFalse(OnDeviceAnalysis.isValidVIN("1HGCM82633A004353"))
        XCTAssertFalse(OnDeviceAnalysis.isValidVIN("1HGCM82633AO04352"))   // O is never legal
        XCTAssertFalse(OnDeviceAnalysis.isValidVIN("1HGCM82633A00435"))    // 16 chars
        XCTAssertNil(OnDeviceAnalysis.checkDigit("1HGCM82633A00435"))
    }

    func testCheckDigitTenIsX() {
        // Position 9 is "X" when the weighted sum mod 11 is 10.
        var chars = Array("1M8GDM9AXKP042788")
        XCTAssertEqual(OnDeviceAnalysis.checkDigit(String(chars)), "X")
        XCTAssertTrue(OnDeviceAnalysis.isValidVIN(String(chars)))
        chars[8] = "9"
        XCTAssertFalse(OnDeviceAnalysis.isValidVIN(String(chars)))
    }

    // MARK: Confusion fixes

    func testIOQAreAlwaysDigits() {
        XCTAssertEqual(OnDeviceAnalysis.normalizeVINConfusions("ihgcm8-2633a oo4352"), "1HGCM82633A004352")
        XCTAssertEqual(OnDeviceAnalysis.checkVIN("1HGCM82633AOO4352"), .validAfterIOQ(vin))
        XCTAssertEqual(OnDeviceAnalysis.checkVIN("IHGCM82633A004352"), .validAfterIOQ(vin))
        XCTAssertEqual(OnDeviceAnalysis.checkVIN("1HGCM82633AQ04352"), .validAfterIOQ(vin))
        XCTAssertEqual(OnDeviceAnalysis.checkVIN(vin), .valid(vin))
    }

    func testSingleUnambiguousGlyphRepair() {
        XCTAssertEqual(OnDeviceAnalysis.checkVIN("1HGCM82633A0043S2"), .validAfterRepair(vin))   // S read for 5
    }

    func testAmbiguousRepairIsRejected() {
        // B→8 and 4→A both validate: two answers means no answer.
        XCTAssertEqual(OnDeviceAnalysis.checkVIN("1HGCMB2633A004352"), .invalid)
        XCTAssertEqual(OnDeviceAnalysis.checkVIN("1HGCM82633A004353"), .invalid)
    }

    func testCheckedVINsOnlyReturnsChecksumValidValues() {
        XCTAssertEqual(VisionEngine.checkedVINs(in: ["VIN 1HGCM82633AOO4352", "PART 12345678901234567"]), [vin])
    }

    // MARK: Scoring and low-confidence rejection

    func testVINConfidenceDropsWithRepairAndLowReadsAreRejected() throws {
        let exact = try XCTUnwrap(OnDeviceAnalysis.scoreVIN(vin, ocrConfidence: 0.9, source: source))
        let ioq = try XCTUnwrap(OnDeviceAnalysis.scoreVIN("1HGCM82633AOO4352", ocrConfidence: 0.9, source: source))
        let repaired = try XCTUnwrap(OnDeviceAnalysis.scoreVIN("1HGCM82633A0043S2", ocrConfidence: 0.9, source: source))
        XCTAssertEqual(exact.confidence, 0.9); XCTAssertEqual(exact.repaired, false)
        XCTAssertEqual(ioq.value, vin); XCTAssertEqual(ioq.repaired, true)
        XCTAssertLessThan(ioq.confidence, exact.confidence)
        XCTAssertLessThan(repaired.confidence, ioq.confidence)
        XCTAssertNil(OnDeviceAnalysis.scoreVIN(vin, ocrConfidence: 0.4, source: source))
        XCTAssertNil(OnDeviceAnalysis.scoreVIN("1HGCM82633A0043S2", ocrConfidence: 0.6, source: source))  // 0.45 after penalty
        XCTAssertNil(OnDeviceAnalysis.scoreVIN("11111111111111111", ocrConfidence: 1, source: source))
    }

    func testClassicSerialAllowedAtLowerConfidence() throws {
        let s = try XCTUnwrap(OnDeviceAnalysis.scoreClassicSerial("CKR187F127263", ocrConfidence: 0.9, source: source))
        XCTAssertEqual(s.kind, .classicSerial)
        XCTAssertEqual(s.confidence, 0.54, accuracy: 0.0001)
        XCTAssertNil(OnDeviceAnalysis.scoreClassicSerial("CKR187F127263", ocrConfidence: 0.8, source: source))
        XCTAssertNil(OnDeviceAnalysis.scoreClassicSerial("12345678", ocrConfidence: 1, source: source))
    }

    func testPlateKeepsGlyphsButAmbiguityCostsConfidence() throws {
        let clear = try XCTUnwrap(OnDeviceAnalysis.scorePlate("7ABC 234", ocrConfidence: 0.95, source: source))
        XCTAssertEqual(clear.value, "7ABC234")
        let ambiguous = try XCTUnwrap(OnDeviceAnalysis.scorePlate("7OBC123", ocrConfidence: 0.95, source: source))
        XCTAssertEqual(ambiguous.value, "7OBC123")
        XCTAssertLessThan(ambiguous.confidence, clear.confidence)
        XCTAssertNil(OnDeviceAnalysis.scorePlate("HELLO", ocrConfidence: 1, source: source))
        XCTAssertNil(OnDeviceAnalysis.scorePlate("7ABC234", ocrConfidence: 0.6, source: source))
    }

    // MARK: Observations

    func testObservationsRankIdentifiersFirstAndDeriveZones() {
        let boxes = [
            OnDeviceAnalysis.TextBox(candidates: [("VIN 1HGCM82633AOO4352", 0.92), (vin, 0.80)]),
            OnDeviceAnalysis.TextBox(candidates: [("faint", 0.1)]),
            OnDeviceAnalysis.TextBox(candidates: [("CHEVROLET", 0.88)]),
        ]
        let obs = OnDeviceAnalysis.observations(textBoxes: boxes, labels: [("engine", 0.6), ("car", 0.3), ("tire", 0.05)],
                                                textSource: source, classifySource: source)
        XCTAssertEqual(obs.first?.kind, .vin)
        XCTAssertEqual(obs.first?.value, vin)
        XCTAssertEqual(obs.filter { $0.kind == .vin }.count, 1, "one VIN, best confidence kept")
        XCTAssertEqual(obs.first(where: { $0.kind == .sceneZone })?.value, "engine_bay")
        XCTAssertTrue(obs.contains { $0.kind == .ocrText && $0.value == "CHEVROLET" })
        XCTAssertFalse(obs.contains { $0.value == "faint" }, "low-confidence OCR is dropped")
        XCTAssertFalse(obs.contains { $0.kind == .classificationLabel && $0.value == "tire" })
        XCTAssertLessThanOrEqual(obs.count, OnDeviceAnalysis.maxObservations)
    }

    func testDocumentsUploadOnlyLabelsAndZones() {
        let obs = [OnDeviceObservation(kind: .vin, value: vin, confidence: 0.9, source: source, repaired: false),
                   OnDeviceObservation(kind: .ocrText, value: "INVOICE", confidence: 0.9, source: source),
                   OnDeviceObservation(kind: .classificationLabel, value: "document", confidence: 0.8, source: source)]
        XCTAssertEqual(OnDeviceAnalysis.uploadable(obs, isDocument: true).map(\.kind), [.classificationLabel])
        XCTAssertEqual(OnDeviceAnalysis.uploadable(obs, isDocument: false).count, 3)
    }

    func testPayloadEncodingIsStableAndRoundTrips() throws {
        let o = OnDeviceObservation(kind: .vin, value: vin, confidence: 0.91234, source: source, repaired: true)
        let json = try XCTUnwrap(OnDeviceAnalysis.encode([o]))
        XCTAssertEqual(json, #"[{"confidence":0.912,"kind":"vin","repaired":true,"source":{"framework":"Apple Vision","method":"nuke-ondevice-v1","model":"VNRecognizeTextRequest","os_version":"iOS 26.0.0","revision":3},"value":"1HGCM82633A004352"}]"#)
        XCTAssertEqual(OnDeviceAnalysis.decode(json), [o])
        let label = OnDeviceObservation(kind: .sceneZone, value: "interior", confidence: 2, source: source)
        let labelJSON = try XCTUnwrap(OnDeviceAnalysis.encode([label]))
        XCTAssertFalse(labelJSON.contains("repaired"), "non-identifiers omit the repaired flag")
        XCTAssertTrue(labelJSON.contains(#""confidence":1"#), "confidence is clamped to 1")
        XCTAssertEqual(OnDeviceAnalysis.decode(nil), [])
        XCTAssertEqual(OnDeviceAnalysis.decode("not json"), [])
    }

    func testAlbumReviewCarriesObservationsThroughLocalStore() throws {
        let o = OnDeviceObservation(kind: .classificationLabel, value: "car", confidence: 0.7, source: source)
        let review = LocalAlbumImageReview(id: "r", localIdentifier: "l", sourceVersion: nil, inputSHA256: "h",
            methodVersion: "m", analyzedAt: Date(), isVehicle: true, hasPerson: false, labelsJSON: "[]",
            vinCandidatesJSON: "[]", textLinesJSON: "[]", onDeviceJSON: OnDeviceAnalysis.encode([o]))
        XCTAssertEqual(review.onDeviceObservations, [o])
    }
}

final class OnDeviceVINReadTests: XCTestCase {
    func testGluedLabelAndSpacedVINAreRead() {
        XCTAssertEqual(OnDeviceAnalysis.vinReads(in: "VIN:1HGCM82633A004352"), [.valid("1HGCM82633A004352")])
        XCTAssertEqual(OnDeviceAnalysis.vinReads(in: "VIN1HGCM82633AOO4352"), [.validAfterIOQ("1HGCM82633A004352")])
        XCTAssertEqual(OnDeviceAnalysis.vinReads(in: "1HGCM 82633 A004352"), [.valid("1HGCM82633A004352")])
    }

    func testSpacedRunNeverGetsAGlyphRepair() {
        XCTAssertEqual(OnDeviceAnalysis.vinReads(in: "1HGCM 82633 A0043S2"), [])
        XCTAssertEqual(OnDeviceAnalysis.vinReads(in: "1HGCM82633A0043S2"), [.validAfterRepair("1HGCM82633A004352")])
    }
}
