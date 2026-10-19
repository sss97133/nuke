/** Source-only AutoTrader testimony. This module neither resolves vehicles nor writes rows.
 * JSON citations are checked here; they are not a claim of database-enforced foreign keys.
 */
import { observationClockMicroseconds } from "../_shared/observationContentHash.ts";

export const HISTORICAL_ASK_MODE = "historical_asking_v1";
export const HISTORICAL_ASK_PROFILE = "autotrader_us_historical_v1";
export const HISTORICAL_ASK_SOURCE = "autotrader";
export const HISTORICAL_ASK_METHOD = "protected_historical_asking_v1";
export type Box = [number, number, number, number];
export interface HistoricalIssue {
  key: string;
  title: string;
  country: "US";
  date_start: string | null;
  date_end_exclusive: string | null;
  precision: "day" | "week" | "month" | "range" | "unknown";
  date_basis: "printed" | "forum_association" | "unknown";
  evidence: unknown;
  [key: string]: unknown;
}
export interface HistoricalPass {
  id: string;
  method: string;
  version: string;
  observed_at: string;
  [key: string]: unknown;
}
export interface HistoricalAsset {
  sha256: string;
  storage_path: string;
  source_url: string;
  mime_type: "image/jpeg";
  width: number;
  height: number;
  /** Original retrieval clock can be unknown; retention is a separate clock. */
  captured_at: string | null;
  retained_at?: string;
  [key: string]: unknown;
}
export interface HistoricalCheck {
  status: "passed" | "failed" | "unknown";
  method: string;
  version: string;
  evidence: string;
  /** Independent means a documented distinct check, never simply another pass. */
  independent?: boolean;
}
export interface HistoricalAssessment {
  assessment: string;
  evidence_excerpt?: string | null;
  evidence_bbox_xywh?: Box;
  checks?: HistoricalCheck[];
  [key: string]: unknown;
}
interface Base {
  profile: typeof HISTORICAL_ASK_PROFILE;
  issue: HistoricalIssue;
  pass: HistoricalPass;
  [key: string]: unknown;
}
export interface HistoricalCapture extends Base {
  record_type: "capture";
  asset: HistoricalAsset;
}
export interface HistoricalReading extends Base {
  record_type: "reading";
  capture_observation_id: string;
  previous_observation_id?: string;
  ad_key: string;
  locator: { bbox: Box; printed_page: number | null };
  fields: { raw: Record<string, unknown>; normalized: Record<string, unknown> };
  field_assessments: Record<string, HistoricalAssessment>;
  normalization_assessments?: Record<string, unknown>;
  context_correction_reason?: string;
}
export interface HistoricalWithdrawal extends Base {
  record_type: "withdrawal";
  capture_observation_id: string;
  previous_observation_id: string;
  /** Omitted means the whole retained capture, not an invented vehicle. */
  ad_key?: string;
  reason: string;
}
export type HistoricalAskEnvelope = HistoricalCapture | HistoricalReading | HistoricalWithdrawal;
export interface HistoricalStoredRow {
  id: string;
  source_id: string;
  source_identifier: string;
  structured_data: unknown;
  ingested_at: string;
  observed_at?: string;
  vehicle_id?: string | null;
  is_superseded?: boolean;
  superseded_at?: string | null;
  kind?: string;
  extraction_method?: string | null;
  [key: string]: unknown;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA = /^[0-9a-f]{64}$/;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, max = 1000): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= max;
const integer = (v: unknown, min: number, max: number): v is number => Number.isSafeInteger(v) && Number(v) >= min && Number(v) <= max;
const clock = (v: unknown) => observationClockMicroseconds(v);
function date(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && clock(`${v}T00:00:00Z`) !== null;
}
function url(v: unknown): boolean {
  if (!text(v, 4096)) return false;
  try {
    const u = new URL(v);
    return ["https:", "http:"].includes(u.protocol) && !u.username && !u.password && !!u.hostname;
  } catch { return false; }
}
function box(v: unknown, width = 100000, height = 100000): v is Box {
  return Array.isArray(v) && v.length === 4 && v.every((x) => Number.isSafeInteger(x)) &&
    v[0] >= 0 && v[1] >= 0 && v[2] > 0 && v[3] > 0 && v[0] + v[2] <= width && v[1] + v[3] <= height;
}
function within(inner: Box, outer: Box): boolean {
  return inner[0] >= outer[0] && inner[1] >= outer[1] &&
    inner[0] + inner[2] <= outer[0] + outer[2] && inner[1] + inner[3] <= outer[1] + outer[3];
}

