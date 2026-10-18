import XCTest
@testable import NukeCapture

final class LedgerBrowseTests: XCTestCase {
    func testAllSourceYearRequestIncludesTheRequiredNullSourceArgument() throws {
        let params = LedgerMap.YearParams(p_source: nil, p_make: "Ferrari", p_model: "250 GT SWB California Spider")
        let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(params)) as? [String: Any])
        XCTAssertTrue(payload["p_source"] is NSNull, "Omitting the required source argument makes the year RPC return 404")
        XCTAssertEqual(payload["p_make"] as? String, "Ferrari")
        XCTAssertEqual(payload["p_model"] as? String, "250 GT SWB California Spider")
    }

    private func node(_ name: String, familyKey: String? = nil) -> LedgerNode {
        LedgerNode(name: name, count: 12, value: 1_200_000, median_price: nil, min_price: nil, max_price: nil,
                   sold_count: 12, auction_count: 15, avg_bids: nil, avg_watchers: nil, usd: 1_200_000, familyKey: familyKey)
    }

    func testMakeFamilyModelYearBrowseHasAnExplicitStepAtEveryLevel() {
        let all = LedgerBrowsePath()
        let make = all.opening(node("Ferrari"))
        let family = make.opening(node("250 GT", familyKey: "family-250gt"))
        XCTAssertEqual(make.level, .families)
        XCTAssertEqual(family.level, .models)
        XCTAssertNil(family.model, "choosing a family must not silently choose a model or chart")
        XCTAssertEqual(family.familyKey, "family-250gt")
        let model = family.opening(node("250 GT Berlinetta"))
        let year = model.opening(node("1962"))
        XCTAssertEqual(model.level, .years)
        XCTAssertEqual(year.level, .vehicles)
        XCTAssertEqual(year.make, "Ferrari")
        XCTAssertEqual(year.familyKey, "family-250gt")
        XCTAssertEqual(year.model, "250 GT Berlinetta")
        XCTAssertEqual(year.year, 1962)
        XCTAssertEqual(year.steppingBack(), model)
        XCTAssertEqual(model.steppingBack(), family)
        XCTAssertEqual(family.steppingBack(), make)
        XCTAssertEqual(make.steppingBack(), all)
    }

    func testFallbackModelAndInvalidYearDoNotInventACanonicalFamilyOrYear() {
        let make = LedgerBrowsePath(make: "Uncatalogued make")
        let model = make.opening(node("Recorded model"))
        XCTAssertEqual(model.level, .years)
        XCTAssertNil(model.familyKey)
        XCTAssertEqual(model.opening(node("Year unrecorded")), model)
        XCTAssertEqual(model.steppingBack(), make)
    }

    func testIdenticallyNamedFamilyAndModelRemainSeparateBrowseSteps() {
        let family = LedgerBrowsePath(make: "Ferrari").opening(node("250 GT", familyKey: "family-250gt"))
        let model = family.opening(node("250 GT"))
        XCTAssertEqual(family.scopeLabel, "Family")
        XCTAssertEqual(model.scopeLabel, "Model")
        XCTAssertEqual(model.level, .years)
        XCTAssertEqual(model.steppingBack(), family)
    }

    func testBackKeepsEraWithinTheFamilyAndClearsItWhenLeavingTheFamily() {
        let family = LedgerBrowsePath(make: "Ferrari", familyKey: "family-250gt", familyName: "250 GT", era: "1960-1969")
        let model = family.opening(node("250 GT Berlinetta"))
        let year = model.opening(node("1962"))
        XCTAssertEqual(year.steppingBack().era, "1960-1969")
        XCTAssertEqual(model.steppingBack().era, "1960-1969")
        XCTAssertNil(family.steppingBack().era)
        XCTAssertEqual(family.steppingBack().make, "Ferrari")
    }

    func testPresentationChoicesPreserveTheCohortAndNeverCarryAChartIntoADrill() {
        let family = LedgerBrowsePath(make: "Ferrari", familyKey: "family-250gt", familyName: "250 GT")
        let model = family.opening(node("250 GT Berlinetta"))
        XCTAssertEqual(LedgerBrowsePresentation.list.afterDrill(), .list)
        XCTAssertEqual(LedgerBrowsePresentation.map.afterDrill(), .map)
        XCTAssertEqual(LedgerBrowsePresentation.chart.afterDrill(), .map)
        XCTAssertEqual(model.familyKey, family.familyKey)
        XCTAssertEqual(model.make, family.make)
    }
}
