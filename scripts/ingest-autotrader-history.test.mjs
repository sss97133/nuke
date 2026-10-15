import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { prepare, report, operate, stageAsset, credentials, exactStoredRows, relatedStoredClosure } from './ingest-autotrader-history.mjs';
import { historicalObservationIdentity, canonicalHistoricalJson, HISTORICAL_ASK_METHOD } from '../supabase/functions/ingest-observation/historicalAsks.ts';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const asJson = (value) => new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const source = uuid(9999);
const env = { SUPABASE_URL: 'http://localhost:54321', SUPABASE_SECRET_KEY: 'sb_secret_synthetic_fixture_only' };
async function fixture(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'autotrader-operator-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const seed = path.join(dir, 'seed'), out = path.join(dir, 'out'); await mkdir(seed); await mkdir(out);
  const bytes = Buffer.from('synthetic master fixture bytes, no private evidence'), assetPath = path.join(seed, 'cover.jpg'), hash = sha(bytes);
  await writeFile(assetPath, bytes);
  const asset = { asset_id: 'synthetic', filename: 'cover.jpg', sha256: hash, width_px: 200, height_px: 100, source_url: 'https://example.invalid/cover.jpg', issue_id: 'synthetic-issue', local_original_path: assetPath };
  const issue = { issue_id: 'synthetic-issue', publication_raw: 'Synthetic AutoTrader test', edition_raw: null, issue_date_start: '1990-01-01', issue_date_end: '1990-01-07', issue_month: null, date_precision: 'range', date_raw: 'Jan. 1–7, 1990', date_evidence: { kind: 'printed_on_same_source_image' }, selection_note: 'Synthetic test values; no real classified or private records.' };
  const rows = [0, 1].map((n) => ({ observation_key: `synthetic-${n}`, source: { filename: 'cover.jpg', sha256: hash, bbox_xywh: [n * 100, 0, 100, 100], printed_page: null, ad_locator: `synthetic-${n}` },
    raw: { model_year: n ? null : '1964', make: n ? null : 'Synthetic', model: 'Test Coupe', trim: null, asking_price: '$12345', asking_qualifier: null, mileage: null, location: null },
    normalized: { model_year: n ? null : 1964, make: n ? 'Inferred' : 'Synthetic', model: 'Test Coupe', trim: null, asking_amount: 12345, currency: 'USD', market_country: 'US' },
    field_assessments: Object.fromEntries(['model_year', 'make', 'model', 'asking_price'].map((field) => [field, { assessment: n && ['model_year', 'make'].includes(field) ? 'uncertain' : 'readable', evidence_excerpt: 'Synthetic printed field', evidence_bbox_xywh: [n * 100 + 1, 80, 90, 15] }])),
    normalization_assessments: {}, passes: [{ method: 'ai_visual_transcription', observed_at: '2026-10-14T00:00:00Z' }], issues: [], assertion_scope: 'Synthetic asking claim, never a sale.' }));
  const blind = { first_reading_saved_before_comparison: true, human_verified: false, observed_at: '2026-10-14T01:00:00Z', verification_actor: 'Synthetic AI test reader', covers: [{ source_file: assetPath, issue_date_text: 'Jan. 1–7, 1990', issue_date_normalized: { start: '1990-01-01', end: '1990-01-07' }, ads: rows.map((row, n) => ({ ad_order: n + 1, observed_model_year_text: row.raw.model_year, observed_make_text: row.raw.make, observed_model_text: row.raw.model, observed_trim_text: null, exact_vehicle_wording: 'Synthetic printed vehicle wording', asking_price_numeric: 12345, asking_price_currency: 'USD', asking_price_evidence: '$12345', price_qualifier_text: null, normalized: row.normalized, notes: [], locator: `synthetic-${n}` })) }] };
  const repass = path.join(dir, 'blind.json');
  await Promise.all([writeFile(path.join(seed, 'asset-manifest.json'), JSON.stringify({ assets: [asset] })), writeFile(path.join(seed, 'issue-catalog.json'), JSON.stringify({ issues: [issue] })), writeFile(path.join(seed, 'observations.json'), JSON.stringify({ observations: rows })), writeFile(repass, JSON.stringify(blind))]);
  return { dir, seed, out, bytes, assetPath, repass, options: { seed, out, repass, now: () => '2027-01-01T00:00:00Z' } };
}

