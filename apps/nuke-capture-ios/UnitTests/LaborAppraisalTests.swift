// LaborAppraisalTests.swift — the labor appraisal reads the same words on the phone as on the web.
//
// Cases and expected strings follow nuke_frontend/src/pages/vehicle-profile/LaborAppraisal.test.tsx. The JSON is in
// the shape vehicle_labor_appraisal returns (logic 20261124222000); all ids are synthetic.

import XCTest
@testable import NukeCapture

final class LaborAppraisalTests: XCTestCase {
    private let json = """
    {"vehicle_id":"00000000-0000-0000-0000-0000000000a1","as_of":"2026-11-25T02:48:23.903062+00:00",
     "logic_version":"vehicle_labor_appraisal/20261124222000.1","applicable":true,
     "totals":{"hours_min":126.00,"hours_typical":168.00,"hours_max":247.00,"priced_segments":3,
       "rule":"witnessed adds each priced segment's witnessed hours",
       "witnessed":{"hours_min":71.00,"hours_typical":81.00,"hours_max":247.00,"unknown_min_segments":2},
       "with_unwitnessed_purchases":{"hours_min":126.00,"hours_typical":168.00,"hours_max":247.00},
       "by_grade":{"shop_paper":{"hours_min":50.75,"hours_typical":50.75,"hours_max":50.75}}},
     "segments":[
      {"segment":"engine","hours_min":50.75,"hours_typical":50.75,"hours_max":50.75,"evidence_grade":"shop_paper",
       "hours_basis":"shop_paper","paper_hours":50.75,"book_hours":{"hours_min":20,"hours_typical":32,"hours_max":50},
       "range_below_paper":true,"evidence_count":20,"counts_in":"witnessed",
       "witnessed_hours_min":50.75,"witnessed_hours_typical":50.75,"witnessed_hours_max":50.75,
       "citation":"stage_transition_labor_map:powertrain none->rebuilt_original",
       "stage_steps":[{"from_stage":"none","to_stage":"rebuilt_original","zone":"*","transition_id":"t1"}]},
      {"segment":"chassis","hours_min":8,"hours_typical":14,"hours_max":24,"evidence_grade":"fitted_in_photos","hours_basis":"book",
       "evidence_count":28,"counts_in":"witnessed","witnessed_reason":"fitted, no book hours",
       "witnessed_hours_min":null,"witnessed_hours_typical":null,"witnessed_hours_max":24,
       "witness_share":{"evidence_parts":17,"fitted_with_operation":0,"fitted_without_operation":1,"not_fitted":0,"cannot_tell":3,
         "unwitnessed":13,"none_raised":13,"fitted_share":0.059,"pieces":[{"item_id":"p1","witness":"unwitnessed"}]}},
      {"segment":"body_metal","hours_min":28,"hours_typical":42,"hours_max":84,"evidence_grade":"parts_bought","hours_basis":"book",
       "counts_in":"unwitnessed_purchase","witnessed_reason":"not witnessed","witnessed_hours_max":84,
       "stage_steps":[{"from_stage":"stripped","to_stage":"fabricated","zone":"panel_*","pieces":[
         {"item_id":"b1","witness":"unwitnessed","question_state":"cannot_tell"},
         {"item_id":"b2","witness":"unwitnessed","question_state":"cannot_tell"}]}]},
      {"segment":"reassembly","hours_min":2.25,"hours_typical":2.25,"hours_max":2.25,"evidence_grade":"receipt_part_visible",
       "reassembly":{"matched":[
         {"item_id":"r1","hours":2,"operation_code":"INT-CARPET-RR","part":{"catalog_part_id":"c1","name":"Molded carpet set"}},
         {"item_id":"r2","hours":1,"operation_code":"INT-SEATS-RR"}]}},
      {"segment":"gearbox_rebuild","hours_min":null,"hours_typical":null,"hours_max":null,"status":"no evidence"}
     ]}
    """

    private func appraisal() throws -> LaborAppraisal { try JSONDecoder().decode(LaborAppraisal.self, from: Data(json.utf8)) }

    func testRangeWordsMatchTheWeb() {
        XCTAssertEqual(LaborWords.range(8, 12, 16), "8 h to 16 h, typical 12 h")
        XCTAssertEqual(LaborWords.range(2.75, 2.75, 2.75), "2.75 h")
        XCTAssertNil(LaborWords.range(1, nil, 2))
    }

    func testSegmentLinesPrintWordsNotIdentifiers() throws {
        let a = try appraisal()
        let all = a.segments.flatMap { LaborWords.lines($0) }.joined(separator: "\n")
        XCTAssertFalse(all.contains("stage_transition_labor_map"), "a rule identifier reached the screen")
        XCTAssertFalse(all.contains("INT-CARPET-RR"), "an operation code reached the screen")
        XCTAssertFalse(all.contains("not named"))
        XCTAssertFalse(all.contains("panel"), "a zone pattern reached the screen")
        let engine = LaborWords.lines(a.segments[0])
        XCTAssertEqual(engine[0], "Evidence: shop paper · hours from shop paper · 50.75 h on shop paper · book range 20 h to 50 h, typical 32 h · 20 evidence rows")
        XCTAssertTrue(engine.contains("The book range is below the hours on shop paper; the paper hours are used."))
        XCTAssertTrue(engine.contains("Stages: none to rebuilt original"))
    }

