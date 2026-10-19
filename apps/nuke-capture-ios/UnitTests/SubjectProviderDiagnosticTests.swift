import XCTest
@testable import NukeCapture

final class SubjectProviderDiagnosticTests: XCTestCase {
    private func diagnostic(_ code: String, provider: String? = "anthropic", status: Int? = nil,
                            kind: String? = nil) -> SubjectProviderDiagnostic {
        SubjectProviderDiagnostic(code: code, provider: provider, http_status: status, credential_kind: kind)
    }

    func testCredentialRejectionDoesNotInventRevocationOrMisclassifyASignInCredentialAsAnAPIKey() throws {
        let key = diagnostic("credential_not_accepted", status: 401, kind: "api_key")
        let oauth = diagnostic("credential_not_accepted", status: 401, kind: "oauth")
        XCTAssertTrue(try XCTUnwrap(key.message).contains("wasn't accepted by the API-key route"))
        XCTAssertTrue(try XCTUnwrap(oauth.message).contains("sign-in credential"))
        XCTAssertFalse(try XCTUnwrap(key.message).contains("revoked"))
        XCTAssertFalse(try XCTUnwrap(key.message).contains("expired"))
        XCTAssertTrue(key.needsConnectionReview)
        XCTAssertTrue(oauth.needsConnectionReview)
        XCTAssertNil(diagnostic("credential_not_accepted", status: 400).message)
    }

    func testMissingConnectionAndFailedLookupHaveDifferentActionableStates() throws {
        let missing = diagnostic("no_connected_key", provider: nil)
        let failed = diagnostic("credential_lookup_failed")
        XCTAssertTrue(missing.needsConnectionReview)
        XCTAssertTrue(failed.needsConnectionReview)
        XCTAssertTrue(try XCTUnwrap(missing.message).contains("needs a connected API key"))
        XCTAssertTrue(try XCTUnwrap(failed.message).contains("couldn't read"))
        XCTAssertNotEqual(missing.message, failed.message)
    }

    func testProviderLimitsAreNotTurnedIntoMissingKeysOrInstructionsToFundNuke() throws {
        let billing = diagnostic("billing_or_usage_limit", provider: "openai", status: 429)
        let rate = diagnostic("rate_or_quota_limit", status: 429)
        let guardHeld = diagnostic("service_guard_held", provider: "google", status: 429)
        XCTAssertTrue(try XCTUnwrap(billing.message).contains("billing or usage limit"))
        XCTAssertTrue(try XCTUnwrap(rate.message).contains("rate or quota limit"))
        XCTAssertTrue(try XCTUnwrap(guardHeld.message).contains("service's existing request guard"))
        XCTAssertFalse(billing.needsConnectionReview)
        XCTAssertFalse(rate.needsConnectionReview)
        XCTAssertFalse(try XCTUnwrap(billing.message).contains("wallet"))
    }

    func testUnknownMetadataNeverRendersBackendProseAndUnreadablePaidOutputStaysDistinct() throws {
        XCTAssertNil(diagnostic("PRIVATE_PROVIDER_CANARY", provider: "PRIVATE_PROVIDER_CANARY").message)
        let unreadable = try XCTUnwrap(diagnostic("response_unreadable", provider: "PRIVATE_PROVIDER_CANARY").message)
        XCTAssertTrue(unreadable.contains("responded"))
        XCTAssertFalse(unreadable.contains("PRIVATE_PROVIDER_CANARY"))
        XCTAssertFalse(diagnostic("response_unreadable").needsConnectionReview)
    }

