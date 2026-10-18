import { observationClockMicroseconds as clock } from "../_shared/observationContentHash.ts";
import { qualifySubjectSource, qualifySubjectSourceCustody } from "./subjectReader.ts";
import { loadSourceIdentities, sourceAliases, currentIdentitySource, inspectSourceIdentity } from "./sourceIdentity.ts";
import { hydrateSubjectPrivacy, subjectSourceAvailable, subjectSourceCanEstablishPrivacy, subjectPrivacyLookupComplete } from "./subjectPrivacy.ts";

// Private source projection in the existing read_subjects owner. The pure projector invokes
// no query, model or writer. A source card is never a one-photo vehicle profile.
const RAW = "visual_subject_reading_v1", SUBJECT = "visual_subjects_v1";
const ORIGIN = "https://qkgaybvrernstplzjaam.supabase.co";
const record = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const sha = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const text = (v: unknown, limit = 160): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= limit;

export interface SourceInboxState {
  /** At most24 current own source rows in a keyset page, regardless of vehicle_id. */
  page: unknown[];
  /** Current rows for the page and every retained reading input; no object fetch. */
  sources: unknown[];
  /** All terminal heads, including inactive withdrawals; never active-only lookup. */
  raw_heads: unknown[];
  membership_heads: unknown[];
  raw_heads_complete: boolean;
  membership_heads_complete: boolean;
  dependencies_complete: boolean;
  page_more: boolean;
  as_of: string;
}

export interface InboxReading {
  id: string;
  receipt_image_id: string;
  input_key: string;
  provider: string;
  model: string;
  read_at: string;
  observed_at: string;
  input: { source_sha256: string; input_sha256: string; representation: "source" | "derivative" };
  frame: { medium: string; primary_subject: string; view: string; bbox: number[] | null } | null;
  unresolved_reasons: string[];
}

/** Visibility policy for this private source reader, not a claim that bytes were independently
 * consumed by a model. Legacy filename paths can point at different bytes, so they expose an
 * explicit unqualified source card rather than an unverified picture. */
function sourceVisibility(source: Record<string, any>, userId: string, asOf: bigint) {
  if (source.image_url === "" && source.storage_path === null && source.file_hash === null) {
    return { state: "metadata_only", reason: "pixels_not_retained_reason_unknown" } as const;
  }
  const flags = ["is_superseded", "is_duplicate", "is_document", "is_sensitive"];
  if (flags.some(key => !Object.hasOwn(source, key))) return { state: "unqualified", reason: "source_flags_unassessed" } as const;
  if (!subjectPrivacyLookupComplete([source])) return { state: "held", reason: "source_scope_unassessed" } as const;
  if (!subjectSourceAvailable(source, userId, new Date(Number(asOf / 1000n)).toISOString())) {
    return { state: "held", reason: subjectSourceCanEstablishPrivacy(source, userId) ? "source_not_ready" : "source_withdrawn_or_held" } as const;
  }
  const created = clock(source.created_at), taken = source.taken_at === null ? null : clock(source.taken_at);
  if (created === null || created > asOf + 300_000_000n || source.taken_at !== null && taken === null) {
    return { state: "unqualified", reason: "source_clocks_unqualified" } as const;
  }
  if (!sha(source.file_hash) || typeof source.storage_path !== "string" ||
    !new RegExp(`^users/${userId}/capture-relay/${source.file_hash}/[A-Za-z0-9._-]+$`).test(source.storage_path) ||
    [".", ".."].includes(source.storage_path.split("/").at(-1) ?? "") ||
    source.image_url !== `${ORIGIN}/storage/v1/object/public/vehicle-photos/${source.storage_path}`) {
    return { state: "unqualified", reason: "source_locator_unpinned" } as const;
  }
  return { state: "ready", reason: null } as const;
}

