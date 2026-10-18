import XCTest
import UIKit
import CryptoKit
@testable import NukeCapture

final class DevicePrivacyReceiptTests: XCTestCase {
    private let owner = "00000000-0000-4000-8000-000000009000"
    private func image(_ red: CGFloat = 0.2) throws -> CGImage {
        let context = try XCTUnwrap(CGContext(data: nil, width: 2, height: 2, bitsPerComponent: 8, bytesPerRow: 8,
            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
        context.setFillColor(red: red, green: 0.4, blue: 0.6, alpha: 1); context.fill(CGRect(x: 0, y: 0, width: 2, height: 2))
        return try XCTUnwrap(context.makeImage())
    }
    private func evidence() -> DevicePrivacyReceipt.Evidence {
        .init(labels: [("car", 0.8)], prominentFace: false, isVehicle: true, maxCoreConfidence: 0.8, totalVehicleConfidence: 0.8)
    }
    private func hash(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }

    func testReceiptPinsBothOriginalBytesAndActuallyDecodedInputWithoutAnotherVisionPass() async throws {
        let cg = try image(), data = try XCTUnwrap(UIImage(cgImage: cg).pngData())
        var classifications = 0, faces = 0
        let prepared = try await SyncEngine.prepare(data, userId: owner, cameraInfo: { _ in ("Apple", "synthetic") }, decode: { _ in cg }, triage: { image in
            VisionEngine.triage(image, classifyImage: { _ in classifications += 1; return .init(labels: [("car", 0.8)], isVehicle: true, maxCoreConfidence: 0.8) },
                detectFace: { _ in faces += 1; return false })
        })
        let receipt = try XCTUnwrap(prepared.privacyReceipt), pixels = try XCTUnwrap(cg.dataProvider?.data)
        XCTAssertEqual(classifications, 1); XCTAssertEqual(faces, 1)
        XCTAssertEqual(receipt.source_sha256, hash(data)); XCTAssertEqual(receipt.source_byte_length, data.count)
        XCTAssertEqual(receipt.owner_user_id, owner); XCTAssertEqual(receipt.decode.input_sha256, hash(pixels as Data))
        XCTAssertNotEqual(receipt.source_sha256, receipt.decode.input_sha256)
        XCTAssertEqual(receipt.decode.width, 2); XCTAssertEqual(receipt.classifier_revision, 2); XCTAssertEqual(receipt.face_revision, 3)
    }

    func testSourceAndDecodedInputChangesRemainSeparateEvidence() throws {
        let a = try image(), b = try image(0.9)
        let first = try XCTUnwrap(DevicePrivacyReceipt.make(original: Data([1, 2]), image: a, evidence: evidence(), userId: owner))
        let sourceChanged = try XCTUnwrap(DevicePrivacyReceipt.make(original: Data([1, 3]), image: a, evidence: evidence(), userId: owner))
        let inputChanged = try XCTUnwrap(DevicePrivacyReceipt.make(original: Data([1, 2]), image: b, evidence: evidence(), userId: owner))
        XCTAssertNotEqual(first.source_sha256, sourceChanged.source_sha256)
        XCTAssertEqual(first.decode.input_sha256, sourceChanged.decode.input_sha256)
        XCTAssertEqual(first.source_sha256, inputChanged.source_sha256)
        XCTAssertNotEqual(first.decode.input_sha256, inputChanged.decode.input_sha256)
    }

    func testReceiptSurvivesColdQueueRetryAndConcurrentAcknowledgementsButNeverAnotherHash() throws {
        let receipt = try XCTUnwrap(DevicePrivacyReceipt.make(original: Data([1, 2]), image: image(), evidence: evidence(), userId: owner))
        let now = Date(), other = String(repeating: "f", count: 64)
        var queue = SubjectResolutionQueue()
        queue.acknowledge(localIdentifier: "source-a", sourceHash: receipt.source_sha256, now: now, privacyReceipt: receipt)
        XCTAssertTrue(queue.stage([.init(imageId: "00000000-0000-4000-8000-000000000001", sourceHash: receipt.source_sha256)], now: now))
        _ = queue.beginAttempt(now: now)
        var cold = try JSONDecoder().decode(SubjectResolutionQueue.self, from: JSONEncoder().encode(queue))
        XCTAssertEqual(cold.uploads.first?.privacyReceipt, receipt); XCTAssertTrue(cold.active!.reuseOnly)
        var newer = queue; newer.acknowledge(localIdentifier: "source-b", sourceHash: other, now: now, privacyReceipt: receipt)
        cold.preserveAcknowledgements(from: newer)
        XCTAssertEqual(cold.uploads.count, 2); XCTAssertNil(cold.uploads.last?.privacyReceipt)
        cold.finish(reason: "synthetic receipt consumed")
        XCTAssertEqual(cold.uploads.count, 1); XCTAssertEqual(cold.uploads.first?.sourceHash, other)
    }

    func testLegacyQueueDecodesWithoutAReceiptAndCannotSupplyPurposeQualification() throws {
        var queue = SubjectResolutionQueue(); queue.acknowledge(localIdentifier: "legacy", sourceHash: String(repeating: "a", count: 64), now: Date())
        let cold = try JSONDecoder().decode(SubjectResolutionQueue.self, from: JSONEncoder().encode(queue))
        XCTAssertNil(cold.uploads.first?.privacyReceipt)
    }

    func testConcurrentReceiptAcknowledgementFillsMissingEvidenceWithoutResettingTheAttempt() throws {
        let receipt = try XCTUnwrap(DevicePrivacyReceipt.make(original: Data([1, 2]), image: image(), evidence: evidence(), userId: owner))
        let now = Date(); var stale = SubjectResolutionQueue()
        stale.acknowledge(localIdentifier: "same-source", sourceHash: receipt.source_sha256, now: now)
        var newer = stale
        newer.acknowledge(localIdentifier: "same-source", sourceHash: receipt.source_sha256, now: now, privacyReceipt: receipt)
        XCTAssertTrue(stale.stage([.init(imageId: "00000000-0000-4000-8000-000000000001", sourceHash: receipt.source_sha256)], now: now))
        _ = stale.beginAttempt(now: now); stale.preserveAcknowledgements(from: newer)
        XCTAssertEqual(stale.uploads.count, 1); XCTAssertEqual(stale.uploads[0].privacyReceipt, receipt)
        XCTAssertEqual(stale.active?.attempts, 1); XCTAssertTrue(stale.active!.reuseOnly)
    }
}
