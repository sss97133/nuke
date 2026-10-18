import { observationClockMicroseconds as clock } from "../_shared/observationContentHash.ts";
import { qualifySubjectSourceCustody } from "./subjectReader.ts";
import { currentIdentitySource, sourceAliases, sourceRoot } from "./sourceIdentity.ts";
import { subjectPrivacyLookupComplete, subjectSourceAvailable, subjectSourceCanEstablishPrivacy } from "./subjectPrivacy.ts";
import type { SubjectEnvelope, SubjectReading, SubjectSource, SubjectStore } from "./subjectService.ts";

export const REINSPECTION_METHOD = "device_privacy_reinspection_v1";
const RAW = "visual_subject_reading_v1", SUBJECT = "visual_subjects_v1", PAGE = 8;
const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(v);
const record = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
export interface SubjectReinspectionWitness {
  receipt_image_id: string; current_image_id: string; root_image_id: string;
  local_identifier: string; source_sha256: string;
}
export interface SubjectReinspectionCandidate {
  method: typeof REINSPECTION_METHOD; reading_id: string; run_key: string;
  image_ids: string[]; expected_source_hashes: Record<string, string>;
  pending_source_count: number;
  inspect: SubjectReinspectionWitness[];
}

/** This is a fetch/replay plan, never privacy or membership admission. A protected
 * old reading supplies immutable inputs; current source and correction lookups
 * independently decide whether reinspection is permissible. */
export async function planSubjectReinspection(store: SubjectStore, userId: string, reading: SubjectReading,
  asOf: string): Promise<{ candidate: SubjectReinspectionCandidate; envelope: SubjectEnvelope; sources: SubjectSource[] } | null> {
  const e = reading.confidence_basis?.visual_subject_reading_v1?.envelope;
  if (!uuid(userId) || !uuid(reading.id) || !reading.is_active || !e || e.method !== SUBJECT || e.user_id !== userId ||
    typeof e.run_key !== "string" || !e.run_key || e.run_key.length > 1024 || clock(e.read_at) === null || clock(asOf) === null || clock(e.read_at)! > clock(asOf)! ||
    !Array.isArray(e.inputs) || e.inputs.length < 2 || e.inputs.length > 3 || !Array.isArray(e.subjects) || !Array.isArray(e.frames) ||
    e.subjects.some(s => !record(s) || !uuid(s.anchor_image_id) || !Array.isArray(s.member_image_ids) ||
      s.member_image_ids.some((id: unknown) => !uuid(id) || !e.inputs.some(input => input.image_id === id))) ||
    e.inputs.some(input => !uuid(input.image_id)) || new Set(e.inputs.map(input => input.image_id)).size !== e.inputs.length) return null;
  const ids = e.inputs.map(input => input.image_id), sources = await store.sources(userId, ids);
  if (!subjectPrivacyLookupComplete(sources)) throw new Error("subject_reinspection_scope_unassessed");
  if (sources.length !== ids.length || new Set(sources.map(s => s.id)).size !== ids.length) return null;
  const inspect: SubjectReinspectionWitness[] = [], roots = new Set<string>();
  for (const input of e.inputs) {
    const source = sources.find(s => s.id === input.image_id), current = currentIdentitySource(source), root = sourceRoot(source);
    if (!source || !current || !root || roots.has(root) || !qualifySubjectSourceCustody(input, source, userId, e.read_at)) return null;
    roots.add(root);
    if (subjectSourceAvailable(source, userId, asOf)) continue;
    const local = current.exif_data?.uuid;
    if (!subjectSourceCanEstablishPrivacy(source, userId) || typeof local !== "string" || !local || local.length > 512 || local.trim() !== local) return null;
    inspect.push({ receipt_image_id: source.id, current_image_id: current.id, root_image_id: root,
      local_identifier: local, source_sha256: current.file_hash });
  }
  if (inspect.length < 1) return null;
  // The store must read all current/historical withdrawn memberships across aliases
  // or refuse its bounded lookup. A raw paid reading never overrides a correction.
  const aliases = new Set(sources.flatMap(source => sourceAliases(source)));
  const heads = await store.readings([...aliases]);
  for (const row of heads as any[]) {
    const wrapper = row.confidence_basis?.[SUBJECT];
    if (!wrapper || !aliases.has(row.image_id)) continue;
    if (row.is_active !== true || wrapper.state === "withdrawn" || !record(wrapper.envelope) || wrapper.envelope.user_id !== userId) return null;
    const source = sources.find(s => sourceAliases(s).includes(row.image_id));
    const subject = e.subjects.find(s => source && s.member_image_ids.includes(source.id));
    if (subject && (sourceRoot(sources.find(s => sourceAliases(s).includes(wrapper.anchor_image_id))) !==
      sourceRoot(sources.find(s => sourceAliases(s).includes(subject.anchor_image_id))) ||
      subject.existing_cluster_id && subject.existing_cluster_id !== row.cluster_id)) return null;
  }
  return { envelope: e, sources, candidate: { method: REINSPECTION_METHOD, reading_id: reading.id, run_key: e.run_key,
    image_ids: ids, expected_source_hashes: Object.fromEntries(e.inputs.map(i => [i.image_id, i.source_sha256])),
    pending_source_count: inspect.length, inspect: inspect.slice(0, 2) } };
}

/** Read-only bounded carrier pagination. No URL/pixels, new analysis, filing or
 * native local-ID guess is returned for held/incomplete families. */
export async function readSubjectReinspections(client: any, store: SubjectStore, userId: string,
  opts: { offset?: number } = {}) {
  if (!uuid(userId) || opts.offset !== undefined && (!Number.isSafeInteger(opts.offset) || opts.offset < 0 || opts.offset > 1_000_000)) throw new Error("subject_reinspection_scope_invalid");
  const offset = opts.offset ?? 0, as_of = new Date().toISOString();
  const { data, error } = await client.from("image_observations").select("id,image_id,cluster_id,is_active,confidence_basis")
    .eq("observed_by", RAW).eq(`confidence_basis->${RAW}->envelope->>user_id`, userId)
    .eq("is_active", true).is("superseded_by", null)
    .order("observed_at", { ascending: false }).order("id", { ascending: false }).range(offset, offset + PAGE);
  if (error || !Array.isArray(data)) throw new Error("subject_reinspection_read_failed");
  const candidates: SubjectReinspectionCandidate[] = [], seen = new Set<string>();
  let assessed = 0, truncated = data.length > PAGE;
  for (const reading of data.slice(0, PAGE)) {
    assessed++;
    const run = reading.confidence_basis?.[RAW]?.envelope?.run_key;
    if (typeof run !== "string" || seen.has(run)) continue;
    seen.add(run);
    let plan;
    try { plan = await planSubjectReinspection(store, userId, reading, as_of); }
    catch { truncated = true; continue; }
    if (plan) { candidates.push(plan.candidate); break; }
  }
  const more = assessed < data.length;
  return { method: REINSPECTION_METHOD, candidates,
    coverage: { assessed, eligible: candidates.length, excluded: assessed - candidates.length, as_of,
      truncated: truncated || more, scope: "bounded_retained_paid_reading_carriers" }, next_offset: more ? offset + assessed : null };
}
