// MediaAttributionGateTests.swift — a video attributes ONLY by what its frames show.
// Owner rule (2026-11-04): same confidence threshold, same classifier, plate/VIN readers and filing gate as photos;
// time and GPS never attribute; anything below the threshold stays on the phone.

import XCTest
@testable import NukeCapture

final class MediaAttributionGateTests: XCTestCase {
    private let vin = "1HGCM82633A004352"
    private let otherVIN = "1GCEK14L9EJ147915"
    private let roster = [MediaRosterVehicle(id: "V1", vin: "1HGCM82633A004352"),
                          MediaRosterVehicle(id: "V2", vin: "1GCEK14L9EJ147915")]

    private func frame(_ decision: VisionDecision.Category = .work, document: Bool = false, exact: String? = nil,
                       reads: Set<String> = [], unknown: Bool = false) -> FrameEvidence {
        FrameEvidence(decision: decision, isDocument: document, exactVehicleID: exact,
                      readVehicleIDs: reads, unrecognizedIdentifier: unknown)
    }
    private func clip(_ frames: [FrameEvidence], candidates: Set<String> = ["V1", "V2"],
                      lengths: [String: Int] = ["V1": 17, "V2": 17], screen: Bool = false) -> MediaGateVerdict {
        MediaAttributionGate.evaluate(isScreenCapture: screen, frames: frames, framesRequested: frames.count,
                                      candidates: candidates, vinLengthByVehicle: lengths)
    }
    private var plain: [FrameEvidence] { Array(repeating: frame(), count: 11) }

    // ─── Clears ───────────────────────────────────────────────────────────────

    func testOneExactReadOfACandidateClearsAtThePhotoConfidence() {
        let v = clip(plain + [frame(exact: "V1", reads: ["V1"])])
        XCTAssertEqual(v, .cleared(MediaClearance(vehicleID: "V1", method: "vin_ocr", confidence: 0.99, exactFrames: 1)))
        XCTAssertGreaterThanOrEqual(0.99, MediaAttributionGate.confidenceFloor)
    }

    func testAShorterSerialClearsAsSerialOCRAtPhotoConfidence() {
        let v = clip(plain + [frame(exact: "V1", reads: ["V1"])], lengths: ["V1": 11])
        XCTAssertEqual(v, .cleared(MediaClearance(vehicleID: "V1", method: "serial_ocr", confidence: 0.97, exactFrames: 1)))
    }

    func testManyFramesOfTheSameVehicleStillClearOnce() {
        let hit = frame(exact: "V1", reads: ["V1"])
        let v = clip([hit, hit, frame(reads: ["V1"]), hit] + Array(repeating: frame(), count: 8))
        guard case .cleared(let c) = v else { return XCTFail("\(v)") }
        XCTAssertEqual(c.exactFrames, 3)
    }

    // ─── Refusals: the clip stays on the phone ────────────────────────────────

    func testNoIdentifierReadMeansNoAttributionWhateverTheTimeAndPlace() {
        XCTAssertEqual(clip(plain + [frame()]), .refused(.noIdentifierRead))
        XCTAssertEqual(clip(plain + [frame(reads: ["V1"])]), .refused(.noIdentifierRead), "an inexact read is not an attribution")
    }

    func testAScreenCaptureNeverClears() {
        XCTAssertEqual(clip(plain + [frame(exact: "V1", reads: ["V1"])], screen: true), .refused(.screenCapture))
    }

    func testAnyFrameThePhotoRuleWouldHoldKeepsTheWholeClipOnThePhone() {
        for held in [VisionDecision.Category.workWithPeople, .sensitive, .notWork] {
            XCTAssertEqual(clip(plain + [frame(held), frame(exact: "V1", reads: ["V1"])]), .refused(.privacy), "\(held)")
        }
    }

    func testADocumentFrameRefuses() {
        XCTAssertEqual(clip(plain + [frame(document: true), frame(exact: "V1", reads: ["V1"])]), .refused(.document))
    }

    func testTwoVehiclesReadInOneClipIsConflictingAndRefused() {
        let v = clip(plain + [frame(exact: "V1", reads: ["V1"]), frame(exact: "V2", reads: ["V2"])])
        XCTAssertEqual(v, .refused(.conflictingReads))
    }

    func testAnInexactReadOfAnotherVehicleBlocksAnExactRead() {
        XCTAssertEqual(clip(plain + [frame(exact: "V1", reads: ["V1"]), frame(reads: ["V2"])]), .refused(.conflictingReads))
    }

    func testAnUnrecognizedIdentifierInTheClipBlocks() {
        XCTAssertEqual(clip(plain + [frame(exact: "V1", reads: ["V1"]), frame(unknown: true)]), .refused(.conflictingReads))
    }

