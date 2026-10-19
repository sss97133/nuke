// StatementPrivacyTests.swift — statement totals never show payments to a non-party, even if a reader sends them.

import XCTest
@testable import NukeCapture

final class StatementPrivacyTests: XCTestCase {
    func testTotalsWithholdPaymentsFromNonParties() throws {
        let leaked = JobFixtures.statementVisitor.replacingOccurrences(of: #""payments":null,"balance":null"#,
                                                                      with: #""payments":4321.09,"balance":4321.09"#)
        let s = try JobReaders.decode(JobStatement.self, from: Data(leaked.utf8))
        XCTAssertNil(s.totals?.payments)
        XCTAssertNil(s.totals?.balance)
        XCTAssertEqual(s.totals?.parts, 171)                                    // open data stays
        let party = try JobReaders.decode(JobStatement.self, from: Data(JobFixtures.statementParty.utf8))
        XCTAssertEqual(party.totals?.payments, 500)
        XCTAssertEqual(party.totals?.balance, 711)
    }
}
