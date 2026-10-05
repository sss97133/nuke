import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { options, anonymousConfiguration, publicClient, inspectPage, runCoverage, lineageSubjects, inspectSpecification, inspectProvenance, runSpecificationLineage, main } from './public-reader-coverage.mjs';

// These are offline detector inputs, never production testimony.
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const env = role => ({ SUPABASE_ANON_KEY: `test.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.test` });
const parent = n => ({ id: id(n), is_public: true, deleted_at: null, listing_kind: null,
  sale_status: 'sold', auction_outcome: 'sold', canonical_outcome: 'sold', canonical_sold_price: 30000,
  year: 1966, make: 'synthetic', model: 'offline', condition_rating: null, body_style: null, engine_type: null, transmission: null, mileage: null });
const fact = n => ({ vehicle_id: id(n), price_kind: 'sold', price_amount: 30000, price_live: false,
  sold_amount: 30000, sold_on: '2024-01-01', sold_basis: 'status', outcome: 'sold', source_url: 'https://example.com/offline-source' });
const scope = extra => ({ scope: 'sold', after: id(0), pageSize: 20, maxPages: 10, until: Date.now() + 60000, ...extra });
function clientFor(pages, responses) {
  let requests = 0, index = 0;
  return { get requests() { return requests; }, async parents(after) { requests++; return { ok: true, status: 200, durationMs: 1, value: pages[index++] ?? [] }; },
    async rpc(name, args) { requests++; return responses?.shift() ?? { ok: true, status: 200, durationMs: 1, value: args.p_vehicle_ids.map(key => fact(Number(key.slice(-12)))) }; } };
}

test('scope uses explicit finite page/time budgets and a resumable UUID cursor', () => {
  const now = Date.now(), args = ['--out', '/private/receipt', '--scope', 'all', '--page-size', '500', '--after', id(7), '--until', new Date(now + 10000).toISOString()];
  assert.equal(options(args, now).after, id(7));
  assert.equal(options(args, now).pageSize, 500);
  for (const bad of [[], ['--out','a','--out','b'], ['--out','a','--scope','raw'], ['--out','a','--page-size','1001'], ['--out','a','--until','bad'], ['--out','a','--after',"x';delete"], ['--out','a','--max-pages','0']]) assert.throws(() => options(bad, now));
});

test('anonymous assay refuses service JWTs, missing anon config and another project', () => {
  assert.equal(anonymousConfiguration(env('anon')).url, 'https://qkgaybvrernstplzjaam.supabase.co');
  for (const bad of [env('service_role'), env('authenticated'), { SUPABASE_SERVICE_ROLE_KEY:'secret' }, { SUPABASE_ANON_KEY:'sb_secret_secret' }, { ...env('anon'), SUPABASE_URL:'https://example.com' }]) assert.throws(() => anonymousConfiguration(bad));
});

test('public transport has exact eligibility, keyed pages and a read-only RPC whitelist', async () => {
  const calls = [], config = anonymousConfiguration(env('anon'));
  const c = publicClient(config, async (url, init) => { calls.push({ url, init }); return new Response('[]', { status: 200 }); });
  await c.parents(id(2), 200, 'sold');
  const u = new URL(calls[0].url);
  assert.equal(u.searchParams.get('id'), `gt.${id(2)}`);
  assert.equal(u.searchParams.get('is_public'),'eq.true');
  assert.equal(u.searchParams.get('deleted_at'),'is.null');
  assert.equal(u.searchParams.get('or'),'(listing_kind.is.null,listing_kind.neq.non_vehicle_item)');
  assert.equal(u.searchParams.get('sale_status'),'eq.sold');
  assert.equal(u.searchParams.get('order'),'id.asc');
  assert.equal(u.searchParams.has('offset'),false);
  assert.equal(calls[0].init.redirect,'error');
  await c.rpc('vehicle_price_facts',{ p_vehicle_ids:[id(2)] });
  assert.equal(calls[1].init.method,'POST');
  assert.throws(() => c.rpc('ingest-observation',{}));
  assert.throws(() => c.rpc('vehicle_price_facts',{p_vehicle_ids:['bad']}));
  assert.equal(c.requests,2);
});

