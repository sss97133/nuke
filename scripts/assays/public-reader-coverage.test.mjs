import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { options, anonymousConfiguration, publicClient, inspectPage, runCoverage, lineageSubjects, inspectSpecification, inspectProvenance, runSpecificationLineage, inspectCommentHeaders, inspectCommentLineage, runCommentLineage, inspectBidHeaders, inspectBidLineage, runBidLineage, main } from './public-reader-coverage.mjs';

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

const comment = (n, extra = {}) => ({ id: id(100 + n), vehicle_id: id(1), auction_event_id: id(10),
  posted_at: '2026-10-01T10:00:00.123456+00:00', platform: 'bat', external_identity_id: id(20),
  author_external_identity_id: null, comment_type: 'comment', is_seller: false, ...extra });
function commentClient(extra = {}) {
  const calls = [], ok = value => ({ ok: true, status: 200, durationMs: 1, value });
  return { calls, get requests() { return calls.length; },
    async subjects(ids) { calls.push({ reader: 'vehicles', ids }); return ok(extra.parents ?? [parent(1)]); },
    async commentHeaders(vehicleId, cursor) {
      calls.push({ reader: 'auction_comments', vehicleId, cursor });
      const rows = [...(extra.headers ?? [comment(1)])].sort((a,b)=>b.id.localeCompare(a.id));
      return extra.headerResponse ?? ok(rows.filter(c=>!cursor || c.id < cursor.id).slice(0,extra.serverPageSize ?? 200));
    },
    async sourceAuctions(vehicleId, ids) { calls.push({ reader: 'auction_events', vehicleId, ids }); return extra.auctionResponse ?? ok(extra.auctions ?? [{ id: id(10), vehicle_id: vehicleId, source: 'bat' }]); },
    async sourceIdentities(ids) { calls.push({ reader: 'external_identities', ids }); return extra.identityResponse ?? ok(extra.identities ?? [{ id: id(20), platform: 'bat' }]); },
  };
}

test('comment family requires an explicit manifest and rejects a price cursor', () => {
  const defaults=options(['--out','private','--family','comments','--subjects','manifest']);
  assert.equal(defaults.scope,'explicit_manifest');assert.equal(defaults.commentLimit,1000);
  for (const extra of [[], ['--subjects','manifest','--scope','all'], ['--subjects','manifest','--after',id(1)], ['--subjects','manifest','--page-size','20']])
    assert.throws(() => options(['--out','private','--family','comments',...extra]));
});

test('comment collection ceiling is explicit, finite and isolated from other reader families', () => {
  const args=['--out','private','--family','comments','--subjects','manifest','--comment-limit'];
  assert.equal(options([...args,'10000']).commentLimit,10000);
  for (const bad of ['0','999','10001','1.5','Infinity','no-limit']) assert.throws(()=>options([...args,bad]));
  assert.throws(()=>options(['--out','private','--comment-limit','10000']));
  assert.throws(()=>options(['--out','private','--family','specifications','--subjects','manifest','--comment-limit','10000']));
});

test('comment transport selects only bounded non-bid headers and parent-scoped source metadata', async () => {
  const routes = [], c = publicClient(anonymousConfiguration(env('anon')), async (url, init) => {
    routes.push([new URL(url),init]); return new Response('[]',{status:200});
  });
  await c.commentHeaders(id(1)); await c.sourceAuctions(id(1),[id(10)]); await c.sourceIdentities([id(20)]);
  assert.equal(routes[0][0].searchParams.get('vehicle_id'),`eq.${id(1)}`);
  assert.equal(routes[0][0].searchParams.get('bid_amount'),'is.null'); assert.equal(routes[0][0].searchParams.get('limit'),'200');
  assert.equal(routes[0][0].searchParams.get('order'),'posted_at.desc,id.desc');
  assert.equal(routes[1][0].searchParams.get('vehicle_id'),`eq.${id(1)}`);
  assert.equal(routes[2][0].searchParams.get('select'),'id,platform');
  for (const [url, init] of routes) {
    assert.equal(init.method,undefined);
    for (const unsafe of ['comment_text','author_username','handle','metadata','raw_data','*']) assert.equal(url.searchParams.get('select').includes(unsafe),false);
  }
  assert.throws(()=>c.sourceAuctions(undefined,[id(10)])); assert.throws(()=>c.sourceIdentities([id(20),id(20)]));
  assert.throws(()=>c.sourceIdentities(Array.from({length:201},(_,i)=>id(i)))); assert.throws(()=>c.commentHeaders('private;drop'));
  await c.commentHeaders(id(1),{id:id(101),postedAt:'2026-10-01T10:00:00.123456+00:00'});
  assert.equal(routes[3][0].searchParams.get('and'),`(or(comment_type.is.null,comment_type.neq.bid),or(posted_at.lt."2026-10-01T10:00:00.123456+00:00",and(posted_at.eq."2026-10-01T10:00:00.123456+00:00",id.lt.${id(101)})))`);
  assert.throws(()=>c.commentHeaders(id(1),{id:id(101),postedAt:'2026-10-01),or(id.neq.null)'}));
});

