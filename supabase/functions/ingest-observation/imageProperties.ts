import { RETAINED_PROPERTY_KEYS } from "./retainedInterior.ts";
import { RETAINED_IDENTITY_KEYS, retainedListingIdentityValue } from "./retainedListingIdentity.ts";
import { DESCRIPTION_ENGINE_FAMILY_LABEL_VERSION, ENGINE_FAMILY_LABEL_VERSION } from "./retainedDescriptionPowertrain.ts";
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
  retainedPropertyVerified = false,
): ObservationPropertyValidation {
  if (input.property_key === undefined) return { ok: true, propertyId: null };
  if (typeof input.property_key !== "string" || !input.property_key.trim()) {
    return invalid("property_key must be a nonempty string");
  }
  if (!isSupportedImagePropertyKey(input.property_key) &&
      !(retainedPropertyVerified && RETAINED_PROPERTY_KEYS.includes(input.property_key))) {
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
  const craigslistYear=retainedPropertyVerified&&input.kind==="listing"&&input.property_key==="year"&&fields.source_profile==="craigslist_year_attribute_v1";
  if (RETAINED_IDENTITY_KEYS.includes(input.property_key) && ((!craigslistYear&&input.kind !== "specification") ||
      retainedListingIdentityValue(input.property_key, value) === null ||
      fields.identity_role !== "extractor_vehicle_label" || fields.identity_resolution_status !== "unverified" ||
      (craigslistYear&&(fields.year_label_basis!=="platform_year_attribute_or_title_row"||fields.normalization_version!=="retained_listing_year_attribute_v1")))) {
    return invalid("Retained identity properties require exact extractor labels with unverified identity resolution");
  }
  if (input.property_key === "vin" && (fields.vin_identifier_namespace !== "standard_17_character_vin_label" ||
      fields.vin_format_status !== "17_character_format" || fields.vin_checksum_status !== "not_evaluated")) {
    return invalid("Retained VIN labels require explicit namespace and unevaluated checksum");
  }
  if (value === undefined || value === null) {
    return invalid("Unknown property values must be omitted, not defaulted");
  }
  if (input.property_key === "engine_family_label" && (input.kind !== "specification" ||
      input.agent_inferred !== true || typeof value !== "string" ||
      value.length > 20 || !/^[A-Z0-9]+(?:-[A-Z0-9]+)?$/.test(value) || !/[A-Z]/.test(value) || !/[0-9]/.test(value) ||
      typeof fields.source_value !== "string" || !fields.source_value.trim() || new TextEncoder().encode(fields.source_value).length > 500 ||
      fields.normalization_version !== ENGINE_FAMILY_LABEL_VERSION ||
      fields.source_witness_version !== DESCRIPTION_ENGINE_FAMILY_LABEL_VERSION ||
      fields.source_field !== "content_text" || fields.label_role !== "publisher_powering_engine_label" ||
      fields.engine_identity_status !== "unverified" || fields.source_event_time_status !== "unknown" ||
      fields.factory_configuration_status !== "unknown" || fields.current_configuration_status !== "unknown" ||
      fields.independent_source !== false)) {
    return invalid("Retained engine family labels require a qualified publisher quote; engine identity remains unverified");
  }
  if (["interior_color", "exterior_color"].includes(input.property_key) &&
      (input.kind !== "specification" || typeof value !== "string" || !value.trim())) {
    return invalid("Retained interior color requires exact nonempty specification text");
  }
  const craigslistReading=retainedPropertyVerified&&input.kind==="listing"&&fields.source_profile==="craigslist_auto_miles_v1";
  if (input.property_key === "mileage_miles" && ((!craigslistReading&&input.kind !== "condition") ||
      typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value >= 10000000 ||
      fields.reading_role !== (craigslistReading?"listing_odometer_label":"odometer_display") || fields.true_mileage_status !== "unknown" ||
      (craigslistReading&&(fields.reading_unit_basis!=="platform_auto_miles_attribute"||fields.source_reading_unit!=="miles"||
       typeof fields.odometer_broken!=="boolean"||typeof fields.odometer_rolled_over!=="boolean")))) {
    return invalid("Retained mileage requires an attributed integer odometer display; true mileage remains unknown");
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
