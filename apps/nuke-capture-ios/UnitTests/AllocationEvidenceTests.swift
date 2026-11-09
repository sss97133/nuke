import XCTest
@testable import NukeCapture

@MainActor
final class AllocationEvidenceTests: XCTestCase {
    let vehicle = UUID(uuidString: "00000000-0000-4000-8000-00000000c001")!
    func row(_ changes: [String: Any] = [:]) throws -> AllocationRecord {
        var value = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(AllocationEvidenceFixtures.row.utf8)) as? [String: Any])
        value.merge(changes) { _, new in new }
        return try JSONDecoder().decode(AllocationRecord.self, from: JSONSerialization.data(withJSONObject: value))
    }
    func source(_ changes: [String: Any] = [:], currency: String? = "EUR") throws -> AllocationSourceDocument {
        var value = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(AllocationEvidenceFixtures.source(bank: true, currency: currency).utf8)) as? [String: Any])
        value.merge(changes) { _, new in new }
        return try JSONDecoder().decode(AllocationSourceDocument.self, from: JSONSerialization.data(withJSONObject: value))
    }
    func refused<T>(_ result: JobLoad<T>, file: StaticString = #filePath, line: UInt = #line) {
        guard case .refused = result else { return XCTFail("Expected withheld result", file: file, line: line) }
    }
    func testExactAllocationBankSourceAndRecheckPreserveSeparateUnitsAndClocks() async throws {
        let row = try row(), source = try source(); var calls: [String] = []
        let reads = AllocationReaders.Reads(exact: { vehicle, key in
            XCTAssertEqual(vehicle, self.vehicle); XCTAssertEqual(key, row.id); calls.append("allocation"); return [row]
        }, source: { reference in
            XCTAssertEqual(reference.owner, row.book_owner_id)
            XCTAssertEqual(reference.document, row.bank_document_id)
            XCTAssertEqual(reference.key, row.bank_source_key)
            calls.append("bank source"); return source
        })
        let result = await AllocationReaders.loadSource(vehicle: vehicle, row: row, kind: .bank, reads: reads, account: { "account" })
        guard case .loaded(let loaded) = result else { return XCTFail("Expected exact current source") }
        XCTAssertEqual(calls, ["allocation", "bank source", "allocation"])
        XCTAssertEqual(AllocationWords.amount(row.allocated_amount, currency: row.currency), "9007199254740993.000001 USD")
        XCTAssertEqual(AllocationWords.amount(loaded.document.record.amount, currency: loaded.document.record.currency), "42.123456 EUR")
        XCTAssertEqual(row.assigned_at, "2026-03-12T15:42:00Z")
        XCTAssertEqual(loaded.document.revised_at, "2026-03-14T10:00:00Z")
        XCTAssertEqual(row.record_date, "2026-03-09")
        XCTAssertEqual(loaded.document.record.date, "2026-03-10")
    }
    func testMissingDuplicateWrongBookAndWrongIndexNeverReachSource() async throws {
        let row = try row()
        for rows in [[], [row, row], [try self.row(["book_owner_id": UUID().uuidString])], [try self.row(["allocation_index": 2])]] {
            let reads = AllocationReaders.Reads(exact: { _, _ in rows }, source: { _ in XCTFail("Source must not be guessed"); return nil })
            refused(await AllocationReaders.loadSource(vehicle: vehicle, row: row, kind: .book, reads: reads, account: { "a" }))
        }
    }
    func testWithdrawalAndChangedVectorAfterSourceReadAreDiscarded() async throws {
        let row = try row(), source = try source()
        for after in [[], [try self.row(["allocated_amount": "0"])], [try self.row(["bank_source_key": String(repeating: "c", count: 64)])]] {
            var calls = 0
            let reads = AllocationReaders.Reads(exact: { _, _ in calls += 1; return calls == 1 ? [row] : after }, source: { _ in source })
            refused(await AllocationReaders.loadSource(vehicle: vehicle, row: row, kind: .bank, reads: reads, account: { "a" }))
        }
    }
    func testMissingOrWrongSourceNeverSubstitutesNearbyOrLegacyEvidence() async throws {
        let row = try row()
        for source in [nil, try source(["document_id": UUID().uuidString]), try source(["source_key": String(repeating: "c", count: 64)]), try source(["reader": "legacy"])] {
            let reads = AllocationReaders.Reads(exact: { _, _ in [row] }, source: { _ in source })
            refused(await AllocationReaders.loadSource(vehicle: vehicle, row: row, kind: .bank, reads: reads, account: { "a" }))
        }
    }
    func testAccountSwitchAtEveryAwaitBoundaryDiscardsPayload() async throws {
        let row = try row(), source = try source()
        for boundary in 1...3 {
            var account: String? = "a"; var calls = 0
            func step() { calls += 1; if calls == boundary { account = "b" } }
            let reads = AllocationReaders.Reads(exact: { _, _ in step(); return [row] }, source: { _ in step(); return source })
            refused(await AllocationReaders.loadSource(vehicle: vehicle, row: row, kind: .bank, reads: reads, account: { account }))
            XCTAssertEqual(calls, boundary)
        }
    }
    func testUnknownCurrencyZeroExactDecimalsAndDatesNeverBecomeCashOrGuessedClocks() throws {
        XCTAssertEqual(AllocationWords.amount("0", currency: "USD"), "0 USD")
        XCTAssertEqual(AllocationWords.amount(nil, currency: "USD"), "Amount not recorded or unreadable")
        XCTAssertEqual(AllocationWords.amount("42.123456", currency: nil), "Monetary reading withheld · source currency unknown")
        XCTAssertEqual(AllocationWords.amount("42.123456", currency: "usd"), "Monetary reading withheld · source currency unknown")
        XCTAssertEqual(AllocationWords.amount("NaN", currency: "USD"), "Amount not recorded or unreadable")
        XCTAssertEqual(AllocationWords.day("2026-02-30"), "Date not recorded or unreadable")
        XCTAssertEqual(AllocationWords.day("2026-03-10"), "2026-03-10")
        let revised = try source(currency: nil)
        XCTAssertNil(revised.record.currency)
        XCTAssertFalse(AllocationWords.amount(revised.record.amount, currency: revised.record.currency).contains("USD"))
    }
    func testSameUseAndIndexInAnotherBookIsDistinctAndReadyIsNotPaymentProof() throws {
        let a = try row(["qualification": "ready"]), b = try row(["book_owner_id": UUID().uuidString, "phase": "customer_refund", "currency": "EUR"])
        XCTAssertNotEqual(a.id, b.id)
        XCTAssertEqual(b.phaseText, "Customer refund")
        XCTAssertTrue(a.qualificationText.contains("not payment proof"))
        XCTAssertEqual(a.witnesses?.first?.kind, "receipt")
        XCTAssertNil(a.witnesses?.last?.id)
    }
    func testPaginationUsesRawOffsetsAndKeepsBookCurrencyAndPhaseScope() throws {
        let first = try row()
        let revised = try row(["qualification": "source_revised"])
        let receipt = try row(["book_owner_id": UUID().uuidString, "phase": "customer_receipt", "currency": "EUR"])
        let refund = try row(["allocation_index": 2, "phase": "customer_refund", "currency": "USD"])
        var page = AllocationPage()
        page.append(Array(repeating: first, count: 200), size: 200)
        XCTAssertEqual(page.rows.count, 1); XCTAssertEqual(page.offset, 200); XCTAssertTrue(page.more)
        page.append([revised, receipt, refund], size: 200)
        XCTAssertEqual(page.offset, 203); XCTAssertFalse(page.more)
        XCTAssertEqual(page.rows.count, 3)
        XCTAssertEqual(page.rows[0].qualification, "source_revised")
        XCTAssertEqual(page.rows[1].phaseText, "Customer receipt"); XCTAssertEqual(page.rows[1].currency, "EUR")
        XCTAssertEqual(page.rows[2].phaseText, "Customer refund"); XCTAssertEqual(page.rows[2].currency, "USD")
    }
    func testNetworkFailureAndCancelledReadNeverPublishFallback() async throws {
        let row = try row()
        let reads = AllocationReaders.Reads(exact: { _, _ in [row] }, source: { _ in throw URLError(.notConnectedToInternet) })
        refused(await AllocationReaders.loadSource(vehicle: vehicle, row: row, kind: .bank, reads: reads, account: { "a" }))
        let task = Task { await AllocationReaders.loadSource(vehicle: vehicle, row: row, kind: .bank, reads: reads, account: { "a" }) }
        task.cancel()
        refused(await task.value)
    }
    func testMissingMalformedSourceAndSignedOutAccountNeverStartSourceRead() async throws {
        for row in [try row(["bank_source_key": NSNull()]), try row(["bank_source_key": "bad"])] {
            let reads = AllocationReaders.Reads(exact: { _, _ in [row] }, source: { _ in XCTFail("Malformed reference"); return nil })
            refused(await AllocationReaders.loadSource(vehicle: vehicle, row: row, kind: .bank, reads: reads, account: { "a" }))
        }
        let row = try row()
        let reads = AllocationReaders.Reads(exact: { _, _ in XCTFail("No account"); return [row] })
        refused(await AllocationReaders.loadRecord(vehicle: vehicle, key: row.id, reads: reads, account: { nil }))
    }
    // Optional private diagnostic replay, following the existing snapshot-test convention.
    // The input is read-only database evidence, not an authenticated phone acceptance claim.
    func testPrivateRetainedSourceDecoderReplay() throws {
        guard let path = ProcessInfo.processInfo.environment["NUKE_ALLOCATION_SOURCE_REPLAY"] else {
            throw XCTSkip("Set NUKE_ALLOCATION_SOURCE_REPLAY for a private retained-source DTO replay.")
        }
        struct Diagnostic: Decodable {
            let document_id: UUID
            let record_source_key: String
            let bank_document_id: UUID?
            let bank_source_key: String?
            let book_source: AllocationSourceDocument
            let bank_source: AllocationSourceDocument?
        }
        let values = try JSONDecoder().decode([Diagnostic].self, from: Data(contentsOf: URL(fileURLWithPath: path)))
        XCTAssertFalse(values.isEmpty)
        for value in values {
            XCTAssertEqual(value.book_source.reader, "accounting_record_evidence")
            XCTAssertEqual(value.book_source.document_id, value.document_id)
            XCTAssertEqual(value.book_source.source_key, value.record_source_key)
            if let bank = value.bank_source {
                XCTAssertEqual(bank.document_id, value.bank_document_id)
                XCTAssertEqual(bank.source_key, value.bank_source_key)
                XCTAssertEqual(bank.record.kind, "retained_bank_movement")
                XCTAssertNotNil(bank.record.amount)
                XCTAssertNotNil(bank.record.currency)
            }
        }
    }
}
