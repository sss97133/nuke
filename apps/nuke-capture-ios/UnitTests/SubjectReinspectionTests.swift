import XCTest
import CryptoKit
import UIKit
@testable import NukeCapture

@MainActor
final class SubjectReinspectionTests: XCTestCase {
    private let user = "00000000-0000-4000-8000-000000009000"
    private func id(_ n: Int) -> String { String(format: "00000000-0000-4000-8000-%012d", n) }
    private func bytes(_ n: Int) -> Data { Data([1, UInt8(n)]) }
    private func hash(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
    private func candidate(_ indexes: [Int] = [1, 2], pending: Int = 3, run: String = "old-paid-reading") -> SubjectReinspectionQueue.Candidate {
        .init(method: SubjectReinspectionQueue.method, reading_id: id(100), run_key: run, image_ids: [1, 2, 3].map(id),
            expected_source_hashes: Dictionary(uniqueKeysWithValues: [1, 2, 3].map { (id($0), hash(bytes($0))) }), pending_source_count: pending,
            inspect: indexes.map { .init(receipt_image_id: id($0), current_image_id: id($0 + 10), root_image_id: id($0),
                local_identifier: "asset-\($0)", source_sha256: hash(bytes($0))) })
    }
    private func prepare(_ data: Data, owner: String, failClassifier: Bool = false) async throws -> SyncEngine.PreparedOriginal {
        let context = try XCTUnwrap(CGContext(data: nil, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4,
            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
        let cg = try XCTUnwrap(context.makeImage())
        return try await SyncEngine.prepare(data, userId: owner, cameraInfo: { _ in ("Apple", "synthetic") }, decode: { _ in cg }, triage: { image in
            VisionEngine.triage(image, classifyImage: { _ in failClassifier ? nil : .init(labels: [("car", 0.8)], isVehicle: true, maxCoreConfidence: 0.8) },
                detectFace: { _ in false })
        })
    }

    func testThreePendingOriginalsProgressTwoThenOneAndColdRetryReusesActualByteReceipts() async throws {
        let now = Date(); var queue = SubjectReinspectionQueue(userId: user)
        queue.offer(candidate(), now: now); let first = try XCTUnwrap(queue.beginAttempt(now: now))
        var reads: [String] = [], triage = 0
        let firstReceipts = try await SubjectReinspectionWork.inspect(first, userId: user, mayContinue: { true }, original: { local in
            reads.append(local); return self.bytes(Int(local.split(separator: "-").last!)!)
        }, prepare: { data, owner in triage += 1; return try await self.prepare(data, owner: owner) }, didInspect: { receipt, witness in
            queue.retain(receipt, witness: witness, key: first.candidate.key)
        })
        XCTAssertEqual(firstReceipts.count, 2); XCTAssertEqual(reads, ["asset-1", "asset-2"])
        queue = try JSONDecoder().decode(SubjectReinspectionQueue.self, from: JSONEncoder().encode(queue))
        let retained = try XCTUnwrap(queue.leases.first)
        _ = try await SubjectReinspectionWork.inspect(retained, userId: user, mayContinue: { true }, original: { _ in
            XCTFail("cold retry must not reopen completed originals"); throw SubjectReinspectionFailure.unavailable
        }, prepare: { _, _ in XCTFail("cold retry must not repeat triage"); throw SubjectReinspectionFailure.unavailable }, didInspect: { _, _ in })
        queue.finish(first.candidate.key); queue.offer(candidate([3], pending: 1), now: now)
        let last = try XCTUnwrap(queue.beginAttempt(now: now))
        let final = try await SubjectReinspectionWork.inspect(last, userId: user, mayContinue: { true }, original: { local in
            reads.append(local); return self.bytes(3)
        }, prepare: { data, owner in triage += 1; return try await self.prepare(data, owner: owner) }, didInspect: { receipt, witness in
            queue.retain(receipt, witness: witness, key: last.candidate.key)
        })
        XCTAssertEqual(reads, ["asset-1", "asset-2", "asset-3"]); XCTAssertEqual(triage, 3); XCTAssertEqual(final.count, 1)
        XCTAssertEqual(final[id(3)]?.source_sha256, hash(bytes(3))); XCTAssertNotEqual(first.candidate.key, last.candidate.key)
    }

    func testChangedOriginalIsRejectedBeforeDecodeOrReceiptAndLeaseStaysRetryable() async throws {
        let now = Date(); var queue = SubjectReinspectionQueue(userId: user); queue.offer(candidate([1], pending: 1), now: now)
        let lease = try XCTUnwrap(queue.beginAttempt(now: now)); var prepared = 0, retained = 0
        do {
            _ = try await SubjectReinspectionWork.inspect(lease, userId: user, mayContinue: { true }, original: { _ in Data([9]) },
                prepare: { data, owner in prepared += 1; return try await self.prepare(data, owner: owner) }, didInspect: { _, _ in retained += 1 })
            XCTFail("changed original accepted")
        } catch { XCTAssertTrue(error is SubjectReinspectionFailure) }
        XCTAssertEqual(prepared, 0); XCTAssertEqual(retained, 0); XCTAssertEqual(queue.leases.first?.attempts, 1)
        XCTAssertNil(queue.beginAttempt(now: now.addingTimeInterval(1)))
    }

    func testUnavailableOriginalDoesNotStarveLaterCarriersAndBackoffSurvivesRestart() async throws {
        let now = Date(); var queue = SubjectReinspectionQueue(userId: user); queue.nextOffset = 8
        queue.offer(candidate([1], pending: 1), now: now); let first = try XCTUnwrap(queue.beginAttempt(now: now))
        do {
            _ = try await SubjectReinspectionWork.inspect(first, userId: user, mayContinue: { true }, original: { _ in throw SubjectReinspectionFailure.unavailable },
                prepare: { _, _ in XCTFail("unavailable/iCloud original cannot run triage"); throw SubjectReinspectionFailure.unavailable }, didInspect: { _, _ in XCTFail() })
            XCTFail()
        } catch {}
        queue = try JSONDecoder().decode(SubjectReinspectionQueue.self, from: JSONEncoder().encode(queue))
        XCTAssertEqual(queue.nextOffset, 8); XCTAssertNil(queue.beginAttempt(now: now.addingTimeInterval(1)))
        queue.offer(candidate([2], pending: 1, run: "later-retained-reading"), now: now.addingTimeInterval(1))
        XCTAssertEqual(queue.beginAttempt(now: now.addingTimeInterval(1))?.candidate.run_key, "later-retained-reading")
        _ = queue.beginAttempt(now: now.addingTimeInterval(121)); _ = queue.beginAttempt(now: now.addingTimeInterval(722))
        XCTAssertLessThanOrEqual(queue.leases.map(\.attempts).max() ?? 0, 3)
        let cold = try JSONDecoder().decode(SubjectReinspectionQueue.self, from: JSONEncoder().encode(queue))
        XCTAssertEqual(cold.leases.first?.nextAttemptAt, queue.leases.first?.nextAttemptAt)
    }

    func testForegroundThermalOrAccountHoldStopsBeforeOriginalAndAccountSwitchStopsBeforeTriage() async throws {
        let now = Date(); var queue = SubjectReinspectionQueue(userId: user); queue.offer(candidate([1], pending: 1), now: now)
        let lease = try XCTUnwrap(queue.beginAttempt(now: now)); var allowed = false, reads = 0, prepares = 0
        for switchAfterRead in [false, true] {
            allowed = switchAfterRead
            do {
                _ = try await SubjectReinspectionWork.inspect(lease, userId: user, mayContinue: { allowed }, original: { _ in
                    reads += 1; allowed = false; return self.bytes(1)
                }, prepare: { data, owner in prepares += 1; return try await self.prepare(data, owner: owner) }, didInspect: { _, _ in XCTFail() })
                XCTFail()
            } catch {}
        }
        XCTAssertEqual(reads, 1); XCTAssertEqual(prepares, 0); XCTAssertEqual(queue.leases.first?.receipts.count, 0)
    }

    func testClassifierFailureNeverBecomesAReceiptOrSettlesTheLease() async throws {
        let now = Date(); var queue = SubjectReinspectionQueue(userId: user); queue.offer(candidate([1], pending: 1), now: now)
        let lease = try XCTUnwrap(queue.beginAttempt(now: now))
        do {
            _ = try await SubjectReinspectionWork.inspect(lease, userId: user, mayContinue: { true }, original: { _ in self.bytes(1) },
                prepare: { data, owner in try await self.prepare(data, owner: owner, failClassifier: true) }, didInspect: { _, _ in XCTFail() })
            XCTFail()
        } catch { XCTAssertEqual(error as? VisionEngine.TriageFailure, .classifierUnavailable) }
        XCTAssertTrue(queue.finishedScopes.isEmpty); XCTAssertEqual(queue.leases.first?.receipts.count, 0)
    }

    func testReceiptLeaseRejectsAnotherAccountAndCandidateCannotRaiseOriginalBudget() async throws {
        let now = Date(); var queue = SubjectReinspectionQueue(userId: user); queue.offer(candidate([1], pending: 1), now: now)
        let lease = try XCTUnwrap(queue.beginAttempt(now: now)), witness = lease.candidate.inspect[0]
        let other = try await prepare(bytes(1), owner: id(9001))
        queue.retain(try XCTUnwrap(other.privacyReceipt), witness: witness, key: lease.candidate.key)
        XCTAssertEqual(queue.leases.first?.receipts.count, 0)
        let invalid = candidate([1, 2, 3]); XCTAssertFalse(invalid.valid); queue.offer(invalid, now: now)
        XCTAssertEqual(queue.leases.count, 1); XCTAssertEqual(queue.userId, user)
    }

    func testThreeUnavailableAttemptsDeferPersistentlyThenAQualifiedLaterOfferCanSucceed() async throws {
        let now = Date(), scope = candidate([1], pending: 1)
        var queue = SubjectReinspectionQueue(userId: user); queue.offer(scope, now: now)
        var originalReads = 0
        for delay in [0.0, 121, 722] {
            let lease = try XCTUnwrap(queue.beginAttempt(now: now.addingTimeInterval(delay)))
            do {
                _ = try await SubjectReinspectionWork.inspect(lease, userId: user, mayContinue: { true }, original: { _ in
                    originalReads += 1; throw SubjectReinspectionFailure.unavailable
                }, prepare: { _, _ in XCTFail("unavailable originals cannot run privacy reads"); throw SubjectReinspectionFailure.unavailable }, didInspect: { _, _ in XCTFail() })
                XCTFail()
            } catch { queue.noteFailure(scope.key, reason: "original_unavailable") }
        }
        XCTAssertEqual(originalReads, 3); XCTAssertNil(queue.beginAttempt(now: now.addingTimeInterval(4323)))
        XCTAssertTrue(queue.finishedScopes.isEmpty); XCTAssertTrue(queue.leases.isEmpty)
        queue = try JSONDecoder().decode(SubjectReinspectionQueue.self, from: JSONEncoder().encode(queue))
        let deferred = try XCTUnwrap(queue.deferredScopes?.first)
        XCTAssertEqual(deferred.reason, "original_unavailable"); XCTAssertEqual(deferred.currentImageIds, [id(11)])
        queue.offer(scope, now: deferred.retryAfter.addingTimeInterval(-1)); XCTAssertTrue(queue.leases.isEmpty)
        var otherCarrier = queue
        otherCarrier.offer(candidate([2], pending: 1, run: "later-carrier"), now: now.addingTimeInterval(4324))
        XCTAssertEqual(otherCarrier.beginAttempt(now: now.addingTimeInterval(4324))?.candidate.run_key, "later-carrier")
        XCTAssertNil(queue.beginAttempt(now: deferred.retryAfter.addingTimeInterval(1)), "elapsed time is not source permission")
        // This offer represents a new current qualified server candidate, not a
        // timer restoring its old authority or resetting upload settlement.
        queue.offer(scope, now: deferred.retryAfter.addingTimeInterval(1))
        let resumed = try XCTUnwrap(queue.beginAttempt(now: deferred.retryAfter.addingTimeInterval(1)))
        XCTAssertEqual(resumed.attempts, 1)
        let receipts = try await SubjectReinspectionWork.inspect(resumed, userId: user, mayContinue: { true }, original: { _ in
            originalReads += 1; return self.bytes(1)
        }, prepare: { data, owner in try await self.prepare(data, owner: owner) }, didInspect: { receipt, witness in
            queue.retain(receipt, witness: witness, key: scope.key)
        })
        XCTAssertEqual(originalReads, 4); XCTAssertEqual(receipts.count, 1)
        queue.finish(scope.key)
        XCTAssertEqual(queue.finishedScopes, [scope.key]); XCTAssertEqual(queue.finishReasons?[scope.key], "reconciled")
        XCTAssertTrue(queue.deferredScopes?.isEmpty == true)
    }

    func testCompletedPrivacyHoldRemainsTerminalForTheSameBytesAndMethod() async throws {
        let now = Date(), scope = candidate([1], pending: 1)
        var queue = SubjectReinspectionQueue(userId: user); queue.offer(scope, now: now)
        let lease = try XCTUnwrap(queue.beginAttempt(now: now))
        do {
            _ = try await SubjectReinspectionWork.inspect(lease, userId: user, mayContinue: { true }, original: { _ in self.bytes(1) },
                prepare: { _, _ in .init(cameraMake: "Apple", cameraModel: nil, exifCaptureDate: nil, pixelsEligible: false, labels: ["personal"]) },
                didInspect: { _, _ in XCTFail() })
            XCTFail()
        } catch SubjectReinspectionFailure.privacyHeld { queue.finish(scope.key, reason: "completed_privacy_hold") }
        queue.offer(scope, now: now.addingTimeInterval(3 * 24 * 60 * 60))
        XCTAssertTrue(queue.leases.isEmpty); XCTAssertEqual(queue.finishReasons?[scope.key], "completed_privacy_hold")
    }
}
