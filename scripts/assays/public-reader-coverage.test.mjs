import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { options, anonymousConfiguration, publicClient, inspectPage, runCoverage, main } from './public-reader-coverage.mjs';

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