test('error response keeps status/code and withholds raw error text', async () => {
  const c = publicClient(anonymousConfiguration(env('anon')), async () => new Response(JSON.stringify({code:'57014',message:'PRIVATE ERROR AND CREDENTIAL'}),{status:500}));
  const r = await c.parents(id(0),20,'sold');
  assert.equal(r.ok,false);assert.equal(r.status,500);assert.equal(r.code,'57014');
  assert.equal(JSON.stringify(r).includes('PRIVATE'),false);
});

test('unknown condition and current metadata stay separate from sale-time matching', () => {
  const p=parent(1);p.body_style='coupe';p.condition_rating=0;
  const r=inspectPage([p],[fact(1)],{after:id(0)});
  assert.equal(r.inspected,1);assert.equal(r.factRows,1);assert.deepEqual(r.failures,{});
  assert.equal(r.currentMetadata.condition,1);assert.equal(r.currentMetadata.body,1);
  assert.equal(r.currentMetadata.engine,0);
  assert.equal(Object.hasOwn(r,'conditionAdjustedPrice'),false);
});

test('private/deleted/nonvehicle or repeated/out-of-order parents fail before child reads', async () => {
  for (const bad of [{...parent(1),is_public:false},{...parent(1),deleted_at:'2024-01-01'},{...parent(1),listing_kind:'non_vehicle_item'}]) {
    const c=clientFor([[bad]]);const r=await runCoverage(c,scope());
    assert.equal(c.requests,1);assert.equal(r.stopReason,'parent_scope_or_cursor_invalid');assert.equal(r.status,'failed');
  }
  assert.equal(inspectPage([parent(2),parent(1)],[]).safe,false);
  assert.equal(inspectPage([parent(1),parent(1)],[]).safe,false);
});

test('foreign and duplicate child rows are detected without retaining foreign IDs', () => {
  const r=inspectPage([parent(1)],[fact(1),fact(1),fact(2)]);
  assert.equal(r.failures.duplicate_fold_row,1);assert.equal(r.failures.fold_returned_unrequested_parent,1);
  assert.equal(r.safe,false);assert.equal(JSON.stringify(r).includes(id(2)),false);
});

test('an explicit no-sale cannot be promoted, and invalid date/amount do not pass', () => {
  const r=inspectPage([{...parent(1),auction_outcome:'no_sale'}],[{...fact(1),sold_amount:-20,sold_on:'2024-02-30'}]);
  assert.equal(r.failures.explicit_no_sale_promoted,1);assert.equal(r.failures.sold_amount_not_positive,1);assert.equal(r.failures.sold_date_invalid,1);
  assert.equal(r.diagnostics.stored_sale_outcome_conflict,1);
});

test('known sold status with unknown date/amount is reported as missing evidence', () => {
  const r=inspectPage([parent(1)],[{...fact(1),price_amount:null,sold_amount:null,sold_on:null,source_url:null}]);
  assert.deepEqual(r.failures,{});assert.equal(r.gaps.sold_amount_unknown,1);assert.equal(r.gaps.sold_date_unknown,1);assert.equal(r.gaps.sold_source_unknown,1);
});

test('canonical asks and bids are not reported as inconsistent sale amounts', () => {
  for (const context of ['for_sale','active','reserve_not_met','unknown',null]) {
    const r=inspectPage([{...parent(1),sale_status:'available',auction_outcome:null,canonical_outcome:context}],
      [{...fact(1),price_kind:'ask',sold_amount:null,sold_on:null,sold_basis:null,outcome:context}],{scope:'all'});
    assert.deepEqual(r.diagnostics,{});
    assert.equal(r.denominators.canonicalSold,0);
  }
  const r=inspectPage([parent(1)],[{...fact(1),sold_amount:29000,price_amount:29000}]);
  assert.equal(r.diagnostics.canonical_amount_differs_from_sale_fold,1);
  assert.deepEqual(r.denominators,{supportedSaleBasis:1,soldAmount:1,datedSoldAmount:1,canonicalSold:1});
});