test('prepare preserves uncertainty, exclusive date bounds, symbolic parents and stable retry identity', async (t) => {
  const f = await fixture(t), first = await prepare(f.options), before = await readFile(first.filename, 'utf8');
  assert.deepEqual(first.manifest.counts, { captures: 1, initial_readings: 2, blind_successors: 2, envelopes: 5 });
  assert.equal(first.manifest.entries[0].envelope.asset.captured_at, null);
  assert.equal(first.manifest.entries[0].envelope.issue.date_end_exclusive, '1990-01-08');
  assert.match(first.manifest.entries[1].envelope.capture_observation_id, /^@capture:/);
  const uncertain = first.manifest.entries[4].envelope;
  assert.equal(uncertain.fields.raw.make, null);
  assert.equal(uncertain.field_assessments.make.checks[0].status, 'unknown');
  assert.equal(uncertain.field_assessments.make.checks[0].independent, false);
  const second = await prepare({ ...f.options, now: () => '2099-01-01T00:00:00Z' });
  assert.equal(second.reused, true); assert.equal(await readFile(first.filename, 'utf8'), before);
  const preview = await report({ manifest: first.filename, local: true });
  assert.equal(preview.stage, 'prepared_local_simulation_not_admitted');
  assert.equal(preview.counts.candidate_ads, 2); assert.equal(preview.counts.qualified_asks, 1);
  assert.ok(preview.exclusion_reason_counts.missing_printed_make > 0);
  await writeFile(f.assetPath, 'changed master');
  await assert.rejects(prepare(f.options), /local_asset_hash_mismatch/);
});

