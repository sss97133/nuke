// Actual Edge handler + installed Supabase SDK, synthetic HTTP adapter only.
// NODE_PATH=nuke_frontend/node_modules node --test scripts/test-description-source-input.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const { createClient } = require('@supabase/supabase-js');
const vehicleId = '00000000-0000-4000-8000-000000000001';
const listingUrl = 'https://listing.invalid/cars/one';
const eventTime = '2020-01-01T00:00:00.000Z';
const captureTime = '2020-01-02T00:00:00.000Z';
const quote = 'The trunk floor needs replacement.';
const fullText = `${'Preserved seller prose. '.repeat(420)}Literal $& costs. ${quote} Choice of two rear axles, both needing rebuild.`;
const vehicle = { id: vehicleId, year: 1970, make: 'Fixture', model: 'Coupe',
  description: fullText.slice(0, 480), listing_url: listingUrl, discovery_url: null,
  deleted_at: null, listing_kind: null, sale_price: null, is_public: true };
const observation = { id: 'original-capture', vehicle_id: vehicleId, kind: 'listing', subject_type: 'vehicle',
  source_url: listingUrl, content_text: fullText, structured_data: {}, is_superseded: false,
  observed_at: eventTime, ingested_at: captureTime };
const rawMetadata = { id: 'raw-capture', vehicle_id: vehicleId, field_name: 'raw_listing_description',
  field_value: fullText, source_url: listingUrl, extracted_at: captureTime };
const snapshotId = '00000000-0000-4000-8000-000000000002';
const snapshotIngestion = '2020-01-03T00:00:00.000Z';
const snapshot = { id: snapshotId, platform: 'bat', listing_url: listingUrl, fetched_at: captureTime,
  created_at: snapshotIngestion, success: true, http_status: 200,
  html: `<div class="post-content"><p>${fullText}</p></div>`,
  metadata: { vehicle_id: vehicleId, vehicle_matched: true } };
const snapshotVehicle = { ...vehicle, origin_metadata: { bat_snapshot_parsed: { snapshot_id: snapshotId } } };
snapshot.html_sha256 = createHash('sha256').update(snapshot.html).digest('hex');

function compile(path) {
  const { outputText, diagnostics } = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, reportDiagnostics: true,
  });
  assert.equal(diagnostics?.length ?? 0, 0, `${path} must transpile`);
  return outputText;
}
const sources = new Map([
  ['handler', compile('../supabase/functions/discover-description-data/index.ts')],
  ['input', compile('../supabase/functions/discover-description-data/descriptionInput.ts')],
  ['guard', compile('../supabase/functions/_shared/writeGuard.ts')],
  ['hash', compile('../supabase/functions/_shared/observationContentHash.ts')],
  ['bat', compile('../supabase/functions/_shared/batParser.ts')],
]);

