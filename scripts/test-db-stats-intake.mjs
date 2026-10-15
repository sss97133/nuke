import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as intakeLedger from '../supabase/functions/poll-listing-feeds/ledger.ts';
import { test } from 'node:test';
import { SOURCE_OPERATING_QUERIES, SOURCE_OPERATING_OWNERS, sourceOperatingState, shapeSourceInventory }
  from '../supabase/functions/db-stats/sourceOperating.ts';
import ts from '../nuke_frontend/node_modules/typescript/lib/typescript.js';
import { boundedRead, readIntakeSection, COVERAGE_SQL, MODEL_SQL, CONFIG_SQL, HEALTH_SQL,
  INTAKE_TABLES, INTAKE_JOBS, HEALTH_JOBS, FEEDS_SQL, SOURCE_PROFILES_SQL,
  ORG_TARGETS_SQL, ORG_ACTIVITY_SQL, readOrganizationTargets, EXECUTION_SQL, CONSUMERS_SQL, ACTIVITY_SQL } from '../supabase/functions/db-stats/intakeStatus.ts';

const clock = '2026-10-10T12:00:00Z';
const operatingRow = { id: 'synthetic-feed', label: 'Synthetic feed', enabled: true, cadence_minutes: 60,
  last_activity_at: '2026-10-10T11:30:00Z', activity_basis: 'last_polled_at', has_error: false };

test('source activity states respect each configured cadence and do not treat a fresh claim as successful capture', () => {
  assert.equal(sourceOperatingState(operatingRow, clock), 'recent_activity');
  assert.equal(sourceOperatingState({ ...operatingRow, has_error: true }, clock), 'recent_activity');
  assert.equal(sourceOperatingState({ ...operatingRow, last_activity_at: '2026-10-10T11:00:00Z' }, clock), 'overdue');
  assert.equal(sourceOperatingState({ ...operatingRow, last_activity_at: null }, clock), 'never_reported');
  for (const cadence_minutes of [null, 0, -1])
    assert.equal(sourceOperatingState({ ...operatingRow, cadence_minutes }, clock), 'cadence_missing');
  assert.equal(sourceOperatingState({ ...operatingRow, enabled: false, last_activity_at: null }, clock), 'inactive');
  assert.equal(sourceOperatingState({ ...operatingRow, enabled: null }, clock), 'configuration_unknown');
  assert.equal(sourceOperatingState({ ...operatingRow, last_activity_at: '2026-10-10T12:01:00Z' }, clock), 'invalid_clock');
});

test('inventories preserve their own scope and failure; no summed source denominator or unbounded catalog scan', async () => {
  const db = connection({
    [SOURCE_OPERATING_QUERIES.listing_feeds]: [{ measured_at: clock, rows: [operatingRow] }],
    [SOURCE_OPERATING_QUERIES.scrape_sources]: new Error('PRIVATE_SOURCE_BODY'),
    [SOURCE_OPERATING_QUERIES.source_registry]: [{ measured_at: clock, rows: [] }],
    [SOURCE_OPERATING_QUERIES.forum_sources]: [{ measured_at: clock, rows: [{ ...operatingRow,
      enabled: null, cadence_minutes: null, activity_basis: 'last_crawled_at', has_error: null }] }],
  });
  const result = await readIntakeSection(db, 'reporting');
  assert.deepEqual(result.inventories.map(r => r.owner), SOURCE_OPERATING_OWNERS);
  assert.equal(result.inventories[0].complete, true);
  assert.equal(result.inventories[1].status, 'unavailable');
  assert.equal(result.inventories[1].complete, false);
  assert.equal(result.inventories[2].rows[0].state, 'recent_activity');
  assert.equal(result.inventories[3].rows[0].state, 'configuration_unknown');
  assert(!('total_sources' in result)); assert(!JSON.stringify(result).includes('PRIVATE'));
  assert.equal(db.calls.filter(c => c.sql === 'BEGIN READ ONLY').length, 4);
  assert.equal(db.calls.filter(c => c.sql === 'ROLLBACK').length, 4);
  assert.equal(db.calls.filter(c => c.sql === "SET LOCAL statement_timeout = '3s'").length, 4);
  for (const sql of Object.values(SOURCE_OPERATING_QUERIES)) {
    assert(sql.includes('LIMIT 1001')); assert(!sql.includes('SELECT *')); assert(!sql.includes('count(*)'));
  }
});

