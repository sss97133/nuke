import { observationClockMicroseconds } from "../_shared/observationContentHash.ts";
import { captureTrustedJPEGInputs, captureVisionInputs, runCapturedVision, type VisionInputCapture, type VisionInputSource } from "./inputCustody.ts";
import { captureRelation, projectDepictedSubjects, SUBJECT_BATCH_LIMIT, SUBJECT_METHOD, SUBJECT_PROMPT,
  type SubjectInput, type SubjectProjection } from "./subjects.ts";
import { qualifySubjectSource, readSubjectProfiles } from "./subjectReader.ts";
import { assessSubjectAdmission } from "./subjectReplay.ts";
import { DEVICE_PRIVACY_METHOD, PRIVATE_SUBJECT_PURPOSE, hydrateSubjectPrivacy, privateSubjectPrivacyQualified,
  subjectPrivacyWithdrawn, validDevicePrivacyReceipt } from "./subjectPrivacy.ts";
import { subjectSourceAvailable, subjectSourceCanEstablishPrivacy, subjectSourceFamily, subjectPrivacyLookupComplete } from "./subjectPrivacy.ts";
import { currentIdentitySource, loadSourceIdentities, sourceAliases, sourceRoot, inspectSourceIdentity, type SourceIdentity } from "./sourceIdentity.ts";
import { planSubjectReinspection } from "./subjectReinspection.ts";
import { allowedSubjectSources, subjectInputScopeRefusal } from "./subjectInputScope.ts";
import type { AnthropicTokenUsage, PlatformAnalysisBilling } from "../_shared/providerDiagnostic.ts";
import { validateVINChecksum } from "../_shared/intelligence-layer.ts";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function isDeviceVehicleIdentifier(value: unknown): value is string {
  if (typeof value !== "string" || !/^[A-Z0-9]{8,17}$/.test(value) || !/[A-Z]/.test(value) || !/[0-9]/.test(value)) return false;
  return value.length === 17 ? /^[A-HJ-NPR-Z0-9]{17}$/.test(value) && validateVINChecksum(value) : true;
}
export interface SubjectSource {
  source_identity?: SourceIdentity;
  latitude?: number | null; longitude?: number | null; device_fingerprint?: string | null;
  id: string; user_id: string; image_url: string; file_hash: string; storage_path: string | null;
  taken_at: string | null; created_at: string; is_superseded: boolean | null; is_duplicate: boolean | null;
  is_document: boolean | null; is_sensitive: boolean | null; vision_gate_status: string | null;
  source?: string; private_subject_privacy?: any[]; private_subject_privacy_complete?: boolean;
}
export interface SubjectReading {
  id: string; image_id: string; cluster_id: string | null; is_active: boolean;
  observed_by?: string;
  confidence_basis: {
    visual_subjects_v1?: { anchor_image_id: string; envelope: SubjectEnvelope; state?: string };
    visual_subject_reading_v1?: { envelope: SubjectEnvelope };
  };
}

/** Fresh device Vision/OCR hints enrich the one bounded contextual model read.
 * They never qualify cluster membership and cannot be replayed as a completed deep read. */
export function onDeviceSourceHints(readings: SubjectReading[], sources: SubjectSource[], user: string, asOf: string) {
  const live = new Map(sources.map(source => [source.id, source])), hints = new Map<string, Record<string, unknown>>();
  for (const row of readings) {
    if (!row.is_active || row.observed_by && row.observed_by !== "visual_subject_reading_v1") continue;
    const envelope = row.confidence_basis?.visual_subject_reading_v1?.envelope;
    const rawValue = envelope?.device_source_context ?? envelope?.raw_model_reading;
    const raw = rawValue && typeof rawValue === "object" && !Array.isArray(rawValue) ? rawValue as Record<string, any> : null;
    const sourceInputs = raw?.inputs ?? envelope?.inputs;
    if (!envelope || envelope.user_id !== user || envelope.method !== SUBJECT_METHOD ||
      !raw || !["on_device_identity_read_v1", "on_device_identity_context_v1"].includes(raw.kind) ||
      typeof raw.identity_run_id !== "string" || !UUID.test(raw.identity_run_id) ||
      typeof raw.identity_method_version !== "string" ||
      !/^vehicle-identity-context-fold-v3:[A-Za-z0-9._:-]{1,80}$/.test(raw.identity_method_version) ||
      !Array.isArray(sourceInputs) || sourceInputs.length < 2 || sourceInputs.length > 3 ||
      !Array.isArray(raw.observations) || raw.observations.length !== sourceInputs.length) continue;
    const qualified = sourceInputs.every((input: any) => {
      const source = live.get(input?.image_id);
      return !!source && input.source_qualified === true && input.representation === "source" &&
        input.source_sha256 === source.file_hash && input.input_sha256 === source.file_hash &&
        qualifySubjectSource(input, source, user, envelope.read_at, asOf);
    });
    if (!qualified) continue;
    for (const observation of raw.observations) {
      if (!observation || typeof observation !== "object" || !live.has(observation.image_id) ||
        typeof observation.is_vehicle !== "boolean" || typeof observation.is_document !== "boolean" ||
        !Array.isArray(observation.labels) || !Array.isArray(observation.vin_candidates)) continue;
      const current = hints.get(observation.image_id);
      const candidate = { image_id: observation.image_id, is_vehicle: observation.is_vehicle,
        is_document: observation.is_document, labels: observation.labels.filter((value: unknown) => typeof value === "string").slice(0, 8),
        vin_candidates: observation.vin_candidates.filter((value: unknown) => isDeviceVehicleIdentifier(value)).slice(0, 4),
        method_version: raw.identity_method_version, identity_run_id: raw.identity_run_id };
      if (!current || Date.parse(envelope.read_at) > Date.parse(String(current.read_at ?? "")))
        hints.set(observation.image_id, { ...candidate, read_at: envelope.read_at });
    }
  }
  return sources.flatMap(source => {
    const hint = hints.get(source.id);
    if (!hint) return [];
    const { read_at: _readAt, ...publicHint } = hint;
    return [publicHint];
  });
}
export interface CandidateScope {
  kind: "account_associated_terminal_vehicles"; vehicle_ids: string[]; retrieved: number;
  exhausted: boolean; truncated: boolean; reference_photos_assessed: number;
  unavailable_references: string[]; global_novelty_asserted: false;
  identifier_candidates?: Array<{ vin: string; make: string | null; model: string | null }>;
  identifier_context?: { retrieved: number; supplied: number; truncated: boolean };
  subject_references?: { image_ids: string[]; coverage: Record<string, unknown> };
}
export interface SubjectEnvelope extends SubjectProjection {
  user_id: string; method: typeof SUBJECT_METHOD; run_key: string; provider: string; model: string;
  read_at: string; inputs: SubjectInput[]; candidate_scope: CandidateScope;
  raw_model_reading?: unknown;
  device_source_context?: unknown;
}
export interface CaptureProfileRequest {
  basis: "capture_session"; vin?: string; serial?: string; image_ids: string[];
  year?: number; make?: string; model?: string; evidence: Record<string, string>;
}
export interface SubjectStore {
  admitCapture?(request: CaptureProfileRequest): Promise<Record<string, unknown>>;
  sources(userId: string, ids: string[]): Promise<SubjectSource[]>;
  readings(ids: string[]): Promise<SubjectReading[]>;
  candidates(userId: string): Promise<CandidateScope>;
  context?(userId: string, fresh: SubjectSource): Promise<{ sources: SubjectSource[]; coverage: Record<string, unknown> }>;
  retainReading(imageId: string, envelope: SubjectEnvelope): Promise<string>;
  retainPrivacy?(imageId: string, envelope: Record<string, unknown>): Promise<string>;
  admission(envelope: SubjectEnvelope): Promise<ReturnType<typeof assessSubjectAdmission>>;
  ingest(imageId: string, anchorId: string, envelope: SubjectEnvelope): Promise<{ id: string; cluster_id: string | null }>;
}
export interface SubjectDependencies {
  capture?: (sources: VisionInputSource[], projectURL: string) => Promise<VisionInputCapture>;
  capturePrivacy?: (sources: VisionInputSource[]) => Promise<VisionInputCapture>;
  vision: (options: { parts: Array<{ text: string } | { imageUrl: string }>; maxTokens: number }) =>
    Promise<{ provider: string; model: string; data: unknown; usage?: AnthropicTokenUsage | null; billing?: PlatformAnalysisBilling;
      settleBilling?: (readingRetained: boolean) => Promise<PlatformAnalysisBilling> } | null>;
  now?: () => Date;
}
export interface SubjectRequest {
  user_id?: string; image_ids?: string[]; dry_run?: boolean; reuse_only?: boolean; privacy_only?: boolean;
  expected_source_hashes?: Record<string, string>;
  device_privacy_receipts?: Record<string, unknown>;
  allowed_source_hashes?: Record<string, string>;
}

