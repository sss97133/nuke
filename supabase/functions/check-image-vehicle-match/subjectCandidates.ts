import { observationClockMicroseconds as clock } from "../_shared/observationContentHash.ts";
import { qualifySubjectSource, readSubjectProfiles, type SubjectProfile } from "./subjectReader.ts";
import { captureRelation, SUBJECT_METHOD } from "./subjects.ts";
import { loadSourceIdentities, sourceAliases, sourceRoot, sourceIdentityLineage } from "./sourceIdentity.ts";
import { hydrateSubjectPrivacy, subjectPrivacyLookupComplete } from "./subjectPrivacy.ts";
import { lineageReadingAfterWithdrawals } from "./sourceLineage.ts";

const RAW_METHOD = "visual_subject_reading_v1", RAW_LIMIT = 32, HEAD_LIMIT = 64;
const record = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const OBSERVATION_COLUMNS = "id,image_id,cluster_id,observed_by,observed_at,is_active,superseded_by,confidence_basis";
type ContextRole = "supported_anchor" | "unresolved_exterior";
export interface ResolutionContext {
  image_ids: string[];
  coverage: { assessed: number; eligible: number; excluded: number; truncated: boolean; as_of: string;
    context_available: boolean; fresh_batch_size: 1 | 2; capture_neighbor_first?: boolean;
    selected: Array<{ image_id: string; role: ContextRole; basis: "bounded_least_co_read" | "capture_proximity" }>;
    source_lookup?: Record<string, unknown>;
    scope: "latest_24_supported_subjects_and_32_retained_frames"; global_novelty_asserted: false };
}

function exterior(frame: unknown): boolean {
  if (!record(frame) || frame.medium !== "photograph" || frame.primary_subject !== "vehicle" || frame.view !== "exterior" ||
    !Array.isArray(frame.bbox) || frame.bbox.length !== 4 || !frame.bbox.every((n: unknown) => typeof n === "number" && Number.isFinite(n))) return false;
  const [x, y, w, h] = frame.bbox;
  return x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= 1.001 && y + h <= 1.001;
}

/** A retained per-image view can be a retrieval candidate, never admission or
 * physical identity authority. "Unresolved" here means no current accepted
 * membership: a raw model's proposed subject can have failed every intake call.
 * Later membership corrections override it in projectResolutionContext. */
export function qualifiedUnresolvedFrame(row: unknown, source: unknown, userId: string, asOf: string): boolean {
  if (!record(row) || row.observed_by !== RAW_METHOD || row.is_active !== true || row.superseded_by !== null || !uuid(row.image_id)) return false;
  const e = row.confidence_basis?.[RAW_METHOD]?.envelope;
  const read = clock(e?.read_at), observed = clock(row.observed_at), as = clock(asOf);
  if (!record(e) || e.method !== SUBJECT_METHOD || e.user_id !== userId || typeof e.provider !== "string" || !e.provider ||
    typeof e.model !== "string" || !e.model || read === null || observed === null || as === null || read > as + 300_000_000n ||
    observed > as + 300_000_000n || !Array.isArray(e.inputs) || e.inputs.length < 1 || e.inputs.length > 14 ||
    !Array.isArray(e.frames) || e.frames.length > 14 || !Array.isArray(e.subjects) || e.subjects.length > 14) return false;
  const input = e.inputs.filter((i: any) => record(i) && i.image_id === row.image_id);
  const frames = e.frames.filter((f: any) => record(f) && f.image_id === row.image_id);
  return input.length === 1 && qualifySubjectSource(input[0], source, userId, e.read_at, asOf) && frames.length === 1 && exterior(frames[0]);
}

/** Deterministic rotation prevents an ID/time ordering from always selecting
 * the same equally exposed references. It conveys no identity evidence. */
function rotation(fresh: string, candidate: string): number {
  let value = 2166136261;
  for (const char of `${fresh}|${candidate}`) value = Math.imul(value ^ char.charCodeAt(0), 16777619) >>> 0;
  return value;
}

/** Pure selector for injected assays. Profiles must be current reader output;
 * sources and membership heads come from the same bounded owner-scoped read. */
