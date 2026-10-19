// JobHistoryTests.swift — testimony from retained messages, the operations checklist and filed evidence.
//
// Testimony reads as reports quoted from messages on the attributed rung, never as a Sign, an
// acceptance, a completion or a payment. Operations carry their source as their rung. Evidence
// names an operation only in the operations reader's (redacted) words for a visitor.

import XCTest
@testable import NukeCapture

final class JobHistoryTests: XCTestCase {
    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try JobReaders.decode(T.self, from: Data(json.utf8))
    }

    // MARK: Testimony

    func testHistoricalJobPathCarriesTestimonyOnTermsExecutionAndCompletion() throws {
        let p = try decode(JobPath.self, JobFixtures.historicalJobPath)
        let terms = try XCTUnwrap(JobTestimony(stage: try XCTUnwrap(p.stages[.terms])))
        XCTAssertEqual(terms.claims, 3)
        XCTAssertEqual(terms.bySide, ["client": 3])
        XCTAssertEqual(terms.byStage, ["terms_accepted": 3])
        XCTAssertEqual(terms.operations, 2)
        let completion = try XCTUnwrap(JobTestimony(stage: try XCTUnwrap(p.stages[.completion])))
        XCTAssertEqual(completion.byStage, ["operation_completed": 3])
        XCTAssertEqual(completion.operations, 3)
        XCTAssertEqual(JobTestimony(stage: try XCTUnwrap(p.stages[.execution]))?.byStage, ["work_paused": 1])
        XCTAssertNil(JobTestimony(stage: try XCTUnwrap(p.stages[.accounting])))
        // Testimony never moves a stage: completion stays absent with its Sign gap.
        XCTAssertEqual(p.stages[.completion]?.state, .absent)
        XCTAssertTrue(p.stages[.completion]?.gaps.contains("no_provider_completion_attestation") == true)
    }

    func testTestimonyIsWordedAsReportsNotSigns() throws {
        let p = try decode(JobPath.self, JobFixtures.historicalJobPath)
        let terms = try XCTUnwrap(JobTestimony(stage: try XCTUnwrap(p.stages[.terms])))
        let completion = try XCTUnwrap(JobTestimony(stage: try XCTUnwrap(p.stages[.completion])))
        let execution = try XCTUnwrap(JobTestimony(stage: try XCTUnwrap(p.stages[.execution])))
        XCTAssertEqual(JobTestimonyCopy.lines(terms), ["3 messages from the customer say they agreed to the price or scope"])
        XCTAssertEqual(JobTestimonyCopy.lines(completion), ["3 messages from the shop say work was finished · 3 operations named"])
        XCTAssertEqual(JobTestimonyCopy.lines(execution), ["1 message from the shop says work was paused"])
        XCTAssertEqual(JobTestimonyCopy.decay(terms), "quoted reports, not Signs · not verified · latest Feb 24, 2026")
        XCTAssertEqual(JobTestimonyCopy.label, "In retained messages")

        let payment = JobTestimony(claims: 2, bySide: ["client": 2], byStage: ["payment_reported": 1, "invoice_issued": 1])
        let all = [terms, completion, execution, payment].flatMap(JobTestimonyCopy.lines)
        XCTAssertTrue(all.contains("1 message from the shop says an invoice was sent"))
        XCTAssertTrue(all.contains("1 message from the customer says a payment was made"))
        for line in all {
            XCTAssertTrue(line.contains(" say ") || line.contains(" says "), line)
            for word in ["Signed", "signed", "Accepted", "Approved", "approved", "Completed", "Marked done", "Paid", "Verified", "confirmed"] {
                XCTAssertFalse(line.contains(word), "\(line) contains \(word)")
            }
        }
        XCTAssertTrue(JobTestimonyCopy.decay(payment).hasPrefix("quoted reports, not Signs · not verified"))
    }

    func testSilentTestimonyRendersNoRow() throws {
        let t = try XCTUnwrap(JobTestimony(try decode(JobJSON.self, JobFixtures.silentTestimony)))
        XCTAssertEqual(t.claims, 0)
        XCTAssertTrue(JobTestimonyCopy.lines(t).isEmpty)
        XCTAssertNil(t.latestMessageAt)
    }

    func testStageFactsLeaveTestimonyAndEvidenceToTheirOwnRows() throws {
        let p = try decode(JobPath.self, JobFixtures.historicalJobPath)
        for key in [JobStageKey.terms, .execution, .completion] {
            let shown = JobPathContent.visibleFacts(try XCTUnwrap(p.stages[key]).facts).map(\.key)
            XCTAssertFalse(shown.contains("retained_testimony"), "\(key)")
            XCTAssertFalse(shown.contains("attached_evidence"), "\(key)")
        }
        XCTAssertTrue(JobPathContent.visibleFacts(try XCTUnwrap(p.stages[.execution]).facts).map(\.key).contains("operations_complete_status"))
    }

    // MARK: Operations checklist

    func testOperationsReadFromTheWorkOrderTextAreAttributedQuotes() throws {
        let o = try decode(WorkOrderOperations.self, JobFixtures.operationsFromScopeText)
        XCTAssertEqual(o.operations.count, 3)
        XCTAssertFalse(o.party)
        XCTAssertEqual(o.asOf, "2026-10-19T19:02:12.000000+00:00")
        let first = o.operations[0]
        XCTAssertEqual(first.requestedByBasis, "source_without_sign")
        XCTAssertEqual(first.descriptionBasis, "description")
        XCTAssertEqual(OperationsChecklist.rung(first), .attributed)
        XCTAssertEqual(OperationsChecklist.status(first.status), "Not marked done")
        XCTAssertEqual(OperationsChecklist.detail(first), "quoted from the work order's text")
        XCTAssertEqual(OperationsCopy.title(o.operations[2]), "6. U-joint inspection")
        XCTAssertEqual(OperationsChecklist.doneLine(o.operations), "0 of 3")
        XCTAssertEqual(OperationsChecklist.coverage(o),
                       "3 operations on record · 3 quoted from the work order's text · as of Oct 19, 2026 19:02 UTC")
    }

    func testUnsourcedCompleteRowsAreRecordedMarksNotCompletions() throws {
        let o = try decode(WorkOrderOperations.self, JobFixtures.operationsUnsourcedComplete)
        let op = o.operations[0]
        XCTAssertEqual(OperationsChecklist.rung(op), .recorded)
        XCTAssertEqual(OperationsChecklist.status(op.status), "Marked done")
        XCTAssertEqual(OperationsChecklist.detail(op), "on the record, source not established")
        XCTAssertEqual(OperationsChecklist.doneLine(o.operations), "2 of 2")
        XCTAssertEqual(OperationsChecklist.coverage(o), "2 operations on record · 2 without a stated source · as of Oct 19, 2026 19:02 UTC")
        XCTAssertEqual(o.parts.first?.status, "installed")
        XCTAssertEqual(o.labor.first?.status, "complete")
        XCTAssertEqual(OperationsChecklist.status("active"), "Active")
    }

    func testSignedOperationIsProvenWithItsNeedsAndSpecifications() throws {
        let op = try decode(WorkOrderOperations.Operation.self, JobFixtures.operationSigned)
        XCTAssertEqual(OperationsChecklist.rung(op), .proven)
        XCTAssertEqual(op.specifications, 2)
        XCTAssertEqual(OperationsChecklist.status(op.status), "In progress")
        XCTAssertEqual(OperationsChecklist.detail(op),
                       "asked for by the customer, signed through Nuke · needs: \(OfferCopy.kind("skill").lowercased()) · 2 specifications")
    }

    func testChangedSourceIsStatedWithoutNamingAnOperation() {
        XCTAssertNil(OperationsChecklist.sourceChanged(JobStage(state: .partial)))
        XCTAssertNil(OperationsChecklist.sourceChanged(nil))
        let plan = JobStage(state: .partial, gaps: ["operations_only_in_labor_rows"], inconsistencies: ["operation_source_withdrawn"])
        XCTAssertEqual(OperationsChecklist.sourceChanged(plan),
                       "A source behind this list was withdrawn or changed. Which operation isn't stated yet.")
        XCTAssertEqual(JobCopy.conflict("operation_source_withdrawn"), "An operation's source was withdrawn")
        XCTAssertEqual(JobCopy.conflict("operation_excerpt_missing_from_scope"), "An operation's quoted words are no longer in the job's text")
        XCTAssertEqual(JobCopy.gap("operations_only_in_labor_rows"), "The work is listed only as labor lines")
    }

    // MARK: Evidence

    func testEmptyEvidenceStatesItsCoverage() throws {
        let e = try decode(WorkOrderEvidence.self, JobFixtures.evidenceEmpty)
        XCTAssertTrue(e.attachments.isEmpty)
        XCTAssertFalse(e.party)
        XCTAssertEqual(JobEvidenceCopy.coverage(e), "0 filings · 0 photos shown · as of Oct 19, 2026 19:02 UTC")
    }

    func testVisitorEvidenceNamesOperationsOnlyThroughTheOperationsReader() throws {
        let e = try decode(WorkOrderEvidence.self, JobFixtures.evidenceForVisitor)
        let ops = try decode(WorkOrderOperations.self, JobFixtures.operationsFromScopeText)
        XCTAssertEqual(e.attachments.count, 2)
        let shop = e.attachments[0], customer = e.attachments[1]
        XCTAssertEqual(JobEvidenceCopy.filer(shop), "@fixture_shop · technician")
        XCTAssertEqual(shop.attachedBy?.profileId, "00000000-0000-4000-8000-0000000000b1")
        XCTAssertEqual(JobEvidenceCopy.filer(customer), "Unnamed party · customer")
        XCTAssertEqual(JobEvidenceCopy.operation(shop, operations: ops, party: false), "2. Oil pan gasket replacement")
        XCTAssertEqual(JobEvidenceCopy.operation(customer, operations: ops, party: false), "Operation 9")
        XCTAssertEqual(JobEvidenceCopy.operation(customer, operations: nil, party: true), "9. Text the reader returned")
        XCTAssertEqual(JobEvidenceCopy.decay(shop), "signed through Nuke · filed Oct 18, 2026")
        XCTAssertEqual(JobEvidenceCopy.photos(shop), "2 photos · 1 not shown to you")
        XCTAssertEqual(JobEvidenceCopy.photos(customer), "0 photos")
        XCTAssertEqual(e.imagesShown, 2)
        XCTAssertEqual(e.imagesWithheld, 1)
        XCTAssertEqual(JobEvidenceCopy.coverage(e),
                       "2 filings · 2 photos shown · 1 not shown to you under the photos' privacy rules · as of Oct 19, 2026 19:30 UTC")
        XCTAssertNil(shop.note)
    }
}