    func testExistingReceiptsWithoutDiagnosticsDecodeAndNewMetadataIsOptional() throws {
        let json = #"{"method":"visual_subjects_v1","status":"refused","persisted_image_ids":[],"deferred_image_ids":[],"unresolved":[],"refusal":"provider_unavailable"}"#
        let old = try JSONDecoder().decode(SubjectResolutionEngine.Response.self, from: Data(json.utf8))
        XCTAssertNil(old.provider_diagnostics)
        let appended = String(json.dropLast()) + #", "provider_diagnostics":[{"code":"credential_not_accepted","provider":"anthropic","http_status":401,"credential_kind":"oauth","unexpected_body":"PRIVATE_PROVIDER_CANARY"}]}"#
        let current = try JSONDecoder().decode(SubjectResolutionEngine.Response.self, from: Data(appended.utf8))
        XCTAssertEqual(current.refusal, old.refusal)
        XCTAssertEqual(current.provider_diagnostics?.first?.credential_kind, "oauth")
        XCTAssertFalse(try XCTUnwrap(current.provider_diagnostics?.first?.message).contains("PRIVATE_PROVIDER_CANARY"))
    }

    private var allRejected: [SubjectProviderDiagnostic] {
        ["google", "anthropic", "openai"].map { diagnostic("credential_not_accepted", provider: $0, status: 401) }
    }
    private func coverage(complete: Bool = true, noReading: Bool = true, observed: Int = 3) -> SubjectProviderDiagnostic.AttemptCoverage {
        .init(method: "byok_vision_attempts_v1", expected_providers: 3, assessed_providers: 3,
              outcomes_observed: observed, complete: complete, no_reading_started: noReading)
    }

    func testFreshRetryRequiresEveryProviderOutcomeAndAnUntruncatedCertificate() {
        XCTAssertTrue(SubjectProviderDiagnostic.provesNoReading(allRejected, coverage: coverage()))
        let lookup = [diagnostic("credential_lookup_failed", provider: "google"), allRejected[1],
                      diagnostic("no_connected_key", provider: "openai")]
        XCTAssertTrue(SubjectProviderDiagnostic.provesNoReading(lookup, coverage: coverage()))
        for code in ["response_unreadable", "request_failed", "provider_transient", "rate_or_quota_limit"] {
            let mixed = [allRejected[0], allRejected[1], diagnostic(code, provider: "openai", status: code == "provider_transient" ? 503 : nil)]
            XCTAssertFalse(SubjectProviderDiagnostic.provesNoReading(mixed, coverage: coverage()))
        }
        XCTAssertFalse(SubjectProviderDiagnostic.provesNoReading(allRejected, coverage: nil))
        XCTAssertFalse(SubjectProviderDiagnostic.provesNoReading(allRejected, coverage: coverage(complete: false)))
        XCTAssertFalse(SubjectProviderDiagnostic.provesNoReading(allRejected, coverage: coverage(noReading: false)))
        XCTAssertFalse(SubjectProviderDiagnostic.provesNoReading(allRejected, coverage: coverage(observed: 4)))
        XCTAssertFalse(SubjectProviderDiagnostic.provesNoReading(Array(allRejected.prefix(1)), coverage: coverage()))
        XCTAssertFalse(SubjectProviderDiagnostic.provesNoReading([allRejected[0], allRejected[1], allRejected[1]], coverage: coverage()))
    }