function fixture(options = {}) {
  const requests = [], modelPrompts = [], intake = [], cacheWrites = [];
  const successfulIntake = new Map();
  const rows = {
    vehicles: [options.vehicle ?? vehicle],
    vehicle_observations: [...(options.observations ?? [observation]), ...(options.cacheArtifact ? [{
      ...observation, id: 'retained-specification', kind: 'specification',
      raw_source_ref: options.cacheArtifact.source_ref, source_url: options.cacheArtifact.source_url,
      extraction_method: 'description_discovery_v2_full_source',
      extraction_metadata: { __description_condition_extraction: options.cacheArtifact },
    }] : [])],
    extraction_metadata: options.metadata ?? [],
    listing_page_snapshots: options.snapshots ?? [],
    description_discoveries: options.cached ? [{ id: 'existing-cache', vehicle_id: vehicleId, keys_found: 4,
      raw_extraction: options.cacheArtifact ? { __description_condition_extraction: options.cacheArtifact } : {} }] : [],
  };
  const env = { SUPABASE_URL: 'https://fixture.invalid', SUPABASE_SERVICE_ROLE_KEY: 'svc-test',
    ...(options.noModelKey ? {} : { KIMI_API_KEY: 'model-test' }) };
  let handler;
  async function fixtureFetch(input, init = {}) {
    const url = new URL(typeof input === 'string' ? input : input.url ?? input.href);
    const method = init.method ?? input.method ?? 'GET';
    const headers = new Headers(init.headers ?? input.headers);
    const body = init.body ? JSON.parse(init.body) : null;
    requests.push({ url, method, body });
    if (url.hostname === 'api.moonshot.ai') {
      modelPrompts.push(body.messages[0].content);
      const conditionPass = body.messages[0].content.includes('condition assessor');
      const content = options.badModel ? 'no JSON returned' : JSON.stringify(conditionPass
        ? [{ category: 'structural', severity: 'major', component: 'trunk floor', summary: 'Needs replacement',
          quote: options.invalidQuote ? 'The source does not say this.' : quote }]
        : { condition: { trunk_floor: 'needs replacement' }, parts_offered: ['axle choices'] });
      return Response.json({ choices: [{ finish_reason: options.truncatedModel ? 'length' : 'stop', message: { content } }] });
    }
    assert.equal(url.hostname, 'fixture.invalid', 'No real network or paid inference is allowed');
    if (url.pathname === '/auth/v1/user') return Response.json({ id: 'fixture-user' });
    if (url.pathname.startsWith('/auth/')) return Response.json({}, { status: 404 });
    assert.equal(headers.get('authorization'), 'Bearer svc-test', 'SDK intake uses service role');
    if (url.pathname.endsWith('/functions/v1/ingest-observation')) {
      intake.push(body);
      if (options.intakeFailure || (options.conditionFailure && body.kind === 'condition')) {
        return Response.json({ error: 'Synthetic intake refusal' }, { status: options.intakeHttpOk ? 200 : 500 });
      }
      const hash = await load('hash').observationContentHash(body);
      const existing = successfulIntake.get(hash);
      if (existing) return Response.json({ success: true, observation_id: existing, duplicate: true });
      const id = `inferred-${successfulIntake.size + 1}`;
      successfulIntake.set(hash, id);
      rows.vehicle_observations.push({ ...body, id, ingested_at: new Date().toISOString(), subject_type: 'vehicle',
        is_superseded: false });
      return Response.json({ success: true, observation_id: id, duplicate: false });
    }
    if (url.pathname.endsWith('/functions/v1/discover-description-data')) {
      assert.fail('A single-vehicle or refused batch must not start continuation');
    }
    if (url.pathname.endsWith('/rpc/observation_is_public')) {
      assert.ok(['listing', 'specification'].includes(body.p_kind));
      return Response.json(options.visibilityError ? { message: 'Synthetic visibility failure' } :
        options.restricted !== true, { status: options.visibilityError ? 500 : 200 });
    }
    if (url.pathname.endsWith('/rpc/execute_sql')) {
      assert.match(body.query, /v\.is_public = true/, 'Every batch/remaining query gates public parents');
      return Response.json(body.query.includes('SELECT EXISTS') ? [{ has_more: true }] : rows.vehicles
        .filter(row => row.is_public === true && row.deleted_at == null && row.listing_kind !== 'non_vehicle_item'));
    }
    if (url.pathname.endsWith('/rpc/persist_realization_plan')) return Response.json({});
    const table = url.pathname.split('/').at(-1);
    assert.ok(table in rows, `Unexpected table ${table}`);
    if (method === 'POST') {
      assert.equal(table, 'description_discoveries', 'Testimony has only the sanctioned intake path');
      assert.ok(intake.some(row => row.kind === 'specification'), 'Cache success follows awaited specification intake');
      assert.ok(!headers.get('prefer')?.includes('resolution=merge-duplicates'), 'Cached discoveries are not overwritten');
      cacheWrites.push(body);
      rows.description_discoveries.push({ ...body, id: 'new-cache' });
      return new Response(null, { status: 201 });
    }
    assert.equal(method, 'GET');
    assert.notEqual(table, 'extraction_metadata', 'Publicly writable raw metadata has no source custody');
    if (table === 'vehicle_observations') {
      assert.equal(url.searchParams.get('vehicle_id'), `eq.${vehicleId}`);
      assert.equal(url.searchParams.get('limit'), '5', 'Source selection is bounded per vehicle');
    }
    if ((options.lookupFailure && table === 'vehicle_observations') ||
        (options.snapshotFailure && table === 'listing_page_snapshots')) {
      return Response.json({ message: 'Synthetic lookup failure' }, { status: 500 });
    }
    let result = [...rows[table]];
    if (table === 'vehicles' && options.privateAfterModel && modelPrompts.length) {
      result = result.map(row => ({ ...row, is_public: false }));
    }
    for (const [key, value] of url.searchParams) {
      if (value.startsWith('eq.')) result = result.filter(row => String(row[key]) === value.slice(3));
      if (value === 'is.null') result = result.filter(row => row[key] == null);
      if (value.startsWith('lte.')) result = result.filter(row => new Date(row[key]) <= new Date(value.slice(4)));
      if (key === 'or' && value.includes('is_superseded')) result = result.filter(row => !row.is_superseded);
      if (key === 'or' && value.includes('listing_kind')) result = result.filter(row => row.listing_kind !== 'non_vehicle_item');
    }
    const ordering = (url.searchParams.get('order') ?? '').split(',').filter(Boolean);
    result.sort((a, b) => {
      for (const rule of ordering) {
        const [key, direction] = rule.split('.');
        if (a[key] !== b[key]) return (a[key] > b[key] ? 1 : -1) * (direction === 'desc' ? -1 : 1);
      }
      return 0;
    });
    result = result.slice(0, Number(url.searchParams.get('limit') ?? result.length));
    return Response.json(headers.get('accept')?.includes('vnd.pgrst.object') ? result[0] ?? null : result);
  }
  const modules = new Map();
  function load(name) {
    if (modules.has(name)) return modules.get(name);
    const exports = {};
    modules.set(name, exports);
    runInNewContext(sources.get(name), {
      exports, Request, Response, URL, TextEncoder, TextDecoder, crypto, AbortSignal, atob, btoa,
      console: { log() {}, warn() {}, error() {} }, fetch: fixtureFetch,
      Deno: { env: { get: name => env[name] }, serve: callback => { handler = callback; } },
      require: specifier => {
        if (specifier === 'https://esm.sh/@supabase/supabase-js@2') return {
          createClient: (url, key) => createClient(url, key, { global: { fetch: fixtureFetch },
            auth: { persistSession: false, autoRefreshToken: false } }),
        };
        if (specifier === './descriptionInput.ts') return load('input');
        if (specifier === '../_shared/batParser.ts') return load('bat');
        if (specifier === '../_shared/observationContentHash.ts') return load('hash');
        if (specifier === '../_shared/writeGuard.ts') return load('guard');
        if (specifier === './apiKeyAuth.ts') return { hashApiKey: () => assert.fail('No API-key path is used') };
        assert.fail(`Unexpected import ${specifier}`);
      },
    });
    return exports;
  }
  load('handler');
  async function run(body, token = 'svc-test') {
    const response = await handler(new Request('https://fixture.invalid/discover', {
      method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body: JSON.stringify(body),
    }));
    return { status: response.status, result: await response.json() };
  }
  return { run, requests, modelPrompts, intake, cacheWrites, successfulIntake,
    input: load('input'), hash: load('hash') };
}

