import { observationClockMicroseconds as clock } from "../_shared/observationContentHash.ts";
import { qualifiedSubjectInput, SUBJECT_METHOD, type SubjectInput } from "./subjects.ts";

const ORIGIN = "https://qkgaybvrernstplzjaam.supabase.co";
const HEAD_LIMIT = 256, DETAIL_LIMIT = 60;
const record = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const sha = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const text = (v: unknown, max = 80) => typeof v === "string" ? v.trim().slice(0, max) : "";
const equalClock = (a: unknown, b: unknown) => a === null && b === null || clock(a) !== null && clock(a) === clock(b);
const identifying = new Set(["identifier", "body_geometry", "fixed_wear", "configuration"]);
const pair = (a: string, b: string) => [a, b].sort().join("|");
const countCoverage = (assessed: number, eligible: number, as_of: string, truncated: boolean) =>
  ({ assessed, eligible, excluded: assessed - eligible, as_of, truncated });

export interface SubjectProfile {
  id: string;
  anchor_image_id: string;
  label: string;
  identity_status: "unresolved";
  image_count: number;
  cover_image_url: string;
  observed_at: string;
  images: Array<{ id: string; image_url: string; taken_at: string | null }>;
  coverage: ReturnType<typeof countCoverage>;
  asserted_identity: { make?: string; model_family?: string; badge_text?: string };
}

/** Source qualification for private reads and service replay. Clock comparisons
 * retain PostgreSQL microseconds. Profile membership never qualifies its source.
 */
export function qualifySubjectSource(input: unknown, live: unknown, userId: string, readAt: unknown): boolean {
  if (!uuid(userId) || !record(input) || !record(live) || live.user_id !== userId || input.image_id !== live.id ||
    live.vision_gate_status !== "approved" || live.is_superseded === true || live.is_duplicate === true ||
    live.is_document === true || live.is_sensitive === true || !text(live.image_url, 8192) ||
    !["is_superseded", "is_duplicate", "is_document", "is_sensitive"].every(key => Object.hasOwn(live, key)) ||
    !/^https?:\/\//.test(live.image_url) || !sha(live.file_hash) || input.source_sha256 !== live.file_hash ||
    !equalClock(input.created_at, live.created_at) || !equalClock(input.taken_at, live.taken_at)) return false;
  const read = clock(readAt), created = clock(live.created_at);
  if (read === null || created === null || read < created) return false;
  try { if (!qualifiedSubjectInput(input as SubjectInput)) return false; } catch { return false; }
  // Current object URLs cannot silently replace the pinned source reference.
  if (input.source_url !== live.image_url) return false;
  if (input.representation === "source") return true;
  const d = input.derivation;
  const path = live.storage_path;
  if (!record(d) || typeof path !== "string" ||
    !new RegExp(`^users/${userId}/capture-relay/${live.file_hash}/[A-Za-z0-9._-]+$`).test(path) ||
    [".", ".."].includes(path.split("/").at(-1)!) || d.trusted_origin !== ORIGIN ||
    d.source_object_path !== `vehicle-photos/${path}` || !record(d.parameters) ||
    Object.keys(d.parameters).sort().join(",") !== "height,quality,resize,width" ||
    !["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"].includes(d.source_mime_type)) return false;
  const captured = clock(d.source_captured_at);
  return captured !== null && captured <= read;
}

function primaryFrame(frame: unknown, anchor: boolean): boolean {
  if (!record(frame) || frame.medium !== "photograph" || frame.primary_subject !== "vehicle" ||
    (anchor && frame.view !== "exterior") || !Array.isArray(frame.bbox) || frame.bbox.length !== 4 ||
    !frame.bbox.every((n: unknown) => typeof n === "number" && Number.isFinite(n))) return false;
  const [x, y, w, h] = frame.bbox;
  return x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= 1.001 && y + h <= 1.001;
}

export interface QualifiedSubjectReading {
  row: Record<string, any>;
  envelope: Record<string, any>;
  subject: Record<string, any>;
  input: Record<string, any>;
  anchor: string;
  read_at: string;
}

/** Requalifies protected observation testimony, rather than a cluster's cached
 * creation envelope/count. Withdrawn or superseded heads never supply evidence.
 */