test('immutable master upload addresses masters bucket, verifies SHA and never overwrites a conflict', async (t) => {
  const f = await fixture(t), p = await prepare(f.options), entry = p.manifest.entries[0], calls = [];
  let uploaded = false;
  await stageAsset(entry, async (route, options = {}) => {
    calls.push({ route, method: options.method ?? 'GET' });
    if (options.method === 'POST') { assert.equal(options.headers['x-upsert'], 'false'); assert.ok(Buffer.from(options.body).equals(f.bytes)); uploaded = true; return asJson({}); }
    return uploaded ? new Response(f.bytes) : new Response(JSON.stringify({ statusCode: '404', error: 'not_found', message: 'Object not found' }), { status: 400 });
  });
  assert.match(calls[0].route, /^\/storage\/v1\/object\/authenticated\/masters\/source-evidence\/autotrader\/[a-f0-9]{64}\.jpg$/);
  assert.match(calls[1].route, /^\/storage\/v1\/object\/masters\/source-evidence\/autotrader\//);
  let writes = 0;
  await assert.rejects(stageAsset(entry, async (_route, options = {}) => { if (options.method) writes++; return new Response('conflicting bytes'); }), /immutable_remote_asset_hash_mismatch/);
  assert.equal(writes, 0);
  await assert.rejects(stageAsset(entry, async (_route, options = {}) => {
    if (options.method) writes++;
    return new Response(JSON.stringify({ statusCode: '403', error: 'access_denied' }), { status: 400 });
  }), /retained_asset_download_http_400/);
  assert.equal(writes, 0);
});

function mockService(bytes) {
  const stored = new Map(), posted = [], failedOnce = { value: false };
  const pick = (row, filter) => {
    if (filter === 'structured_data->asset->>sha256') return row.structured_data.asset?.sha256;
    return row.structured_data[filter.replace('structured_data->>', '')];
  };
  const fetcher = async (address, options = {}) => {
    const url = new URL(address);
    assert.equal(options.headers.apikey, env.SUPABASE_SECRET_KEY);
    if (url.pathname.startsWith('/storage/')) { assert.match(url.pathname, /\/masters\/source-evidence\/autotrader\//); return new Response(bytes); }
    if (url.pathname === '/functions/v1/ingest-observation') {
      posted.push(options.body);
      const body = JSON.parse(options.body), envelope = body.envelope;
      const identifier = await historicalObservationIdentity(envelope);
      const existing = [...stored.values()].find((row) => row.source_identifier === identifier);
      if (existing) return asJson({ observation_id: existing.id, source_identifier: identifier, duplicate: true });
      const id = uuid(stored.size + 1), capture = envelope.record_type === 'capture' ? envelope : stored.get(envelope.capture_observation_id)?.structured_data;
      stored.set(id, { id, source_id: source, source_identifier: identifier, source_url: capture.asset.source_url, content_hash: sha(canonicalHistoricalJson(envelope)), structured_data: envelope, ingested_at: `2028-01-01T00:00:${String(stored.size + 1).padStart(2, '0')}Z`, observed_at: envelope.pass.observed_at, vehicle_id: null, is_superseded: false, superseded_at: null, kind: 'listing', extraction_method: HISTORICAL_ASK_METHOD });
      if (!failedOnce.value) { failedOnce.value = true; throw new Error('simulated_connection_lost_after_commit'); }
      return asJson({ observation_id: id, source_identifier: identifier });
    }
    if (url.pathname === '/rest/v1/observation_sources') return asJson([{ id: source }]);
    if (url.pathname === '/rest/v1/vehicle_observations') {
      let result = [...stored.values()];
      if (url.searchParams.has('id')) {
        const ids = url.searchParams.get('id').slice(4, -1).split(','); result = result.filter((row) => ids.includes(row.id));
      } else {
        for (const [key, filter] of url.searchParams) if (filter.startsWith('in.(')) {
          const values = filter.slice(4, -1).split(','); result = result.filter((row) => values.includes(pick(row, key)));
        }
      }
      return asJson(result);
    }
    throw new Error('unexpected_mock_route');
  };
  return { fetcher, stored, posted };
}

test('ambiguous intake retry reuses the exact envelope; later off-manifest withdrawal reaches report', async (t) => {
  const f = await fixture(t), p = await prepare(f.options), service = mockService(f.bytes);
  const options = { manifest: p.filename, command: 'admit', env, fetcher: service.fetcher };
  await assert.rejects(operate(options), /simulated_connection_lost_after_commit/);
  const result = await operate(options);
  assert.equal(service.posted[0], service.posted[1]);
  assert.equal(result.newly_admitted, 5); assert.equal(result.duplicates, 1); assert.equal(service.stored.size, 5);
  const head = [...service.stored.values()].find((row) => row.structured_data.previous_observation_id && row.structured_data.fields.raw.make === 'Synthetic');
  assert.ok(head);
  const envelope = { profile: head.structured_data.profile, record_type: 'withdrawal', issue: head.structured_data.issue, pass: { id: 'later-withdrawal-test', method: 'synthetic_test', version: '1', observed_at: '2028-01-02T00:00:00Z' }, capture_observation_id: head.structured_data.capture_observation_id, previous_observation_id: head.id, ad_key: head.structured_data.ad_key, reason: 'Synthetic later withdrawal outside original manifest.' };
  const id = uuid(6);
  service.stored.set(id, { ...head, id, source_identifier: await historicalObservationIdentity(envelope), content_hash: sha(canonicalHistoricalJson(envelope)), structured_data: envelope, ingested_at: '2028-01-02T00:00:01Z', observed_at: envelope.pass.observed_at });
  const live = await report({ manifest: p.filename, env, fetcher: service.fetcher });
  assert.equal(live.counts.supplied_rows, 6); assert.equal(live.counts.candidate_ads, 2); assert.equal(live.counts.qualified_asks, 0);
  assert.ok(live.exclusion_reason_counts.ad_withdrawn > 0);
  const prior = await report({ manifest: p.filename, env, fetcher: service.fetcher, knownAt: '2028-01-01T01:00:00Z', out: path.join(f.out, 'prior.json') });
  assert.equal(prior.counts.qualified_asks, 1); assert.equal(prior.counts.future_rows, 1);
});

test('missing exact IDs, oversized related history and legacy JWT credentials fail visibly', async () => {
  await assert.rejects(exactStoredRows([uuid(1)], async () => asJson([])), /manifest_incomplete_or_malformed/);
  const capture = { id: uuid(1), structured_data: { record_type: 'capture', asset: { sha256: 'a'.repeat(64) } } };
  await assert.rejects(relatedStoredClosure([capture], source, async () => asJson([capture, { id: uuid(2) }] ), 1), /truncated_or_malformed/);
  assert.throws(() => credentials({ SUPABASE_URL: env.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: 'legacy.jwt.value' }), /legacy_jwt_refused/);
});
