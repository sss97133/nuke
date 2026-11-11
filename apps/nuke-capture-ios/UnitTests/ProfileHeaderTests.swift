// ProfileHeaderTests.swift — the profile header says what the record holds and no more.
//
// get_user_producer_signals sums work_sessions of every status (for the owner on 2026-11-09:
// 1,914 sessions, 4 owner-confirmed, 661 derived or auto-inferred), so hours read "logged,
// unconfirmed", never "proven". The organization list says what it shows: warm relations, or the
// dormant fallback, and a missing last contribution is unknown, never "nothing".

import XCTest
@testable import NukeCapture

final class ProfileHeaderTests: XCTestCase {
    private func signals(_ json: String) throws -> ProducerSignals {
        try JSONDecoder().decode(ProducerSignals.self, from: Data(json.utf8))
    }

    private let owner = """
    {"last_worked":"2026-06-20","worked_today":false,"work_days_total":810,"work_days_year":92,
     "hours_total":1446,"hours_year":151,"current_streak":0,"longest_streak":26,
     "images_total":29749,"images_analyzed":185,"images_today":0,"active_today":false}
    """

    func testHoursReadLoggedAndUnconfirmedNeverProven() throws {
        let p = try signals(owner)
        let stat = try XCTUnwrap(ProfileHeaderCopy.hoursYearStat(p))
        XCTAssertEqual(stat.value, "\(151.formatted())h")
        XCTAssertEqual(stat.label, "logged this year · unconfirmed")

        let fleet = ProfileHeaderCopy.fleetLine(owned: 2, p)
        XCTAssertEqual(fleet, "2 owned · \(1446.formatted())h logged, unconfirmed · 810 logged days")
        for line in [stat.label, fleet] {
            XCTAssertFalse(line.localizedCaseInsensitiveContains("proven"), line)
            XCTAssertFalse(line.localizedCaseInsensitiveContains("confirmed") && !line.contains("unconfirmed"), line)
        }
    }

    func testNoHoursOnRecordShowsNoHoursChip() throws {
        let p = try signals(#"{"hours_year":0,"hours_total":null,"work_days_total":null}"#)
        XCTAssertNil(ProfileHeaderCopy.hoursYearStat(p))
        XCTAssertEqual(ProfileHeaderCopy.fleetLine(owned: 1, p), "1 owned")
    }

    func testActivityLineIsHonestWhenIdle() throws {
        XCTAssertEqual(ProfileHeaderCopy.activityLine(try signals(owner)), "Last worked 2026-06-20")
        XCTAssertEqual(ProfileHeaderCopy.activityLine(try signals(#"{"worked_today":true}"#)), "Worked today")
        XCTAssertEqual(ProfileHeaderCopy.activityLine(try signals(#"{"active_today":true,"images_today":0}"#)), "Active today")
        XCTAssertEqual(ProfileHeaderCopy.activityLine(try signals("{}")), "No work logged yet")
    }

    private func rows(_ states: [(String, String?)]) throws -> [OrgAffiliationsSection.Row] {
        let items = states.enumerated().map { (pair: (offset: Int, element: (String, String?))) -> String in
            let i = pair.offset, s = pair.element
            let last = s.1.map { "\"\($0)\"" } ?? "null"
            return """
            {"organization_id":"00000000-0000-4000-8000-00000000000\(i)","name":"Org \(i)","type":"other","role":"technician",
             "start_date":null,"relation":{"weight":0,"state":"\(s.0)","last_contribution_at":\(last),"contributions_24h":0}}
            """
        }
        struct Payload: Decodable { let relations: [OrgAffiliationsSection.Row] }
        return try JSONDecoder().decode(Payload.self, from: Data(#"{"relations":[\#(items.joined(separator: ","))]}"#.utf8)).relations
    }

    func testOrganizationsFooterNamesWhatIsShown() throws {
        let warm = try rows([("live", "2026-11-09T20:00:00+00:00"), ("stalling", "2026-11-09T08:00:00+00:00")])
        XCTAssertTrue(OrgAffiliationsSection.footer(warm).hasPrefix("Live and stalling relations"))

        let dormant = try rows([("dormant", "2026-11-08T08:00:00+00:00"), ("dormant", "2026-11-08T07:00:00+00:00")])
        let footer = OrgAffiliationsSection.footer(dormant)
        XCTAssertFalse(footer.contains("Active relations only"))
        XCTAssertTrue(footer.contains("dormant"))
    }

    func testMissingLastContributionIsUnknownNotNothing() throws {
        let r = try rows([("dormant", nil)])[0]
        XCTAssertEqual(OrgAffiliationsSection.lastContribution(r.relation), "last contribution unknown")
        XCTAssertFalse(OrgAffiliationsSection.lastContribution(r.relation).contains("nothing"))
    }
}
