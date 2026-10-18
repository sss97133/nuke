import XCTest
@testable import NukeCapture

final class SubjectResolutionQueueTests: XCTestCase {
    private let clock = Date(timeIntervalSince1970: 1_700_000_000)
    private func hash(_ character: Character) -> String { String(repeating: String(character), count: 64) }
    private let ids = ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002", "00000000-0000-4000-8000-000000000003"]
    private func queue(_ count: Int = 3) -> SubjectResolutionQueue {
        var queue = SubjectResolutionQueue()
        for (offset, character) in [Character("a"), "b", "c"].prefix(count).enumerated() {
            queue.acknowledge(localIdentifier: "photo-\(offset)", sourceHash: hash(character), now: clock)
        }
        return queue
    }
    private var inputs: [SubjectResolutionQueue.Input] {
        zip(ids, [Character("a"), "b", "c"]).map { .init(imageId: $0.0, sourceHash: hash($0.1)) }
    }

    func testDuplicateAcknowledgedBytesDoNotManufactureAnotherView() {
        var queue = queue(1)
        queue.acknowledge(localIdentifier: "second-copy", sourceHash: hash("a"), now: clock)
        queue.acknowledge(localIdentifier: "bad-hash", sourceHash: "filename.jpg", now: clock)
        XCTAssertEqual(queue.uploads.count, 1)
        XCTAssertEqual(queue.readyForSourceRead(now: clock).count, 1)
        XCTAssertFalse(queue.stage([inputs[0], inputs[0]], now: clock))
    }

    func testNoBatchLargerThanThreeOrUnknownUploadCanBeStaged() {
        var queue = queue()
        XCTAssertFalse(queue.stage(inputs + [inputs[0]], now: clock))
        XCTAssertFalse(queue.stage([inputs[0], .init(imageId: ids[1], sourceHash: hash("d"))], now: clock))
        XCTAssertTrue(queue.stage(inputs, now: clock))
        XCTAssertFalse(queue.stage(inputs, now: clock))
    }

    func testLeaseSurvivesRestartAndPreventsImmediatePaidRetry() throws {
        var queue = queue()
        XCTAssertTrue(queue.stage(inputs, now: clock))
        let attempt = try XCTUnwrap(queue.beginAttempt(now: clock))
        var restored = try JSONDecoder().decode(SubjectResolutionQueue.self, from: JSONEncoder().encode(queue))
        XCTAssertEqual(restored.active?.key, attempt.key)
        XCTAssertNil(restored.beginAttempt(now: clock.addingTimeInterval(119)))
        let retry = restored.beginAttempt(now: clock.addingTimeInterval(120))
        XCTAssertEqual(retry?.attempts, 2)
        XCTAssertTrue(retry?.reuseOnly == true)
        XCTAssertTrue(restored.readyForSourceRead(now: clock).isEmpty)
    }

    func testFingerprintPinsMethodSourceAndExactInputsIndependentOfOrder() throws {
        var left = queue(), right = queue()
        XCTAssertTrue(left.stage(inputs, now: clock))
        XCTAssertTrue(right.stage(inputs.reversed(), now: clock))
        XCTAssertEqual(left.active?.key, right.active?.key)
        let changed = SubjectResolutionQueue.Batch(inputs: [.init(imageId: ids[0], sourceHash: hash("d")), inputs[1]], nextAttemptAt: clock)
        XCTAssertNotEqual(changed.key, left.active?.key)
    }

    func testPartialStorageRetryNeverRequestsAnotherInference() {
        var queue = queue()
        XCTAssertTrue(queue.stage(inputs, now: clock))
        _ = queue.beginAttempt(now: clock)
        queue.retry(reason: "storage partial", reuseOnly: true)
        let retry = queue.beginAttempt(now: clock.addingTimeInterval(120))
        XCTAssertEqual(retry?.reuseOnly, true)
        queue.retry(reason: "network unavailable")
        XCTAssertEqual(queue.active?.reuseOnly, true)
        XCTAssertEqual(queue.active?.inputs, inputs)
    }