export function projectResolutionContext(userId: string, freshImageId: string, state: {
  profiles: SubjectProfile[]; raw_readings: unknown[]; membership_heads: unknown[]; sources: unknown[];
  membership_complete: boolean; truncated: boolean; as_of: string;
}): ResolutionContext {
  if (!uuid(userId) || !uuid(freshImageId) || clock(state.as_of) === null) throw new Error("subject_context_scope_invalid");
  const sources = new Map<string, any>();
  for (const source of state.sources) if (record(source) && uuid(source.id)) {
    if (sources.has(source.id)) sources.set(source.id, null); else sources.set(source.id, source);
  }
  const heads = new Map<string, any[]>();
  for (const row of state.membership_heads) if (record(row) && row.observed_by === SUBJECT_METHOD && row.superseded_by === null) {
    heads.set(row.image_id, [...(heads.get(row.image_id) ?? []), row]);
  }
  const exposures = new Map<string, Set<string>>();
  for (const row of state.raw_readings) {
    if (!record(row)) continue;
    const e = row.confidence_basis?.[RAW_METHOD]?.envelope;
    if (e?.user_id !== userId || e?.method !== SUBJECT_METHOD || !Array.isArray(e.inputs) || e.inputs.length > 14) continue;
    const key = typeof e.run_key === "string" ? e.run_key : `${e.read_at}|${e.inputs.map((i: any) => i?.image_id).sort().join("|")}`;
    for (const input of e.inputs) if (record(input) && uuid(input.image_id)) {
      const reads = exposures.get(input.image_id) ?? new Set<string>(); reads.add(key); exposures.set(input.image_id, reads);
    }
  }
  const familyHeads = (id: string) => state.membership_heads.filter((row: any) => record(row) && row.observed_by === SUBJECT_METHOD &&
    row.superseded_by === null && sourceAliases(sources.get(id)).includes(row.image_id)) as any[];
  const afterWithdrawals = (id: string, readAt: unknown) => {
    const lineage = sourceIdentityLineage(sources.get(id));
    return !lineage || typeof readAt === "string" && lineageReadingAfterWithdrawals(lineage, readAt,
      state.membership_heads.filter((row: any) => record(row) && row.observed_by === SUBJECT_METHOD &&
        row.confidence_basis?.[SUBJECT_METHOD]?.envelope?.user_id === userId && row.confidence_basis?.[SUBJECT_METHOD]?.state === "withdrawn")
        .map((row: any) => ({ source_image_id: row.image_id, observed_at: row.observed_at })), state.membership_complete);
  };
  const sameFresh = (id: string) => id === freshImageId || sourceRoot(sources.get(id)) === sourceRoot(sources.get(freshImageId));
  const pool = new Map<string, ContextRole>(), assessed = new Set<string>();
  for (const profile of state.profiles) {
    const id = profile.anchor_image_id;
    if (!uuid(id) || sameFresh(id)) continue;
    assessed.add(id);
    const rows = familyHeads(id), source = sources.get(id);
    // readSubjectProfiles already checked support. Recheck that the source and
    // its terminal anchor membership have not changed between those reads.
    if (!state.membership_complete || !source || rows.length < 1 || rows.some(row => row.is_active !== true ||
      row.cluster_id !== profile.id || row.confidence_basis?.[SUBJECT_METHOD]?.state === "withdrawn" ||
      row.confidence_basis?.[SUBJECT_METHOD]?.anchor_image_id !== id)) continue;
    const current = rows.some(row => {
      const e = row.confidence_basis?.[SUBJECT_METHOD]?.envelope;
      const inputs = Array.isArray(e?.inputs) ? e.inputs.filter((i: any) => i?.image_id === id) : [];
      return inputs.length === 1 && e.user_id === userId && qualifySubjectSource(inputs[0], source, userId, e.read_at, state.as_of) && afterWithdrawals(id, e.read_at);
    });
    if (current) pool.set(id, "supported_anchor");
  }
  for (const row of state.raw_readings) {
    if (!record(row) || !uuid(row.image_id) || sameFresh(row.image_id)) continue;
    assessed.add(row.image_id);
    if (state.membership_complete && !familyHeads(row.image_id).length &&
      qualifiedUnresolvedFrame(row, sources.get(row.image_id), userId, state.as_of) &&
      afterWithdrawals(row.image_id, row.confidence_basis?.[RAW_METHOD]?.envelope?.read_at)) pool.set(row.image_id, "unresolved_exterior");
  }
  const rank = (a: string, b: string) => (exposures.get(a)?.size ?? 0) - (exposures.get(b)?.size ?? 0) ||
    rotation(freshImageId, a) - rotation(freshImageId, b) || a.localeCompare(b);
  const anchors = [...pool.keys()].filter(id => pool.get(id) === "supported_anchor").sort(rank);
  const unresolved = [...pool.keys()].filter(id => pool.get(id) === "unresolved_exterior").sort(rank);
  const freshSource = sources.get(freshImageId);
  const captureNeighbors = freshSource ? [...pool.keys()].map(id => ({ id, relation: captureRelation(freshSource, sources.get(id)) }))
    .filter(row => row.relation.seconds_apart !== null && row.relation.seconds_apart <= 900 &&
      row.relation.meters_apart !== null && row.relation.meters_apart <= 100)
    .sort((a, b) => a.relation.seconds_apart! - b.relation.seconds_apart! || rank(a.id, b.id)) : [];
  const captureFirst = captureNeighbors.length > 0;
  const selected = captureFirst ? [captureNeighbors[0].id]
    : anchors.length && unresolved.length ? [anchors[0], unresolved[0]] : [...anchors, ...unresolved].slice(0, 2);
  // Duplicate source bytes cannot provide a second view, even with another row ID.
  const hashes = new Set<string>(), familyRoots = new Set<string>();
  const freshRoot = sourceRoot(sources.get(freshImageId)); if (freshRoot) familyRoots.add(freshRoot);
  const freshHash = sources.get(freshImageId)?.file_hash; if (freshHash) hashes.add(freshHash);
  const image_ids = selected.filter(id => { const hash = sources.get(id)?.file_hash, root = sourceRoot(sources.get(id)) ?? id; if (!hash || hashes.has(hash) || familyRoots.has(root)) return false; hashes.add(hash); familyRoots.add(root); return true; });
  return { image_ids, coverage: { assessed: new Set([...assessed].map(id => sourceRoot(sources.get(id)) ?? id)).size, eligible: new Set([...pool.keys()].map(id => sourceRoot(sources.get(id)) ?? id)).size, excluded: new Set([...assessed].map(id => sourceRoot(sources.get(id)) ?? id)).size - new Set([...pool.keys()].map(id => sourceRoot(sources.get(id)) ?? id)).size,
    truncated: state.truncated || !subjectPrivacyLookupComplete([...sources.values()].filter(Boolean)) || pool.size > image_ids.length, as_of: state.as_of, context_available: image_ids.length > 0,
    fresh_batch_size: captureFirst ? 2 : image_ids.length ? 1 : 2,
    ...(captureFirst ? { capture_neighbor_first: true } : {}),
    selected: image_ids.map(image_id => ({ image_id, role: pool.get(image_id)!,
      basis: captureFirst ? "capture_proximity" as const : "bounded_least_co_read" as const })),
    scope: "latest_24_supported_subjects_and_32_retained_frames", global_novelty_asserted: false } };
}