test('normal miner sends the entire preserved source to both passes, then awaits cited inferred intake', async () => {
  const f = fixture();
  const { result } = await f.run({ vehicle_id: vehicleId, continue: true });
  assert.equal(result.discovered, 1);
  assert.equal(result.conditions_ingested, 1);
  assert.equal(result.continued, false);
  assert.equal(f.modelPrompts.length, 2);
  for (const prompt of f.modelPrompts) {
    assert.ok(prompt.includes(fullText), 'Tail beyond both 480 and 8000 chars survives unchanged, including literal $&');
  }
  assert.equal(f.cacheWrites[0].description_length, fullText.length);
  assert.equal(f.cacheWrites[0].model_used, 'kimi-k2-turbo-preview');
  assert.ok(!f.requests.some(r => r.url.pathname.endsWith('/rpc/execute_sql')), 'Point replay never surveys fleet work');
  for (const claim of f.intake) {
    assert.equal(claim.raw_source_ref, 'vehicle_observations:original-capture');
    assert.equal(claim.source_url, listingUrl);
    assert.equal(claim.observed_at, eventTime);
    assert.equal(claim.structured_data.source_ingested_at, captureTime);
    assert.equal(claim.structured_data.is_inferred, true);
    assert.equal(claim.agent_inferred, true);
    assert.equal(claim.defer_analysis, true);
    assert.equal(claim.structured_data.source_completeness, 'unknown');
    assert.equal(claim.structured_data.miner_input_truncated, false);
  }
  assert.equal(f.intake.find(row => row.kind === 'condition').citation.excerpt, quote);
  assert.equal(f.intake.find(row => row.kind === 'specification').citation.excerpt, fullText);
});

