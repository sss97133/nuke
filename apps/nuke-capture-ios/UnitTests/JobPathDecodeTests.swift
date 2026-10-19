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

    func testMyWorkOrdersDecodesTheShippedShape() throws {
        let page = try decode(MyWorkOrders.self, JobFixtures.myWorkOrders)
        XCTAssertEqual(page.rows.count, 2)
        XCTAssertEqual(page.unreadableRows, 1)
        XCTAssertEqual(page.coverage?.sentence, "Showing 2 of 5 work orders")
        XCTAssertNil(page.coverage?.slotFilter)
        XCTAssertEqual(page.nextAfter, "00000000-0000-4000-8000-000000000002")
        XCTAssertEqual(page.rows[0].stageStates[.completion], .statusOnly)
        XCTAssertEqual(page.rows[0].firstGap, JobGapRef(stage: "inspection", gap: "no_inspection_requirement"))
        XCTAssertEqual(page.rows[0].inconsistencyCount, 2)
        XCTAssertEqual(page.rows[0].headline, "Brake service")
        XCTAssertNil(page.rows[1].title)
        XCTAssertEqual(page.rows[1].headline, "Untitled job")             // never the id
        XCTAssertEqual(page.rows[1].slots.map(JobCopy.slot), ["shop owner", "has access to this vehicle"])
        XCTAssertEqual(page.rows[1].stageStates.count, 7)                 // an unknown stage key is not a column
        XCTAssertEqual(page.viewer?.context, .selfView)
        XCTAssertEqual(page.viewer?.identityBridge, "claimed")
        XCTAssertEqual(JobCoverage(returned: nil, totalForViewer: nil).sentence, "Total not available")
    }

    func testMyWorkOrdersPagesAppendAndTakeTheNewerCursor() throws {
        let first = try decode(MyWorkOrders.self, JobFixtures.myWorkOrders)
        let merged = first.appending(try decode(MyWorkOrders.self, JobFixtures.myWorkOrdersPage2))
        XCTAssertEqual(merged.rows.count, 3)
        XCTAssertNil(merged.nextAfter)
        XCTAssertEqual(merged.unreadableRows, 1)
        XCTAssertEqual(merged.rows[2].vehicleLabel?.text, "1969 Ford Mustang")   // a string year is read
        XCTAssertEqual(merged.rows[2].headline, "Paint correction")
        XCTAssertNil(merged.rows[2].firstGap)
    }

    func testFirstGapAsABareCodeStillDecodes() throws {
        let row = try decode(JobRow.self, #"{"work_order_id":"w","first_gap":"no_vehicle","inconsistencies":["a","b"]}"#)
        XCTAssertEqual(row.firstGap, JobGapRef(stage: nil, gap: "no_vehicle"))
        XCTAssertEqual(row.inconsistencyCount, 2)
    }

    func testSignatureQueueDecodesTheShippedShape() throws {
        let q = try decode(SignatureQueue.self, JobFixtures.signatureQueue)
        XCTAssertEqual(q.items.count, 2)
        XCTAssertEqual(q.unreadableItems, 1)
        let item = q.items[0]
        XCTAssertEqual(item.kind, "work_session")
        XCTAssertNil(item.workOrderId)
        XCTAssertEqual(item.vehicle?.text, "1977 Chevrolet Blazer")
        XCTAssertEqual(item.clock?.sessionDate, "2026-10-17")
        XCTAssertEqual(item.captureSpanMinutes, 190)
        XCTAssertEqual(item.sign?.rpc, "confirm_work_session")
        XCTAssertEqual(item.sign?.doesNotBind, ["counterparty acceptance", "labor value", "payment"])
        XCTAssertEqual(q.coverage?.total, 7)
        XCTAssertEqual(q.coverage?.limit, 250)
        XCTAssertEqual(q.coverage?.kindsNotYetAvailable.count, 4)
        XCTAssertEqual(q.viewer?.context, .selfView)
        let legacy = try decode(SignatureItem.self, #"{"kind":"work_session","ref_id":"x","clock":"2026-10-17"}"#)
        XCTAssertEqual(legacy.clock?.sessionDate, "2026-10-17")
    }

    func testSignatureItemsReadInPlainWords() throws {
        let item = try decode(SignatureQueue.self, JobFixtures.signatureQueue).items[0]
        XCTAssertEqual(JobCopy.action(item.kind), "Confirm work day")
        XCTAssertEqual(JobCopy.day(item.clock?.sessionDate), "Oct 17, 2026")
        XCTAssertEqual(JobCopy.span(item.captureSpanMinutes), "3h 10m of photos")
        XCTAssertEqual(JobCopy.evidenceLine(item.evidenceCounts), "12 photos in this session · 41 photos of this vehicle that day")
        XCTAssertEqual(JobCopy.signBinds(item.sign?.binds), "You worked on this vehicle that day, as your photos show.")
        XCTAssertEqual(item.sign?.doesNotBind.map(JobCopy.signDoesNotBind), ["That the customer agreed", "A price for the labor", "Any payment"])
        XCTAssertEqual(JobCopy.comingKinds(["terms", "offer", "completion_attestation", "co_sign_request"]),
                       "Quotes, offers, completion sign-offs and co-sign requests will appear here as they become available.")
        XCTAssertNil(JobCopy.comingKinds([]))
    }

    func testResourcesReadAsCountsWithTheReadersCoverage() throws {
        let r = try decode(JobResources.self, JobFixtures.resources)
        XCTAssertEqual(r.requirements, 1)
        XCTAssertEqual(r.fulfillments, 0)
        XCTAssertEqual(r.specifications, 1)
        XCTAssertEqual(JobPathContent.visibleFacts(r.coverage).map(\.key),
                       ["recorded_requirements", "recorded_specifications", "requirement_population", "requirements_with_candidates"])
        XCTAssertEqual(r.viewer?.slots, ["customer"])
    }

    func testIdentityDecodesTheShippedShape() throws {
        let me = try decode(MyIdentity.self, JobFixtures.identity)
        XCTAssertEqual(me.bridge, "claimed")
        XCTAssertEqual(me.username, "fixture_tech")
        XCTAssertEqual(me.claims.count, 2)
        XCTAssertEqual(me.claims[0].actorName, "Fixture Mechanic")
        XCTAssertEqual(me.claims[0].rung, "self_claim")
        XCTAssertEqual(me.claims[1].evidenceEntries, 2)
        XCTAssertEqual(me.claimedActorIds, ["00000000-0000-4000-8000-0000000000d1", "00000000-0000-4000-8000-0000000000d2"])
        XCTAssertEqual(JobCopy.claimStatus(me.claims[0].status), "Waiting for your work to back it up")
        XCTAssertEqual(JobCopy.claimRung(me.claims[1].rung), "Backed by your work")
        XCTAssertEqual(ProviderLinkView.claimLine(me.claims[1]), "Backed by your work · filed Sep 1, 2026 · 2 pieces of evidence")
        XCTAssertEqual(ProviderLinkView.rung("approved"), .attributed)
        XCTAssertEqual(ProviderLinkView.rung("rejected"), .refuted)
    }

    func testIdentityBridgePrefersTheViewerBlock() throws {
        let both = try decode(MyIdentity.self, #"{"provider_link":{"state":"claimed"},"viewer":{"context":"self","identity_bridge":"evidenced"}}"#)
        XCTAssertEqual(both.bridge, "evidenced")
        let linkOnly = try decode(MyIdentity.self, #"{"provider_link":{"state":"claimed"}}"#)
        XCTAssertEqual(linkOnly.bridge, "claimed")
        XCTAssertNil(try decode(MyIdentity.self, "{}").bridge)
    }

    // MARK: Display fields and contexts

    func testJobPathUsesDisplayFieldsWhenTheReaderSendsThem() throws {
        let p = try decode(JobPath.self, JobFixtures.jobPathWithLabels)
        XCTAssertEqual(p.displayTitle, "Front brake service")
        XCTAssertEqual(p.vehicleLabel?.text, "1977 Chevrolet Blazer Cheyenne")
        XCTAssertEqual(p.requestSourceLabel, "Requested in the Nuke app")
        let bare = try decode(JobPath.self, JobFixtures.jobPath)
        XCTAssertNil(bare.displayTitle)
        XCTAssertNil(bare.vehicleLabel)
        XCTAssertEqual(JobCopy.requestSource("ios"), "Nuke app")
        XCTAssertNil(try decode(JobPath.self, #"{"work_order_id":"w","vehicle_label":{"make":"UNRESOLVED"}}"#).vehicleLabel)
    }

    func testNewContextsAndSlotsReadInPlainWords() throws {
        let admin = try decode(JobViewer.self, #"{"context":"admin","slots":["admin"]}"#)
        XCTAssertEqual(admin.context, .admin)
        XCTAssertEqual(JobCopy.viewingAs(admin), "Nuke admin")
        XCTAssertEqual(JobCopy.viewingAs(JobViewer(context: .admin)), "Nuke admin")
        XCTAssertEqual(JobCopy.slot("performer"), "technician")
        XCTAssertEqual(JobCopy.slot("org_owner"), "shop owner")
        XCTAssertEqual(JobCopy.slot("vehicle_access"), "has access to this vehicle")
        let party = try decode(JobViewer.self, #"{"context":"org_member","slots":["org_owner","performer"]}"#)
        XCTAssertEqual(JobCopy.viewingAs(party), "shop owner · technician")
    }

    // MARK: Technician profile link (Sign step)

    func testActorSearchTermStripsPatternCharacters() {
        XCTAssertEqual(JobReaders.actorSearchTerm("  Fixture%_ Mechanic* "), "Fixture Mechanic")
        XCTAssertNil(JobReaders.actorSearchTerm("a"))
        XCTAssertNil(JobReaders.actorSearchTerm("%%"))
    }

    func testActorClaimInsertIsAPendingSelfClaimOnTheActor() throws {
        let row = JobReaders.ActorClaimInsert(userId: "u1", actorId: "a1")
        let json = try JSONSerialization.jsonObject(with: JSONEncoder().encode(row)) as? [String: String]
        XCTAssertEqual(json, ["user_id": "u1", "platform": "nuke_actor", "handle": "a1", "actor_id": "a1",
                              "verification_method": "self_claim"])
    }

    func testActorHitsDecodeOnlyOpenColumns() throws {
        let hits = try JSONDecoder().decode([JobReaders.ActorHit].self, from: Data(JobFixtures.actorHits.utf8))
        XCTAssertEqual(hits.map(\.name), ["Fixture Mechanic", "Fixture Mechanic Shop"])
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

    func testUnavailableWorkOrderAndSignInRequiredReadPlainly() {
        let gone = PostgrestError(code: "P0001", message: "Work order unavailable")
        let r = JobReaders.refusal(JobReaders.jobPathName, gone)
        XCTAssertEqual(r.kind, .unavailable)
        XCTAssertEqual(r.title, "Job not available")
        XCTAssertEqual(r.detail, "It doesn't exist, or it isn't shared with you.")
        let anon = PostgrestError(code: "42501", message: "Sign-in required")
        let s = JobReaders.refusal(JobReaders.workOrdersName, anon)
        XCTAssertEqual(s.kind, .signInNeeded)
        XCTAssertEqual(s.title, "Sign in to see this")
    }

    func testARefusedGrantSaysSo() {
        let denied = PostgrestError(code: "42501", message: "permission denied for function work_order_job_path_read")
        let r = JobReaders.refusal(JobReaders.jobPathName, denied, signedIn: true)
        XCTAssertEqual(r.kind, .notPermitted)
        XCTAssertEqual(JobReaders.refusal(JobReaders.jobPathName, denied, signedIn: false).kind, .signInNeeded)
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
