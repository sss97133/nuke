import { RETAINED_POWERTRAIN_FIELDS, retainedPowertrainValue } from "./retainedPowertrain.ts";
import { observationClockMicroseconds } from "../_shared/observationContentHash.ts";
import { DESCRIPTION_POWERTRAIN_VERSION, retainedDescriptionCaptureQualified, retainedDescriptionWitness } from "./retainedDescriptionPowertrain.ts";
import { RETAINED_ODOMETER_VERSION, retainedOdometerWitness } from "./retainedOdometer.ts";
import { RETAINED_IDENTITY_KEYS, RETAINED_IDENTITY_LABEL_VERSION, retainedListingIdentityValue } from "./retainedListingIdentity.ts";
import { RETAINED_PRESENTATION_VERSION, descriptionPresentationWitness } from "./retainedDescriptionPresentation.ts";
import { deriveRetainedCraigslistOdometer } from "./retainedCraigslistOdometer.ts";
import { deriveRetainedCraigslistYear } from "./retainedCraigslistYear.ts";

export const RETAINED_INTERIOR_MODE = "retained_listing_interior_color_v1";
export const RETAINED_EXTERIOR_MODE = "retained_listing_exterior_color_v1";
export const RETAINED_INTERIOR_METHOD = "retained_listing_property_projection_v1";
export const RETAINED_PROPERTY_KEYS = ["interior_color", "exterior_color", ...Object.keys(RETAINED_POWERTRAIN_FIELDS), "mileage_miles", ...RETAINED_IDENTITY_KEYS];
export const RETAINED_PROPERTY_MODES = RETAINED_PROPERTY_KEYS.map(key => `retained_listing_${key}_v1`);
const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

/** A selector is not testimony. The server derives every output field from a pinned row. */
export function retainedInteriorSelector(input: Record<string, unknown>): string | null {
  return Object.keys(input).every(key => ["mode", "source_observation_id"].includes(key)) &&
    (typeof input.mode === "string" && RETAINED_PROPERTY_MODES.includes(input.mode)) && typeof input.source_observation_id === "string" &&
    UUID.test(input.source_observation_id) ? input.source_observation_id : null;
}

