import XCTest
import CryptoKit
import UIKit
@testable import NukeCapture

@MainActor
final class IdentityFollowupPrivacyTests: XCTestCase {
    let user = "00000000-0000-4000-8000-000000009000"
    let bytes = Data([1,2,3])
    func source() -> IdentityFollowupSource {
        .init(assetID: "exact-local", sha256: SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined(),
              userID: user, methodVersion: LibraryIngest.identityMethodVersion)
    }
    func prepare(_ data: Data, owner: String, label: String = "car", face: Bool = false) async throws -> SyncEngine.PreparedOriginal {
        let context = try XCTUnwrap(CGContext(data: nil, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4,
            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
        let cg = try XCTUnwrap(context.makeImage())
        return try await SyncEngine.prepare(data, userId: owner, cameraInfo: { _ in ("Apple", "fixture") }, decode: { _ in cg }, triage: { image in
            VisionEngine.triage(image, classifyImage: { _ in .init(labels: [(label, Float(0.9))], isVehicle: label == "car", maxCoreConfidence: label == "car" ? 0.9 : 0) }, detectFace: { _ in face })
        })
    }
    func testRecoveredReceiptPersistsBeforeReturnAndSurvivesColdRetryWithoutChangingUploads() async throws {
        let original = source(); var state = UploadQueueState(); state.enqueueIdentity(original)
        let beforeItems = state.items
        let enriched = try await IdentityFollowupPrivacy.recover(original, userID: user, mayContinue: { true },
            original: { id in XCTAssertEqual(id, original.assetID); return .init(data: self.bytes, version: "v1") },
            currentVersion: { _ in "v1" }, prepare: { try await self.prepare($0, owner: $1) },
            persist: { value in state.enqueueIdentity(value); state = try JSONDecoder().decode(UploadQueueState.self, from: JSONEncoder().encode(state)) })
        XCTAssertEqual(state.identityFollowups?.first?.privacyReceipt, enriched.privacyReceipt)
        XCTAssertEqual(state.items, beforeItems); XCTAssertEqual(state.landedToday, 0)
        XCTAssertEqual(enriched.privacyReceipt?.source_sha256, original.sha256)
        XCTAssertEqual(enriched.privacyReceipt?.decode.max_pixel, 512)
        _ = try await IdentityFollowupPrivacy.recover(enriched, userID: user, mayContinue: { true },
            original: { _ in XCTFail("durable receipt should be reused"); throw SubjectReinspectionFailure.unavailable },
            persist: { _ in XCTFail("no new receipt") })
    }
    func testChangedHashRefusesBeforePolicyOrPersistence() async {
        do {
            _ = try await IdentityFollowupPrivacy.recover(source(), userID: user, mayContinue: { true },
                original: { _ in .init(data: Data([9]), version: "v1") }, currentVersion: { _ in "v1" },
                prepare: { _, _ in XCTFail(); throw SubjectReinspectionFailure.unavailable }, persist: { _ in XCTFail() })
            XCTFail()
        } catch {}
    }
    func testPauseAccountAndVersionChangesRefuse() async {
        for stage in 0...3 {
            var allowed = stage != 0; var version = "v1"
            do {
                _ = try await IdentityFollowupPrivacy.recover(source(), userID: user, mayContinue: { allowed },
                    original: { _ in if stage == 1 { allowed = false }; return .init(data: self.bytes, version: "v1") },
                    currentVersion: { _ in version }, prepare: { data, owner in
                        if stage == 2 { version = "v2" }; if stage == 3 { allowed = false }
                        return try await self.prepare(data, owner: owner)
                    }, persist: { _ in XCTFail("stale/held receipt persisted") })
                XCTFail()
            } catch {}
        }
    }
    func testDocumentAndPersonalFramesRemainHeld() async {
        for label in ["document", "person"] {
            do {
                _ = try await IdentityFollowupPrivacy.recover(source(), userID: user, mayContinue: { true },
                    original: { _ in .init(data: self.bytes, version: "v1") }, currentVersion: { _ in "v1" },
                    prepare: { try await self.prepare($0, owner: $1, label: label, face: label == "person") },
                    persist: { _ in XCTFail("private frame receipt") })
                XCTFail()
            } catch {}
        }
    }
    func testMissingOriginalAndFailedPersistenceKeepFollowupPending() async {
        for missing in [true, false] {
            do {
                _ = try await IdentityFollowupPrivacy.recover(source(), userID: user, mayContinue: { true }, original: { _ in
                    if missing { throw SubjectReinspectionFailure.unavailable }
                    return .init(data: self.bytes, version: "v1")
                }, currentVersion: { _ in "v1" }, prepare: { try await self.prepare($0, owner: $1) },
                persist: { _ in throw SubjectReinspectionFailure.unavailable })
                XCTFail("cannot return source for remote reading before durable receipt")
            } catch {}
        }
    }
}
