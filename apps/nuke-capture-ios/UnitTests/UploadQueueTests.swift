// UploadQueueTests.swift — the background upload queue's state machine and the response rule.
// On 2026-10-29 the owner's 311 frames landed 40 per open because the upload lived inside the sync
// pass; the queue is what lets a transfer finish after the app is gone.

import XCTest
import GRDB
@testable import NukeCapture

final class UploadQueueTests: XCTestCase {
    private func item(_ id: String, attempts: Int = 0, state: UploadItem.State = .queued) -> UploadItem {
        var i = UploadItem(assetID: id, sha256: String(repeating: "a", count: 64), storagePath: "users/u/capture-relay/a/IMG_1.HEIC",
                           fileName: "a.bin", mimeType: "image/heic", seenKey: "IMG_1.HEIC|10", userID: "u",
                           row: Data("{}".utf8), privacyReceipt: nil)
        i.attempts = attempts
        i.state = state
        return i
    }

    func testEnqueueIsOncePerAsset() {
        var q = UploadQueueState()
        XCTAssertTrue(q.enqueue(item("A")))
        XCTAssertFalse(q.enqueue(item("A")))
        XCTAssertTrue(q.isPending(assetID: "A"))
        XCTAssertEqual(q.queued.count, 1)
    }

    func testCompleteLeavesTheQueueAndCountsTheDay() {
        var q = UploadQueueState()
        q.enqueue(item("A")); q.enqueue(item("B"))
        q.markUploading(assetID: "A")
        XCTAssertEqual(q.inFlight.map(\.assetID), ["A"])
        XCTAssertEqual(q.item(for: "A")?.attempts, 1)
        q.complete(assetID: "A", dayKey: "2026-10-29")
        XCTAssertFalse(q.isPending(assetID: "A"))
        XCTAssertEqual(q.landedToday, 1)
        q.complete(assetID: "B", dayKey: "2026-10-30")
        XCTAssertEqual(q.landedToday, 1, "a new day starts the count over")
        XCTAssertEqual(q.landedDay, "2026-10-30")
    }

    func testRetryableFailureReturnsToQueuedUntilTheCap() {
        var q = UploadQueueState()
        q.enqueue(item("A"))
        q.markUploading(assetID: "A")
        XCTAssertFalse(q.fail(assetID: "A", error: "HTTP 503", retryable: true, maxAttempts: 3))
        XCTAssertEqual(q.item(for: "A")?.state, .queued)
        XCTAssertEqual(q.item(for: "A")?.lastError, "HTTP 503")
        q.markUploading(assetID: "A"); q.fail(assetID: "A", error: "x", retryable: true, maxAttempts: 3)
        q.markUploading(assetID: "A")
        XCTAssertTrue(q.fail(assetID: "A", error: "x", retryable: true, maxAttempts: 3), "the third attempt is the last")
        XCTAssertFalse(q.isPending(assetID: "A"))
    }

    func testFinalFailureDropsAtOnce() {
        var q = UploadQueueState()
        q.enqueue(item("A"))
        XCTAssertTrue(q.fail(assetID: "A", error: "HTTP 400", retryable: false, maxAttempts: 3))
        XCTAssertTrue(q.items.isEmpty)
    }

    func testOrphansRequeueWhenNoTaskCarriesThem() {
        var q = UploadQueueState()
        q.enqueue(item("A")); q.enqueue(item("B"))
        q.markUploading(assetID: "A"); q.markUploading(assetID: "B")
        q.requeueOrphans(liveAssetIDs: ["B"])
        XCTAssertEqual(q.item(for: "A")?.state, .queued)
        XCTAssertEqual(q.item(for: "B")?.state, .uploading)
    }

    func testStateRoundTripsThroughJSON() throws {
        var q = UploadQueueState()
        q.enqueue(item("A", attempts: 2, state: .uploading))
        q.complete(assetID: "Z", dayKey: "2026-10-29")
        let data = try JSONEncoder().encode(q)
        let back = try JSONDecoder().decode(UploadQueueState.self, from: data)
        XCTAssertEqual(back, q)
    }

    func testResponseClassification() {
        XCTAssertEqual(UploadResponseClass.classify(status: 200, body: "{\"Key\":\"x\"}"), .success)
        XCTAssertEqual(UploadResponseClass.classify(status: 409, body: "Duplicate"), .success)
        XCTAssertEqual(UploadResponseClass.classify(status: 400, body: "The resource already exists"), .success)
        XCTAssertEqual(UploadResponseClass.classify(status: 401, body: "Invalid JWT"), .refusedSession)
        XCTAssertEqual(UploadResponseClass.classify(status: 503, body: ""), .transient)
        XCTAssertEqual(UploadResponseClass.classify(status: 429, body: ""), .transient)
        XCTAssertEqual(UploadResponseClass.classify(status: 402, body: "exceed_storage_size_quota"), .transient,
                       "the 2026-10-28 quota hold must not count against a photo")
        XCTAssertEqual(UploadResponseClass.classify(status: 400, body: "invalid mime type"), .rejected)
        XCTAssertEqual(UploadResponseClass.classify(status: 413, body: ""), .rejected)
    }