test('overflow is an explicit inventory slice; invalid rows cannot become zero or healthy', () => {
  const reading = { status: 'measured', measured_at: clock, rows: Array.from({ length: 1001 }, (_, i) =>
    ({ ...operatingRow, id: String(i), private_body: 'PRIVATE_PAYLOAD' })) };
  const result = shapeSourceInventory('listing_feeds', reading);
  assert.equal(result.complete, false); assert.equal(result.rows.length, 1000);
  assert(!JSON.stringify(result).includes('PRIVATE'));
  assert.equal(shapeSourceInventory('listing_feeds', { ...reading, rows: [operatingRow, operatingRow] }).status, 'unavailable');
  assert.equal(shapeSourceInventory('listing_feeds', { ...reading, rows: [null] }).status, 'unavailable');
  assert.equal(shapeSourceInventory('listing_feeds', { ...reading, rows: [{ ...operatingRow, enabled: 'true' }] }).status, 'unavailable');
  assert.equal(shapeSourceInventory('listing_feeds', { ...reading, rows: [{ ...operatingRow, last_activity_at: 'invalid' }] }).status, 'unavailable');
  assert.equal(shapeSourceInventory('listing_feeds', { ...reading, measured_at: null }).status, 'unavailable');
});
function connection(results = {}) {
  const calls = [];
  return { calls, async queryObject(sql, args) {
    calls.push({ sql, args });
    const result = typeof results[sql] === 'function' ? await results[sql](args) : results[sql];
    if (result instanceof Error) throw result;
    return { rows: result ?? [] };
  } };
}