test('a discovery locator is a reconciliation candidate, not verified sale attribution', () => {
  const r=inspectPage([{...parent(1),discovery_url:'https://example.com/other-episode',canonical_outcome:'unknown'}],
    [{...fact(1),source_url:null}]);
  assert.equal(r.gaps.sold_source_unknown,1);
  assert.equal(r.diagnostics.sale_fold_source_missing_with_discovery_locator,1);
  assert.equal(r.diagnostics.supported_sale_basis_without_canonical_sold_context,1);
  assert.equal(r.diagnostics.canonical_amount_differs_from_sale_fold,undefined);
});

test('short server-capped pages continue until an empty keyed page', async () => {
  const c=clientFor([[parent(1)],[parent(2)],[]]),events=[];
  const r=await runCoverage(c,scope(),{emit:x=>events.push(x)});
  assert.equal(r.inspectedRecords,2);assert.equal(r.measuredFoldRecords,2);assert.equal(c.requests,5);
  assert.equal(r.stopReason,'current_scope_exhausted');assert.equal(r.status,'passed_operating_invariants_in_current_scope');
  assert.equal(r.sourceQualification,'unmeasured');assert.equal(r.saleTimeFeatureMatching,'unmeasured');
  assert.equal(r.recordRepairs,0);assert.equal(events.at(-1).type,'summary');
});

test('request failure never becomes zero source coverage and two failures stop for diagnosis', async () => {
  const responses=[{ok:false,status:500,code:'57014'},{ok:false,status:500,code:'57014'}];
  const r=await runCoverage(clientFor([[parent(1)],[parent(2)],[parent(3)]],responses),scope());
  assert.equal(r.inspectedRecords,2);assert.equal(r.measuredFoldRecords,0);assert.equal(r.gaps.fold_records_unmeasured,2);
  assert.equal(r.stopReason,'two_consecutive_fold_failures_inspect_cause_before_resuming');
  assert.equal(r.lastFetchedId,id(2));assert.equal(r.lastFullyMeasuredId,id(0));assert.equal(r.exitCode,1);
});

test('invalid fold shape retains inspected parent coverage and marks fold unmeasured', async () => {
  const r=await runCoverage(clientFor([[parent(1)]],[{ok:true,status:200,value:{unexpected:1}}]),scope());
  assert.equal(r.inspectedRecords,1);assert.equal(r.measuredFoldRecords,0);assert.equal(r.gaps.fold_records_unmeasured,1);assert.equal(r.exitCode,1);
});

test('page and clock caps are incomplete rather than success or corpus exhaustion', async () => {
  const r=await runCoverage(clientFor([[parent(1)],[parent(2)]]),scope({maxPages:1}));
  assert.equal(r.exitCode,2);assert.equal(r.stopReason,'page_budget_reached');
  const q=await runCoverage(clientFor([[parent(1)]]),scope({until:10}),{now:()=>20});
  assert.equal(q.exitCode,2);assert.equal(q.inspectedRecords,0);
  const empty=await runCoverage(clientFor([[]]),scope());assert.equal(empty.exitCode,2);
});

