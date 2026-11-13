// TokenItemsTests.swift — a header token's line items read the same words on the phone as on the web.
//
// The cases and expected strings follow nuke_frontend/src/pages/vehicle-profile/HeaderTokenItems.test.tsx.
// All data is synthetic: no real vehicle, VIN, image path or person.

import XCTest
@testable import NukeCapture

final class TokenItemsTests: XCTestCase {
    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try JSONDecoder().decode(T.self, from: Data(json.utf8))
    }

    private let transmissionItems = """
    [
     {"key":"transmission.as_built.type","facet":"as_built","value":"Manual","unit":null,"status":"established","lead":true,"needed":null,
      "rule":{"key":"example_vin_rule_v1","code":"X","citation_url":"https://example.org/vin-chart","rule_ids":["r-0"],"narrowed_by":{"key":"k"}},
      "equation":null,
      "sources":[{"kind":"registry","slug":"example_chart","label":"Example VIN chart","observed_at":"2026-01-02T00:00:00Z","witness":{"kind":"observation","id":"o-1"},"class":"decode","photos":3}]},
     {"key":"transmission.current.case_casting","facet":"current","value":"3925661","unit":null,"status":"reading","needed":null,"rule":null,"equation":null,
      "sources":[{"kind":"image","label":"photo reading","observed_at":"2026-02-03T00:00:00.123456+00:00","value":"3925661",
        "decoded":{"excluded_models":["Model Z"],"vin_derivative_present":false,"transmission_speeds":4,"empty":null},
        "limitation":"One reading of one photo.",
        "witness":{"kind":"image","id":"i-1","thumb":"https://example.supabase.co/storage/v1/object/public/vehicle-photos/synthetic/t.HEIC"}}]},
     {"key":"transmission.current.gear_ratios","facet":"decode","value":null,"unit":null,"status":"missing","rule":null,"equation":null,"sources":[],
      "needed":"unit year or ratio-set identification",
      "candidates":[{"code":"X1","gears":[2.2,1.64,1.28,1],"reverse":2.27,"countershaft_in":"7/8",
        "citation_url":"https://example.org/ratios","citation_title":"Example ratio sheet","qualifiers":{"also_in":[{"id":"q"}]}}]},
     {"key":"transmission.current.model","facet":"current","value":null,"unit":null,"status":"conflict","rule":null,"equation":null,"needed":null,"sources":[],
      "sides":[{"value":"Model A","sources":[{"kind":"listing","label":"Seller listing","observed_at":"2025-05-06T00:00:00Z"}]},
               {"value":"Model B","sources":[{"kind":"image","label":"photo reading","observed_at":"2026-02-03T00:00:00Z"}]}]},
     {"key":"transmission.derived.rpm_at_60","facet":"derived","value":2450,"unit":"rpm","status":"established","rule":null,"needed":null,"sources":[],
      "equation":{"expression":"mph * top_gear_ratio * axle_ratio * 63360 / (60 * pi() * tire_diameter_in), mph = 60","reads":["a.b"]}},
     {"facet":"current","status":"reading","value":"an item without a key cannot be placed"},
     {"key":"transmission.derived.changed","facet":"derived","value":true,"unit":null,"status":"reading","rule":null,"equation":null,"needed":null,
      "sources":[{"kind":"image","label":"photo reading","value":"not_original_unit","observed_at":"2026-01-02T00:00:00Z"},
                 {"kind":"image","label":"photo reading","value":"not_original_engine","value_label":"not the original engine","observed_at":"2026-01-02T00:00:00Z"}]}
    ]
    """

    private var readJSON: String {
        """
        {"vehicle_id":"00000000-0000-4000-8000-000000000001","viewer":"anon","read_at":"2026-11-12T00:00:00Z",
         "sections":[
          {"kind":"masthead","year":1970,"make":"Examplemake","model":"Examplemodel",
           "identity_source":{"year":1970,"make":"Examplemake","model":"Examplemodel"},
           "token_items":{
             "transmission":\(transmissionItems),
             "year":[{"key":"year.decode","facet":"decode","value":"1970","status":"established","lead":true,"sources":[]}],
             "make":[{"key":"make.decode","facet":"decode","value":"Examplemake","status":"established","lead":true,"sources":[]}],
             "trim":[{"key":"trim.recorded","facet":"current","value":"EXAMPLE TRIM","status":"claim","sources":[]},
                     {"key":"trim.decode","facet":"decode","value":"Base","status":"established","sources":[]}],
             "drivetrain":[{"key":"drivetrain.current.layout","facet":"current","value":"RWD","status":"reading","sources":[]}],
             "engine":"not a list"
           }},
          {"kind":"strip","coverage":{"n":1,"of":2,"grain":"facts attributed","as_of":"2026-11-12T00:00:00Z"},
           "facets":[{"dimension":"transmission","label":"Manual","member":{"value":"Manual","unit":null,"source":{"kind":"listing"},"observed_at":null,"trust":0.6}}],
           "gaps":[{"dimension":"drivetrain","label":"Drivetrain"},{"label":"no dimension"}]}
         ]}
        """
    }

    // MARK: - Decode

    func testProfileReadCarriesTokenItemsAndStripGaps() throws {
        let read = try decode(ProfileRead.self, readJSON)
        let items = try XCTUnwrap(read.masthead?.tokenItems)
        // The keyless item is dropped; the other six stay in the reader's order.
        XCTAssertEqual(items["transmission"].map(\.key), [
            "transmission.as_built.type", "transmission.current.case_casting", "transmission.current.gear_ratios",
            "transmission.current.model", "transmission.derived.rpm_at_60", "transmission.derived.changed",
        ])
        // A token whose value is not a list reads as no items, not as a failed header.
        XCTAssertEqual(items["engine"], [])
        XCTAssertEqual(read.strip?.gaps, [ProfileSection.Gap(dimension: "drivetrain", label: "Drivetrain")])

        let first = items["transmission"][0]
        XCTAssertTrue(first.lead)
        XCTAssertEqual(first.sources.first?.witness?.id, "o-1")
        let casting = items["transmission"][1]
        XCTAssertEqual(casting.sources.first?.witness?.thumb?.hasSuffix("synthetic/t.HEIC"), true)
        XCTAssertEqual(items["transmission"][2].candidates.count, 1)
        XCTAssertEqual(items["transmission"][3].sides.map { ItemText.valueText($0.value) }, ["Model A", "Model B"])
    }

    func testOlderReadWithoutItemsOrGapsStillDecodes() throws {
        let json = """
        {"vehicle_id":"v","viewer":"anon","read_at":"2026-11-12T00:00:00Z","sections":[
         {"kind":"masthead","year":null,"make":null,"model":null,"identity_source":{}},
         {"kind":"strip","coverage":{"n":0,"of":0,"grain":"facts attributed","as_of":null},"facets":[]}]}
        """
        let read = try decode(ProfileRead.self, json)
        XCTAssertEqual(read.masthead?.tokenItems.isEmpty, true)
        XCTAssertEqual(read.strip?.gaps, [])
        XCTAssertEqual(ProfileHeaderBlock.identityTokens(read: read), [])
    }

    func testMalformedTokenItemsNeverFailTheHeader() throws {
        let json = """
        {"vehicle_id":"v","viewer":"anon","read_at":"2026-11-12T00:00:00Z","sections":[
         {"kind":"masthead","year":null,"make":null,"model":null,"identity_source":{},"token_items":[1,2,3]}]}
        """
        let read = try decode(ProfileRead.self, json)
        XCTAssertEqual(read.masthead?.tokenItems.isEmpty, true)
    }

    func testJSONValuesKeepTheirTypes() throws {
        let v = try decode([ItemJSON].self, #"[true, 1, 1.0, 0, "x", null, [2.56, 1], {"label":"L"}]"#)
        XCTAssertEqual(v[0], .bool(true))
        XCTAssertEqual(v[1], .number(1))
        XCTAssertEqual(v[2], .number(1))
        XCTAssertEqual(v[3], .number(0))
        XCTAssertEqual(v[4], .string("x"))
        XCTAssertEqual(v[5], .null)
        XCTAssertEqual(v[6], .array([.number(2.56), .number(1)]))
        XCTAssertEqual(v[7], .object(["label": .string("L")]))
    }

    // MARK: - Words (HeaderTokenItems.test.tsx)

    func testNamesItemsFromTheirKeysAndWritesValuesAsWords() throws {
        XCTAssertEqual(ItemText.itemLabel(key: "transmission.current.case_casting", facet: "current"), "Case casting")
        XCTAssertEqual(ItemText.itemLabel(key: "transmission.axle.as_built.ratio", facet: "as_built"), "Axle ratio")
        XCTAssertEqual(ItemText.itemLabel(key: "location.sources.photo_gps", facet: "current"), "Photo gps")
        XCTAssertEqual(ItemText.itemLabel(key: "year.decode", facet: "decode"), "Decode")
        XCTAssertEqual(ItemText.itemLabel(key: "location", facet: "current"), "Current")
        XCTAssertEqual(ItemText.valueText(.array([.number(2.52), .number(1.88), .number(1.46), .number(1)])), "2.52 / 1.88 / 1.46 / 1")
        XCTAssertEqual(ItemText.valueText(.number(4.1), unit: "L"), "4.1 L")
        XCTAssertEqual(ItemText.valueText(.number(2450), unit: "rpm"), "2,450 rpm")
        XCTAssertEqual(ItemText.valueText(.bool(true)), "Yes")
        XCTAssertEqual(ItemText.valueText(.bool(false)), "No")
        XCTAssertNil(ItemText.valueText(.null))
        XCTAssertNil(ItemText.valueText(.string("  ")))
        XCTAssertEqual(ItemText.valueText(.object(["label": .string("Example City, NV"), "county_fips": .string("32999")])), "Example City, NV")
    }

    func testCodesRatiosAndEquationsReadAsWords() {
        XCTAssertEqual(ItemText.codeText("not_original_unit"), "not original unit")
        XCTAssertEqual(ItemText.codeText("Muncie four-speed"), "Muncie four-speed")
        XCTAssertEqual(ItemText.codeText("transmission on tag: not_example_code"), "transmission on tag: not example code")
        XCTAssertEqual(ItemText.equationText("gear_ratio[n] * axle_ratio"), "gear ratio[n] * axle ratio")
        XCTAssertEqual(ItemText.equationText("as_built.type <> current.type"), "as built type ≠ current type")
        XCTAssertEqual(ItemText.equationText("mph * top_gear_ratio * axle_ratio * 63360 / (60 * pi() * tire_diameter_in), mph = 60"),
                       "mph * top gear ratio * axle ratio * 63360 / (60 * π * tire diameter in), mph = 60")
        XCTAssertEqual(ItemText.ratioText(.array([.number(2.56), .number(1.91), .number(1.48), .number(1)])), "2.56 / 1.91 / 1.48 / 1.00")
        XCTAssertEqual(ItemText.ratioText(.number(3.16)), "3.16")
        XCTAssertNil(ItemText.ratioText(.string("n/a")))
    }

    func testRuleCandidatesAvailabilityAndExaminedLines() {
        // A rule with no label reads its key as words, then code and effect.
        XCTAssertEqual(ItemText.ruleText(["key": .string("example_vin_rule_v1"), "code": .string("X")]), "example vin rule v1 · code X")
        XCTAssertEqual(ItemText.ruleText(["key": .string("model_availability"), "label": .string("Factory availability by series and engine")]),
                       "Factory availability by series and engine")
        XCTAssertEqual(ItemText.ruleText(["key": .string("k_v1"), "code": .null, "effect": .string("narrows the set")]), "k v1 · narrows the set")

        XCTAssertEqual(ItemText.candidateLine(["code": .string("X1"), "gears": .array([.number(2.2), .number(1.64), .number(1.28), .number(1)]),
                                               "reverse": .number(2.27), "countershaft_in": .string("7/8")]),
                       "X1 · 2.20 / 1.64 / 1.28 / 1.00 · reverse 2.27 · 7/8 in countershaft")
        XCTAssertEqual(ItemText.candidateLine(["code": .string("X2"), "gears": .array([.number(2.52)]), "reverse": .null]), "X2 · 2.52")

        XCTAssertEqual(ItemText.availabilityLine(["market": .string("US"), "available": .bool(false), "transmission": .string("Example 4-speed")]),
                       "US · not available · Example 4-speed")
        XCTAssertEqual(ItemText.availabilityLine(["market": .string("Canada"), "available": .string("implied"), "transmission": .string("Example 4-speed")]),
                       "Canada · available by inference · Example 4-speed")
        XCTAssertEqual(ItemText.availabilityLine(["market": .string("US"), "available": .bool(true)]), "US · available")

        XCTAssertEqual(ItemText.examinedLine(["result": .string("transmission on tag: not_example_code"), "observed_at": .string("2026-01-02T00:00:00Z")]),
                       "Examined: transmission on tag: not example code · Jan 2, 2026")
    }

    func testSourceLinesSayWhatTheSourceSaid() throws {
        let items = try decode(LossyList<FacetItem>.self, transmissionItems).items
        let changed = try XCTUnwrap(items.first { $0.key == "transmission.derived.changed" })
        XCTAssertEqual(changed.sources.map { ItemText.said($0) }, ["not original unit", "not the original engine"])
        let casting = try XCTUnwrap(items.first { $0.key == "transmission.current.case_casting" })
        let source = try XCTUnwrap(casting.sources.first)
        XCTAssertEqual(ItemText.sourceName(source), "photo reading")
        XCTAssertEqual(ItemText.day(source.observed_at), "Feb 3, 2026")
        XCTAssertEqual(ItemText.decodedLine(source), "excluded models: Model Z · transmission speeds: 4 · vin derivative present: No")
        XCTAssertEqual(ItemText.sourceName(FacetItemSource(slug: "example_chart")), "example_chart")
        XCTAssertEqual(ItemText.sourceName(FacetItemSource(label: "", kind: "registry")), "registry")
        XCTAssertEqual(ItemText.sourceName(FacetItemSource()), "source")
        // The witness thumb goes through the render endpoint, never the original.
        let thumb = try XCTUnwrap(NukeImage.thumb(source.witness?.thumb, width: 120)?.absoluteString)
        XCTAssertTrue(thumb.contains("/storage/v1/render/image/public/vehicle-photos/synthetic/t.HEIC?width=120"), thumb)
    }

    func testItemsGroupInRunsByFacetInTheReadersOrder() throws {
        let read = try decode(ProfileRead.self, readJSON)
        let groups = ItemText.groups(read.masthead!.tokenItems["transmission"])
        XCTAssertEqual(groups.map(\.facet), ["as_built", "current", "decode", "current", "derived"])
        XCTAssertEqual(groups.map { ItemText.facetTitle($0.facet) }, ["As built", "Current", "Decoded", "Current", "Derived"])
        XCTAssertEqual(groups.map(\.items.count), [1, 1, 1, 1, 2])
    }

    func testNoSnakeCaseReachesTheWords() throws {
        let read = try decode(ProfileRead.self, readJSON)
        var lines: [String] = []
        for item in read.masthead!.tokenItems["transmission"] {
            lines.append(ItemText.itemLabel(item))
            lines.append(ItemText.facetTitle(item.facet))
            if let v = ItemText.valueText(item.value, unit: item.unit) { lines.append(v) }
            for s in item.sources + item.sides.flatMap(\.sources) {
                if let said = ItemText.said(s) { lines.append(said) }
                if let d = ItemText.decodedLine(s) { lines.append(d) }
            }
            lines += item.candidates.map(ItemText.candidateLine)
            lines += item.availability.map(ItemText.availabilityLine)
            lines += item.examined.map(ItemText.examinedLine)
            if let r = item.rule { lines.append(ItemText.ruleText(r)) }
            if let e = ItemText.equationLine(item.equation) { lines.append(e) }
        }
        for line in lines {
            XCTAssertNil(line.range(of: #"[a-z0-9]_[a-z0-9]"#, options: .regularExpression), line)
            XCTAssertFalse(line.contains("{") || line.contains("}"), line)
        }
        XCTAssertTrue(lines.contains("Computed: mph * top gear ratio * axle ratio * 63360 / (60 * π * tire diameter in), mph = 60"))
        XCTAssertTrue(lines.contains("2,450 rpm"))
    }

    // MARK: - Header entry points

    func testEveryCarriedTokenHasAnEntryPoint() throws {
        let read = try decode(ProfileRead.self, readJSON)
        // Transmission is a strip row and drivetrain a gap; the rest become identity rows.
        XCTAssertEqual(ProfileHeaderBlock.identityTokens(read: read), ["year", "make", "trim"])
        XCTAssertEqual(ProfileHeaderBlock.identityValue("year", read: read).value, "1970")
        // No lead: the first established item, never the claim.
        XCTAssertEqual(ProfileHeaderBlock.identityValue("trim", read: read).value, "Base")
        XCTAssertEqual(ProfileHeaderBlock.identityValue("model", read: read).value, "Examplemodel")
        XCTAssertEqual(ProfileHeaderBlock.tokenDimension(for: "series"), "trim")
        XCTAssertEqual(ProfileHeaderBlock.tokenDimension(for: "engine_type"), "engine")
        XCTAssertEqual(ProfileHeaderBlock.tokenDimension(for: "location"), "location")
        XCTAssertEqual(ItemText.rootStatus("conflict"), .conflicting)
        XCTAssertEqual(ItemText.rootStatus("missing"), .pending)
        XCTAssertEqual(ItemText.rootStatus("established"), .attributed)
    }

    func testLocationItemsDecodeAndReadAsAreas() throws {
        let json = """
        [{"key":"location.current.area","facet":"current","status":"reading","unit":null,"rule":null,"equation":null,"needed":null,
          "value":{"label":"Example City, NV","level":"city","county_fips":"32999"},
          "sources":[{"kind":"image","label":"photo GPS","observed_at":"2026-03-04T00:00:00Z","photos":12,"days":3}]},
         {"key":"location.sources.photo_gps","facet":"current","status":"reading","unit":null,"rule":null,"equation":null,"needed":null,"sources":[],
          "value":{"photos":12,"days":3,"areas":[{"label":"Example City, NV","photos":12,"days":3,
            "first_taken_at":"2026-01-01T00:00:00Z","last_taken_at":"2026-03-04T00:00:00Z","centroid":{"lat":36.1,"lng":-115.1}}]}},
         {"key":"location.sources.observations","facet":"current","status":"reading","sources":[],
          "value":{"observations":1,"first_at":"2026-01-01T00:00:00Z","last_at":"2026-01-01T00:00:00Z"}}]
        """
        let items = try decode(LossyList<FacetItem>.self, json).items
        XCTAssertEqual(items.map { ItemText.valueText($0.value) }, [
            "Example City, NV",
            "Example City, NV · 12 photos · 3 days · Jan 1, 2026 to Mar 4, 2026",
            "1 observation, Jan 1, 2026 to Jan 1, 2026",
        ])
    }
}

// A strip gap carries the reader's lead item (#3500): the header shows it in place of the dash, the gap stays a gap.
final class StripGapLeadTests: XCTestCase {
    private func gap(_ json: String) throws -> ProfileSection.Gap {
        try JSONDecoder().decode(ProfileSection.Gap.self, from: Data(json.utf8))
    }

    func testLeadReadingShowsValueAndStatus() throws {
        let g = try gap(#"{"dimension":"drivetrain","label":"Drivetrain","lead":{"key":"drivetrain.current.layout","value":"RWD","status":"reading"}}"#)
        XCTAssertEqual(g.leadText, "RWD · reading")
        XCTAssertEqual(ItemText.rootStatus(g.lead?.status ?? ""), .attributed)
    }

    func testEstablishedLeadShowsValueAlone() throws {
        let g = try gap(#"{"dimension":"engine","label":"Engine","lead":{"key":"engine.current.cid","value":455,"status":"established"}}"#)
        XCTAssertEqual(g.leadText, "455")
    }

    func testNoOrMalformedLeadKeepsTheGap() throws {
        XCTAssertNil(try gap(#"{"dimension":"drivetrain","label":"Drivetrain"}"#).leadText)
        let bad = try gap(#"{"dimension":"drivetrain","label":"Drivetrain","lead":"RWD"}"#)
        XCTAssertNil(bad.lead)
        XCTAssertNil(try gap(#"{"dimension":"drivetrain","label":"Drivetrain","lead":{"key":"k","value":null,"status":"reading"}}"#).leadText)
    }
}
