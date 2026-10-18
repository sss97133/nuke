import { observationClockMicroseconds } from "../_shared/observationContentHash.ts";
import { captureTrustedJPEGInputs, runCapturedVision, type VisionInputCapture, type VisionInputSource } from "./inputCustody.ts";
import { projectDepictedSubjects, SUBJECT_BATCH_LIMIT, SUBJECT_METHOD, SUBJECT_PROMPT,
  type SubjectInput, type SubjectProjection } from "./subjects.ts";
import { qualifySubjectSource, readSubjectProfiles } from "./subjectReader.ts";
import { assessSubjectAdmission } from "./subjectReplay.ts";
import { allowedSubjectSources, subjectInputScopeRefusal } from "./subjectInputScope.ts";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export interface SubjectSource {
  id: string; user_id: string; image_url: string; file_hash: string; storage_path: string | null;
  taken_at: string | null; created_at: string; is_superseded: boolean | null; is_duplicate: boolean | null;
  is_document: boolean | null; is_sensitive: boolean | null; vision_gate_status: string | null;
}
export interface SubjectReading {
  id: string; image_id: string; cluster_id: string | null; is_active: boolean;
  confidence_basis: {
    visual_subjects_v1?: { anchor_image_id: string; envelope: SubjectEnvelope; state?: string };
    visual_subject_reading_v1?: { envelope: SubjectEnvelope };
  };
}
export interface CandidateScope {
  kind: "account_associated_terminal_vehicles"; vehicle_ids: string[]; retrieved: number;
  exhausted: boolean; truncated: boolean; reference_photos_assessed: number;
  unavailable_references: string[]; global_novelty_asserted: false;
  subject_references?: { image_ids: string[]; coverage: Record<string, unknown> };
}
export interface SubjectEnvelope extends SubjectProjection {
  user_id: string; method: typeof SUBJECT_METHOD; run_key: string; provider: string; model: string;
  read_at: string; inputs: SubjectInput[]; candidate_scope: CandidateScope;
}
export interface SubjectStore {
  sources(userId: string, ids: string[]): Promise<SubjectSource[]>;
  readings(ids: string[]): Promise<SubjectReading[]>;
  candidates(userId: string): Promise<CandidateScope>;
  context?(userId: string, fresh: SubjectSource): Promise<{ sources: SubjectSource[]; coverage: Record<string, unknown> }>;
  retainReading(imageId: string, envelope: SubjectEnvelope): Promise<string>;
  admission(envelope: SubjectEnvelope): Promise<ReturnType<typeof assessSubjectAdmission>>;
  ingest(imageId: string, anchorId: string, envelope: SubjectEnvelope): Promise<{ id: string; cluster_id: string | null }>;
}
export interface SubjectDependencies {
  capture?: (sources: VisionInputSource[], projectURL: string) => Promise<VisionInputCapture>;
  vision: (options: { parts: Array<{ text: string } | { imageUrl: string }>; maxTokens: number }) =>
    Promise<{ provider: string; model: string; data: unknown } | null>;
  now?: () => Date;
}
export interface SubjectRequest {
  user_id?: string; image_ids?: string[]; dry_run?: boolean; reuse_only?: boolean;
  expected_source_hashes?: Record<string, string>;
  allowed_source_hashes?: Record<string, string>;
}

/** Authentication alone is insufficient when a privileged client supplies user_id. */
export function subjectOwnerId(caller: { kind: string; userId?: string | null }, requested: unknown): string {
  const owner = requested ?? caller.userId;
  if (typeof owner !== "string" || !UUID.test(owner) ||
    (caller.kind !== "service_role" && (caller.kind !== "user" || caller.userId !== owner))) {
    throw new Error("subject_account_scope_refused");
  }
  return owner;
}
const sameClock = (a: unknown, b: unknown) => a === null && b === null ||
  observationClockMicroseconds(a) !== null && observationClockMicroseconds(a) === observationClockMicroseconds(b);
function sourceRefusal(row: SubjectSource, user: string): string | null {
  if (row.user_id !== user || row.is_superseded || row.is_duplicate || row.is_document || row.is_sensitive ||
    !row.image_url || !/^[a-f0-9]{64}$/.test(row.file_hash) || observationClockMicroseconds(row.created_at) === null ||
    row.taken_at !== null && observationClockMicroseconds(row.taken_at) === null) return "source_unavailable";
  if (typeof row.storage_path !== "string" ||
    !new RegExp(`^users/${user}/capture-relay/${row.file_hash}/[A-Za-z0-9._-]+$`).test(row.storage_path) ||
    [".", ".."].includes(row.storage_path.split("/").at(-1)!)) return "source_unavailable";
  return row.vision_gate_status === "approved" ? null :
    row.vision_gate_status?.startsWith("rejected") ? "source_unavailable" : "source_not_ready";
}

