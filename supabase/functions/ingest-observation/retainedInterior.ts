import { RETAINED_POWERTRAIN_FIELDS, retainedPowertrainValue } from "./retainedPowertrain.ts";
import { observationClockMicroseconds } from "../_shared/observationContentHash.ts";
import { DESCRIPTION_POWERTRAIN_VERSION, retainedDescriptionWitness } from "./retainedDescriptionPowertrain.ts";

export const RETAINED_INTERIOR_MODE = "retained_listing_interior_color_v1";
export const RETAINED_EXTERIOR_MODE = "retained_listing_exterior_color_v1";
export const RETAINED_INTERIOR_METHOD = "retained_listing_property_projection_v1";
export const RETAINED_PROPERTY_KEYS = ["interior_color", "exterior_color", ...Object.keys(RETAINED_POWERTRAIN_FIELDS)];
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
  const description = source?.extraction_method === "html_description_capture";
  const witness = description ? retainedDescriptionWitness(source, propertyKey) : null;
  const sourceField = description ? "content_text" : powertrain ? RETAINED_POWERTRAIN_FIELDS[propertyKey as keyof typeof RETAINED_POWERTRAIN_FIELDS] : exterior ? "color" : "interior_color";
  const rawValue = description ? witness?.source_value : source?.structured_data?.[sourceField];
  const value = description ? witness?.value : powertrain ? retainedPowertrainValue(propertyKey, rawValue) : rawValue;
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
      typeof rawValue !== "string" || !rawValue.trim() || rawValue.length > 500 || value == null ||
      /^(unknown|n\/a|unspecified)$/i.test(rawValue.trim()) ||
      !Number.isFinite(source.confidence_score) || source.confidence_score < 0.6 || source.confidence_score > 1) return null;
  return {
    source_slug: "bat", kind: "specification", vehicle_id: source.vehicle_id,
    property_key: propertyKey, source_url: source.source_url,
    source_identifier: `${mode}:${source.id}`,
    observed_at: source.ingested_at, extraction_method: RETAINED_INTERIOR_METHOD,
    raw_source_ref: `vehicle_observations:${source.id}`,
    content_text: description ? `Retained listing description claim: ${rawValue}\nNo independent corroboration or factory/current verification; source event time is unknown.` : powertrain ? "Retained extractor powertrain claim, deterministically normalized from the original listing observation. Original per-field parsing versus description heuristics is unknown. No independent corroboration or factory/current verification; source event time is unknown." : exterior ? "Retained extractor exterior-color claim from the original listing observation. Per-field parsing versus description heuristics is not retained; this is not established verbatim seller text. No independent corroboration or verification of factory configuration, current condition or originality; source event time is unknown." : "Retained listing claim, projected from the original observation. No independent corroboration or verification of factory configuration, current condition, material or originality; source event time is unknown.",
    agent_inferred: true, defer_analysis: true, agent_cost_cents: 0,
    structured_data: {
      [propertyKey]: value, source_observation_id: source.id,
      ...(powertrain ? { source_value: rawValue, normalization_version: "retained_powertrain_v1" } : {}),
      ...(description ? { source_witness_version: DESCRIPTION_POWERTRAIN_VERSION,
        source_capture_sha256: source.structured_data.source_capture_sha256 } : {}),
      analysis_kind: "retained_listing_property_projection", projection_version: mode,
      property_key: propertyKey, source_field: sourceField, claim_role: "listing_claim",
      factory_configuration_status: "unknown", current_configuration_status: "unknown",
      independent_source: false,
      source_recorded_at: source.ingested_at, source_observed_at: source.observed_at,
      observed_at_basis: "source_testimony_recorded_at", source_extraction_method: source.extraction_method,
      source_confidence_score: source.confidence_score,
      limitation: description ? "Verbatim explicit powertrain assertion from retained description text; ambiguous, qualified or conflicting assertions are omitted. Source capture time is not an event date. Factory/current configuration remains unknown." : powertrain ? "Explicit retained text only; ambiguous or unqualified values are omitted. Displacement uses liters, cc/1000 or ci*0.016387064, rounded to six decimals. Per-field extraction provenance, factory/current configuration and source event time remain unverified." : exterior ? "Exact retained extractor exterior-color claim. Original extraction may use explicit exterior fields or deterministic description heuristics; per-field provenance is not retained. No new extraction or verification. Factory configuration, originality and current condition remain unknown; source event time is unverified." : "Exact retained listing specification; no new extraction or verification. Color text may include seller-described upholstery. Does not establish factory configuration, originality, current condition or material. Source event time is unverified.",
    } as Record<string, unknown> & { limitation: string; source_field: string; source_observation_id: string },
  };
}