test('480-char summary resolves protected same-source snapshot text; source, capture and ingestion clocks remain separate', async () => {
  const f = fixture({ observations: [], metadata: [rawMetadata], vehicle: snapshotVehicle, snapshots: [snapshot] });
  const { result } = await f.run({ vehicle_id: vehicleId });
  assert.equal(result.discovered, 1);
  for (const claim of f.intake) {
    assert.equal(claim.raw_source_ref, `listing_page_snapshots:${snapshotId}`);
    assert.equal(claim.structured_data.source_observed_at, null);
    assert.equal(claim.structured_data.source_event_time_status, 'unknown');
    assert.equal(claim.structured_data.observation_time_basis, 'source_capture');
    assert.equal(claim.structured_data.source_captured_at, captureTime);
    assert.equal(claim.structured_data.source_ingested_at, snapshotIngestion);
    assert.equal(claim.structured_data.source_custody, 'protected_snapshot');
    assert.equal(claim.structured_data.source_capture_sha256, snapshot.html_sha256);
    assert.equal(claim.observed_at, captureTime);
  }
  const input = { text: fullText, sourceRef: `listing_page_snapshots:${snapshotId}`, sourceUrl: listingUrl,
    observedAt: null, capturedAt: captureTime, ingestedAt: snapshotIngestion };
  const first = f.input.conditionObservationInput(vehicleId, { quote }, input, 'fixture', '2021-01-01T00:00:00Z');
  const replay = f.input.conditionObservationInput(vehicleId, { quote }, input, 'fixture', '2022-01-01T00:00:00Z');
  assert.equal(await f.hash.observationContentHash(first), await f.hash.observationContentHash(replay));
});

test('condition-only point request is scoped and uses full input despite the short summary', async () => {
  const f = fixture({ observations: [], vehicle: snapshotVehicle, snapshots: [snapshot] });
  const { result } = await f.run({ mode: 'condition_backfill', vehicle_id: vehicleId, continue: true });
  assert.equal(result.processed, 1);
  assert.equal(result.conditions_ingested, 1);
  assert.equal(result.continued, false);
  assert.equal(f.cacheWrites.length, 0);
  assert.equal(f.modelPrompts.length, 1);
  assert.ok(f.modelPrompts[0].includes(fullText));
  assert.ok(f.requests.filter(r => r.url.pathname.endsWith('/vehicles')).every(r =>
    r.url.searchParams.get('id') === `eq.${vehicleId}`));
});

test('existing cache is retained without a configured model key, mining or writes', async () => {
  const f = fixture({ cached: true, noModelKey: true });
  const { result } = await f.run({ vehicle_id: vehicleId });
  assert.equal(result.cached, true);
  assert.equal(result.discovery_id, 'existing-cache');
  assert.equal(f.modelPrompts.length + f.intake.length + f.cacheWrites.length, 0);
});

test('operator preview needs service role and performs no writes or model calls', async () => {
  const f = fixture({ noModelKey: true });
  const { result } = await f.run({ mode: 'preview', vehicle_id: vehicleId });
  assert.equal(result.model_calls, 0);
  assert.equal(result.writes, 0);
  assert.ok(result.excerpts.some(row => row.quote.includes(quote)));
  assert.equal(f.modelPrompts.length + f.intake.length + f.cacheWrites.length, 0);
  const anon = await f.run({ mode: 'preview', vehicle_id: vehicleId }, null);
  assert.equal(anon.status, 401);
  const userToken = `${btoa(JSON.stringify({ alg: 'RS256' }))}.${btoa(JSON.stringify({ role: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 600 }))}.fixture`;
  assert.equal((await f.run({ mode: 'preview', vehicle_id: vehicleId }, userToken)).status, 403);
});

