// ToolboxTests.swift — the toolbox as user_toolbox_read states it: nulls read as not reported,
// paid amounts reach the owner only, list value keeps its basis, unmatched records are only
// counted, and the reader's refusal reads as "Toolbox not shared" for any viewer.

import XCTest
import Supabase
@testable import NukeCapture

final class ToolboxTests: XCTestCase {
    private func decode(_ json: String) throws -> Toolbox {
        try JobReaders.decode(Toolbox.self, from: Data(json.utf8))
    }

    // MARK: Decoding

    func testOwnerDecodesTheMigrationShape() throws {
        let t = try decode(ToolboxFixtures.read(owner: true))
        XCTAssertTrue(t.isOwner)
        XCTAssertEqual(t.userId, ToolboxFixtures.userId)
        XCTAssertEqual(t.items.count, 3)
        XCTAssertEqual(t.unreadableItems, 1)                                   // an item without its id is skipped, and counted
        let a = t.items[0], b = t.items[1], c = t.items[2]
        XCTAssertEqual(a.partNumber, "FX-100")
        XCTAssertEqual(a.quantity, 2)
        XCTAssertEqual(a.listPrice?.amount, 120)
        XCTAssertEqual(a.listPrice?.currency, "USD")
        XCTAssertEqual(a.listValue, 240)
        XCTAssertEqual(a.packShot?.imageUrl, "https://fixture.imgix.net/FX100.jpg")
        XCTAssertEqual(a.paid?.total, 199.5)
        XCTAssertEqual(a.paid?.receipts, 2)
        XCTAssertEqual(a.paid?.firstPurchase, "2026-03-01")
        XCTAssertNil(b.listPrice)                                              // null list price stays absent, not zero
        XCTAssertNil(b.listValue)
        XCTAssertNotNil(b.paid)
        XCTAssertNil(b.paid?.total)
        XCTAssertNil(c.packShot)
        XCTAssertNil(c.quantity)
        XCTAssertNil(c.category)
        XCTAssertEqual(c.listPrice?.amount, 35.5)                              // a numeric string still reads
        XCTAssertNil(c.listPrice?.capturedAt)
        XCTAssertEqual(t.totals.listValue, 240)
        XCTAssertEqual(t.totals.listValueCurrency, "USD")
        XCTAssertEqual(t.totals.paid, 199.5)
        XCTAssertEqual(t.coverage?.toolRecords, 6)
        XCTAssertEqual(t.coverage?.unmatchedRecords, 2)
        XCTAssertEqual(t.coverage?.withListPrice, 2)
        XCTAssertEqual(t.basis["pack_shot"], "maker's catalog photo of the product")
    }

    func testVisitorNeverCarriesPaidEvenIfTheBodyDoes() throws {
        for leak in [false, true] {
            let t = try decode(ToolboxFixtures.read(owner: false, leakPaid: leak))
            XCTAssertFalse(t.isOwner)
            XCTAssertEqual(t.items.count, 3)
            XCTAssertTrue(t.items.allSatisfy { $0.paid == nil })
            XCTAssertNil(t.totals.paid)
            XCTAssertNil(ToolboxCopy.paidTotal(t))                            // the header's "You paid" block does not render
            XCTAssertEqual(t.items[0].listValue, 240)                          // the list value is still shown
        }
    }

    func testMissingBlocksReadAsNotReported() throws {
        let t = try decode("{}")
        XCTAssertFalse(t.isOwner)
        XCTAssertTrue(t.items.isEmpty)
        XCTAssertNil(t.coverage)
        XCTAssertNil(t.totals.listValue)
        XCTAssertEqual(ToolboxCopy.listValueTotal(t), "No list prices captured yet")
        XCTAssertEqual(ToolboxCopy.coverageLines(t), ["Coverage not reported."])
    }

    // MARK: Totals and labels

    func testListValueKeepsItsBasisAndCoverage() throws {
        let t = try decode(ToolboxFixtures.read(owner: true))
        XCTAssertEqual(ToolboxCopy.listValueTotal(t), "$240.00")
        XCTAssertEqual(ToolboxCopy.listValueDecay(t), "maker list price × quantity — not resale value · 2 of 4 tools priced")
        let mixed = try decode(ToolboxFixtures.read(owner: true, currency: nil))
        XCTAssertEqual(ToolboxCopy.listValueTotal(mixed), "Not totalled (more than one currency)")
    }

    func testPaidIsSeparateAndCarriesNoInventedCurrency() throws {
        let t = try decode(ToolboxFixtures.read(owner: true))
        XCTAssertEqual(ToolboxCopy.paidTotal(t), "199.50")
        XCTAssertFalse(ToolboxCopy.paidTotal(t)!.contains("$"))
        XCTAssertTrue(ToolboxCopy.paidDecay.contains("currency not recorded"))
        XCTAssertEqual(ToolboxCopy.paidTotal(try decode(ToolboxFixtures.empty)), "No paid amounts on your receipts")
    }