/** Stable JSON is used both in retry identity and in comparison; unsupported JSON fails closed. */
export function canonicalHistoricalJson(value: unknown): string {
  const seen = new Set<unknown>();
  function visit(v: unknown): unknown {
    if (v === null || typeof v === "string" || typeof v === "boolean") return v;
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (!object(v) && !Array.isArray(v)) throw new Error("non_json_value");
    if (seen.has(v)) throw new Error("cyclic_json_value");
    seen.add(v);
    let out: unknown;
    if (Array.isArray(v)) out = v.map(visit);
    else {
      if (Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) throw new Error("non_json_object");
      out = Object.fromEntries(Object.keys(v).sort().map((key) => [key, visit(v[key])]));
    }
    seen.delete(v);
    return out;
  }
  return JSON.stringify(visit(value));
}
export async function historicalSha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(typeof value === "string" ? value : canonicalHistoricalJson(value));
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
}
export async function historicalAdKey(assetSha: string, bbox: Box): Promise<string> {
  if (!SHA.test(assetSha) || !box(bbox)) throw new Error("invalid_ad_locator");
  return `autotrader-print:${await historicalSha256({ asset_sha256: assetSha, bbox })}`;
}
export async function historicalObservationIdentity(envelope: HistoricalAskEnvelope): Promise<string> {
  return `historical-asking:${envelope.record_type}:${await historicalSha256(envelope)}`;
}

