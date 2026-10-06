import { observationClockMicroseconds } from "../_shared/observationContentHash.ts";

export const RETAINED_INTERIOR_MODE = "retained_listing_interior_color_v1";
export const RETAINED_EXTERIOR_MODE = "retained_listing_exterior_color_v1";
export const RETAINED_INTERIOR_METHOD = "retained_listing_property_projection_v1";
const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

/** A selector is not testimony. The server derives every output field from a pinned row. */
export function retainedInteriorSelector(input: Record<string, unknown>): string | null {
  return Object.keys(input).every(key => ["mode", "source_observation_id"].includes(key)) &&
    (input.mode === RETAINED_INTERIOR_MODE || input.mode === RETAINED_EXTERIOR_MODE) && typeof input.source_observation_id === "string" &&
    UUID.test(input.source_observation_id) ? input.source_observation_id : null;
}

export function deriveRetainedInterior(source: Record<string, any>, vehicle: Record<string, any> | null,
  registeredSource: Record<string, any> | null, mode: string = RETAINED_INTERIOR_MODE) {
  if (mode !== RETAINED_INTERIOR_MODE && mode !== RETAINED_EXTERIOR_MODE) return null;
  const exterior = mode === RETAINED_EXTERIOR_MODE;
  const propertyKey = exterior ? "exterior_color" : "interior_color";
  const sourceField = exterior ? "color" : "interior_color";
  const value = source?.structured_data?.[sourceField];
  let url: URL;
  try { url = new URL(source?.source_url); } catch { return null; }
  if (!UUID.test(source?.id ?? "") || !UUID.test(source?.vehicle_id ?? "") ||
      source.kind !== "listing" || source.is_superseded !== false ||
      source.extraction_method !== "html_match" || source.property_id != null ||
      source.subject_type !== "vehicle" || source.subject_id != null ||
      !vehicle || vehicle.id !== source.vehicle_id || vehicle.is_public !== true ||
      vehicle.deleted_at != null || vehicle.listing_kind === "non_vehicle_item" ||
      !registeredSource || registeredSource.id !== source.source_id || registeredSource.slug !== "bat" ||
      url.protocol !== "https:" || url.hostname !== "bringatrailer.com" ||
      !/^\/listing\/[^/]+\/?$/.test(url.pathname) || url.search || url.hash || url.username || url.password ||
      observationClockMicroseconds(source.ingested_at) === null ||
      (source.observed_at !== null && observationClockMicroseconds(source.observed_at) === null) ||
      typeof value !== "string" || !value.trim() || value.length > 500 ||
      /^(unknown|n\/a|unspecified)$/i.test(value.trim()) ||
      !Number.isFinite(source.confidence_score) || source.confidence_score < 0.6 || source.confidence_score > 1) return null;
  return {
    source_slug: "bat", kind: "specification", vehicle_id: source.vehicle_id,
    property_key: propertyKey, source_url: source.source_url,
    source_identifier: `${mode}:${source.id}`,
    observed_at: source.ingested_at, extraction_method: RETAINED_INTERIOR_METHOD,
    raw_source_ref: `vehicle_observations:${source.id}`,
    content_text: exterior ? "Retained extractor exterior-color claim from the original listing observation. Per-field parsing versus description heuristics is not retained; this is not established verbatim seller text. No independent corroboration or verification of factory configuration, current condition or originality; source event time is unknown." : "Retained listing claim, projected from the original observation. No independent corroboration or verification of factory configuration, current condition, material or originality; source event time is unknown.",
    agent_inferred: true, defer_analysis: true, agent_cost_cents: 0,
    structured_data: {
      [propertyKey]: value, source_observation_id: source.id,
      analysis_kind: "retained_listing_property_projection", projection_version: mode,
      property_key: propertyKey, source_field: sourceField, claim_role: "listing_claim",
      factory_configuration_status: "unknown", current_configuration_status: "unknown",
      independent_source: false,
      source_recorded_at: source.ingested_at, source_observed_at: source.observed_at,
      observed_at_basis: "source_testimony_recorded_at", source_extraction_method: source.extraction_method,
      source_confidence_score: source.confidence_score,
      limitation: exterior ? "Exact retained extractor exterior-color claim. Original extraction may use explicit exterior fields or deterministic description heuristics; per-field provenance is not retained. No new extraction or verification. Factory configuration, originality and current condition remain unknown; source event time is unverified." : "Exact retained listing specification; no new extraction or verification. Color text may include seller-described upholstery. Does not establish factory configuration, originality, current condition or material. Source event time is unverified.",
    },
  };
}
