import { isPhysicalReadingKey, isSupportedImagePropertyKey, validateObservationProperty, type ObservationPropertyRegistryRow } from "./imageProperties.ts";

function assertEquals(actual: unknown, expected: unknown, message: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
const registry: ObservationPropertyRegistryRow = {
  id: "11111111-1111-4111-8111-111111111111", namespace: "core", deprecated_at: null, applies_to_kinds: ["specification"],
};
const imageId = "22222222-2222-4222-8222-222222222222";
const reading = (key: string, value: unknown, extra: Record<string, unknown> = {}) => ({
  property_key: key, kind: "specification", agent_inferred: true,
  structured_data: { image_id: imageId, source_family: `image:${imageId}`, visual_relation: "direct_code", [key]: value, ...extra },
});
const ok = (input: Record<string, unknown>, row: ObservationPropertyRegistryRow | null = registry) =>
  validateObservationProperty(input, row).ok;

Deno.test("a stamped or cast marking is admitted as read, with its photo as witness", () => {
  assertEquals(ok(reading("transmission_id_stamp", "P0118")), true, "Muncie ID stamp");
  assertEquals(ok(reading("transmission_case_casting", "3851325")), true, "case casting");
  assertEquals(ok(reading("shifter_bracket_marking", "1950163-04", { visual_relation: "direct_transcription" })), true, "bracket");
  assertEquals(ok(reading("body_tag_style", "2FS87")), true, "body tag style");
  assertEquals(ok(reading("body_tag_build_date", "07C")), true, "build date code");
  assertEquals(ok(reading("engine_code_stamp", "YH")), true, "engine code stamp");
});

Deno.test("body tag paint and option codes keep the tag's shape", () => {
  assertEquals(ok(reading("body_tag_paint_code", { lower: "75", upper: "75" })), true, "two-tone slots");
  assertEquals(ok(reading("body_tag_paint_code", { lower: "75", upper: "75", top: "V" })), true, "top code");
  assertEquals(ok(reading("body_tag_paint_code", { lower: "75", name: "Buccaneer Red" })), false, "a color name is a decode");
  assertEquals(ok(reading("body_tag_paint_code", "75")), false, "slots, not a bare string");
  assertEquals(ok(reading("body_tag_option_codes", [])), true, "blank option lines are a reading");
  assertEquals(ok(reading("body_tag_option_codes", ["W66", "WS4"])), true, "codes");
  assertEquals(ok(reading("body_tag_option_codes", ["W66", "W66"])), false, "duplicates");
});

Deno.test("a reading never carries its decode, and never stands without its image", () => {
  assertEquals(ok(reading("transmission_case_casting", "Muncie M20 or M21 (1964-65 case)")), false, "a decode is not a marking");
  assertEquals(ok(reading("transmission_id_stamp", "p0118")), false, "as read, in capitals");
  assertEquals(ok(reading("transmission_id_stamp", "P0118", { image_id: "IMG_4882.HEIC" })), false, "image id must be a UUID");
  assertEquals(ok(reading("transmission_id_stamp", "P0118", { source_family: "listing:bat" })), false, "its own image family");
  assertEquals(ok(reading("transmission_id_stamp", "P0118", { visual_relation: "inferred" })), false, "direct reading only");
  assertEquals(ok({ ...reading("transmission_id_stamp", "P0118"), agent_inferred: false }), false, "agent-inferred");
  assertEquals(ok({ ...reading("transmission_id_stamp", "P0118"), kind: "condition" }), false, "kind");
  assertEquals(ok(reading("transmission_id_stamp", "P0118"), null), false, "an unregistered key fails closed");
  assertEquals(ok(reading("transmission_id_stamp", "P0118"), { ...registry, deprecated_at: "2026-11-12T00:00:00Z" }), false, "deprecated");
});

Deno.test("the faceted keys and the cached batch path are not opened by this list", () => {
  assertEquals(isPhysicalReadingKey("transmission_model"), false, "as built vs current needs a facet");
  assertEquals(isPhysicalReadingKey("rear_axle_ratio"), false, "as built vs current needs a facet");
  assertEquals(isSupportedImagePropertyKey("transmission_id_stamp"), false, "the batch path admits only enum keys");
  assertEquals(ok(reading("transmission_model", "M20")), false, "unsupported key");
});