function replayEnvelope(readings: SubjectReading[], sources: SubjectSource[], user: string): SubjectEnvelope | null {
  for (const reading of readings) {
    const wrapper = reading.confidence_basis?.visual_subjects_v1;
    const envelope = reading.confidence_basis?.visual_subject_reading_v1?.envelope ?? wrapper?.envelope;
    if (!reading.is_active || wrapper?.state === "withdrawn" || !envelope || envelope.method !== SUBJECT_METHOD ||
      envelope.user_id !== user || !Array.isArray(envelope.inputs) || envelope.inputs.length !== sources.length ||
      !Array.isArray(envelope.subjects) || !Array.isArray(envelope.frames)) continue;
    // Protected, admitted testimony is reusable only for these exact live sources.
    if (sources.every(source => envelope.inputs.filter(input => input.image_id === source.id && input.source_qualified === true &&
      input.source_sha256 === source.file_hash && input.source_url === source.image_url &&
      sameClock(input.created_at, source.created_at) && sameClock(input.taken_at, source.taken_at) &&
      qualifySubjectSource(input, source, user, envelope.read_at)).length === 1)) return envelope;
  }
  return null;
}

/** One explicitly bounded reading; no session inheritance or canonical vehicle writes.
 * Retained protected readings are checked before any object/renderer/provider call.
 * The private subject consumer reads current evidence independently after admission.
 */
