import XCTest
import CoreGraphics
@testable import NukeCapture

final class PhotoPrivacyReadTests: XCTestCase {
    private enum Unavailable: Error { case detector }

    private func image() throws -> CGImage {
        let context = try XCTUnwrap(CGContext(data: nil, width: 1, height: 1, bitsPerComponent: 8,
            bytesPerRow: 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
        return try XCTUnwrap(context.makeImage())
    }

    private func classification(_ labels: [String], vehicle: Bool) -> VisionEngine.Classification {
        .init(labels: labels.map { ($0, Float(0.8)) }, isVehicle: vehicle, maxCoreConfidence: vehicle ? 0.8 : 0)
    }

    func testUnavailableClassifierDoesNotBecomeAPersonalVerdictOrSuccessfulMetadataOnlyRead() throws {
        let cg = try image()
        var faceCalls = 0
        let result = VisionEngine.triage(cg, classifyImage: { _ in nil }, detectFace: { _ in faceCalls += 1; return false })
        XCTAssertEqual(result.failure, .classifierUnavailable)
        XCTAssertFalse(result.classified)
        XCTAssertFalse(result.pixelsEligible)
        XCTAssertEqual(faceCalls, 0)
        if case .unavailable = VisionEngine.contributorVerdict(cg, classifyImage: { _ in nil }) {} else {
            XCTFail("A failed contributor classifier must remain retryable, not become a terminal private hold.")
        }
    }

    func testUnavailableFaceDetectorCannotBecomeNoFaceEvenWithAVehicleLabel() throws {
        let cg = try image()
        for vehicle in [true, false] {
            let cls = classification([vehicle ? "car" : "machinery"], vehicle: vehicle)
            let result = VisionEngine.triage(cg, classifyImage: { _ in cls }, detectFace: { _ in throw Unavailable.detector })
            XCTAssertTrue(result.classified)
            XCTAssertEqual(result.failure, .faceDetectorUnavailable)
            XCTAssertFalse(result.pixelsEligible)
            XCTAssertEqual(result.labels, cls.labels.map { $0.0 })
            if case .unavailable = VisionEngine.contributorVerdict(cg, classifyImage: { _ in cls },
                detectFace: { _ in throw Unavailable.detector }) {} else { XCTFail("A detector failure must not allow or settle the source.") }
        }
    }

    func testSuccessfulPrivacyDecisionsKeepExistingVehiclePartClutterAndPersonalBehavior() throws {
        let cg = try image()
        let cases: [([String], Bool, Bool, Bool)] = [
            (["car"], true, false, true), (["machinery"], false, false, true),
            (["car"], true, true, true), (["person"], false, true, false),
            (["document", "car"], true, false, false), (["receipt"], false, false, false),
        ]
        for (labels, vehicle, face, eligible) in cases {
            let cls = classification(labels, vehicle: vehicle)
            let result = VisionEngine.triage(cg, classifyImage: { _ in cls }, detectFace: { _ in face })
            XCTAssertNil(result.failure)
            XCTAssertTrue(result.classified)
            XCTAssertEqual(result.pixelsEligible, eligible, "\(labels), vehicle=\(vehicle), face=\(face)")
        }
    }

    func testAffirmativeClutterHoldDoesNotNeedOrRetryAFaceRead() throws {
        let cg = try image(), cls = classification(["document", "car"], vehicle: true)
        var faceCalls = 0
        let detector: (CGImage) throws -> Bool = { _ in faceCalls += 1; throw Unavailable.detector }
        let owner = VisionEngine.triage(cg, classifyImage: { _ in cls }, detectFace: detector)
        XCTAssertFalse(owner.pixelsEligible); XCTAssertTrue(owner.classified); XCTAssertNil(owner.failure)
        XCTAssertEqual(VisionEngine.contributorVerdict(cg, classifyImage: { _ in cls }, detectFace: detector), .hold(reason: "clutter"))
        XCTAssertEqual(faceCalls, 0)
    }

    func testOriginalPreparationThrowsEachPrivacyReadFailureBeforeProducingUploadMetadata() async throws {
        let cg = try image()
        for failure in [VisionEngine.TriageFailure.classifierUnavailable, .faceDetectorUnavailable] {
            do {
                _ = try await SyncEngine.prepare(Data(), cameraInfo: { _ in ("Apple", "synthetic") }, decode: { _ in cg }, triage: { _ in
                    .init(pixelsEligible: false, labels: ["car"], isVehicle: true,
                          classified: failure != .classifierUnavailable, failure: failure)
                })
                XCTFail("An unavailable privacy read cannot yield a successful metadata-only upload preparation.")
            } catch let actual as VisionEngine.TriageFailure { XCTAssertEqual(actual, failure) }
        }
        do {
            _ = try await SyncEngine.prepare(Data(), cameraInfo: { _ in ("Apple", "synthetic") }, decode: { _ in nil })
            XCTFail("An undecodable original must remain pending rather than be settled as metadata only.")
        } catch let actual as VisionEngine.TriageFailure { XCTAssertEqual(actual, .imageUndecodable) }
    }

    func testOriginalPreparationDistinguishesASuccessfulHoldFromAnOperationalFailure() async throws {
        let cg = try image()
        for eligible in [true, false] {
            let result = try await SyncEngine.prepare(Data(), cameraInfo: { _ in ("Apple", "synthetic") }, decode: { _ in cg }, triage: { _ in
                .init(pixelsEligible: eligible, labels: [eligible ? "car" : "document"], isVehicle: eligible, classified: true, failure: nil)
            })
            XCTAssertEqual(result.pixelsEligible, eligible)
            XCTAssertEqual(result.labels, [eligible ? "car" : "document"])
            XCTAssertEqual(result.cameraMake, "Apple")
        }
    }

    func testForeignCameraExclusionDoesNotReadPixelsOrTreatItAsAnApplePrivacyFailure() async throws {
        var decoded = false, classified = false
        let result = try await SyncEngine.prepare(Data(), cameraInfo: { _ in ("Other", "synthetic") }, decode: { _ in
            decoded = true; return nil
        }, triage: { _ in
            classified = true
            return .init(pixelsEligible: true, labels: [], isVehicle: true, classified: true, failure: nil)
        })
        XCTAssertFalse(decoded); XCTAssertFalse(classified)
        XCTAssertEqual(result.cameraMake, "Other")
        XCTAssertFalse(result.pixelsEligible)
    }
}
