#!/usr/bin/env node
/**
 * Private operator for retained U.S. AutoTrader print observations. Requires Node >=25.
 * No OCR, paid inference, source refetches, vehicle minting, raw testimony writes or cron.
 *
 * prepare --seed <private-seed-dir> --repass <blind-repass.json> --out <private-dir>
 * report --manifest <private-dir/prepared.json> --local [--out <private-report.json>]
 * stage  --manifest <private-dir/prepared.json>
 * admit  --manifest <private-dir/prepared.json> [--dry-run]
 * report --manifest <private-dir/prepared.json> [--known-at <UTC>] [--out <private-report.json>]
 *
 * Network commands use SUPABASE_URL and a modern sb_secret_ key in SUPABASE_SECRET_KEY,
 * SUPABASE_SECRET_KEYS (functions/default), or SUPABASE_SERVICE_ROLE_KEY. Legacy JWTs fail closed.
 * Upload is immutable into the existing masters bucket under source-evidence/; no bucket creation.
 * Intake is exclusively ingest-observation mode historical_asking_v1. Prepared references are
 * symbolic, never counterfeit admitted UUIDs. Local report UUIDs are explicitly simulations.
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rename, stat, realpath, open, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  HISTORICAL_ASK_MODE, HISTORICAL_ASK_PROFILE, HISTORICAL_ASK_SOURCE, HISTORICAL_ASK_METHOD,
  canonicalHistoricalJson, historicalAdKey, historicalObservationIdentity,
  validateHistoricalAskEnvelope, foldHistoricalAsks,
} from '../supabase/functions/ingest-observation/historicalAsks.ts';
import { projectSecretKey } from '../supabase/functions/_shared/supabaseKeys.ts';

const VERSION = 'autotrader-history-operator-v1';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLACEHOLDER_UUID = '00000000-0000-4000-8000-000000000001';
const json = (v) => JSON.stringify(v, null, 2) + '\n';
const clone = (v) => JSON.parse(JSON.stringify(v));
const digest = (v) => createHash('sha256').update(v).digest('hex');
const stableHash = (v) => digest(canonicalHistoricalJson(v));
const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'));

async function exists(p) { try { await stat(p); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } }
async function privatePath(p) {
  const absolute = path.resolve(p);
  await mkdir(path.dirname(absolute), { recursive: true, mode: 0o700 });
  const parent = await realpath(path.dirname(absolute));
  const resolved = path.join(parent, path.basename(absolute));
  if (resolved === REPO || resolved.startsWith(REPO + path.sep)) throw new Error('private_output_must_be_outside_repository');
  return resolved;
}
async function atomicJson(filename, value) {
  filename = await privatePath(filename);
  const temporary = filename + `.tmp-${process.pid}`;
  await writeFile(temporary, json(value), { mode: 0o600, flag: 'wx' });
  try { await rename(temporary, filename); } finally { await unlink(temporary).catch((e) => { if (e.code !== 'ENOENT') throw e; }); }
}
async function locked(filename, work) {
  const lock = filename + '.lock';
  let handle;
  try { handle = await open(lock, 'wx', 0o600); }
  catch (e) { if (e.code === 'EEXIST') throw new Error('operator_lock_exists_inspect_private_checkpoint_lock'); throw e; }
  try { await handle.writeFile(json({ pid: process.pid, started_at: new Date().toISOString() })); return await work(); }
  finally { await handle.close(); await unlink(lock); }
}
function requireEnvelope(envelope) {
  const valid = validateHistoricalAskEnvelope(envelope);
  if (!valid.ok) throw new Error(`invalid_prepared_envelope:${valid.reason}`);
  return valid.value;
}
function addDays(day, n) { return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10); }
function issueFor(catalog, source) {
  let start = catalog.issue_date_start, end = catalog.issue_date_end, precision = catalog.date_precision;
  if (catalog.issue_month) {
    start = catalog.issue_month + '-01';
    const next = new Date(`${start}T00:00:00Z`); next.setUTCMonth(next.getUTCMonth() + 1);
    end = next.toISOString().slice(0, 10);
    precision = 'month';
  } else if (end) end = addDays(end, 1); // Catalog end is inclusive; canonical interval is not.
  if (!start || !end) { start = null; end = null; precision = 'unknown'; }
  return {
    key: catalog.issue_id, title: catalog.publication_raw, country: 'US',
    date_start: start, date_end_exclusive: end, precision,
    date_basis: precision === 'unknown' ? 'unknown' : source?.date_evidence?.kind === 'forum_sequence_association' ? 'forum_association' : 'printed',
    evidence: source?.date_evidence ?? catalog.date_evidence ?? null,
    edition_raw: catalog.edition_raw, selection_note: catalog.selection_note,
    raw_date: catalog.date_raw,
  };
}
function enclosingBox(box, assessments) {
  const boxes = [box, ...Object.values(assessments).map((a) => a.evidence_bbox_xywh).filter(Boolean)];
  if (boxes.some((b) => !Array.isArray(b) || b.length !== 4 || b.some((n) => !Number.isSafeInteger(n)) || b[0] < 0 || b[1] < 0 || b[2] <= 0 || b[3] <= 0)) throw new Error('invalid_seed_rectangle');
  const x = Math.min(...boxes.map((b) => b[0])), y = Math.min(...boxes.map((b) => b[1]));
  return [x, y, Math.max(...boxes.map((b) => b[0] + b[2])) - x, Math.max(...boxes.map((b) => b[1] + b[3])) - y];
}
const comparable = (v) => v == null ? null : String(v).normalize('NFKC').replace(/[’‘]/g, "'").replace(/[\s.,]+/g, ' ').trim().toLowerCase();
function agreement(field, prior, next, oldReading, blindAd, receiptHash) {
  let passed = prior != null && next != null && comparable(prior) === comparable(next);
  let basis = 'Printed field text, ignoring case, apostrophe typography and punctuation.';
  if (field === 'asking_price') {
    passed = oldReading.normalized.asking_amount != null && blindAd.asking_price_numeric != null && oldReading.normalized.asking_amount === blindAd.asking_price_numeric;
    basis = 'Independently read numeric asking amount; raw price excerpts retained.';
  } else if (field === 'model' && !passed && prior != null && next != null) {
    passed = comparable([prior, oldReading.raw.trim].filter(Boolean).join(' ')) === comparable([next, blindAd.observed_trim_text].filter(Boolean).join(' '));
    basis = 'Combined printed model/trim span; model-versus-trim allocation may differ.';
  }
  const missing = prior == null || next == null;
  return {
    status: missing ? 'unknown' : passed ? 'passed' : 'failed',
    method: 'saved_blind_ai_visual_reading_comparison', version: '1', independent: !missing,
    evidence: `${basis} First printed reading=${JSON.stringify(prior)}; blind printed reading=${JSON.stringify(next)}. Blind artifact sha256=${receiptHash}; saved before comparison. Independent AI reading of the same pixels, not human review or independent physical-source corroboration.${missing ? ' An inferred normalized value cannot replace missing printed evidence.' : ''}`,
  };
}
function materialize(entry, ids) {
  const envelope = clone(entry.envelope);
  for (const [field, key] of Object.entries(entry.references ?? {})) {
    const id = ids[key];
    if (!UUID.test(id ?? '')) throw new Error(`unresolved_dependency:${entry.key}:${key}`);
    envelope[field] = id;
  }
  return requireEnvelope(envelope);
}
function validateTemplate(entry) {
  const fakeIds = Object.fromEntries(Object.values(entry.references ?? {}).map((key) => [key, PLACEHOLDER_UUID]));
  return materialize(entry, fakeIds);
}

export async function prepare({ seed, repass, out, now = () => new Date().toISOString() }) {
  if (!seed || !repass || !out) throw new Error('prepare_requires_seed_repass_out');
  const output = await privatePath(path.join(out, 'prepared.json'));
  const inputFiles = [path.join(seed, 'asset-manifest.json'), path.join(seed, 'issue-catalog.json'), path.join(seed, 'observations.json'), repass];
  const inputBytes = await Promise.all(inputFiles.map((p) => readFile(p)));
  const inputs = inputFiles.map((p, n) => ({ path: path.resolve(p), sha256: digest(inputBytes[n]) }));
  const fingerprint = stableHash(inputs);
  if (await exists(output)) {
    const prior = await readJson(output);
    if (prior.version !== VERSION || prior.input_fingerprint !== fingerprint) throw new Error('prepared_inputs_changed_use_a_new_private_output_directory');
    await verifyPreparedAssets(prior);
    return { manifest: prior, filename: output, reused: true };
  }
  const [assetsFile, issuesFile, seedFile, blind] = inputBytes.map((v) => JSON.parse(v));
  if (!Array.isArray(assetsFile.assets) || !Array.isArray(issuesFile.issues) || !Array.isArray(seedFile.observations) || !Array.isArray(blind.covers)) throw new Error('malformed_seed_files');
  if (blind.first_reading_saved_before_comparison !== true || blind.human_verified !== false) throw new Error('blind_receipt_missing_truthful_ai_method');
  const preparedAt = now(), entries = [], warnings = [];
  const catalog = new Map(issuesFile.issues.map((i) => [i.issue_id, i]));
  const captures = new Map(), initialsByFile = new Map();
  for (const asset of assetsFile.assets) {
    const bytes = await readFile(asset.local_original_path);
    if (digest(bytes) !== asset.sha256) throw new Error(`local_asset_hash_mismatch:${asset.filename}`);
    const source = seedFile.observations.find((o) => o.source?.filename === asset.filename)?.source;
    const issue = catalog.get(asset.issue_id);
    if (!issue || !source) throw new Error(`missing_issue_or_source:${asset.filename}`);
    const key = `capture:${asset.sha256}`;
    if (captures.has(asset.filename)) throw new Error('duplicate_asset_filename');
    const envelope = {
      profile: HISTORICAL_ASK_PROFILE, record_type: 'capture', issue: issueFor(issue, source),
      pass: { id: 'retained-master-manifest-v1', method: 'deterministic_retained_file_registration', version: '1', observed_at: preparedAt, verification_actor: 'operator CLI', human_verified: false },
      asset: { sha256: asset.sha256, storage_path: `source-evidence/autotrader/${asset.sha256}.jpg`, source_url: asset.source_url, mime_type: 'image/jpeg', width: asset.width_px, height: asset.height_px,
        captured_at: null, retained_at: (await stat(asset.local_original_path)).mtime.toISOString(),
        captured_at_basis: 'Original network retrieval clock was not established; filesystem clocks do not substitute.', retained_at_basis: 'mtime of the retained local master at preparation; not claimed as original retrieval time.', original_filename: asset.filename },
    };
    requireEnvelope(envelope);
    const entry = { key, envelope, references: {}, source_identifier: await historicalObservationIdentity(envelope), asset_local_path: path.resolve(asset.local_original_path) };
    entries.push(entry); captures.set(asset.filename, entry);
  }
  for (const row of seedFile.observations) {
    const capture = captures.get(row.source.filename);
    if (!capture || row.source.sha256 !== capture.envelope.asset.sha256) throw new Error('seed_capture_mismatch');
    const bbox = enclosingBox(row.source.bbox_xywh, row.field_assessments);
    if (bbox[0] + bbox[2] > capture.envelope.asset.width || bbox[1] + bbox[3] > capture.envelope.asset.height) throw new Error('seed_rectangle_outside_asset');
    const adjusted = canonicalHistoricalJson(bbox) !== canonicalHistoricalJson(row.source.bbox_xywh);
    if (adjusted) warnings.push({ code: 'ad_envelope_widened_to_include_retained_evidence', filename: row.source.filename, locator: row.source.ad_locator, original: row.source.bbox_xywh, corrected: bbox });
    const firstPass = row.passes?.[0];
    if (!firstPass?.observed_at) throw new Error('missing_initial_pass_clock');
    const envelope = {
      profile: HISTORICAL_ASK_PROFILE, record_type: 'reading', issue: clone(capture.envelope.issue),
      pass: { id: 'initial-ai-visual-v1', method: 'ai_visual_transcription', version: '1', observed_at: firstPass.observed_at,
        verification_actor: 'AI agent visual observation', human_verified: false, clock_basis: 'Timestamp recorded with the initial artifact; exact per-ad visual start/end clocks were not captured.', original_pass_receipts: row.passes },
      capture_observation_id: `@${capture.key}`, ad_key: await historicalAdKey(row.source.sha256, bbox),
      locator: { bbox, printed_page: row.source.printed_page },
      fields: { raw: clone(row.raw), normalized: clone(row.normalized) },
      field_assessments: clone(row.field_assessments), normalization_assessments: clone(row.normalization_assessments),
      source_reading_key: row.observation_key, original_ad_locator: row.source.ad_locator,
      issues: row.issues, assertion_scope: row.assertion_scope, physical_vehicle_identity: 'unresolved',
    };
    if (adjusted) envelope.locator_adjustment = { original_bbox: row.source.bbox_xywh, reason: 'Axis-aligned ad envelope expanded by deterministic union to contain its retained caption evidence rectangles.' };
    const entry = { key: `initial:${row.observation_key}`, envelope, references: { capture_observation_id: capture.key }, source_identifier: null };
    validateTemplate(entry); entries.push(entry);
    initialsByFile.set(row.source.filename, [...(initialsByFile.get(row.source.filename) ?? []), { entry, row }]);
  }
  let repassCount = 0;
  for (const cover of blind.covers) {
    const filename = path.basename(cover.source_file), originals = initialsByFile.get(filename), capture = captures.get(filename);
    if (!capture || !originals || !Array.isArray(cover.ads) || cover.ads.length !== originals.length) throw new Error(`blind_cover_cardinality_mismatch:${filename}`);
    const sorted = [...cover.ads].sort((a, b) => a.ad_order - b.ad_order);
    if (sorted.some((a, n) => a.ad_order !== n + 1)) throw new Error('blind_cover_order_not_contiguous');
    for (let n = 0; n < sorted.length; n++) {
      const blindAd = sorted[n], { entry: initial, row } = originals[n];
      const envelope = clone(initial.envelope);
      envelope.previous_observation_id = `@${initial.key}`;
      envelope.pass = { id: 'blind-cover-ai-repass-v1', method: 'independent_ai_visual_repass_with_saved_reading_comparison', version: '1', observed_at: blind.observed_at,
        verification_actor: blind.verification_actor, human_verified: false, saved_before_comparison: true, repass_artifact_sha256: inputs[3].sha256,
        independence_scope: 'A distinct AI reader saved its transcription before seeing the earlier readings. Same source pixels; no independent physical-source or human corroboration.' };
      const newRaw = { model_year: blindAd.observed_model_year_text, make: blindAd.observed_make_text, model: blindAd.observed_model_text, trim: blindAd.observed_trim_text, asking_price: blindAd.asking_price_evidence, asking_qualifier: blindAd.price_qualifier_text };
      envelope.fields.raw = { ...envelope.fields.raw, ...newRaw };
      envelope.fields.normalized = { ...envelope.fields.normalized, model_year: blindAd.normalized.model_year, make: blindAd.normalized.make, model: blindAd.normalized.model, trim: blindAd.normalized.trim,
        asking_amount: blindAd.asking_price_numeric, currency: blindAd.asking_price_currency, market_country: 'US' };
      for (const [field, assessment] of Object.entries(envelope.field_assessments)) {
        if (!Object.hasOwn(newRaw, field)) { assessment.carried_from_previous_reading = true; assessment.rechecked_by_this_pass = false; continue; }
        const value = newRaw[field];
        assessment.assessment = value == null ? 'uncertain' : 'readable';
        assessment.evidence_excerpt = field === 'asking_price' ? blindAd.asking_price_evidence : field === 'asking_qualifier' ? blindAd.price_qualifier_text : value == null ? null : blindAd.exact_vehicle_wording;
        if (['model_year', 'make', 'model', 'asking_price'].includes(field)) assessment.checks = [agreement(field, row.raw[field], value, row, blindAd, inputs[3].sha256)];
      }
      envelope.normalization_assessments = { prior_reading: row.normalization_assessments, current_blind_reading_inferences: blindAd.normalized.inferences ?? [],
        note: 'Printed-field agreement checks do not turn a model-to-make inference into printed evidence.' };
      envelope.blind_reading_receipt = { locator: blindAd.locator, ad_order: blindAd.ad_order, exact_vehicle_wording: blindAd.exact_vehicle_wording, notes: blindAd.notes, issue_date_text: cover.issue_date_text, issue_date_normalized: cover.issue_date_normalized };
      const entry = { key: `blind:${row.observation_key}`, envelope, references: { capture_observation_id: capture.key, previous_observation_id: initial.key }, source_identifier: null };
      validateTemplate(entry); entries.push(entry); repassCount++;
    }
  }
  const keys = entries.map((e) => e.key);
  if (new Set(keys).size !== keys.length) throw new Error('duplicate_prepared_entry_key');
  const manifest = { version: VERSION, prepared_at: preparedAt, input_fingerprint: fingerprint, inputs, entries, warnings,
    counts: { captures: assetsFile.assets.length, initial_readings: seedFile.observations.length, blind_successors: repassCount, envelopes: entries.length },
    scope: 'Private U.S. retained-source observation batch; unknown physical vehicle identity; asking claims, not sales.',
    symbolic_references: 'Reading identities are computed only after actual parent observation UUIDs are known. Preparation does not create admitted IDs.' };
  await atomicJson(output, manifest);
  return { manifest, filename: output, reused: false };
}

async function verifyPreparedAssets(manifest) {
  for (const entry of manifest.entries.filter((e) => e.envelope.record_type === 'capture')) {
    if (digest(await readFile(entry.asset_local_path)) !== entry.envelope.asset.sha256) throw new Error('local_asset_hash_mismatch');
  }
}
export function credentials(env = process.env) {
  const key = env.SUPABASE_SECRET_KEY ?? projectSecretKey((name) => env[name]);
  if (!key?.startsWith('sb_secret_')) throw new Error('modern_supabase_secret_key_required_legacy_jwt_refused');
  const url = new URL(env.SUPABASE_URL ?? '');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error('supabase_url_requires_https');
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('invalid_supabase_base_url');
  return { url: url.origin, key };
}
function client({ url, key }, fetcher) {
  return async (route, options = {}) => fetcher(url + route, { ...options, headers: { apikey: key, ...(options.headers ?? {}) }, signal: AbortSignal.timeout(30000) });
}
async function checkedJson(response, label) {
  if (!response.ok) throw new Error(`${label}_http_${response.status}`);
  try { return await response.json(); } catch { throw new Error(`${label}_non_json_response`); }
}
export async function stageAsset(entry, request) {
  const asset = entry.envelope.asset, local = await readFile(entry.asset_local_path);
  if (digest(local) !== asset.sha256) throw new Error('local_asset_hash_mismatch');
  const objectPath = 'masters/' + asset.storage_path.split('/').map(encodeURIComponent).join('/');
  const route = '/storage/v1/object/authenticated/' + objectPath;
  let result = await request(route);
  if (result.status === 404) {
    const upload = await request('/storage/v1/object/' + objectPath, { method: 'POST', headers: { 'Content-Type': 'image/jpeg', 'x-upsert': 'false' }, body: local });
    // A concurrent uploader is safe only when the exact existing bytes verify below.
    if (!upload.ok && ![400, 409].includes(upload.status)) throw new Error(`immutable_asset_upload_http_${upload.status}`);
    result = await request(route);
  }
  if (!result.ok) throw new Error(`retained_asset_download_http_${result.status}`);
  const remote = Buffer.from(await result.arrayBuffer());
  if (remote.length !== local.length || digest(remote) !== asset.sha256) throw new Error('immutable_remote_asset_hash_mismatch_no_overwrite');
  return { storage_path: asset.storage_path, sha256: asset.sha256, byte_length: remote.length, verified_at: new Date().toISOString() };
}
export async function exactStoredRows(ids, request) {
  if (ids.some((id) => !UUID.test(id)) || new Set(ids).size !== ids.length) throw new Error('invalid_exact_observation_ids');
  const rows = [];
  for (let offset = 0; offset < ids.length; offset += 50) {
    const chunk = ids.slice(offset, offset + 50);
    const query = new URLSearchParams({ select: 'id,source_id,source_identifier,source_url,content_hash,structured_data,ingested_at,observed_at,vehicle_id,is_superseded,superseded_at,kind,extraction_method', id: `in.(${chunk.join(',')})`, limit: String(chunk.length) });
    const part = await checkedJson(await request('/rest/v1/vehicle_observations?' + query), 'exact_observation_read');
    if (!Array.isArray(part) || part.length !== chunk.length || new Set(part.map((r) => r.id)).size !== chunk.length || part.some((r) => !chunk.includes(r.id))) throw new Error('exact_observation_manifest_incomplete_or_malformed');
    rows.push(...part);
  }
  return rows;
}
/** Read the bounded related history, including later records outside this batch.
 * Ad keys find revisions; capture references find withdrawals and overlapping locators;
 * identical master hashes find recaptures of the same pixels. Nothing is a table census.
 */
