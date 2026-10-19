// ProviderMatchTests.swift — "Choose who does it": the matches reader, standing, filters, offers and words.
// Reads only; no test calls accept_offer or any writer.

import XCTest
@testable import NukeCapture

final class ProviderMatchTests: XCTestCase {
    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try JobReaders.decode(T.self, from: Data(json.utf8))
    }

    private func populated() throws -> ProviderMatches { try decode(ProviderMatches.self, ProviderMatchFixtures.populated) }

    func testLiveEnvelopeWithoutRequestsSaysWhyNobodyIsListed() throws {
        let read = try decode(ProviderMatches.self, ProviderMatchFixtures.liveEmpty)
        XCTAssertTrue(read.providers.isEmpty)
        XCTAssertEqual(read.requirements, 0)
        XCTAssertEqual(read.providersConsidered, 1)
        XCTAssertEqual(read.displayTitle, "Fixture job")
        XCTAssertEqual(read.jobPlace, "Fixture City, NV")
        XCTAssertEqual(read.jobWindow?.basis, "not_stated")
        XCTAssertEqual(read.viewer?.slots, ["customer", "vehicle_access"])
        XCTAssertEqual(ProviderMatchCopy.empty(read),
                       "This job lists no requests yet, so nobody was matched. Matches are worked out per request; 1 provider account on Nuke would be considered.")
        XCTAssertTrue(ProviderMatchCopy.coverage(read).hasPrefix("0 of 1 provider accounts considered · 0 requests"))
        XCTAssertEqual(ProviderMatchCopy.mapCoverage(read), "0 of 0 providers shown state a service area")
        XCTAssertEqual(ProviderMatchFilter.available(read).count, 6)
    }

    func testEmptyPopulationIsStatedAsSuch() throws {
        let json = ProviderMatchFixtures.liveEmpty
            .replacingOccurrences(of: #""requirements":0"#, with: #""requirements":2"#)
            .replacingOccurrences(of: #""providers_considered":1"#, with: #""providers_considered":0"#)
        let read = try decode(ProviderMatches.self, json)
        XCTAssertTrue(ProviderMatchCopy.empty(read)?.hasPrefix("No provider accounts on Nuke qualify to be considered yet") == true)
    }

    func testProvidersKeepReaderOrderBandsAndClaims() throws {
        let read = try populated()
        XCTAssertEqual(read.providers.map(\.name), ["@fixture_tech", "Unnamed party", "@Fixture_Shop"])
        XCTAssertEqual(read.providers.map(\.rank), [1, 2, 2])
        XCTAssertEqual(read.unreadableProviders, 1)
        XCTAssertEqual(read.providers.map(\.id), [ProviderMatchFixtures.techProfile, "row-1", ProviderMatchFixtures.shopProfile])

        let tech = read.providers[0]
        XCTAssertEqual(tech.serviceArea, ServiceAreaBand(city: "Fixture City", stateCode: "NV", radiusMiles: 25, mobile: false))
        XCTAssertEqual(tech.firstAvailableDay, "2026-10-21")
        XCTAssertEqual(tech.evidencedSkills, ["paint_touch_up"])
        XCTAssertEqual(tech.skillCautions, ["paint_touch_up"])
        XCTAssertTrue(tech.passesEverywhere("area"))
        XCTAssertEqual(ProviderMatchCopy.tally(tech), "12 of 12 checks pass · 0 not yet · 0 unknown")
        XCTAssertEqual(ProviderMatchCopy.listedBecause(tech.listedBecause), "Listed as technician link backed by work")
        XCTAssertEqual(ProviderMatchCopy.link(tech.linkState).text, "Backed by their work")

        let unnamed = read.providers[1]
        XCTAssertNil(unnamed.serviceArea)
        XCTAssertNil(unnamed.profileId)
        XCTAssertEqual(unnamed.statedSkills, ["paint_touch_up"])
        XCTAssertTrue(unnamed.evidencedSkills.isEmpty)
        XCTAssertEqual(ProviderMatchCopy.link(unnamed.linkState).text, "Linked by them — not yet backed by work")

        let shop = read.providers[2]
        XCTAssertEqual(ProviderMatchCopy.band(try XCTUnwrap(shop.serviceArea)), "Mobile · travels within 40 mi of Elsewhere, AZ")
        XCTAssertEqual(ProviderMatchCopy.band(try XCTUnwrap(tech.serviceArea)), "Within 25 mi of Fixture City, NV")
        XCTAssertEqual(ProviderMatchCopy.listedBecause(shop.listedBecause), "Listed as shop owner, shop member")
        XCTAssertEqual(ProviderMatchCopy.link(shop.linkState).text, "No technician link")

        XCTAssertEqual(read.withServiceArea, 2)
        XCTAssertTrue(read.anyMobile)
        XCTAssertEqual(ProviderMatchCopy.mapCoverage(read), "2 of 3 providers shown state a service area")
        XCTAssertNil(ProviderMatchCopy.empty(read))
    }

    func testInputsReadInTheThirdPerson() throws {
        let read = try populated()
        func words(_ p: ProviderMatch) -> [String] {
            p.requirements[0].inputs.map { "\(OfferCopy.input($0.input)) — \(ProviderMatchCopy.reason($0))" }
        }
        XCTAssertEqual(words(read.providers[0]), [
            "Skill — Their work shows paint touch up (with some evidence against)",
            "Tools — Not needed for this",
            "Shop space — Not needed for this",
            "Area — The job is within their 25-mile service area",
            "Availability — They say they're free from Oct 21, 2026",
            "Technician profile — Technician link backed by their work",
        ])
        XCTAssertEqual(words(read.providers[1]), [
            "Skill — They say they do paint touch up — not shown in their work yet",
            "Tools — Not needed for this",
            "Shop space — Not needed for this",
            "Area — They haven't stated an area",
            "Availability — They haven't stated availability",
            "Technician profile — Linked by them — not yet backed by work",
        ])
        XCTAssertEqual(words(read.providers[2]), [
            "Skill — No technician link backed by work yet",
            "Tools — Not needed for this",
            "Shop space — Not needed for this",
            "Area — The job is outside their 40-mile service area",
            "Availability — Their stated hours don't cover the job window",
            "Technician profile — No technician link",
        ])
        let tech = read.providers[0].requirements[0]
        XCTAssertEqual(tech.inputs.filter(ProviderMatchCopy.isSelfClaim).map(\.input), ["area", "availability"])
        XCTAssertEqual(tech.title, "Skill: Paint touch-up on the driver door")
    }

    func testFiltersOnlyOverReaderFields() throws {
        let read = try populated()
        let filters = ProviderMatchFilter.available(read)
        XCTAssertEqual(filters.map(\.title), ["Skill", "Tools", "Shop space", "Area", "Availability", "Technician profile", "Mobile"])
        XCTAssertEqual(ProviderMatchFilter.apply([.passes("area")], to: read.providers).map(\.name), ["@fixture_tech"])
        XCTAssertEqual(ProviderMatchFilter.apply([.mobile], to: read.providers).map(\.name), ["@Fixture_Shop"])
        XCTAssertEqual(ProviderMatchFilter.apply([.passes("tools")], to: read.providers).count, 3)
        XCTAssertTrue(ProviderMatchFilter.apply([.passes("area"), .mobile], to: read.providers).isEmpty)
        XCTAssertEqual(ProviderMatchFilter.apply([], to: read.providers).count, 3)
    }

    func testOffersAttachToTheirProviderAndKeepTheServersAccept() throws {
        let read = try populated()
        let offers = try decode(WorkOrderOffers.self, ProviderMatchFixtures.offers())
        let mine = ProviderMatchOffers.offers(for: read.providers[0], in: offers)
        XCTAssertEqual(mine.map(\.offer.offerId), [ProviderMatchFixtures.offerTech])
        XCTAssertEqual(mine.first?.request.requirementId, ProviderMatchFixtures.reqSkill)
        XCTAssertTrue(ProviderMatchOffers.offers(for: read.providers[1], in: offers).isEmpty)
        XCTAssertEqual(ProviderMatchOffers.unmatched(read.providers, in: offers).map(\.offer.offerId), [ProviderMatchFixtures.offerUnnamed])

        let offer = try XCTUnwrap(mine.first?.offer)
        let accept = try XCTUnwrap(offers.acceptAction(for: offer))
        XCTAssertEqual(OfferDrafting.acceptArguments(accept, offer: offer)?.hash, ProviderMatchFixtures.hashTech)
        XCTAssertTrue(ProviderMatchOffers.same(JobPerson(handle: "Fixture_Tech"), JobPerson(handle: "fixture_tech")))
        XCTAssertFalse(ProviderMatchOffers.same(JobPerson(label: "unnamed party"), JobPerson(label: "unnamed party")))
    }

    func testEntryShowsOnlyToCustomerOrShopOwnerUntilAccepted() throws {
        XCTAssertTrue(ProviderMatchesGate.shows(try decode(WorkOrderOffers.self, ProviderMatchFixtures.offers())))
        XCTAssertTrue(ProviderMatchesGate.shows(try decode(WorkOrderOffers.self, ProviderMatchFixtures.offers(slots: #"["org_owner"]"#))))
        XCTAssertFalse(ProviderMatchesGate.shows(try decode(WorkOrderOffers.self, ProviderMatchFixtures.offers(accepted: true))))
        XCTAssertFalse(ProviderMatchesGate.shows(try decode(WorkOrderOffers.self, ProviderMatchFixtures.offers(slots: #"["offering_provider"]"#))))
        XCTAssertFalse(ProviderMatchesGate.shows(try decode(WorkOrderOffers.self, ProviderMatchFixtures.offers(slots: "[]"))))
    }

    func testStandingFromTheProfileReader() throws {
        let face = try decode(ProviderMatchFace.self, ProviderMatchFixtures.techFace)
        XCTAssertTrue(face.serviceAreaDeclared)
        XCTAssertEqual(face.serviceArea, ServiceAreaBand(city: "Fixture City", stateCode: "NV", radiusMiles: 25, mobile: false))
        XCTAssertEqual(face.publicPlace, "Fixture City, NV")
        XCTAssertEqual(face.jobs, 2)
        XCTAssertEqual(face.signedWorkDays, 3)
        XCTAssertEqual(face.vouches, 0)
        XCTAssertEqual(face.evidencedSkills, ["paint_touch_up", "welding_tig"])
        XCTAssertEqual(face.shops.map(\.name), ["Fixture Garage"])
        let availability = try XCTUnwrap(face.availability)
        XCTAssertEqual(ProviderMatchCopy.weekly(availability), "Mon, Tue 08:00–17:00 · Sat 09:00–12:00 (America/Los_Angeles)")
        XCTAssertEqual(ProviderMatchCopy.availability(availability),
                       "Mon, Tue 08:00–17:00 · Sat 09:00–12:00 (America/Los_Angeles) · 1 upcoming day off")

        let bare = try decode(ProviderMatchFace.self, ProviderMatchFixtures.bareFace)
        XCTAssertFalse(bare.serviceAreaDeclared)
        XCTAssertNil(bare.serviceArea)
        XCTAssertEqual(ProviderMatchCopy.availability(bare.availability), "Hasn't stated availability")
        XCTAssertNil(bare.vouches)
        XCTAssertNil(bare.signedWorkDays)
        XCTAssertEqual(bare.jobs, 0)
        XCTAssertEqual(ProviderMatchCopy.availability(nil), "Not reported")
    }

    func testOwnMatchWordsCoverServiceAreaAndAvailability() {
        func say(_ input: String, _ result: String, _ reason: String) -> String {
            OfferCopy.reason(MatchInput(input: input, result: result, reason: reason, next: nil))
        }
        XCTAssertEqual(say("area", "pass", "job city is within your 25-mile service area (city-level; self-claimed band)"), "Within your 25-mile service area")
        XCTAssertEqual(say("area", "fail", "job city is outside your 40-mile service area (city-level; self-claimed band)"), "Outside your 40-mile service area")
        XCTAssertEqual(say("area", "pass", "same state as your service area (distance not computed)"), "Same state as your service area (distance not worked out)")
        XCTAssertEqual(say("area", "pass", "same state and city"), "Same city")
        XCTAssertEqual(say("area", "pass", "same state"), "Same state")
        XCTAssertEqual(say("availability", "pass", "standing availability (self-claimed) falls inside the job window"), "Your hours fall inside the job window")
        XCTAssertEqual(say("availability", "fail", "no declared availability inside the job window"), "Your hours don't cover the job window")
        XCTAssertEqual(say("availability", "unknown", "no standing availability is recorded yet"), "You haven't set availability yet")
    }
}