export interface DeviceSourceReadRequest {
  user_id?: string; image_ids?: string[]; expected_source_hashes?: Record<string, string>;
  identity_run_id?: string; identity_method_version?: string;
  device_privacy_receipts?: Record<string, unknown>;
  observations?: Array<{ image_id: string; read_at: string; is_vehicle: boolean; is_document: boolean;
    labels: string[]; vin_candidates: string[] }>;
}

/** Retain a fresh, cheap on-device read in the existing protected reading lane.
 * This is deliberately not a subject graph: context is recorded, membership is not asserted. */
export async function retainDeviceSourceReading(store: SubjectStore, request: DeviceSourceReadRequest & { user_id: string }, now = new Date()) {
  const ids = request.image_ids, observations = request.observations;
  const privacy = request.device_privacy_receipts ?? {};
  const refused = (reason: string) => ({ method: SUBJECT_METHOD, status: "refused", refusal: reason, persisted_image_ids: [] as string[] });
  if (!Array.isArray(ids) || ids.length < 2 || ids.length > 3 || new Set(ids).size !== ids.length ||
    ids.some(id => !UUID.test(id)) || !Array.isArray(observations) || observations.length !== ids.length ||
    new Set(observations.map(item => item?.image_id)).size !== ids.length || observations.some(item =>
      !ids.includes(item.image_id) || typeof item.is_vehicle !== "boolean" || typeof item.is_document !== "boolean" ||
      !Array.isArray(item.labels) || item.labels.length > 12 || item.labels.some(label => typeof label !== "string" || label.length > 80) ||
      !Array.isArray(item.vin_candidates) || item.vin_candidates.length > 8 || item.vin_candidates.some(vin => !isDeviceVehicleIdentifier(vin)) ||
      typeof item.read_at !== "string" || !Number.isFinite(Date.parse(item.read_at)) || Date.parse(item.read_at) > now.getTime() + 5 * 60_000) ||
    typeof request.identity_run_id !== "string" || !UUID.test(request.identity_run_id) ||
    typeof request.identity_method_version !== "string" || !/^vehicle-identity-context-fold-v3:[A-Za-z0-9._:-]{1,80}$/.test(request.identity_method_version) ||
    !request.expected_source_hashes || Object.keys(request.expected_source_hashes).length !== ids.length ||
    ids.some(id => !/^[a-f0-9]{64}$/.test(request.expected_source_hashes![id] ?? "")) ||
    !privacy || typeof privacy !== "object" || Array.isArray(privacy) || Object.keys(privacy).length > 2 ||
    Object.keys(privacy).some(id => !ids.includes(id))) return refused("identity_read_scope_invalid");
  let sources = await store.sources(request.user_id, ids); const readAt = now.toISOString();
  if (sources.length !== ids.length || new Set(sources.map(source => source.id)).size !== ids.length ||
    sources.some(source => request.expected_source_hashes![source.id] !== source.file_hash ||
      sourceRefusal(source, request.user_id, readAt, privacy[source.id])))
    return refused("source_changed_or_unqualified");
  const pending = sources.filter(source => !subjectSourceAvailable(source, request.user_id, readAt));
  if (pending.length) {
    if (pending.some(source => !Object.hasOwn(privacy, source.id))) return refused("source_not_ready");
    try {
      const capture = await captureVisionInputs(pending.map(source => ({ key: source.id, image_id: source.id,
        source_url: source.image_url, storage_path: source.storage_path, expected_source_sha256: source.file_hash,
        representation: "source", required: true })));
      sources = await retainCapturedPrivacy(store, request.user_id, sources, privacy, capture, readAt);
    } catch { return refused("source_not_ready"); }
  }
  const inputs: SubjectInput[] = sources.map(source => ({ image_id: source.id, source_sha256: source.file_hash,
    input_sha256: source.file_hash, source_qualified: true, representation: "source", source_url: source.image_url,
    input_url: source.image_url, taken_at: source.taken_at, created_at: source.created_at,
    capture_context: { device_fingerprint: source.device_fingerprint ?? null,
      latitude: source.latitude ?? null, longitude: source.longitude ?? null } }));
  const byId = new Map(observations.map(item => [item.image_id, item]));
  const envelope: SubjectEnvelope = { user_id: request.user_id, method: SUBJECT_METHOD,
    run_key: request.identity_run_id, provider: "Apple Vision (on-device)", model: request.identity_method_version,
    read_at: readAt, inputs, subjects: [], frames: ids.map(image_id => { const item = byId.get(image_id)!; return {
      image_id, medium: "photograph", view: "unknown", primary_subject: item.is_document ? "none" : item.is_vehicle ? "vehicle" : "unknown", bbox: null,
    }; }), unresolved: ids.map(image_id => ({ image_id, reason: "on_device_source_read_only" })), contradictions: [], rejected_links: 0,
    candidate_scope: { kind: "account_associated_terminal_vehicles", vehicle_ids: [], retrieved: 0, exhausted: false,
      truncated: false, reference_photos_assessed: 0, unavailable_references: [], global_novelty_asserted: false },
    raw_model_reading: { kind: "on_device_identity_read_v1", identity_run_id: request.identity_run_id,
      identity_method_version: request.identity_method_version, observations } };
  const persisted: string[] = [];
  for (const id of ids) persisted.push(await store.retainReading(id, envelope));
  return { method: SUBJECT_METHOD, status: "reading_retained", persisted_image_ids: persisted,
    identity_run_id: request.identity_run_id, inference_started: false };
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
function sourceRefusal(row: SubjectSource, user: string, readAt: string = new Date().toISOString(), native?: unknown): string | null {
  if (row.user_id !== user ||
    !row.image_url || !/^[a-f0-9]{64}$/.test(row.file_hash) || observationClockMicroseconds(row.created_at) === null ||
    row.taken_at !== null && observationClockMicroseconds(row.taken_at) === null || row.private_subject_privacy_complete === false || subjectPrivacyWithdrawn(row)) return "source_unavailable";
  if (typeof row.storage_path !== "string" ||
    !new RegExp(`^users/${user}/capture-relay/${row.file_hash}/[A-Za-z0-9._-]+$`).test(row.storage_path) ||
    [".", ".."].includes(row.storage_path.split("/").at(-1)!)) return "source_unavailable";
  if (subjectSourceAvailable(row, user, readAt)) return null;
  if (!subjectSourceCanEstablishPrivacy(row, user)) {
    const current = currentIdentitySource(row), binding = row.source_identity;
    const onlyPending = !subjectPrivacyWithdrawn(row) && (binding ? binding.result.status === "held" && binding.result.reason === "source_gate_not_approved" :
      !row.is_superseded && !row.is_duplicate && !row.is_sensitive && !row.is_document);
    return onlyPending && current && !current.vision_gate_status?.startsWith("rejected") ? "source_not_ready" : "source_unavailable";
  }
  return validDevicePrivacyReceipt(native, currentIdentitySource(row), readAt) ? null : "source_not_ready";
}

function replayEnvelope(readings: SubjectReading[], sources: SubjectSource[], user: string, asOf: string): SubjectEnvelope | null {
  for (const reading of readings) {
    const wrapper = reading.confidence_basis?.visual_subjects_v1;
    const envelope = reading.confidence_basis?.visual_subject_reading_v1?.envelope ?? wrapper?.envelope;
    if (!reading.is_active || wrapper?.state === "withdrawn" || !envelope) continue;
    const raw = envelope.raw_model_reading;
    const rawReading = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
    if (rawReading?.kind === "on_device_identity_read_v1" || envelope.method !== SUBJECT_METHOD ||
      envelope.user_id !== user || !Array.isArray(envelope.inputs) || envelope.inputs.length !== sources.length ||
      !Array.isArray(envelope.subjects) || !Array.isArray(envelope.frames)) continue;
    // Protected, admitted testimony is reusable only for these exact live sources.
    if (sources.every(source => envelope.inputs.filter(input => input.image_id === source.id && input.source_qualified === true &&
      input.source_sha256 === source.file_hash && input.source_url === source.image_url &&
      sameClock(input.created_at, source.created_at) && sameClock(input.taken_at, source.taken_at) &&
      qualifySubjectSource(input, source, user, envelope.read_at, asOf)).length === 1)) return envelope;
  }
  return null;
}

/** Uses the already captured originals. No privacy model, new upload, global
 * source-state mutation or ancestor permission inheritance is involved. */
async function retainCapturedPrivacy(store: SubjectStore, user: string, sources: SubjectSource[], privacy: Record<string, unknown>,
  capture: VisionInputCapture, readAt: string, allowPending = false): Promise<SubjectSource[]> {
  if (!store.retainPrivacy || !capture.required_available) throw new Error("subject_privacy_not_ready");
  const pending = sources.filter(row => !subjectSourceAvailable(row, user, readAt) && Object.hasOwn(privacy, row.id));
  if (pending.length > 2) throw new Error("subject_privacy_scope_invalid");
  for (const row of pending) {
    if (!subjectSourceCanEstablishPrivacy(row, user)) throw new Error("subject_privacy_source_held");
    const current = currentIdentitySource(row)!;
    const native: any = privacy[row.id], pinned = capture.inputs.find(input => input.key === row.id)?.receipt;
    const length = pinned?.representation === "source" ? pinned.byte_length : pinned?.derivation?.source_byte_length;
    if (!pinned?.source_qualified || pinned.source_sha256 !== row.file_hash || length !== native?.source_byte_length ||
      !validDevicePrivacyReceipt(native, current, readAt)) throw new Error("subject_privacy_bytes_invalid");
    const family = subjectSourceFamily(row);
    await store.retainPrivacy(current.id, { method: DEVICE_PRIVACY_METHOD, purpose: PRIVATE_SUBJECT_PURPOSE,
      user_id: user, read_at: readAt, native, subjects: [], ...(family ? { source_family: family } : {}),
      inputs: [{ ...pinned, image_id: current.id, storage_path: current.storage_path, created_at: current.created_at, taken_at: current.taken_at }] });
  }
  const current = await store.sources(user, sources.map(s => s.id));
  if (current.length !== sources.length || new Set(current.map(row => row.id)).size !== sources.length || current.some(row => {
    const old = sources.find(source => source.id === row.id), pinned = capture.inputs.find(input => input.key === row.id)?.receipt;
    return !old || (!allowPending || pinned ? !!sourceRefusal(row, user, readAt) :
      !subjectSourceAvailable(row, user, readAt) && !subjectSourceCanEstablishPrivacy(row, user)) || old.file_hash !== row.file_hash || old.image_url !== row.image_url ||
      !sameClock(old.created_at, row.created_at) || !sameClock(old.taken_at, row.taken_at) || pinned &&
      !qualifySubjectSource({ ...pinned, image_id: row.id, created_at: old.created_at, taken_at: old.taken_at }, row, user, readAt, readAt);
  })) throw new Error("subject_privacy_not_qualified");
  return sources.map(source => current.find(row => row.id === source.id)!);
}

/** One bounded reading or free source qualification. Reuse precedes inference;
 * authenticated capture filing follows retained, currently qualified evidence.
 * The private consumer independently rechecks sources after admission.
 */
export async function resolveSubjectBatch(store: SubjectStore, request: SubjectRequest & { user_id: string },
  projectURL: string, dependencies: SubjectDependencies) {
  const ids = request.image_ids, now = dependencies.now ?? (() => new Date()), asOf = now().toISOString();
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > SUBJECT_BATCH_LIMIT || new Set(ids).size !== ids.length || ids.some(id => typeof id !== "string" || !UUID.test(id)) ||
    request.dry_run !== undefined && typeof request.dry_run !== "boolean" || request.reuse_only !== undefined && typeof request.reuse_only !== "boolean" ||
    request.privacy_only !== undefined && typeof request.privacy_only !== "boolean") {
    throw new Error("subject_input_scope_invalid");
  }
  const expected = request.expected_source_hashes;
  if (expected && (typeof expected !== "object" || Array.isArray(expected) || Object.keys(expected).length !== ids.length || ids.some(id => !/^[a-f0-9]{64}$/.test(expected[id] ?? "")))) {
    throw new Error("subject_expected_sources_invalid");
  }
  const privacy = request.device_privacy_receipts ?? {};
  if (!privacy || typeof privacy !== "object" || Array.isArray(privacy) || Object.keys(privacy).length > 2 ||
    Object.keys(privacy).some(id => !ids.includes(id)) || JSON.stringify(privacy).length > 16384) throw new Error("subject_privacy_scope_invalid");
  const base = { method: SUBJECT_METHOD, persisted_image_ids: [] as string[], deferred_image_ids: [] as string[],
    unresolved: [] as Array<{ image_id: string; reason: string }> };
  const allowed = allowedSubjectSources(request.allowed_source_hashes, ids, expected);
  if (!allowed.valid) return { ...base, status: "refused", refusal: "allowed_source_scope_invalid" };
  // An audited alias does not widen the caller's pixel/proof scope. Keep the
  // immutable reading ID and its independently qualified current leaf explicit.
  const scopeRefusal = (rows: SubjectSource[]) => subjectInputScopeRefusal(allowed.hashes, rows.flatMap(row => {
    const current = currentIdentitySource(row);
    return current && current.id !== row.id ? [row, { id: current.id, file_hash: current.file_hash }] : [row];
  }));
  let sources = await store.sources(request.user_id, ids);
  if (sources.length !== ids.length || new Set(sources.map(row => row.id)).size !== ids.length ||
    sources.some(row => !ids.includes(row.id))) return { ...base, status: "refused", refusal: "source_unavailable" };
  if (expected && sources.some(source => expected[source.id] !== source.file_hash)) {
    return { ...base, status: "refused", refusal: "source_changed" };
  }
  const freshScopeRefusal = scopeRefusal(sources);
  if (freshScopeRefusal) return { ...base, status: "refused", refusal: freshScopeRefusal };
  if (request.privacy_only) {
    // Completed local checks are independent testimony, not a paid interpretation.
    // Keep the existing two-original proof bound; a three-view session can qualify
    // two then one before its single model request. Never mark analysis completed.
    if (ids.length > 2 || request.reuse_only || request.dry_run) return { ...base, status: "refused", refusal: "subject_privacy_scope_invalid" };
    if (sources.some(source => sourceRefusal(source, request.user_id, asOf, privacy[source.id])))
      return { ...base, status: "refused", refusal: "source_not_ready" };
    const pending = sources.filter(source => !subjectSourceAvailable(source, request.user_id, asOf));
    if (pending.length) {
      const capture = await (dependencies.capturePrivacy ?? captureVisionInputs)(pending.map(source => ({
        key: source.id, image_id: source.id, source_url: source.image_url, storage_path: source.storage_path,
        expected_source_sha256: source.file_hash, representation: "source", required: true,
      })));
      sources = await retainCapturedPrivacy(store, request.user_id, sources, privacy, capture, now().toISOString());
    }
    return { ...base, status: "privacy_qualified", qualified_image_ids: sources.map(source => source.id), inference_started: false };
  }
  const held = sources.map(row => ({ image_id: row.id, reason: request.reuse_only && subjectSourceCanEstablishPrivacy(row, request.user_id)
    ? null : sourceRefusal(row, request.user_id, asOf, privacy[row.id]) })).filter(row => row.reason);
  if (held.length) return { ...base, status: "refused", refusal: held.some(row => row.reason === "source_unavailable") ? "source_unavailable" : "source_not_ready", unresolved: held };

  const fresh = new Map(sources.map(source => [source.id, source]));
  const nativeFor = (source: SubjectSource) => privacy[source.id] ?? privacy[ids.find(id => sourceRoot(fresh.get(id)) === sourceRoot(source)) ?? ""];
  let consumedIds = [...ids], contextCoverage: Record<string, unknown> = {};
  let localSourceHints: ReturnType<typeof onDeviceSourceHints> = [];
  let readings = await store.readings(ids);
  let envelope: SubjectEnvelope | null = null;
  let providerUsage: AnthropicTokenUsage | null = null;
  let providerBilling: PlatformAnalysisBilling | null = null;
  let settleBilling: ((readingRetained: boolean) => Promise<PlatformAnalysisBilling>) | undefined;
  // A retained reading may include server-selected context and consume only the
  // first requested fresh photo. Requalify that exact scope before selecting new
  // context; the deferred photo remains new work on the phone.
  for (const reading of readings) {
    const prior = reading.confidence_basis?.visual_subject_reading_v1?.envelope ?? reading.confidence_basis?.visual_subjects_v1?.envelope;
    if (!reading.is_active || !prior || prior.user_id !== request.user_id || prior.method !== SUBJECT_METHOD ||
      !Array.isArray(prior.inputs) || prior.inputs.length < 2 || prior.inputs.length > SUBJECT_BATCH_LIMIT ||
      !prior.inputs.some(input => sourceAliases(fresh.get(ids[0])).includes(input.image_id)) || !prior.inputs.every(input => UUID.test(input.image_id)) ||
      ids.length === 3 && !ids.every(id => prior.inputs.some(input => sourceAliases(fresh.get(id)).includes(input.image_id)))) continue;
    const retainedSources = await store.sources(request.user_id, prior.inputs.map(input => input.image_id));
    if (retainedSources.length !== prior.inputs.length) continue;
    const retainedScopeRefusal = scopeRefusal(retainedSources);
    if (retainedScopeRefusal) return { ...base, status: "refused", refusal: retainedScopeRefusal };
    if (retainedSources.some(row => sourceRefusal(row, request.user_id, asOf) ||
      expected && Object.hasOwn(expected, row.id) && expected[row.id] !== row.file_hash)) continue;
    const reusable = replayEnvelope([reading], retainedSources, request.user_id, asOf);
    if (reusable) {
      envelope = reusable; sources = retainedSources;
      consumedIds = ids.filter(id => prior.inputs.some(input => sourceAliases(fresh.get(id)).includes(input.image_id)));
      break;
    }
  }
  // Historical native reinspection is reuse-only. First prove that an exact old
  // paid reading and current correction scope exist; only then verify at most two
  // purpose-pending originals. Never reach the model path, even after a race.
  if (!envelope && request.reuse_only && !request.dry_run) {
    for (const reading of readings) {
      const plan = await planSubjectReinspection(store, request.user_id, reading, asOf);
      if (!plan || plan.candidate.image_ids.length !== ids.length || !ids.every(id => plan.candidate.image_ids.includes(id)) ||
        expected && plan.sources.some(source => expected[source.id] !== source.file_hash)) continue;
      const privacyScopeRefusal = scopeRefusal(plan.sources);
      if (privacyScopeRefusal) return { ...base, status: "refused", refusal: privacyScopeRefusal };
      const pending = plan.sources.filter(row => !subjectSourceAvailable(row, request.user_id, asOf) && Object.hasOwn(privacy, row.id));
      if (pending.some(row => !validDevicePrivacyReceipt(privacy[row.id], currentIdentitySource(row), asOf)))
        return { ...base, status: "refused", refusal: "source_not_ready" };
      if (!pending.length) return { ...base, status: "refused", refusal: "source_privacy_partial", reinspection_candidate: plan.candidate };
      const visionSources: VisionInputSource[] = pending.map(row => ({ key: row.id, image_id: row.id, source_url: row.image_url,
        storage_path: row.storage_path, expected_source_sha256: row.file_hash, representation: "source", required: true }));
      try {
        const capture = await (dependencies.capturePrivacy ?? captureVisionInputs)(visionSources);
        sources = await retainCapturedPrivacy(store, request.user_id, plan.sources, privacy, capture, now().toISOString(), true);
        const currentReadings = await store.readings(ids);
        const stillCurrent = currentReadings.filter(row => row.id === reading.id);
        if (stillCurrent.length === 1) {
          const remaining = await planSubjectReinspection(store, request.user_id, stillCurrent[0], now().toISOString());
          if (remaining) return { ...base, status: "refused", refusal: "source_privacy_partial", reinspection_candidate: remaining.candidate };
        }
        envelope = replayEnvelope(stillCurrent, sources, request.user_id, now().toISOString());
        if (envelope) consumedIds = [...ids];
      } catch { return { ...base, status: "refused", refusal: "source_not_ready" }; }
      break;
    }
  }
  const reused = !!envelope;
  if (envelope) localSourceHints = onDeviceSourceHints(readings, sources, request.user_id, now().toISOString());
  // Replayed context is subject to the same explicit caller scope, even when
  // reuse would make no provider call. Refuse before retained/membership writes.
  const replayScopeRefusal = scopeRefusal(sources);
  if (replayScopeRefusal) return { ...base, status: "refused", refusal: replayScopeRefusal };
  if (!envelope && request.reuse_only) return { ...base, status: "refused", refusal:
    sources.some(source => !subjectSourceAvailable(source, request.user_id, asOf) && subjectSourceCanEstablishPrivacy(source, request.user_id))
      ? "source_not_ready" : "retained_reading_unavailable" };
  if (!envelope) {
    if (ids.length <= 2 && store.context) {
      const context = await store.context(request.user_id, fresh.get(ids[0])!);
      const qualified = context.sources.filter(source => sourceRoot(source) !== sourceRoot(fresh.get(ids[0])) && !sourceRefusal(source, request.user_id, asOf));
      if (qualified.length && qualified.length <= 2 && new Set(qualified.map(source => source.id)).size === qualified.length) {
        sources = context.coverage.capture_neighbor_first === true && qualified.length === 1
          ? [fresh.get(ids[0])!, ...qualified, ...ids.slice(1).map(id => fresh.get(id)!)].slice(0, SUBJECT_BATCH_LIMIT)
          : [fresh.get(ids[0])!, ...qualified];
        consumedIds = ids.filter(id => sources.some(source => sourceRoot(source) === sourceRoot(fresh.get(id))));
        contextCoverage = context.coverage;
      }
    }
    // Attribution aliases are one source. Preserve any existing exact anchor;
    // otherwise use its immutable root receipt ID for future continuity.
    readings = await store.readings(sources.map(source => source.id));
    const selected: string[] = [], roots = new Set<string>();
    for (const source of sources) {
      const root = sourceRoot(source) ?? source.id;
      if (roots.has(root)) continue;
      roots.add(root);
      const aliases = sourceAliases(source);
      const anchors = new Set(readings.filter(row => row.is_active && aliases.includes(row.image_id) &&
        row.confidence_basis?.visual_subjects_v1?.state !== "withdrawn")
        .map(row => row.confidence_basis?.visual_subjects_v1?.anchor_image_id).filter((id): id is string => !!id && aliases.includes(id)));
      if (anchors.size > 1) return { ...base, status: "refused", refusal: "source_membership_conflict" };
      selected.push([...anchors][0] ?? root);
    }
    sources = await store.sources(request.user_id, selected);
    if (sources.length !== selected.length || sources.some(source => sourceRefusal(source, request.user_id, asOf, nativeFor(source))))
      return { ...base, status: "refused", refusal: "source_unavailable" };
    consumedIds = ids.filter(id => sources.some(source => sourceRoot(source) === sourceRoot(fresh.get(id))));
    if (sources.length < 2) return { ...base, status: "refused", refusal: "source_needs_corresponding_view" };
    // Server-selected context must be pinned as explicitly as requested fresh
    // sources. No object, renderer or provider callback has run at this point.
    const actualScopeRefusal = scopeRefusal(sources);
    if (actualScopeRefusal) return { ...base, status: "refused", refusal: actualScopeRefusal };
    readings = await store.readings(sources.map(source => source.id));
    const candidate_scope = await store.candidates(request.user_id);
    const contextIds = sources.filter(source => !ids.includes(source.id)).map(source => source.id);
    if (contextIds.length) candidate_scope.subject_references = { image_ids: contextIds, coverage: contextCoverage };
    const visionSources: VisionInputSource[] = sources.map(row => ({ key: row.id, image_id: row.id,
      source_url: row.image_url, storage_path: row.storage_path, expected_source_sha256: row.file_hash,
      representation: "source", required: true }));
    const capture = await (dependencies.capture ?? captureTrustedJPEGInputs)(visionSources, projectURL);
    // Qualification uses these same already-captured originals. It has no model
    // callback, no second image fetch and changes no global gate/processing state.
    const pending = sources.filter(row => !subjectSourceAvailable(row, request.user_id, now().toISOString()));
    if (pending.length) {
      if (request.dry_run || !store.retainPrivacy || !capture.required_available) return { ...base, status: "refused", refusal: "source_not_ready" };
      try { sources = await retainCapturedPrivacy(store, request.user_id, sources,
        Object.fromEntries(sources.map(source => [source.id, nativeFor(source)])), capture, now().toISOString()); }
      catch { return { ...base, status: "refused", refusal: "source_not_ready" }; }
    }
    localSourceHints = onDeviceSourceHints(readings, sources, request.user_id, now().toISOString());
    // Three frames include per-frame witnesses and pairwise contradictions. The
    // live three-frame pilot exhausted 1,600 tokens with an unreadable result.
    // 4096 remains inside the same two-cent default preflight reservation.
    // Keep account context inside the existing platform's 8 KB text ceiling.
    // Serial strings aid worn-mark reading; catalog labels are unnecessary here.
    const serials = [...new Set((candidate_scope.identifier_candidates ?? []).map(candidate => candidate.vin))].sort();
    const supplied: string[] = [];
    for (const serial of serials) {
      if (new TextEncoder().encode(JSON.stringify([...supplied, serial])).length > 3200) break;
      supplied.push(serial);
    }
    candidate_scope.identifier_context = { retrieved: serials.length, supplied: supplied.length, truncated: supplied.length < serials.length };
    const result = await runCapturedVision(visionSources, capture, () => [
      { text: SUBJECT_PROMPT },
      ...(localSourceHints.length ? [{ text: `Fresh on-device source context (bounded retrieval hints, not identity or membership proof): ${JSON.stringify(localSourceHints)}` }] : []),
      { text: `Known account serial candidates (fallible lookup context, not proof; coverage=${JSON.stringify(candidate_scope.identifier_context)}): ${JSON.stringify(supplied)}` },
      { text: `Capture relations: ${JSON.stringify(sources.flatMap((a, i) => sources.slice(i + 1).map(b => {
        return { left_image_id: a.id, right_image_id: b.id, ...captureRelation(a, b) };
      })))}` },
      ...sources.flatMap(source => [{ text: `Photo image_id=${source.id}; capture_clock=${source.taken_at ?? "unknown"}` }, { image_key: source.id }]),
    ], dependencies.vision, { limits: { output_tokens: 4096 } });
    if (!result.model_result) return { ...base, status: "refused", refusal: result.refusal,
      unavailable_inputs: capture.unavailable, candidate_scope,
      ...(result.provider_diagnostics?.length ? { provider_diagnostics: result.provider_diagnostics } : {}),
      ...(result.provider_attempt_coverage ? { provider_attempt_coverage: result.provider_attempt_coverage } : {}) };
    providerUsage = result.model_result.usage ?? null;
    providerBilling = result.model_result.billing ?? null;
    settleBilling = result.model_result.settleBilling;
    const inputs: SubjectInput[] = sources.map(source => {
      const receipt = capture.inputs.find(input => input.key === source.id)!.receipt;
      const prior = readings.filter(reading => reading.image_id === source.id && reading.is_active && reading.cluster_id &&
        reading.confidence_basis?.visual_subjects_v1?.envelope?.user_id === request.user_id);
      return { ...receipt, image_id: source.id, source_sha256: receipt.source_sha256!, taken_at: source.taken_at,
        created_at: source.created_at, capture_context: { latitude: source.latitude ?? null,
          longitude: source.longitude ?? null, device_fingerprint: source.device_fingerprint ?? null }, existing_cluster_id: prior.length === 1 ? prior[0].cluster_id : null,
        existing_anchor_image_id: prior.length === 1 ? prior[0].confidence_basis.visual_subjects_v1!.anchor_image_id : null };
    });
    const projection = projectDepictedSubjects(result.model_result.data, inputs);
    const read_at = now().toISOString();
    const run_key = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify({
      method: SUBJECT_METHOD, inputs: inputs.map(input => [input.image_id, input.source_sha256, input.input_sha256]),
      provider: result.model_result.provider, model: result.model_result.model, read_at,
    }))).then(value => [...new Uint8Array(value)].map(v => v.toString(16).padStart(2, "0")).join(""));
    envelope = { ...projection, user_id: request.user_id, method: SUBJECT_METHOD, run_key,
      provider: result.model_result.provider, model: result.model_result.model, read_at, inputs, candidate_scope,
      raw_model_reading: result.model_result.data,
      ...(localSourceHints.length >= 2 && new Set(localSourceHints.map(hint => `${hint.identity_run_id}|${hint.method_version}`)).size === 1
        ? { device_source_context: { kind: "on_device_identity_context_v1",
            identity_run_id: localSourceHints[0].identity_run_id, identity_method_version: localSourceHints[0].method_version,
            inputs: inputs.filter(input => localSourceHints.some(hint => hint.image_id === input.image_id)),
            observations: localSourceHints } } : {}) };
  }
  const writeScopeRefusal = scopeRefusal(sources);
  if (writeScopeRefusal) return { ...base, status: "refused", refusal: writeScopeRefusal };
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
  if (settleBilling) providerBilling = await settleBilling(retained.length > 0);
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
  const captureResults: Array<Record<string, unknown>> = [];
  if (!request.dry_run && !membershipHeld && !failures.length && store.admitCapture) {
    for (const session of envelope.capture_sessions ?? []) {
      if (!session.member_image_ids.every(id => retained.includes(id))) continue;
      const localAnchor = localSourceHints.find(hint => hint.image_id === session.anchor_image_id &&
        hint.vin_candidates instanceof Array && hint.vin_candidates.includes(session.identifier.text));
      const localRun = typeof localAnchor?.identity_run_id === "string" ? localAnchor.identity_run_id : null;
      const localMethod = typeof localAnchor?.method_version === "string" ? localAnchor.method_version : null;
      const localSupport = !!localAnchor && session.member_image_ids.every(id => {
        const hint = localSourceHints.find(item => item.image_id === id && item.identity_run_id === localRun && item.method_version === localMethod);
        return !!hint && !hint.is_document && (id === session.anchor_image_id || hint.is_vehicle === true);
      });
      if (!localSupport || !localRun || !localMethod) {
        captureResults.push({ status: "on_device_identity_context_unavailable", anchor_image_id: session.anchor_image_id });
        continue;
      }
      try {
        // A cached interpretation never inherits present source/metadata authority.
        const current = await store.sources(request.user_id, session.member_image_ids);
        if (current.length !== session.member_image_ids.length || current.some(source => {
          const input = envelope!.inputs.find(i => i.image_id === source.id);
          return !input || !qualifySubjectSource(input, source, request.user_id!, envelope!.read_at, now().toISOString());
        })) { captureResults.push({ status: "source_changed", anchor_image_id: session.anchor_image_id }); continue; }
        const anchor = envelope.inputs.find(input => input.image_id === session.anchor_image_id)!;
        const result = await store.admitCapture({ basis: "capture_session", vin: session.identifier.text,
          image_ids: session.member_image_ids, ...(session.asserted_identity.make ? { make: session.asserted_identity.make } : {}),
          ...(session.asserted_identity.model_family ? { model: session.asserted_identity.model_family } : {}),
          evidence: { context_method: "vin_capture_session_v1", anchor_image_id: session.anchor_image_id,
            anchor_source_sha256: anchor.source_sha256, identifier_read: session.identifier.text,
            identifier_legibility: session.identifier.legibility, edit_distance: "0", context_basis: session.basis,
            identity_run_id: localRun, identity_method_version: localMethod,
            interpretation_run_key: envelope.run_key, provider: envelope.provider, model: envelope.model,
            read_at: envelope.read_at } });
        captureResults.push({ ...result, anchor_image_id: session.anchor_image_id });
        const filing = result.filing as { results?: Array<{ image_id: string; status: string }> } | undefined;
        if (result.status === "busy" || filing?.results?.some(row => ["busy", "deferred"].includes(row.status))) {
          for (const image_id of session.member_image_ids) failures.push({ image_id, reason: "capture_profile_filing_retry" });
        }
      } catch {
        captureResults.push({ status: "filing_retry", anchor_image_id: session.anchor_image_id });
        for (const image_id of session.member_image_ids) failures.push({ image_id, reason: "capture_profile_filing_retry" });
      }
    }
  }
  const canonicalFiled = captureResults.flatMap(result => {
    const filing = result.filing as { results?: Array<{ image_id: string; status: string }> } | undefined;
    return (filing?.results ?? []).filter(row => ["filed", "already"].includes(row.status) &&
      envelope!.inputs.some(input => input.image_id === row.image_id)).map(row => row.image_id);
  });
  const supported = new Set([...(membershipHeld ? [] : envelope.subjects).flatMap(subject => subject.member_image_ids), ...canonicalFiled]);
  const heldMembership = membershipHeld ? envelope.subjects.flatMap(subject => subject.member_image_ids)
    .map(image_id => ({ image_id, reason: admissionReason ?? "subject_admission_held" })) : [];
  const inputForFresh = (id: string) => envelope!.inputs.find(input => sourceAliases(fresh.get(id)).includes(input.image_id))?.image_id;
  const forFresh = (values: string[]) => consumedIds.filter(id => { const input = inputForFresh(id); return !!input && values.includes(input); });
  const mappedFailures = failures.flatMap(failure => consumedIds.filter(id => id === failure.image_id || inputForFresh(id) === failure.image_id)
    .map(image_id => ({ ...failure, image_id })));
  const failureById = new Map(mappedFailures.map(row => [row.image_id, row]));
  const mappedUnresolved = [...envelope.unresolved.filter(row => !canonicalFiled.includes(row.image_id)), ...heldMembership].flatMap(row => consumedIds.filter(id => inputForFresh(id) === row.image_id)
    .map(image_id => ({ ...row, image_id })));
  return { ...base, status: failures.length ? "partial" : membershipHeld ? "unresolved" : reused ? "cached" : envelope.subjects.length || canonicalFiled.length ? "resolved" : "unresolved",
    ...(captureResults.length ? { capture_profile_results: captureResults } : {}),
    dry_run: request.dry_run ?? false, persisted_image_ids: forFresh([...persisted, ...canonicalFiled]).filter(id => !failureById.has(id)), subjects: membershipHeld ? [] : envelope.subjects,
    deferred_image_ids: ids.filter(id => !consumedIds.includes(id)),
    source_lineage: consumedIds.map(image_id => ({ requested_image_id: image_id, input_image_id: inputForFresh(image_id), identity: inspectSourceIdentity(fresh.get(image_id)) })),
    admitted_image_ids: persisted, canonical_filed_image_ids: canonicalFiled, input_image_ids: envelope.inputs.map(input => input.image_id),
    retained_reading_image_ids: forFresh(retained), retry_without_inference: retained.length + persisted.length > 0,
    unresolved: [...mappedUnresolved.filter(row => !failureById.has(row.image_id)),
      ...[...failureById.values()].filter(row => consumedIds.includes(row.image_id))], candidate_scope: envelope.candidate_scope,
    coverage: { grain: "source_photos", assessed: sources.length, eligible: supported.size,
      excluded: sources.length - supported.size, as_of: envelope.read_at, truncated: false },
    reading: { provider: envelope.provider, model: envelope.model, read_at: envelope.read_at, run_key: envelope.run_key, reused,
      provider_usage: providerUsage, billing: providerBilling },
  };
}

