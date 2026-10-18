import { observationClockMicroseconds as clock } from "../_shared/observationContentHash.ts";
import { qualifySubjectSource, type SubjectProfile } from "./subjectReader.ts";
import { SUBJECT_METHOD } from "./subjects.ts";
import { sourceAliases, sourceRoot, sourceIdentityLineage } from "./sourceIdentity.ts";
import { subjectPrivacyLookupComplete } from "./subjectPrivacy.ts";
import { lineageReadingAfterWithdrawals } from "./sourceLineage.ts";

const record = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);

export interface SubjectAdmissionState {
  sources: unknown[];
  /** All current terminal membership heads, including inactive withdrawals, for
   * every proposed member. Raw paid readings do not confer membership authority. */
  readings: unknown[];
  readings_complete: boolean;
  /** Fresh, source-requalified output from readSubjectProfiles, never cluster cache. */
  profiles?: SubjectProfile[];
  as_of?: string;
}

/** A protected paid interpretation is reusable data, not permission to undo a
 * later membership correction. This guard applies to new and cached envelopes.
 * It never writes, prunes a model graph, or restores a withdrawn interpretation.
 */
export function assessSubjectAdmission(envelope: unknown, userId: string, state: SubjectAdmissionState) {
  const result = (data_reusable: boolean, blocked: Set<string>, reason: string | null) => ({
    data_reusable, admission_allowed: data_reusable && !reason && blocked.size === 0,
    blocked_image_ids: [...blocked].sort(), reason,
  });
  const blocked = new Set<string>();
  if (!uuid(userId) || !record(envelope) || envelope.user_id !== userId || envelope.method !== SUBJECT_METHOD ||
    !Array.isArray(envelope.inputs) || envelope.inputs.length < 1 || envelope.inputs.length > 14 ||
    !Array.isArray(envelope.subjects) || envelope.subjects.length > 14 || clock(envelope.read_at) === null ||
    state.as_of !== undefined && (clock(state.as_of) === null || clock(envelope.read_at)! > clock(state.as_of)! + 300_000_000n)) {
    return result(false, blocked, "retained_reading_invalid");
  }
  const inputs = new Map<string, any>();
  const sources = new Map<string, any>();
  for (const input of envelope.inputs) {
    if (!record(input) || !uuid(input.image_id) || inputs.has(input.image_id)) return result(false, blocked, "retained_reading_invalid");
    inputs.set(input.image_id, input);
    const live = state.sources.filter(s => record(s) && s.id === input.image_id);
    if (live.length !== 1 || !qualifySubjectSource(input, live[0], userId, envelope.read_at, state.as_of)) blocked.add(input.image_id);
    else sources.set(input.image_id, live[0]);
  }
  if (blocked.size) return result(false, blocked, "source_changed");
  const members = new Set<string>();
  for (const subject of envelope.subjects) {
    if (!record(subject) || !uuid(subject.anchor_image_id) || !Array.isArray(subject.member_image_ids) ||
      subject.member_image_ids.length < 2 || subject.member_image_ids.length > 14 ||
      !subject.member_image_ids.every((id: unknown) => uuid(id) && inputs.has(id)) ||
      new Set(subject.member_image_ids).size !== subject.member_image_ids.length ||
      !subject.member_image_ids.includes(subject.anchor_image_id)) return result(false, blocked, "retained_reading_invalid");
    for (const id of subject.member_image_ids) {
      if (members.has(id)) return result(false, blocked, "retained_reading_invalid");
      members.add(id);
    }
  }
  if (!state.readings_complete || !subjectPrivacyLookupComplete([...sources.values()])) return result(true, members, "current_membership_unassessed");
  const roots = new Set<string>();
  for (const id of members) {
    const root = sourceRoot(sources.get(id)) ?? id;
    if (roots.has(root)) return result(false, members, "source_alias_not_independent");
    roots.add(root);
    const lineage = sourceIdentityLineage(sources.get(id));
    const withdrawals = state.readings.filter(row => record(row) && row.observed_by === SUBJECT_METHOD &&
      row.confidence_basis?.[SUBJECT_METHOD]?.state === "withdrawn" &&
      row.confidence_basis?.[SUBJECT_METHOD]?.envelope?.user_id === userId)
      .map((row: any) => ({ source_image_id: row.image_id, observed_at: row.observed_at }));
    if (lineage && !lineageReadingAfterWithdrawals(lineage, envelope.read_at, withdrawals, true)) blocked.add(id);
  }
  for (const row of state.readings) {
    if (!record(row) || row.observed_by !== SUBJECT_METHOD || row.superseded_by !== null) continue;
    const affected = [...members].filter(id => sourceAliases(sources.get(id)).includes(row.image_id));
    if (!affected.length) continue;
    const wrapper = row.confidence_basis?.[SUBJECT_METHOD];
    // A malformed terminal membership is not evidence that this image is free.
    if (!record(wrapper) || !record(wrapper.envelope) || wrapper.envelope.user_id !== userId ||
      row.is_active !== true || wrapper.state === "withdrawn") { for (const id of affected) blocked.add(id); continue; }
    for (const id of affected) {
      const proposed = envelope.subjects.find((s: any) => s.member_image_ids.includes(id));
      if (wrapper.anchor_image_id !== proposed.anchor_image_id ||
        proposed.existing_cluster_id && row.cluster_id !== proposed.existing_cluster_id) blocked.add(id);
    }
  }
  if (blocked.size) return result(true, blocked, "current_membership_conflict");
  for (const subject of envelope.subjects) {
    if (!subject.existing_cluster_id) continue;
    const profile = state.profiles?.find(p => p.id === subject.existing_cluster_id &&
      p.anchor_image_id === subject.anchor_image_id && p.image_count >= 2 &&
      p.images.some(image => image.id === p.anchor_image_id));
    if (!profile) for (const id of subject.member_image_ids) blocked.add(id);
  }
  return result(true, blocked, blocked.size ? "existing_subject_support_unavailable" : null);
}