/** Retain individual frame interpretations, including unknown/detail/nonvehicle views. Exterior
 * qualification in subjectCandidates is a context-retrieval rule, not an inbox visibility rule.
 * All peer dependencies qualify before presenting any contextual interpretation. */
function currentRawReading(row: unknown, imageId: string, sources: Map<string, any>, userId: string, asOf: bigint): InboxReading | null {
  if (!record(row) || !sourceAliases(sources.get(imageId)).includes(row.image_id) || row.observed_by !== RAW || row.agent_version !== RAW ||
    row.vehicle_id !== null || row.cluster_id !== null || row.role !== "part" || row.is_active !== true || row.superseded_by !== null || !uuid(row.id)) return null;
  const wrapper = row.confidence_basis?.[RAW], envelope = wrapper?.envelope;
  const read = clock(envelope?.read_at), observed = clock(row.observed_at);
  if (!record(wrapper) || (wrapper.state ?? "active") !== "active" ||
    typeof wrapper.input_key !== "string" || !/^[a-f0-9]{32}$/.test(wrapper.input_key) ||
    !record(envelope) || envelope.method !== SUBJECT || envelope.user_id !== userId || !text(envelope.provider) || !text(envelope.model) ||
    !text(envelope.run_key, 128) || read === null || observed === null || read > asOf + 300_000_000n || observed > asOf + 300_000_000n ||
    !Array.isArray(envelope.inputs) || envelope.inputs.length < 2 || envelope.inputs.length > 3 ||
    !Array.isArray(envelope.frames) || envelope.frames.length > 3 || !Array.isArray(envelope.unresolved) || envelope.unresolved.length > 3 ||
    !Array.isArray(envelope.subjects) || envelope.subjects.length > 3) return null;
  const ids = envelope.inputs.map((input: any) => input?.image_id);
  if (!ids.every(uuid) || new Set(ids).size !== ids.length || !ids.includes(row.image_id) ||
    !envelope.inputs.every((input: any) => qualifySubjectSource(input, sources.get(input.image_id), userId, envelope.read_at, new Date(Number(asOf / 1000n)).toISOString()))) return null;
  const frames = envelope.frames.filter((frame: any) => record(frame) && frame.image_id === row.image_id);
  if (frames.length > 1) return null;
  const candidate = frames[0];
  let frame: InboxReading["frame"] = null;
  if (candidate) {
    if (!["photograph", "other"].includes(candidate.medium) || !["vehicle", "multiple", "none", "unknown"].includes(candidate.primary_subject) ||
      !["exterior", "interior", "engine", "undercarriage", "detail", "unknown"].includes(candidate.view)) return null;
    const bbox = candidate.bbox;
    if (bbox !== null && (!Array.isArray(bbox) || bbox.length !== 4 || !bbox.every((v: unknown) => typeof v === "number" && Number.isFinite(v)) ||
      bbox[0] < 0 || bbox[1] < 0 || bbox[2] <= 0 || bbox[3] <= 0 || bbox[0] + bbox[2] > 1.001 || bbox[1] + bbox[3] > 1.001)) return null;
    frame = { medium: candidate.medium, primary_subject: candidate.primary_subject, view: candidate.view, bbox };
  }
  const reasons = envelope.unresolved.filter((entry: any) => record(entry) && entry.image_id === row.image_id && text(entry.reason));
  const input = envelope.inputs.find((value: any) => value.image_id === row.image_id);
  return { id: row.id, receipt_image_id: row.image_id, input_key: wrapper.input_key, provider: envelope.provider, model: envelope.model,
    read_at: envelope.read_at, observed_at: row.observed_at,
    input: { source_sha256: input.source_sha256, input_sha256: input.input_sha256, representation: input.representation },
    frame, unresolved_reasons: reasons.map((entry: any) => entry.reason) };
}