    func testAcknowledgedUploadPersistsIdentityWorkAcrossRestart() throws {
        var q = UploadQueueState()
        q.enqueue(item("plate"))
        q.complete(assetID: "plate", dayKey: "2026-10-29", identityMethodVersion: "identity-v1")
        XCTAssertFalse(q.isPending(assetID: "plate"), "do not upload the original again")
        var restarted = try JSONDecoder().decode(UploadQueueState.self, from: JSONEncoder().encode(q))
        let work = restarted.identityBatch(userID: "u", methodVersion: "identity-v2", limit: 1, now: Date())
        XCTAssertEqual(work.map(\.assetID), ["plate"])
        XCTAssertEqual(work.first?.methodVersion, "identity-v2", "a new method requires its own qualified read")
        XCTAssertEqual(work.first?.sha256, String(repeating: "a", count: 64))
        XCTAssertEqual(restarted.landedToday, 1)
    }

    func testFinishingOnePassPreservesConcurrentArrivalsAndOtherAccounts() {
        var q = UploadQueueState()
        q.enqueue(item("A")); q.complete(assetID: "A", dayKey: "day", identityMethodVersion: "identity")
        let batch = q.identityBatch(userID: "u", methodVersion: "identity", limit: 1, now: Date())
        q.enqueue(item("B")); q.complete(assetID: "B", dayKey: "day", identityMethodVersion: "identity")
        q.identityFollowups?.append(.init(assetID: "foreign", sha256: "hash", userID: "other", methodVersion: "identity"))
        q.finishIdentity(Set(batch.map(\.key)))
        XCTAssertEqual(Set((q.identityFollowups ?? []).map(\.assetID)), ["B", "foreign"])
        XCTAssertEqual(q.identityBatch(userID: "u", methodVersion: "identity", limit: 10, now: Date()).map(\.assetID), ["B"])
    }

    func testIdentityReceiptRequiresExactAccountAssetHashAndMethod() {
        let source = IdentityFollowupSource(assetID: "plate", sha256: "original", userID: "u", methodVersion: "identity")
        XCTAssertTrue(source.matches(assetID: "plate", sha256: "original", userID: "u", methodVersion: "identity"))
        XCTAssertFalse(source.matches(assetID: "plate", sha256: "edited", userID: "u", methodVersion: "identity"))
        XCTAssertFalse(source.matches(assetID: "plate", sha256: "original", userID: "other", methodVersion: "identity"))
        XCTAssertFalse(source.matches(assetID: "plate", sha256: "original", userID: "u", methodVersion: "album"))
        XCTAssertFalse(source.matches(assetID: "different", sha256: "original", userID: "u", methodVersion: "identity"))
    }

    func testBlockedIdentitySourcesRotateWithoutDroppingTheirWork() {
        var q = UploadQueueState()
        for id in ["A", "B", "C"] { q.enqueue(item(id)); q.complete(assetID: id, dayKey: "day", identityMethodVersion: "identity") }
        let first = q.identityBatch(userID: "u", methodVersion: "identity", limit: 1, now: Date(timeIntervalSince1970: 10))
        let second = q.identityBatch(userID: "u", methodVersion: "identity", limit: 1, now: Date(timeIntervalSince1970: 20))
        XCTAssertNotEqual(first.first?.key, second.first?.key)
        XCTAssertEqual(q.identityFollowups?.count, 3, "an unavailable original remains owed")
    }

    func testOldQueueWithoutIdentityFieldStillDecodes() throws {
        let old = Data(#"{"items":[],"landedDay":"day","landedToday":1}"#.utf8)
        let q = try JSONDecoder().decode(UploadQueueState.self, from: old)
        XCTAssertNil(q.identityFollowups)
        XCTAssertEqual(q.landedToday, 1)
    }

    func testStaleRecoveryAndCompletionCannotReplaceANewerOriginal() {
        var q = UploadQueueState()
        let original = IdentityFollowupSource(assetID: "plate", sha256: "old", userID: "u", methodVersion: "identity")
        let edited = IdentityFollowupSource(assetID: "plate", sha256: "new", userID: "u", methodVersion: "identity")
        q.enqueueIdentity(original)
        q.enqueueIdentity(edited)
        q.enqueueIdentity(original, recovering: true)
        q.finishIdentity([original.key])
        XCTAssertEqual(q.identityFollowups?.map(\.sha256), ["new"])
    }

    @MainActor
    func testAlbumReviewCannotSatisfyTheIdentityCache() throws {
        let store = try LocalStore(databaseQueue: DatabaseQueue())
        let photo = LocalAlbumPhoto(localIdentifier: "source", sourceVersion: "original-v1")
        let album = LibraryIngest.albumMethodVersion
        let identity = LibraryIngest.identityMethodVersion
        XCTAssertNotEqual(album, identity)
        func review(_ id: String, method: String) -> LocalAlbumImageReview {
            .init(id: id, localIdentifier: photo.localIdentifier, sourceVersion: photo.sourceVersion,
                  inputSHA256: String(repeating: "a", count: 64), methodVersion: method, analyzedAt: Date(),
                  isVehicle: true, hasPerson: false, labelsJSON: "[]", vinCandidatesJSON: "[]", textLinesJSON: "[]")
        }
        try store.recordAlbumImageReview(review("album", method: album))
        XCTAssertNil(try store.albumImageReview(for: photo, methodVersion: identity))
        try store.recordAlbumImageReview(review("identity", method: identity))
        XCTAssertEqual(try store.albumImageReview(for: photo, methodVersion: identity)?.id, "identity")
        XCTAssertNil(try store.albumImageReview(for: .init(localIdentifier: "source", sourceVersion: "edited-v2"), methodVersion: identity))
    }
}