    func testWitnessCountsAreTheReadersAndNeverCallABoughtPieceNotFitted() throws {
        let a = try appraisal()
        XCTAssertEqual(LaborWords.witness(a.segments[1]),
                       "1 fitted without a book operation · 13 bought, not seen fitted (13 with no fitted question raised) · 3 cannot tell")
        XCTAssertEqual(LaborWords.witness(a.segments[2]), "2 bought; fitted question cannot tell")
        XCTAssertEqual(LaborWords.witnessedHours(a.segments[1]), "Witnessed: fitted, no book hours; minimum unknown, at most 24 h")
        XCTAssertNil(LaborWords.witnessedHours(a.segments[0]), "witnessed hours equal to the segment's are not repeated")
        XCTAssertTrue(LaborWords.lines(a.segments[2])[0].contains("counted with work not witnessed"))
    }

    func testPartsAreNamedByCatalogPartAndTheRestCounted() throws {
        let a = try appraisal()
        XCTAssertEqual(LaborWords.parts("Fitted parts with a book operation", a.segments[3].reassembly!.matched!),
                       "Fitted parts with a book operation: 2. Molded carpet set, 2 h; 1 more")
    }

    func testWitnessedTotalIsAFloorOnlyWhenTheReaderSaysSo() throws {
        let w = try appraisal().totals!.witnessed!
        XCTAssertEqual(LaborWords.witnessedTotal(w), "71 h to 247 h, typical 81 h")
        var floor = w; floor.max_witnessed = false
        XCTAssertEqual(LaborWords.witnessedTotal(floor), "at least 71 h, typical 81 h")
        XCTAssertNil(LaborWords.witnessedTotal(.init(hours_min: nil, hours_typical: nil, hours_max: 40)))
        // 20261125033000: a witnessed max that leaves segments unknown is not a bound either.
        let known = LaborAppraisal.WitnessedTotal(hours_min: 71, hours_typical: 81, hours_max: 92, unknown_min_segments: 4, unknown_max_segments: 4)
        XCTAssertEqual(LaborWords.witnessedTotal(known), "at least 71 h, typical 81 h")
        XCTAssertEqual(LaborWords.witnessedUnknown(known), " (4 segments with no witnessed minimum, 4 with no witnessed maximum)")
        XCTAssertEqual(LaborWords.witnessedUnknown(.init(unknown_min_segments: 0)), "")
    }

    func testStepsAndPartsUseTheReadersNames() {
        let names = LaborNames(transitions: ["t1": .init(label: "Full body block sand")], operations: ["INT-SEATS-RR": .init(name: "Seats R&R (pair)")])
        XCTAssertEqual(LaborWords.step(LaborStageStep(from_stage: "primed", to_stage: "blocked", transition_id: "t1"), names), "Full body block sand")
        XCTAssertEqual(LaborWords.step(LaborStageStep(from_stage: "primed", to_stage: "blocked", transition_id: "t2"), names), "primed to blocked")
        XCTAssertEqual(LaborWords.parts("Fitted parts with a book operation",
                                        [LaborPart(item_id: "r2", hours: 1, operation_code: "INT-SEATS-RR")], names),
                       "Fitted parts with a book operation: 1. Seats R&R (pair), 1 h")
    }

    func testCoverageCountsPricedSegmentsAndDatesInTheViewersZone() throws {
        let a = try appraisal()
        let zone = ProfileClock.timeZone
        defer { ProfileClock.timeZone = zone }
        // 02:48 UTC on Nov 25 is Nov 24 in Las Vegas: the viewer's day, not the server's.
        ProfileClock.timeZone = TimeZone(identifier: "America/Los_Angeles")!
        XCTAssertEqual(LaborWords.coverage(a), "4 of 5 segments with hours · Nov 24, 2026")
        ProfileClock.timeZone = TimeZone(identifier: "UTC")!
        XCTAssertEqual(LaborWords.coverage(a), "4 of 5 segments with hours · Nov 25, 2026")
    }

    private func decode(_ j: String) throws -> LaborAppraisal { try JSONDecoder().decode(LaborAppraisal.self, from: Data(j.utf8)) }

    func testStoredFoldStateNeverPrintsStaleHoursAsCurrent() throws {
        let zone = ProfileClock.timeZone
        defer { ProfileClock.timeZone = zone }
        ProfileClock.timeZone = TimeZone(identifier: "UTC")!
        let notYet = try decode(#"{"vehicle_id":"v","status":"not_yet_computed","segments":[],"state":{"fresh":false,"computed":false,"error":null}}"#)
        XCTAssertTrue(LaborWords.noReadYet(notYet))
        XCTAssertEqual(LaborWords.foldState(notYet), "No hours yet: not yet computed")
        let recomputing = try decode(#"{"vehicle_id":"v","status":"recomputing","segments":[]}"#)
        XCTAssertTrue(LaborWords.noReadYet(recomputing))
        XCTAssertNil(LaborWords.foldState(recomputing))

        var stale = try appraisal()
        stale.state = .init(fresh: false, computed: true, computed_at: "2026-11-25T18:00:00.123456+00:00", key_current: true)
        XCTAssertFalse(LaborWords.noReadYet(stale))
        XCTAssertEqual(LaborWords.foldState(stale), "As of Nov 25, 2026, recomputing")
        stale.state?.label = "recomputing after new evidence"
        XCTAssertEqual(LaborWords.foldState(stale), "As of Nov 25, 2026, recomputing after new evidence")
        var fresh = try appraisal()
        fresh.state = .init(fresh: true, computed: true, computed_at: "2026-11-25T18:00:00+00:00")
        XCTAssertNil(LaborWords.foldState(fresh))
        XCTAssertNil(LaborWords.foldState(try appraisal()))
    }

    func testBasisInTheReadersWordsElseTheKey() {
        let names = LaborNames(bases: ["uncited_seed": .init(label: "book estimate, no cited source")])
        XCTAssertEqual(LaborWords.basisWords("uncited_seed", names), "book estimate, no cited source")
        XCTAssertEqual(LaborWords.basisWords("shop_paper", names), "shop paper")
    }
}
