import { isImageReadingKey, isSupportedImagePropertyKey, validateObservationProperty, type ObservationPropertyRegistryRow } from "./imageProperties.ts";

function assertEquals(actual: unknown, expected: unknown, message: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
const registry: ObservationPropertyRegistryRow = {
  id: "11111111-1111-4111-8111-111111111111", namespace: "core", deprecated_at: null, applies_to_kinds: ["specification"],
};
const imageId = "22222222-2222-4222-8222-222222222222";
const badge = (value: unknown, extra: Record<string, unknown> = {}) => ({
  property_key: "image_visible_badge_text", kind: "specification", agent_inferred: true,
  structured_data: { image_id: imageId, image_visible_badge_text: value, reading_role: "visible_badge_text",
    model_name: "gemini-2.5-flash", originality_status: "unknown", factory_configuration_status: "unknown", ...extra },
});
const spid = (value: unknown, extra: Record<string, unknown> = {}) => ({
  property_key: "image_spid_rpo_codes", kind: "specification", agent_inferred: true,
  structured_data: { image_id: imageId, image_spid_rpo_codes: value, reading_role: "spid_label_rpo_codes", vin_match_status: "not_evaluated",
    model_name: "gemini-2.5-flash", originality_status: "unknown", factory_configuration_status: "unknown", ...extra },
});
const ok = (input: Record<string, unknown>) => validateObservationProperty(input, registry).ok;

Deno.test("a badge reading is the printed text of one image, qualified as a reading", () => {
  assertEquals(ok(badge("SILVERADO")), true, "fender script");
  assertEquals(ok(badge("CHEYENNE SUPER 10")), true, "plate with series digits");
  assertEquals(ok(badge("silverado")), false, "lower-case means it was not transcribed as printed");
  assertEquals(ok(badge("SILVERADO", { image_id: "photo.jpg" })), false, "image id must be a UUID");
  assertEquals(ok(badge("SILVERADO", { originality_status: "original" })), false, "a reading cannot assert originality");
  assertEquals(ok({ ...badge("SILVERADO"), agent_inferred: false }), false, "a model reading is agent-inferred");
  assertEquals(ok({ ...badge("SILVERADO"), kind: "condition" }), false, "kind");
});

Deno.test("a SPID reading is a list of distinct RPO codes with the VIN match left open", () => {
  assertEquals(ok(spid(["Z84", "YE9", "LS9", "M40"])), true, "codes");
  assertEquals(ok(spid([])), false, "empty");
  assertEquals(ok(spid(["Z84", "Z84"])), false, "duplicates");
  assertEquals(ok(spid(["Z84", "SILVERADO"])), false, "not a code");
  assertEquals(ok(spid(["Z84"], { vin_match_status: "matched" })), false, "the intake does not evaluate a VIN match");
});

Deno.test("the cached batch path still admits only the enum image keys", () => {
  assertEquals(isSupportedImagePropertyKey("image_visible_badge_text"), false, "reading keys are not enum keys");
  assertEquals(isImageReadingKey("image_visible_badge_text"), true, "reading key");
  assertEquals(isImageReadingKey("image_visible_rust_severity"), false, "enum key");
});
