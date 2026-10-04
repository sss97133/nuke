// Actual description producer helper + installed Supabase SDK; no live requests.
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
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
runInNewContext(hashSource,{exports:hashModule.exports,module:hashModule,Date,BigInt});
runInNewContext(source, { exports: module.exports, module, Date, BigInt, require: path=>{
 assert.equal(path,'../_shared/observationContentHash.ts');return hashModule.exports; } });
const { recordListingDescription } = module.exports;
const input = { vehicleId: '00000000-0000-4000-8000-000000000001', sourceUrl: 'https://bringatrailer.com/listing/fixture',
  extractorVersion: 'extract-bat-core:4.2.4',
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
  let handler;
  const env = { SUPABASE_URL: 'https://fixture.invalid', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service' };
  async function network(request, init = {}) {
    const url = new URL(typeof request === 'string' ? request : request.url ?? request.href);
    const method = init.method ?? request.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    requests.push({ path: url.pathname, method, body });
    if (url.pathname === '/functions/v1/ingest-observation') {
      const admitted = options.legacyExtractorSlug ? { ...body, extractor_id: 'extract-bat-core' } : body;
      intakes.push(admitted);
      return handler(new Request(url, { ...init, body: JSON.stringify(admitted) }));
    }
    if (url.pathname === '/rest/v1/observation_sources') return Response.json([{
      id: '00000000-0000-4000-8000-000000000003', base_trust_score: .85, supported_observations: ['listing'],
    }]);
    if (url.pathname === '/rest/v1/vehicle_observations') {
      if (method === 'GET') {
        const existing = committed.get(url.searchParams.get('content_hash')?.replace(/^eq\./, ''));
        return Response.json(existing ? [existing] : []);
      }
      if (method === 'POST') {
        if (body.extractor_id != null && !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(body.extractor_id)) {
          return Response.json({ code: '22P02', message: `invalid input syntax for type uuid: "${body.extractor_id}"` }, { status: 400 });
        }
        const receipt = { id: '00000000-0000-4000-8000-000000000002' };
        committed.set(body.content_hash, receipt);
        return Response.json([receipt], { status: 201 });
      }
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
      TextEncoder, TextDecoder, Uint8Array, crypto: webcrypto, fetch: network, atob, btoa, setTimeout, clearTimeout,
      console: { log() {}, warn() {}, error: (...args) => errors.push(args) },
      Deno: { env: { get: key => env[key] }, serve: callback => { handler = callback; } },
      require: name => {
        if (['https://esm.sh/@supabase/supabase-js@2', 'https://esm.sh/@supabase/supabase-js@2.45.4'].includes(name)) return { createClient: client };
        assert.ok(name.startsWith('.'), `No downloaded import: ${name}`);
        return load(new URL(name, filename));
      },
    });
    return module.exports;
  }
  load(new URL('../supabase/functions/ingest-observation/index.ts', import.meta.url));
  assert.equal(typeof handler, 'function');
  return { client: client(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }),
    requests, intakes, errors };
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
