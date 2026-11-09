import XCTest
@testable import NukeCapture

@MainActor
final class ReceiptEvidenceTests: XCTestCase {
    let receipt = UUID(uuidString: "00000000-0000-4000-8000-00000000a001")!
    let vehicle = UUID(uuidString: "00000000-0000-4000-8000-00000000c001")!
    let linkId = UUID(uuidString: "00000000-0000-4000-8000-00000000b001")!
    func link(date: String? = "2026-03-09", vehicle: UUID? = nil, retired: String? = nil) -> ReceiptEvidenceLink {
        .init(id: linkId, receipt_id: receipt, vehicle_id: vehicle ?? self.vehicle,
              status: "linked", retired_at: retired, page_date: date)
    }
    func day(tied: Bool = true, date: String = "2026-03-09", id: UUID? = nil) -> ReceiptEvidenceDay {
        .init(date: date, tied: tied, documents: [.init(receipt_id: id ?? receipt,
            document_id: nil, date: date, date_source: "transaction_date", date_basis: nil,
            document_kind: "parts_service", link_basis: "cited_document", currency: nil,
            lines: [.init(line_number: 1, description: "Corrected part", part_number: "P-1", quantity: .number(0),
                          unit_price: nil, amount: .number(0), hours: nil, performer: nil, line_date: nil)])])
    }
    func reads(day: ReceiptEvidenceDay? = nil) -> ReceiptEvidenceReaders.Reads {
        let row = link(), payload = day ?? self.day()
        return .init(links: { _ in [row] }, day: { _, _ in payload })
    }
    func refused(_ result: JobLoad<ReceiptEvidence>, file: StaticString = #filePath, line: UInt = #line) {
        guard case .refused = result else { return XCTFail("Expected refusal", file: file, line: line) }
    }
    func testSyntheticAuditAndSourceUseTheProductionDecoderContracts() throws {
        let proof = try JSONDecoder().decode(InvestmentProof.self, from: Data(ReceiptDepthFixtures.proof.utf8))
        XCTAssertEqual(proof.audit?.receipts?.first?.id, receipt)
        XCTAssertEqual(proof.proven.parts.value, 35)
        let payload = try JSONDecoder().decode(ReceiptEvidenceDay.self, from: Data(ReceiptDepthFixtures.day.utf8))
        XCTAssertTrue(payload.tied)
        XCTAssertEqual(payload.documents.first?.receipt_id, receipt)
        XCTAssertEqual(payload.documents.first?.lines.count, 2)
    }
    func testExactCurrentMembershipUsesCanonicalCorrectedLinesPreservesZeroAndUnknownCurrency() async {
        var requests: [String] = []
        let row = link(), payload = day()
        let readers = ReceiptEvidenceReaders.Reads(links: { id in
            XCTAssertEqual(id, self.receipt); requests.append("link"); return [row]
        }, day: { vehicle, date in
            XCTAssertEqual(vehicle, self.vehicle); XCTAssertEqual(date, "2026-03-09")
            requests.append("day"); return payload
        })
        let result = await ReceiptEvidenceReaders.load(receipt: receipt, vehicle: vehicle, reads: readers, account: { "viewer" })
        guard case .loaded(let evidence) = result else { return XCTFail("Expected canonical receipt") }
        XCTAssertEqual(requests, ["link", "day", "link"])
        XCTAssertEqual(evidence.document.lines.first?.description, "Corrected part")
        XCTAssertEqual(evidence.document.lines.first?.amount, .number(0))
        XCTAssertNil(evidence.document.currency)
        XCTAssertNil(evidence.document.lines.first?.performer)
    }
    func testUnknownOrMalformedDateNeverGuessesOrCallsSourceReader() async {
        for date in [nil, "", "2026-02-30", "2026-3-9", "2026-03-09T00:00:00Z"] as [String?] {
            let row = link(date: date)
            let readers = ReceiptEvidenceReaders.Reads(links: { _ in [row] }, day: { _, _ in
                XCTFail("Unknown date must stop before source read"); return self.day()
            })
            refused(await ReceiptEvidenceReaders.load(receipt: receipt, vehicle: vehicle, reads: readers, account: { "viewer" }))
        }
    }
    func testMissingWrongVehicleRetiredAndAmbiguousLinksNeverReadDetails() async {
        let cases: [[ReceiptEvidenceLink]] = [[], [link(vehicle: UUID())], [link(retired: "2026-03-10")], [link(), link()]]
        for rows in cases {
            let readers = ReceiptEvidenceReaders.Reads(links: { _ in rows }, day: { _, _ in
                XCTFail("Ineligible link must stop before source read"); return self.day()
            })
            refused(await ReceiptEvidenceReaders.load(receipt: receipt, vehicle: vehicle, reads: readers, account: { "viewer" }))
        }
    }
    func testMaskedPayloadCannotPublishEvenWithPlantedAmounts() async {
        refused(await ReceiptEvidenceReaders.load(receipt: receipt, vehicle: vehicle,
            reads: reads(day: day(tied: false)), account: { nil }))
    }
    func testMissingOrDuplicateExactReceiptCannotBorrowOtherDocument() async {
        for payload in [day(id: UUID()), ReceiptEvidenceDay(date: "2026-03-09", tied: true, documents: []),
                        ReceiptEvidenceDay(date: "2026-03-09", tied: true, documents: day().documents + day().documents)] {
            refused(await ReceiptEvidenceReaders.load(receipt: receipt, vehicle: vehicle, reads: reads(day: payload), account: { "viewer" }))
        }
    }
    func testChangedDateCannotBorrowNeighboringDay() async {
        refused(await ReceiptEvidenceReaders.load(receipt: receipt, vehicle: vehicle,
            reads: reads(day: day(date: "2026-03-10")), account: { "viewer" }))
    }
    func testWithdrawalDuringReadDiscardsPreviouslyReturnedItems() async {
        var calls = 0
        let row = link(), payload = day()
        let readers = ReceiptEvidenceReaders.Reads(links: { _ in calls += 1; return calls == 1 ? [row] : [] }, day: { _, _ in payload })
        refused(await ReceiptEvidenceReaders.load(receipt: receipt, vehicle: vehicle, reads: readers, account: { "viewer" }))
        XCTAssertEqual(calls, 2)
    }
    func testAccountSwitchDuringReadDiscardsPriorAccountPayload() async {
        var account: String? = "first"
        let row = link(), payload = day()
        let readers = ReceiptEvidenceReaders.Reads(links: { _ in [row] }, day: { _, _ in account = "second"; return payload })
        refused(await ReceiptEvidenceReaders.load(receipt: receipt, vehicle: vehicle, reads: readers, account: { account }))
    }
    func testEmptyCurrentLinesStayEmptyAndNetworkErrorStaysFailure() async {
        let empty = ReceiptEvidenceDay(date: "2026-03-09", tied: true, documents: [.init(receipt_id: receipt,
            document_id: nil, date: "2026-03-09", date_source: nil, date_basis: nil, document_kind: nil,
            link_basis: nil, currency: nil, lines: [])])
        let result = await ReceiptEvidenceReaders.load(receipt: receipt, vehicle: vehicle, reads: reads(day: empty), account: { "viewer" })
        guard case .loaded(let evidence) = result else { return XCTFail("Empty is distinct from refused") }
        XCTAssertTrue(evidence.document.lines.isEmpty)
        let readers = ReceiptEvidenceReaders.Reads(links: { _ in throw URLError(.notConnectedToInternet) }, day: { _, _ in self.day() })
        let failed = await ReceiptEvidenceReaders.load(receipt: receipt, vehicle: vehicle, reads: readers, account: { "viewer" })
        guard case .refused(let refusal) = failed else { return XCTFail("Expected failure") }
        XCTAssertNotEqual(refusal.kind, .unavailable)
    }
}