test('private, deleted and nonvehicle parents cannot read a cache, mine or write through point or batch modes', async () => {
  for (const changed of [{ is_public: false }, { deleted_at: captureTime }, { listing_kind: 'non_vehicle_item' }]) {
    for (const mode of [undefined, 'condition_backfill']) {
      const f = fixture({ vehicle: { ...vehicle, ...changed }, cached: true });
      const point = await f.run({ vehicle_id: vehicleId, mode });
      assert.equal(point.status, 500);
      assert.match(point.result.error, /Public vehicle unavailable/);
      assert.equal(f.requests.filter(r => /description_discoveries|vehicle_observations|listing_page_snapshots/
        .test(r.url.pathname)).length, 0, 'Refusal precedes cache/source access');
      const batch = await f.run({ batch_size: 1, mode });
      assert.equal(batch.result.discovered ?? batch.result.processed, 0);
      assert.equal(f.modelPrompts.length + f.intake.length + f.cacheWrites.length, 0);
    }
  }
});

test('a visibility change during inference is rechecked before intake and public cache writes', async () => {
  const f = fixture({ privateAfterModel: true });
  const { result } = await f.run({ vehicle_id: vehicleId });
  assert.equal(result.discovered, 0);
  assert.match(result.error_details[0], /Public vehicle unavailable/);
  assert.equal(f.intake.length + f.cacheWrites.length, 0);
});

test('the service-only no-write preview may inspect a private parent without creating public cache artifacts', async () => {
  const f = fixture({ vehicle: { ...vehicle, is_public: false }, noModelKey: true });
  const { result } = await f.run({ mode: 'preview', vehicle_id: vehicleId });
  assert.equal(result.success, true);
  assert.equal(result.source_custody, 'sanctioned_observation');
  assert.equal(f.modelPrompts.length + f.intake.length + f.cacheWrites.length, 0);
});

test('publicly writable raw metadata is never advertised as original captured text or model input', async () => {
  const f = fixture({ observations: [], metadata: [rawMetadata] });
  const { result } = await f.run({ vehicle_id: vehicleId });
  assert.equal(result.discovered, 0);
  assert.match(result.error_details[0], /metadata custody unknown/);
  assert.equal(f.modelPrompts.length + f.intake.length + f.cacheWrites.length, 0);
});

for (const [name, changed, extra] of [
  ['wrong source', { listing_url: 'https://other.invalid/two' }],
  ['relinked vehicle', { metadata: { vehicle_matched: true, vehicle_id: 'other-vehicle' } }],
  ['unmatched vehicle', { metadata: { vehicle_matched: false, vehicle_id: vehicleId } }],
  ['failed capture', { success: false }],
  ['wrong platform', { platform: 'unknown' }],
  ['HTTP failure', { http_status: 500 }],
  ['unknown HTTP status', { http_status: null }],
  ['unknown capture time', { fetched_at: null }],
  ['unknown ingestion time', { created_at: null }],
  ['future capture', { fetched_at: '2999-01-01T00:00:00Z' }],
  ['future ingestion', { created_at: '2999-01-01T00:00:00Z' }],
  ['receipt-only source', { html: null, html_storage_path: 'protected/path.html' }],
  ['oversized archive', { html: 'x'.repeat(5_000_001) }],
  ['missing preserved prose', { html: '<html>Only a listing title</html>' }],
  ['missing capture hash', { html_sha256: null }],
  ['malformed capture hash', { html_sha256: 'unknown' }],
  ['mismatched capture hash', { html_sha256: '0'.repeat(64) }],
  ['unavailable snapshot', {}, { snapshots: [] }],
  ['snapshot lookup failure', {}, { snapshotFailure: true }],
]) {
  test(`${name} cannot be rescued by mutable metadata or a summary`, async () => {
    const f = fixture({ vehicle: snapshotVehicle, observations: [], metadata: [rawMetadata],
      snapshots: [{ ...snapshot, ...changed }], ...extra });
    const { result } = await f.run({ vehicle_id: vehicleId });
    assert.equal(result.discovered, 0);
    assert.equal(result.errors, 1);
    assert.match(result.error_details[0], /snapshot/);
    assert.equal(f.modelPrompts.length + f.intake.length + f.cacheWrites.length, 0);
  });
}