function retainedContextMetadata(row: any, imageId: string, sources: Map<string, any>, userId: string, asOf: string) {
  if (!record(row) || !sourceAliases(sources.get(imageId)).includes(row.image_id) || row.observed_by !== RAW ||
    row.agent_version !== RAW || row.is_active !== true || row.superseded_by !== null || !uuid(row.id) ||
    row.vehicle_id !== null || row.cluster_id !== null || row.role !== "part") return null;
  const wrapper = row.confidence_basis?.[RAW], e = wrapper?.envelope;
  if (!record(wrapper) || (wrapper.state ?? "active") !== "active" || !/^[a-f0-9]{32}$/.test(wrapper.input_key ?? "") ||
    !record(e) || e.user_id !== userId || e.method !== SUBJECT || !text(e.provider) || !text(e.model) ||
    clock(e.read_at) === null || clock(e.read_at)! > clock(asOf)! + 300_000_000n || clock(row.observed_at) === null ||
    clock(row.observed_at)! > clock(asOf)! + 300_000_000n ||
    !Array.isArray(e.inputs) || e.inputs.length < 2 || e.inputs.length > 3 ||
    new Set(e.inputs.map((input: any) => input?.image_id)).size !== e.inputs.length ||
    !e.inputs.some((input: any) => input?.image_id === row.image_id) ||
    !e.inputs.every((input: any) => uuid(input?.image_id) &&
      qualifySubjectSourceCustody(input, sources.get(input.image_id), userId, e.read_at) &&
      (subjectSourceAvailable(sources.get(input.image_id), userId, asOf) || subjectSourceCanEstablishPrivacy(sources.get(input.image_id), userId)))) return null;
  return { id: row.id, receipt_image_id: row.image_id, input_key: wrapper.input_key,
    provider: e.provider, model: e.model, read_at: e.read_at, observed_at: row.observed_at,
    qualification: "retained_context_not_current_interpretation" as const };
}

