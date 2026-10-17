import { retainedDescriptionCaptureQualified } from "./retainedDescriptionPowertrain.ts";

export const RETAINED_REPORTED_WORK_MODE = "retained_listing_reported_work_v1";
export const REPORTED_WORK_WITNESS_VERSION = "retained_description_reported_work_v1";
export const REPORTED_WORK_WITNESS_VERSION_V2 = "retained_description_reported_work_v2";
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
// v2: one passive clause with an open object phrase. The object may not hold a second finite verb (the month
// would then date only the last clause), the sentence holds exactly one year, and attribution is withheld.
const V2_VERB = "(?:replaced|installed|rebuilt|repaired|refinished|repainted|resealed|reupholstered|overhauled|serviced|flushed|refreshed|recharged|fitted|performed)";
const PASSIVE = new RegExp(`^(?:The|A|An|New) ([A-Za-z0-9][A-Za-z0-9 ,'’/.-]{1,120}) (?:was|were) ${V2_VERB}(?:(?:, |, and | and )${V2_VERB})* in ${MONTH}\\.$`);
const V2_WITHHELD = /\b(?:seller|carfax|autocheck|invoice|records?|receipts?|according|notes?|states?|said|told|tells|describes?|claims?|estimated|approximately|around|circa|reported|recommend\w*|need\w*|require\w*)\b/i;
const FINITE = /\b(?:was|were|is|are|has|have|had|been)\b/i;
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

/** v2 sentences v1 does not already carry. Same page gate and sentence split as v1; v1 and v2 together hold at most 8. */
export function descriptionReportedWorkWitnessesV2(text: unknown): ReportedWorkWitness[] {
  const v1 = descriptionReportedWorkWitnesses(text);
  if (typeof text !== "string" || bytes(text) < 100 || bytes(text) > 32000 || /\b(?:not|never) (?:performed|done|completed)\b/i.test(text) ||
      /\b(?:following|below|next)\b[^.!?]{0,200}\b(?:not|never|planned|proposed|recommended|hypothetical)\b|\b(?:not|never|planned|proposed|recommended|hypothetical)\b[^.!?]{0,200}\b(?:following|below|next)\b/i.test(text)) return [];
  const found: ReportedWorkWitness[] = [];
  for (const raw of text.split(/(?<=[.!?])[ \t\r\n]+/)) {
    const sentence = raw.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, "");
    // The month May before a year is a date, not the hedge "may".
    if (bytes(sentence) > 300 || UNSUPPORTED.test(sentence.replace(/\bMay (?=[12][0-9]{3}\b)/g, "")) || V2_WITHHELD.test(sentence)) continue;
    if ((sentence.match(/\b[12][0-9]{3}\b/g) ?? []).length !== 1) continue;
    const match = sentence.match(PASSIVE);
    if (!match || FINITE.test(match[1])) continue;
    const month = MONTHS.indexOf(match[2]);
    if (month < 0 || Number(match[3]) < 1886) continue;
    if (v1.some((w) => w.source_value === sentence) || found.some((w) => w.source_value === sentence)) continue;
    found.push({ source_value: sentence, performed_clause: sentence,
      reported_date: `${match[3]}-${String(month + 1).padStart(2, "0")}`,
      reported_date_label: `${match[2]} ${match[3]}`, date_precision: "month" });
  }
  return v1.length + found.length > 8 ? [] : found;
}

/** The selector's report_index counts v1 witnesses, then v2 witnesses. */
export function reportedWorkWitnessList(text: unknown): { witness: ReportedWorkWitness; version: string }[] {
  return [...descriptionReportedWorkWitnesses(text).map((witness) => ({ witness, version: REPORTED_WORK_WITNESS_VERSION })),
    ...descriptionReportedWorkWitnessesV2(text).map((witness) => ({ witness, version: REPORTED_WORK_WITNESS_VERSION_V2 }))];
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
  const entry = reportedWorkWitnessList(source.content_text)[reportIndex];
  const witness = entry?.witness;
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
      source_observation_id: source.id, source_field: "content_text", source_witness_version: entry.version,
      observed_at_basis: "source_testimony_recorded_at", source_recorded_at: source.ingested_at,
      source_captured_at: source.structured_data.source_captured_at,
      source_capture_sha256: source.structured_data.source_capture_sha256,
      source_capture_basis: source.structured_data.source_capture_basis,
    },
  };
}