export function qualifyCurrentSubjectReading(
  row: unknown, live: unknown, userId: string, asOf: string,
): QualifiedSubjectReading | null {
  if (!record(row) || row.observed_by !== SUBJECT_METHOD || row.is_active !== true || row.superseded_by !== null ||
    row.vehicle_id !== null || !["subject", "part"].includes(row.role) || !text(row.agent_version, 200) ||
    !uuid(row.image_id) || !uuid(row.cluster_id)) return null;
  const wrapper = row.confidence_basis?.[SUBJECT_METHOD], envelope = wrapper?.envelope;
  const asOfClock = clock(asOf), read = clock(envelope?.read_at), observed = clock(row.observed_at);
  if (!record(wrapper) || !record(envelope) || (wrapper.state ?? "active") !== "active" ||
    (wrapper.cluster_id !== undefined && wrapper.cluster_id !== row.cluster_id) || !uuid(wrapper.anchor_image_id) ||
    envelope.method !== SUBJECT_METHOD || envelope.user_id !== userId || !text(envelope.provider, 200) || !text(envelope.model, 200) ||
    asOfClock === null || read === null || observed === null || observed > asOfClock + 300_000_000n || read > asOfClock + 300_000_000n ||
    !Array.isArray(envelope.inputs) || envelope.inputs.length < 1 || envelope.inputs.length > 14 ||
    !Array.isArray(envelope.subjects) || envelope.subjects.length < 1 || envelope.subjects.length > 14 ||
    !Array.isArray(envelope.frames) || envelope.frames.length > 14) return null;
  const subjects = envelope.subjects.filter((s: unknown) => record(s) && s.anchor_image_id === wrapper.anchor_image_id);
  const inputs = envelope.inputs.filter((i: unknown) => record(i) && i.image_id === row.image_id);
  if (subjects.length !== 1 || inputs.length !== 1 || !qualifySubjectSource(inputs[0], live, userId, envelope.read_at)) return null;
  const subject = subjects[0], members = subject.member_image_ids;
  if (subject.physical_identity !== "unresolved" || !Array.isArray(members) || members.length < 2 || members.length > 14 ||
    !members.every(uuid) || new Set(members).size !== members.length || !members.includes(row.image_id) ||
    !members.includes(wrapper.anchor_image_id) || !Array.isArray(subject.correspondences) || subject.correspondences.length > 91 ||
    !Array.isArray(subject.contradictions) || subject.contradictions.length !== 0) return null;
  const frames = envelope.frames.filter((f: unknown) => record(f) && f.image_id === row.image_id);
  if (frames.length !== 1 || !primaryFrame(frames[0], row.image_id === wrapper.anchor_image_id)) return null;
  if (envelope.subjects.some((s: unknown) => record(s) && s !== subject && Array.isArray(s.member_image_ids) &&
    s.member_image_ids.includes(row.image_id))) return null;
  return { row, envelope, subject, input: inputs[0], anchor: wrapper.anchor_image_id, read_at: envelope.read_at };
}

const OBSERVATION_COLUMNS = "id,image_id,cluster_id,vehicle_id,role,observed_by,agent_version,observed_at,is_active,superseded_by,confidence_basis";
const SOURCE_COLUMNS = "id,user_id,image_url,file_hash,storage_path,taken_at,created_at,is_superseded,is_duplicate,is_document,is_sensitive,vision_gate_status";

/** Caller supplies an already authorized account. No cache is used: privacy,
 * withdrawals, byte changes and supporting graph changes are checked every read.
 * Carrier pagination is not a count of supported subjects or the account fleet.
 */
