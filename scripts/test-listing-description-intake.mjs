// Actual description producer helper + installed Supabase SDK; no live requests.
import assert from 'node:assert/strict';
import { createHash, createHmac, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const { createClient } = require('@supabase/supabase-js');
const filename = new URL('../supabase/functions/extract-bat-core/descriptionObservation.ts', import.meta.url);
const source = ts.transpileModule(readFileSync(filename,'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2022 } }).outputText;
const module = { exports: {} };
const hashModule = {exports:{}};
const hashSource=ts.transpileModule(readFileSync(new URL('../supabase/functions/_shared/observationContentHash.ts',import.meta.url),'utf8'),
 {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
runInNewContext(hashSource,{exports:hashModule.exports,module:hashModule,Date,BigInt,
 crypto:webcrypto,TextEncoder,Uint8Array});
runInNewContext(source, { exports: module.exports, module, Date, BigInt, require: path=>{
 assert.equal(path,'../_shared/observationContentHash.ts');return hashModule.exports; } });
const { recordListingDescription } = module.exports;
const input = { vehicleId: '00000000-0000-4000-8000-000000000001', sourceUrl: 'https://bringatrailer.com/listing/fixture',
  extractorVersion: 'extract-bat-core:4.2.5',
  text: 'Original parsed seller prose. '.repeat(110)+'Full text tail: trunk floor needs replacement.',
  capturedAt: '2020-01-01T00:00:00.000Z', captureBasis: 'direct', captureSha256: 'a'.repeat(64) };
function sdk(options={}) {
  const requests=[];
  const client = createClient('https://fixture.invalid','synthetic-service', { auth: { persistSession:false }, global: { fetch: async (url,init) => {
    assert.equal(new URL(url).pathname, '/functions/v1/ingest-observation', 'No raw table, external page or paid model calls');
    const body=JSON.parse(init.body);requests.push(body);
    if(options.wait) await options.wait;
    return Response.json(options.refusal ? { success:false,error:'Synthetic intake refusal' } : options.noReceipt ? {success:true} :
      { success:true,observation_id:'00000000-0000-4000-8000-000000000002',duplicate:options.duplicate===true }, {status:options.status??200});
  }}});
  return {client,requests};
}
test('full prose is awaited through actual canonical SDK with no vehicle gap-fill',async()=>{
  let release;const wait=new Promise(resolve=>release=resolve);const f=sdk({wait});let finished=false;
  const pending=recordListingDescription(f.client,input).then(r=>{finished=true;return r;});
  await new Promise(resolve=>setTimeout(resolve,0));assert.equal(f.requests.length,1);assert.equal(finished,false);
  release();assert.equal((await pending).status,'recorded');const body=f.requests[0];
  assert.equal(body.content_text,input.text);assert.ok(body.content_text.length>480);assert.equal(body.structured_data.description,undefined);
  assert.equal(body.kind,'listing');assert.equal(body.defer_analysis,true);assert.equal(body.agent_inferred,undefined);
  assert.equal(body.structured_data.source_event_time_status,'unknown');assert.equal(body.structured_data.observation_time_basis,'source_capture');
  assert.equal(body.structured_data.source_captured_at,input.capturedAt);assert.equal(body.observed_at,input.capturedAt);
  assert.equal(body.structured_data.source_completeness,'unknown');assert.equal(body.structured_data.extractor_input_truncated,false);
});
test('same cached receipt is deterministic and SDK duplicate remains successful',async()=>{
  const f=sdk({duplicate:true});const snap={...input,captureBasis:'snapshot',snapshotId:'capture-1',snapshotCustody:{vehicleId:input.vehicleId,matched:true,sha256:input.captureSha256}};
  const a=await recordListingDescription(f.client,snap),b=await recordListingDescription(f.client,snap);
  assert.equal(a.duplicate,true);assert.equal(b.status,'recorded');assert.deepEqual(f.requests[0],f.requests[1]);
  assert.equal(f.requests[0].raw_source_ref,'listing_page_snapshots:capture-1');
});
for(const [name,change,status] of [ ['empty',{text:''},'unavailable'],['oversize',{text:'x'.repeat(32001)},'refused'],
 ['unknown capture',{capturedAt:null},'refused'],['invalid capture',{capturedAt:'bad'},'refused'],['invalid calendar',{capturedAt:'2020-02-31T00:00:00Z'},'refused'],['unknown fingerprint',{captureSha256:''},'refused'],
 ['unqualified capture',{capturedAt:'2020-01-01T00:00:00'},'refused'],['future capture',{capturedAt:'2099-01-01T00:00:00Z'},'refused'],
 ['unattested snapshot',{captureBasis:'snapshot',snapshotId:'capture-1'},'refused'],
 ['relinked snapshot',{captureBasis:'snapshot',snapshotId:'capture-1',snapshotCustody:{vehicleId:'other',matched:true,sha256:input.captureSha256}},'refused'],
 ['changed capture bytes',{captureBasis:'snapshot',snapshotId:'capture-1',snapshotCustody:{vehicleId:input.vehicleId,matched:true,sha256:'b'.repeat(64)}},'refused'] ]) {
 test(`${name} stays visible and makes no intake call`,async()=>{const f=sdk();const r=await recordListingDescription(f.client,{...input,...change});assert.equal(r.status,status);assert.equal(f.requests.length,0);assert.ok(r.reason);});
}
for(const [name,options] of [['HTTP refusal',{status:500,refusal:true}],['logical refusal',{refusal:true}],['missing receipt',{noReceipt:true}]])
 test(`${name} cannot report delivery`,async()=>{const f=sdk(options);assert.equal((await recordListingDescription(f.client,input)).status,'failed');});

test('original zoned capture bytes including microseconds are retained in both intake clocks',async()=>{
 const f=sdk();const capturedAt='2020-01-01 00:00:00.123456+00';await recordListingDescription(f.client,{...input,capturedAt});
 assert.equal(f.requests[0].observed_at,capturedAt);assert.equal(f.requests[0].structured_data.source_captured_at,capturedAt);
});

// Traverse the actual intake, including authentication, hash/replay and the installed
// PostgREST SDK. Only the network/server boundary is synthetic. The existing PG17
// description contract independently proves NULL admission and the slug's 22P02.
function canonicalIntake(options = {}) {
  const requests = [], intakes = [], errors = [], committed = new Map(), modules = new Map();
  const handlers = new Map(), reads = new Map();
  const vehicle = { id: input.vehicleId, listing_url: input.sourceUrl, discovery_url: null,
    is_public: true, deleted_at: null, listing_kind: null, ...options.vehicle };
  const snapshot = { id: '00000000-0000-4000-8000-000000000004', platform: 'bat', listing_url: input.sourceUrl,
    fetched_at: '2020-01-01 00:00:00.123456+00', created_at: '2020-01-01T00:00:01.123457+00:00',
    success: true, http_status: 200, html: `<div class="post-content"><p>${input.text}</p></div>`,
    metadata: { vehicle_id: input.vehicleId, vehicle_matched: true } };
  snapshot.html_sha256 = createHash('sha256').update(snapshot.html).digest('hex');
  Object.assign(snapshot, options.snapshot);
  const observations = options.observations ?? [];
  const env = { SUPABASE_URL: 'https://fixture.invalid', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service',
    JWT_SIGNING_SECRET: 'synthetic-jwt-secret' };
  async function network(request, init = {}) {
    const url = new URL(typeof request === 'string' ? request : request.url ?? request.href);
    assert.equal(url.hostname, 'fixture.invalid', 'No source re-download, real database or model call');
    const method = init.method ?? request.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    requests.push({ path: url.pathname, method, body, params: url.searchParams });
    if (url.pathname === '/functions/v1/ingest-observation') {
      const admitted = options.legacyExtractorSlug ? { ...body, extractor_id: 'extract-bat-core' } : body;
      intakes.push(admitted);
      return handlers.get('intake')(new Request(url, { ...init, body: JSON.stringify(admitted) }));
    }
    if (url.pathname === '/rest/v1/observation_sources') return Response.json(options.sourceUnavailable ? [] : [{
      id: '00000000-0000-4000-8000-000000000003', base_trust_score: .85, supported_observations: ['listing'],
    }]);
    if (url.pathname === '/rest/v1/rpc/observation_is_public') return Response.json(options.restricted !== true);
    if (url.pathname === '/rest/v1/vehicle_observations') {
      if (method === 'GET') {
        if (url.searchParams.has('content_hash')) {
          const existing = committed.get(url.searchParams.get('content_hash').replace(/^eq\./, ''));
          options.onHashRead?.(existing, committed);
          const sameKey = existing && ['source_id','source_identifier','kind'].every(key =>
            !url.searchParams.has(key) || `eq.${existing[key]}` === url.searchParams.get(key));
          return Response.json(sameKey ? [existing] : []);
        }
        if (url.searchParams.has('id')) {
          const existing = [...committed.values()].find(row => `eq.${row.id}` === url.searchParams.get('id'));
          options.onReceiptRead?.(existing);
          return Response.json(existing ? [existing] : []);
        }
      }
      if (method === 'POST') {
        if (body.extractor_id != null && !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(body.extractor_id)) {
          return Response.json({ code: '22P02', message: `invalid input syntax for type uuid: "${body.extractor_id}"` }, { status: 400 });
        }
        const current = committed.get(body.content_hash);
        // PostgreSQL's actual unique key permits duplicate NULL identifiers.
        // Only the same fully non-NULL source/identifier/kind/hash conflicts.
        if (current && body.source_identifier != null && current.source_identifier != null &&
          current.source_id === body.source_id && current.source_identifier === body.source_identifier &&
          current.kind === body.kind) return Response.json({ code: '23505', message: 'Duplicate composite receipt' }, { status: 409 });
        const receipt = { ...body, id: '00000000-0000-4000-8000-000000000002',
          subject_type: 'vehicle', is_superseded: false, ingested_at: new Date().toISOString() };
        committed.set(body.content_hash, receipt);
        return Response.json([receipt], { status: 201 });
      }
    }
    if (['/rest/v1/vehicles', '/rest/v1/listing_page_snapshots', '/rest/v1/vehicle_observations'].includes(url.pathname) && method === 'GET') {
      const table = url.pathname.split('/').at(-1);
      const count = (reads.get(table) ?? 0) + 1;
      reads.set(table, count);
      options.onRead?.(table, count, { vehicle, snapshot, observations, committed });
      let rows = table === 'vehicles' ? [vehicle] : table === 'listing_page_snapshots' ? [snapshot] :
        [...observations, ...committed.values()];
      for (const [key, value] of url.searchParams) {
        if (value.startsWith('eq.')) rows = rows.filter(row => String(row[key]) === value.slice(3));
        if (value === 'is.null') rows = rows.filter(row => row[key] == null);
        if (value.startsWith('lte.')) rows = rows.filter(row => Date.parse(row[key]) <= Date.parse(value.slice(4)));
        if (key === 'or' && value.includes('is_superseded')) rows = rows.filter(row => row.is_superseded !== true);
        if (key === 'or' && value.includes('listing_kind')) rows = rows.filter(row => row.listing_kind !== 'non_vehicle_item');
      }
      const ordering = (url.searchParams.get('order') ?? '').split(',').filter(Boolean);
      rows.sort((a,b) => { for (const rule of ordering) {
        const [key,direction] = rule.split('.');
        if (a[key] !== b[key]) return (a[key] > b[key] ? 1 : -1) * (direction === 'desc' ? -1 : 1);
      } return 0; });
      return Response.json(rows.slice(0, Number(url.searchParams.get('limit') ?? rows.length)));
    }
    throw new Error(`Unexpected request: ${method} ${url.pathname}`);
  }
  const client = (url, key, config = {}) => createClient(url, key, {
    ...config, global: { ...config.global, fetch: network },
  });
  function load(filename) {
    if (modules.has(filename.href)) return modules.get(filename.href).exports;
    const module = { exports: {} };
    modules.set(filename.href, module);
    const compiled = ts.transpileModule(readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, reportDiagnostics: true,
    });
    assert.equal(compiled.diagnostics?.length ?? 0, 0, `${filename.pathname} must transpile`);
    runInNewContext(compiled.outputText, {
      exports: module.exports, module, Date, BigInt, URL, Request, Response, Headers,
      TextEncoder, TextDecoder, Uint8Array, crypto: webcrypto, fetch: network, atob, btoa, setTimeout, clearTimeout, AbortSignal,
      console: { log() {}, warn() {}, error: (...args) => errors.push(args) },
      Deno: { env: { get: key => env[key] }, serve: callback => {
        handlers.set(filename.pathname.includes('/extract-bat-core/') ? 'core' : 'intake', callback);
      } },
      require: name => {
        if (['https://esm.sh/@supabase/supabase-js@2', 'https://esm.sh/@supabase/supabase-js@2.45.4'].includes(name)) return { createClient: client };
        assert.ok(name.startsWith('.'), `No downloaded import: ${name}`);
        if (filename.pathname.endsWith('/extract-bat-core/index.ts') &&
          ['../_shared/listingUrl.ts','../_shared/parseLocation.ts','../_shared/normalizeVehicle.ts',
            '../_shared/extractionQualityGate.ts','../_shared/batUpsertWithProvenance.ts',
            '../_shared/observationWriter.ts','../_shared/batAuctionRecord.ts'].includes(name)) {
          return new Proxy({}, { get: (_, key) => () => assert.fail(`Historical mode reached legacy capability: ${String(key)}`) });
        }
        return load(new URL(name, filename));
      },
    });
    return module.exports;
  }
  load(new URL('../supabase/functions/ingest-observation/index.ts', import.meta.url));
  assert.equal(typeof handlers.get('intake'), 'function');
  if (options.core) load(new URL('../supabase/functions/extract-bat-core/index.ts', import.meta.url));
  return { client: client(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }),
    requests, intakes, errors, committed, snapshot, vehicle, observations,
    call: async (body = {}, authorization = env.SUPABASE_SERVICE_ROLE_KEY, method = 'POST') => {
      const response = await handlers.get('core')(new Request('https://fixture.invalid/functions/v1/extract-bat-core', {
        method, headers: { authorization: `Bearer ${authorization}`, 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'description_source', vehicle_id: vehicle.id,
          snapshot_id: snapshot.id, expected_capture_sha256: snapshot.html_sha256, ...body }),
      }));
      return { status: response.status, body: await response.json() };
    } };
}

test('producer crosses actual intake UUID boundary and replays without inference or raw vehicle writes', async () => {
  const f = canonicalIntake();
  const capturedAt = '2020-01-01 00:00:00.123456+00';
  const receipt = await recordListingDescription(f.client, { ...input, capturedAt });
  assert.equal(receipt.status, 'recorded', f.errors.flat().map(e => e?.stack ?? JSON.stringify(e)).join('\n'));
  const insert = f.requests.find(r => r.path === '/rest/v1/vehicle_observations' && r.method === 'POST').body;
  assert.equal(insert.extractor_id, undefined, 'Unknown optional registry identity remains omitted');
  assert.equal(insert.extraction_method, 'html_description_capture');
  assert.equal(insert.structured_data.extractor, 'extract-bat-core');
  assert.equal(insert.structured_data.extractor_version, input.extractorVersion);
  assert.equal(insert.content_text, input.text);
  assert.equal(insert.observed_at, capturedAt);
  assert.equal(insert.structured_data.source_captured_at, capturedAt);
  assert.equal(insert.structured_data.source_event_time_status, 'unknown');
  assert.equal(insert.structured_data.source_completeness, 'unknown');
  assert.match(insert.content_hash, /^[0-9a-f]{64}$/);
  const replay = await recordListingDescription(f.client, { ...input, capturedAt });
  assert.equal(replay.status, 'recorded');
  assert.equal(replay.duplicate, true);
  assert.equal(replay.observation_id, receipt.observation_id);
  assert.equal(f.requests.filter(r => r.method === 'POST' && r.path.startsWith('/rest/')).length, 1);
  assert.ok(f.requests.every(r => ['/functions/v1/ingest-observation', '/rest/v1/observation_sources',
    '/rest/v1/vehicle_observations'].includes(r.path)), 'No independent writer, inference or source fetch');
});

test('pre-repair slug reproduces canonical intake 22P02 and never reports delivery', async () => {
  const f = canonicalIntake({ legacyExtractorSlug: true });
  const receipt = await recordListingDescription(f.client, input);
  assert.equal(receipt.status, 'failed');
  assert.equal(f.errors.length, 1);
  assert.equal(f.errors[0][1].code, '22P02', f.errors.flat().map(e => e?.stack ?? JSON.stringify(e)).join('\n'));
  assert.equal(f.errors[0][1].message, 'invalid input syntax for type uuid: "extract-bat-core"');
  assert.equal(f.requests.filter(r => r.path === '/rest/v1/vehicle_observations' && r.method === 'POST').length, 1);
});

const errorText = f => f.errors.flat().map(e => e?.stack ?? JSON.stringify(e)).join('\n');
const writes = f => f.requests.filter(r => r.method !== 'GET' && !r.path.endsWith('/rpc/observation_is_public'));
test('actual core defaults to service-only protected preview with zero writes and no model key', async () => {
  const f = canonicalIntake({ core: true, vehicle: { origin_metadata: { bat_snapshot_parsed: {
    snapshot_id: 'mutable-locator-is-ignored', description: 'Untrusted text', fetched_at: '2099-01-01' } } } });
  const result = await f.call();
  assert.equal(result.status, 200, errorText(f));
  assert.equal(result.body.dry_run, true);
  assert.equal(result.body.writes, 0);
  assert.equal(result.body.model_calls, 0);
  assert.equal(result.body.source_ref, `listing_page_snapshots:${f.snapshot.id}`);
  assert.equal(result.body.source_captured_at, f.snapshot.fetched_at);
  assert.equal(result.body.source_ingested_at, f.snapshot.created_at);
  assert.equal(result.body.source_observed_at, null);
  assert.equal(result.body.source_event_time_status, 'unknown');
  assert.equal(result.body.source_completeness, 'unknown');
  assert.equal(result.body.source_text_field, 'listing_page_snapshots.html:batParser.extractDescription');
  assert.equal(result.body.source_capture_sha256, f.snapshot.html_sha256);
  assert.equal(result.body.input_characters, input.text.length);
  assert.equal(result.body.input_sha256, createHash('sha256').update(input.text).digest('hex'));
  assert.equal(result.body.description_receipt.status, 'preview');
  assert.equal(result.body.description_receipt.existing_observation_id, null);
  assert.match(result.body.description_receipt.observation_payload_sha256, /^[0-9a-f]{64}$/);
  assert.match(result.body.admission_basis, /multi-request, not atomic/);
  assert.deepEqual(writes(f), []);
  assert.equal(f.intakes.length, 0);
  assert.ok(!JSON.stringify(result.body).includes(f.snapshot.html), 'Preview does not return raw archive HTML');
  assert.ok(f.requests.filter(r => r.path.endsWith('/vehicle_observations') && r.params.has('vehicle_id'))
    .every(r => r.params.get('limit') === '5'), 'Source eligibility grain is five observations');
});

test('explicit historical append crosses actual canonical intake with exact archive clocks and replay', async () => {
  const f = canonicalIntake({ core: true });
  const preview = await f.call();
  const result = await f.call({ dry_run: false });
  assert.equal(result.status, 200, errorText(f));
  assert.equal(result.body.writes, 1);
  assert.equal(result.body.description_receipt.status, 'recorded');
  const row = [...f.committed.values()][0];
  assert.equal(row.content_text, input.text);
  assert.equal(row.observed_at, f.snapshot.fetched_at);
  assert.equal(row.structured_data.source_captured_at, f.snapshot.fetched_at);
  assert.equal(row.structured_data.source_archive_ingested_at, f.snapshot.created_at);
  assert.equal(row.structured_data.source_text_field, 'listing_page_snapshots.html:batParser.extractDescription');
  assert.equal(row.structured_data.extractor_version, 'extract-bat-core:4.2.5');
  assert.equal(row.structured_data.source_event_time_status, 'unknown');
  assert.equal(row.raw_source_ref, `listing_page_snapshots:${f.snapshot.id}`);
  assert.equal(row.source_identifier, row.raw_source_ref);
  assert.equal(row.source_id, '00000000-0000-4000-8000-000000000003');
  assert.equal(row.extractor_id, undefined);
  assert.equal(row.source_snapshot_id, undefined, 'Sale-only typed snapshot key is not used for prose');
  assert.equal(row.content_hash, preview.body.description_receipt.observation_payload_sha256);
  const replay = await f.call({ dry_run: false });
  assert.equal(replay.status, 200, errorText(f));
  assert.equal(replay.body.writes, 0);
  assert.equal(replay.body.description_receipt.duplicate, true);
  assert.equal(replay.body.description_receipt.observation_id, result.body.description_receipt.observation_id);
  const after = await f.call();
  assert.equal(after.status, 200, errorText(f));
  assert.equal(after.body.description_receipt.duplicate, true);
  assert.equal(after.body.description_receipt.existing_observation_id, row.id);
  assert.equal(f.requests.filter(r => r.method === 'POST' && r.path.startsWith('/rest/') &&
    !r.path.includes('/rpc/')).length, 1, 'Only one native testimony INSERT, via actual canonical owner');
});

test('concurrent exact historical requests share the real non-NULL composite source receipt', async () => {
  const f = canonicalIntake({ core: true });
  const results = await Promise.all([f.call({ dry_run: false }), f.call({ dry_run: false })]);
  assert.ok(results.every(r => r.status === 200), errorText(f));
  assert.equal(f.committed.size, 1);
  assert.equal(new Set(results.map(r => r.body.description_receipt.observation_id)).size, 1);
  assert.deepEqual(results.map(r => r.body.writes).sort(), [0,1]);
  assert.ok(f.requests.filter(r => r.path.endsWith('/vehicle_observations') && r.params.has('source_id'))
    .every(r => r.params.get('source_identifier') === `eq.listing_page_snapshots:${f.snapshot.id}` &&
      r.params.get('kind') === 'eq.listing'), 'Strict lookup uses the actual complete composite owner');
});
test('registered BaT source unavailable cannot advertise a preview or invoke intake', async () => {
  const f = canonicalIntake({core:true,sourceUnavailable:true});
  const result = await f.call();
  assert.equal(result.status, 500);
  assert.match(result.body.error, /Registered BaT source unavailable/);
  assert.equal(f.intakes.length, 0);
});

function userToken(role) {
  const payload = [ { alg: 'HS256', typ: 'JWT' },
    { role, sub: '00000000-0000-4000-8000-000000000005', exp: Math.floor(Date.now()/1000)+3600 } ]
    .map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.');
  return `${payload}.${createHmac('sha256','synthetic-jwt-secret').update(payload).digest('base64url')}`;
}
for (const role of ['authenticated','anon']) test(`${role} caller cannot read protected prose through actual core`, async () => {
  const f = canonicalIntake({ core: true });
  const result = await f.call({}, userToken(role));
  assert.equal(result.status, role === 'authenticated' ? 403 : 401);
  assert.equal(f.requests.length, 0, 'No protected source or private parent lookup before authorization');
});

for (const [name, body] of [ ['raw text override',{text:input.text}], ['batch',{vehicle_ids:[input.vehicleId]}],
  ['continuation',{continuation:true}], ['legacy URL',{url:input.sourceUrl}],
  ['sale-only typed source',{source_snapshot_id:'00000000-0000-4000-8000-000000000004'}],
  ['string dry_run',{dry_run:'false'}], ['invalid vehicle UUID',{vehicle_id:'bad'}],
  ['invalid snapshot UUID',{snapshot_id:'bad'}], ['unknown fingerprint',{expected_capture_sha256:''}] ]) {
  test(`${name} is rejected before protected lookup`, async () => {
    const f = canonicalIntake({ core: true });
    assert.equal((await f.call(body)).status, 400);
    assert.equal(f.requests.length, 0);
  });
}
test('non-POST protected mode is rejected before lookup', async () => {
  const f = canonicalIntake({ core: true });
  assert.equal((await f.call({}, undefined, 'PUT')).status, 400);
  assert.equal(f.requests.length, 0);
});

for (const [name, vehicle] of [ ['private',{is_public:false}], ['deleted',{deleted_at:'2020-01-02T00:00:00Z'}],
  ['non-vehicle',{listing_kind:'non_vehicle_item'}], ['foreign source',{listing_url:'https://other.invalid/listing/fixture'}] ]) {
  test(`${name} parent refuses historical preview and append`, async () => {
    const f = canonicalIntake({ core: true, vehicle });
    assert.equal((await f.call()).status, 500);
    assert.equal((await f.call({ dry_run:false })).status, 500);
    assert.equal(f.requests.filter(r => r.path.includes('listing_page_snapshots')).length, 0);
    assert.deepEqual(writes(f), []);
  });
}

for (const [name, snapshot] of [ ['wrong vehicle',{metadata:{vehicle_id:'other',vehicle_matched:true}}],
  ['unmatched vehicle',{metadata:{vehicle_id:input.vehicleId,vehicle_matched:false}}],
  ['different listing',{listing_url:'https://bringatrailer.com/listing/other'}], ['failed capture',{success:false}],
  ['HTTP error',{http_status:404}], ['receipt only',{html:null}], ['changed bytes',{html:'Changed capture'}],
  ['unqualified capture clock',{fetched_at:'2020-01-01T00:00:00.123456'}],
  ['future capture',{fetched_at:'2099-01-01T00:00:00.123456Z'}],
  ['archive before capture by one microsecond',{created_at:'2020-01-01T00:00:00.123455Z'}],
  ['invalid archive date',{created_at:'2020-02-31T00:00:00Z'}],
  ['future archive',{created_at:'2099-01-01T00:00:00Z'}], ['missing fingerprint',{html_sha256:null}] ]) {
  test(`${name} protected source refuses without fallback or write`, async () => {
    const f = canonicalIntake({ core: true, snapshot });
    const result = await f.call({ expected_capture_sha256:f.snapshot.html_sha256 ?? 'a'.repeat(64), dry_run:false });
    assert.equal(result.status, 500, errorText(f));
    assert.equal(f.intakes.length, 0);
    assert.deepEqual(writes(f), []);
  });
}
test('caller pinned SHA mismatch refuses the otherwise valid protected capture', async () => {
  const f = canonicalIntake({core:true});
  const result = await f.call({expected_capture_sha256:'a'.repeat(64),dry_run:false});
  assert.equal(result.status, 500);
  assert.match(result.body.error, /fingerprint or capture\/archive clocks invalid/);
  assert.equal(f.intakes.length, 0);
});

for (const restricted of [false,true]) test(`newer ${restricted ? 'restricted' : 'missing-text'} observation prevents older fallback`, async () => {
  const f = canonicalIntake({ core:true, restricted, observations:[{ id:'newer-source', vehicle_id:input.vehicleId,
    kind:'listing',subject_type:'vehicle',source_url:input.sourceUrl,is_superseded:false,
    observed_at:'2021-01-01T00:00:00Z',ingested_at:'2021-01-01T00:00:01Z',content_text:'marker',structured_data:{} }] });
  assert.equal((await f.call({dry_run:false})).status, 500);
  assert.equal(f.intakes.length, 0);
});

for (const [name, mutate] of [ ['parent becomes private',(table,n,{vehicle}) => {if(table==='vehicles' && n===2) vehicle.is_public=false;}],
  ['listing relinks',(table,n,{vehicle}) => {if(table==='vehicles' && n===2) vehicle.listing_url='https://bringatrailer.com/listing/other';}],
  ['snapshot relinks',(table,n,{snapshot}) => {if(table==='listing_page_snapshots' && n===2) snapshot.metadata.vehicle_id='other';}],
  ['source clocks change',(table,n,{snapshot}) => {if(table==='listing_page_snapshots' && n===2) snapshot.created_at='2020-01-02T00:00:00Z';}],
  ['parent becomes deleted before canonical invoke',(table,n,{vehicle}) => {if(table==='vehicles' && n===3) vehicle.deleted_at='2020-01-02T00:00:00Z';}] ]) {
  test(`${name} between admission reads refuses before canonical intake`, async () => {
    const f = canonicalIntake({ core:true, onRead:mutate });
    assert.equal((await f.call({dry_run:false})).status, 500, errorText(f));
    assert.equal(f.intakes.length, 0);
  });
}

for (const [name, change] of [ ['superseded',{is_superseded:true}], ['unknown supersession',{is_superseded:null}],
  ['relinked',{vehicle_id:'other'}], ['unknown native ingest clock',{ingested_at:null}],
  ['invalid native ingest clock',{ingested_at:'not-a-date'}], ['future native ingest clock',{ingested_at:'2099-01-01T00:00:00Z'}],
  ['native ingest before capture',{ingested_at:'2019-01-01T00:00:00Z'}],
  ['native ingest before archive',{ingested_at:'2020-01-01T00:00:00.123457Z'}],
  ['changed text',{content_text:'Changed testimony'}], ['changed qualification',{structured_data:{description_capture:true}}] ]) {
  test(`${name} hash winner cannot count as replay`, async () => {
    const f = canonicalIntake({ core:true });
    assert.equal((await f.call({dry_run:false})).status, 200, errorText(f));
    Object.assign([...f.committed.values()][0], change);
    const before = f.intakes.length;
    assert.equal((await f.call({dry_run:false})).status, 500);
    assert.equal(f.intakes.length, before, 'Refusal does not manufacture a replacement or supersession');
  });
}
for (const [name,change] of [ ['foreign registry source',{source_id:'00000000-0000-4000-8000-000000000099'}],
  ['unknown registry source',{source_id:null}], ['changed source identity',{source_identifier:'other-capture'}],
  ['NULL source identity',{source_identifier:null}] ]) {
  test(`${name} generic hash winner fails exact historical receipt verification`, async () => {
    const f = canonicalIntake({core:true});
    assert.equal((await f.call({dry_run:false})).status, 200, errorText(f));
    Object.assign([...f.committed.values()][0], change);
    const result = await f.call({dry_run:false});
    assert.equal(result.status, 500);
    assert.match(result.body.error, /changed or unrelated native receipt/);
    assert.equal(f.requests.filter(r => r.method === 'POST' && r.path === '/rest/v1/vehicle_observations').length, 1);
  });
}
test('canonical returned receipt changes are visible failures after the bounded append', async () => {
  const f = canonicalIntake({core:true,onReceiptRead:row=>{row.vehicle_id='other';}});
  const result = await f.call({dry_run:false});
  assert.equal(result.status, 500);
  assert.match(result.body.error, /changed or unrelated native receipt/);
  assert.equal(f.committed.size, 1, 'Preserve original append; failure does not delete testimony');
});

test('oversized parsed prose refuses intact without clipping or inference', async () => {
  const html = `<div class="post-content"><p>${'x'.repeat(32001)}</p></div>`;
  const f = canonicalIntake({core:true,snapshot:{html,html_sha256:createHash('sha256').update(html).digest('hex')}});
  const result = await f.call({dry_run:false});
  assert.equal(result.status, 500);
  assert.match(result.body.error, /exceeds 32000/);
  assert.equal(f.intakes.length, 0);
});
