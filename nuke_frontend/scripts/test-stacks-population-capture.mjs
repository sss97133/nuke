import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { capturePopulation, populationReader, sqlPopulationReader } from './stacks-population-capture.mjs';
import { decodeStudy, makeStudy } from '../src/pages/stacks/bidMeasurements.ts';

const uuid = (prefix, n) => `${prefix}0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const cutoff = '2026-09-02T00:00:00.000Z';
function fixtures(n = 150, bidN = 2) {
  const parents = [], bids = [];
  for (let i = 1; i <= n; i++) {
    const id = uuid('1', i), vehicle_id = uuid('3', i);
    const source_url = `https://bringatrailer.com/listing/fixture-${i}/`;
    parents.push({ id, vehicle_id, source:'bat', source_url, auction_end_date:'2026-09-01T20:00:00.000Z',
      created_at:'2026-09-01T00:00:00.000Z', total_bids:bidN, winning_bid:bidN * 100,
      winning_bidder_external_identity_id:uuid('4', 1),
      vehicles:{ id:vehicle_id, year:2000, make:'Chevrolet', model:'Corvette', normalized_model:'Corvette', is_public:true, deleted_at:null, listing_kind:null } });
    for (let j = 1; j <= bidN; j++) bids.push({ id:uuid('2', (i - 1) * bidN + j), auction_event_id:id, vehicle_id, source_url,
      posted_at:new Date(Date.parse('2026-09-01T19:00:00Z') + j * 100).toISOString(), created_at:'2026-09-01T20:00:00.000Z',
      bid_amount:j * 100, external_identity_id:uuid('4', 1), bat_comment_id:(i - 1) * bidN + j, author_username:'fixture',
      vehicles:{ id:vehicle_id, is_public:true, deleted_at:null, listing_kind:null } });
  }
  return { parents, bids };
}
function reader(data, pageSize = 50) {
  const calls = [];
  return { calls,
    parents: async request => { calls.push({ kind:'parents', ...request }); return data.parents.filter(r => !request.after || r.id > request.after).slice(0, pageSize); },
    bids: async request => { calls.push({ kind:'bids', ...request }); return data.bids.filter(r => request.ids.includes(r.auction_event_id) && (!request.after || r.id > request.after)).slice(0, pageSize); },
  };
}
async function setup(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nuke-population-test-'));
  t.after(() => fs.rm(root, { recursive:true, force:true }));
  return { cache:path.join(root, 'raw'), output:path.join(root, 'study.json'), before:cutoff };
}
const exists = async file => { try { await fs.stat(file); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } };
const manifest = async options => JSON.parse(await fs.readFile(path.join(options.cache, 'capture.json'), 'utf8'));
const study = async options => decodeStudy(JSON.parse(await fs.readFile(options.output, 'utf8')));

test('enumerates past120, exhausts short transport pages and reuses exact analytical/exclusion operators', async t => {
  const options = await setup(t), data = fixtures();
  data.parents[4].winning_bid = 999; // Preserve a genuine conflict as an exclusion, not a measured zero.
  const source = reader(data), result = await capturePopulation({ ...options, reader:source, maxRequests:1000 });
  const delivered = await study(options), reference = makeStudy(data.parents, data.bids, delivered.readAt, delivered.selection, false);
  assert.deepEqual(delivered.lots, reference.lots);
  assert.deepEqual(delivered.exclusions, reference.exclusions);
  assert.equal(delivered.candidateN, 150);
  assert.equal(delivered.capped, false);
  assert.equal(result.usableEpisodes, 149);
  assert.equal(result.selectedVehicles, 150);
  assert.equal(result.readBidRows, 300);
  assert.equal(result.exclusionReasons['terminal bid does not reproduce hammer'], 1);
  assert.equal(result.marketDenominator, null);
  assert.equal(source.calls.filter(c => c.kind === 'parents').length, 4);
  assert.ok(source.calls.filter(c => c.kind === 'bids').length > 8);
});