    func testCertifiedNoReadingRetriesRetainBackoffAndThreeAttemptCapWithoutResettingFinishedHashes() throws {
        let clock = Date(timeIntervalSince1970: 1_700_000_000)
        var queue = SubjectResolutionQueue()
        let hashes = [String(repeating: "a", count: 64), String(repeating: "b", count: 64)]
        let ids = ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"]
        for (i, hash) in hashes.enumerated() { queue.acknowledge(localIdentifier: "fixture-\(i)", sourceHash: hash, now: clock) }
        XCTAssertTrue(queue.stage(zip(ids, hashes).map { .init(imageId: $0.0, sourceHash: $0.1) }, now: clock))
        for (index, delay) in [0.0, 120.0, 720.0].enumerated() {
            let batch = try XCTUnwrap(queue.beginAttempt(now: clock.addingTimeInterval(delay)))
            XCTAssertEqual(batch.attempts, index + 1)
            XCTAssertFalse(batch.reuseOnly)
            let reuse = SubjectResolutionQueue.retryRequiresRetainedReading(refusal: "provider_unavailable", alreadyReuseOnly: batch.reuseOnly,
                providerReadNotStarted: SubjectProviderDiagnostic.provesNoReading(allRejected, coverage: coverage()))
            queue.retry(reason: "credential not accepted", reuseOnly: reuse, readingWasNotStarted: !reuse)
            if index == 0 { XCTAssertNil(queue.beginAttempt(now: clock.addingTimeInterval(119))) }
        }
        XCTAssertNil(queue.active)
        XCTAssertEqual(Set(queue.finishedHashes), Set(hashes))
        queue.acknowledge(localIdentifier: "same-finished-bytes", sourceHash: hashes[0], now: clock.addingTimeInterval(10_000))
        XCTAssertTrue(queue.uploads.isEmpty)
        XCTAssertTrue(SubjectResolutionQueue.retryRequiresRetainedReading(refusal: "provider_unavailable", alreadyReuseOnly: true,
            providerReadNotStarted: true))
        XCTAssertTrue(SubjectResolutionQueue.retryRequiresRetainedReading(refusal: "retained_reading_unavailable", alreadyReuseOnly: false,
            providerReadNotStarted: true))
    }

    func testActualRequestFailureLeadsMissingAlternativeKeysInTheUI() {
        let failures = [diagnostic("no_connected_key", provider: "google"), diagnostic("no_connected_key", provider: "openai"), allRejected[1]]
        XCTAssertEqual(SubjectProviderDiagnostic.primary(failures)?.code, "credential_not_accepted")
        XCTAssertEqual(SubjectProviderDiagnostic.primary(failures)?.provider, "anthropic")
    }

    func testPlatformOutcomesNeverAskCustomersToConfigureProviderKeys() {
        for code in ["platform_not_configured", "platform_unavailable", "platform_result_unreadable", "analysis_balance_required", "analysis_pending"] {
            XCTAssertFalse(diagnostic(code).needsConnectionReview)
        }
    }

    func testPlatformRetryRequiresAnExactSingleProviderNoReadingCertificate() {
        let proof = SubjectProviderDiagnostic.AttemptCoverage(method: "platform_vision_attempt_v1",
            expected_providers: 1, assessed_providers: 1, outcomes_observed: 1,
            complete: true, no_reading_started: true)
        for code in ["platform_not_configured", "analysis_balance_required"] {
            XCTAssertTrue(SubjectProviderDiagnostic.provesNoReading([diagnostic(code)], coverage: proof))
            XCTAssertFalse(SubjectProviderDiagnostic.provesNoReading([diagnostic(code, provider: "google")], coverage: proof))
            XCTAssertFalse(SubjectProviderDiagnostic.provesNoReading([diagnostic(code), diagnostic(code)], coverage: proof))
        }
        XCTAssertTrue(SubjectProviderDiagnostic.provesNoReading([diagnostic("platform_unavailable", status: 401)], coverage: proof))
        for code in ["analysis_pending", "platform_result_unreadable", "request_failed"] {
            XCTAssertFalse(SubjectProviderDiagnostic.provesNoReading([diagnostic(code)], coverage: proof))
        }
        XCTAssertFalse(SubjectProviderDiagnostic.provesNoReading([diagnostic("platform_unavailable", status: 503)], coverage: proof))
    }

    func testNotDueRepublishKeepsTheReviewLinkOnlyForTheSameOutcomeAndAccount() {
        func flag(user: String = "own", summary: String = "unchanged", explicit: Bool? = nil) -> Bool {
            SubjectProviderDiagnostic.reviewFlag(previousUser: "own", user: user, previousSummary: "unchanged", summary: summary,
                previousValue: true, explicitValue: explicit)
        }
        XCTAssertTrue(flag())
        XCTAssertFalse(flag(user: "another"))
        XCTAssertFalse(flag(summary: "new outcome"))
        XCTAssertFalse(flag(explicit: false))
    }
}