    func testOnlyExplicitPreInferenceRefusalCanPermitAFreshAttempt() {
        var queue = queue()
        XCTAssertTrue(queue.stage(inputs, now: clock))
        let initial = queue.beginAttempt(now: clock)
        XCTAssertFalse(initial?.reuseOnly ?? true)
        XCTAssertTrue(queue.active?.reuseOnly == true)
        queue.retry(reason: "source not ready", readingWasNotStarted: true)
        XCTAssertFalse(queue.active?.reuseOnly ?? true)
        let retry = queue.beginAttempt(now: clock.addingTimeInterval(120))
        XCTAssertFalse(retry?.reuseOnly ?? true)
        queue.retry(reason: "request lost")
        XCTAssertTrue(queue.active?.reuseOnly == true)
    }

    func testUnavailableProviderAfterAnUnreadablePaidAnswerCannotTriggerAnotherReading() {
        for refusal in ["provider_unavailable", "provider_call_failed", "unexpected_provider_response"] {
            var queue = queue()
            XCTAssertTrue(queue.stage(inputs, now: clock))
            let request = queue.beginAttempt(now: clock)
            let reuseOnly = SubjectResolutionQueue.retryRequiresRetainedReading(refusal: refusal,
                alreadyReuseOnly: request?.reuseOnly ?? true)
            queue.retry(reason: refusal, reuseOnly: reuseOnly, readingWasNotStarted: !reuseOnly)
            XCTAssertTrue(queue.beginAttempt(now: clock.addingTimeInterval(120))?.reuseOnly == true, refusal)
        }
        for refusal in ["source_not_ready", "required_input_unavailable"] {
            XCTAssertFalse(SubjectResolutionQueue.retryRequiresRetainedReading(refusal: refusal, alreadyReuseOnly: false))
            XCTAssertTrue(SubjectResolutionQueue.retryRequiresRetainedReading(refusal: refusal, alreadyReuseOnly: true))
        }
    }

    func testTransientRetryIsBoundedAndNewEvidenceCanStillArrive() {
        var queue = queue(2)
        XCTAssertTrue(queue.stage(Array(inputs.prefix(2)), now: clock))
        for delay in [0.0, 120.0, 720.0] {
            XCTAssertNotNil(queue.beginAttempt(now: clock.addingTimeInterval(delay)))
            queue.retry(reason: "provider unavailable")
        }
        XCTAssertNil(queue.active)
        XCTAssertTrue(queue.uploads.isEmpty)
        queue.acknowledge(localIdentifier: "same-bytes", sourceHash: hash("a"), now: clock)
        XCTAssertTrue(queue.uploads.isEmpty)
        queue.acknowledge(localIdentifier: "new-photo", sourceHash: hash("c"), now: clock)
        XCTAssertEqual(queue.uploads.count, 1)
        XCTAssertTrue(queue.lastOutcome?.contains("three attempts") == true)
    }

    func testKilledFinalAttemptExpiresInsteadOfBlockingAllLaterUploads() throws {
        var queue = queue()
        XCTAssertTrue(queue.stage(Array(inputs.prefix(2)), now: clock))
        for delay in [0.0, 120.0, 720.0] {
            XCTAssertNotNil(queue.beginAttempt(now: clock.addingTimeInterval(delay)))
        }
        var restored = try JSONDecoder().decode(SubjectResolutionQueue.self, from: JSONEncoder().encode(queue))
        XCTAssertNil(restored.beginAttempt(now: clock.addingTimeInterval(4320)))
        XCTAssertNil(restored.active)
        XCTAssertEqual(restored.uploads.map(\.sourceHash), [hash("c")])
        restored.acknowledge(localIdentifier: "later-photo", sourceHash: hash("d"), now: clock.addingTimeInterval(4320))
        XCTAssertEqual(restored.readyForSourceRead(now: clock.addingTimeInterval(4320)).count, 2)
    }

