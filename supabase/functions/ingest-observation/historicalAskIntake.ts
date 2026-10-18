/** Protected branch of canonical intake. Source evidence never resolves a physical vehicle.
 * Lineage is checked by this writer and the private fold, not a new database FK.
 */
import {
  canonicalHistoricalJson, foldHistoricalAsks, historicalObservationIdentity,
  HISTORICAL_ASK_MODE, HISTORICAL_ASK_PROFILE, HISTORICAL_ASK_SOURCE, HISTORICAL_ASK_METHOD, validateHistoricalAskEnvelope,
  type HistoricalAskEnvelope, type HistoricalStoredRow,
} from "./historicalAsks.ts";
import { observationClockMicroseconds } from "../_shared/observationContentHash.ts";

export { HISTORICAL_ASK_METHOD } from "./historicalAsks.ts";
const SELECT = "id,source_id,source_identifier,source_url,content_hash,structured_data,ingested_at,observed_at,vehicle_id,kind,extraction_method,is_superseded,superseded_at";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export interface HistoricalAskStore {
  source(): Promise<{ id: string; supported_observations: string[] | null; base_trust_score: number } | null>;
  download(path: string): Promise<Uint8Array>;
  byIdentity(sourceId: string, identifier: string): Promise<HistoricalStoredRow[]>;
  byId(id: string): Promise<HistoricalStoredRow | null>;
  related(sourceId: string, captureId: string, adKey?: string): Promise<HistoricalStoredRow[]>;
  insert(row: Record<string, unknown>): Promise<HistoricalStoredRow | null>;
}
export class HistoricalAskRefusal extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
function refuse(reason: string, status = 400): never { throw new HistoricalAskRefusal(reason, status); }
async function digest(bytes: Uint8Array): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>)),
    (b) => b.toString(16).padStart(2, "0")).join("");
}
/** JPEG SOF dimensions; rejects wrong MIME, truncated segments and oversized originals. */
export function historicalJpegDimensions(bytes: Uint8Array): [number, number] | null {
  if (bytes.length < 4 || bytes.length > 8 * 1024 * 1024 || bytes[0] !== 255 || bytes[1] !== 216 ||
    bytes[bytes.length - 2] !== 255 || bytes[bytes.length - 1] !== 217) return null;
  let p = 2;
  let dimensions: [number, number] | null = null;
  while (p + 3 < bytes.length) {
    if (bytes[p++] !== 255) return null;
    while (bytes[p] === 255) p++;
    const marker = bytes[p++];
    if (marker === 217) return null;
    if (marker === 1 || marker >= 208 && marker <= 215) continue;
    if (p + 2 > bytes.length) return null;
    const size = bytes[p] * 256 + bytes[p + 1];
    if (size < 2 || p + size > bytes.length) return null;
    if (marker === 218) {
      const components = bytes[p + 2];
      return dimensions && components >= 1 && components <= 4 && size >= 6 + 2 * components &&
        p + size < bytes.length - 2 ? dimensions : null;
    }
    if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)) {
      const components = bytes[p + 7];
      if (size < 11 || components < 1 || components > 4 || size < 8 + 3 * components || dimensions) return null;
      const height = bytes[p + 3] * 256 + bytes[p + 4], width = bytes[p + 5] * 256 + bytes[p + 6];
      if (width <= 0 || height <= 0) return null;
      dimensions = [width, height];
    }
    p += size;
  }
  return null;
}