test('request budget preserves the parent cursor and existing output; resume keeps the original scope', async t => {
  const options = await setup(t), source = reader(fixtures());
  await fs.writeFile(options.output, 'existing artifact');
  const first = await capturePopulation({ ...options, reader:source, maxRequests:2 });
  assert.equal(first.complete, false);
  assert.equal(first.parentsComplete, false);
  assert.equal(first.selectedEpisodes, 100);
  assert.equal(first.output, null);
  assert.equal(await fs.readFile(options.output, 'utf8'), 'existing artifact');
  const calls = source.calls.length;
  const resumed = await capturePopulation({ ...options, before:undefined, reader:source, maxRequests:1000 });
  assert.equal(source.calls[calls].after, uuid('1', 100));
  assert.equal(resumed.scope.before, cutoff);
  assert.equal(resumed.selectedEpisodes, 150);
  assert.equal(resumed.complete, true);
});

test('an interrupted child page resumes by UUID instead of truncating or duplicating the sequence', async t => {
  const options = await setup(t), data = fixtures(4, 9), source = reader(data, 10);
  const first = await capturePopulation({ ...options, reader:source, maxRequests:4 });
  assert.equal(first.phase, 'bids');
  assert.equal(first.complete, false);
  assert.equal(await exists(options.output), false);
  const calls = source.calls.length;
  const result = await capturePopulation({ ...options, reader:source, maxRequests:1000 });
  assert.equal(source.calls[calls].after, uuid('2', 20));
  assert.equal(result.readBidRows, 36);
  assert.equal(result.usableEpisodes, 4);
});

test('parent timeouts reduce transport work and persist the same population cursor', async t => {
  const options = await setup(t), source = reader(fixtures(4));
  const original = source.parents;
  source.parents = async request => {
    if (request.limit > 125) { const error = new Error('timeout'); error.code = '57014'; throw error; }
    return original(request);
  };
  const first = await capturePopulation({ ...options, reader:source, maxRequests:2 });
  assert.equal(first.complete, false);
  assert.equal(first.selectedEpisodes, 0);
  assert.equal((await manifest(options)).parentPageSize, 125);
  const complete = await capturePopulation({ ...options, reader:source });
  assert.equal(complete.selectedEpisodes, 4);
  assert.equal(complete.usableEpisodes, 4);
  assert.ok(source.calls.filter(c => c.kind === 'parents').every(c => c.limit === 125));
});

test('more than8000children remain resumable and complete rather than hitting the old batch ceiling', async t => {
  const options = await setup(t), source = reader(fixtures(2, 4501), 1000);
  const result = await capturePopulation({ ...options, reader:source, maxRequests:100 });
  assert.equal(result.readBidRows, 9002);
  assert.equal(result.usableEpisodes, 2);
  assert.equal(source.calls.filter(c => c.kind === 'bids').length, 11);
});

test('a later API failure retains only acknowledged pages and cannot publish a partial output', async t => {
  const options = await setup(t), source = reader(fixtures(4, 9), 10);
  const original = source.bids;
  source.bids = async request => { if (request.after) throw new Error('unavailable'); return original(request); };
  await assert.rejects(capturePopulation({ ...options, reader:source }), /unavailable/);
  assert.equal((await manifest(options)).groups[0].pages.length, 1);
  assert.equal(await exists(options.output), false);
  source.bids = original;
  assert.equal((await capturePopulation({ ...options, reader:source })).readBidRows, 36);
});

test('timeouts separate expensive episodes without dropping earlier raw evidence or changing population', async t => {
  const options = await setup(t), source = reader(fixtures(4, 2));
  const original = source.bids;
  source.bids = async request => {
    if (request.ids.length > 2 && request.after) { const error = new Error('timeout'); error.code = '57014'; throw error; }
    return original(request);
  };
  const result = await capturePopulation({ ...options, reader:source });
  const m = await manifest(options);
  assert.equal(result.selectedEpisodes, 4);
  assert.equal(result.usableEpisodes, 4);
  assert.equal(result.readBidRows, 8);
  assert.equal(result.supersededGroups, 1);
  assert.equal(m.superseded[0].pages.length, 1);
  assert.equal(await exists(path.join(options.cache, m.superseded[0].pages[0].file)), true);
});

test('completed offline replay preserves retrieval clocks, input hashes and output bytes without new reads', async t => {
  const options = await setup(t), first = await capturePopulation({ ...options, reader:reader(fixtures(2)) });
  const bytes = await fs.readFile(options.output, 'utf8');
  const second = await capturePopulation({ ...options, reader:{ parents:()=>assert.fail('new read'), bids:()=>assert.fail('new read') } });
  assert.equal(second.requests, 0);
  assert.equal(second.completedAt, first.completedAt);
  assert.equal(second.inputHash, first.inputHash);
  assert.equal(second.outputHash, first.outputHash);
  assert.equal(second.outputBytes, Buffer.byteLength(bytes));
  assert.equal(await fs.readFile(options.output, 'utf8'), bytes);
});