test('each read is read-only, bounded and rolls back before returning', async () => {
  const db = connection({ [COVERAGE_SQL]: [{ measured_at: clock, rows: [] }] });
  assert.equal((await boundedRead(db, COVERAGE_SQL)).status, 'measured');
  assert.deepEqual(db.calls.map(c => c.sql), ['BEGIN READ ONLY', "SET LOCAL statement_timeout = '5s'",
    "SET LOCAL lock_timeout = '1s'", COVERAGE_SQL, 'ROLLBACK']);
});
test('source activity retains its own window and clock without promoting writer receipts to fleet coverage', async () => {
  const rows = [{ run_id: 'synthetic-run', worker: 'extract-facebook-marketplace', started_at: clock,
    observed_at: '2026-10-10T11:58:00Z', sources: [{ source: 'facebook_marketplace', consumer_usable: null }] }];
  const result = await readIntakeSection(connection({ [ACTIVITY_SQL]: [{ measured_at: clock, rows, complete: false }] }), 'jobs');
  assert.deepEqual(result.activity.rows, rows); assert.equal(result.activity.window_hours, 24);
  assert.equal(result.activity.complete, false); assert.equal(result.activity.limit_per_worker, 50);
  assert(ACTIVITY_SQL.includes('LIMIT 51')); assert(!ACTIVITY_SQL.includes('error_details'));
  assert(!ACTIVITY_SQL.includes("'batch',")); assert(!ACTIVITY_SQL.includes('seller_name'));
});
test('unavailable source receipts preserve independent job and configuration readings', async () => {
  const result = await readIntakeSection(connection({ [ACTIVITY_SQL]: new Error('PRIVATE_CAPTURE_PAYLOAD'),
    [CONFIG_SQL]: [{ measured_at: clock, rows: [{ jobname: 'synthetic-job', active: true }] }] }), 'jobs');
  assert.equal(result.activity.status, 'unavailable'); assert.equal(result.activity.complete, false);
  assert.equal(result.config.status, 'measured'); assert(!JSON.stringify(result).includes('PRIVATE_'));
});
test('timeout/refusal loses only that reading and never exposes private SQL error bodies', async () => {
  const db = connection({ [CONFIG_SQL]: [{ measured_at: clock, rows: [{ jobname: 'synthetic-job', active: false }] }],
    [HEALTH_SQL]: new Error('PRIVATE_SQL_COMMAND_AND_CREDENTIAL') });
  const result = await readIntakeSection(db, 'jobs');
  assert.equal(result.config.status, 'measured'); assert.equal(result.health.status, 'unavailable');
  assert.equal(result.config.rows[0].active, false);
  assert.equal(result.health.measured_at, null); assert.deepEqual(result.health.rows, []);
  assert(!JSON.stringify(result).includes('PRIVATE_'));
  assert.equal(db.calls.filter(c => c.sql === 'ROLLBACK').length, HEALTH_JOBS.length + 4);
  assert.deepEqual(result.scope, INTAKE_JOBS); assert.deepEqual(result.health_scope, HEALTH_JOBS);
});
test('an output timeout preserves execution evidence without claiming output health', async () => {
  const db = connection({ [HEALTH_SQL]: new Error('PRIVATE_ASSAY_TIMEOUT'),
    [EXECUTION_SQL]: [{ measured_at: clock, rows: [{ jobname: 'bat-live-pull', declared_writer: 'bat-live-pull',
      last_status: 'succeeded', last_run_at: clock, assay_status: null, health_status: null }] }] });
  const result = await readIntakeSection(db, 'jobs');
  assert.equal(result.health.status, 'measured');
  assert.equal(result.health.output_measured, false);
  assert.equal(result.health.rows[0].last_status, 'succeeded');
  assert.equal(result.health.rows[0].assay_status, null);
  assert.equal(result.health.rows[0].health_status, null);
  assert(!JSON.stringify(result).includes('PRIVATE'));
  assert.deepEqual(db.calls.find(c => c.sql === EXECUTION_SQL).args, [HEALTH_JOBS]);
});

test('one timed-out assay cannot erase another canonical check or its independent clock', async () => {
  const exec = HEALTH_JOBS.map(jobname => ({ jobname, declared_writer: null, last_status: 'succeeded',
    last_run_at: clock, assay_status: null, health_status: null }));
  const db = connection({ [EXECUTION_SQL]: [{ measured_at: clock, rows: exec }],
    [HEALTH_SQL]: args => args[0][0] === 'bat-live-pull' ? new Error('PRIVATE_ASSAY_TIMEOUT')
      : [{ measured_at: '2026-10-10T12:00:02Z', rows: [{ ...exec.find(r => r.jobname === args[0][0]),
        last_status: 'failed', assay_status: 'passed', health_status: 'passed' }] }] });
  const result = await readIntakeSection(db, 'jobs');
  const failed = result.health.rows.find(r => r.jobname === 'bat-live-pull');
  const survivor = result.health.rows.find(r => r.jobname === 'drain-sale-residual-fold');
  assert.equal(failed.last_status, 'succeeded'); assert.equal(failed.assay_status, null);
  assert.equal(survivor.last_status, 'succeeded'); assert.equal(survivor.assay_status, 'passed');
  assert.equal(result.health.measured_at, clock);
  assert.equal(result.health.readings.find(r => r.jobname === 'drain-sale-residual-fold').measured_at, '2026-10-10T12:00:02Z');
  assert.equal(result.health.readings.find(r => r.jobname === 'bat-live-pull').reason, 'query_unavailable');
  assert.equal(result.health.output_measured, false);
  assert(db.calls.filter(c => c.sql === HEALTH_SQL).every(c => c.args[0].length === 1));
  assert.equal(db.calls.filter(c => c.sql === "SET LOCAL statement_timeout = '3s'").length, HEALTH_JOBS.length + 1);
  assert(!JSON.stringify(result).includes('PRIVATE'));
});