export async function relatedStoredClosure(initialRows, expectedSource, request, maxRows = 500) {
  const rows = new Map(initialRows.map((row) => [row.id, row]));
  const queried = { ad_key: new Set(), capture_observation_id: new Set(), asset_sha256: new Set() };
  const columns = 'id,source_id,source_identifier,source_url,content_hash,structured_data,ingested_at,observed_at,vehicle_id,is_superseded,superseded_at,kind,extraction_method';
  function merge(part) {
    if (!Array.isArray(part) || part.length > maxRows || new Set(part.map((row) => row.id)).size !== part.length) throw new Error('related_history_closure_truncated_or_malformed');
    for (const row of part) {
      if (!UUID.test(row.id ?? '')) throw new Error('related_history_invalid_id');
      const old = rows.get(row.id);
      if (old && canonicalHistoricalJson(old) !== canonicalHistoricalJson(row)) throw new Error('related_history_changed_during_non_atomic_read');
      rows.set(row.id, row);
    }
    if (rows.size > maxRows) throw new Error('related_history_closure_truncated');
  }
  for (let pass = 0; pass < 8; pass++) {
    const wanted = { ad_key: new Set(), capture_observation_id: new Set(), asset_sha256: new Set() }, referenced = new Set();
    for (const row of rows.values()) {
      const value = row.structured_data;
      if (!value || typeof value !== 'object') continue;
      if (/^autotrader-print:[0-9a-f]{64}$/.test(value.ad_key ?? '')) wanted.ad_key.add(value.ad_key);
      if (value.record_type === 'capture') {
        wanted.capture_observation_id.add(row.id);
        if (/^[0-9a-f]{64}$/.test(value.asset?.sha256 ?? '')) wanted.asset_sha256.add(value.asset.sha256);
      }
      for (const id of [value.capture_observation_id, value.previous_observation_id]) if (UUID.test(id ?? '')) referenced.add(id);
    }
    let queriedSomething = false;
    for (const [field, values] of Object.entries(wanted)) {
      const pending = [...values].filter((value) => !queried[field].has(value));
      for (let offset = 0; offset < pending.length; offset += 50) {
        const chunk = pending.slice(offset, offset + 50);
        const jsonPath = field === 'asset_sha256' ? 'structured_data->asset->>sha256' : `structured_data->>${field}`;
        const query = new URLSearchParams({ select: columns, source_id: `eq.${expectedSource}`, 'structured_data->>profile': `eq.${HISTORICAL_ASK_PROFILE}`, [jsonPath]: `in.(${chunk.join(',')})`, limit: String(maxRows + 1) });
        const result = await checkedJson(await request('/rest/v1/vehicle_observations?' + query), 'related_history_read');
        merge(result); chunk.forEach((value) => queried[field].add(value)); queriedSomething = true;
      }
    }
    const missing = [...referenced].filter((id) => !rows.has(id));
    if (missing.length) { merge(await exactStoredRows(missing, request)); queriedSomething = true; }
    if (!queriedSomething) return [...rows.values()];
  }
  throw new Error('related_history_closure_did_not_converge_within_bound');
}
async function sourceId(request) {
  const query = new URLSearchParams({ select: 'id', slug: `eq.${HISTORICAL_ASK_SOURCE}`, limit: '2' });
  const result = await checkedJson(await request('/rest/v1/observation_sources?' + query), 'source_registration_read');
  if (!Array.isArray(result) || result.length !== 1 || !UUID.test(result[0].id)) throw new Error('canonical_autotrader_source_not_uniquely_registered');
  return result[0].id;
}
async function loadManifest(filename) {
  const manifest = await readJson(filename);
  if (manifest.version !== VERSION || !Array.isArray(manifest.entries) || new Set(manifest.entries.map((e) => e.key)).size !== manifest.entries.length) throw new Error('invalid_prepared_manifest');
  for (const entry of manifest.entries) validateTemplate(entry);
  return manifest;
}
function checkpointFile(filename) { return path.join(path.dirname(path.resolve(filename)), 'checkpoint.json'); }
async function checkpointFor(filename, manifest, target) {
  const filenameOut = checkpointFile(filename), manifestHash = stableHash(manifest);
  if (await exists(filenameOut)) {
    const prior = await readJson(filenameOut);
    if (prior.version !== VERSION || prior.manifest_sha256 !== manifestHash || prior.target !== target) throw new Error('checkpoint_manifest_or_target_mismatch');
    return { filename: filenameOut, checkpoint: prior };
  }
  return { filename: filenameOut, checkpoint: { version: VERSION, manifest_sha256: manifestHash, target, assets: {}, entries: {} } };
}
async function verifyAdmitted(checkpoint, request) {
  const receipts = Object.values(checkpoint.entries).filter((r) => r.observation_id);
  const rows = await exactStoredRows(receipts.map((r) => r.observation_id), request);
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const receipt of receipts) {
    const row = byId.get(receipt.observation_id);
    if (row.source_identifier !== receipt.source_identifier || canonicalHistoricalJson(row.structured_data) !== canonicalHistoricalJson(receipt.envelope) || row.vehicle_id != null) throw new Error('persisted_retry_receipt_mismatch');
  }
  return rows;
}
export async function operate({ manifest: filename, command, dryRun = false, fetcher = fetch, env = process.env }) {
  if (!['stage', 'admit'].includes(command)) throw new Error('invalid_operation');
  const manifest = await loadManifest(filename), auth = credentials(env), request = client(auth, fetcher);
  const { filename: cpFile, checkpoint } = await checkpointFor(filename, manifest, auth.url);
  return locked(cpFile, async () => {
    await verifyPreparedAssets(manifest);
    // Every retry verifies previously admitted exact payloads, not merely existing IDs.
    await verifyAdmitted(checkpoint, request);
    for (const entry of manifest.entries.filter((e) => e.envelope.record_type === 'capture')) {
      checkpoint.assets[entry.key] = await stageAsset(entry, request);
      await atomicJson(cpFile, checkpoint);
    }
    if (command === 'stage') return { stage: 'masters_staged_sha256_verified', assets: Object.keys(checkpoint.assets).length, admitted: 0 };
    const ids = Object.fromEntries(Object.entries(checkpoint.entries).filter(([, r]) => r.observation_id).map(([key, r]) => [key, r.observation_id]));
    let admitted = 0, duplicates = 0, dryRuns = 0, blocked = 0;
    for (const entry of manifest.entries) {
      if (ids[entry.key]) continue;
      if (Object.values(entry.references ?? {}).some((key) => !ids[key])) { if (dryRun) { blocked++; continue; } throw new Error('admission_dependency_not_resolved'); }
      const envelope = materialize(entry, ids), identifier = await historicalObservationIdentity(envelope);
      const prior = checkpoint.entries[entry.key];
      if (prior && (canonicalHistoricalJson(prior.envelope) !== canonicalHistoricalJson(envelope) || prior.source_identifier !== identifier)) throw new Error('retry_envelope_changed');
      checkpoint.entries[entry.key] = { ...prior, envelope, source_identifier: identifier, status: 'prepared_for_post' };
      await atomicJson(cpFile, checkpoint); // Exact bytes/identity retained before an ambiguous network outcome.
      let body;
      try {
        body = await checkedJson(await request('/functions/v1/ingest-observation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: HISTORICAL_ASK_MODE, envelope, ...(dryRun ? { dry_run: true } : {}) }) }), 'canonical_intake');
        if (body.source_identifier !== identifier) throw new Error('canonical_intake_identity_mismatch');
        if (dryRun) {
          if (body.dry_run !== true) throw new Error('canonical_intake_dry_run_not_confirmed');
          checkpoint.entries[entry.key].status = 'dry_run_validated'; dryRuns++;
        } else {
          if (!UUID.test(body.observation_id ?? '') || body.dry_run === true) throw new Error('canonical_intake_missing_admitted_id');
          checkpoint.entries[entry.key] = { envelope, source_identifier: identifier, observation_id: body.observation_id, status: 'admitted', duplicate: body.duplicate === true };
          ids[entry.key] = body.observation_id; admitted++; if (body.duplicate) duplicates++;
        }
        await atomicJson(cpFile, checkpoint);
      } catch (e) {
        checkpoint.entries[entry.key].status = 'post_failed_or_ambiguous';
        checkpoint.entries[entry.key].last_error = e.message;
        await atomicJson(cpFile, checkpoint); throw e;
      }
    }
    if (!dryRun) await verifyAdmitted(checkpoint, request);
    return { stage: dryRun ? 'canonical_dry_run_only' : 'admitted_exact_payloads_read_back', newly_admitted: admitted, duplicates, already_admitted: Object.keys(ids).length - admitted, dry_runs: dryRuns, blocked_missing_real_parent_ids: blocked, expected_envelopes: manifest.entries.length };
  });
}
function simulationId(key) { const h = digest(key); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`; }
export async function report({ manifest: filename, local = false, knownAt, out, fetcher = fetch, env = process.env }) {
  const readStartedAt = new Date().toISOString(), manifest = await loadManifest(filename);
  let rows, source, stage, exhaustion;
  if (local) {
    source = simulationId('local-only-autotrader-source'); const ids = {}, retained = [];
    const latestPass = Math.max(Date.parse(manifest.prepared_at), ...manifest.entries.map((e) => Date.parse(e.envelope.pass.observed_at)));
    for (let n = 0; n < manifest.entries.length; n++) {
      const entry = manifest.entries[n], envelope = materialize(entry, ids), id = simulationId(entry.key);
      ids[entry.key] = id;
      const sourceUrl = envelope.record_type === 'capture' ? envelope.asset.source_url : retained.find((r) => r.id === envelope.capture_observation_id)?.source_url;
      retained.push({ id, source_id: source, source_identifier: await historicalObservationIdentity(envelope), source_url: sourceUrl, content_hash: stableHash(envelope), structured_data: envelope, ingested_at: new Date(latestPass + n + 1).toISOString(), observed_at: envelope.pass.observed_at, vehicle_id: null, kind: 'listing', extraction_method: HISTORICAL_ASK_METHOD });
    }
    rows = retained; stage = 'prepared_local_simulation_not_admitted'; exhaustion = 'Complete prepared manifest; IDs and ingest clocks are local simulation only.';
  } else {
    const auth = credentials(env), request = client(auth, fetcher), { checkpoint } = await checkpointFor(filename, manifest, auth.url);
    source = await sourceId(request);
    const completed = manifest.entries.map((e) => checkpoint.entries[e.key]?.observation_id);
    if (completed.some((id) => !UUID.test(id ?? ''))) throw new Error('live_report_requires_complete_admission_manifest_no_silent_subset');
    rows = await relatedStoredClosure(await verifyAdmitted(checkpoint, request), source, request);
    stage = 'runtime_private_related_history_read'; exhaustion = 'All exact checkpoint IDs returned (<=50 per exact-ID REST request), then bounded related revisions, withdrawals and same-master recaptures exhausted up to 500 rows. Multiple live requests are not an atomic database snapshot; not whole-source/fleet coverage.';
  }
  const folded = await foldHistoricalAsks(rows, { sourceId: source, maxRows: local ? manifest.entries.length : 500, ...(knownAt ? { knownAt } : {}) });
  const reasons = {};
  for (const exclusion of folded.excluded) for (const reason of exclusion.reasons) reasons[reason] = (reasons[reason] ?? 0) + 1;
  const result = { version: VERSION, stage, reader_started_at: readStartedAt, reader_completed_at: new Date().toISOString(), reader_consistency: local ? 'Deterministic local simulation, not database evidence.' : 'Non-atomic bounded live read; reader clocks do not establish source freshness or a committed database snapshot.', manifest_sha256: stableHash(manifest), prepared_counts: manifest.counts, population: { grain: 'retained source ad', candidate_ads: folded.counts.candidate_ads, full_us_autotrader_archive_denominator: null, whole_fleet_coverage: 'not_measured', exhaustion },
    warnings: manifest.warnings, exclusion_reason_counts: reasons, ...folded };
  const destination = out ?? path.join(path.dirname(path.resolve(filename)), local ? 'report-local.json' : 'report-live.json');
  await atomicJson(destination, result);
  return { stage, report: path.resolve(destination), counts: folded.counts, exclusion_reason_counts: reasons };
}

async function main(argv) {
  const command = argv.shift(), options = {};
  for (let n = 0; n < argv.length; n++) {
    const flag = argv[n];
    if (['--local', '--dry-run'].includes(flag)) options[flag === '--local' ? 'local' : 'dryRun'] = true;
    else if (['--seed', '--repass', '--out', '--manifest', '--known-at'].includes(flag)) {
      if (!argv[n + 1] || argv[n + 1].startsWith('--')) throw new Error(`missing_flag_value:${flag}`);
      options[flag === '--known-at' ? 'knownAt' : flag.slice(2)] = argv[++n];
    } else throw new Error(`unknown_flag:${flag}`);
  }
  if (command === 'prepare') {
    const result = await prepare(options);
    console.log(json({ stage: 'prepared_private_envelopes', manifest: result.filename, reused: result.reused, counts: result.manifest.counts, warnings: result.manifest.warnings }));
  } else if (command === 'report') console.log(json(await report(options)));
  else if (['stage', 'admit'].includes(command)) console.log(json(await operate({ ...options, command })));
  else throw new Error('expected_prepare_stage_admit_or_report_see_script_header');
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main(process.argv.slice(2)).catch((error) => { console.error(`AutoTrader operator: ${error.message}`); process.exitCode = 1; });