export function validateHistoricalAskEnvelope(input: unknown):
  { ok: true; value: HistoricalAskEnvelope } | { ok: false; reason: string } {
  const fail = (reason: string) => ({ ok: false as const, reason });
  if (!object(input) || input.profile !== HISTORICAL_ASK_PROFILE) return fail("invalid_profile");
  if (input.vehicle_id != null || input.vehicle_hints !== undefined || input.source_vin !== undefined ||
    input.subject !== undefined || input.source_observation_id !== undefined) return fail("physical_identity_not_supported");
  if (!["capture", "reading", "withdrawal"].includes(String(input.record_type))) return fail("invalid_record_type");
  const i = input.issue, p = input.pass;
  if (!object(i) || !text(i.key, 200) || !text(i.title, 500) || i.country !== "US") return fail("invalid_us_issue");
  if (!["day", "week", "month", "range", "unknown"].includes(String(i.precision)) ||
    !["printed", "forum_association", "unknown"].includes(String(i.date_basis))) return fail("invalid_issue_date_basis");
  if (i.precision === "unknown") {
    if (i.date_start !== null || i.date_end_exclusive !== null) return fail("unknown_date_has_bounds");
  } else {
    if (!date(i.date_start) || !date(i.date_end_exclusive) || i.date_start >= i.date_end_exclusive || i.date_basis === "unknown") return fail("invalid_issue_interval");
    const span = Date.parse(i.date_end_exclusive) - Date.parse(i.date_start);
    if (i.precision === "day" && span !== 86400000 || i.precision === "week" && span !== 7 * 86400000) return fail("date_precision_contradiction");
    if (i.precision === "month") {
      const next = new Date(`${i.date_start}T00:00:00Z`);
      next.setUTCMonth(next.getUTCMonth() + 1);
      if (!i.date_start.endsWith("-01") || next.toISOString().slice(0, 10) !== i.date_end_exclusive) return fail("date_precision_contradiction");
    }
    if (i.evidence == null || i.evidence === "") return fail("missing_issue_date_evidence");
  }
  if (!object(p) || !text(p.id, 200) || !text(p.method, 200) || !text(p.version, 100) || clock(p.observed_at) === null) return fail("invalid_pass");
  if (input.record_type === "capture") {
    const a = input.asset;
    if (!object(a) || typeof a.sha256 !== "string" || !SHA.test(a.sha256) || a.mime_type !== "image/jpeg" ||
      !integer(a.width, 1, 100000) || !integer(a.height, 1, 100000) || !url(a.source_url) ||
      !(a.captured_at === null || clock(a.captured_at) !== null) ||
      (a.retained_at !== undefined && clock(a.retained_at) === null)) return fail("invalid_asset");
    if (!text(a.storage_path, 1000) || !/^[A-Za-z0-9/_\-.]+$/.test(a.storage_path) || a.storage_path.startsWith("/") ||
      a.storage_path.split("/").some((part) => !part || part === "." || part === "..") ||
      !a.storage_path.endsWith(`${a.sha256}.jpg`)) return fail("invalid_content_addressed_path");
  } else {
    if (typeof input.capture_observation_id !== "string" || !UUID.test(input.capture_observation_id)) return fail("invalid_capture_reference");
    if (input.previous_observation_id !== undefined && (typeof input.previous_observation_id !== "string" || !UUID.test(input.previous_observation_id))) return fail("invalid_previous_reference");
    if (input.record_type === "withdrawal") {
      if (!text(input.reason, 4000) || !input.previous_observation_id) return fail("withdrawal_requires_reason_and_target");
      if (input.ad_key !== undefined && (typeof input.ad_key !== "string" || !/^autotrader-print:[0-9a-f]{64}$/.test(input.ad_key))) return fail("invalid_ad_key");
    } else {
      if (typeof input.ad_key !== "string" || !/^autotrader-print:[0-9a-f]{64}$/.test(input.ad_key)) return fail("invalid_ad_key");
      if (!object(input.locator) || !box(input.locator.bbox) ||
        !(input.locator.printed_page === null || integer(input.locator.printed_page, 1, 100000))) return fail("invalid_locator");
      if (!object(input.fields) || !object(input.fields.raw) || !object(input.fields.normalized) || !object(input.field_assessments)) return fail("invalid_reading_fields");
      const n = input.fields.normalized;
      if (n.model_year != null && !integer(n.model_year, 1800, 2100)) return fail("invalid_model_year");
      if (n.asking_amount != null && (typeof n.asking_amount !== "number" || !Number.isFinite(n.asking_amount) || n.asking_amount <= 0)) return fail("invalid_asking_amount");
      if (n.currency != null && (typeof n.currency !== "string" || !/^[A-Z]{3}$/.test(n.currency))) return fail("invalid_currency");
      if (n.market_country != null && n.market_country !== "US") return fail("conflicting_market_country");
      for (const key of ["make", "model", "trim"]) if (n[key] != null && !text(n[key], 500)) return fail(`invalid_${key}`);
      for (const assessment of Object.values(input.field_assessments)) {
        if (!object(assessment) || !text(assessment.assessment, 100)) return fail("invalid_field_assessment");
        if (assessment.evidence_bbox_xywh !== undefined && (!box(assessment.evidence_bbox_xywh) || !within(assessment.evidence_bbox_xywh, input.locator.bbox as Box))) return fail("field_evidence_outside_ad");
        if (assessment.checks !== undefined && (!Array.isArray(assessment.checks) || !assessment.checks.every((c) =>
          object(c) && ["passed", "failed", "unknown"].includes(String(c.status)) && text(c.method, 200) && text(c.version, 100) && text(c.evidence, 4000) &&
          (c.independent === undefined || typeof c.independent === "boolean")))) return fail("invalid_field_checks");
      }
    }
  }
  try { if (canonicalHistoricalJson(input).length > 128000) return fail("envelope_too_large"); }
  catch { return fail("non_json_envelope"); }
  return { ok: true, value: input as unknown as HistoricalAskEnvelope };
}

export interface HistoricalFoldOptions { knownAt?: string; sourceId: string; maxRows?: number; }
/** A private consumer of admitted rows. Every exclusion keeps its source receipt.
 * No last-write-wins fallback: forks, withdrawn heads and unknown corrections withhold prices.
 */