test('an assay returning unavailable is kept unknown even when its SQL finishes', async () => {
  const db = connection({ [HEALTH_SQL]: args => [{ measured_at: clock, rows: [{ jobname: args[0][0],
    assay_status: 'unavailable', health_status: 'unknown', last_status: 'succeeded' }] }] });
  const result = await readIntakeSection(db, 'jobs');
  assert.equal(result.health.status, 'measured'); assert.equal(result.health.output_measured, false);
  assert(result.health.readings.every(r => r.status === 'unavailable' && r.reason === 'assay_unavailable'));
});

test('the section budget stops starting assays while retaining execution evidence', async t => {
  let now = 0;
  t.mock.method(Date, 'now', () => now);
  const db = connection({ [EXECUTION_SQL]: [{ measured_at: clock, rows: HEALTH_JOBS.map(jobname => ({
    jobname, last_status: 'succeeded', assay_status: null, health_status: null })) }],
    [HEALTH_SQL]: args => { now = 25_000; return [{ measured_at: clock, rows: [{ jobname: args[0][0],
      assay_status: 'passed', health_status: 'passed' }] }]; } });
  const result = await readIntakeSection(db, 'jobs');
  assert.equal(db.calls.filter(c => c.sql === HEALTH_SQL).length, 1);
  assert.equal(result.health.rows.length, HEALTH_JOBS.length);
  assert.equal(result.health.readings.filter(r => r.reason === 'reading_budget_exhausted').length, HEALTH_JOBS.length - 1);
  assert.equal(result.health.rows.find(r => r.jobname === 'drain-sale-residual-fold').assay_status, 'passed');
  assert.equal(result.health.rows.find(r => r.jobname === 'bat-live-pull').assay_status, null);
  assert.equal(result.health.output_measured, false);
});
test('coverage preserves known-target queue counts and refuses totals after source overflow', async () => {
  const rows = Array.from({ length: 31 }, (_, i) => ({ source_slug: `source-${i}`, total_targets: 100, extracted: 0 }));
  const db = connection({ [COVERAGE_SQL]: [{ measured_at: clock, rows }] });
  const result = await readIntakeSection(db, 'coverage');
  assert.equal(result.rows.length, 30); assert.equal(result.complete, false);
  assert.equal(result.rows[0].extracted, 0); assert.equal(result.rows[0].total_targets, 100);
  assert.equal(result.scope.basis, 'known_target_url_queue_status');
});
test('consumer structure reuses the registry with explicit bounds and no raw evidence payloads', async () => {
  const rows = Array.from({ length: 101 }, (_, i) => ({ stack_id: `S${i}` }));
  const result = await readIntakeSection(connection({ [CONSUMERS_SQL]: [{ measured_at: clock, rows }] }), 'consumers');
  assert.equal(result.rows.length, 100); assert.equal(result.complete, false);
  assert.equal(result.scope.basis, 'declared_stack_structure');
  assert(CONSUMERS_SQL.includes('public.stack_coverage(NULL)'));
  assert(CONSUMERS_SQL.includes('n.ordinality <= 64'));
  assert(!CONSUMERS_SQL.includes("'evidence',"));
  assert(!CONSUMERS_SQL.includes('c.needs AS needs'));
});
test('relationship slice is explicit and uses fixed parameterized table scope', async () => {
  const db = connection({ [MODEL_SQL]: [{ measured_at: clock, rows: [], links: Array.from({ length: 501 }, () => ({ validated: false })) }] });
  const result = await readIntakeSection(db, 'model');
  assert.equal(result.links.length, 500); assert.equal(result.links_complete, false);
  assert.deepEqual(db.calls.find(c => c.sql === MODEL_SQL).args, [INTAKE_TABLES]);
  assert.equal(result.receipt_limit_per_table, 32); assert.equal(result.receipt_window_days, 30);
  assert(MODEL_SQL.includes('LIMIT 33')); assert(!MODEL_SQL.includes('writers_30d'));
});