test('comment header scope checks precede cap refusal and prevent unsafe child reads', () => {
  assert.equal(inspectCommentHeaders(id(1),[comment(1)]).safe,true);
  for (const rows of [[comment(1),comment(1)],[comment(1,{vehicle_id:id(2)})],[comment(1,{comment_type:'bid'})],
    [comment(1,{external_identity_id:'a handle'})],[comment(1,{author_external_identity_id:undefined})],[comment(1,{is_seller:'true'})]])
    assert.equal(inspectCommentHeaders(id(1),rows).safe,false);
  const capped=Array.from({length:1001},(_,i)=>comment(i));
  const result=inspectCommentHeaders(id(1),capped);assert.equal(result.safe,true);assert.equal(result.complete,false);
  assert.equal(result.gaps.comment_header_cap_unmeasured,1);assert.deepEqual(result.headers,[]);assert.deepEqual(result.identityIds,[]);
  capped[1000]=comment(1000,{vehicle_id:id(99)});assert.equal(inspectCommentHeaders(id(1),capped).safe,false);
});

test('author keys preserve absence, one-column projection gaps and conflicts without choosing a winner', () => {
  const rows=[comment(1),comment(2,{external_identity_id:null}),comment(3,{external_identity_id:null,author_external_identity_id:id(20)}),
    comment(4,{author_external_identity_id:id(20)}),comment(5,{author_external_identity_id:id(21)})];
  const result=inspectCommentLineage(rows,[{id:id(10),vehicle_id:id(1),source:'bat'}],[{id:id(20),platform:'bat'},{id:id(21),platform:'cars-and-bids'}]);
  assert.deepEqual(result.identityStates,{absent:1,legacyOnly:1,canonicalOnly:1,agreeing:1,conflicting:1});
  assert.equal(result.gaps.indexed_author_key_absent_with_legacy_identity,1);assert.equal(result.gaps.retained_author_identity_keys_differ,1);
  assert.equal(result.gaps.recorded_identity_namespace_differs_unassayed_alias,1);assert.equal(result.matchingRecordedNamespaces,4);
  assert.equal(result.matchedAuctionParents,5);assert.equal(result.gaps.comment_author_identity_unestablished,1);
});

test('source namespace aliases, missing public context and uninterpretable clocks remain unknown', () => {
  const result=inspectCommentLineage([comment(1,{posted_at:'infinity'}),comment(2,{auction_event_id:null,external_identity_id:id(22)})],
    [{id:id(10),vehicle_id:id(1),source:'bringatrailer'}],[{id:id(20),platform:'bringatrailer'}]);
  assert.equal(result.gaps.source_post_clock_not_interpretable,1);assert.equal(result.gaps.recorded_auction_source_label_differs_unassayed_alias,1);
  assert.equal(result.gaps.recorded_identity_namespace_differs_unassayed_alias,1);assert.equal(result.gaps.reported_identity_context_unavailable,1);
  assert.equal(result.gaps.source_auction_parent_unavailable_or_unlinked,1);assert.equal(result.matchingRecordedNamespaces,0);
});

