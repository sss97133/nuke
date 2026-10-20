// ClaimantsHealthLinksTests.swift — organization offers by verified claimants, Plan-B suppliers apart from performers,
// the job market health card, and nuke.ag links. Reads and parsing only; no test calls a writer.

import XCTest
@testable import NukeCapture

final class ClaimantsHealthLinksTests: XCTestCase {
    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try JobReaders.decode(T.self, from: Data(json.utf8))
    }

    // MARK: Organization offers (work_order_offers_read, S6)

    func testOrganizationOfferNamesTheBusinessWithItsBadgeAndRung() throws {
        let read = try decode(WorkOrderOffers.self, ProviderMatchFixtures.offersWithOrganization())
        let org = try XCTUnwrap(read.requirements.first?.offers.first)
        XCTAssertEqual(org.offerKind, "organization")
        XCTAssertEqual(org.who, "Fixture Body Shop")
        XCTAssertEqual(org.onNuke, "Claimed on Nuke")
        XCTAssertEqual(OfferCopy.rung(org.offerRung), "Offered by someone who claimed this business on Nuke")
        XCTAssertEqual(OfferCopy.yourRung("verified_claimant"), "You claimed this business on Nuke")
    }

    func testIndividualOffersCarryNoBusinessBadge() throws {
        let read = try decode(WorkOrderOffers.self, ProviderMatchFixtures.offersWithOrganization())
        let tech = try XCTUnwrap(read.requirements.first?.offers.first { $0.offerId == ProviderMatchFixtures.offerTech })
        XCTAssertEqual(tech.who, "@fixture_tech")
        XCTAssertNil(tech.onNuke)
    }

    func testOlderOrganizationOfferStillNamesItsFacility() throws {
        let json = """
        {"offer_id":"o1","offer_kind":"organization","offer_rung":"organization_owner",
         "provider":{"kind":"user","handle":"owner_person"},"facility":{"kind":"organization","organization_id":"f1","name":"Old Garage"}}
        """
        let offer = try decode(JobOffer.self, json)
        XCTAssertEqual(offer.who, "Old Garage")
        XCTAssertNil(offer.onNuke)
    }

    // MARK: Provider matches (work_order_provider_matches_read, S6/K3)

    func testPlanBSuppliersComeApartFromRankedPerformers() throws {
        let read = try decode(ProviderMatches.self, ProviderMatchFixtures.withClaimants)
        XCTAssertEqual(read.providers.count, 3)
        XCTAssertEqual(read.planBSuppliers.count, 1)
        let group = try XCTUnwrap(read.planBSuppliers.first)
        XCTAssertEqual(group.title, "\(OfferCopy.kind("skill")): Paint touch-up on the driver door")
        XCTAssertEqual(group.suppliers.map(\.name), ["Fixture Paint Supply", "Fixture Body Shop"])
        XCTAssertEqual(group.suppliers.map(\.times), [3, 1])
        XCTAssertEqual(group.suppliers.map { $0.onNuke?.claimed }, [false, true])
        let performerNames = Set(read.providers.map(\.name))
        XCTAssertTrue(performerNames.isDisjoint(with: group.suppliers.compactMap(\.name)), "a supplier is never ranked as a performer")
    }

    func testVerifiedClaimantPerformerOffersAsTheirBusiness() throws {
        let read = try decode(ProviderMatches.self, ProviderMatchFixtures.withClaimants)
        let tech = try XCTUnwrap(read.providers.first { $0.provider?.handle == "fixture_tech" })
        XCTAssertEqual(tech.offersAs.map(\.name), ["Fixture Body Shop"])
        XCTAssertEqual(tech.offersAs.first?.onNuke, "Claimed on Nuke")
        XCTAssertEqual(ProviderMatchCopy.offersAs(tech.offersAs[0]), "Offers as Fixture Body Shop")
        XCTAssertEqual(ProviderMatchCopy.listedBecause(tech.listedBecause), "Listed as technician link backed by work, claimed a business on Nuke")
    }

    func testSupplyCorroborationIsLabelledAndNeverChangesTheSkillResult() throws {
        let read = try decode(ProviderMatches.self, ProviderMatchFixtures.withClaimants)
        let tech = try XCTUnwrap(read.providers.first { $0.provider?.handle == "fixture_tech" })
        XCTAssertEqual(tech.suppliedBy, ["Fixture Body Shop"])
        XCTAssertTrue(ProviderMatchCopy.suppliedBy(tech.suppliedBy).contains("not evidence they can do the work"))
        let plain = try decode(ProviderMatches.self, ProviderMatchFixtures.populated)
        let before = try XCTUnwrap(plain.providers.first { $0.provider?.handle == "fixture_tech" })
        XCTAssertEqual(tech.passed, before.passed)
        XCTAssertEqual(tech.requirements.map { $0.input("skill")?.result }, before.requirements.map { $0.input("skill")?.result })
        XCTAssertTrue(before.suppliedBy.isEmpty)
    }

    func testReadsWithoutPlanBListNone() throws {
        XCTAssertTrue(try decode(ProviderMatches.self, ProviderMatchFixtures.populated).planBSuppliers.isEmpty)
        XCTAssertTrue(try decode(ProviderMatches.self, ProviderMatchFixtures.liveEmpty).planBSuppliers.isEmpty)
    }

    // MARK: Market health (job_market_health_read)

    func testMarketHealthReadsTheLiveShape() throws {
        let m = try decode(MarketHealth.self, MarketHealthFixtures.read(days: 3))
        XCTAssertEqual(m.openRequests, 39)
        XCTAssertEqual(m.jobsOpen, 4)
        XCTAssertEqual(m.openedThisWeek, 4)
        XCTAssertEqual(m.technicians, 1)
        XCTAssertEqual(m.businessesClaimed, 0)
        XCTAssertEqual(m.businessesWithPurchases, 23)
        XCTAssertEqual(m.withBackupSupplier, 23)
        XCTAssertEqual(m.withTechnicianWhoFits, 0)
        XCTAssertEqual(m.flowTotal, 0)
        XCTAssertEqual(m.history.map(\.date), ["2026-10-17", "2026-10-18", "2026-10-19"])
    }

    func testMarketHealthWordsMatchTheWebPage() throws {
        let m = try decode(MarketHealth.self, MarketHealthFixtures.read(days: 3))
        XCTAssertEqual(MarketHealthCopy.demand(m), "39 open requests · 4 jobs open to technicians · 4 jobs opened this week")
        XCTAssertEqual(MarketHealthCopy.supply(m), "1 technician linked by evidence · 0 businesses claimed yet · 23 businesses with purchase records")
        XCTAssertEqual(MarketHealthCopy.matching(m), "23 requests have a backup supplier · 0 requests have a technician who fits")
        XCTAssertEqual(MarketHealthCopy.flow(m), MarketHealthCopy.flowEmpty)
        XCTAssertEqual(MarketHealthCopy.history(m), "Trends over 3 days.")
        let moving = try decode(MarketHealth.self, MarketHealthFixtures.read(days: 3, offers: 2))
        XCTAssertEqual(MarketHealthCopy.flow(moving), "2 offers made")
    }

    func testSparklinesNeedTwoDaysOfHistory() throws {
        let three = try decode(MarketHealth.self, MarketHealthFixtures.read(days: 3))
        XCTAssertEqual(three.trend("open_requirements"), [31, 35, 39])
        XCTAssertEqual(three.trend("with_plan_b_supplier"), [18, 21, 23])
        XCTAssertNil(three.trend("no_such_key"))
        let first = try decode(MarketHealth.self, MarketHealthFixtures.read(days: 1))
        XCTAssertNil(first.trend("open_requirements"))
        XCTAssertEqual(MarketHealthCopy.history(first)?.hasPrefix("Daily history starts"), true)
        XCTAssertEqual(MarketHealthCopy.history(first)?.hasSuffix("trend lines appear after the second day."), true)
        let none = try decode(MarketHealth.self, MarketHealthFixtures.read(days: 0))
        XCTAssertNil(MarketHealthCopy.history(none))
    }

    func testMarketHealthRefusesSomethingElse() {
        XCTAssertThrowsError(try decode(MarketHealth.self, #"{"error":"nope"}"#))
    }

    // MARK: nuke.ag links

    private let job = "00000000-0000-4000-8000-0000000000A1"
    private let org = "00000000-0000-4000-8000-0000000000F1"

    func testJobProviderAndOrgLinksOpenNativeScreens() throws {
        XCTAssertEqual(AppLink.parse(URL(string: "https://nuke.ag/jobs/\(job)")!), .job(job.lowercased()))
        XCTAssertEqual(AppLink.parse(URL(string: "https://www.nuke.ag/jobs/\(job)?from=share")!), .job(job.lowercased()))
        XCTAssertEqual(AppLink.parse(URL(string: "https://nuke.ag/providers/fixture_tech")!), .provider("fixture_tech"))
        XCTAssertEqual(AppLink.parse(URL(string: "https://nuke.ag/org/\(org)")!), .org(org.lowercased()))
        XCTAssertEqual(AppLink.parse(URL(string: "https://nuke.ag/org/\(org)/vehicles")!), .org(org.lowercased()))
    }

    func testSupplierInviteOpensTheWebRedemptionPage() throws {
        let invite = try decode(SupplierInvite.self, ParityFixtures.invite)
        let url = try XCTUnwrap(invite.url)
        XCTAssertEqual(url.absoluteString, "https://nuke.ag/supplier-invite/\(ParityFixtures.inviteToken)")
        XCTAssertEqual(AppLink.parse(url), .web(url))
    }

    func testUnknownNukePathsFallBackToTheWebPage() {
        for s in ["https://nuke.ag/jobs/not-a-uuid", "https://nuke.ag/org/new", "https://nuke.ag/", "https://nuke.ag/work/market"] {
            let url = URL(string: s)!
            XCTAssertEqual(AppLink.parse(url), .web(url), s)
        }
    }

    func testOtherURLsAreNotAppLinks() {
        for s in ["http://nuke.ag/jobs/\(job)", "https://example.com/jobs/\(job)", "ag.nuke.capture://login-callback?code=x",
                  "https://nuke.ag.evil.com/jobs/\(job)"] {
            XCTAssertNil(AppLink.parse(URL(string: s)!), s)
        }
    }
}