/** Store adapter deliberately reads only pinned identities or a bounded ad/capture lineage. */
export function historicalAskStore(db: any): HistoricalAskStore {
  const checked = (result: any) => { if (result.error) throw new Error("historical_store_failed"); return result.data; };
  return {
    async source() { return checked(await db.from("observation_sources")
      .select("id,supported_observations,base_trust_score").eq("slug", HISTORICAL_ASK_SOURCE).maybeSingle()); },
    async download(path) {
      const blob = checked(await db.storage.from("masters").download(path));
      if (!blob || blob.size > 8 * 1024 * 1024) refuse("original_unavailable_or_oversized");
      return new Uint8Array(await blob.arrayBuffer());
    },
    async byIdentity(sourceId, identifier) { return checked(await db.from("vehicle_observations").select(SELECT)
      .eq("source_id", sourceId).eq("source_identifier", identifier).eq("kind", "listing").limit(3)) ?? []; },
    async byId(id) { return checked(await db.from("vehicle_observations").select(SELECT).eq("id", id).maybeSingle()); },
    async related(sourceId, captureId, adKey) {
      const query = db.from("vehicle_observations").select(SELECT).eq("source_id", sourceId)
        .eq("structured_data->>profile", HISTORICAL_ASK_PROFILE);
      // Include all whole-capture withdrawals, plus all readings of these exact retained pixels.
      const filter = adKey
        ? `structured_data->>ad_key.eq.${adKey},and(structured_data->>capture_observation_id.eq.${captureId},structured_data->>record_type.eq.withdrawal)`
        : `structured_data->>capture_observation_id.eq.${captureId}`;
      const rows = checked(await query.or(filter).limit(501)) ?? [];
      if (rows.length > 500) refuse("lineage_limit_exceeded", 409);
      return rows;
    },
    async insert(row) {
      const result = await db.from("vehicle_observations").insert(row).select(SELECT).maybeSingle();
      if (result.error?.code === "23505") return null;
      return checked(result);
    },
  };
}