export function projectSourceInbox(userId: string, state: SourceInboxState) {
  const asOf = clock(state.as_of);
  if (!uuid(userId) || asOf === null || state.page.length > 24 || state.sources.length > 312 ||
    state.raw_heads.length > 96 || state.membership_heads.length > 96) throw new Error("source_inbox_scope_invalid");
  const sources = new Map<string, any>();
  for (const source of state.sources) if (record(source) && uuid(source.id)) {
    sources.set(source.id, sources.has(source.id) ? null : source);
  }
  const own = state.page.filter((source): source is Record<string, any> => record(source) && source.user_id === userId && uuid(source.id));
  const counts = new Map<string, number>();
  for (const source of own) counts.set(source.id, (counts.get(source.id) ?? 0) + 1);
  const photos = own.filter(source => counts.get(source.id) === 1).map(source => {
    // A later source read may see a withdrawal or changed object after carrier pagination.
    // Its current gate wins; the earlier carrier cannot supply pixels or model qualification.
    const current = sources.get(source.id);
    const live = record(current) && current.user_id === userId ? current : null;
    const visibility = live ? sourceVisibility(live, userId, asOf)
      : { state: "unqualified", reason: "source_current_row_unavailable" } as const;
    const heads = state.raw_heads.filter((row): row is Record<string, any> => record(row) && sourceAliases(live).includes(row.image_id) &&
      row.observed_by === RAW && row.superseded_by === null);
    const byContext = new Map<string, any[]>();
    for (const head of heads) {
      const key = `${head.image_id}|${head.confidence_basis?.[RAW]?.input_key ?? ""}`;
      if (typeof key === "string") byContext.set(key, [...(byContext.get(key) ?? []), head]);
    }
    const complete = state.raw_heads_complete && state.dependencies_complete;
    const readings = visibility.state === "ready" && complete ? [...byContext.values()]
      .filter(rows => rows.length === 1).map(rows => currentRawReading(rows[0], source.id, sources, userId, asOf))
      .filter((value): value is InboxReading => value !== null) : [];
    const retained_contexts = complete ? [...byContext.values()].filter(rows => rows.length === 1)
      .map(rows => retainedContextMetadata(rows[0], source.id, sources, userId, state.as_of)).filter(value => value !== null) : [];
    const withdrawn = heads.filter(row => row.is_active !== true || row.confidence_basis?.[RAW]?.state === "withdrawn").length;
    const memberships = state.membership_heads.filter((row): row is Record<string, any> => record(row) && sourceAliases(live).includes(row.image_id) &&
      row.observed_by === SUBJECT);
    const membership_state = !state.membership_heads_complete ? "not_assessed" : !memberships.length ? "none_recorded"
      : memberships.some(row => row.is_active !== true || row.confidence_basis?.[SUBJECT]?.state === "withdrawn") ? "withdrawn_or_conflicting" : "recorded_not_qualified_here";
    return { id: source.id, grain: "source_photo" as const, identity: null, grouping_asserted: false as const,
      source_state: visibility.state, source_reason: visibility.reason, image_url: visibility.state === "ready" ? currentIdentitySource(live)!.image_url : null,
      source_identity: inspectSourceIdentity(live), retained_contexts,
      source_sha256: sha(live?.file_hash) ? live!.file_hash : null,
      created_at: clock(live?.created_at) !== null ? live!.created_at : null,
      taken_at: clock(live?.taken_at) !== null ? live!.taken_at : null,
      attached_vehicle_id_context: uuid(currentIdentitySource(live)?.vehicle_id) ? currentIdentitySource(live)!.vehicle_id : null,
      subject_analysis_state: !complete ? "not_assessed" : readings.length ? "current_readings" : !heads.length ? "not_read"
        : withdrawn === heads.length ? "reading_withdrawn" : "reading_no_longer_qualified",
      readings, reading_context_coverage: { grain: "terminal_reading_heads", assessed: heads.length,
        qualified: readings.length, withdrawn, unqualified_or_conflicting: heads.length - readings.length - withdrawn,
        complete }, membership_state };
  });
  const ready = photos.filter(photo => photo.source_state === "ready").length;
  return { photos, coverage: { grain: "owner_source_page", assessed: own.length, returned: photos.length, displayable: ready,
    without_displayable_pixels: photos.length - ready, ambiguous_source_rows: own.length - photos.length, as_of: state.as_of,
    truncated: state.page_more || !state.raw_heads_complete || !state.membership_heads_complete || !state.dependencies_complete || !subjectPrivacyLookupComplete(state.sources.filter(record)),
    account_total: null, accessible_device_library_total: null, inference_started: false } };
}

export interface SourceInboxOptions { limit?: number; cursor?: string; image_id?: string }
const SOURCE_COLUMNS = "id,user_id,vehicle_id,image_url,file_hash,storage_path,taken_at,created_at,is_superseded,is_duplicate,is_document,is_sensitive,vision_gate_status";
const HEAD_COLUMNS = "id,image_id,vehicle_id,cluster_id,role,observed_by,agent_version,observed_at,is_active,superseded_by,confidence_basis";