test('a protected but older capture cannot repair a newer missing read', async () => {
  const f = fixture({ vehicle: snapshotVehicle, snapshots: [snapshot],
    observations: [{ ...observation, content_text: null, ingested_at: '2020-02-01T00:00:00Z' }] });
  const { result } = await f.run({ vehicle_id: vehicleId });
  assert.match(result.error_details[0], /unavailable/);
  assert.equal(f.modelPrompts.length + f.intake.length + f.cacheWrites.length, 0);
});

for (const [name, options, error] of [
  ['missing capture', { observations: [] }, /unavailable/],
  ['unknown listing URL', { observations: [], metadata: [], vehicle: { ...vehicle, listing_url: null } }, /unknown or ambiguous/],
  ['ambiguous source', { vehicle: { ...vehicle, listing_url: null }, observations: [observation,
    { ...observation, source_url: 'https://other.invalid/two' }] }, /ambiguous/],
  ['mismatched URL', { observations: [{ ...observation, source_url: 'https://other.invalid/two' }] }, /unavailable/],
  ['oversized latest capture', { observations: [{ ...observation, content_text: 'x'.repeat(32_001) }],
    metadata: [{ ...rawMetadata, extracted_at: eventTime }] }, /not truncated/],
  ['restricted latest capture', { restricted: true, metadata: [rawMetadata] }, /restricted/],
  ['visibility unavailable', { visibilityError: true, metadata: [rawMetadata] }, /restricted/],
  ['lookup failure', { lookupFailure: true }, /lookup failed/],
  ['superseded source', { observations: [{ ...observation, is_superseded: true }] }, /unavailable/],
  ['future event', { observations: [{ ...observation, observed_at: '2999-01-01T00:00:00Z' }] }, /unavailable/],
  ['future ingestion', { observations: [{ ...observation, ingested_at: '2999-01-01T00:00:00Z' }] }, /unavailable/],
  ['changed subject', { observations: [{ ...observation, structured_data: { subject_type: 'person' } }] }, /restricted/],
  ['missing latest read with older prose', { observations: [{ ...observation, content_text: null }],
    metadata: [{ ...rawMetadata, extracted_at: eventTime }] }, /unavailable/],
]) {
  test(`${name} is refused before inference, cache or intake`, async () => {
    const f = fixture(options);
    const { result } = await f.run({ vehicle_id: vehicleId });
    assert.equal(result.errors, 1);
    assert.match(result.error_details[0], error);
    assert.equal(f.modelPrompts.length + f.intake.length + f.cacheWrites.length, 0);
  });
}

test('latest event wins, NULL supersession is eligible, tracking does not change source identity', async () => {
  const f = fixture({ observations: [{ ...observation, id: 'old', content_text: 'Old prose. '.repeat(30) },
    { ...observation, id: 'new', observed_at: '2020-02-01T00:00:00Z', is_superseded: null,
      source_url: `${listingUrl}?utm_source=fixture#section` }] });
  const { result } = await f.run({ vehicle_id: vehicleId });
  assert.equal(result.discovered, 1);
  assert.ok(f.intake.every(row => row.raw_source_ref === 'vehicle_observations:new'));
});

test('newer protected snapshot prose is used instead of an observation summary', async () => {
  const f = fixture({ observations: [{ ...observation, content_text: fullText.slice(0, 480) }],
    vehicle: snapshotVehicle, snapshots: [{ ...snapshot, fetched_at: '2020-02-01T00:00:00Z',
      created_at: '2020-02-01T00:00:01Z' }] });
  const { result } = await f.run({ vehicle_id: vehicleId });
  assert.equal(result.discovered, 1);
  assert.ok(f.modelPrompts.every(prompt => prompt.includes(fullText)));
  assert.ok(f.intake.every(row => row.raw_source_ref === `listing_page_snapshots:${snapshotId}`));
});

test('a 480-char structured summary cannot hide fuller content from the same capture', async () => {
  const f = fixture({ observations: [{ ...observation, structured_data: { description: fullText.slice(0, 480) } }] });
  const { result } = await f.run({ vehicle_id: vehicleId });
  assert.equal(result.discovered, 1);
  assert.ok(f.modelPrompts.every(prompt => prompt.includes(fullText)));
  assert.ok(f.intake.every(row => row.structured_data.source_text_field === 'vehicle_observations.content_text'));
  assert.ok(f.intake.every(row => row.structured_data.source_completeness === 'unknown'));
});

