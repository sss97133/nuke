// ProviderStandingTests.swift — provider standing: work days as the reader states them (signed
// days kept apart, photo time never labor, open day rates never multiplied), the evidence behind a
// technician link, and the delegated-signs register shown only where it names the profile.

import XCTest
@testable import NukeCapture

final class ProviderStandingTests: XCTestCase {
    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try JobReaders.decode(T.self, from: Data(json.utf8))
    }

    // MARK: provider_productivity_read

    func testProductivityDecodesTheShippedShape() throws {
        let p = try decode(ProviderProductivity.self, ProviderStandingFixtures.productivity(isSelf: false))
        XCTAssertFalse(p.isSelf)
        XCTAssertEqual(p.subject?.text, "@fixture_tech")
        XCTAssertEqual(p.rangeFrom, "2026-07-21")
        XCTAssertEqual(p.days.count, 3)
        XCTAssertEqual(p.unreadableDays, 1)                                    // a day without its date is skipped, and counted
        XCTAssertNil(p.days[0].captureSpanMinutes)
        XCTAssertEqual(p.days[1].captureSpanMinutes, 190)
        XCTAssertEqual(p.days[2].captureSpanMinutes, 45)                       // a numeric string still reads
        XCTAssertTrue(p.days[1].customerAccepted)
        XCTAssertEqual(p.totals?.daysWithActivity, 9)
        XCTAssertEqual(p.totals?.customerAcceptedDays, 1)
        XCTAssertEqual(p.notAdopted.count, 3)
        XCTAssertEqual(p.basis["capture_span_minutes"], "span between the first and last photo of a work session; not labor time")
        XCTAssertNil(p.basis["not_adopted"])
        XCTAssertEqual(p.dayRateJobs.count, 1)                                 // a job without its id is skipped
        let job = p.dayRateJobs[0]
        XCTAssertEqual(job.terms.first?.rate, 200)
        XCTAssertEqual(job.terms.first?.quantityDays, 3)
        XCTAssertEqual(job.selfConfirmedDays, 2)
        XCTAssertEqual(job.windowUntil, "2026-10-16T16:30:23+00:00")
        XCTAssertTrue(try decode(ProviderProductivity.self, ProviderStandingFixtures.productivity(isSelf: true)).isSelf)
    }

    func testProductivityMissingBlocksReadAsNotReported() throws {
        let p = try decode(ProviderProductivity.self, "{}")
        XCTAssertNil(p.totals)
        XCTAssertTrue(p.days.isEmpty)
        XCTAssertFalse(p.isSelf)
        XCTAssertEqual(ProviderStandingCopy.ofActiveDays(nil, p), "Not reported")
        XCTAssertEqual(ProviderStandingCopy.ofActiveDays(4, p), "4")           // no denominator stated, none invented
        XCTAssertNil(ProviderStandingCopy.range(p))
    }

    func testProductivityMeasuresCarryTheirCoverage() throws {
        let visitor = try decode(ProviderProductivity.self, ProviderStandingFixtures.productivity(isSelf: false))
        XCTAssertEqual(ProviderStandingCopy.coverage(visitor), "Jul 21, 2026 – Oct 19, 2026 · public vehicles and cleared photos only")
        XCTAssertEqual(ProviderStandingCopy.ofActiveDays(visitor.totals?.selfConfirmedDays, visitor), "2 of 9 days with activity")
        XCTAssertTrue(ProviderProductivityContent.footer(visitor).contains("not hours worked"))
        XCTAssertTrue(ProviderProductivityContent.footer(visitor).contains("Visitors see public vehicles"))
        let me = try decode(ProviderProductivity.self, ProviderStandingFixtures.productivity(isSelf: true))
        XCTAssertEqual(ProviderStandingCopy.coverage(me), "Jul 21, 2026 – Oct 19, 2026 · all your activity")
        XCTAssertFalse(ProviderProductivityContent.footer(me).contains("Visitors"))
    }

    func testDaysKeepSignaturesApartAndPhotoTimeIsNotLabor() throws {
        let p = try decode(ProviderProductivity.self, ProviderStandingFixtures.productivity(isSelf: true))
        XCTAssertEqual(ProviderStandingCopy.dayActivity(p.days[0]), "1 photo")
        XCTAssertEqual(ProviderStandingCopy.dayActivity(p.days[1]),
                       "61 photos · 2 operations · 1 spec reported performed · 1 completion accepted")
        XCTAssertEqual(ProviderStandingCopy.daySigned(p.days[0], isSelf: true), "Not signed")
        XCTAssertEqual(ProviderStandingCopy.daySigned(p.days[1], isSelf: true),
                       "Confirmed by you · accepted by the customer · 3h 10m of photos")
        XCTAssertEqual(ProviderStandingCopy.daySigned(p.days[2], isSelf: false), "Confirmed by them · 45 min of photos")
        XCTAssertEqual(ProviderStandingCopy.dayStatus(p.days[0]), .recorded)
        XCTAssertEqual(ProviderStandingCopy.dayStatus(p.days[1]), .proven)
        XCTAssertEqual(ProviderStandingCopy.dayStatus(p.days[2]), .attributed)
    }

    func testDayRateIsAnOpenTermNeverATotal() throws {
        let p = try decode(ProviderProductivity.self, ProviderStandingFixtures.productivity(isSelf: true))
        let job = p.dayRateJobs[0]
        let term = ProviderStandingCopy.term(job.terms[0])
        XCTAssertEqual(term, "$200.00 a day · 3 days agreed")
        XCTAssertFalse(term.contains("600"))
        XCTAssertEqual(ProviderStandingCopy.termSource(job.terms[0].source), "from your accepted quote")
        XCTAssertEqual(ProviderStandingCopy.jobSigned(job, isSelf: true),
                       "2 days confirmed by you · 1 day accepted by the customer · in Oct 13, 2026 – Oct 16, 2026")
        let bare = try decode(ProviderProductivity.DayRateTerm.self, "{}")
        XCTAssertEqual(ProviderStandingCopy.term(bare), "Rate not stated")
    }

    func testRangeStartKeepsTheReaderDefault() {
        let today = ISO8601DateFormatter().date(from: "2026-10-19T12:00:00Z")!
        XCTAssertNil(ProviderStandingReaders.rangeStart(days: 90, today: today))
        XCTAssertEqual(ProviderStandingReaders.rangeStart(days: 30, today: today), "2026-09-19")
        XCTAssertEqual(ProviderStandingReaders.rangeStart(days: 365, today: today), "2025-10-19")
        XCTAssertNil(ProviderStandingReaders.rangeStart(days: 400, today: today))
        XCTAssertTrue(ProviderProductivityView.ranges.allSatisfy { $0 <= 366 })
    }

    // MARK: actor_link_claim_evidence_read

    func testClaimEvidenceDecodesTheShippedShape() throws {
        let e = try decode(ActorClaimEvidence.self, ProviderStandingFixtures.claimEvidence)
        XCTAssertEqual(e.claimId, ProviderStandingFixtures.claimId)
        XCTAssertEqual(e.status, "approved")
        XCTAssertEqual(e.rung, "work_evidence")
        XCTAssertEqual(e.actor?.text, "@fixture_tech")
        XCTAssertEqual(e.viewerRole, "claimant")
        XCTAssertEqual(e.items.count, 4)
        XCTAssertEqual(e.unreadableItems, 1)
        XCTAssertEqual(e.direct.map(\.kind), ["work_session", "work_session"])
        XCTAssertEqual(e.corroborating.map(\.kind), ["observation", "org_membership"])
        XCTAssertNil(e.items[3].vehicleLabel)
        XCTAssertEqual(e.counts?.byKind["observation"], 35)
        XCTAssertEqual(e.autoApproved, false)
        XCTAssertEqual(e.workEvidenceNeeds, "at least one work_session item")
        XCTAssertEqual(e.notAssessed.count, 4)
    }

    func testClaimEvidenceWords() throws {
        let e = try decode(ActorClaimEvidence.self, ProviderStandingFixtures.claimEvidence)
        XCTAssertEqual(ProviderStandingCopy.counts(e.counts), "37 items · 2 direct · 35 corroborating")
        XCTAssertEqual(ProviderStandingCopy.counts(nil), "Not counted")
        XCTAssertEqual(ProviderStandingCopy.approvable(e.items[0].approvableFor), "can support: backed by your work")
        XCTAssertEqual(ProviderStandingCopy.approvable([]), "context for the reviewer")
        XCTAssertEqual(ProviderStandingCopy.evidenceKind("org_membership"), "Shop membership")
        XCTAssertEqual(ProviderStandingCopy.strength("direct"), "Direct")
        // The server's count, not the page length, is the denominator.
        XCTAssertEqual(ProviderStandingCopy.shown(2, of: e.counts?.corroborating), "Showing 2 of 35")
        XCTAssertNil(ProviderStandingCopy.shown(2, of: 2))
        XCTAssertEqual(ProviderStandingCopy.sentence(e.items[0].why!),
                       "Your work session on the vehicle of a component event attributed to the actor, on the same day.")
    }

    func testClaimRefusalsInPlainWords() {
        let r = ProviderStandingReaders.refusal(ProviderStandingReaders.claimEvidenceName, message: "Claim unavailable")
        XCTAssertEqual(r?.kind, .unavailable)
        XCTAssertEqual(r?.title, "Evidence not available")
        XCTAssertEqual(ProviderStandingReaders.refusal("provider_productivity_read",
                                                       message: "Range must run forward and cover at most 366 days")?.title,
                       "Range not available")
        XCTAssertNil(ProviderStandingReaders.refusal("x", message: "Provider unavailable"))   // JobReaders.refusal owns it
        XCTAssertNil(ProviderStandingReaders.refusal("x", message: nil))
    }

    // MARK: owner_delegated_signs_read

    func testDelegatedSignsDecodeTheShippedShape() throws {
        let r = try decode(DelegatedSigns.self, ProviderStandingFixtures.delegatedSigns())
        XCTAssertEqual(r.signs, 5)
        XCTAssertEqual(r.rolledBack, 1)
        XCTAssertEqual(r.byRpc.map(\.rpc), ["account_link_claims_self_claim", "confirm_work_session"])   // a row without its rpc is skipped
        XCTAssertEqual(r.recent.count, 2)
        XCTAssertTrue(r.recent[0].rolledBack)
        XCTAssertEqual(r.authorizations, ["2026-10-19T16:09:00+00:00"])
        XCTAssertEqual(r.withheld.count, 4)
        XCTAssertEqual(ProviderStandingCopy.rpc("confirm_work_session"), "Confirmed a work day")
        XCTAssertEqual(ProviderStandingCopy.rpc("some_new_writer"), "Some new writer")
        XCTAssertEqual(ProviderStandingCopy.rpcLine(r.byRpc[1]), "1 rolled back · last Oct 19, 2026 16:49 UTC")
        XCTAssertEqual(ProviderStandingCopy.signs(1), "1 sign")
        XCTAssertEqual(ProviderStandingCopy.withheld(r.withheld), "Not shown: arguments, result references, agent sessions, authorization wording.")
    }

    func testDelegatedRegisterAppliesOnlyToTheOwnerItNames() throws {
        let r = try decode(DelegatedSigns.self, ProviderStandingFixtures.delegatedSigns())
        XCTAssertTrue(r.applies(toUserId: ProviderStandingFixtures.userId))
        XCTAssertTrue(r.applies(toUserId: ProviderStandingFixtures.userId.uppercased()))
        XCTAssertFalse(r.applies(toUserId: "00000000-0000-4000-8000-0000000000c2"))
        XCTAssertFalse(r.applies(toUserId: nil))
        XCTAssertTrue(ProviderStandingContent.showsDelegated(.loaded(r), userId: ProviderStandingFixtures.userId))
        XCTAssertFalse(ProviderStandingContent.showsDelegated(.loading, userId: ProviderStandingFixtures.userId))
        XCTAssertFalse(ProviderStandingContent.showsDelegated(
            .refused(JobReaders.pending(ProviderStandingReaders.delegatedSignsName)), userId: ProviderStandingFixtures.userId))
        let noOwner = try decode(DelegatedSigns.self, "{\"totals\":{\"signs\":0}}")
        XCTAssertFalse(noOwner.applies(toUserId: ProviderStandingFixtures.userId))
    }
}