    func testGatePendingIsNotAnEmptySuccessfulReadOrASettledPhoto() {
        var queue = queue(2)
        queue.deferSources([hash("a"), hash("b")], now: clock, reason: "privacy gate pending")
        XCTAssertTrue(queue.readyForSourceRead(now: clock.addingTimeInterval(599)).isEmpty)
        XCTAssertEqual(queue.readyForSourceRead(now: clock.addingTimeInterval(600)).count, 2)
        XCTAssertTrue(queue.finishedHashes.isEmpty)
    }

    func testUnresolvedSettlesOnlyExactSourcesWithoutRepeatingInference() {
        var queue = queue()
        XCTAssertTrue(queue.stage(Array(inputs.prefix(2)), now: clock))
        _ = queue.beginAttempt(now: clock)
        queue.finish(reason: "needs corresponding view")
        XCTAssertNil(queue.active)
        XCTAssertEqual(queue.uploads.map(\.sourceHash), [hash("c")])
        queue.acknowledge(localIdentifier: "photo-0", sourceHash: hash("a"), now: clock)
        XCTAssertEqual(queue.uploads.count, 1)
    }

    func testContextlessLonePhotoWaitsWithoutPollingUntilAnotherAcknowledgedViewArrives() {
        var queue = queue(1)
        XCTAssertTrue(queue.stage([inputs[0]], now: clock))
        XCTAssertNotNil(queue.beginAttempt(now: clock))
        queue.awaitCorrespondingView(reason: "source_needs_corresponding_view")
        XCTAssertNil(queue.active)
        XCTAssertTrue(queue.finishedHashes.isEmpty)
        XCTAssertEqual(queue.uploads.count, 1)
        XCTAssertTrue(queue.readyForSourceRead(now: clock.addingTimeInterval(86_400)).isEmpty)
        queue.acknowledge(localIdentifier: "new-corresponding-view", sourceHash: hash("b"), now: clock.addingTimeInterval(86_400))
        XCTAssertEqual(queue.readyForSourceRead(now: clock.addingTimeInterval(86_400)).map(\.sourceHash), [hash("b"), hash("a")])
        XCTAssertTrue(queue.stage([inputs[1], inputs[0]], now: clock.addingTimeInterval(86_400)))
    }

    func testServerDeferredFreshPhotoKeepsItsAcknowledgementAndStartsAsNewWork() {
        var queue = queue(2)
        XCTAssertTrue(queue.stage(Array(inputs.prefix(2)), now: clock))
        XCTAssertNotNil(queue.beginAttempt(now: clock))
        queue.releaseDeferred([ids[1]])
        queue.finish(reason: "first source saved against protected context")
        XCTAssertEqual(queue.finishedHashes, [hash("a")])
        XCTAssertEqual(queue.uploads.map(\.sourceHash), [hash("b")])
        XCTAssertTrue(queue.stage([inputs[1]], now: clock))
        let deferredWork = queue.beginAttempt(now: clock)
        XCTAssertEqual(deferredWork?.attempts, 1)
        XCTAssertFalse(deferredWork?.reuseOnly ?? true)
    }

    func testExhaustedPartialStorageRetryNeverSettlesTheDeferredFreshPhoto() {
        var queue = queue(2)
        XCTAssertTrue(queue.stage(Array(inputs.prefix(2)), now: clock))
        XCTAssertNotNil(queue.beginAttempt(now: clock))
        queue.releaseDeferred([ids[1]])
        queue.retry(reason: "partial storage", reuseOnly: true)
        XCTAssertEqual(queue.active?.inputs, [inputs[0]])
        for delay in [120.0, 720.0] {
            XCTAssertTrue(queue.beginAttempt(now: clock.addingTimeInterval(delay))?.reuseOnly == true)
            queue.retry(reason: "storage unavailable", reuseOnly: true)
        }
        XCTAssertNil(queue.active)
        XCTAssertEqual(queue.finishedHashes, [hash("a")])
        XCTAssertEqual(queue.uploads.map(\.sourceHash), [hash("b")])
        XCTAssertTrue(queue.stage([inputs[1]], now: clock.addingTimeInterval(720)))
        XCTAssertEqual(queue.beginAttempt(now: clock.addingTimeInterval(720))?.attempts, 1)
    }