export async function resolveSubjectBatch(store: SubjectStore, request: SubjectRequest & { user_id: string },
  projectURL: string, dependencies: SubjectDependencies) {
  const ids = request.image_ids, now = dependencies.now ?? (() => new Date());
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > SUBJECT_BATCH_LIMIT || new Set(ids).size !== ids.length || ids.some(id => typeof id !== "string" || !UUID.test(id)) ||
    request.dry_run !== undefined && typeof request.dry_run !== "boolean" || request.reuse_only !== undefined && typeof request.reuse_only !== "boolean") {
    throw new Error("subject_input_scope_invalid");
  }
  const expected = request.expected_source_hashes;
  if (expected && (typeof expected !== "object" || Array.isArray(expected) || Object.keys(expected).length !== ids.length || ids.some(id => !/^[a-f0-9]{64}$/.test(expected[id] ?? "")))) {
    throw new Error("subject_expected_sources_invalid");
  }
  const base = { method: SUBJECT_METHOD, persisted_image_ids: [] as string[], deferred_image_ids: [] as string[],
    unresolved: [] as Array<{ image_id: string; reason: string }> };
  const allowed = allowedSubjectSources(request.allowed_source_hashes, ids, expected);
  if (!allowed.valid) return { ...base, status: "refused", refusal: "allowed_source_scope_invalid" };
  let sources = await store.sources(request.user_id, ids);
  if (sources.length !== ids.length || new Set(sources.map(row => row.id)).size !== ids.length ||
    sources.some(row => !ids.includes(row.id))) return { ...base, status: "refused", refusal: "source_unavailable" };
  if (expected && sources.some(source => expected[source.id] !== source.file_hash)) {
    return { ...base, status: "refused", refusal: "source_changed" };
  }
  const freshScopeRefusal = subjectInputScopeRefusal(allowed.hashes, sources);
  if (freshScopeRefusal) return { ...base, status: "refused", refusal: freshScopeRefusal };
  const held = sources.map(row => ({ image_id: row.id, reason: sourceRefusal(row, request.user_id) })).filter(row => row.reason);
  if (held.length) return { ...base, status: "refused", refusal: held.some(row => row.reason === "source_unavailable") ? "source_unavailable" : "source_not_ready", unresolved: held };

  const fresh = new Map(sources.map(source => [source.id, source]));
  let consumedIds = [...ids], contextCoverage: Record<string, unknown> = {};
  let readings = await store.readings(ids);
  let envelope: SubjectEnvelope | null = null;
  // A retained reading may include server-selected context and consume only the
  // first requested fresh photo. Requalify that exact scope before selecting new
  // context; the deferred photo remains new work on the phone.
  for (const reading of readings) {
    const prior = reading.confidence_basis?.visual_subject_reading_v1?.envelope ?? reading.confidence_basis?.visual_subjects_v1?.envelope;
    if (!reading.is_active || !prior || prior.user_id !== request.user_id || prior.method !== SUBJECT_METHOD ||
      !Array.isArray(prior.inputs) || prior.inputs.length < 2 || prior.inputs.length > SUBJECT_BATCH_LIMIT ||
      !prior.inputs.some(input => input.image_id === ids[0]) || !prior.inputs.every(input => UUID.test(input.image_id)) ||
      ids.length === 3 && !ids.every(id => prior.inputs.some(input => input.image_id === id))) continue;
    const retainedSources = await store.sources(request.user_id, prior.inputs.map(input => input.image_id));
    if (retainedSources.length !== prior.inputs.length || retainedSources.some(row => sourceRefusal(row, request.user_id) ||
      expected && Object.hasOwn(expected, row.id) && expected[row.id] !== row.file_hash)) continue;
    const reusable = replayEnvelope([reading], retainedSources, request.user_id);
    if (reusable) {
      envelope = reusable; sources = retainedSources;
      consumedIds = ids.filter(id => prior.inputs.some(input => input.image_id === id));
      break;
    }
  }
  const reused = !!envelope;
  // Replayed context is subject to the same explicit caller scope, even when
  // reuse would make no provider call. Refuse before retained/membership writes.
  const replayScopeRefusal = subjectInputScopeRefusal(allowed.hashes, sources);
  if (replayScopeRefusal) return { ...base, status: "refused", refusal: replayScopeRefusal };
  if (!envelope && request.reuse_only) return { ...base, status: "refused", refusal: "retained_reading_unavailable" };
  if (!envelope) {
    if (ids.length <= 2 && store.context) {
      const context = await store.context(request.user_id, fresh.get(ids[0])!);
      const qualified = context.sources.filter(source => source.id !== ids[0] && !sourceRefusal(source, request.user_id));
      if (qualified.length && qualified.length <= 2 && new Set(qualified.map(source => source.id)).size === qualified.length) {
        sources = [fresh.get(ids[0])!, ...qualified];
        consumedIds = ids.filter(id => sources.some(source => source.id === id));
        contextCoverage = context.coverage;
      }
    }
    if (sources.length < 2) return { ...base, status: "refused", refusal: "source_needs_corresponding_view" };
    // Server-selected context must be pinned as explicitly as requested fresh
    // sources. No object, renderer or provider callback has run at this point.
    const actualScopeRefusal = subjectInputScopeRefusal(allowed.hashes, sources);
    if (actualScopeRefusal) return { ...base, status: "refused", refusal: actualScopeRefusal };
    readings = await store.readings(sources.map(source => source.id));
    const candidate_scope = await store.candidates(request.user_id);
    const contextIds = sources.filter(source => !ids.includes(source.id)).map(source => source.id);
    if (contextIds.length) candidate_scope.subject_references = { image_ids: contextIds, coverage: contextCoverage };
    const visionSources: VisionInputSource[] = sources.map(row => ({ key: row.id, image_id: row.id,
      source_url: row.image_url, storage_path: row.storage_path, expected_source_sha256: row.file_hash,
      representation: "source", required: true }));
    const capture = await (dependencies.capture ?? captureTrustedJPEGInputs)(visionSources, projectURL);
    const result = await runCapturedVision(visionSources, capture, () => [
      { text: SUBJECT_PROMPT }, ...sources.flatMap(source => [{ text: `Photo image_id=${source.id}` }, { image_key: source.id }]),
    ], dependencies.vision, { limits: { output_tokens: 1600 } });
    if (!result.model_result) return { ...base, status: "refused", refusal: result.refusal,
      unavailable_inputs: capture.unavailable, candidate_scope,
      ...(result.provider_diagnostics?.length ? { provider_diagnostics: result.provider_diagnostics } : {}),
      ...(result.provider_attempt_coverage ? { provider_attempt_coverage: result.provider_attempt_coverage } : {}) };
    const inputs: SubjectInput[] = sources.map(source => {
      const receipt = capture.inputs.find(input => input.key === source.id)!.receipt;
      const prior = readings.filter(reading => reading.image_id === source.id && reading.is_active && reading.cluster_id &&
        reading.confidence_basis?.visual_subjects_v1?.envelope?.user_id === request.user_id);
      return { ...receipt, image_id: source.id, source_sha256: receipt.source_sha256!, taken_at: source.taken_at,
        created_at: source.created_at, existing_cluster_id: prior.length === 1 ? prior[0].cluster_id : null,
        existing_anchor_image_id: prior.length === 1 ? prior[0].confidence_basis.visual_subjects_v1!.anchor_image_id : null };
    });
    const projection = projectDepictedSubjects(result.model_result.data, inputs);
    const read_at = now().toISOString();
    const run_key = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify({
      method: SUBJECT_METHOD, inputs: inputs.map(input => [input.image_id, input.source_sha256, input.input_sha256]),
      provider: result.model_result.provider, model: result.model_result.model, read_at,
    }))).then(value => [...new Uint8Array(value)].map(v => v.toString(16).padStart(2, "0")).join(""));
    envelope = { ...projection, user_id: request.user_id, method: SUBJECT_METHOD, run_key,
      provider: result.model_result.provider, model: result.model_result.model, read_at, inputs, candidate_scope };
  }
  const failures: Array<{ image_id: string; reason: string }> = [], persisted: string[] = [], retained: string[] = [];
  if (!request.dry_run) {
    // Even an unresolved interpretation is useful retained evidence. Its own
    // protected producer family never replaces subject membership testimony.
    // Retain before the separate admission read: a transient membership lookup
    // must not discard a completed paid interpretation and force another read.
    for (const input of envelope.inputs) {
      try { await store.retainReading(input.image_id, envelope); retained.push(input.image_id); }
      catch { failures.push({ image_id: input.image_id, reason: "subject_reading_storage_failed" }); }
    }
  }
  let membershipHeld = true, admissionReason: string | null = null;
  try {
    const admission = await store.admission(envelope);
    membershipHeld = !admission.admission_allowed;
    admissionReason = admission.reason;
  } catch {
    // No membership authority was established. Keep the complete interpretation
    // and return a storage retry; the phone must reuse it without paid inference.
    admissionReason = "subject_admission_unavailable";
    for (const image_id of consumedIds) if (!failures.some(failure => failure.image_id === image_id)) {
      failures.push({ image_id, reason: admissionReason });
    }
  }
  if (!request.dry_run) {
    // Each sanctioned call requalifies ALL supporting sources under locks. A
    // partial transport failure keeps its retained reading for a no-inference retry.
    for (const subject of membershipHeld ? [] : envelope.subjects) for (const id of subject.member_image_ids) {
      try {
        const row = await store.ingest(id, subject.anchor_image_id, envelope);
        if (!row.cluster_id) throw new Error("subject_writer_contract_unavailable");
        persisted.push(id);
      } catch { failures.push({ image_id: id, reason: "subject_storage_failed" }); }
    }
  }
  const supported = new Set((membershipHeld ? [] : envelope.subjects).flatMap(subject => subject.member_image_ids));
  const heldMembership = membershipHeld ? envelope.subjects.flatMap(subject => subject.member_image_ids)
    .map(image_id => ({ image_id, reason: admissionReason ?? "subject_admission_held" })) : [];
  const failureById = new Map(failures.map(row => [row.image_id, row]));
  return { ...base, status: failures.length ? "partial" : membershipHeld ? "unresolved" : reused ? "cached" : envelope.subjects.length ? "resolved" : "unresolved",
    dry_run: request.dry_run ?? false, persisted_image_ids: persisted.filter(id => consumedIds.includes(id) && !failureById.has(id)), subjects: membershipHeld ? [] : envelope.subjects,
    deferred_image_ids: ids.filter(id => !consumedIds.includes(id)),
    admitted_image_ids: persisted, input_image_ids: envelope.inputs.map(input => input.image_id),
    retained_reading_image_ids: retained.filter(id => consumedIds.includes(id)), retry_without_inference: retained.length + persisted.length > 0,
    unresolved: [...[...envelope.unresolved, ...heldMembership].filter(row => consumedIds.includes(row.image_id) && !failures.some(f => f.image_id === row.image_id)),
      ...[...failureById.values()].filter(row => consumedIds.includes(row.image_id))], candidate_scope: envelope.candidate_scope,
    coverage: { grain: "source_photos", assessed: sources.length, eligible: supported.size,
      excluded: sources.length - supported.size, as_of: envelope.read_at, truncated: false },
    reading: { provider: envelope.provider, model: envelope.model, read_at: envelope.read_at, run_key: envelope.run_key, reused },
  };
}

