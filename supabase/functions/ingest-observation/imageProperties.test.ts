import {
  IMAGE_PROPERTY_VALUES,
  isSupportedImagePropertyKey,
  type ObservationPropertyInput,
  type ObservationPropertyRegistryRow,
  validateObservationProperty,
} from "./imageProperties.ts";

const registry: ObservationPropertyRegistryRow = {
  id: "11111111-1111-4111-8111-111111111111",
  namespace: "core",
  deprecated_at: null,
  applies_to_kinds: ["condition"],
};
const imageId = "22222222-2222-4222-8222-222222222222";
function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function input(key = "image_visible_rust_severity", value: unknown = "surface"): ObservationPropertyInput {
  return {
    property_key: key,
    kind: "condition",
    agent_inferred: true,
    structured_data: { image_id: imageId, [key]: value },
  };
}
function rejected(value: ObservationPropertyInput, row = registry) {
  const result = validateObservationProperty(value, row);
  assert(!result.ok && result.status === 400, "Expected an admission failure");
}

Deno.test("unkeyed legacy observations remain accepted without inventing a property", () => {
  const result = validateObservationProperty({ kind: "media" }, null);
  assert(result.ok && result.propertyId === null, "Missing key must remain unkeyed");
});

Deno.test("all explicit image enum values bind the supplied registry identity", () => {
  for (const [key, values] of Object.entries(IMAGE_PROPERTY_VALUES)) {
    for (const value of values) {
      const result = validateObservationProperty(input(key, value), registry);
      assert(result.ok && result.propertyId === registry.id, `${key}:${value} should pass`);
    }
  }
});

Deno.test("unknown image values and wrong scalar types never turn into defaults", () => {
  for (const value of ["unknown", "", "frame_corrosion", "repainted", null, undefined, 0, false, {}, []]) {
    const candidate = input();
    (candidate.structured_data as Record<string, unknown>).image_visible_rust_severity = value;
    rejected(candidate);
  }
  rejected(input("image_visible_paint_stage", "surface"));
  rejected(input("image_visible_assembly_state", "clear"));
});

Deno.test("image claims require explicit inferred qualification and correct kind", () => {
  for (const agent_inferred of [undefined, false, "true", 1]) rejected({ ...input(), agent_inferred });
  rejected({ ...input(), kind: "specification" }, { ...registry, applies_to_kinds: ["specification"] });
});

Deno.test("image references are UUIDs rather than filenames, URLs or objects", () => {
  for (const image_id of [undefined, null, "", "photo.jpg", "https://example.test/a.jpg", {}, 42]) {
    rejected({ ...input(), structured_data: { image_id, image_visible_rust_severity: "surface" } });
  }
});

Deno.test("registry absence, pending keys, deprecation and incompatible kinds fail closed", () => {
  assert(!validateObservationProperty(input(), null).ok, "Unknown property must fail");
  rejected(input(), { ...registry, namespace: "pending" });
  rejected(input(), { ...registry, deprecated_at: "2026-01-01T00:00:00Z" });
  rejected(input(), { ...registry, applies_to_kinds: null });
  rejected(input(), { ...registry, applies_to_kinds: ["media"] });
});

Deno.test("malformed property inputs and inherited values fail admission", () => {
  for (const property_key of [null, "", " ", 17, {}, []]) rejected({ ...input(), property_key });
  for (const structured_data of [null, "value", [], {}, { another_key: 3 }]) {
    rejected({ ...input(), structured_data });
  }
  rejected({ ...input(), structured_data: Object.create({ image_visible_rust_severity: "surface", image_id: imageId }) });
});

Deno.test("unrelated properties are rejected before registry binding even for valid generic values", () => {
  for (const value of [false, 0, "recorded", { recorded: "object" }]) {
    const result = validateObservationProperty({
      property_key: "generic", kind: "condition", structured_data: { generic: value },
    }, null);
    assert(!result.ok && result.error.startsWith("Unsupported property_key"), "Unsupported key must fail before registry lookup");
  }
  assert(!isSupportedImagePropertyKey("condition_grade"), "Unrelated registered properties remain unsupported");
  assert(!isSupportedImagePropertyKey({ key: "image_visible_rust_severity" }), "Typed objects are not keys");
  assert(isSupportedImagePropertyKey("image_visible_rust_severity"), "Expected explicit image key");
});