function decodeCursor(value: string): { created_at: string | null; id: string } {
  try {
    if (value.length > 512 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error();
    const cursor = JSON.parse(atob(value));
    if (!record(cursor) || Object.keys(cursor).sort().join(",") !== "created_at,id" || !uuid(cursor.id) ||
      cursor.created_at !== null && clock(cursor.created_at) === null) throw new Error();
    return { created_at: cursor.created_at, id: cursor.id };
  } catch { throw new Error("source_inbox_cursor_invalid"); }
}

/** Owner is already authorized by read_subjects. This path only reads source testimony and
 * protected terminal heads. It does not call context selection, admission, inference or RPCs.
 * Cursor follows carriers, including opaque held rows; an empty displayed subset is not EOF.
 */
export async function readSourceInbox(supabase: any, userId: string, options: SourceInboxOptions = {}) {
  if (!uuid(userId) || !record(options) || options.image_id !== undefined && !uuid(options.image_id) ||
    options.image_id && options.cursor || options.limit !== undefined && (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 24)) {
    throw new Error("source_inbox_scope_invalid");
  }
  const limit = options.image_id ? 1 : options.limit ?? 24;
  const cursor = options.cursor === undefined ? null : decodeCursor(options.cursor);
  let query = supabase.from("vehicle_images").select(SOURCE_COLUMNS).eq("user_id", userId)
    .order("created_at", { ascending: false, nullsFirst: false }).order("id", { ascending: false });
  if (options.image_id) query = query.eq("id", options.image_id);
  if (cursor?.created_at === null) query = query.is("created_at", null).lt("id", cursor.id);
  else if (cursor) {
    // The clock parser accepts only a numeric PostgreSQL timestamp grammar. Quoted literals
    // preserve offsets/microseconds without permitting filter expression injection.
    const stamp = `"${cursor.created_at}"`;
    query = query.or(`created_at.lt.${stamp},and(created_at.eq.${stamp},id.lt.${cursor.id}),created_at.is.null`);
  }
  const { data: carriers, error: pageError } = await query.limit(limit + 1);
  if (pageError || !Array.isArray(carriers) || carriers.some(row => !record(row) || row.user_id !== userId || !uuid(row.id))) {
    throw new Error("source_inbox_page_read_failed");
  }
  const page = carriers.slice(0, limit), pageMore = !options.image_id && carriers.length > limit;
  const ids = page.map(row => row.id), as_of = new Date().toISOString();
  const pageLookup = await loadSourceIdentities(supabase, userId, ids);
  const heads = (method: string) => supabase.from("image_observations").select(HEAD_COLUMNS)
    .eq("observed_by", method).eq(`confidence_basis->${method}->envelope->>user_id`, userId)
    .or(`superseded_by.is.null,confidence_basis->${method}->>state.eq.withdrawn`).in("image_id", pageLookup.alias_image_ids)
    .order("observed_at", { ascending: false }).order("id", { ascending: false }).limit(97);
  const [{ data: raw, error: rawError }, { data: memberships, error: membershipError }] = ids.length
    ? await Promise.all([heads(RAW), heads(SUBJECT)]) : [{ data: [], error: null }, { data: [], error: null }];
  if (rawError || membershipError || !Array.isArray(raw) || !Array.isArray(memberships)) throw new Error("source_inbox_heads_read_failed");
  const readings = raw.slice(0, 96), dependencyIds = new Set<string>(ids);
  for (const row of readings) {
    const inputs = row?.confidence_basis?.[RAW]?.envelope?.inputs;
    if (Array.isArray(inputs) && inputs.length <= 3) for (const input of inputs) if (uuid(input?.image_id)) dependencyIds.add(input.image_id);
  }
  if (dependencyIds.size > 256) throw new Error("source_inbox_dependencies_exceed_budget");
  const lookup = await loadSourceIdentities(supabase, userId, [...dependencyIds]);
  const sources = await hydrateSubjectPrivacy(supabase, userId, lookup.sources);
  const result = projectSourceInbox(userId, { page, sources, raw_heads: readings, membership_heads: memberships.slice(0, 96),
    raw_heads_complete: raw.length <= 96, membership_heads_complete: memberships.length <= 96,
    dependencies_complete: pageLookup.complete && lookup.complete && subjectPrivacyLookupComplete(sources), page_more: pageMore, as_of });
  const source_lookup = { page: pageLookup.coverage, dependencies: lookup.coverage, privacy_alias_limit: 256,
    raw_head_limit: 96, membership_head_limit: 96 };
  let next_cursor: string | null = null;
  if (pageMore) {
    const last = page.at(-1)!;
    if (last.created_at !== null && clock(last.created_at) === null) throw new Error("source_inbox_carrier_clock_invalid");
    next_cursor = btoa(JSON.stringify({ created_at: last.created_at, id: last.id }));
  }
  return { ...result, source_lookup, next_cursor };
}