test('scope changes, mutated cached bytes and false completion are rejected before publication', async t => {
  const options = await setup(t), source = reader(fixtures(2));
  await capturePopulation({ ...options, reader:source, maxRequests:1 });
  const calls = source.calls.length;
  await assert.rejects(capturePopulation({ ...options, from:'2020-01-01T00:00:00Z', reader:source }), /scope/);
  assert.equal(source.calls.length, calls);
  const m = await manifest(options);
  m.parentsComplete = true;
  await fs.writeFile(path.join(options.cache, 'capture.json'), JSON.stringify(m));
  await assert.rejects(capturePopulation({ ...options, reader:source }), /terminal empty page/);
  m.parentsComplete = false;
  await fs.writeFile(path.join(options.cache, 'capture.json'), JSON.stringify(m));
  const page = path.join(options.cache, m.parents[0].file);
  await fs.appendFile(page, ' ');
  await assert.rejects(capturePopulation({ ...options, reader:source }), /hash changed/);
  assert.equal(await exists(options.output), false);
});

test('method refresh is explicit, records the former hash and preserves cached retrieval clocks', async t => {
  const options = await setup(t), first = await capturePopulation({ ...options, reader:reader(fixtures(2)) });
  const m = await manifest(options);
  m.foldHash = 'previous_operator_source';
  await fs.writeFile(path.join(options.cache, 'capture.json'), JSON.stringify(m));
  const offline = { parents:()=>assert.fail('new read'), bids:()=>assert.fail('new read') };
  await assert.rejects(capturePopulation({ ...options, reader:offline }), /source changed/);
  const refreshed = await capturePopulation({ ...options, reader:offline, refreshMethod:true });
  assert.equal(refreshed.requests, 0);
  assert.equal(refreshed.completedAt, first.completedAt);
  assert.equal(refreshed.methodHistory[0].hash, 'previous_operator_source');
});

test('forged completion cannot turn interrupted selection into a complete budget receipt', async t => {
  const options = await setup(t), source = reader(fixtures(2));
  await capturePopulation({ ...options, reader:source, maxRequests:1 });
  const m = await manifest(options);
  m.completedAt = cutoff;
  await fs.writeFile(path.join(options.cache, 'capture.json'), JSON.stringify(m));
  const calls = source.calls.length;
  await assert.rejects(capturePopulation({ ...options, reader:source, maxRequests:1 }), /completion requires/);
  assert.equal(source.calls.length, calls);
  assert.equal(await exists(options.output), false);
});

test('output cannot replace the live lock or capture manifest', async t => {
  for (const filename of ['capture.lock', 'capture.json']) {
    const options = await setup(t), source = reader(fixtures(2));
    await assert.rejects(capturePopulation({ ...options, output:path.join(options.cache, filename), reader:source }), /cannot replace capture evidence/);
    assert.equal(source.calls.length, 0);
  }
});

test('wrong public parent, scope and duplicate continuation fail closed', async t => {
  for (const mutate of [data => { data.parents[0].vehicles.is_public = false; },
    data => { data.parents[0].auction_end_date = cutoff; },
    data => { data.parents[1].id = data.parents[0].id; }]) {
    const options = await setup(t), data = fixtures(2); mutate(data);
    await assert.rejects(capturePopulation({ ...options, reader:reader(data) }), /boundary|scope/);
    assert.equal(await exists(options.output), false);
  }
});

test('a live capture lock is not expired by age; missing-process evidence permits crash recovery', async t => {
  const options = await setup(t);
  await fs.mkdir(options.cache);
  const lock = path.join(options.cache, 'capture.lock');
  await fs.writeFile(lock, JSON.stringify({ pid:process.pid, host:os.hostname(), at:'1900-01-01' }));
  await assert.rejects(capturePopulation({ ...options, reader:reader(fixtures(2)) }), /still live/);
  await fs.writeFile(lock, JSON.stringify({ pid:2147483646, host:os.hostname() }));
  assert.equal((await capturePopulation({ ...options, reader:reader(fixtures(2)) })).complete, true);
  assert.equal(await exists(lock), false);
});