test('comment lineage denies private subjects before children and omits raw testimony and handles', async () => {
  const c=commentClient({headers:[comment(1,{comment_text:'PRIVATE QUOTE',author_username:'PRIVATE HANDLE'})]}),events=[];
  const r=await runCommentLineage(c,scope(),lineageSubjects(manifest([id(1),id(2)])),{emit:x=>events.push(x)});
  assert.equal(r.gatedParents,2);assert.equal(r.absentOrIneligibleParents,1);assert.equal(r.completedParents,1);
  assert.equal(r.measuredCommentHeaders,1);assert.equal(r.identityStates.legacyOnly,1);assert.equal(r.matchingRecordedNamespaces,1);
  assert.equal(c.calls.filter(x=>x.reader!=='vehicles').length,4);assert.equal(r.status,'passed_current_comment_header_lineage_in_manifest');
  for (const text of ['PRIVATE QUOTE','PRIVATE HANDLE',id(2)]) assert.equal(JSON.stringify(events).includes(text),false);
  assert.equal(r.databaseWrites,0);assert.equal(r.recordRepairs,0);assert.equal(r.modelCalls,0);
});

test('foreign and duplicated child contexts fail without retaining their IDs', async () => {
  for (const extra of [{auctions:[{id:id(10),vehicle_id:id(99),source:'bat'}]},
    {identities:[{id:id(99),platform:'bat'}]}, {identities:[{id:id(20),platform:'bat'},{id:id(20),platform:'bat'}]}]) {
    const c=commentClient(extra),events=[];
    const r=await runCommentLineage(c,scope(),lineageSubjects(manifest([id(1)])),{emit:x=>events.push(x)});
    assert.equal(r.failures.comment_context_scope_or_shape_invalid,1);assert.equal(r.completedParents,0);
    assert.equal(JSON.stringify(events).includes(id(99)),false);assert.equal(r.status,'failed');
  }
});

test('native header overflow refuses totals and skips source context, rather than inspecting a sample', async () => {
  const c=commentClient({headers:Array.from({length:1001},(_,i)=>comment(i))}),events=[];
  const r=await runCommentLineage(c,scope(),lineageSubjects(manifest([id(1)])),{emit:x=>events.push(x)});
  assert.equal(c.requests,7);assert.equal(r.completedParents,0);assert.equal(r.measuredCommentHeaders,0);assert.equal(r.exitCode,2);
  assert.equal(r.gaps.comment_header_cap_unmeasured,1);assert.equal(events.find(x=>x.type==='comment_parent_unmeasured').atLeast,1001);
  assert.equal(c.calls.some(x=>x.reader==='auction_events'||x.reader==='external_identities'),false);
});

test('explicit larger ceiling completes a high-volume collection only after an empty keyed page', async () => {
  const headers=Array.from({length:1001},(_,i)=>comment(i));
  const checked=inspectCommentHeaders(id(1),headers,10000);
  assert.equal(checked.complete,true);assert.equal(checked.headers.length,1001);
  assert.equal(inspectCommentHeaders(id(1),headers,Infinity).safe,false);
  const c=commentClient({headers}),events=[];
  const r=await runCommentLineage(c,scope({commentLimit:10000}),lineageSubjects(manifest([id(1)])),{emit:x=>events.push(x)});
  assert.equal(r.commentLimit,10000);assert.equal(r.measuredCommentHeaders,1001);assert.equal(r.completedParents,1);
  assert.equal(r.identityStates.legacyOnly,1001);assert.equal(r.exitCode,0);assert.deepEqual(r.failures,{});
  assert.equal(events.filter(x=>x.type==='comment_source_page').at(-1).returned,0);
  assert.equal(c.calls.filter(x=>x.reader==='auction_comments').length,7);
  assert.match(r.boundary,/10000/);assert.match(r.boundary,/resource ceiling/);
});