    func testAReadOfAVehicleTimeAndPlaceDidNotNarrowToIsRefused() {
        XCTAssertEqual(clip(plain + [frame(exact: "V2", reads: ["V2"])], candidates: ["V1"]), .refused(.outsideCandidates))
        XCTAssertEqual(clip(plain + [frame(exact: "V1", reads: ["V1"])], candidates: []), .refused(.outsideCandidates))
    }

    func testAVehicleWithoutAUsableSerialCannotClear() {
        XCTAssertEqual(clip(plain + [frame(exact: "V1", reads: ["V1"])], lengths: [:]), .refused(.belowThreshold))
        XCTAssertEqual(clip(plain + [frame(exact: "V1", reads: ["V1"])], lengths: ["V1": 5]), .refused(.belowThreshold))
    }

    func testAnUnreadFrameMeansTheClipIsNotJudgedAtAll() {
        let v = MediaAttributionGate.evaluate(isScreenCapture: false, frames: [frame(exact: "V1", reads: ["V1"])],
                                              framesRequested: 12, candidates: ["V1"], vinLengthByVehicle: ["V1": 17])
        XCTAssertEqual(v, .refused(.unreadableFrame))
        XCTAssertEqual(MediaAttributionGate.evaluate(isScreenCapture: false, frames: [], framesRequested: 0,
                                                     candidates: ["V1"], vinLengthByVehicle: ["V1": 17]),
                       .refused(.unreadableFrame))
    }

    // ─── Per-frame evidence from the photo readers' outputs ──────────────────

    private let source = OnDeviceObservation.Source(framework: "Apple Vision", model: "VNRecognizeTextRequest", revision: 3,
                                                    os_version: "26", method: OnDeviceAnalysis.methodVersion)
    private func evidence(lines: [String], vins: [String], labels: [String] = ["car"], confidence: Double = 0.99,
                          decision: VisionDecision.Category = .work, roster: [MediaRosterVehicle]? = nil) -> FrameEvidence {
        let obs = lines.map { OnDeviceObservation(kind: .ocrText, value: $0, confidence: confidence, source: source) }
        return MediaAttributionGate.frameEvidence(decision: decision, labels: labels, textLines: lines, vinCandidates: vins,
                                                  observations: obs, roster: roster ?? self.roster)
    }

    func testAnExactStrongSingleReadOfARosterVINIsExact() {
        let e = evidence(lines: [vin], vins: [vin])
        XCTAssertEqual(e.exactVehicleID, "V1")
        XCTAssertEqual(e.readVehicleIDs, ["V1"])
        XCTAssertFalse(e.unrecognizedIdentifier)
        XCTAssertFalse(e.isDocument)
    }

    func testAWeakReadIsNotExact() {
        XCTAssertNil(evidence(lines: [vin], vins: [vin], confidence: 0.6).exactVehicleID)
    }

    func testAVINNotOnTheRosterIsUnrecognizedAndNeverExact() {
        let e = evidence(lines: [otherVIN], vins: [otherVIN], roster: [MediaRosterVehicle(id: "V1", vin: vin)])
        XCTAssertNil(e.exactVehicleID)
        XCTAssertTrue(e.unrecognizedIdentifier)
    }

    func testAOneCharacterMisreadIsASuggestionNotExact() {
        let misread = "1HGCM82633A004353"
        let e = evidence(lines: [misread], vins: [])
        XCTAssertNil(e.exactVehicleID)
        XCTAssertEqual(e.readVehicleIDs, ["V1"], "it still counts as a read of V1, so it can block another vehicle")
    }

    func testTwoIdentifiersOnOneFrameAreNotACleanRead() {
        let e = evidence(lines: [vin, otherVIN], vins: [vin, otherVIN])
        XCTAssertNil(e.exactVehicleID)
        XCTAssertTrue(e.unrecognizedIdentifier)
    }

    func testASerialTwoVehiclesShareIsAmbiguous() {
        let twins = [MediaRosterVehicle(id: "V1", vin: vin), MediaRosterVehicle(id: "V9", vin: vin)]
        let e = evidence(lines: [vin], vins: [vin], roster: twins)
        XCTAssertNil(e.exactVehicleID)
        XCTAssertTrue(e.unrecognizedIdentifier)
    }

    func testAnInvoiceFrameIsADocumentAndReadsNothing() {
        let e = evidence(lines: ["INVOICE", "Amount due", vin], vins: [vin])
        XCTAssertTrue(e.isDocument)
        XCTAssertNil(e.exactVehicleID)
        XCTAssertTrue(e.readVehicleIDs.isEmpty)
    }

    func testTheFrameCarriesThePixelDecisionThrough() {
        XCTAssertEqual(evidence(lines: [vin], vins: [vin], decision: .sensitive).decision, .sensitive)
    }
}