    func testConcurrentUploadAcknowledgementSurvivesOlderAttemptSnapshot() {
        var current = queue()
        var reading = queue(2)
        XCTAssertTrue(reading.stage(Array(inputs.prefix(2)), now: clock))
        reading.finish(reason: "saved")
        reading.preserveAcknowledgements(from: current)
        XCTAssertEqual(reading.uploads.map(\.sourceHash), [hash("c")])
        current = reading
        current.acknowledge(localIdentifier: "during-request", sourceHash: hash("d"), now: clock)
        reading.preserveAcknowledgements(from: current)
        XCTAssertEqual(Set(reading.uploads.map(\.sourceHash)), [hash("c"), hash("d")])
    }

    func testSuccessfulReceiptMustAccountForEveryExactInputOnce() {
        let requested = Set(ids.prefix(2))
        XCTAssertTrue(SubjectResolutionQueue.completeReceipt(requested: requested, persisted: [ids[0]], unresolved: [ids[1]]))
        XCTAssertFalse(SubjectResolutionQueue.completeReceipt(requested: requested, persisted: [ids[0]], unresolved: []))
        XCTAssertFalse(SubjectResolutionQueue.completeReceipt(requested: requested, persisted: [ids[0], ids[0]], unresolved: [ids[1]]))
        XCTAssertFalse(SubjectResolutionQueue.completeReceipt(requested: requested, persisted: [ids[0]], unresolved: [ids[0], ids[1]]))
        XCTAssertFalse(SubjectResolutionQueue.completeReceipt(requested: requested, persisted: [ids[0], ids[2]], unresolved: [ids[1]]))
        XCTAssertTrue(SubjectResolutionQueue.completeReceipt(requested: requested, persisted: [ids[0]], unresolved: [], deferred: [ids[1]]))
        XCTAssertFalse(SubjectResolutionQueue.completeReceipt(requested: requested, persisted: [ids[0]], unresolved: [], deferred: [ids[0], ids[1]]))
        XCTAssertFalse(SubjectResolutionQueue.completeReceipt(requested: requested, persisted: [], unresolved: [], deferred: Array(requested)))
    }

    func testRetainedUnknownReadingsRefreshSourcesWithoutRequiringAProfileOrAcceptingForeignReceipts() {
        let requested = Set(ids.prefix(2))
        XCTAssertEqual(SubjectResolutionQueue.sourceReadChange(requested: requested, persisted: [], retained: Array(requested), deferred: []), .changed)
        XCTAssertEqual(SubjectResolutionQueue.sourceReadChange(requested: requested, persisted: [], retained: [ids[0]], deferred: [ids[1]]), .changed)
        XCTAssertEqual(SubjectResolutionQueue.sourceReadChange(requested: requested, persisted: [ids[0]], retained: [], deferred: [ids[1]]), .changed)
        XCTAssertEqual(SubjectResolutionQueue.sourceReadChange(requested: requested, persisted: [], retained: [], deferred: []), .unchanged)
        XCTAssertEqual(SubjectResolutionQueue.sourceReadChange(requested: requested, persisted: [], retained: [ids[2]], deferred: []), .invalid)
        XCTAssertEqual(SubjectResolutionQueue.sourceReadChange(requested: requested, persisted: [], retained: [ids[1]], deferred: [ids[1]]), .invalid)
        XCTAssertEqual(SubjectResolutionQueue.sourceReadChange(requested: requested, persisted: [], retained: [ids[0], ids[0]], deferred: []), .invalid)
    }
}