export function supabaseSubjectStore(client: any, identityClient?: any): SubjectStore {
  const loaded = new Map<string, SubjectSource>();
  let owner: string | null = null;
  const aliasScope = (ids: string[]) => [...new Set(ids.flatMap(id => sourceAliases(loaded.get(id))))];
  const columns = "id,image_id,cluster_id,observed_by,observed_at,is_active,superseded_by,confidence_basis";
  async function memberships(ids: string[]) {
    if (!owner) throw new Error("subject_reading_scope_missing");
    const scope = aliasScope(ids);
    const result = await client.from("image_observations").select(columns).eq("observed_by", SUBJECT_METHOD)
      .eq("confidence_basis->visual_subjects_v1->envelope->>user_id", owner)
      .or("superseded_by.is.null,confidence_basis->visual_subjects_v1->>state.eq.withdrawn")
      .in("image_id", scope).limit(129);
    if (result.error || !Array.isArray(result.data)) throw new Error("subject_reading_read_failed");
    return result.data;
  }
  return {
    ...(identityClient ? { async admitCapture(request: CaptureProfileRequest) {
      const result = await identityClient.rpc("device_create_vehicle_profile", { p_profile: request });
      if (result.error || !result.data || typeof result.data !== "object") throw new Error("capture_profile_filing_failed");
      const profile = result.data as Record<string, unknown>;
      const vehicleId = profile.vehicle_id;
      // The live VIN trigger has no configured URL/service key, so it silently
      // skips this canonical enrichment. Invoke the already-deployed, free NHTSA
      // decoder through its service-only owner after the user-scoped profile RPC.
      // Never write decoded fields from this image-reading function itself.
      if (profile.status === "created" && profile.replay !== true && typeof vehicleId === "string" &&
        UUID.test(vehicleId) && typeof request.vin === "string" && /^[A-HJ-NPR-Z0-9]{17}$/.test(request.vin)) {
        const decoded = await client.functions.invoke("decode-vin-and-update", {
          body: { vehicle_id: vehicleId, vin: request.vin },
        });
        const data = decoded.data && typeof decoded.data === "object" ? decoded.data as Record<string, unknown> : {};
        profile.identity_seed = decoded.error || data.success !== true
          ? { status: "decode_unavailable" }
          : { status: Array.isArray(data.decoded_fields) && data.decoded_fields.length > 0 ? "decoded" : "no_new_fields",
              fields: Array.isArray(data.decoded_fields) ? data.decoded_fields.filter((field): field is string => typeof field === "string").slice(0, 32) : [] };
      }
      return profile;
    } } : {}),
    async sources(user, ids) {
      if (owner !== null && owner !== user) loaded.clear();
      owner = user;
      const lookup = await loadSourceIdentities(client, user, ids);
      const data = await hydrateSubjectPrivacy(client, user, lookup.sources) as SubjectSource[];
      for (const source of data) loaded.set(source.id, source);
      return data;
    },
    async retainPrivacy(imageId, envelope) {
      const { data, error } = await client.rpc("ingest_image_observation", {
        p_image_id: imageId, p_vehicle_id: null, p_role: "part", p_confidence: 0,
        p_observed_by: DEVICE_PRIVACY_METHOD, p_agent_version: DEVICE_PRIVACY_METHOD,
        p_confidence_basis: { [DEVICE_PRIVACY_METHOD]: { state: "active", envelope } },
        p_is_high_confidence_subject: false, p_layer_version: { method: DEVICE_PRIVACY_METHOD, policy_version: 1 },
      });
      if (error || typeof data !== "string" || !UUID.test(data)) throw new Error("subject_privacy_storage_failed");
      return data;
    },
    async readings(ids) {
      if (!owner) throw new Error("subject_reading_scope_missing");
      const [heads, paid] = await Promise.all([
        memberships(ids),
        client.from("image_observations").select(columns).eq("observed_by", "visual_subject_reading_v1")
          .eq("confidence_basis->visual_subject_reading_v1->envelope->>user_id", owner)
          .eq("is_active", true).is("superseded_by", null).in("image_id", aliasScope(ids))
          .order("observed_at", { ascending: false }).order("id", { ascending: false }).limit(101),
      ]);
      if (paid.error || !Array.isArray(paid.data)) throw new Error("subject_reading_read_failed");
      if (heads.length > 128 || paid.data.length > 100) throw new Error("subject_membership_scope_unassessed");
      return [...heads, ...paid.data];
    },
    async admission(envelope) {
      const ids = envelope.inputs.map(input => input.image_id);
      const sources = await this.sources(envelope.user_id, ids), heads = await memberships(ids);
      const clusterIds = [...new Set(envelope.subjects.map(subject => subject.existing_cluster_id).filter((id): id is string => !!id))];
      const profiles = [];
      for (const id of clusterIds) profiles.push(...(await readSubjectProfiles(client, envelope.user_id, { cluster_id: id })).subjects);
      return assessSubjectAdmission(envelope, envelope.user_id, { sources, readings: heads.slice(0, 128),
        readings_complete: heads.length <= 128 && subjectPrivacyLookupComplete(sources), profiles, as_of: new Date().toISOString() });
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
      const identifiers: NonNullable<CandidateScope["identifier_candidates"]> = [];
      for (let i = 0; i < ids.length; i += 200) {
        const chunk = ids.slice(i, i + 200), result = await client.from("vehicles").select("id,primary_image_url,vin,make,model").in("id", chunk).limit(200);
        if (result.error || !Array.isArray(result.data) || result.data.length !== chunk.length) throw new Error("subject_candidate_read_failed");
        unavailable.push(...result.data.filter((row: any) => !row.primary_image_url).map((row: any) => row.id));
        identifiers.push(...result.data.filter((row: any) => typeof row.vin === "string" && /^[A-Z0-9]{8,17}$/.test(row.vin.toUpperCase().trim()))
          .map((row: any) => ({ vin: row.vin.toUpperCase().trim(), make: typeof row.make === "string" ? row.make.slice(0, 40) : null,
            model: typeof row.model === "string" ? row.model.slice(0, 60) : null })));
      }
      return { kind: "account_associated_terminal_vehicles", vehicle_ids: ids, retrieved: ids.length,
        exhausted: data.length <= 500, truncated: data.length > 500, reference_photos_assessed: 0,
        unavailable_references: unavailable, global_novelty_asserted: false, identifier_candidates: identifiers };
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
