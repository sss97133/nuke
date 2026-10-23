import XCTest
@testable import NukeCapture

final class LabelCardParsingTests: XCTestCase {
    func testHandwrittenBoxCardReadsBoxVehicleAndYear() throws {
        let card = try XCTUnwrap(LabelCardParser.parse("Box 3, R3500\nreceipts 2017"))
        XCTAssertEqual(card.box, "3")
        XCTAssertEqual(card.vehicleHint, "R3500")
        XCTAssertEqual(card.yearHint, 2017)
        XCTAssertFalse(card.explicit)
        XCTAssertGreaterThan(card.confidence, 0.8)
        XCTAssertLessThanOrEqual(card.confidence, 0.9)
    }
    func testBoxCueAloneIsALabel() {
        XCTAssertEqual(LabelCardParser.parse("BOX 12")?.box, "12")
    }
    func testShortYearOnlyStubIsNotALabel() {
        XCTAssertNil(LabelCardParser.parse("Thank you 2018"))
    }
    func testLongReceiptMentioningABoxIsNotALabel() {
        let receipt = """
        NAPA AUTO PARTS #2231  03/14/2018
        1 BOX 6 SPARK PLUGS AC DELCO 41-993   23.88
        1 OIL FILTER PF52   6.49
        SUBTOTAL 30.37 TAX 2.51 TOTAL 32.88
        THANK YOU FOR YOUR BUSINESS
        """
        XCTAssertNil(LabelCardParser.parse(receipt))
    }
    func testExplicitToggleAlwaysMakesACard() throws {
        let card = try XCTUnwrap(LabelCardParser.parse("blazer stuff", explicit: true))
        XCTAssertTrue(card.explicit)
        XCTAssertEqual(card.vehicleHint, "blazer")
        XCTAssertEqual(card.confidence, 0.95)
    }
    func testMakeNameCountsAsVehicleCue() throws {
        let card = try XCTUnwrap(LabelCardParser.parse("K5 Blazer titles 2019"))
        XCTAssertEqual(card.vehicleHint, "K5")
        XCTAssertEqual(card.yearHint, 2019)
        XCTAssertNil(card.box)
    }
}

final class BatchApplicationTests: XCTestCase {
    private var seq = 0
    private func doc(_ texts: [String], explicit: Bool = false) -> [PaperworkPage] {
        let docId = UUID().uuidString
        return texts.enumerated().map { i, t in
            seq += 1
            return PaperworkPage(id: UUID().uuidString, documentId: docId, pageIndex: i, pageCount: texts.count,
                                 scannedAt: Date(timeIntervalSince1970: 1_800_000_000), sequence: seq,
                                 explicitLabel: explicit, ocrDone: true, ocrText: t)
        }
    }
    func testBatchAppliesToFollowingDocumentsUntilNextCard() {
        var tracker = BatchTracker()
        let label1 = PaperworkRules.classify(document: doc(["Box 3, R3500 receipts 2017"]), tracker: &tracker)
        XCTAssertTrue(label1[0].isLabelCard)
        let receipt = PaperworkRules.classify(document: doc([String(repeating: "Invoice line item ", count: 10), "page two"]), tracker: &tracker)
        XCTAssertEqual(receipt.map { $0.batch?.labelPageId }, [label1[0].id, label1[0].id])
        XCTAssertEqual(receipt[0].batch?.box, "3")
        XCTAssertFalse(receipt[0].isLabelCard)
        XCTAssertEqual(tracker.documentsInBatch, 1)

        let label2 = PaperworkRules.classify(document: doc(["Box 4 K5 2018"]), tracker: &tracker)
        let next = PaperworkRules.classify(document: doc([String(repeating: "work order ", count: 12)]), tracker: &tracker)
        XCTAssertEqual(next[0].batch?.labelPageId, label2[0].id)
        XCTAssertEqual(next[0].batch?.box, "4")
        XCTAssertEqual(tracker.documentsInBatch, 1)
    }
    func testNoCardMeansNoBatch() {
        var tracker = BatchTracker()
        let d = PaperworkRules.classify(document: doc([String(repeating: "receipt ", count: 20)]), tracker: &tracker)
        XCTAssertNil(d[0].batch)
    }
    func testMultiPageScanIsNotAutoDetectedAsLabelButToggleWins() {
        var tracker = BatchTracker()
        XCTAssertFalse(PaperworkRules.classify(document: doc(["Box 9", "more"]), tracker: &tracker)[0].isLabelCard)
        XCTAssertTrue(PaperworkRules.classify(document: doc(["Box 9", "more"], explicit: true), tracker: &tracker)[0].isLabelCard)
    }
    func testClosedBatchStopsApplying() {
        var tracker = BatchTracker()
        _ = PaperworkRules.classify(document: doc(["Box 1"]), tracker: &tracker)
        tracker.close()
        XCTAssertNil(PaperworkRules.classify(document: doc([String(repeating: "x y z ", count: 30)]), tracker: &tracker)[0].batch)
    }
    func testTrackerSurvivesRoundTrip() throws {
        var tracker = BatchTracker()
        _ = PaperworkRules.classify(document: doc(["Box 2 C10 2017"]), tracker: &tracker)
        let decoded = try JSONDecoder().decode(BatchTracker.self, from: JSONEncoder().encode(tracker))
        XCTAssertEqual(decoded, tracker)
    }
}