test('two similar comment-reader failures stop even when successful gate or header reads intervene', async () => {
  const c=commentClient({parents:[parent(1),parent(2),parent(3)],identityResponse:{ok:false,status:403,code:'42501'}});
  c.commentHeaders=async (vehicleId,cursor)=>{c.calls.push({reader:'auction_comments',vehicleId});return {ok:true,value:cursor?[]:[comment(1,{vehicle_id:vehicleId})]};};
  const r=await runCommentLineage(c,scope(),lineageSubjects(manifest([id(1),id(2),id(3)])));
  assert.equal(r.inspectedParents,2);assert.equal(r.completedParents,0);assert.equal(r.gaps.comment_context_parent_unmeasured,2);
  assert.equal(r.stopReason,'repeated_comment_reader_failure_inspect_cause');assert.equal(r.measuredCommentHeaders,0);assert.equal(r.status,'failed');
});

test('empty native comments are a measured empty header collection, not zero mood or missing model work', async () => {
  const c=commentClient({headers:[]}),r=await runCommentLineage(c,scope(),lineageSubjects(manifest([id(1)])));
  assert.equal(r.completedParents,1);assert.equal(c.requests,2);assert.equal(r.measuredCommentHeaders,0);assert.deepEqual(r.gaps,{});
  for (const absent of ['mood','processedComments','independentSources','verifiedPeople']) assert.equal(absent in r,false);
});