test('a source outside the five recent candidates is unavailable, rather than pretending complete coverage', async () => {
  const f = fixture({ observations: [observation, ...Array.from({ length: 5 }, (_, i) => ({ ...observation,
    id: `other-${i}`, source_url: `https://other.invalid/${i}`, observed_at: `2020-02-0${i + 1}T00:00:00Z` }))] });
  const { result } = await f.run({ vehicle_id: vehicleId });
  assert.match(result.error_details[0], /unavailable/);
  assert.equal(f.modelPrompts.length, 0);
});

test('query parameters that identify another listing are not discarded', async () => {
  const f = fixture({ vehicle: { ...vehicle, listing_url: `${listingUrl}?item=one` },
    observations: [{ ...observation, source_url: `${listingUrl}?item=two` }] });
  const { result } = await f.run({ vehicle_id: vehicleId });
  assert.match(result.error_details[0], /unavailable/);
  assert.equal(f.modelPrompts.length, 0);
});

test('intake rejection, including HTTP 200 error, stays visible and never creates a cached success', async () => {
  for (const intakeHttpOk of [false, true]) {
    const f = fixture({ intakeFailure: true, intakeHttpOk });
    const { result } = await f.run({ vehicle_id: vehicleId });
    assert.equal(result.discovered, 0);
    assert.match(result.error_details[0], /intake failed/);
    assert.equal(f.cacheWrites.length, 0);
  }
});

test('conditions must quote source verbatim; refusal is reported without blocking a successful discovery', async () => {
  const f = fixture({ invalidQuote: true });
  const { result } = await f.run({ vehicle_id: vehicleId });
  assert.equal(result.discovered, 1);
  assert.equal(result.condition_errors, 1);
  assert.equal(result.conditions_ingested, 0);
  assert.ok(f.intake.every(row => row.kind !== 'condition'));
});

test('partial condition intake retries from the retained artifact without model calls, cache overwrites or duplicate assessments', async () => {
  const options = { conditionFailure: true };
  const f = fixture(options);
  const first = await f.run({ vehicle_id: vehicleId });
  assert.equal(first.result.discovered, 1);
  assert.equal(first.result.condition_errors, 1);
  assert.equal(first.result.condition_retries[0].cached_conditions_only, true);
  assert.equal(f.successfulIntake.size, 1);
  assert.equal(f.cacheWrites.length, 1);
  const retainedCache = JSON.stringify(f.cacheWrites[0]);
  assert.equal(f.cacheWrites[0].raw_extraction.__description_condition_extraction, undefined,
    'Condition quotes are never retained in the public learning cache');
  assert.ok(f.intake.find(row => row.kind === 'specification').extraction_metadata
    .__description_condition_extraction.conditions.length > 0, 'Original output stays under observation parent RLS');
  options.conditionFailure = false;
  const retry = await f.run(first.result.condition_retries[0]);
  assert.equal(retry.result.cached_condition_passes, 1);
  assert.equal(retry.result.conditions_ingested, 1);
  assert.equal(f.modelPrompts.length, 2, 'Only the initial normal request pays for its two passes');
  assert.equal(f.successfulIntake.size, 2);
  const repeated = await f.run({ mode: 'condition_backfill', vehicle_id: vehicleId });
  assert.equal(repeated.result.conditions_ingested, 0);
  assert.equal(repeated.result.conditions_replayed, 1);
  assert.equal(f.successfulIntake.size, 2, 'Canonical content hash returns the same condition on replay');
  assert.equal(f.cacheWrites.length, 1);
  assert.equal(JSON.stringify(f.cacheWrites[0]), retainedCache);
});