final class DocumentDateExtractionTests: XCTestCase {
    func testNumericUSDate() {
        XCTAssertEqual(DocumentDateExtractor.extract(from: "NAPA 03/14/2018 total 32.88")?.date, "2018-03-14")
    }
    func testTwoDigitYear() {
        XCTAssertEqual(DocumentDateExtractor.extract(from: "WO 1182 6-2-17")?.date, "2017-06-02")
    }
    func testWrittenMonth() {
        XCTAssertEqual(DocumentDateExtractor.extract(from: "Issued September 5th, 2019 by DMV")?.date, "2019-09-05")
    }
    func testISODate() {
        XCTAssertEqual(DocumentDateExtractor.extract(from: "printed 2017-11-30")?.date, "2017-11-30")
    }
    func testLabelledDateBeatsEarlierDate() throws {
        let hint = try XCTUnwrap(DocumentDateExtractor.extract(from: "Part# 01/02/1999 warranty\nInvoice Date: 04/22/2018"))
        XCTAssertEqual(hint.date, "2018-04-22")
        XCTAssertGreaterThan(hint.confidence, 0.6)
    }
    func testImpossibleDatesAndNoDate() {
        XCTAssertNil(DocumentDateExtractor.extract(from: "02/31/2018"))
        XCTAssertNil(DocumentDateExtractor.extract(from: "13/01/2018"))
        XCTAssertNil(DocumentDateExtractor.extract(from: "Qty 3 @ 12.50"))
    }
}

final class PaperworkPayloadTests: XCTestCase {
    func testPayloadCarriesScanTimeDateHintAndSoftCitedBatch() throws {
        let batch = PaperworkBatch(labelPageId: "label-page", labelDocumentId: "label-doc", box: "3", vehicleHint: "R3500",
                                   yearHint: 2017, confidence: 0.9, labelText: "Box 3, R3500 receipts 2017",
                                   openedAt: Date(timeIntervalSince1970: 0))
        let page = PaperworkPage(id: "p1", documentId: "d1", pageIndex: 1, pageCount: 2,
                                 scannedAt: Date(timeIntervalSince1970: 1_792_000_000), sequence: 7, explicitLabel: false,
                                 ocrDone: true, ocrText: "Invoice Date 03/14/2018", isLabelCard: false,
                                 dateHint: DocumentDateHint(date: "2018-03-14", matchedText: "03/14/2018", confidence: 0.8), batch: batch)
        let payload = PaperworkPagePayload.make(page: page, imageData: Data([0xFF, 0xD8, 0xFF]))
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(payload)) as? [String: Any])
        XCTAssertEqual(json["is_document"] as? Bool, true)
        XCTAssertEqual(json["client_page_id"] as? String, "p1")
        XCTAssertEqual(json["document_id"] as? String, "d1")
        XCTAssertEqual(json["page_index"] as? Int, 1)
        XCTAssertEqual(json["page_count"] as? Int, 2)
        XCTAssertEqual(json["scanned_at"] as? String, "2026-10-14T17:46:40.000Z")
        XCTAssertEqual(json["document_date_hint"] as? String, "2018-03-14")
        XCTAssertEqual(json["content_type"] as? String, "image/jpeg")
        XCTAssertEqual(json["image_base64"] as? String, "/9j/")
        XCTAssertEqual(json["ocr_engine"] as? String, "apple_vision_accurate")
        let b = try XCTUnwrap(json["batch"] as? [String: Any])
        XCTAssertEqual(b["label_page_id"] as? String, "label-page")
        XCTAssertEqual(b["strength"] as? String, "soft")
        XCTAssertEqual(b["source"] as? String, "label_card")
        XCTAssertEqual(b["confidence"] as? Double, 0.9)
        // Nothing in the payload names a vehicle id or a capture set: the batch is evidence, not assignment.
        XCTAssertNil(json["vehicle_id"]); XCTAssertNil(json["capture_set_id"])
    }
    func testLabelCardPageCarriesNoBatchEvidenceOfItself() {
        var page = PaperworkPage(id: "l", documentId: "d", pageIndex: 0, pageCount: 1, scannedAt: Date(), sequence: 1, explicitLabel: false)
        page.isLabelCard = true
        page.batch = PaperworkBatch(labelPageId: "l", labelDocumentId: "d", box: "1", vehicleHint: nil, yearHint: nil,
                                    confidence: 0.6, labelText: "Box 1", openedAt: Date())
        let payload = PaperworkPagePayload.make(page: page, imageData: Data())
        XCTAssertTrue(payload.is_label_card)
        XCTAssertNil(payload.batch)
    }
}