    func testCardWords() throws {
        let t = try decode(ToolboxFixtures.read(owner: true))
        XCTAssertEqual(ToolboxCopy.cardValue(t.items[0]), "$240.00")
        XCTAssertEqual(ToolboxCopy.cardValue(t.items[1]), "No list price")
        XCTAssertEqual(ToolboxCopy.cardValue(t.items[2]), "Qty not recorded")  // priced, but no quantity to multiply
        XCTAssertEqual(ToolboxCopy.quantity(2), "×2")
        XCTAssertEqual(ToolboxCopy.partLine(t.items[0]), "Fixture Tools · FX-100")
        XCTAssertEqual(ToolboxCopy.nameBasis(t.items[0], owner: true).status, .attributed)
        XCTAssertEqual(ToolboxCopy.nameBasis(t.items[1], owner: true).words, "as written on your receipt")
        XCTAssertEqual(ToolboxCopy.nameBasis(t.items[1], owner: false).words, "as written on their receipt")
        XCTAssertEqual(ToolboxCopy.captured(t.items[0].listPrice!), "maker's list price, captured Oct 19, 2026")
        XCTAssertEqual(ToolboxCopy.captured(t.items[2].listPrice!), "maker's list price, capture date not stated")
        XCTAssertEqual(ToolboxCopy.matchBasis("same_brand_exact_part_number"), "Same brand, exact part number")
    }

    func testMakerPageOpensOnlyOverHttps() throws {
        let t = try decode(ToolboxFixtures.read(owner: true))
        let url = try XCTUnwrap(ToolboxCopy.makerPage(t.items[0].listPrice))
        XCTAssertEqual(url.absoluteString, "https://shop.fixture.example/fx-100")
        XCTAssertEqual(ToolboxCopy.makerPageLabel(url), "Open on shop.fixture.example")
        XCTAssertNil(ToolboxCopy.makerPage(t.items[2].listPrice))
        XCTAssertNil(ToolboxCopy.makerPage(nil))
    }

    func testPackShotIsSizedOnImgix() {
        XCTAssertEqual(ToolboxCopy.packShotURL("https://fixture.imgix.net/FX100.jpg", width: 400)?.absoluteString,
                       "https://fixture.imgix.net/FX100.jpg?w=400&fit=max&auto=format")
        XCTAssertEqual(ToolboxCopy.packShotURL("https://fixture.imgix.net/FX100.jpg?w=90", width: 400)?.absoluteString,
                       "https://fixture.imgix.net/FX100.jpg?w=90")
        XCTAssertEqual(ToolboxCopy.packShotURL("https://cdn.fixture.example/a.jpg", width: 400)?.absoluteString,
                       "https://cdn.fixture.example/a.jpg")
        XCTAssertNil(ToolboxCopy.packShotURL(nil, width: 400))
    }

    func testUnmatchedRecordsAreCountedNeverDescribed() throws {
        let lines = ToolboxCopy.coverageLines(try decode(ToolboxFixtures.read(owner: true)))
        XCTAssertEqual(lines, [
            "6 tool records",
            "4 matched to the maker's catalog",
            "2 with a pack shot",
            "2 with a list price",
            "2 records without a catalog match, counted and not shown",
            "1 unreadable, not shown",
        ])
    }

    // MARK: Sort and filter

    func testSortUsesReturnedFieldsOnly() throws {
        let items = try decode(ToolboxFixtures.read(owner: true)).items
        XCTAssertEqual(ToolboxCopy.sorted(items, by: .value).map(\.partNumber), ["FX-100", "FX-020", "FX-300"])
        XCTAssertEqual(ToolboxCopy.sorted(items, by: .name).map(\.partNumber), ["FX-020", "FX-100", "FX-300"])
        XCTAssertEqual(ToolboxCopy.sorted(items, by: .category).map(\.partNumber), ["FX-020", "FX-100", "FX-300"])
    }

    func testCategoryFilter() throws {
        let t = try decode(ToolboxFixtures.read(owner: true))
        XCTAssertEqual(t.categories, ["Pliers", "Wrenches", ToolboxCopy.noCategory])
        XCTAssertEqual(ToolboxCopy.filtered(t.items, category: "Wrenches").map(\.partNumber), ["FX-100"])
        XCTAssertEqual(ToolboxCopy.filtered(t.items, category: ToolboxCopy.noCategory).map(\.partNumber), ["FX-300"])
        XCTAssertEqual(ToolboxCopy.filtered(t.items, category: nil).count, 3)
    }

    // MARK: Refusal

    func testNotSharedReadsAsNotSharedForAnyViewer() {
        let err = PostgrestError(code: "42501", message: "Toolbox not shared")
        for signedIn in [true, false] {
            let r = ToolboxReaders.refusal(err, signedIn: signedIn)
            XCTAssertEqual(r.kind, .unavailable)
            XCTAssertEqual(r.title, "Toolbox not shared")
            XCTAssertEqual(r.reader, "user_toolbox_read")
        }
        XCTAssertEqual(ToolboxReaders.refusal(PostgrestError(code: "PGRST202", message: "Could not find the function"), signedIn: true).kind,
                       .readerPending)
        XCTAssertEqual(ToolboxReaders.refusal(PostgrestError(code: "42501", message: "permission denied"), signedIn: true).kind,
                       .notPermitted)
    }
}
