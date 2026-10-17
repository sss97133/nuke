import { retainedDescriptionCaptureQualified } from "./retainedDescriptionPowertrain.ts";

export const RETAINED_REPORTED_WORK_MODE = "retained_listing_reported_work_v1";
export const REPORTED_WORK_WITNESS_VERSION = "retained_description_reported_work_v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTH = `(${MONTHS.join("|")}) ([12][0-9]{3})`;
// Literal object labels bound this version's acceptance grammar; they are not
// catalog part identities. Unknown tails (including "and more") are withheld.
const PART = "(?:fuel filter|fuel hoses|exhaust gaskets|tubes|tires|clutch plates|battery|drive chain|brake shoes|springs|fork oil|valve cover gasket|throttle body gasket|spark plugs|ignition wires)";
const PART_LIST = `${PART}(?:(?:, |, and | and )${PART})*`;
const ACTION = `(?:rebuilding the carburetor|repairing an exhaust leak|replacing the ${PART_LIST})`;
const INCLUDED = new RegExp(`^(?:Work|Service) in ${MONTH} included ${ACTION}(?:(?:, |, and | and )${ACTION})*\\.$`);
const REPLACED_PART = "(?:tires|front struts|front wheel hubs|transmission oil pan gasket|instrument cluster)";
const REPLACED = new RegExp(`^The ${REPLACED_PART}(?:(?:, |, and | and )${REPLACED_PART})* (?:was|were) replaced(?: and the fluid flushed)? in ${MONTH}\\.$`);
const UNSUPPORTED = /\b(?:not|no|never|without|or|would|could|might|may|should|planned|proposed|intend|believed|alleged|reportedly|apparently|possibly|by|before|after|if|unless|but|however|instead|actually)\b|[?"“”;:]/i;
const bytes = (text: string) => new TextEncoder().encode(text).length;
export interface ReportedWorkWitness {
  source_value: string; performed_clause: string; reported_date: string;
  reported_date_label: string; date_precision: "month";
}

/** A source assertion, never evidence of independently confirmed completion.
 * Preserve the whole sentence even when it separately recommends other work.
 * No noun/part splitting, performer inference, relative date or fabricated day. */
export function descriptionReportedWorkWitnesses(text: unknown): ReportedWorkWitness[] {
  if (typeof text !== "string" || bytes(text) < 100 || bytes(text) > 32000 || /\b(?:not|never) (?:performed|done|completed)\b/i.test(text) ||
      /\b(?:following|below|next)\b[^.!?]{0,200}\b(?:not|never|planned|proposed|recommended|hypothetical)\b|\b(?:not|never|planned|proposed|recommended|hypothetical)\b[^.!?]{0,200}\b(?:following|below|next)\b/i.test(text)) return [];
  const found: ReportedWorkWitness[] = [];
  for (const raw of text.split(/(?<=[.!?])[ \t\r\n]+/)) {
    const sentence = raw.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, "");
    if (bytes(sentence) > 300 || UNSUPPORTED.test(sentence)) continue;
    const separator = ", an inspection at that time recommended ";
    const at = sentence.indexOf(separator);
    let clause = sentence;
    if (at !== -1) {
      // This separate subject cannot change the earlier assertion's scope.
      // All other mixed/qualified constructions are withheld, not trimmed.
      if (!["replacing the front brake pads and rotors.", "flushing the rear differential."].includes(sentence.slice(at + separator.length))) continue;
      clause = sentence.slice(0, at);
    }
    const assertion = at === -1 ? clause : `${clause}.`;
    const match = assertion.match(INCLUDED) ?? assertion.match(REPLACED);
    if (!match || /\b(?:recommend\w*|need\w*|require\w*)\b/i.test(clause)) continue;
    const month = MONTHS.indexOf(match[1]);
    if (month < 0 || Number(match[2]) < 1886) continue;
    const witness: ReportedWorkWitness = { source_value: sentence, performed_clause: clause,
      reported_date: `${match[2]}-${String(month + 1).padStart(2, "0")}`,
      reported_date_label: `${match[1]} ${match[2]}`, date_precision: "month" };
    if (!found.some((prior) => prior.source_value === sentence)) found.push(witness);
    if (found.length > 8) return [];
  }
  return found;
}

export function retainedReportedWorkSelector(input: Record<string, unknown>): { sourceId: string; reportIndex: number } | null {
  return Object.keys(input).sort().join(",") === "mode,report_index,source_observation_id" &&
    input.mode === RETAINED_REPORTED_WORK_MODE && typeof input.source_observation_id === "string" && UUID.test(input.source_observation_id) &&
    Number.isInteger(input.report_index) && Number(input.report_index) >= 0 && Number(input.report_index) < 8
    ? { sourceId: input.source_observation_id, reportIndex: Number(input.report_index) } : null;
}

export async function deriveRetainedReportedWork(source: Record<string, any>, vehicle: Record<string, any> | null,
  registeredSource: Record<string, any> | null, reportIndex: number) {
  if (!UUID.test(source?.id ?? "") || !UUID.test(source?.vehicle_id ?? "") ||
      source.kind !== "listing" || source.is_superseded !== false || source.property_id != null ||
      source.subject_type !== "vehicle" || source.subject_id != null ||
      !/^https:\/\/bringatrailer[.]com\/listing\/[^/?#]+\/?$/.test(source.source_url ?? "") ||
      vehicle?.id !== source.vehicle_id || vehicle?.is_public !== true || vehicle.deleted_at != null || vehicle.listing_kind === "non_vehicle_item" ||
      registeredSource?.id !== source.source_id || registeredSource?.slug !== "bat" ||
      !registeredSource.supported_observations?.includes("activity") ||
      !Number.isFinite(source.confidence_score) || source.confidence_score < .6 || source.confidence_score > 1 ||
      !retainedDescriptionCaptureQualified(source)) return null;
  const witness = descriptionReportedWorkWitnesses(source.content_text)[reportIndex];
  if (!witness || witness.reported_date > source.structured_data.source_captured_at.slice(0, 7)) return null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(witness.source_value));
  const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
  return {
    source_slug: "bat", kind: "activity", vehicle_id: source.vehicle_id,
    source_url: source.source_url, source_identifier: `${RETAINED_REPORTED_WORK_MODE}:${source.id}:${hash}`,
    observed_at: source.ingested_at, extraction_method: RETAINED_REPORTED_WORK_MODE,
    raw_source_ref: `vehicle_observations:${source.id}`,
    content_text: `Publisher-reported work: ${witness.performed_clause}\nOccurrence unverified; performer and intent unknown.`,
    agent_inferred: true, defer_analysis: true, agent_cost_cents: 0,
    structured_data: {
      analysis_kind: "retained_reported_work", ...witness,
      report_status: "publisher_reported_completion", occurrence_status: "unverified",
      performer_id: null, performer_status: "unknown", intent_status: "unknown", independent_source: false,
      source_observation_id: source.id, source_field: "content_text", source_witness_version: REPORTED_WORK_WITNESS_VERSION,
      observed_at_basis: "source_testimony_recorded_at", source_recorded_at: source.ingested_at,
      source_captured_at: source.structured_data.source_captured_at,
      source_capture_sha256: source.structured_data.source_capture_sha256,
      source_capture_basis: source.structured_data.source_capture_basis,
    },
  };
}
