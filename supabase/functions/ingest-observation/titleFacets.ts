import { extractVehicleFacets } from "../_shared/vehicleFacets.ts";

/** A vehicle's record title read as a trim or body label: an unverified record label, never a vehicle mutation. */
export const TITLE_FACET_MODE = "vehicle_title_facets_v1";
export const TITLE_FACET_METHOD = "vehicle_title_facet_projection_v1";
export const TITLE_FACET_NORMALIZATION = "shared_vehicle_facets_literal_title_v1";
export const TITLE_FACET_KEYS = ["trim", "body_style"] as const;
export type TitleFacetKey = typeof TITLE_FACET_KEYS[number];
const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

// A title naming a copy, a part or a build describes something other than the factory badge it quotes.
const NOT_THE_CAR = /\b(?:replica|tribute|clone|recreation|re-creation|continuation|kit\s+car|kit|evocation|homage|style|styled|conversion|body\s+only|shell|chassis\s+only|engine|motor|transmission|parts?|project\s+parts|sign|model\s+car|diecast|die-cast|scale|pedal\s+car)\b/i;

// The shared parser also reports engine options as trim packages; an engine is not a trim.
const ENGINE_NOT_TRIM = /^(?:\d{3,4}(?:\s*\/\s*\d{3})?(?:\s*(?:ci|cid|hp|v-?8))?|L\d{2}|LS\d|LT-?\d|LT\d|(?:super\s+)?cobra\s+jet|hemi|426\s+hemi|fuel\s+injected|fuelie)$/i;

// Bed length and cab configuration are their own facets, not a body style.
const BED_OR_CAB_NOT_BODY = /^(?:short|long)[\s-]?(?:bed|box)$|^(?:crew|extended|regular|single|standard|super|club|king|extra|double|quad)[\s-]?cab$/i;

const fold = (text: string) => text.toLowerCase().replace(/[\s\-_/]+/g, " ").trim();

export function titleFacetSelector(input: Record<string, unknown>): { vehicleId: string; key: TitleFacetKey } | null {
  if (!Object.keys(input).every(k => ["mode", "vehicle_id", "property_key"].includes(k))) return null;
  if (input.mode !== TITLE_FACET_MODE || typeof input.vehicle_id !== "string" || !UUID.test(input.vehicle_id)) return null;
  if (!TITLE_FACET_KEYS.includes(input.property_key as TitleFacetKey)) return null;
  return { vehicleId: input.vehicle_id.toLowerCase(), key: input.property_key as TitleFacetKey };
}

/** The literal title label for one key, or null when the title does not itself carry it. */
export function titleFacetWitness(
  key: TitleFacetKey,
  title: unknown,
  identity: { year: number | null; make: string | null; model: string | null },
): string | null {
  if (typeof title !== "string") return null;
  const text = title.trim();
  if (text.length < 6 || text.length > 200 || /[\x00-\x1f\x7f]/.test(text) || NOT_THE_CAR.test(text)) return null;
  const facets = extractVehicleFacets({ year: identity.year, make: identity.make, model: identity.model, title: text });
  const value = key === "trim" ? facets.trim_package : facets.body_style_facet;
  if (!value || value.length > 60) return null;
  if (key === "trim" && ENGINE_NOT_TRIM.test(value.trim())) return null;
  if (key === "body_style" && BED_OR_CAB_NOT_BODY.test(value.trim())) return null;
  return fold(text).includes(fold(value)) ? value : null;
}

export function deriveTitleFacet(vehicle: Record<string, any> | null, key: TitleFacetKey, derivedAt: string) {
  if (!vehicle || !UUID.test(vehicle.id ?? "") || vehicle.is_public !== true || vehicle.deleted_at != null ||
      vehicle.listing_kind === "non_vehicle_item") return null;
  const title = vehicle.listing_title;
  const value = titleFacetWitness(key, title, { year: vehicle.year ?? null, make: vehicle.make ?? null, model: vehicle.model ?? null });
  if (value === null) return null;
  let sourceUrl: string | undefined;
  for (const candidate of [vehicle.listing_url, vehicle.discovery_url]) {
    try { if (typeof candidate === "string" && new URL(candidate).protocol === "https:") { sourceUrl = candidate; break; } } catch { /* not a URL */ }
  }
  return {
    source_slug: "internal-inference", kind: "specification", vehicle_id: vehicle.id,
    property_key: key, source_url: sourceUrl,
    source_identifier: `${TITLE_FACET_MODE}:${vehicle.id}:${key}:${fold(title)}`,
    observed_at: derivedAt, extraction_method: TITLE_FACET_METHOD,
    raw_source_ref: `vehicles:${vehicle.id}:listing_title`,
    content_text: `Vehicle record title label: ${title}\nThe ${key === "trim" ? "trim" : "body style"} word appears literally in the record title. The title's own source, capture time and author are not retained on the record; factory configuration and badge originality are unverified.`,
    agent_inferred: true, defer_analysis: true, agent_cost_cents: 0,
    structured_data: {
      [key]: value, source_value: title, source_field: "vehicles.listing_title",
      normalization_version: TITLE_FACET_NORMALIZATION, label_role: "record_title_label", claim_role: "record_label",
      analysis_kind: "vehicle_title_facet_projection", projection_version: TITLE_FACET_MODE, property_key: key,
      factory_configuration_status: "unknown", current_configuration_status: "unknown", independent_source: false,
      source_event_time_status: "unknown", observed_at_basis: "derivation_time",
      limitation: "Literal label from the vehicle record's title. The title's capture source and time are not retained, so this is weaker than a retained listing claim; a replica, tribute, clone, part or conversion title yields no claim. Not a factory build record.",
    },
  };
}
