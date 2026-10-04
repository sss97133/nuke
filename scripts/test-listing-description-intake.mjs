// Actual description producer helper + installed Supabase SDK; no live requests.
import assert from 'node:assert/strict';
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