export function deriveRetainedInterior(source: Record<string, any>, vehicle: Record<string, any> | null,
  registeredSource: Record<string, any> | null, mode: string = RETAINED_INTERIOR_MODE) {
  if (!RETAINED_PROPERTY_MODES.includes(mode)) return null;
  const exterior = mode === RETAINED_EXTERIOR_MODE;
  const propertyKey = mode.slice("retained_listing_".length, -3);
  const powertrain = propertyKey in RETAINED_POWERTRAIN_FIELDS;
  const odometer = propertyKey === "mileage_miles";
  if(odometer && registeredSource?.slug==="craigslist")return deriveRetainedCraigslistOdometer(source,vehicle,registeredSource);
  if(propertyKey==="year" && registeredSource?.slug==="craigslist")return deriveRetainedCraigslistYear(source,vehicle,registeredSource);
  const identity = RETAINED_IDENTITY_KEYS.includes(propertyKey);
  const presentation = ["interior_color","exterior_color","drivetrain_layout"].includes(propertyKey);
  const description = source?.extraction_method === "html_description_capture";
  if (odometer && !description) return null;
  if (identity && description) return null;
  const reading = description && odometer && retainedDescriptionCaptureQualified(source) ? retainedOdometerWitness(source.content_text) : null;
  const witness = description ? odometer ? reading : presentation && retainedDescriptionCaptureQualified(source) ? descriptionPresentationWitness(propertyKey,source.content_text) : retainedDescriptionWitness(source, propertyKey) : null;
  const sourceField = description ? "content_text" : identity ? propertyKey : powertrain ? RETAINED_POWERTRAIN_FIELDS[propertyKey as keyof typeof RETAINED_POWERTRAIN_FIELDS] : exterior ? "color" : "interior_color";
  const rawValue = description ? witness?.source_value : source?.structured_data?.[sourceField];
  const value = description ? witness?.value : identity ? retainedListingIdentityValue(propertyKey, rawValue) : powertrain ? retainedPowertrainValue(propertyKey, rawValue) : rawValue;
  let url: URL;
  try { url = new URL(source?.source_url); } catch { return null; }
  if (!UUID.test(source?.id ?? "") || !UUID.test(source?.vehicle_id ?? "") ||
      source.kind !== "listing" || source.is_superseded !== false ||
      (!description && source.extraction_method !== "html_match") || source.property_id != null ||
      source.subject_type !== "vehicle" || source.subject_id != null ||
      !vehicle || vehicle.id !== source.vehicle_id || vehicle.is_public !== true ||
      vehicle.deleted_at != null || vehicle.listing_kind === "non_vehicle_item" ||
      !registeredSource || registeredSource.id !== source.source_id || registeredSource.slug !== "bat" ||
      url.protocol !== "https:" || url.hostname !== "bringatrailer.com" ||
      !/^\/listing\/[^/]+\/?$/.test(url.pathname) || url.search || url.hash || url.username || url.password ||
      observationClockMicroseconds(source.ingested_at) === null ||
      (source.observed_at !== null && observationClockMicroseconds(source.observed_at) === null) ||
      (!identity && (typeof rawValue !== "string" || !rawValue.trim() || rawValue.length > 500 || /^(unknown|n\/a|unspecified)$/i.test(rawValue.trim()))) || value == null ||
      !Number.isFinite(source.confidence_score) || source.confidence_score < 0.6 || source.confidence_score > 1) return null;
  return {
    source_slug: "bat", kind: odometer ? "condition" : "specification", vehicle_id: source.vehicle_id,
    property_key: propertyKey, source_url: source.source_url,
    source_identifier: `${mode}:${source.id}`,
    observed_at: source.ingested_at, extraction_method: RETAINED_INTERIOR_METHOD,
    raw_source_ref: `vehicle_observations:${source.id}`,
    content_text: identity ? "Retained extractor vehicle identity label. This is an unverified extractor label, not a physical identity resolution; original per-field parsing versus heuristics and event time are unknown." : odometer ? `Retained odometer display claim: ${rawValue}\nTrue mileage and reading event time are unknown. Approximate source counts remain approximate; kilometer displays normalize to the nearest mile.` : description ? `Retained listing description claim: ${rawValue}\nNo independent corroboration or factory/current verification; source event time is unknown.` : powertrain ? "Retained extractor powertrain claim, deterministically normalized from the original listing observation. Original per-field parsing versus description heuristics is unknown. No independent corroboration or factory/current verification; source event time is unknown." : exterior ? "Retained extractor exterior-color claim from the original listing observation. Per-field parsing versus description heuristics is not retained; this is not established verbatim seller text. No independent corroboration or verification of factory configuration, current condition or originality; source event time is unknown." : "Retained listing claim, projected from the original observation. No independent corroboration or verification of factory configuration, current condition, material or originality; source event time is unknown.",
    agent_inferred: true, defer_analysis: true, agent_cost_cents: 0,
    structured_data: {
      [propertyKey]: value, source_observation_id: source.id,
      ...(identity ? { source_value: rawValue, normalization_version: RETAINED_IDENTITY_LABEL_VERSION,
        identity_role: "extractor_vehicle_label", identity_resolution_status: "unverified",
        source_event_time_status: "unknown" } : {}),
      ...(propertyKey === "vin" ? { vin_identifier_namespace: "standard_17_character_vin_label",
        vin_format_status: "17_character_format", vin_checksum_status: "not_evaluated" } : {}),
      ...(powertrain ? { source_value: rawValue, normalization_version: "retained_powertrain_v1" } : {}),
      ...(reading ? { source_value: rawValue, normalization_version: "retained_odometer_miles_v1",
        source_reading_value: reading.source_reading_value, source_reading_unit: reading.source_reading_unit,
        reported_precision_miles: reading.reported_precision_miles, value_is_approximate: reading.value_is_approximate,
        reading_role: reading.reading_role, true_mileage_status: reading.true_mileage_status,
        source_observed_at_basis: "source_capture", source_event_time_status: "unknown" } : {}),
      ...(description && presentation && !powertrain ? { source_value:rawValue,normalization_version:"retained_color_text_v1" } : {}),
      ...(description && presentation ? { source_event_time_status:"unknown" } : {}),
      ...(description ? { source_witness_version: odometer ? RETAINED_ODOMETER_VERSION : presentation ? RETAINED_PRESENTATION_VERSION : DESCRIPTION_POWERTRAIN_VERSION,
        source_capture_sha256: source.structured_data.source_capture_sha256 } : {}),
      analysis_kind: "retained_listing_property_projection", projection_version: mode,
      property_key: propertyKey, source_field: sourceField, claim_role: "listing_claim",
      factory_configuration_status: "unknown", current_configuration_status: "unknown",
      independent_source: false,
      source_recorded_at: source.ingested_at, source_observed_at: source.observed_at,
      observed_at_basis: "source_testimony_recorded_at", source_extraction_method: source.extraction_method,
      source_confidence_score: source.confidence_score,
      limitation: identity ? "Exact retained extractor identity label. Original title/detail parsing versus heuristics is unknown. This claim does not resolve VIN, trim, generation, originality or physical identity and does not mutate the vehicle record. Capture/recording clocks do not establish the listing event date." : odometer ? "Publisher-described odometer display only; true accumulated mileage is unknown, including replacement, discrepancy or TMU cases. Source shorthand/approximation and original unit survive; kilometers normalize to the nearest integer mile. Conflicting/hypothetical readings are omitted. Capture/recording clocks do not establish the reading event date." : description ? "Verbatim explicit property assertion from retained description text; ambiguous, qualified or conflicting assertions are omitted. Source capture time is not an event date. Factory/current configuration remains unknown." : powertrain ? "Explicit retained text only; ambiguous or unqualified values are omitted. Displacement uses liters, cc/1000 or ci*0.016387064, rounded to six decimals. Per-field extraction provenance, factory/current configuration and source event time remain unverified." : exterior ? "Exact retained extractor exterior-color claim. Original extraction may use explicit exterior fields or deterministic description heuristics; per-field provenance is not retained. No new extraction or verification. Factory configuration, originality and current condition remain unknown; source event time is unverified." : "Exact retained listing specification; no new extraction or verification. Color text may include seller-described upholstery. Does not establish factory configuration, originality, current condition or material. Source event time is unverified.",
    } as Record<string, unknown> & { limitation: string; source_field: string; source_observation_id: string },
  };
}