export async function ingestHistoricalAsk(store: HistoricalAskStore, input: Record<string, unknown>) {
  if (input.mode !== HISTORICAL_ASK_MODE || Object.keys(input).some((key) => !["mode", "envelope", "dry_run"].includes(key)) ||
    input.dry_run !== undefined && typeof input.dry_run !== "boolean") refuse("expected_only_historical_envelope");
  const validated = validateHistoricalAskEnvelope(input.envelope);
  if (!validated.ok) refuse(validated.reason);
  const envelope: HistoricalAskEnvelope = validated.value;
  const now = new Date().toISOString();
  if (Date.parse(envelope.pass.observed_at) > Date.parse(now)) refuse("future_observation_clock");
  const source = await store.source();
  if (!source || !UUID.test(source.id) || !source.supported_observations?.includes("listing")) refuse("source_listing_not_registered", 409);
  const identifier = await historicalObservationIdentity(envelope);
  const hash = await digest(new TextEncoder().encode(canonicalHistoricalJson(envelope)));
  async function custody(row: HistoricalStoredRow, value: HistoricalAskEnvelope, url: string, rowHash: string) {
    const ingested = observationClockMicroseconds(row.ingested_at), observed = observationClockMicroseconds(row.observed_at);
    return UUID.test(row.id) && row.source_id === source!.id && row.source_identifier === await historicalObservationIdentity(value) &&
      row.vehicle_id == null && row.kind === "listing" && row.extraction_method === HISTORICAL_ASK_METHOD &&
      row.source_url === url && row.content_hash === rowHash && row.is_superseded !== true &&
      ingested !== null && observed !== null && observed <= ingested && observed === observationClockMicroseconds(value.pass.observed_at) &&
      canonicalHistoricalJson(row.structured_data) === canonicalHistoricalJson(value);
  }
  let sourceUrl: string;
  if (envelope.record_type === "capture") {
    if (envelope.asset.storage_path !== `source-evidence/autotrader/${envelope.asset.sha256}.jpg`) refuse("unexpected_original_path");
    for (const value of [envelope.asset.captured_at, envelope.asset.retained_at]) {
      if (value != null && Date.parse(value) > Date.parse(now)) refuse("future_asset_clock");
    }
    const bytes = await store.download(envelope.asset.storage_path);
    if (await digest(bytes) !== envelope.asset.sha256) refuse("original_hash_mismatch", 409);
    const dims = historicalJpegDimensions(bytes);
    if (!dims || dims[0] !== envelope.asset.width || dims[1] !== envelope.asset.height) refuse("original_geometry_mismatch", 409);
    sourceUrl = envelope.asset.source_url;
  } else {
    const capture = await store.byId(envelope.capture_observation_id);
    const c = capture && validateHistoricalAskEnvelope(capture.structured_data);
    if (!capture || capture.id !== envelope.capture_observation_id || !c || !c.ok || c.value.record_type !== "capture" ||
      !await custody(capture, c.value, c.value.asset.source_url, await digest(new TextEncoder().encode(canonicalHistoricalJson(c.value))))) refuse("invalid_capture_citation", 409);
    sourceUrl = c.value.asset.source_url;
    const rows = await store.related(source.id, capture.id, envelope.ad_key);
    // Fold the complete bounded group plus the candidate. Concurrent sibling admissions
    // remain visible and are withheld by the reader; there is no invented DB lineage FK.
    const candidate = { id: "ffffffff-ffff-4fff-8fff-ffffffffffff", source_id: source.id,
      source_identifier: identifier, source_url: sourceUrl, content_hash: hash,
      structured_data: envelope, observed_at: envelope.pass.observed_at, ingested_at: now,
      vehicle_id: null, kind: "listing", extraction_method: HISTORICAL_ASK_METHOD };
    const otherCaptures: HistoricalStoredRow[] = [];
    for (const id of new Set(rows.map((r) => (r.structured_data as any)?.capture_observation_id))) {
      if (id && id !== capture.id) { const row = await store.byId(String(id)); if (row) otherCaptures.push(row); }
    }
    const parents = new Map([capture, ...otherCaptures].map((r) => [r.id, r]));
    for (const row of [...otherCaptures, ...rows]) {
      const valid = validateHistoricalAskEnvelope(row.structured_data);
      const parent = valid.ok && valid.value.record_type !== "capture" ? parents.get(valid.value.capture_observation_id) : row;
      const parentEnvelope = parent && validateHistoricalAskEnvelope(parent.structured_data);
      if (!valid.ok || !parentEnvelope || !parentEnvelope.ok || parentEnvelope.value.record_type !== "capture" ||
        !await custody(row, valid.value, parentEnvelope.value.asset.source_url,
          await digest(new TextEncoder().encode(canonicalHistoricalJson(valid.value))))) refuse("invalid_related_custody", 409);
    }
    const replay = rows.find((r) => r.source_identifier === identifier);
    const folded = await foldHistoricalAsks([capture, ...otherCaptures, ...rows, ...(replay ? [] : [candidate])], { sourceId: source.id });
    const own = folded.observations.find((r) => r.id === (replay?.id ?? candidate.id));
    const structural = own?.exclusion_reasons.filter((reason) => !reason.startsWith("unsupported_") &&
      !reason.startsWith("unchecked_") && !reason.startsWith("missing_printed_") &&
      !["issue_date_not_directly_supported", "currency_not_usd", "model_year_after_issue", "replaced_by_later_reading", "ad_withdrawn"].includes(reason));
    if (!own || structural?.length) refuse(`invalid_historical_lineage:${structural?.join(",") ?? "missing"}`, 409);
  }
  async function existing() {
    const rows = await store.byIdentity(source!.id, identifier);
    if (rows.length > 1) refuse("ambiguous_historical_retry", 409);
    const row = rows[0];
    if (row && !await custody(row, envelope, sourceUrl, hash)) refuse("historical_retry_conflict", 409);
    return row;
  }
  const prior = await existing();
  if (prior) return { observation_id: prior.id, source_identifier: identifier, duplicate: true };
  if (input.dry_run) return { dry_run: true, source_identifier: identifier, record_type: envelope.record_type };
  const inserted = await store.insert({ vehicle_id: null, source_id: source.id, source_url: sourceUrl,
    source_identifier: identifier, kind: "listing", observed_at: envelope.pass.observed_at,
    structured_data: envelope, content_hash: hash, extraction_method: HISTORICAL_ASK_METHOD,
    raw_source_ref: envelope.record_type === "capture" ? `storage:masters/${envelope.asset.storage_path}` : `vehicle_observations:${envelope.capture_observation_id}`,
    confidence: "medium", confidence_score: Math.min(0.6, source.base_trust_score ?? 0.5),
    confidence_factors: { source_base_trust: source.base_trust_score,
      agent_inferred_cap: Math.min(0, 0.6 - (source.base_trust_score ?? 0.5)) },
    extraction_metadata: { profile: HISTORICAL_ASK_PROFILE, actor: "AI observation process", human_verified: false,
      physical_vehicle_identity: "unresolved", lineage_enforcement: "intake_and_reader" },
  });
  const saved = inserted ?? await existing();
  if (!saved) throw new Error("historical_insert_not_returned");
  if (!await custody(saved, envelope, sourceUrl, hash)) refuse("historical_insert_custody_mismatch", 409);
  return { observation_id: saved.id, source_identifier: identifier, duplicate: !inserted };
}
