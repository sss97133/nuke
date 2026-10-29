// UploadQueueTests.swift — the background upload queue's state machine and the response rule.
// On 2026-10-29 the owner's 311 frames landed 40 per open because the upload lived inside the sync
// pass; the queue is what lets a transfer finish after the app is gone.

import XCTest
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
}
