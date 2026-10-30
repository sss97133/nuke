#!/usr/bin/env node
/** Deterministic retained-source replay. No publisher fetch or inference.
 * dotenvx run -q -- node scripts/data/replay-retained-properties.mjs \
 *   --input /private/vehicle-ids.json --state /private/replay.json [--limit 100] [--apply]
 * Input: UUID array, or {vehicle_ids: UUID[]}. State/receipts must stay outside Git.
 * Every native capture and property is admitted by the existing service writers.
 * Unsupported sources and missing/ambiguous captures remain explicit backlog.
 */
import { readFile, writeFile, rename, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const options = { limit: 100, apply: false };
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === '--apply') options.apply = true;
  else if (['--input', '--state', '--limit'].includes(arg) && process.argv[i + 1]) options[arg.slice(2)] = process.argv[++i];
  else throw Error('Expected --input, --state, --limit and optional --apply');
}
options.limit = Number(options.limit);
if (!options.input || !options.state || !Number.isInteger(options.limit) || options.limit < 1 || options.limit > 500) {
  throw Error('Private input/state and a limit of 1–500 records are required');
}
const statePath = path.join(await realpath(path.dirname(path.resolve(options.state))), path.basename(options.state));
try {
  execFileSync('git', ['-C', path.dirname(statePath), 'rev-parse', '--show-toplevel'], { stdio: 'pipe' });
  throw Error('Replay receipts must stay outside Git');
} catch (error) { if (error.message === 'Replay receipts must stay outside Git') throw error; }
const input = await readFile(options.input), manifest = JSON.parse(input);
const ids = Array.isArray(manifest) ? manifest : manifest.vehicle_ids;
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
if (!Array.isArray(ids) || !ids.length || ids.some(id => typeof id !== 'string' || !uuid.test(id)) || new Set(ids).size !== ids.length) {
  throw Error('Input must contain distinct vehicle UUIDs');
}
const inputSha256 = createHash('sha256').update(input).digest('hex');
let state;
try { state = JSON.parse(await readFile(statePath)); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
state ??= { version: 'retained-property-replay-v2', input_sha256: inputSha256, apply: options.apply, total: ids.length,
  started_at: new Date().toISOString(), results: {} };
if (state.input_sha256 !== inputSha256 || state.apply !== options.apply || state.version !== 'retained-property-replay-v2') {
  throw Error('State belongs to a different manifest or mode; use a separate receipt');
}
const base = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!base || !key || new URL(base).hostname !== 'qkgaybvrernstplzjaam.supabase.co') throw Error('Expected Nuke service environment');
async function request(endpoint, payload) {
  const response = await fetch(base + endpoint, { method: payload === undefined ? 'GET' : 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }), signal: AbortSignal.timeout(60000) });
  const body = await response.json();
  if (!response.ok) throw Error(`HTTP ${response.status}: ${body.error || body.message || 'request failed'}`);
  return body;
}
const select = (table, params) => request('/rest/v1/' + table + '?' + new URLSearchParams(params));
// SQL activation is atomic and follows decoder deployment. Never apply this
// operator against an older admission owner or a partially deployed decoder.
if (options.apply && await request('/rest/v1/rpc/retained_native_listing_source', { p: null }) !== false) {
  throw Error('Expected activated retained source qualification');
}
async function replay(id) {
  const [v] = await select('vehicles', { select: 'id,is_public,deleted_at,listing_kind,listing_url,discovery_url', id: `eq.${id}` });
  if (!v || v.is_public !== true || v.deleted_at || v.listing_kind === 'non_vehicle_item') return { status: 'blocked', reason: 'parent_not_public_real_vehicle' };
  // Existing source testimony is usable independently of a new snapshot replay.
  // Let the canonical enqueue owner qualify it, including when the current URL
  // is absent/unsupported or a protected capture cannot be admitted.
  const parents = await select('vehicle_observations', { select: 'id', vehicle_id: `eq.${id}`,
    kind: 'in.(listing,sale_result)', extraction_method: 'in.(html_match,html_description_capture,html_parse,public_lot_index,next_data_json_parse,retained_native_fields_v1)',
    is_superseded: 'eq.false', order: 'id', limit: '50' });
  const keys = parents.map(p => p.id);
  let seeded = options.apply && keys.length ? await request('/rest/v1/rpc/enqueue_retained_listing_properties', { p_sources: keys }) : 0;
  const retained = () => ({ source_parents_submitted: options.apply ? keys.length : 0, source_parents_seen: keys.length,
    source_scan_limited: parents.length === 50, work_seeded: seeded, model_calls: 0, source_to_reader_verified: false });
  const blocked = (reason, extra = {}) => ({ status: 'blocked', reason, ...retained(), ...extra });
  try {
  let url;
  try { url = new URL(v.listing_url || v.discovery_url); } catch { return blocked('source_url_unknown'); }
  const host = url.hostname.replace(/^www\./, '');
  const platform = { 'bringatrailer.com': 'bat', 'mecum.com': 'mecum', 'barrett-jackson.com': 'barrett-jackson' }[host];
  if (!platform) {
    return blocked('source_adapter_not_available', { source_host: url.hostname });
  }
  url.hash = ''; url.search = '';
  const canonical = 'https://' + host + url.pathname.replace(/\/+$/, '') + '/';
  const variants = [...new Set([url.href, canonical, canonical.slice(0, -1), canonical.replace('https://', 'https://www.'), canonical.slice(0, -1).replace('https://', 'https://www.')])];
  const snapshots = await select('listing_page_snapshots', { select: 'id,html_sha256,metadata,fetched_at', platform: `eq.${platform}`,
    listing_url: 'in.(' + variants.join(',') + ')', success: 'eq.true', http_status: 'eq.200', order: 'fetched_at.desc', limit: '10' });
  const fingerprinted = snapshots.filter(s => /^[0-9a-f]{64}$/i.test(s.html_sha256 || ''));
  const snapshot = fingerprinted.find(s => s.metadata?.vehicle_id === id && s.metadata.vehicle_matched === true) ??
    (platform !== 'bat' ? fingerprinted.find(s => (s.metadata?.vehicle_id == null || s.metadata.vehicle_id === id) &&
      s.metadata?.vehicle_matched == null) : undefined);
  if (!snapshot) return blocked('attributed_retained_capture_missing');
  const endpoint = platform === 'bat' ? '/functions/v1/extract-bat-core' : '/functions/v1/batch-extract-snapshots';
  const selectors = {
    mode: platform === 'bat' ? 'description_source' : 'retained_properties', vehicle_id: id,
    snapshot_id: snapshot.id, expected_capture_sha256: snapshot.html_sha256,
    ...(platform === 'bat' ? {} : { platform, no_ai: true }) };
  const preview = await request(endpoint, { ...selectors, dry_run: true });
  if (!preview.success || preview.vehicle_id !== id || preview.snapshot_id !== snapshot.id || preview.writes !== 0 ||
      preview.model_calls !== 0 || (platform === 'bat' ? preview.property_projection_profile !== 'retained_archived_description_v1'
        : preview.native_property_profile !== 'retained_native_fields_v1')) throw Error('Expected deployed pinned source decoder');
  if (snapshot.metadata?.vehicle_matched !== true && preview.source_association_basis !== 'exact_record_url_and_native_labels') {
    throw Error('Expected deployed literal native-label association');
  }
  const receipt = options.apply ? await request(endpoint, { ...selectors, dry_run: false }) : preview;
  if (!receipt.success || receipt.model_calls !== 0 || receipt.vehicle_id !== id || receipt.snapshot_id !== snapshot.id) throw Error('Invalid native capture receipt');
  if (options.apply) {
    const sourceId = receipt.description_receipt?.observation_id ?? receipt.observation_id;
    if (!uuid.test(sourceId ?? '')) throw Error('Missing admitted source receipt');
    seeded += await request('/rest/v1/rpc/enqueue_retained_listing_properties', { p_sources: [sourceId] });
  }
  return { status: options.apply ? 'admitted' : 'preview', snapshot_id: snapshot.id,
    capture_sha256: snapshot.html_sha256, source_captured_at: receipt.source_captured_at,
    source_association_basis: receipt.source_association_basis,
    input_characters: receipt.input_characters, native_receipt: receipt.description_receipt ?? { observation_id: receipt.observation_id,
      duplicate: receipt.duplicate, field_keys: receipt.field_keys },
    ...retained() };
  } catch (error) {
    // A later archive refusal must not erase work already submitted above.
    error.retained_replay = retained();
    throw error;
  }
}
let processed = 0;
// Visit the whole manifest before spending later invocations on retries. A
// persistent set of500 retryable records must not hide every remaining truck.
const pendingIds = [...ids.filter(id => !state.results[id]), ...ids.filter(id => state.results[id]?.status === 'retry')];
for (const id of pendingIds) {
  if (state.results[id] && state.results[id].status !== 'retry') continue;
  try { state.results[id] = { ...await replay(id), attempted_at: new Date().toISOString() }; }
  catch (error) {
    const refused = error.message.startsWith('HTTP 409:') || error.message.includes('Newer listing evidence cannot be reconstructed from the pinned older capture') ||
      error.message.includes('Protected snapshot archive read failed: source_clock_conflict');
    state.results[id] = { status: refused ? 'blocked' : 'retry', reason: error.message, ...error.retained_replay, attempted_at: new Date().toISOString() };
  }
  state.updated_at = new Date().toISOString();
  const temporary = statePath + '.tmp';
  await writeFile(temporary, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 }); await rename(temporary, statePath);
  if (++processed >= options.limit) break;
}
const counts = Object.values(state.results).reduce((a, r) => (a[r.status] = (a[r.status] || 0) + 1, a), {});
console.log(JSON.stringify({ total: ids.length, attempted: Object.keys(state.results).length, processed, counts,
  remaining: ids.length - Object.keys(state.results).length, model_calls: 0, state: statePath,
  limitation: 'Admission and queued work are processing measures; public source-to-reader coverage must be verified separately.' }));