function handler({ verdict, admin = false, organizationReading } = {}) {
  let serve, pools = 0, queries = 0, reads = 0;
  const exports = {};
  const source = readFileSync(new URL('../supabase/functions/db-stats/index.ts', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const queryCalls = [];
  const context = {
    exports, Request, Response, URL, console: { error() {} },
    Deno: { env: { get: () => 'configured' }, serve(fn) { serve = fn; } },
    require(name) {
      if (name.endsWith('/cors.ts')) return { corsHeaders: { 'Access-Control-Allow-Origin': '*' } };
      if (name.endsWith('/writeGuard.ts')) return { authenticateWriter: async () => verdict ?? { ok: false } };
      if (name.endsWith('/listingHistory.ts')) return {};
      if (name.endsWith('/intakeStatus.ts')) return {
        readIntakeSection: async (_db, section) => { reads++; return { contract: 'intake_status_v1', section }; },
        readOrganizationTargets: async (_db, id) => { reads++; return { contract: 'organization_targets_v1', organization_id: id, status: 'measured', rows: [], ...organizationReading }; },
      };
      if (name.includes('postgres@')) return { Pool: class {
        constructor() { pools++; }
        async connect() { return { async queryObject(sql, args) { queries++; queryCalls.push({ sql, args }); return { rows: [{ allowed: admin }] }; }, release() {} }; }
        async end() {}
      } };
      throw new Error(`Unexpected import: ${name}`);
    },
  };
  vm.runInNewContext(code, context);
  return { request: (section = 'coverage', method = 'GET') => serve(new Request(`https://synthetic.invalid/db-stats?intake=${section}`, { method })),
    publicRequest: (query, method = 'GET') => serve(new Request(`https://synthetic.invalid/db-stats?${query}`, { method })),
    counts: () => ({ pools, queries, reads }), queryCalls };
}
test('anonymous/forged callers are refused before opening a database pool', async () => {
  const h = handler(); const response = await h.request();
  assert.equal(response.status, 401); assert.deepEqual(h.counts(), { pools: 0, queries: 0, reads: 0 });
});
test('source reporting remains restricted to verified service callers or active admins', async () => {
  const anonymous = handler();
  assert.equal((await anonymous.request('reporting')).status, 401);
  assert.equal(anonymous.counts().pools, 0);
  const user = { ok: true, caller: { kind: 'user', userId: 'synthetic-user' } };
  const nonAdmin = handler({ verdict: user });
  assert.equal((await nonAdmin.request('reporting')).status, 403);
  assert.equal(nonAdmin.counts().reads, 0);
  const admin = handler({ verdict: user, admin: true });
  assert.equal((await admin.request('reporting')).status, 200);
  assert.equal(admin.counts().reads, 1);
  const service = handler({ verdict: { ok: true, caller: { kind: 'service_role' } } });
  assert.equal((await service.request('reporting')).status, 200);
  assert.equal(service.counts().queries, 0);
});

test('public organization targets reject arbitrary scopes before opening a pool', async () => {
  const h = handler();
  for (const query of ['organization_targets=not-a-uuid', 'organization_targets=11111111-1111-1111-1111-111111111111&intake=jobs'])
    assert.equal((await h.publicRequest(query)).status, 400);
  assert.equal((await h.publicRequest('organization_targets=11111111-1111-1111-1111-111111111111', 'POST')).status, 405);
  assert.deepEqual(h.counts(), { pools: 0, queries: 0, reads: 0 });
});
test('anonymous target requests use only the organization-scoped public reader', async () => {
  const h = handler(); const id = '11111111-1111-1111-1111-111111111111';
  const response = await h.publicRequest(`organization_targets=${id}`);
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { contract: 'organization_targets_v1', organization_id: id, status: 'measured', rows: [] });
  assert.deepEqual(h.counts(), { pools: 1, queries: 0, reads: 1 });
});
test('target inventory is parameterized, bounded, public-only and distinct from queue completion', async () => {
  const db = connection({ [ORG_TARGETS_SQL]: [{ measured_at: clock, rows: [{ source_slug: 'synthetic', total_targets: 2, targets: [] }] }] });
  const result = await readOrganizationTargets(db, 'synthetic-id');
  assert.deepEqual(db.calls.find(c => c.sql === ORG_TARGETS_SQL).args, ['synthetic-id']);
  assert.equal(result.sample_limit, 25); assert.equal(result.rows[0].total_targets, 2);
  assert(SOURCE_PROFILES_SQL.includes('o.is_public = true'));
  assert(SOURCE_PROFILES_SQL.includes('s.business_id IS NOT NULL AND o.id = s.business_id'));
  assert(SOURCE_PROFILES_SQL.includes('s.business_id IS NULL AND lower(trim(o.business_name)) = lower(trim(s.display_name))'));
  assert(SOURCE_PROFILES_SQL.includes('WHEN count(*) = 1'));
  assert(ORG_TARGETS_SQL.includes('p.organization_id = $1'));
  assert(ORG_TARGETS_SQL.includes('WHERE source_slug = p.source_slug LIMIT 25'));
  assert(!/import_queue|extracted|phone|email|contact|metadata/i.test(ORG_TARGETS_SQL));
  assert.equal(db.calls.at(-1).sql, 'ROLLBACK');
});
test('signed-in non-admin gets no privileged metadata; membership is parameterized', async () => {
  const h = handler({ verdict: { ok: true, caller: { kind: 'user', userId: 'synthetic-user' } } });
  assert.equal((await h.request()).status, 403);
  assert.equal(h.counts().reads, 0);
  assert.equal(h.queryCalls[0].sql.includes('user_id = $1::uuid AND is_active'), true);
  assert.deepEqual(Array.from(h.queryCalls[0].args), ['synthetic-user']);
});
test('organization activity reads only its public parent cache; a cache failure preserves target inventory', async () => {
  const db = connection({ [ORG_TARGETS_SQL]: [{ measured_at: clock, rows: [{ total_targets: 2 }] }],
    [ORG_ACTIVITY_SQL]: new Error('PRIVATE_CACHE_ERROR') });
  const result = await readOrganizationTargets(db, 'synthetic-id');
  assert.equal(result.rows[0].total_targets, 2);
  assert.equal(result.listing_activity.status, 'unavailable');
  assert.deepEqual(db.calls.find(c => c.sql === ORG_ACTIVITY_SQL).args, ['synthetic-id']);
  assert(!JSON.stringify(result).includes('PRIVATE_CACHE_ERROR'));
  assert(!ORG_ACTIVITY_SQL.includes('public.vehicle_events'));
});
test('active admins and service callers receive only the requested read-only section without caching', async () => {
  for (const caller of [{ kind: 'user', userId: 'synthetic-admin' }, { kind: 'service_role' }]) {
    const h = handler({ verdict: { ok: true, caller }, admin: true }); const response = await h.request('model');
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(await response.json(), { contract: 'intake_status_v1', section: 'model' });
    assert.equal(h.counts().reads, 1);
  }
});
test('consumer metadata uses the same active-admin guard and refuses anonymous callers', async () => {
  assert.equal((await handler().request('consumers')).status, 401);
  assert.equal((await handler({ verdict: { ok: true, caller: { kind: 'user', userId: 'synthetic-user' } } }).request('consumers')).status, 403);
  const h = handler({ verdict: { ok: true, caller: { kind: 'service_role' } } });
  const response = await h.request('consumers');
  assert.equal(response.status, 200);
  assert.equal((await response.json()).section, 'consumers');
});
test('arbitrary sections, POSTs and API-key callers cannot choose a privileged query', async () => {
  const h = handler({ verdict: { ok: true, caller: { kind: 'api_key', userId: 'synthetic-admin' } }, admin: true });
  assert.equal((await h.request('private-table')).status, 400);
  assert.equal((await h.request('jobs', 'POST')).status, 405);
  assert.equal((await h.request()).status, 403);
  assert.deepEqual(h.counts(), { pools: 0, queries: 0, reads: 0 });
});

test('feed controls expose only validated limits and source switches; provider bodies stay private', async () => {
  const db = connection({ [CONFIG_SQL]: [{ measured_at: clock, rows: [] }], [HEALTH_SQL]: [{ measured_at: clock, rows: [] }],
    [FEEDS_SQL]: [{ measured_at: clock, rows: [{ source_slug: 'synthetic', feeds: 1, enabled_feeds: 1 }],
      controls: { max_ingests: 0, PRIVATE: 'never expose', sources: { synthetic: { enabled: false, PRIVATE: 'never expose' } } } }] });
  const result = await readIntakeSection(db, 'jobs');
  assert.equal(result.controls.value.max_ingests, 0);
  assert.equal(result.controls.value.sources.synthetic.enabled, false);
  assert.equal(result.feeds.complete, true);
  assert(!JSON.stringify(result).includes('PRIVATE'));
  assert(!FEEDS_SQL.includes('SELECT last_error'));
});

test('invalid controls fail closed without losing the independent feed metadata', async () => {
  const db = connection({ [FEEDS_SQL]: [{ measured_at: clock, rows: [], controls: { max_ingests: 'PRIVATE' } }] });
  const result = await readIntakeSection(db, 'jobs');
  assert.equal(result.controls.status, 'invalid');
  assert.equal(result.feeds.status, 'measured');
  assert(!JSON.stringify(result).includes('PRIVATE'));
});

function queueHandler({ controls = {}, items = [], result = {}, landed = [] } = {}) {
  let serve;
  const calls = { claims: 0, fetches: [], writes: [] };
  const db = {
    async rpc() { calls.claims++; return { data: items, error: null }; },
    from(table) {
      let write;
      const chain = new Proxy({}, { get(_target, method) {
        if (method === 'then') return (ok, fail) => Promise.resolve({ error: null,
          data: table === 'platform_config' ? { config_value: controls } : table === 'vehicles' ? landed : [] }).then(ok, fail);
        return (...args) => { if (method === 'update') { write = args[0]; calls.writes.push({ table, row: write }); } return chain; };
      } });
      return chain;
    },
  };
  const code = ts.transpileModule(readFileSync(new URL('../supabase/functions/process-import-queue/index.ts', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports: {}, Request, Response, URL, AbortSignal, Date, console: { warn() {} },
    Deno: { env: { get: () => 'configured' }, serve(fn) { serve = fn; } },
    fetch: async (url, options) => { calls.fetches.push({ url, body: JSON.parse(options.body) });
      return new Response(JSON.stringify(result), { headers: { 'content-type': 'application/json' } }); },
    require(name) {
      if (name.includes('supabase-js')) return { createClient: () => db };
      if (name.endsWith('/listingUrl.ts')) return { normalizeListingUrlKey: url => url };
      if (name.endsWith('/writeGuard.ts')) return { requireWriteAuth: async () => null };
      if (name.endsWith('/supabaseKeys.ts')) return { projectSecretKey: () => 'configured' };
      if (name.endsWith('/writeResult.ts')) return { mustWrite: (_label, result) => result, softWrite: () => null };
      if (name.endsWith('/ledger.ts')) return intakeLedger;
      throw new Error(`Unexpected queue import: ${name}`);
    },
  });
  return { calls, request: async (body = {}) => { const response = await serve(new Request('https://synthetic.invalid/process-import-queue',
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
    return { response, result: await response.json() }; } };
}

test('zero queue throttle starts no claims and no source requests', async () => {
  for (const controls of [{ enabled: false }, { max_ingests: 0 }]) {
    const h = queueHandler({ controls });
    assert.equal((await h.request()).result.processed, 0);
    assert.equal(h.calls.claims, 0); assert.equal(h.calls.fetches.length, 0);
  }
  const h = queueHandler(); await h.request({ batch_size: 0 });
  assert.equal(h.calls.claims, 0);
});

test('a source held at zero releases its claim and refunds the unattempted retry', async () => {
  const h = queueHandler({ controls: { sources: { gooding: { max_ingests: 0 } } },
    items: [{ id: 'queue-id', listing_url: 'https://www.goodingco.com/lot/vehicle/', attempts: 2 }] });
  const { result } = await h.request();
  assert.equal(result.processed, 0); assert.equal(result.deferred, 1);
  assert.equal(h.calls.fetches.length, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls.writes[0].row)), { status: 'pending', attempts: 1, locked_at: null, locked_by: null });
});

test('RM queue requests extract one lot and read its actual persisted vehicle before completion', async () => {
  const h = queueHandler({ items: [{ id: 'queue-id', listing_url: 'https://rmsothebys.com/auctions/test/lots/test/', attempts: 1 }],
    result: { success: true, vehicle_id: 'vehicle-id' }, landed: [{ id: 'vehicle-id', description: 'Retained source text' }] });
  const { result } = await h.request();
  assert.equal(h.calls.fetches[0].body.action, 'extract');
  assert.equal(result.results[0].status, 'complete');
  assert.equal(h.calls.writes[0].row.attempts, 1);
});

test('reported success without a readable vehicle never completes the queue item', async () => {
  const h = queueHandler({ items: [{ id: 'queue-id', listing_url: 'https://www.goodingco.com/lot/vehicle/', attempts: 1 }],
    result: { success: true, _db: { vehicle_id: 'vehicle-id' } } });
  const { result } = await h.request();
  assert.notEqual(result.results[0].status, 'complete');
  assert(result.results[0].error.includes('read-back failed'));
});

test('health exposes only allowlisted numeric assay aggregates alongside the canonical verdict', async () => {
  const db = connection({ [EXECUTION_SQL]: [{ measured_at: clock, rows: [{ jobname: HEALTH_JOBS[0], last_status: 'succeeded' }] }],
    [HEALTH_SQL]: args => [{ measured_at: clock, rows: [{ jobname: args[0][0], assay_status: 'failed', health_status: 'failed',
      assay_counts: { failed: 4, due: 12 } }] }] });
  const result = await readIntakeSection(db, 'jobs');
  assert.deepEqual(result.health.rows.find(r => r.jobname === HEALTH_JOBS[0]).assay_counts, { failed: 4, due: 12 });
  assert.equal(result.health.rows.find(r => r.jobname === HEALTH_JOBS[0]).last_status, 'succeeded');
  assert.match(HEALTH_SQL, /key IN \('pending','claimed','failed','stale_qualified'/);
  assert.match(HEALTH_SQL, /jsonb_typeof\(value\) = 'number'/);
  assert(!HEALTH_SQL.includes('source_scan')); assert(!HEALTH_SQL.includes('snapshot_cursor'));
});

test('public activity survives unavailable target inventory; two unavailable readings return 503', async () => {
  const partial = handler({ organizationReading: { status: 'unavailable', rows: [], listing_activity: { status: 'measured', rows: [{ total_listings: 2994 }] } } });
  const response = await partial.publicRequest('organization_targets=11111111-1111-1111-1111-111111111111');
  assert.equal(response.status, 200);
  assert.equal((await response.json()).listing_activity.rows[0].total_listings, 2994);
  const unavailable = handler({ organizationReading: { status: 'unavailable', listing_activity: { status: 'unavailable', rows: [] } } });
  assert.equal((await unavailable.publicRequest('organization_targets=11111111-1111-1111-1111-111111111111')).status, 503);
});