export function supabaseSubjectStore(client: any): SubjectStore {
  return {
    async sources(user, ids) {
      const { data, error } = await client.from("vehicle_images").select(
        "id,user_id,image_url,file_hash,storage_path,taken_at,created_at,is_superseded,is_duplicate,is_document,is_sensitive,vision_gate_status",
      ).eq("user_id", user).in("id", ids).limit(SUBJECT_BATCH_LIMIT);
      if (error || !Array.isArray(data)) throw new Error("subject_source_read_failed");
      return data;
    },
    async readings(ids) {
      const columns = "id,image_id,cluster_id,observed_by,is_active,superseded_by,confidence_basis";
      const [memberships, paid] = await Promise.all([
        client.from("image_observations").select(columns).eq("observed_by", SUBJECT_METHOD)
          .is("superseded_by", null).in("image_id", ids).limit(43),
        client.from("image_observations").select(columns).eq("observed_by", "visual_subject_reading_v1")
          .eq("is_active", true).is("superseded_by", null).in("image_id", ids)
          .contains("confidence_basis", { visual_subject_reading_v1: { envelope: { inputs: [{ image_id: ids[0] }] } } })
          .order("observed_at", { ascending: false }).order("id", { ascending: false }).limit(33),
      ]);
      if (memberships.error || paid.error || !Array.isArray(memberships.data) || !Array.isArray(paid.data)) throw new Error("subject_reading_read_failed");
      if (memberships.data.length > 42) throw new Error("subject_membership_scope_unassessed");
      return [...memberships.data, ...paid.data];
    },
    async admission(envelope) {
      const ids = envelope.inputs.map(input => input.image_id), [sources, heads] = await Promise.all([
        this.sources(envelope.user_id, ids),
        client.from("image_observations").select("id,image_id,cluster_id,observed_by,is_active,superseded_by,confidence_basis")
          .eq("observed_by", SUBJECT_METHOD).is("superseded_by", null).in("image_id", ids).limit(43),
      ]);
      if (heads.error || !Array.isArray(heads.data)) throw new Error("subject_admission_read_failed");
      const clusterIds = [...new Set(envelope.subjects.map(subject => subject.existing_cluster_id).filter((id): id is string => !!id))];
      const profiles = [];
      for (const id of clusterIds) profiles.push(...(await readSubjectProfiles(client, envelope.user_id, { cluster_id: id })).subjects);
      return assessSubjectAdmission(envelope, envelope.user_id, { sources, readings: heads.data.slice(0, 42),
        readings_complete: heads.data.length <= 42, profiles, as_of: new Date().toISOString() });
    },
    async retainReading(imageId, envelope) {
      const { data, error } = await client.rpc("ingest_image_observation", {
        p_image_id: imageId, p_vehicle_id: null, p_role: "part", p_confidence: 0,
        p_observed_by: "visual_subject_reading_v1", p_agent_version: "visual_subject_reading_v1",
        p_confidence_basis: { visual_subject_reading_v1: { envelope } },
        p_is_high_confidence_subject: false, p_layer_version: { method: SUBJECT_METHOD, reader_contract: 1 },
      });
      if (error || typeof data !== "string" || !UUID.test(data)) throw new Error("subject_reading_storage_failed");
      return data;
    },
    async candidates(user) {
      // No make/target filter: the current attachment can itself be wrong.
      const { data, error } = await client.rpc("user_associated_vehicle_ids", { p_user: user }).limit(501);
      if (error || !Array.isArray(data) || data.some(id => typeof id !== "string" || !UUID.test(id))) throw new Error("subject_candidate_scope_failed");
      const ids = [...new Set(data.slice(0, 500))] as string[], unavailable: string[] = [];
      for (let i = 0; i < ids.length; i += 200) {
        const chunk = ids.slice(i, i + 200), result = await client.from("vehicles").select("id,primary_image_url").in("id", chunk).limit(200);
        if (result.error || !Array.isArray(result.data) || result.data.length !== chunk.length) throw new Error("subject_candidate_read_failed");
        unavailable.push(...result.data.filter((row: any) => !row.primary_image_url).map((row: any) => row.id));
      }
      return { kind: "account_associated_terminal_vehicles", vehicle_ids: ids, retrieved: ids.length,
        exhausted: data.length <= 500, truncated: data.length > 500, reference_photos_assessed: 0,
        unavailable_references: unavailable, global_novelty_asserted: false };
    },
    async ingest(imageId, anchorId, envelope) {
      const { data: id, error } = await client.rpc("ingest_image_observation", {
        p_image_id: imageId, p_vehicle_id: null, p_role: "subject", p_confidence: 0.5,
        p_observed_by: SUBJECT_METHOD, p_agent_version: SUBJECT_METHOD,
        p_confidence_basis: { visual_subjects_v1: { anchor_image_id: anchorId, envelope, state: "active" } },
        p_is_high_confidence_subject: false, p_layer_version: { method: SUBJECT_METHOD, reader_contract: 1 },
      });
      if (error || typeof id !== "string" || !UUID.test(id)) throw new Error("subject_storage_failed");
      const result = await client.from("image_observations").select("id,cluster_id").eq("id", id).single();
      if (result.error || !result.data) throw new Error("subject_storage_readback_failed");
      return result.data;
    },
  };
}