test('comment CLI records its distinct readonly family and private source hash', async t => {
  const dir=await mkdtemp(path.join(tmpdir(),'nuke-comment-assay-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const input=path.join(dir,'manifest.json'),out=path.join(dir,'receipt.jsonl');await writeFile(input,JSON.stringify(manifest([id(1)])));
  assert.equal(await main(['--out',out,'--family','comments','--subjects',input],{env:env('anon'),client:commentClient(),print:()=>{}}),0);
  const rows=(await readFile(out,'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(rows[0].readers,['vehicles','auction_comments','auction_events','external_identities']);assert.equal(rows.at(-1).identityStates.legacyOnly,1);
  assert.match(rows[0].assaySourceSha256,/^[a-f0-9]{64}$/);assert.equal((await stat(out)).mode&0o777,0o600);
});

test('short comment pages seek until empty and count every header once', async () => {
  const c=commentClient({headers:[comment(1),comment(2),comment(3)],serverPageSize:1});
  const r=await runCommentLineage(c,scope(),lineageSubjects(manifest([id(1)])));
  assert.equal(r.measuredCommentHeaders,3);assert.equal(r.completedParents,1);
  assert.deepEqual(c.calls.filter(x=>x.reader==='auction_comments').map(x=>x.cursor?.id),[undefined,id(103),id(102),id(101)]);
  assert.equal(r.stopReason,'manifest_exhausted');assert.equal(r.exitCode,0);
});

test('comment seek retains PostgreSQL microseconds, timezone equivalence and UUID tie order', async () => {
  const c=commentClient(),pages=[
    [comment(3,{posted_at:'2026-10-01T10:00:00.123456+00:00'})],
    [comment(2,{posted_at:'2026-10-01T03:00:00.123456-07:00'})],
    [comment(4,{posted_at:'2026-10-01T10:00:00.123455+00:00'})],[],
  ];
  c.commentHeaders=async (vehicleId,cursor)=>{c.calls.push({reader:'auction_comments',vehicleId,cursor});return {ok:true,value:pages.shift()};};
  const r=await runCommentLineage(c,scope(),lineageSubjects(manifest([id(1)])));
  assert.equal(r.measuredCommentHeaders,3);assert.deepEqual(r.failures,{});
  assert.equal(c.calls[2].cursor.postedAt,'2026-10-01T10:00:00.123456+00:00');
  assert.equal(c.calls[3].cursor.postedAt,'2026-10-01T03:00:00.123456-07:00');
});

test('repeated or out-of-order comment pages refuse the whole collection before context reads', async () => {
  for (const pages of [[[comment(1)],[comment(1)]],[[comment(1)],[comment(2)]],
    [[comment(1,{posted_at:'2026-10-01T10:00:00.123455+00:00'})],[comment(2)]]]) {
    const c=commentClient(),events=[];
    c.commentHeaders=async vehicleId=>{c.calls.push({reader:'auction_comments',vehicleId});return {ok:true,value:pages.shift()};};
    const r=await runCommentLineage(c,scope(),lineageSubjects(manifest([id(1)])),{emit:x=>events.push(x)});
    assert.equal(r.failures.comment_header_order_or_repeated_id,1);assert.equal(r.measuredCommentHeaders,0);
    assert.equal(r.completedParents,0);assert.equal(r.status,'failed');
    assert.equal(c.calls.some(x=>x.reader==='auction_events'||x.reader==='external_identities'),false);
    assert.equal(events.some(x=>x.type==='comment_parent'),false);
  }
});

test('uninterpretable cursor, collection page budget and elapsed clock remain unmeasured', async () => {
  const subjects=lineageSubjects(manifest([id(1)]));
  const bad=await runCommentLineage(commentClient({headers:[comment(1,{posted_at:'uninterpretable'})]}),scope(),subjects);
  assert.equal(bad.gaps.comment_clock_cursor_unmeasured,1);assert.equal(bad.completedParents,0);assert.equal(bad.exitCode,2);
  const c=commentClient();let index=100;
  c.commentHeaders=async vehicleId=>{c.calls.push({reader:'auction_comments',vehicleId});return {ok:true,value:[comment(index--)]};};
  const paged=await runCommentLineage(c,scope(),subjects);
  assert.equal(paged.gaps.comment_collection_page_budget_unmeasured,1);assert.equal(paged.measuredCommentHeaders,0);
  assert.equal(paged.completedParents,0);assert.equal(paged.exitCode,2);assert.equal(c.requests,101);
  const timed=commentClient();let clock=0;
  timed.commentHeaders=async vehicleId=>{timed.calls.push({reader:'auction_comments',vehicleId});clock=10;return {ok:true,value:[comment(1)]};};
  const ended=await runCommentLineage(timed,scope({until:5}),subjects,{now:()=>clock});
  assert.equal(ended.stopReason,'time_budget_reached');assert.equal(ended.gaps.comment_collection_time_unmeasured,1);
  assert.equal(ended.completedParents,0);assert.equal(ended.measuredCommentHeaders,0);assert.equal(ended.exitCode,2);
});

const bid = (n, extra={}) => ({comment_id:id(100+n),vehicle_id:id(1),observed_at:'2026-10-01T10:00:00.123456+00:00',
  comment_type:'bid',platform:'bat',external_identity_id:id(20),auction_event_id:id(10),source_category:'auction',source_slug:'bat',...extra});
const bidSource = (n, extra={}) => comment(n,{comment_type:'bid',...extra});
function bidClient(extra={}) {
  const c=commentClient(extra),ok=value=>({ok:true,status:200,durationMs:1,value});
  c.bidHeaders=async (vehicleId,after)=>{
    c.calls.push({reader:'vehicle_comments_unified',vehicleId,after});
    const rows=[...(extra.bids??[bid(1)])].sort((a,b)=>a.comment_id.localeCompare(b.comment_id));
    return extra.bidResponse??ok(rows.filter(x=>!after||x.comment_id>after).slice(0,extra.serverPageSize??200));
  };
  c.bidOrigins=async (vehicleId,ids)=>{c.calls.push({reader:'auction_comments',vehicleId,ids});
    return extra.nativeResponse??ok((extra.origins??[bidSource(1)]).filter(x=>ids.includes(x.id)));};
  c.bidObservationOrigins=async (vehicleId,ids)=>{c.calls.push({reader:'vehicle_observations',vehicleId,ids});
    return extra.observationResponse??ok((extra.observations??[]).filter(x=>ids.includes(x.id)));};
  return c;
}

test('positive bid family uses explicit subjects and its own finite collection ceiling',()=>{
  const args=['--out','private','--family','bids','--subjects','manifest'];
  assert.equal(options(args).bidLimit,1000);assert.equal(options([...args,'--bid-limit','10000']).bidLimit,10000);
  for(const value of ['999','10001','Infinity','1.5'])assert.throws(()=>options([...args,'--bid-limit',value]));
  assert.throws(()=>options(['--out','private','--family','bids']));
  assert.throws(()=>options([...args,'--comment-limit','10000']));
  assert.throws(()=>options(['--out','private','--family','comments','--subjects','manifest','--bid-limit','10000']));
});

test('positive bid transport is metadata-only, parent-scoped and never reads restricted bat_bids',async()=>{
  const urls=[],c=publicClient(anonymousConfiguration(env('anon')),async url=>{urls.push(new URL(url));return new Response('[]',{status:200});});
  await c.bidHeaders(id(1),id(101));await c.bidOrigins(id(1),[id(101)]);await c.bidObservationOrigins(id(1),[id(102)]);
  assert.equal(urls[0].pathname,'/rest/v1/vehicle_comments_unified');assert.equal(urls[0].searchParams.get('bid_amount'),'gt.0');
  assert.equal(urls[0].searchParams.get('comment_id'),`gt.${id(101)}`);assert.equal(urls[0].searchParams.get('order'),'comment_id.asc');
  for(const u of urls){assert.equal(u.searchParams.get('vehicle_id'),`eq.${id(1)}`);assert.equal(u.pathname.includes('bat_bids'),false);
    for(const field of ['bid_amount','comment_text','author_username','structured_data','metadata','*'])assert.equal(u.searchParams.get('select').includes(field),false);}
  assert.throws(()=>c.bidHeaders(id(1),'a handle'));assert.throws(()=>c.bidOrigins(undefined,[id(101)]));
  assert.throws(()=>c.bidObservationOrigins(undefined,[id(102)]));assert.throws(()=>c.bidOrigins(id(1),[id(101),id(101)]));
});

test('bid header validator rejects foreign, duplicate, unsupported-source and malformed identities',()=>{
  assert.equal(inspectBidHeaders(id(1),[bid(1)]),true);
  assert.equal(inspectBidHeaders(id(1),[bid(1,{observed_at:null})]),true);
  for(const rows of [[bid(1),bid(1)],[bid(1,{vehicle_id:id(9)})],[bid(1,{source_category:'user'})],
    [bid(1,{external_identity_id:'a handle'})],[bid(1,{auction_event_id:undefined})],[bid(1,{source_slug:null})]])
    assert.equal(inspectBidHeaders(id(1),rows),false);
});

test('native bid projection keeps source microseconds and exposes fields that fail to reach the view',()=>{
  const source=[bidSource(1,{author_external_identity_id:id(20)})],auctions=[{id:id(10),vehicle_id:id(1),source:'bat'}],identities=[{id:id(20),platform:'bat'}];
  const equal=inspectBidLineage([bid(1,{observed_at:'2026-10-01T03:00:00.123456-07:00'})],source,[],[],auctions,identities);
  assert.equal(equal.matchingNativeProjections,1);assert.equal(equal.finiteNativePostClocks,1);assert.equal(equal.nativeAuthorStates.agreeing,1);
  assert.deepEqual(equal.failures,{});assert.equal(equal.matchingAuctionParents,1);
  const mismatch=inspectBidLineage([bid(1,{observed_at:'2026-10-01T10:00:00.123455+00:00',external_identity_id:id(21)})],source,[],[],auctions,identities);
  assert.equal(mismatch.matchingNativeProjections,0);assert.equal(mismatch.failures.native_bid_post_clock_projection_mismatch,1);
  assert.equal(mismatch.failures.native_bid_projection_external_identity_id_mismatch,1);
});

test('unknown native clock/platform and source-slug default cannot imply timed BaT bidding',()=>{
  const r=inspectBidLineage([bid(1,{observed_at:null,platform:null})],[bidSource(1,{posted_at:null,platform:null})],[],[],[],[]);
  assert.equal(r.matchingNativeProjections,1);assert.equal(r.finiteNativePostClocks,0);
  assert.equal(r.gaps.native_bid_post_clock_unmeasured,1);assert.equal(r.gaps.source_slug_defaults_bat_without_retained_platform,1);
  assert.equal(r.matchingRecordedIdentityNamespaces,0);assert.equal(r.gaps.source_auction_parent_unavailable_or_unlinked,1);
});

test('observation bid role, supersession and native source pointer remain distinct from native bid events',()=>{
  const h=bid(2,{source_category:'observation',platform:null,external_identity_id:null,auction_event_id:null,source_slug:'unknown'});
  const obs={id:id(102),vehicle_id:id(1),observed_at:h.observed_at,kind:'comment',source_comment_id:id(103),confidence_score:0.6,is_superseded:true,extraction_method:'offline-model'};
  const r=inspectBidLineage([h],[],[obs],[bidSource(3)],[],[]);
  assert.equal(r.observationHeaders,1);assert.equal(r.nativeHeaders,0);assert.equal(r.matchingObservationClocks,1);
  assert.equal(r.linkedObservationSourceComments,1);assert.equal(r.gaps.observation_bid_source_role_and_episode_unqualified,1);
  assert.equal(r.gaps.superseded_observation_exposed_as_positive_bid,1);assert.equal(r.nativeAuthorStates.absent,0);
});

test('bid runner gates private parents, follows short pages to empty and omits all payloads',async()=>{
  const c=bidClient({bids:[bid(1,{comment_text:'PRIVATE QUOTE',bid_amount:999999}),bid(2)],
    origins:[bidSource(1,{author_username:'PRIVATE HANDLE'}),bidSource(2)],serverPageSize:1}),events=[];
  const r=await runBidLineage(c,scope(),lineageSubjects(manifest([id(1),id(2)])),{emit:x=>events.push(x)});
  assert.equal(r.absentOrIneligibleParents,1);assert.equal(r.completedParents,1);assert.equal(r.measured.bidHeaders,2);
  assert.equal(r.measured.matchingNativeProjections,2);assert.equal(r.nativeAuthorStates.legacyOnly,2);
  assert.deepEqual(c.calls.filter(x=>x.reader==='vehicle_comments_unified').map(x=>x.after),[undefined,id(101),id(102)]);
  for(const text of ['PRIVATE QUOTE','PRIVATE HANDLE','999999',id(2)])assert.equal(JSON.stringify(events).includes(text),false);
  assert.equal(r.databaseWrites,0);assert.equal(r.modelCalls,0);assert.equal(r.exitCode,0);
});

test('unsafe bid gate/headers/origin context stop without exposing foreign identifiers',async()=>{
  for(const extra of [{parents:[parent(9)]},{bids:[bid(1,{vehicle_id:id(9)})]},
    {nativeResponse:{ok:true,value:[bidSource(1,{vehicle_id:id(9)})]}},
    {nativeResponse:{ok:true,value:[bidSource(1),bidSource(1)]}}]){
    const c=bidClient(extra),events=[],r=await runBidLineage(c,scope(),lineageSubjects(manifest([id(1)])),{emit:x=>events.push(x)});
    assert.equal(r.status,'failed');assert.equal(r.completedParents,0);assert.equal(JSON.stringify(events).includes(id(9)),false);
  }
});

test('bid observation context follows only its exact typed public source pointer and retains unknown role',async()=>{
  const h=bid(2,{source_category:'observation',platform:null,external_identity_id:null,auction_event_id:null,source_slug:'unknown'});
  const obs={id:id(102),vehicle_id:id(1),observed_at:h.observed_at,kind:'comment',source_comment_id:id(103),confidence_score:0.6,is_superseded:true,extraction_method:'offline-model'};
  const c=bidClient({bids:[h],observations:[obs],origins:[bidSource(3)]});
  const r=await runBidLineage(c,scope(),lineageSubjects(manifest([id(1)])));
  assert.equal(r.completedParents,1);assert.equal(r.measured.observationHeaders,1);assert.equal(r.measured.nativeHeaders,0);
  assert.equal(r.measured.linkedObservationSourceComments,1);assert.equal(r.measured.matchingObservationClocks,1);
  assert.equal(r.gaps.observation_bid_source_role_and_episode_unqualified,1);assert.equal(r.gaps.superseded_observation_exposed_as_positive_bid,1);
  assert.deepEqual(c.calls.find(x=>x.reader==='auction_comments').ids,[id(103)]);assert.equal(r.exitCode,0);
});

test('repeated or out-of-order bid UUID pages refuse source/context claims',async()=>{
  for(const pages of [[[bid(2)],[bid(1)]],[[bid(1)],[bid(1)]],[[bid(2),bid(1)]]]){
    const c=bidClient();c.bidHeaders=async vehicleId=>{c.calls.push({reader:'vehicle_comments_unified',vehicleId});return {ok:true,value:pages.shift()};};
    const r=await runBidLineage(c,scope(),lineageSubjects(manifest([id(1)])));
    assert.equal(r.failures.bid_header_order_or_repeated_id,1);assert.equal(r.measured.bidHeaders,0);assert.equal(r.exitCode,1);
    assert.equal(c.calls.some(x=>x.reader==='auction_comments'),false);
  }
});

test('bid reader/context failures stop after two similar failures and never become zero relationships',async()=>{
  for(const extra of [{bidResponse:{ok:false,status:503,code:'57014'}},{nativeResponse:{ok:false,status:403,code:'42501'}}]){
    const c=bidClient({...extra,parents:[parent(1),parent(2),parent(3)]});
    if(!extra.bidResponse)c.bidHeaders=async (vehicleId,after)=>{c.calls.push({reader:'vehicle_comments_unified',vehicleId,after});return {ok:true,value:after?[]:[bid(1,{vehicle_id:vehicleId})]};};
    const r=await runBidLineage(c,scope(),lineageSubjects(manifest([id(1),id(2),id(3)])));
    assert.equal(r.inspectedParents,2);assert.equal(r.stopReason,'repeated_bid_reader_failure_inspect_cause');
    assert.equal(r.completedParents,0);assert.equal(r.measured.bidHeaders,0);assert.equal(r.exitCode,1);
  }
});

test('bid collection caps/time/refused projection shape stay unmeasured',async()=>{
  const bids=Array.from({length:1001},(_,i)=>bid(i)),origins=Array.from({length:1001},(_,i)=>bidSource(i));
  const c=bidClient({bids,origins}),cap=await runBidLineage(c,scope(),lineageSubjects(manifest([id(1)])));
  assert.equal(cap.completedParents,0);assert.equal(cap.measured.bidHeaders,0);assert.equal(cap.gaps.bid_collection_cap_unmeasured,1);assert.equal(cap.exitCode,2);
  assert.equal(c.calls.some(x=>x.reader==='auction_comments'),false);
  const large=await runBidLineage(bidClient({bids,origins}),scope({bidLimit:10000}),lineageSubjects(manifest([id(1)])));
  assert.equal(large.completedParents,1);assert.equal(large.measured.bidHeaders,1001);assert.equal(large.exitCode,0);
  const timed=bidClient();let clock=0;
  timed.bidHeaders=async vehicleId=>{timed.calls.push({reader:'vehicle_comments_unified',vehicleId});clock=10;return {ok:true,value:[bid(1)]};};
  const end=await runBidLineage(timed,scope({until:5}),lineageSubjects(manifest([id(1)])),{now:()=>clock});
  assert.equal(end.stopReason,'time_budget_reached');assert.equal(end.completedParents,0);assert.equal(end.exitCode,2);
});

test('bid CLI retains its reader family and finite private source-hash receipt',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'nuke-bid-assay-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const input=path.join(dir,'manifest.json'),out=path.join(dir,'receipt.jsonl');await writeFile(input,JSON.stringify(manifest([id(1)])));
  assert.equal(await main(['--out',out,'--family','bids','--subjects',input],{env:env('anon'),client:bidClient(),print:()=>{}}),0);
  const rows=(await readFile(out,'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(rows[0].readers.includes('vehicle_comments_unified'),true);assert.equal(rows[0].readers.includes('bat_bids'),false);
  assert.equal(rows[0].options.bidLimit,1000);assert.equal(rows.at(-1).measured.matchingNativeProjections,1);
  assert.equal((await stat(out)).mode&0o777,0o600);assert.match(rows[0].assaySourceSha256,/^[a-f0-9]{64}$/);
});
