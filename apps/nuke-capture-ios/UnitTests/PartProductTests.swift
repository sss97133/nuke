// PartProductTests.swift — a job part as a product page (work_order_part_read) and its row in the job's list.
//
// A line status reads as the record's mark, not a sign-off. Recorded prices are shown as recorded, never
// multiplied out. A catalog listing is labelled with its source and clock and never stands in for the part
// installed. Offers open only http(s) links. A part names no operation the reader did not link.

import XCTest
import Supabase
@testable import NukeCapture

final class PartProductTests: XCTestCase {
    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try JobReaders.decode(T.self, from: Data(json.utf8))
    }

    func testInstalledPartForAVisitorShowsItsSellerPageAsTheProductNotTheInstalledPart() throws {
        let p = try decode(WorkOrderPartProduct.self, JobFixtures.partInstalledVisitor)
        XCTAssertFalse(p.party)
        XCTAssertEqual(PartProductCopy.title(p.part), "Bilstein 5100 Front Shock Absorber")     // brand already in the name
        XCTAssertEqual(p.part?.part_number, "BSN-24-187077")
        XCTAssertEqual(PartProductCopy.status(p.line?.status), "Installed")
        XCTAssertEqual(PartProductCopy.statusBasis, "the part line's recorded status, not a sign-off")
        let price = PartProductCopy.price(p.price, quantity: p.part?.quantity)
        XCTAssertEqual(price.value, "$229.73")                                                   // the recorded total, not 2 × $105.99
        XCTAssertEqual(price.detail, "2 × $105.99 each, as recorded")
        let purpose = PartProductCopy.purpose(p.operation)
        XCTAssertEqual(purpose.values, ["Install Bilstein 5100 shocks — all 4 corners + replace passenger window motor"])
        XCTAssertEqual(purpose.decay, "labor line with the same job code (SUSP-SHCK-001)")
        XCTAssertEqual(p.vehicleLabel, "1983 GMC K2500 Sierra Classic")
        XCTAssertNil(p.supplier?.label)
        XCTAssertEqual(PartProductCopy.safeURL(p.supplier?.buy_url)?.host, "www.summitracing.com")
        XCTAssertEqual(p.supplier?.buy_url_host, "summitracing.com")
        XCTAssertEqual(PartProductCopy.hero(p).url, "https://static.summitracing.com/global/images/prod/xlarge/bsn-24-187077_xl.jpg")
        XCTAssertEqual(PartProductCopy.hero(p).caption, "Seller's product photo · summitracing.com · not the installed part")
        let link = try XCTUnwrap(p.productLink)
        XCTAssertEqual(link.product_name, "Bilstein B8 5100 Series Shocks")
        XCTAssertEqual(PartProductCopy.matchBasis(link.match_basis), "found from the job's own buy link")
        XCTAssertEqual(PartProductCopy.productDecay(link), "summitracing.com · captured Oct 19, 2026 20:59 UTC")
        XCTAssertEqual(PartProductCopy.safeURL(link.page_url), PartProductCopy.safeURL(p.supplier?.buy_url))   // one link, shown once
        XCTAssertEqual(PartProductCopy.catalogGap(p.catalog), "Same listing as the product page above.")
        XCTAssertTrue(p.offers.isEmpty)
        XCTAssertEqual(PartProductCopy.photos(p.evidence),
                       "Photos are filed to a job's operations, and this part isn't linked to one, so none is shown here. No photos are filed to this job yet.")
        XCTAssertEqual(PartProductCopy.coverage(p), "0 retailer offers · product page linked · 1 catalog listing · as of Oct 19, 2026 21:02 UTC")
    }

    func testCatalogListingIsLabelledWithItsSourceAndOffersCompareAsRecorded() throws {
        let p = try decode(WorkOrderPartProduct.self, JobFixtures.partCatalogMatchedParty)
        XCTAssertTrue(p.party)
        XCTAssertEqual(PartProductCopy.title(p.part), "Holley Carburetor gasket")
        XCTAssertEqual(PartProductCopy.status(p.line?.status), "Quoted")
        let price = PartProductCopy.price(p.price, quantity: p.part?.quantity)
        XCTAssertEqual(price.value, "$4.50 each")
        XCTAssertNil(price.detail)
        XCTAssertEqual(PartProductCopy.hero(p).url, "https://img.example.invalid/108-2.jpg")
        XCTAssertEqual(PartProductCopy.hero(p).caption, "Catalog photo · Fixture Catalog · not the installed part")
        XCTAssertNil(p.productLink)
        XCTAssertNil(PartProductCopy.catalogGap(p.catalog))
        let m = try XCTUnwrap(p.catalog?.match)
        XCTAssertEqual(PartProductCopy.catalogDecay(m), "as listed by Fixture Catalog · updated May 1, 2026 00:00 UTC")
        XCTAssertEqual(PartProductCopy.fits(m), "Fixture Coupe · 1967–1972")
        XCTAssertEqual(PartProductCopy.purpose(p.operation).values, ["Not linked to an operation"])
        XCTAssertEqual(p.supplier?.label, "Fixture Supply")
        XCTAssertEqual(p.line?.notes, "Fixture note")

        XCTAssertEqual(p.offers.map(\.id), ["00000000-0000-4000-8000-0000000000a7", "00000000-0000-4000-8000-0000000000a8"])
        XCTAssertEqual(p.offers.map { PartProductCopy.retailer($0.retailer, host: $0.url_host) }, ["RockAuto", "AutoZone"])
        XCTAssertEqual(p.offers.map { PartProductCopy.money($0.price) }, ["$3.99", "$6.00"])
        XCTAssertEqual(PartProductCopy.offerDetail(p.offers[0]), "new · In stock · Holley 108-2 · recorded Feb 4, 2026")
        XCTAssertEqual(PartProductCopy.offerDetail(p.offers[1]), "reman · Out of stock · Holley 108-2 · recorded Feb 4, 2026")
        XCTAssertNotNil(PartProductCopy.safeURL(p.offers[0].url))
        XCTAssertNil(PartProductCopy.safeURL(p.offers[1].url))
        XCTAssertEqual(p.offers[1].store_location, "Fixture store")
        XCTAssertEqual(PartProductCopy.photos(p.evidence),
                       "Photos are filed to a job's operations, and this part isn't linked to one, so none is shown here. 2 filings on this job, under Evidence.")
        XCTAssertEqual(PartProductCopy.coverage(p), "2 retailer offers (1 with a link) · no product page linked · 1 catalog listing · as of Oct 19, 2026 21:05 UTC")
    }

    func testOnlyHttpLinksOpenAndUnmatchedCatalogsSayWhy() {
        XCTAssertNil(PartProductCopy.safeURL("javascript:alert(1)"))
        XCTAssertNil(PartProductCopy.safeURL("ftp://files.example.invalid/x"))
        XCTAssertNil(PartProductCopy.safeURL("https://"))
        XCTAssertNotNil(PartProductCopy.safeURL("http://shop.example.invalid/p"))
        func gap(_ s: String) -> String? {
            PartProductCopy.catalogGap(WorkOrderPartProduct.Catalog(state: s, match_basis: nil, match: nil))
        }
        XCTAssertEqual(gap("not_matched_brand_disagrees"), "A catalog lists this part number under a different maker, so it isn't matched.")
        XCTAssertEqual(gap("no_part_number"), "No part number is recorded on this line, so no catalog listing is matched.")
        XCTAssertEqual(gap("withheld_with_brand"), "Not matched: the brand on this line is withheld from you.")
        XCTAssertEqual(gap("matched"), "The catalog listing could not be read.")
        XCTAssertEqual(PartProductCopy.stock(nil), "Stock not recorded")
        XCTAssertEqual(PartProductCopy.retailer("fixture_mart", host: nil), "Fixture_mart")
        XCTAssertEqual(PartProductCopy.retailer(nil, host: "shop.example.invalid"), "shop.example.invalid")
    }

    func testJobPartRowsCarryTheProductCardAndListInstalledFirst() throws {
        let o = try decode(WorkOrderOperations.self, JobFixtures.operationsWithParts)
        XCTAssertEqual(o.parts.count, 3)
        XCTAssertEqual(PartProductCopy.ordered(o.parts).map(\.id), [JobFixtures.partId, JobFixtures.partId3, JobFixtures.partId2])
        XCTAssertEqual(PartProductCopy.partsLine(o.parts), "3 parts on record · 1 installed · 1 quoted")
        let clip = o.parts[0], shock = o.parts[1], withheld = o.parts[2]
        XCTAssertEqual(PartProductCopy.title(clip), "Clip")
        XCTAssertEqual(PartProductCopy.rowDetail(clip), "qty 10 · $0.50 each")
        XCTAssertEqual(PartProductCopy.rowDetail(shock), "PN BSN-24-187077 · qty 2 · $229.73")
        XCTAssertEqual(PartProductCopy.title(withheld), "Part (name withheld: it named a person)")
        XCTAssertEqual(PartProductCopy.rowDetail(withheld), "PN 108-2 · comped")
        XCTAssertNil(clip.product)
        XCTAssertEqual(shock.product?.image_url, "https://static.summitracing.com/global/images/prod/xlarge/bsn-24-187077_xl.jpg")
        XCTAssertEqual(shock.product?.match_basis, "job_buy_url_page")
        XCTAssertEqual(withheld.product?.manufacturer, "Holley")
        XCTAssertEqual(PartProductCopy.status(withheld.status), "Not used")
    }

    func testPartUnavailableRefusalReadsInPlainWords() {
        let r = JobReaders.refusal(PartProductReaders.name, PostgrestError(code: "42501", message: "Part unavailable"), signedIn: false)
        XCTAssertEqual(r.kind, .unavailable)
        XCTAssertEqual(r.title, "Part not available")
    }
}
