// JobPathDecodeTests.swift — the job readers' shapes, the stage → rung ladder, the viewer block
// and the words a person reads.
//
// The job path is read_work_order_job_path's output as its wrapper returns it. A future state,
// stage, context or action must decode without crashing; no stage state reaches .proven. Data is
// open by default: prices and costs show to anyone, payment/balance amounts need money_visible,
// and personal contact fields are never rendered.

import XCTest
import Supabase
@testable import NukeCapture

final class JobPathDecodeTests: XCTestCase {
    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try JobReaders.decode(T.self, from: Data(json.utf8))
    }

    // MARK: Job path

    func testJobPathDecodesEveryStageOfTheMigrationShape() throws {
        let p = try decode(JobPath.self, JobFixtures.jobPath)
        XCTAssertEqual(p.workOrderId, JobFixtures.workOrderId)
        XCTAssertEqual(p.vehicleId, JobFixtures.vehicleId)
        XCTAssertEqual(Set(p.stages.keys), Set(JobStageKey.allCases))
        XCTAssertTrue(p.unknownStages.isEmpty)
        XCTAssertEqual(p.stages[.intake]?.state, .recorded)
        XCTAssertEqual(p.stages[.inspection]?.state, .absent)
        XCTAssertEqual(p.stages[.inspection]?.gaps, ["no_inspection_requirement"])
        XCTAssertEqual(p.stages[.completion]?.state, .statusOnly)
        XCTAssertEqual(p.stages[.completion]?.inconsistencies, ["done_status_without_completion_clock"])
        XCTAssertEqual(p.stages[.terms]?.inconsistencies, ["assignment_accepted_status_without_clock"])
        XCTAssertEqual(p.stateBasis, "presence of existing owner records and clocks; not verified truth")
        XCTAssertEqual(p.bookingReadiness?.text, "not_assessed")
        XCTAssertEqual(p.permissionAuthority?.text, "not_assessed")
        XCTAssertEqual(p.paymentAuthorized?.text, "false")
    }

    func testStageFactsKeepEveryOtherKeyVerbatimAndSorted() throws {
        let p = try decode(JobPath.self, JobFixtures.jobPath)
        let plan = try XCTUnwrap(p.stages[.plan])
        let keys = plan.facts.map(\.key)
        XCTAssertEqual(keys, keys.sorted())
        XCTAssertFalse(keys.contains("state"))
        XCTAssertFalse(keys.contains("gaps"))
        XCTAssertEqual(plan.facts.first { $0.key == "operations" }?.value.intValue, 3)
        XCTAssertEqual(plan.facts.first { $0.key == "parts_by_status" }?.value.text, "ordered 1 · unstated 1")
        XCTAssertEqual(plan.facts.first { $0.key == "executable" }?.value.text, "not_assessed")
        let terms = try XCTUnwrap(p.stages[.terms])
        XCTAssertEqual(terms.facts.first { $0.key == "approval_clock" }?.value, .null)
        XCTAssertEqual(terms.facts.first { $0.key == "estimate_recorded" }?.value, .bool(true))
    }

    func testUnknownStateStageAndMalformedGapsDecodeWithoutCrashing() throws {
        let p = try decode(JobPath.self, JobFixtures.futureJobPath)
        XCTAssertNil(p.vehicleId)
        XCTAssertEqual(p.stages[.terms]?.state, .unknown("awaiting_signature"))
        XCTAssertEqual(p.stages[.terms]?.state.raw, "awaiting_signature")
        XCTAssertEqual(p.unknownStages, ["custody"])
        XCTAssertEqual(p.stages[.completion]?.gaps, [])          // a non-array is read as no gaps, not a failure
        XCTAssertNil(p.stages[.plan])                             // a stage the reader did not send stays unread
        XCTAssertEqual(p.bookingReadiness?.text, "verdict not_assessed")
        XCTAssertNil(p.permissionAuthority)
    }

    func testArrayWrappedBodyIsReadAsItsFirstElement() throws {
        let p = try decode(JobPath.self, "[" + JobFixtures.jobPath + "]")
        XCTAssertEqual(p.workOrderId, JobFixtures.workOrderId)
    }

    func testAJobPathWithoutAWorkOrderIdIsADecodeFailure() {
        XCTAssertThrowsError(try decode(JobPath.self, #"{"stages":{}}"#))
    }

    // MARK: Stage → RootStatus

    func testStageStateMapsToTheTrustLadder() {
        XCTAssertEqual(JobRung.status(.recorded, hasInconsistency: false), .attributed)
        XCTAssertEqual(JobRung.status(.partial, hasInconsistency: false), .pending)
        XCTAssertEqual(JobRung.status(.statusOnly, hasInconsistency: false), .recorded)
        XCTAssertNil(JobRung.status(.absent, hasInconsistency: false))
        XCTAssertEqual(JobRung.status(.unknown("awaiting_signature"), hasInconsistency: false), .recorded)
    }

    func testAnyInconsistencyIsConflictingWhateverTheState() {
        for state in [JobStageState.recorded, .partial, .statusOnly, .absent, .unknown("x")] {
            XCTAssertEqual(JobRung.status(state, hasInconsistency: true), .conflicting, "\(state)")
        }
    }

    func testNoStageStateReachesProven() throws {
        for state in [JobStageState.recorded, .partial, .statusOnly, .absent, .unknown("signed"), .unknown("proven")] {
            for conflict in [false, true] {
                XCTAssertNotEqual(JobRung.status(state, hasInconsistency: conflict), .proven)
            }
        }
        let p = try decode(JobPath.self, JobFixtures.jobPath)
        XCTAssertEqual(p.stages.values.compactMap { JobRung.status($0) }.filter { $0 == .proven }.count, 0)
    }

    func testFixtureStagesLandOnTheirRungs() throws {
        let p = try decode(JobPath.self, JobFixtures.jobPath)
        XCTAssertEqual(JobRung.status(try XCTUnwrap(p.stages[.intake])), .attributed)
        XCTAssertEqual(JobRung.status(try XCTUnwrap(p.stages[.plan])), .pending)
        XCTAssertEqual(JobRung.status(try XCTUnwrap(p.stages[.terms])), .conflicting)
        XCTAssertEqual(JobRung.status(try XCTUnwrap(p.stages[.completion])), .conflicting)
        XCTAssertNil(JobRung.status(try XCTUnwrap(p.stages[.accounting])))
    }

    func testRailDotsFollowTheLadder() throws {
        let p = try decode(JobPath.self, JobFixtures.jobPath)
        let rail = JobStageRail(path: p)
        XCTAssertEqual(rail.dots.map(\.key), JobStageKey.allCases)
        let byKey = Dictionary(uniqueKeysWithValues: rail.dots.map { ($0.key, $0) })
        XCTAssertEqual(JobStageRail.symbol(byKey[.intake]!), "circle.fill")
        XCTAssertEqual(JobStageRail.symbol(byKey[.plan]!), "circle.lefthalf.filled")
        XCTAssertEqual(JobStageRail.symbol(byKey[.terms]!), "exclamationmark.circle.fill")
        XCTAssertEqual(JobStageRail.symbol(byKey[.accounting]!), "circle")
        let unread = JobStageRail(states: [:])
        XCTAssertTrue(unread.dots.allSatisfy { JobStageRail.symbol($0) == "circle.dotted" })
    }

    // MARK: Viewer block

    func testViewerBlockDecodesAndFailsClosed() throws {
        let p = try decode(JobPath.self, JobFixtures.jobPath)
        let v = try XCTUnwrap(p.viewer)
        XCTAssertEqual(v.context, .client)
        XCTAssertEqual(v.slots, ["customer"])
        XCTAssertFalse(v.moneyVisible)
        XCTAssertFalse(v.contactVisible)
        XCTAssertEqual(v.decidedFrom, "auth.uid()")
        XCTAssertEqual(v.identityBridge, "none")
        XCTAssertTrue(v.actions.isEmpty)

        let future = try XCTUnwrap(try decode(JobPath.self, JobFixtures.futureJobPath).viewer)
        XCTAssertEqual(future.context, .unknown("auditor"))
        XCTAssertFalse(future.moneyVisible)                       // "yes" is not true
        XCTAssertFalse(future.contactVisible)                     // absent is not true
        XCTAssertEqual(future.actions.map(\.kind), ["accept_terms", "attest_completion"])
        XCTAssertEqual(future.actions[0].title, "Accept quote")
        XCTAssertEqual(future.actions[1].title, "Attest completion")
        XCTAssertEqual(future.actions[1].stage, "completion")
    }

    func testPricesAreOpenAndPaymentsNeedTheServersMoneyFlag() {
        let quote = JobStage.Fact(key: "estimated_total_cents", value: .number(125000))
        XCTAssertEqual(JobPathContent.factText(quote, moneyVisible: false), "125000")
        let rate = JobStage.Fact(key: "labor_rate_cents", value: .number(16000))
        XCTAssertEqual(JobPathContent.factText(rate, moneyVisible: false), "16000")
        let paid = JobStage.Fact(key: "amount_paid_cents", value: .number(50000))
        XCTAssertEqual(JobPathContent.factText(paid, moneyVisible: false), "Shown to the people on this job")
        XCTAssertEqual(JobPathContent.factText(paid, moneyVisible: true), "50000")
        let balance = JobStage.Fact(key: "balance_due_cents", value: .number(75000))
        XCTAssertEqual(JobPathContent.factText(balance, moneyVisible: false), "Shown to the people on this job")
        let count = JobStage.Fact(key: "payment_records", value: .number(2))
        XCTAssertEqual(JobPathContent.factText(count, moneyVisible: false), "2")
        let flag = JobStage.Fact(key: "cost_allocated", value: .bool(false))
        XCTAssertEqual(JobPathContent.factText(flag, moneyVisible: false), "No")
    }

    func testContactFieldsAreNeverRendered() {
        let facts: [JobStage.Fact] = ["customer_email", "phone", "street_address", "contact_info", "legal_name", "operations", "source_scope"]
            .map { .init(key: $0, value: .string("x")) }
        XCTAssertEqual(JobPathContent.visibleFacts(facts).map(\.key), ["operations"])
    }

    func testPlainWordsForCodes() throws {
        XCTAssertEqual(JobCopy.stateLine(.recorded), "Recorded — not yet verified")
        XCTAssertEqual(JobCopy.state(.unknown("awaiting_signature")), "Needs a newer app version")
        XCTAssertEqual(JobCopy.gap("no_approval_clock"), "Quote not accepted yet")
        XCTAssertEqual(JobCopy.gap("some_new_gap"), "Some new gap")
        XCTAssertEqual(JobCopy.conflict("done_status_without_completion_clock"), "Marked done, but no completion date")
        XCTAssertEqual(JobCopy.fact("approval_clock"), "Quote accepted")
        XCTAssertEqual(JobCopy.value(.string("not_assessed")), "Not assessed yet")
        XCTAssertEqual(JobCopy.value(.bool(false)), "No")
        XCTAssertEqual(JobCopy.value(.null), "Not on record")
        XCTAssertEqual(JobStageKey.terms.title, "Quote & terms")
        XCTAssertEqual(JobStageKey.allCases.map(\.initial).joined(), "RIEQWCP")
        let v = try XCTUnwrap(try decode(JobPath.self, JobFixtures.jobPath).viewer)
        XCTAssertEqual(JobCopy.viewingAs(v), "customer")
        XCTAssertEqual(JobCopy.viewingAs(JobViewer(context: .visitor)), "visitor")
        XCTAssertEqual(JobCopy.technicianLink("none"), "Your account isn't linked to a technician profile yet")
        XCTAssertNil(JobCopy.technicianLink(nil))
        XCTAssertEqual(JobCopy.action("contact_via_nuke"), "Contact via Nuke")
        XCTAssertEqual(JobCopy.newerVersion(1), "Some items need a newer app version (1)")
    }

    func testNotEstablishedFactsRenderAtTheRecordRung() {
        let fact = JobStage.Fact(key: "customer_acceptance", value: .string("not_established"))
        XCTAssertEqual(JobPathContent.factStatus(fact, stageRung: .attributed), .recorded)
        XCTAssertEqual(JobPathContent.factStatus(.init(key: "approval_clock", value: .null), stageRung: .pending), .recorded)
        XCTAssertEqual(JobPathContent.factStatus(.init(key: "operations", value: .number(3)), stageRung: .pending), .pending)
    }

    // MARK: Lists

    func testMyWorkOrdersKeepsReadableRowsAndCountsTheRest() throws {
        let page = try decode(MyWorkOrders.self, JobFixtures.myWorkOrders)
        XCTAssertEqual(page.rows.count, 2)
        XCTAssertEqual(page.unreadableRows, 1)
        XCTAssertEqual(page.coverage?.sentence, "Showing 2 of 2 work orders")
        XCTAssertEqual(page.rows[0].stageStates[.completion], .statusOnly)
        XCTAssertEqual(page.rows[0].firstGap, "no_inspection_requirement")
        XCTAssertNil(page.rows[1].title)
        XCTAssertEqual(page.rows[1].stageStates.count, 7)           // an unknown stage key is not a column
        XCTAssertEqual(page.viewer?.slots.count, 3)
        XCTAssertEqual(JobCoverage(returned: nil, totalForViewer: nil).sentence, "Total not available")
    }

    func testSignatureQueueDecodes() throws {
        let q = try decode(SignatureQueue.self, JobFixtures.signatureQueue)
        XCTAssertEqual(q.items.map(\.kind), ["accept_terms", "work_day"])
        XCTAssertEqual(q.unreadableItems, 1)
        XCTAssertEqual(q.items[0].workOrderId, JobFixtures.workOrderId)
        XCTAssertEqual(WorkConsoleContent.evidenceLine(q.items[0].evidenceCounts), "3 operations · 12 photos")
        XCTAssertEqual(JobCopy.action(q.items[0].kind), "Accept quote")
        XCTAssertEqual(q.viewer?.context, .selfView)
    }

    func testResourcesReadAsCountsWithTheReadersCoverage() throws {
        let r = try decode(JobResources.self, JobFixtures.resources)
        XCTAssertEqual(r.requirements, 1)
        XCTAssertEqual(r.fulfillments, 0)
        XCTAssertEqual(r.specifications, 1)
        XCTAssertEqual(r.coverage.map(\.key), ["recorded_requirements", "recorded_specifications", "requirement_population", "requirements_with_candidates"])
    }

    func testIdentityBridgePrefersTheViewerBlock() throws {
        let both = try decode(MyIdentity.self, #"{"provider_link":{"state":"claimed"},"viewer":{"context":"self","identity_bridge":"evidenced"}}"#)
        XCTAssertEqual(both.bridge, "evidenced")
        let linkOnly = try decode(MyIdentity.self, #"{"provider_link":{"state":"claimed"}}"#)
        XCTAssertEqual(linkOnly.bridge, "claimed")
        XCTAssertNil(try decode(MyIdentity.self, "{}").bridge)
    }

    // MARK: Refusals

    func testAMissingReaderIsPendingNotAFailure() {
        let missing = PostgrestError(code: "PGRST202", message: "Could not find the function public.my_work_orders")
        let r = JobReaders.refusal(JobReaders.workOrdersName, missing)
        XCTAssertEqual(r.kind, .readerPending)
        XCTAssertEqual(r.title, "Not available yet")
        XCTAssertEqual(r.detail, "This part of Nuke is still being built.")
        XCTAssertEqual(r.reader, "my_work_orders")
    }

    func testARefusedGrantSaysSo() {
        let denied = PostgrestError(code: "42501", message: "permission denied for function work_order_job_path_read")
        let r = JobReaders.refusal(JobReaders.jobPathName, denied)
        XCTAssertEqual(r.kind, .notPermitted)
        XCTAssertEqual(r.title, "Not available to your account")
    }

    func testOtherFailuresUseReadFailureWords() {
        let decodeFailure = DecodingError.dataCorrupted(.init(codingPath: [], debugDescription: "x"))
        let r = JobReaders.refusal(JobReaders.signatureQueueName, decodeFailure)
        XCTAssertEqual(r.kind, .failed)
        XCTAssertEqual(r.detail, "This needs a newer version of the app.")
        let offline = JobReaders.refusal(JobReaders.identityName, URLError(.notConnectedToInternet))
        XCTAssertEqual(offline.title, "Couldn't load")
        XCTAssertEqual(offline.detail, "No network connection.")
    }
}
