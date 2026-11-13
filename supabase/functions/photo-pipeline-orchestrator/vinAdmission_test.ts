import { applyV2, classificationFromParsed, SCHEMA_MANIFEST } from "./classifierProvider.ts";
import { qualifyVinRead, vinCitation, type VinAdmissionContext } from "./vinAdmission.ts";

function assert(value: unknown, message = "assertion failed"): asserts value { if (!value) throw new Error(message); }
const literal = "2S87D3N000001";
const parsed = (vin = literal, role = "vehicle_vin_plate") => ({
  image_type: "vin_plate", image_medium: "photograph", confidence: .97, is_automotive: true,
  description: "The vehicle identification plate", is_document: false,
  vin: { value: vin, confidence: .96, evidence: `Physical dash plate reads ${vin}`, evidence_role: role },
});
const classify = (raw = parsed()) => classificationFromParsed(raw, SCHEMA_MANIFEST, true,
  { model: "reader:test", attempts: 1, token_count_attempts: 0, timing_ms: { image_download: 0, token_count: 0, generation: 0, total: 0 } });
const context: VinAdmissionContext = { vehicleId: "v", sourceVehicleId: "v", year: 1973, vin: literal,
  rule: { rule_id: 23, rule_status: "in_range", series: "GM 13-char 1972-80", model_year_from: 1972, model_year_to: 1980 } };

Deno.test("preserves the exact 13-character plate without padding, modern checksum or auto-filing token", () => {
  assert(literal.length === 13);
  const c = classify();
  assert(c.v2?.vin?.value === literal && c.v2.vin.checksum_ok === null);
  assert(c.vin_detected === undefined, "short identifier never enters the VIN auto-filing strategy");
  const admitted = qualifyVinRead(c, context);
  assert(admitted.admitted && admitted.kind === "vin", "reuse the existing Pontiac VIN namespace");
  const citation = vinCitation(admitted);
  assert(citation.checksum_ok === null && citation.checksum_status === "not_applicable_pre1981");
  assert(citation.model_year_context === 1973 && citation.identifier_rule_id === 23);
});

Deno.test("a short identifier needs actual format/year context, not merely a plausible length", () => {
  for (const [overrides, reason] of [
    [{ year: null }, "vehicle_year_unknown"], [{ year: 1981 }, "vehicle_year_not_pre1981"],
    [{ sourceVehicleId: null }, "image_vehicle_changed"], [{ sourceVehicleId: "other" }, "image_vehicle_changed"],
    [{ vin: "2S87D3N000002" }, "stored_identifier_conflict"], [{ rule: null }, "pre1981_vin_rule_unavailable"],
    [{ rule: { ...context.rule!, rule_status: "no_rule" } }, "pre1981_vin_rule_unavailable"],
    [{ rule: { ...context.rule!, model_year_from: 1965, model_year_to: 1971 } }, "identifier_rule_year_mismatch"],
  ] as const) {
    const result = qualifyVinRead(classify(), { ...context, ...overrides });
    assert(!result.admitted && result.reason === reason, JSON.stringify(result));
  }
  assert(qualifyVinRead(classify(), { ...context, vin: null }).admitted, "an empty canonical value can still acquire sourced evidence");
});

Deno.test("registered year layouts check the actual digit, including an agreeing but wrong-year canonical VIN", () => {
  for (const vin of [null, "2S87D4N000001"]) {
    const result = qualifyVinRead(classify(parsed("2S87D4N000001")), { ...context, vin });
    assert(!result.admitted && result.reason === "identifier_model_year_mismatch");
  }
  const unsupported = qualifyVinRead(classify(), { ...context, rule: { ...context.rule!, series: "Unknown layout" } });
  assert(!unsupported.admitted && unsupported.reason === "identifier_year_layout_unsupported");
  // These are the other existing registered VIN layouts, not inferred formats.
  for (const [value, year, series, from, to] of [
    ["21234A000001", 1962, "Chevrolet 12-char 1960-64", 1960, 1964],
    ["7R01A000001", 1967, "Ford 11-char 1960-80", 1960, 1980],
    ["RM23H9A000001", 1969, "Mopar 13-char 1966-80", 1966, 1980],
  ] as const) {
    const result = qualifyVinRead(classify(parsed(value)), { ...context, year, vin: null,
      rule: { rule_id: 1, rule_status: "in_range", series, model_year_from: from, model_year_to: to } });
    assert(result.admitted, `${series}: ${JSON.stringify(result)}`);
  }
});

Deno.test("body tags, engine/transmission serials, stickers and documents are not physical vehicle VIN evidence", () => {
  for (const role of ["body_tag", "engine_stamp", "transmission_stamp", "sticker", "document", "unknown"]) {
    const result = qualifyVinRead(classify(parsed(literal, role)), context);
    assert(!result.admitted && result.reason === "physical_vin_source_required", role);
  }
  const raw = parsed(); raw.image_medium = "screenshot";
  assert(!qualifyVinRead(classify(raw), context).admitted);
  const absentRole = parsed(); delete (absentRole.vin as any).evidence_role;
  assert(!qualifyVinRead(classify(absentRole), context).admitted);
});

Deno.test("a complete quote and high-confidence reading are required; classification preserves refused text", () => {
  for (const [overrides, reason] of [[{ confidence: .8 }, "identifier_confidence_low"],
    [{ evidence: "The plate might read a similar number" }, "full_literal_quote_required"]] as const) {
    const raw = parsed(); Object.assign(raw.vin, overrides);
    const c = classify(raw), result = qualifyVinRead(c, context);
    assert(!result.admitted && result.reason === reason);
    assert(c.v2?.vin?.value === literal, "refusal is not deletion of the source reading");
  }
});

Deno.test("modern 17-character checksum failures cannot fall through into the short-identifier path", () => {
  const good = classify(parsed("1HGCM82633A004352"));
  assert(qualifyVinRead(good).admitted && good.vin_detected === "1HGCM82633A004352");
  const bad = classify(parsed("1HGCM82633A004353"));
  assert(bad.v2?.vin?.checksum_ok === false && !qualifyVinRead(bad, context).admitted);
  bad.v2!.vin!.checksum_ok = null;
  const result = qualifyVinRead(bad, context);
  assert(!result.admitted && result.reason === "modern_checksum_failed");
  assert(applyV2({ vin: { value: "UNKNOWN", confidence: .99 } })?.vin === null);
});