export async function readSubjectProfiles(
  supabase: any, userId: string, opts: { cluster_id?: string; limit?: number; offset?: number } = {},
) {
  if (!uuid(userId) || (opts.cluster_id !== undefined && !uuid(opts.cluster_id))) throw new Error("subject_read_scope_invalid");
  const limit = Math.min(24, Math.max(1, Number.isSafeInteger(opts.limit) ? opts.limit! : 24));
  const offset = Number.isSafeInteger(opts.offset) && opts.offset! >= 0 ? opts.offset! : 0;
  const asOf = new Date().toISOString();
  let query = supabase.from("emergent_vehicle_clusters").select("id,created_at")
    .eq("resolution_evidence->visual_subjects_v1->>user_id", userId).eq("is_active", true)
    .is("resolved_to_vehicle_id", null).order("created_at", { ascending: false }).order("id", { ascending: false });
  if (opts.cluster_id) query = query.eq("id", opts.cluster_id);
  const { data: carrierRows, error: carrierError } = await query.range(opts.cluster_id ? 0 : offset, opts.cluster_id ? 0 : offset + limit);
  if (carrierError || !Array.isArray(carrierRows)) throw new Error("subject_carriers_read_failed");
  const carriers = carrierRows.slice(0, opts.cluster_id ? 1 : limit);
  const carrierMore = carrierRows.length > carriers.length;
  const next_offset = carrierMore ? offset + carriers.length : null;
  const empty = () => ({ subjects: [] as SubjectProfile[], coverage: countCoverage(0, 0, asOf, carrierMore), next_offset });
  if (!carriers.length) return empty();
  const headsQuery = (q: any) => q.eq("observed_by", SUBJECT_METHOD)
    .eq("confidence_basis->visual_subjects_v1->envelope->>user_id", userId).is("superseded_by", null)
    .order("observed_at", { ascending: false }).order("id", { ascending: false }).limit(HEAD_LIMIT + 1);
  const { data: candidateRows, error: candidateError } = await headsQuery(supabase.from("image_observations")
    .select(OBSERVATION_COLUMNS).in("cluster_id", carriers.map((row: any) => row.id)));
  if (candidateError || !Array.isArray(candidateRows)) throw new Error("subject_observations_read_failed");
  const candidates = candidateRows.slice(0, HEAD_LIMIT);
  const imageIds = [...new Set(candidates.map((row: any) => row.image_id).filter(uuid))];
  if (!imageIds.length) return empty();
  // Include inactive terminal heads: a withdrawal cannot resurrect an older
  // active interpretation from another producer version or cluster.
  const { data: currentRows, error: currentError } = await headsQuery(supabase.from("image_observations")
    .select(OBSERVATION_COLUMNS).in("image_id", imageIds));
  if (currentError || !Array.isArray(currentRows)) throw new Error("subject_current_read_failed");
  // A capped terminal-head read cannot establish absence of a withdrawal or a
  // competing producer head for any selected image. Coverage is still bounded,
  // but no profile is qualified from that incomplete correction scope.
  if (currentRows.length > HEAD_LIMIT) return { subjects: [] as SubjectProfile[],
    coverage: countCoverage(imageIds.length, 0, asOf, true), next_offset };
  const current = currentRows.slice(0, HEAD_LIMIT);
  const { data: sourceRows, error: sourceError } = await supabase.from("vehicle_images")
    .select(SOURCE_COLUMNS).eq("user_id", userId).in("id", imageIds).limit(HEAD_LIMIT);
  if (sourceError || !Array.isArray(sourceRows)) throw new Error("subject_sources_read_failed");
  const sources = new Map<string, any>(sourceRows.map((row: any) => [row.id, row]));
  const headByImage = new Map<string, any[]>();
  for (const row of current) headByImage.set(row.image_id, [...(headByImage.get(row.image_id) ?? []), row]);
  const qualified = new Map<string, QualifiedSubjectReading>();
  for (const id of imageIds) {
    const heads = headByImage.get(id) ?? [];
    const activeClusters = new Set(heads.filter(row => row.is_active).map(row => row.cluster_id));
    if (!heads.length || heads.some(row => row.is_active !== true || row.confidence_basis?.[SUBJECT_METHOD]?.state === "withdrawn") ||
      activeClusters.size !== 1) continue;
    const reading = qualifyCurrentSubjectReading(heads[0], sources.get(id), userId, asOf);
    if (reading) qualified.set(id, reading);
  }
  const headTruncated = candidateRows.length > HEAD_LIMIT || currentRows.length > HEAD_LIMIT;
  const subjects: SubjectProfile[] = [];
  for (const carrier of carriers) {
    const assessed = new Set(candidates.filter((row: any) => row.cluster_id === carrier.id).map((row: any) => row.image_id));
    const readings = [...qualified.values()].filter(reading => reading.row.cluster_id === carrier.id && assessed.has(reading.row.image_id));
    const anchors = new Set(readings.map(reading => reading.anchor));
    if (anchors.size !== 1) continue;
    const anchor = [...anchors][0], anchorReading = qualified.get(anchor);
    if (!anchorReading || anchorReading.row.cluster_id !== carrier.id || anchorReading.anchor !== anchor) continue;
    const members = new Set(readings.map(reading => reading.row.image_id)), edges = new Map<string, [string, string]>();
    const contradictions: Array<[string, string]> = [];
    for (const reading of readings) {
      for (const edge of reading.subject.correspondences) {
        if (!record(edge)) continue;
        const a = edge.left_image_id, b = edge.right_image_id;
        if (!members.has(a) || !members.has(b) || a === b || sources.get(a).file_hash === sources.get(b).file_hash ||
          !reading.subject.member_image_ids.includes(a) || !reading.subject.member_image_ids.includes(b) ||
          !Array.isArray(edge.features) || edge.features.length > 8) continue;
        const kinds = new Set(edge.features.filter((f: unknown) => record(f) && identifying.has(f.kind) &&
          text(f.left_witness, 250) && text(f.right_witness, 250)).map((f: any) => f.kind));
        if (kinds.size < 2 || (!kinds.has("body_geometry") && !kinds.has("identifier"))) continue;
        // A surviving endpoint's own current read cannot qualify another read's
        // stale source/locator claim. Both witnesses must still match live bytes.
        if (![a, b].every(id => {
          const inputs = reading.envelope.inputs.filter((input: any) => input.image_id === id);
          const frames = reading.envelope.frames.filter((frame: any) => frame.image_id === id);
          return inputs.length === 1 && qualifySubjectSource(inputs[0], sources.get(id), userId, reading.read_at) &&
            frames.length === 1 && primaryFrame(frames[0], id === anchor);
        })) continue;
        edges.set(pair(a, b), [a, b]);
      }
      if (Array.isArray(reading.envelope.contradictions)) for (const contradiction of reading.envelope.contradictions) {
        if (record(contradiction) && members.has(contradiction.left_image_id) && members.has(contradiction.right_image_id)) {
          contradictions.push([contradiction.left_image_id, contradiction.right_image_id]);
        }
      }
    }
    const connected = new Set([anchor]), queue = [anchor];
    while (queue.length) {
      const id = queue.shift()!;
      for (const [a, b] of edges.values()) {
        const peer = a === id ? b : b === id ? a : null;
        if (peer && !connected.has(peer)) { connected.add(peer); queue.push(peer); }
      }
    }
    if (contradictions.some(([a, b]) => connected.has(a) && connected.has(b))) continue;
    const ids = [anchor, ...[...connected].filter(id => id !== anchor).sort()];
    const distinct = new Set<string>();
    const eligible = ids.filter(id => { const hash = sources.get(id).file_hash; if (distinct.has(hash)) return false; distinct.add(hash); return true; });
    if (eligible.length < 2) continue;
    const asserted_identity: SubjectProfile["asserted_identity"] = {};
    if (record(anchorReading.subject.asserted_identity)) for (const key of ["make", "model_family", "badge_text"] as const) {
      const value = text(anchorReading.subject.asserted_identity[key]); if (value) asserted_identity[key] = value;
    }
    const observed_at = eligible.map(id => qualified.get(id)!.read_at).sort((a, b) => clock(a)! < clock(b)! ? -1 : 1).at(-1)!;
    subjects.push({ id: carrier.id, anchor_image_id: anchor,
      label: [asserted_identity.make, asserted_identity.model_family].filter(Boolean).join(" ") || "Unidentified vehicle",
      identity_status: "unresolved", image_count: eligible.length, cover_image_url: sources.get(anchor).image_url, observed_at,
      images: eligible.slice(0, DETAIL_LIMIT).map(id => ({ id, image_url: sources.get(id).image_url, taken_at: sources.get(id).taken_at })),
      coverage: countCoverage(assessed.size, eligible.length, asOf, headTruncated || eligible.length > DETAIL_LIMIT), asserted_identity });
  }
  const eligibleCount = subjects.reduce((sum, subject) => sum + subject.image_count, 0);
  return { subjects, coverage: countCoverage(imageIds.length, eligibleCount, asOf,
    carrierMore || headTruncated || subjects.some(subject => subject.coverage.truncated)), next_offset };
}