/** Bounded account-scoped retrieval. Family discovery and protected privacy
 * lookups have independent explicit caps; incomplete lookup stays opaque. */
export async function selectResolutionContext(supabase: any, userId: string, freshImageId: string): Promise<ResolutionContext> {
  if (!uuid(userId) || !uuid(freshImageId)) throw new Error("subject_context_scope_invalid");
  const profiles = await readSubjectProfiles(supabase, userId, { limit: 24 });
  const as_of = new Date().toISOString();
  const { data: raw, error: rawError } = await supabase.from("image_observations").select(OBSERVATION_COLUMNS)
    .eq("observed_by", RAW_METHOD).eq("confidence_basis->visual_subject_reading_v1->envelope->>user_id", userId)
    .eq("is_active", true).is("superseded_by", null).order("observed_at", { ascending: false }).order("id", { ascending: false }).limit(RAW_LIMIT + 1);
  if (rawError || !Array.isArray(raw)) throw new Error("subject_context_read_failed");
  const readings = raw.slice(0, RAW_LIMIT);
  const ids = [...new Set([freshImageId, ...profiles.subjects.map(p => p.anchor_image_id), ...readings.map((r: any) => r.image_id).filter(uuid)])];
  const lookup = await loadSourceIdentities(supabase, userId, ids);
  const sources = await hydrateSubjectPrivacy(supabase, userId, lookup.sources);
  const { data: heads, error: headError } = await supabase.from("image_observations").select(OBSERVATION_COLUMNS).eq("observed_by", SUBJECT_METHOD)
    .eq("confidence_basis->visual_subjects_v1->envelope->>user_id", userId)
    .or("superseded_by.is.null,confidence_basis->visual_subjects_v1->>state.eq.withdrawn")
    .in("image_id", lookup.alias_image_ids).order("observed_at", { ascending: false }).order("id", { ascending: false }).limit(HEAD_LIMIT + 1);
  if (headError || !Array.isArray(heads)) throw new Error("subject_context_read_failed");
  const complete = lookup.complete && subjectPrivacyLookupComplete(sources) && heads.length <= HEAD_LIMIT;
  const result = projectResolutionContext(userId, freshImageId, { profiles: profiles.subjects, raw_readings: readings,
    membership_heads: heads.slice(0, HEAD_LIMIT), sources, membership_complete: complete,
    truncated: profiles.coverage.truncated || raw.length > RAW_LIMIT || !complete, as_of });
  result.coverage.source_lookup = lookup.coverage;
  return result;
}
