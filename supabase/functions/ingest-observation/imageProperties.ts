/** Property admission only. Source lineage, clocks and replay belong to the writer. */
export const IMAGE_PROPERTY_VALUES = {
  image_visible_rust_severity: ["none", "surface", "pitting", "perforation"],
  image_visible_paint_stage: ["bare_metal", "primer", "sealer", "base", "clear", "aged"],
  image_visible_assembly_state: ["stripped", "partial", "assembled"],
} as const;

export interface ObservationPropertyInput {
  property_key?: unknown;
  kind?: unknown;
  vehicle_id?: unknown;
  agent_inferred?: unknown;
  structured_data?: unknown;
}

export interface ObservationPropertyRegistryRow {
  id: string;
  applies_to_kinds: string[] | null;
  namespace: string;
  deprecated_at: string | null;
}

export type ObservationPropertyValidation =
  | { ok: true; propertyId: string | null }
  | { ok: false; status: 400; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function invalid(error: string): ObservationPropertyValidation {
  return { ok: false, status: 400, error };
}

/** Call before registry lookup so this increment cannot admit unrelated keys. */
export function isSupportedImagePropertyKey(value: unknown): value is keyof typeof IMAGE_PROPERTY_VALUES {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(IMAGE_PROPERTY_VALUES, value);
}

/**
 * The caller looks up the exact property_key and handles lookup failures as 503.
 * Unregistered/pending/deprecated keys fail closed. Values are never inferred or
 * defaulted here; the three image properties describe only what that image shows.
 */
export function validateObservationProperty(
  input: ObservationPropertyInput,
  property: ObservationPropertyRegistryRow | null,
): ObservationPropertyValidation {
  if (input.property_key === undefined) return { ok: true, propertyId: null };
  if (typeof input.property_key !== "string" || !input.property_key.trim()) {
    return invalid("property_key must be a nonempty string");
  }
  if (!isSupportedImagePropertyKey(input.property_key)) {
    return invalid("Unsupported property_key; only registered image properties are supported");
  }
  if (!property || property.namespace !== "core" || property.deprecated_at != null) {
    return invalid("Unknown, pending or deprecated property_key");
  }
  if (typeof input.kind !== "string" ||
    !Array.isArray(property.applies_to_kinds) || !property.applies_to_kinds.includes(input.kind)) {
    return invalid("property_key does not support this observation kind");
  }
  const data = input.structured_data;
  if (!data || typeof data !== "object" || Array.isArray(data) ||
    !Object.prototype.hasOwnProperty.call(data, input.property_key)) {
    return invalid("structured_data must contain the property_key value");
  }
  const fields = data as Record<string, unknown>;
  const value = fields[input.property_key];
  if (value === undefined || value === null) {
    return invalid("Unknown property values must be omitted, not defaulted");
  }
  if (Object.prototype.hasOwnProperty.call(IMAGE_PROPERTY_VALUES, input.property_key)) {
    if (input.kind !== "condition" || input.agent_inferred !== true) {
      return invalid("Image properties require condition observations with agent_inferred=true");
    }
    if (typeof fields.image_id !== "string" || !UUID.test(fields.image_id)) {
      return invalid("Image properties require a canonical image_id UUID");
    }
    const allowed: readonly string[] = IMAGE_PROPERTY_VALUES[
      input.property_key as keyof typeof IMAGE_PROPERTY_VALUES
    ];
    if (typeof value !== "string" || !allowed.includes(value)) {
      return invalid("Invalid image property value; unknown values must be omitted");
    }
  }
  return { ok: true, propertyId: property.id };
}
