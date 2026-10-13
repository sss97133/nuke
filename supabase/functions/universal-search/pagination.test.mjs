import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

// Execute the actual edge handler offline. Use the repository's installed TS
// compiler, replacing only its network/rate-limit/Deno entry dependencies.
const require = createRequire(new URL('../../../nuke_frontend/package.json', import.meta.url));
const ts = require('typescript');
const compile = name => ts.transpileModule(readFileSync(new URL(name, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const helperModule = { exports: {} };
new Function('exports', compile('./pagination.ts'))(helperModule.exports);
const { candidatePage, preservePrimaryPage } = helperModule.exports;
const handlerCode = compile('./index.ts');
const row = n => ({ id: `vehicle_${String(n).padStart(5, '0')}`, year: 2020, make: 'Porsche', model: 'GT3', relevance: 0.9 });
const rows = count => Array.from({ length: count }, (_, i) => row(i));

function edgeFixture({ ranked = rows(305), direct = [], ilike = [], year = [], tags = [], owned = [],
  rankedError = () => false, enrichmentError = () => false, directError = false, ilikeError = false,
  verifiedUser = null, authThrows = false } = {}) {
  const calls = [], allVehicles = new Map([...ranked, ...direct, ...ilike, ...year, ...owned].map(v => [v.id, v]));
  const respond = q => {
    calls.push(q);
    if (q.table === 'user_vehicle_links') return { data: owned.map(v => ({ vehicle_id: v.id })) };
    if (q.table === 'image_tags') return { data: tags };
    if (q.table !== 'vehicles') return { data: [] };
    const ids = q.ops.find(op => op[0] === 'in')?.[2];
    if (ids) return enrichmentError(q) ? { data: null, error: { message: 'enrichment failure' } }
      : { data: ids.map(id => allVehicles.get(id)).filter(Boolean) };
    const source = q.ops.some(op => op[0] === 'textSearch') ? direct : q.ops.some(op => op[0] === 'eq' && op[1] === 'year') ? year : ilike;
    const failure = source === direct ? directError : source === ilike ? ilikeError : false;
    if (failure) return { data: null, error: { message: 'reader failure' } };
    const range = q.ops.find(op => op[0] === 'range');
    const limit = q.ops.find(op => op[0] === 'limit');
    return { data: range ? source.slice(range[1], range[2] + 1) : source.slice(0, limit?.[1] ?? source.length) };
  };
  const client = {
    auth: { async getUser(token) {
      calls.push({ auth: 'getUser', token });
      if (authThrows) throw new Error('Auth unavailable');
      return verifiedUser ? { data: { user: { id: verifiedUser } }, error: null }
        : { data: { user: null }, error: { message: 'Invalid token' } };
    } },
    from(table) {
      const q = { table, ops: [] }, builder = {};
      for (const method of ['select', 'eq', 'not', 'ilike', 'contains', 'in', 'or', 'order', 'range', 'limit', 'textSearch'])
        builder[method] = (...args) => { q.ops.push([method, ...args]); return builder; };
      builder.then = (resolve, reject) => Promise.resolve().then(() => respond(q)).then(resolve, reject);
      return builder;
    },
    async rpc(name, args) {
      calls.push({ rpc: name, args });
      if (name === 'search_vehicles_fts') return rankedError(args) ? { data: null, error: { message: 'ranked timeout' } }
        : { data: ranked.slice(args.offset_count || 0, (args.offset_count || 0) + args.limit_count) };
      return { data: [] };
    },
  };
  let handler;
  const dependency = name => {
    if (name === 'https://esm.sh/@supabase/supabase-js@2') return { createClient: () => client };
    if (name === './pagination.ts') return helperModule.exports;
    if (name === '../_shared/rateLimit.ts') return { checkRateLimit: async () => ({ allowed: true }), getClientIp: () => 'offline', rateLimitHeaders: () => ({}) };
    throw new Error(`Unexpected dependency ${name}`);
  };
  new Function('require', 'Deno', 'console', 'exports', handlerCode)(dependency,
    { env: { get: () => '' }, serve: value => { handler = value; } }, { error() {} }, {});
  return { calls, async search(body, authenticated = false) {
    const headers = { 'Content-Type': 'application/json' };
    if (authenticated) headers.Authorization = `Bearer ${typeof authenticated === 'string' ? authenticated : `fixture.${Buffer.from(JSON.stringify({ sub: 'untrusted_claim' })).toString('base64url')}.fixture`}`;
    const response = await handler(new Request('https://example.invalid/search', { method: 'POST', headers, body: JSON.stringify({ query: 'porsche', limit: 100, includeAI: false, ...body }) }));
    return { status: response.status, ...await response.json() };
  } };
}

test('mixed 94-vehicle first page and later pages cover every candidate with no gaps or repeated categories', async () => {
  const f = edgeFixture({ tags: Array.from({ length: 10 }, (_, i) => ({ tag_name: `porsche_${i}`, confidence: 100 })) });
  const seen = [];
  let offset = 0, source;
  do {
    const r = await f.search({ offset, vehicle_source: source });
    assert.equal(r.status, 200); assert.equal(r.total_count, null); assert.equal(r.meta.total_count, null);
    const vehicles = r.results.filter(v => v.type === 'vehicle');
    seen.push(...vehicles.map(v => v.id));
    if (offset === 0) { assert.equal(vehicles.length, 94); assert.equal(r.meta.next_offset, 94); assert.equal(r.results.length, 100); }
    else assert(r.results.every(v => v.type === 'vehicle'));
    source = r.meta.vehicle_source; offset = r.meta.next_offset;
  } while (offset !== null);
  assert.deepEqual(seen, rows(305).map(v => v.id));
  assert.equal(f.calls.filter(c => c.table === 'image_tags').length, 1);
  assert.equal(f.calls.filter(c => c.rpc === 'search_vehicles_deep' || c.rpc === 'search_vehicles_fuzzy').length, 0);
});

test('vehicle-only searches use all slots and page membership follows raw candidates through display filters', async () => {
  const vehicles = rows(205); vehicles[3].canonical_vehicle_type = 'BOAT'; vehicles[4].relevance = 0.8;
  const f = edgeFixture({ ranked: vehicles });
  const first = await f.search({ types: ['vehicle'] });
  assert.equal(first.results.length, 98); assert.equal(first.meta.next_offset, 100); assert.equal(first.meta.has_more, true);
  const second = await f.search({ types: ['vehicle'], offset: first.meta.next_offset, vehicle_source: first.meta.vehicle_source });
  assert.deepEqual(second.results.map(v => v.id), vehicles.slice(100, 200).map(v => v.id));
  assert.equal(second.meta.next_offset, 200);
  const last = await f.search({ types: ['vehicle'], offset: 200, vehicle_source: 'ranked' });
  assert.equal(last.results.length, 5); assert.equal(last.meta.has_more, false); assert.equal(last.meta.next_offset, null);
});

test('supplemental category and owned-vehicle ranking cannot evict any consumed primary ID', async () => {
  const f = edgeFixture({ verifiedUser: 'offline_user', owned: [row(304)], tags: Array.from({ length: 10 }, (_, i) => ({ tag_name: `tag_${i}`, confidence: 1000 })) });
  const r = await f.search({}, true);
  assert.equal(r.meta.next_offset, 94); assert.equal(r.results.length, 100);
  for (const v of rows(94)) assert(r.results.some(result => result.id === v.id));
  const later = await f.search({ offset: 94, vehicle_source: 'ranked' }, true);
  assert.deepEqual(later.results.map(v => v.id), rows(194).slice(94).map(v => v.id));
});

test('ILIKE replacement and direct fallback keep the same reader and stable tie-break on continuation', async () => {
  const ilike = edgeFixture({ ranked: [], ilike: rows(205) });
  const first = await ilike.search({ query: 'porsche gt3', types: ['vehicle'] });
  assert.equal(first.meta.vehicle_source, 'ilike'); assert.equal(first.meta.next_offset, 100);
  const next = await ilike.search({ query: 'porsche gt3', types: ['vehicle'], offset: 100, vehicle_source: first.meta.vehicle_source });
  assert.deepEqual(next.results.map(v => v.id), rows(200).slice(100).map(v => v.id));
  assert.equal(ilike.calls.filter(c => c.rpc === 'search_vehicles_fts').length, 1);
  assert(ilike.calls.filter(c => c.table === 'vehicles').every(c => c.ops.some(op => op[0] === 'order' && op[1] === 'id')));
  const direct = edgeFixture({ direct: rows(205), rankedError: () => true });
  const d1 = await direct.search({ types: ['vehicle'] });
  assert.equal(d1.meta.vehicle_source, 'direct');
  const d2 = await direct.search({ types: ['vehicle'], offset: d1.meta.next_offset, vehicle_source: 'direct' });
  assert.deepEqual(d2.results.map(v => v.id), rows(200).slice(100).map(v => v.id));
  assert.equal(direct.calls.filter(c => c.rpc === 'search_vehicles_fts').length, 1);
});

test('ranked, enrichment and continued fallback failures cannot issue an exhausted or advanced cursor', async () => {
  for (const [options, body] of [
    [{ rankedError: () => true, directError: true }, {}],
    [{ rankedError: args => args.offset_count > 0 }, { offset: 94, vehicle_source: 'ranked' }],
    [{ enrichmentError: () => true }, { offset: 94, vehicle_source: 'ranked' }],
    [{ directError: true }, { offset: 94, vehicle_source: 'direct' }],
    [{ ilikeError: true }, { query: 'porsche gt3', offset: 94, vehicle_source: 'ilike' }],
  ]) {
    const r = await edgeFixture(options).search(body);
    assert.equal(r.status, 500); assert.equal(r.success, false); assert.equal(r.meta, undefined);
  }
});

test('bare-year search uses an ordered candidate cursor and never repeats its first page', async () => {
  const f = edgeFixture({ year: rows(105) });
  const first = await f.search({ query: '2020' });
  assert.equal(first.meta.next_offset, 100); assert.equal(first.meta.vehicle_source, 'year');
  const next = await f.search({ query: '2020', offset: 100, vehicle_source: 'year' });
  assert.deepEqual(next.results.map(v => v.id), rows(105).slice(100).map(v => v.id));
  assert.equal(next.meta.has_more, false);
});

test('invalid or capped offsets are errors rather than silently clamped repeated pages', async () => {
  for (const body of [{ offset: 10001 }, { offset: -1 }, { offset: 1.5 }, { offset: 'NaN' }, { limit: 0 }, { vehicle_source: 'unknown' },
    { vehicle_source: 'year' }, { query: '2020', vehicle_source: 'ranked' }]) {
    const r = await edgeFixture().search(body); assert.equal(r.status, 400); assert.equal(r.success, false); assert.equal(r.meta, undefined);
  }
});

test('candidate lookahead and supplemental selection retain exact boundaries without a manufactured total', () => {
  const p = candidatePage(rows(101), 94, 100);
  assert.equal(p.consumed, 100); assert.equal(p.next_offset, 194); assert.equal(p.rows.at(-1).id, row(99).id);
  const results = [{ id: 'tag' }, ...rows(3)];
  assert.deepEqual(preservePrimaryPage(results, new Set(rows(3).map(v => v.id)), 3), rows(3));
});

test('offset ceiling reports unread candidates separately from exhausted pages, including year search', async () => {
  for (const query of ['porsche', '2020']) {
    const f = edgeFixture({ ranked: rows(10201), year: rows(10201) });
    const source = query === '2020' ? 'year' : 'ranked';
    const boundary = await f.search({ query, offset: 9900, vehicle_source: source });
    assert.equal(boundary.meta.next_offset, 10000); assert.equal(boundary.meta.pagination_limited, false);
    const limited = await f.search({ query, offset: 10000, vehicle_source: source });
    assert.equal(limited.status, 200); assert.equal(limited.meta.has_more, true);
    assert.equal(limited.meta.next_offset, null); assert.equal(limited.meta.pagination_limited, true);
    assert.equal(limited.results.length, 100); assert.equal(limited.meta.total_count, null);
  }
  const exhausted = await edgeFixture({ ranked: rows(10025) }).search({ offset: 10000, vehicle_source: 'ranked' });
  assert.equal(exhausted.meta.has_more, false); assert.equal(exhausted.meta.pagination_limited, false);
  assert.equal(exhausted.meta.next_offset, null);
});

test('forged, malformed, anonymous and unverifiable tokens never authorize owned-vehicle reads', async () => {
  for (const [token, authThrows] of [[true, false], ['malformed', false], [false, false], [true, true]]) {
    const f = edgeFixture({ owned: [{ ...row(999), is_public: false }], authThrows });
    const r = await f.search({}, token);
    assert.equal(r.status, 200); assert.equal(r.success, true);
    assert(!f.calls.some(c => c.table === 'user_vehicle_links'));
    assert(!f.calls.some(c => c.table === 'vehicles' && c.ops.some(op => op[0] === 'in' && op[2].includes(row(999).id))));
    assert(!r.results.some(v => v.id === row(999).id));
    assert.equal(f.calls.filter(c => c.auth === 'getUser').length, token ? 1 : 0);
  }
});

test('verified Auth identity, never the untrusted payload sub, authorizes the existing owned-vehicle boost', async () => {
  const f = edgeFixture({ verifiedUser: 'verified_owner', owned: [{ ...row(999), is_public: false }] });
  const r = await f.search({}, true);
  assert.equal(r.status, 200);
  const linkQuery = f.calls.find(c => c.table === 'user_vehicle_links');
  assert.deepEqual(linkQuery.ops.find(op => op[0] === 'eq'), ['eq', 'user_id', 'verified_owner']);
  assert(r.results.some(v => v.id === row(999).id));
  assert.equal(r.meta.next_offset, 94);
});