test('public adapter repeats parent gates, fixed clocks, keyed child selection and bounded continuation', async () => {
  const reads = [];
  const db = { from:table => {
    const calls = [], q = { then:fn => Promise.resolve({ data:[], error:null }).then(fn) };
    reads.push({ table, calls });
    for (const method of ['select','in','eq','gte','lt','is','or','order','limit','gt','abortSignal']) q[method] = (...args) => { calls.push([method, args]); return q; };
    return q;
  } };
  const r = populationReader(db), scope = { sources:['bat','bringatrailer'], from:'2016-01-01', before:cutoff };
  await r.parents({ scope, after:uuid('1', 4) });
  await r.bids({ scope, ids:[uuid('1', 4)], after:uuid('2', 4) });
  for (const read of reads) {
    assert.ok(read.calls.some(([method, args]) => method === 'eq' && args[0] === 'vehicles.is_public' && args[1] === true));
    assert.ok(read.calls.some(([method, args]) => method === 'is' && args[0] === 'vehicles.deleted_at' && args[1] === null));
    assert.ok(read.calls.some(([method, args]) => method === 'or' && args[0] === 'listing_kind.is.null,listing_kind.neq.non_vehicle_item' && args[1].referencedTable === 'vehicles'));
    assert.ok(read.calls.some(([method, args]) => method === 'lt' && args[0] === 'created_at' && args[1] === cutoff));
    assert.ok(read.calls.some(([method, args]) => method === 'gt' && args[0] === 'id'));
    assert.ok(read.calls.some(([method, args]) => method === 'abortSignal' && args[0] instanceof AbortSignal));
    assert.ok(read.calls.some(([method, args]) => method === 'select' && args[0].includes('vehicles!inner')));
  }
  assert.deepEqual(reads[0].calls.find(([method]) => method === 'limit')[1], [500]);
  assert.deepEqual(reads[1].calls.find(([method]) => method === 'limit')[1], [1000]);
  assert.ok(reads[1].calls.some(([method, args]) => method === 'in' && args[0] === 'auction_event_id' && args[1][0] === uuid('1', 4)));
});

test('CLI refuses privileged keys and missing private paths before making a network call', async t => {
  const options = await setup(t), cli = new URL('./build-stacks-study.mjs', import.meta.url);
  const refused = spawnSync(process.execPath, [cli.pathname, '--population', `--cache=${options.cache}`, `--output=${options.output}`],
    { encoding:'utf8', env:{ ...process.env, VITE_SUPABASE_ANON_KEY:'sb_secret_fixture_refused' } });
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /refuses secret API keys/);
  const missing = spawnSync(process.execPath, [cli.pathname, '--population'], { encoding:'utf8' });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /explicit private/);
});

test('SQL operator transport enforces anon identity, eligibility and typed boundaries without writes', async () => {
  const queries = [], scope = { sources:['bat','bringatrailer'], from:'2016-01-01', before:cutoff };
  let context = { role:'anon', requestRole:'anon', userId:null, rows:[] };
  const r = sqlPopulationReader(async q => { queries.push(q); return [{page:context}]; });
  await r.parents({ scope, after:uuid('1', 4), limit:250 });
  await r.bids({ scope, ids:[uuid('1', 4)], after:uuid('2', 4) });
  for (const q of queries) {
    assert.match(q, /^SET LOCAL ROLE anon;/);
    assert.match(q, /v\.is_public IS TRUE AND v\.deleted_at IS NULL AND v\.listing_kind IS DISTINCT FROM 'non_vehicle_item'/);
    assert.doesNotMatch(q, /\b(INSERT|UPDATE|DELETE|GRANT|ALTER|CREATE|DROP|TRUNCATE)\b/);
  }
  assert.match(queries[0], /ORDER BY ae.id LIMIT 250/);
  assert.match(queries[1], /ac.auction_event_id=ANY\(ARRAY\[/);
  assert.match(queries[1], /ORDER BY ac.id LIMIT 1000/);
  context = {...context, role:'postgres'};
  await assert.rejects(r.parents({scope}), /anonymous RLS context/);
  context = {role:'anon',requestRole:'anon',userId:uuid('3', 1),rows:[]};
  await assert.rejects(r.parents({scope}), /anonymous RLS context/);
  assert.throws(() => r.bids({scope,ids:["invalid'uuid"]}), /UUID/);
});