test('private append-only receipt records page evidence, omits raw amounts and secrets', async t => {
  const dir=await mkdtemp(path.join(tmpdir(),'nuke-reader-assay-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const out=path.join(dir,'receipt.jsonl'),printed=[];
  assert.equal(await main(['--out',out],{env:env('anon'),client:clientFor([[parent(1)],[]]),print:x=>printed.push(x)}),0);
  const text=await readFile(out,'utf8'),rows=text.trim().split('\n').map(x=>JSON.parse(x));
  assert.equal(rows[0].anonymous,true);assert.equal(rows[1].result.inspected,1);assert.match(rows[1].inputSha256,/^[a-f0-9]{64}$/);
  assert.equal(rows[0].schemaVersion,'public_reader_coverage_v2');assert.match(rows[0].assaySourceSha256,/^[a-f0-9]{64}$/);
  assert.equal(rows.at(-1).type,'summary');assert.equal(text.includes('30000'),false);assert.equal(text.includes(env('anon').SUPABASE_ANON_KEY),false);
  assert.equal((await stat(out)).mode&0o777,0o600);
  assert.equal(printed.join('').includes('offline-source'),false);
  assert.equal(await main(['--out',out],{env:env('anon'),client:clientFor([]),print:()=>{}}),1);
  await writeFile(path.join(dir,'original'),'original');await symlink(path.join(dir,'original'),path.join(dir,'link'));
  assert.equal(await main(['--out',path.join(dir,'link')],{env:env('anon'),client:clientFor([]),print:()=>{}}),1);
  assert.equal(await readFile(path.join(dir,'original'),'utf8'),'original');
});

const manifest = ids => ({ schemaVersion: 'public_reader_lineage_subjects_v1', population: { key: 'offline-selected-reports', basis: 'Synthetic offline regression manifest, not representative production coverage.', complete: false }, vehicleIds: ids });
const spec = extra => ({ field: 'transmission', value: null, reported_value: 'SYNTHETIC PRIVATE CLAIM', source_observation_id: id(100),
  reported_observed_at: '2026-01-01T00:00:00.123456Z', reported_ingested_at: '2026-01-02T00:00:00Z', as_of_at: '2026-01-03T00:00:00Z',
  reported_method: 'synthetic-offline', reported_confidence: 0, reported_source: 'synthetic-offline', reported_conflict: false, ...extra });
const provenance = (n, s = spec()) => ({ vehicle_id: id(n), field: s.field, observations: [{ id: s.source_observation_id, value: s.reported_value,
  observed_at: s.reported_observed_at, ingested_at: s.reported_ingested_at, extraction_method: s.reported_method, confidence: s.reported_confidence, source_slug: s.reported_source,
  content: 'SYNTHETIC PRIVATE SOURCE BODY' }] });
function lineageClient({ parents = [parent(1)], specs = [spec()], drills } = {}) {
  const calls = [];
  return { calls, get requests() { return calls.length; }, async subjects(ids) { calls.push({ reader: 'vehicles', ids }); return { ok: true, status: 200, value: parents }; },
    async rpc(reader, args) { calls.push({ reader, args });
      return drills?.shift() ?? { ok: true, status: 200, value: reader === 'get_vehicle_specs' ? specs : provenance(Number(args.p_vehicle_id.slice(-12)), specs.find(s => s.field === args.p_field)) }; } };
}

test('lineage requires an explicit unique bounded manifest and cannot disguise price scope', () => {
  assert.deepEqual(lineageSubjects(manifest([id(2), id(1)])).ids, [id(1), id(2)]);
  for (const input of [manifest([]), manifest([id(1), id(1).toUpperCase()]), manifest(['not-a-uuid']), { ...manifest([id(1)]), schemaVersion: 'other' }, manifest(Array(10001).fill(id(1)))]) assert.throws(() => lineageSubjects(input));
  const args = ['--out', '/private/output', '--family', 'specifications', '--subjects', '/private/manifest'];
  assert.equal(options(args).scope, 'explicit_manifest');
  for (const extra of [['--scope','all'],['--after',id(1)],['--page-size','20']]) assert.throws(() => options([...args,...extra]));
  assert.throws(() => options(['--out','/private/output','--family','specifications']));
  assert.throws(() => options(['--out','/private/output','--subjects','/private/manifest']));
});

test('explicit subjects use the public parent gate and core-field-only RPC contracts', async () => {
  const calls = [], c = publicClient(anonymousConfiguration(env('anon')), async (url, init) => { calls.push({url,init}); return new Response('[]'); });
  await c.subjects([id(1),id(2)]);
  const u = new URL(calls[0].url);
  assert.equal(u.searchParams.get('id'), `in.(${id(1)},${id(2)})`); assert.equal(u.searchParams.get('deleted_at'),'is.null');
  assert.equal(u.searchParams.get('is_public'),'eq.true'); assert.equal(u.searchParams.get('limit'),'2');
  assert.throws(() => c.subjects(Array(201).fill(id(1))));
  assert.throws(() => c.rpc('get_vehicle_specs',{p_vehicle_id:'bad'}));
  assert.throws(() => c.rpc('get_field_provenance',{p_vehicle_id:id(1),p_field:'unreviewed_other_field'}));
  assert.throws(() => c.rpc('popup_vehicle_intel',{}));
});

test('chunked provenance bytes are refused during consumption, without raw body or zero evidence', async () => {
  let cancelled = false, sent = 0;
  const stream = new ReadableStream({ pull(controller) { sent++; controller.enqueue(new Uint8Array(1200000)); }, cancel() { cancelled = true; } }, { highWaterMark: 0 });
  const c = publicClient(anonymousConfiguration(env('anon')), async () => new Response(stream));
  const result = await c.rpc('get_field_provenance',{p_vehicle_id:id(1),p_field:'transmission'});
  assert.equal(result.ok,false); assert.equal(result.code,'response_byte_limit'); assert.equal(result.value,undefined);
  assert.equal(cancelled,true); assert.equal(sent,2); assert.equal(result.status,200);
});

test('microsecond fold boundaries and zero confidence retain their actual meanings', () => {
  const r = inspectSpecification([spec({ reported_observed_at: '2026-01-03T00:00:00.000001Z' })]);
  assert.equal(r.failures.selected_report_after_fold_cutoff,1); assert.equal(r.gaps.selected_report_confidence_unknown,undefined);
  const offset = inspectSpecification([spec({ reported_observed_at: '2026-01-02T16:00:00-08:00' })]);
  assert.deepEqual(offset.failures,{}); assert.equal(offset.canonicalUnknownWithReport,1); assert.equal(offset.gaps.selected_report_sale_episode_binding_unmeasured,1);
});

test('rooted canonical evidence can coexist with a conflicting selected report', () => {
  const r = inspectSpecification([spec({ value:'OTHER CANONICAL VALUE', reported_value:null, reported_conflict:true, rooted:true }),
    { field:'mileage', value:'123', rooted:false, source_observation_id:null }, { field:'description',value:'SYNTHETIC PRIVATE PROSE' }]);
  assert.equal(r.conflicts,1); assert.equal(r.canonicalWithoutSelectedReport,1); assert.equal(r.unrecognizedFields,1); assert.deepEqual(r.failures,{});
  assert.equal(r.reports[0].reported_conflict,true); assert.equal(inspectSpecification([spec({source_observation_id:null})]).failures.reported_value_without_source_observation,1);
  assert.equal(inspectSpecification([spec(),spec()]).safe,false);
});

test('selected observation identity, value and all known lineage attributes must reach the drill', () => {
  const s = spec(), p = provenance(1,s);
  assert.equal(inspectProvenance(id(1),s,p).lineageMatches,true);
  for (const [field,value,issue] of [['confidence',0.5,'confidence'],['source_slug','foreign-source','source_slug'],['extraction_method','other','method'],['observed_at','2026-02-01Z','event_clock'],['ingested_at','2026-02-01Z','ingest_clock'],['value','OTHER CLAIM','reported_value']]) {
    const bad = structuredClone(p); bad.observations[0][field]=value;
    assert.equal(inspectProvenance(id(1),s,bad).failures[`selected_observation_${issue}_mismatch`],1);
  }
  assert.equal(inspectProvenance(id(2),s,p).failures.provenance_shape_or_subject_invalid,1);
  assert.equal(inspectProvenance(id(1),s,{...p,observations:[]}).failures.selected_observation_missing_from_current_drill,1);
  assert.equal(inspectProvenance(id(1),s,{...p,observations:[...p.observations,...p.observations]}).failures.selected_observation_duplicated_in_drill,1);
});

test('denied subjects never trigger child reads, and raw testimony is omitted from lineage receipts', async () => {
  const c = lineageClient(), events = [];
  const r = await runSpecificationLineage(c,scope(),lineageSubjects(manifest([id(1),id(2),id(3)])),{emit:x=>events.push(x)});
  assert.equal(r.requestedParents,3); assert.equal(r.eligibleParents,1); assert.equal(r.absentOrIneligibleParents,2);
  assert.equal(r.completedParents,1); assert.equal(r.matchingReports,1); assert.equal(r.status,'passed_selected_current_lineage_in_manifest');
  assert.equal(c.calls.filter(x=>x.reader!=='vehicles').length,2); assert.equal(r.conditionAtSale,'unmeasured');
  const text=JSON.stringify(events); for(const privateValue of ['PRIVATE CLAIM','PRIVATE SOURCE BODY',id(2),id(3)]) assert.equal(text.includes(privateValue),false);
  assert.equal(r.databaseWrites,0); assert.equal(r.modelCalls,0); assert.equal(r.recordRepairs,0);
});

test('a malformed or foreign gate fails before source readers and does not retain foreign IDs', async () => {
  const c=lineageClient({parents:[parent(99)]}),events=[];
  const r=await runSpecificationLineage(c,scope(),lineageSubjects(manifest([id(1)])),{emit:x=>events.push(x)});
  assert.equal(r.failures.lineage_parent_gate_invalid,1); assert.equal(c.requests,1); assert.equal(JSON.stringify(events).includes(id(99)),false);
});

test('two failed specification reads stop for diagnosis and remain unmeasured', async () => {
  const c=lineageClient({parents:[parent(1),parent(2),parent(3)],drills:[{ok:false,status:500,code:'57014'},{ok:false,status:500,code:'57014'}]});
  const r=await runSpecificationLineage(c,scope(),lineageSubjects(manifest([id(1),id(2),id(3)])));
  assert.equal(r.inspectedParents,2); assert.equal(r.completedParents,0); assert.equal(r.gaps.specification_parents_unmeasured,2);
  assert.equal(r.stopReason,'two_consecutive_lineage_reader_failures_inspect_cause'); assert.equal(r.status,'failed'); assert.equal(c.requests,3);
});

test('provenance refusal and a time cap do not become successful lineage coverage', async () => {
  const c=lineageClient({specs:[spec(),spec({field:'engine_type'})],drills:[{ok:true,status:200,value:[spec(),spec({field:'engine_type'})]},{ok:false,status:200,code:'response_byte_limit'},{ok:false,status:500,code:'57014'}]});
  const r=await runSpecificationLineage(c,scope(),lineageSubjects(manifest([id(1)])));
  assert.equal(r.selectedReports,2); assert.equal(r.drilledReports,0); assert.equal(r.gaps.selected_report_drill_unmeasured,2); assert.equal(r.status,'failed');
  let clock=0;const timed=lineageClient();const rpc=timed.rpc;timed.rpc=async(...args)=>{const value=await rpc(...args);clock=10;return value;};
  const ended=await runSpecificationLineage(timed,scope({until:5}),lineageSubjects(manifest([id(1)])),{now:()=>clock});
  assert.equal(ended.completedParents,0); assert.equal(ended.stopReason,'time_budget_reached'); assert.equal(ended.status,'incomplete'); assert.equal(timed.requests,2);
});

test('lineage CLI keeps a private immutable manifest/assay receipt and a distinct reader family', async t => {
  const dir=await mkdtemp(path.join(tmpdir(),'nuke-lineage-assay-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const input=path.join(dir,'manifest.json'),out=path.join(dir,'receipt.jsonl');await writeFile(input,JSON.stringify(manifest([id(1)])));
  assert.equal(await main(['--out',out,'--family','specifications','--subjects',input],{env:env('anon'),client:lineageClient(),print:()=>{}}),0);
  const body=await readFile(out,'utf8'),rows=body.trim().split('\n').map(JSON.parse);
  assert.deepEqual(rows[0].readers,['vehicles','get_vehicle_specs','get_field_provenance']); assert.equal(rows[0].options.scope,'explicit_manifest');
  assert.match(rows.at(-1).manifestSha256,/^[a-f0-9]{64}$/); assert.match(rows[0].assaySourceSha256,/^[a-f0-9]{64}$/);
  assert.equal(body.includes('PRIVATE CLAIM'),false); assert.equal(body.includes('PRIVATE SOURCE BODY'),false); assert.equal((await stat(out)).mode&0o777,0o600);
  assert.equal(await main(['--out',out,'--family','specifications','--subjects',input],{env:env('anon'),client:lineageClient(),print:()=>{}}),1);
});
