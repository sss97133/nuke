import XCTest
@testable import NukeCapture

final class InvestmentEvidenceTests: XCTestCase {
    func testConfirmationRequiresTheExactAffirmativeWriterReceipt() throws {
        let id = UUID(uuidString:"00000000-0000-4000-8000-00000000f002")!
        let decoder = JSONDecoder()
        func reply(_ text: String) throws -> SessionConfirmationReceipt {
            try decoder.decode(SessionConfirmationReceipt.self,from:Data(text.utf8))
        }
        XCTAssertTrue(try reply(#"{"ok":true,"session_id":"00000000-0000-4000-8000-00000000f002","confirmed":true}"#).acknowledges(id))
        for text in [#"{"ok":false,"error":"not_authorized"}"#, #"{"ok":true}"#,
                     #"{"ok":true,"session_id":"00000000-0000-4000-8000-00000000f001","confirmed":true}"#,
                     #"{"ok":true,"session_id":"00000000-0000-4000-8000-00000000f002","confirmed":false}"#] {
            XCTAssertFalse(try reply(text).acknowledges(id))
        }
        XCTAssertThrowsError(try reply("{}"))
        XCTAssertThrowsError(try reply(#"{"ok":"#))
    }
    func testCompoundSessionPayloadCannotSupplyPureLaborCurrencyOrPaymentProof() throws {
        let proof = try JSONDecoder().decode(InvestmentProof.self, from: Data(InvestmentEvidenceFixtures.proof.utf8))
        XCTAssertEqual(proof.proven.confirmed_labor.value, 600)
        XCTAssertEqual(proof.totals.invested_proven, 987654)
        XCTAssertEqual(proof.projected.labor.value, 777777)
        XCTAssertEqual(proof.by_party?.first?.total, 654321)
        let rows = try XCTUnwrap(proof.audit?.work_sessions)
        XCTAssertEqual(rows[0].cost, 600)
        XCTAssertEqual(rows[0].confirmed, true)
        XCTAssertEqual(rows[1].confirmed, false)
        XCTAssertNil(rows[2].confirmed)
        XCTAssertNil(rows[2].cost)
        // The existing reader emits one job cost, not its component breakdown or a currency.
        // UI tests exercise that missing contract and the unqualified aggregate fields above.
    }
    func testWithheldAuditKeepsUnknownRowsSeparateFromAnEmptyReturnedList() throws {
        let proof = try JSONDecoder().decode(InvestmentProof.self, from: Data(InvestmentEvidenceFixtures.withheld.utf8))
        XCTAssertFalse(proof.is_owner_view)
        XCTAssertEqual(proof.totals.invested_proven, 987654)
        XCTAssertNil(proof.audit?.receipts)
        XCTAssertNil(proof.audit?.payments)
        XCTAssertNil(proof.audit?.work_sessions)
    }
}