export async function foldHistoricalAsks(rows: HistoricalStoredRow[], options: HistoricalFoldOptions) {
  if (!options || !UUID.test(options.sourceId)) throw new Error("canonical_historical_source_required");
  if (rows.length > (options.maxRows ?? 10000)) throw new Error("historical_population_truncated");
  const cutoff = options.knownAt === undefined ? null : clock(options.knownAt);
  if (options.knownAt !== undefined && cutoff === null) throw new Error("invalid_known_at");
  type Entry = { row: HistoricalStoredRow; value: HistoricalAskEnvelope; reasons: string[] };
  const entries = new Map<string, Entry>();
  const blockedGroups = new Set<string>();
  const blockedCaptures = new Set<string>();
  const invalidMembers = new Map<string, { sourceId: string; raw: Record<string, unknown> }>();
  const excluded: { observation_id: string; ad_key: string | null; reasons: string[] }[] = [];
  let future = 0;
  for (const row of rows) {
    const ingested = clock(row.ingested_at);
    if (ingested !== null && cutoff !== null && ingested > cutoff) { future++; continue; }
    const valid = validateHistoricalAskEnvelope(row.structured_data);
    const reasons: string[] = [];
    if (!UUID.test(row.id) || !UUID.test(row.source_id) || ingested === null) reasons.push("invalid_stored_identity_or_clock");
    if (row.source_id !== options.sourceId) reasons.push("source_mismatch");
    if (row.extraction_method !== HISTORICAL_ASK_METHOD) reasons.push("unprotected_historical_testimony");
    if (row.vehicle_id != null) reasons.push("physical_identity_not_supported");
    if (row.kind !== undefined && row.kind !== "listing") reasons.push("not_listing_testimony");
    if (!valid.ok) reasons.push(valid.reason);
    if (valid.ok) {
      if (clock(valid.value.pass.observed_at)! > ingested!) reasons.push("observation_after_ingest");
      if (row.observed_at !== undefined && clock(row.observed_at) !== clock(valid.value.pass.observed_at)) reasons.push("pass_clock_mismatch");
      if (row.source_identifier !== await historicalObservationIdentity(valid.value)) reasons.push("stored_identity_mismatch");
    }
    if (entries.has(row.id)) throw new Error("duplicate_stored_observation_id");
    if (reasons.length || !valid.ok) {
      const raw = row.structured_data;
      // A broken later reading must not make its older supported price reappear.
      if (object(raw) && raw.profile === HISTORICAL_ASK_PROFILE && typeof raw.ad_key === "string" &&
        /^autotrader-print:[0-9a-f]{64}$/.test(raw.ad_key)) blockedGroups.add(`${row.source_id}:${raw.ad_key}`);
      if (object(raw) && raw.profile === HISTORICAL_ASK_PROFILE) invalidMembers.set(row.id, { sourceId: row.source_id, raw });
      excluded.push({ observation_id: row.id, ad_key: object(raw) && typeof raw.ad_key === "string" ? raw.ad_key : null, reasons });
      continue;
    }
    const supersededAt = row.superseded_at ? clock(row.superseded_at) : null;
    if (row.is_superseded === true && (cutoff === null || supersededAt === null || supersededAt <= cutoff)) reasons.push("source_superseded");
    entries.set(row.id, { row, value: valid.value, reasons });
    if (valid.value.record_type === "capture") {
      for (const value of [valid.value.asset.captured_at, valid.value.asset.retained_at]) {
        if (value != null && clock(value)! > ingested!) reasons.push("asset_clock_after_ingest");
      }
    }
  }
  // A malformed key or context must not sever a correction/withdrawal from its
  // predecessor and accidentally restore an older supported price.
  for (const member of invalidMembers.values()) {
    let previous = member.raw.previous_observation_id;
    const visited = new Set<string>();
    while (typeof previous === "string" && !visited.has(previous)) {
      visited.add(previous);
      const predecessor = entries.get(previous);
      if (predecessor?.row.source_id === member.sourceId) {
        if (predecessor.value.record_type === "capture") blockedCaptures.add(previous);
        else if (predecessor.value.ad_key) blockedGroups.add(`${member.sourceId}:${predecessor.value.ad_key}`);
        break;
      }
      const invalid = invalidMembers.get(previous);
      if (!invalid || invalid.sourceId !== member.sourceId) break;
      previous = invalid.raw.previous_observation_id;
    }
  }
  const captures = new Map([...entries].filter(([, e]) => e.value.record_type === "capture"));
  const withdrawnCaptures = new Set<string>();
  // Withdrawals are permanent for this capture. Recapture/readmission requires a new capture record.
  for (const e of entries.values()) {
    if (e.value.record_type !== "withdrawal" || e.value.ad_key !== undefined) continue;
    const c = captures.get(e.value.capture_observation_id);
    if (c && e.value.previous_observation_id === c.row.id && e.row.source_id === c.row.source_id && !e.reasons.length &&
      canonicalHistoricalJson(e.value.issue) === canonicalHistoricalJson(c.value.issue) && clock(e.row.ingested_at)! >= clock(c.row.ingested_at)!) withdrawnCaptures.add(c.row.id);
    else {
      e.reasons.push("invalid_capture_withdrawal");
      const target = captures.get(e.value.previous_observation_id);
      if (target?.row.source_id === e.row.source_id) blockedCaptures.add(target.row.id);
    }
  }
  const groups = new Map<string, Entry[]>();
  for (const e of entries.values()) {
    if (e.value.record_type === "capture") continue;
    const c = captures.get(e.value.capture_observation_id);
    if (!c || c.value.record_type !== "capture") e.reasons.push("capture_missing");
    else {
      if (e.row.source_id !== c.row.source_id) e.reasons.push("capture_citation_mismatch");
      if (e.value.record_type === "reading" && !e.value.previous_observation_id &&
        canonicalHistoricalJson(e.value.issue) !== canonicalHistoricalJson(c.value.issue)) e.reasons.push("undocumented_issue_context_change");
      if (c.reasons.length || blockedCaptures.has(c.row.id) ||
        withdrawnCaptures.has(c.row.id) && !(e.value.record_type === "withdrawal" && e.value.ad_key === undefined)) e.reasons.push("capture_unavailable");
      if (clock(e.row.ingested_at)! < clock(c.row.ingested_at)!) e.reasons.push("capture_after_reading");
      if (e.value.record_type === "reading" && (!box(e.value.locator.bbox, c.value.asset.width, c.value.asset.height) ||
        e.value.ad_key !== await historicalAdKey(c.value.asset.sha256, e.value.locator.bbox))) e.reasons.push("ad_locator_mismatch");
    }
    if (e.value.record_type === "withdrawal" && e.value.ad_key === undefined) continue;
    // The same retained pixels mirrored or recaptured cannot mint a second ask.
    const key = `${e.row.source_id}:${e.value.ad_key}`;
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  const qualified: Record<string, unknown>[] = [];
  // A changed locator must not detach an otherwise valid correction from the
  // old ad and leave that predecessor visible as a separate current price.
  for (const e of entries.values()) {
    if (e.value.record_type === "capture" || !e.value.previous_observation_id) continue;
    const p = entries.get(e.value.previous_observation_id);
    if (p?.row.source_id === e.row.source_id && p.value.record_type !== "capture" &&
      p.value.ad_key && p.value.ad_key !== e.value.ad_key) {
      blockedGroups.add(`${p.row.source_id}:${p.value.ad_key}`);
      if (e.value.ad_key) blockedGroups.add(`${e.row.source_id}:${e.value.ad_key}`);
    }
  }
  for (const group of groups.values()) {
    const first = group[0];
    if (blockedGroups.has(`${first.row.source_id}:${(first.value as HistoricalReading).ad_key}`)) {
      for (const e of group) e.reasons.push("invalid_revision_chain_member");
    }
    const ids = new Map(group.map((e) => [e.row.id, e]));
    const children = new Map<string, Entry[]>();
    for (const e of group) {
      const v = e.value as HistoricalReading | HistoricalWithdrawal;
      if (v.previous_observation_id) {
        const p = ids.get(v.previous_observation_id);
        if (!p || p.value.record_type === "withdrawal" || clock(p.row.ingested_at)! > clock(e.row.ingested_at)!) e.reasons.push("invalid_previous_reading");
        if (p && p.value.record_type === "reading" && v.record_type === "reading" &&
          canonicalHistoricalJson(v.issue) !== canonicalHistoricalJson(p.value.issue) && !text(v.context_correction_reason, 4000)) e.reasons.push("undocumented_issue_context_change");
        children.set(v.previous_observation_id, [...(children.get(v.previous_observation_id) ?? []), e]);
      }
    }
    const roots = group.filter((e) => !(e.value as HistoricalReading).previous_observation_id);
    const heads = group.filter((e) => !children.has(e.row.id));
    // A second root or sibling never becomes extra market evidence or a timing winner.
    if (roots.length !== 1 || heads.length !== 1 || [...children.values()].some((c) => c.length !== 1)) {
      for (const e of group) e.reasons.push("ambiguous_revision_chain");
    }
    let head = heads.length === 1 ? heads[0] : null;
    const walked = new Set<string>();
    let cursor = head;
    while (cursor) {
      if (walked.has(cursor.row.id)) { head = null; break; }
      walked.add(cursor.row.id);
      if (cursor.reasons.length) head = null;
      const prev = (cursor.value as HistoricalReading).previous_observation_id;
      cursor = prev ? ids.get(prev) ?? null : null;
    }
    if (walked.size !== group.length) head = null;
    for (const e of group) {
      if (e !== head && !e.reasons.length) e.reasons.push("replaced_by_later_reading");
    }
    if (!head) continue;
    const v = head.value as HistoricalReading | HistoricalWithdrawal;
    if (v.record_type === "withdrawal") { head.reasons.push("ad_withdrawn"); continue; }
    const n = v.fields.normalized;
    const graphReasons: string[] = [];
    if (v.issue.precision === "unknown" || v.issue.date_basis !== "printed") graphReasons.push("issue_date_not_directly_supported");
    if (n.currency !== "USD") graphReasons.push("currency_not_usd");
    for (const [field, assessmentKey] of [["model_year", "model_year"], ["make", "make"], ["model", "model"], ["asking_amount", "asking_price"]]) {
      const a = v.field_assessments[assessmentKey];
      if (n[field] == null || !a || !["readable", "verified"].includes(a.assessment) || !text(a.evidence_excerpt, 4000)) graphReasons.push(`unsupported_${field}`);
      if (!a?.checks?.length || a.checks.some((c) => c.status !== "passed")) graphReasons.push(`unchecked_${field}`);
      // Model-to-make mappings and century expansion remain interpretations until separately checked.
      const raw = v.fields.raw[assessmentKey];
      if (raw == null || typeof raw === "string" && !raw.trim()) graphReasons.push(`missing_printed_${field}`);
    }
    if (v.issue.date_end_exclusive && typeof n.model_year === "number" && n.model_year > Number(v.issue.date_end_exclusive.slice(0, 4)) + 1) graphReasons.push("model_year_after_issue");
    if (graphReasons.length) { head.reasons.push(...graphReasons); continue; }
    const capture = captures.get(v.capture_observation_id)!.value as HistoricalCapture;
    qualified.push({
      observation_id: head.row.id, capture_observation_id: v.capture_observation_id, ad_key: v.ad_key,
      model_year: n.model_year, make: n.make, model: n.model, asking_amount: n.asking_amount, currency: "USD",
      date_start: v.issue.date_start, date_end_exclusive: v.issue.date_end_exclusive, date_precision: v.issue.precision,
      issue: v.issue, locator: v.locator, asset: capture.asset, pass: v.pass,
      epistemic_class: "attributed_checked_reading", physical_vehicle_identity: "unresolved", price_kind: "asking",
      independent_verification: ["model_year", "make", "model", "asking_price"].every((f) =>
        v.field_assessments[f].checks?.some((c) => c.status === "passed" && c.independent === true)),
    });
  }
  // A small locator shift is uncertainty about one source region, not another
  // market presentation. Withhold both points; do not merge neighboring ads.
  const overlaps = new Set<string>();
  for (let a = 0; a < qualified.length; a++) {
    const left = qualified[a];
    for (let b = a + 1; b < qualified.length; b++) {
      const right = qualified[b];
      if ((left.asset as HistoricalAsset).sha256 !== (right.asset as HistoricalAsset).sha256 || left.ad_key === right.ad_key) continue;
      const x = (left.locator as HistoricalReading["locator"]).bbox, y = (right.locator as HistoricalReading["locator"]).bbox;
      const intersection = Math.max(0, Math.min(x[0] + x[2], y[0] + y[2]) - Math.max(x[0], y[0])) *
        Math.max(0, Math.min(x[1] + x[3], y[1] + y[3]) - Math.max(x[1], y[1]));
      if (intersection / Math.min(x[2] * x[3], y[2] * y[3]) > 0.9) {
        overlaps.add(left.observation_id as string); overlaps.add(right.observation_id as string);
      }
    }
  }
  for (const id of overlaps) entries.get(id)!.reasons.push("ambiguous_ad_locator_overlap");
  const supported = qualified.filter((q) => !overlaps.has(q.observation_id as string));
  const observations = [...entries.values()].map((e) => ({ ...e.row, structured_data: e.value, exclusion_reasons: [...new Set(e.reasons)] }));
  for (const e of entries.values()) if (e.reasons.length) excluded.push({ observation_id: e.row.id,
    ad_key: e.value.record_type === "capture" ? null : e.value.ad_key ?? null, reasons: [...new Set(e.reasons)] });
  return {
    observations, qualified: supported, excluded,
    // Individual period-qualified points, deliberately not a fabricated exact-date or representative average.
    series: supported.map((q) => ({ ...q })),
    counts: { supplied_rows: rows.length, future_rows: future, retained_observations: observations.length,
      captures: captures.size, candidate_ads: groups.size, qualified_asks: supported.length, excluded_rows: excluded.length },
    known_at: options.knownAt ?? null,
    scope: "private_source_observations", population_exhaustion: "caller_must_prove_complete_manifest",
  };
}