test('matching cached condition output works with no model key; changed source content is not reused', async () => {
  const f = fixture({ noModelKey: true });
  const input = { text: fullText, sourceRef: 'vehicle_observations:original-capture', sourceUrl: listingUrl,
    observedAt: eventTime, ingestedAt: captureTime, textField: 'vehicle_observations.content_text' };
  const artifact = await f.input.conditionExtractionArtifact(input, [{ quote }], 'original-model');
  const cached = fixture({ cached: true, noModelKey: true, cacheArtifact: JSON.parse(JSON.stringify(artifact)) });
  const replay = await cached.run({ mode: 'condition_backfill', vehicle_id: vehicleId });
  assert.equal(replay.result.cached_condition_passes, 1);
  assert.equal(replay.result.conditions_ingested, 1);
  assert.equal(cached.modelPrompts.length + cached.cacheWrites.length, 0);
  assert.equal(cached.intake[0].agent_model, 'original-model');
  for (const changed of [{ content_text: `${fullText} Changed.` }, { id: 'relinked' }, { observed_at: captureTime }]) {
    const stale = fixture({ cached: true, cacheArtifact: artifact,
      observations: [{ ...observation, ...changed }] });
    const result = await stale.run({ mode: 'condition_backfill', vehicle_id: vehicleId, cached_conditions_only: true });
    assert.match(result.result.error_details[0], /retry refused without inference/);
    assert.equal(stale.modelPrompts.length + stale.intake.length + stale.cacheWrites.length, 0);
  }
});

test('truncated or malformed model output cannot become a successful cache record', async () => {
  for (const options of [{ truncatedModel: true }, { badModel: true }]) {
    const f = fixture(options);
    const { result } = await f.run({ vehicle_id: vehicleId });
    assert.equal(result.discovered, 0);
    assert.equal(result.errors, 1);
    assert.equal(f.intake.length + f.cacheWrites.length, 0);
  }
});

test('an all-refused batch reports failure without indefinite self-continuation', async () => {
  const f = fixture({ observations: [] });
  const { result } = await f.run({ batch_size: 1, continue: true });
  assert.equal(result.errors, 1);
  assert.equal(result.continued, false);
});

test('native forward capture retains unknown original event clock for later inferred reports', async () => {
  const f=fixture({observations:[{...observation,observed_at:captureTime,structured_data:{
    observation_time_basis:'source_capture',source_event_time_status:'unknown',source_captured_at:captureTime}}]});
  const {result}=await f.run({vehicle_id:vehicleId});assert.equal(result.success,true);
  const report=f.intake.find(row=>row.kind==='specification');
  assert.equal(report.extraction_metadata.source_observed_at,null);
  assert.equal(report.extraction_metadata.source_captured_at,captureTime);
  assert.equal(report.extraction_metadata.source_event_time_status,'unknown');
  assert.equal(report.extraction_metadata.observation_time_basis,'source_capture');
});
test('inconsistent native capture clocks cannot silently become inferred source-event testimony',async()=>{
  const f=fixture({observations:[{...observation,structured_data:{observation_time_basis:'source_capture',
    source_event_time_status:'unknown',source_captured_at:captureTime}}]});
  const {result}=await f.run({vehicle_id:vehicleId});assert.match(result.error_details[0],/capture clock inconsistent/);
  assert.equal(f.intake.length,0);assert.equal(f.modelPrompts.length,0);
});

test('sub-millisecond drift in a native capture cannot pass source ancestry',async()=>{
 const f=fixture({observations:[{...observation,observed_at:'2020-01-01T00:00:00.123456Z',structured_data:{
 observation_time_basis:'source_capture',source_event_time_status:'unknown',source_captured_at:'2020-01-01T00:00:00.123457Z'}}]});
 const {result}=await f.run({vehicle_id:vehicleId});assert.match(result.error_details[0],/capture clock inconsistent/);assert.equal(f.intake.length,0);
});
test('native capture comparison accepts equivalent explicit zones without changing microsecond bytes',async()=>{
 const capturedAt='2020-01-01 00:00:00.123456+00';
 const f=fixture({observations:[{...observation,observed_at:'2020-01-01T01:00:00.123456+01:00',structured_data:{
 observation_time_basis:'source_capture',source_event_time_status:'unknown',source_captured_at:capturedAt,source_capture_sha256:'a'.repeat(64)}}]});
 const {result}=await f.run({vehicle_id:vehicleId});assert.equal(result.success,true);
 const report=f.intake.find(row=>row.kind==='specification');assert.equal(report.extraction_metadata.source_captured_at,capturedAt);
 assert.equal(report.extraction_metadata.source_capture_sha256,'a'.repeat(64));
});
