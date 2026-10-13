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
const row = n => ({ id: `vehicle_${String(n).padStart(5, '0')}`, year: 2020, make: 'Porsche', model: 'GT3', relevance: 0.9,
  is_public: true, deleted_at: null, listing_kind: null });
const rows = count => Array.from({ length: count }, (_, i) => row(i));

// Evaluate the relevant PostgREST predicates against current parents. In
// particular, SQL NULL does not satisfy != and top-level OR calls replace one
// another here, so a gate cannot pass merely because its syntax was appended.
const splitClauses = expression => {
  let depth = 0, start = 0; const clauses = [];
  for (let i = 0; i < expression.length; i++) {
    if (expression[i] === '(') depth++;
    else if (expression[i] === ')') depth--;
    else if (expression[i] === ',' && depth === 0) { clauses.push(expression.slice(start, i)); start = i + 1; }
  }
  return [...clauses, expression.slice(start)];
};
const ilikeMatch = (value, pattern) => value != null && new RegExp(`^${String(pattern).split(/(%|_)/).map(part =>
  part === '%' ? '.*' : part === '_' ? '.' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('')}$`, 'i').test(String(value));
const matchesExpression = (v, expression) => {
  if (expression.startsWith('and(')) return splitClauses(expression.slice(4, -1)).every(clause => matchesExpression(v, clause));
  if (expression.startsWith('or(')) return splitClauses(expression.slice(3, -1)).some(clause => matchesExpression(v, clause));
  const [, field, operator, value] = expression.match(/^([a-z_]+)\.(is|neq|ilike)\.(.*)$/) || [];
  if (operator === 'is' && value === 'null') return v[field] == null;
  if (operator === 'neq') return v[field] != null && String(v[field]) !== value;
  if (operator === 'ilike') return ilikeMatch(v[field], value);
  throw new Error(`Unexpected fixture predicate: ${expression}`);
};
const applyPredicates = (values, q) => {
  const orExpression = q.ops.filter(op => op[0] === 'or').at(-1)?.[1];
  return values.filter(v => q.ops.every(([op, field, value, other]) => {
    if (op === 'eq') return v[field] === value;
    if (op === 'is') return value === null ? v[field] == null : v[field] === value;
    if (op === 'not' && value === 'is' && other === null) return v[field] != null;
    if (op === 'in') return value.includes(v[field]);
    if (op === 'ilike') return ilikeMatch(v[field], value);
    return true;
  }) && (!orExpression || splitClauses(orExpression).some(clause => matchesExpression(v, clause))));
};

function edgeFixture({ ranked = rows(305), direct = [], ilike = [], year = [], vin = [], deep = [], fuzzy = [], parents = [], missingIds = [], tags = [], owned = [],
  rankedError = () => false, enrichmentError = () => false, directError = false, ilikeError = false,
  verifiedUser = null, authThrows = false, eligibilityError = () => false } = {}) {
  const calls = [], allVehicles = new Map([...ranked, ...direct, ...ilike, ...year, ...vin, ...owned,
    ...deep.map(v => ({ ...v, id: v.vehicle_id })), ...fuzzy.map(v => ({ ...v, id: v.vehicle_id })), ...parents].map(v => [v.id, v]));
  for (const id of missingIds) allVehicles.delete(id);
  const respond = q => {
    calls.push(q);
    if (q.table === 'user_vehicle_links') return { data: owned.map(v => ({ vehicle_id: v.id })) };
    if (q.table === 'image_tags') return { data: tags };
    if (q.table !== 'vehicles') return { data: [] };
    const ids = q.ops.find(op => op[0] === 'in')?.[2];
    if (ids) return enrichmentError(q) || eligibilityError(q) ? { data: null, error: { message: 'enrichment/eligibility failure' } }
      : { data: applyPredicates(ids.map(id => allVehicles.get(id)).filter(Boolean), q) };
    const source = q.ops.some(op => op[0] === 'textSearch') ? direct
      : q.ops.some(op => op[0] === 'ilike' && op[1] === 'vin') ? vin
      : q.ops.some(op => op[0] === 'eq' && op[1] === 'year') ? year : ilike;
    const failure = source === direct ? directError : source === ilike ? ilikeError : false;
    if (failure) return { data: null, error: { message: 'reader failure' } };
    const range = q.ops.find(op => op[0] === 'range');
    const limit = q.ops.find(op => op[0] === 'limit');
    const eligible = applyPredicates(source, q);
    return { data: range ? eligible.slice(range[1], range[2] + 1) : eligible.slice(0, limit?.[1] ?? eligible.length) };
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
      for (const method of ['select', 'eq', 'is', 'not', 'ilike', 'contains', 'in', 'or', 'order', 'range', 'limit', 'textSearch'])
        builder[method] = (...args) => { q.ops.push([method, ...args]); return builder; };
      builder.then = (resolve, reject) => Promise.resolve().then(() => respond(q)).then(resolve, reject);
      return builder;
    },
    async rpc(name, args) {
      calls.push({ rpc: name, args });
      if (name === 'search_vehicles_fts') return rankedError(args) ? { data: null, error: { message: 'ranked timeout' } }
        : { data: ranked.slice(args.offset_count || 0, (args.offset_count || 0) + args.limit_count) };
      if (name === 'search_vehicles_deep') return { data: deep };
      if (name === 'search_vehicles_fuzzy') return { data: fuzzy };
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

test('mixed display sorting preserves non-UUID candidate rank across first and later pages', async () => {
  const ranked = rows(205).reverse().map((v, i) => ({ ...v, primary_image_url: i % 2 ? 'https://example.invalid/image' : null }));
  const f = edgeFixture({ ranked, tags: Array.from({ length: 10 }, (_, i) => ({ tag_name: `tag_${i}`, confidence: 1000 })) });
  const seen = [];
  let offset = 0, source;
  do {
    const result = await f.search({ offset, vehicle_source: source });
    assert.equal(result.status, 200);
    seen.push(...result.results.filter(r => r.type === 'vehicle').map(r => r.id));
    if (!offset) assert.equal(result.results.length, 100);
    offset = result.meta.next_offset; source = result.meta.vehicle_source;
  } while (offset !== null);
  assert.deepEqual(seen, ranked.map(v => v.id));
  const only = await f.search({ types: ['vehicle'] });
  assert.deepEqual(only.results.map(v => v.id), ranked.slice(0, 100).map(v => v.id));
});

test('restoring reader order retains supplement positions and skips absent primary candidates', () => {
  const first = row(2), second = row(1), supplement = { id: 'supplement' };
  const result = preservePrimaryPage([supplement, second, first, first], new Set(['absent', first.id, second.id]), 3);
  assert.deepEqual(result, [supplement, first, second]);
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

test('VIN exact/partial, year and direct readers enforce all public gates while admitting NULL listing kinds', async () => {
  const vin = '1HGCM82633A004352';
  const candidates = rows(6).map(v => ({ ...v, vin }));
  candidates[0].is_public = false;
  candidates[1].deleted_at = '2026-10-13T00:00:00Z';
  candidates[2].listing_kind = 'non_vehicle_item';
  candidates[4].listing_kind = 'vehicle';
  candidates[5].is_public = null;
  for (const [options, request] of [
    [{ vin: candidates }, { query: vin }],
    [{ vin: candidates.map(v => ({ ...v, vin: `prefix${vin}` })) }, { query: vin }],
    [{ year: candidates }, { query: '2020' }],
    [{ direct: candidates, rankedError: () => true }, { query: 'porsche', types: ['vehicle'] }],
  ]) {
    const r = await edgeFixture(options).search(request);
    assert.equal(r.status, 200);
    assert.deepEqual(r.results.map(v => v.id), [row(3).id, row(4).id]);
  }
});

test('ILIKE composes eligibility, query, location and body groups without replacing the public gate', async () => {
  const candidates = rows(8).map(v => ({ ...v, city: 'Reno', body_style: 'coupe' }));
  candidates[0].is_public = false;
  candidates[1].deleted_at = '2026-10-13T00:00:00Z';
  candidates[2].listing_kind = 'non_vehicle_item';
  candidates[4].listing_kind = 'vehicle';
  candidates[5].city = 'Seattle';
  candidates[6].body_style = 'sedan';
  candidates[7].make = 'Volvo'; candidates[7].model = '240';
  const f = edgeFixture({ ilike: candidates });
  const r = await f.search({ query: 'porsche gt3', vehicle_source: 'ilike', location: 'Reno', body_style: 'coupe' });
  assert.equal(r.status, 200); assert.deepEqual(r.results.map(v => v.id), [row(3).id, row(4).id]);
  const lookup = f.calls.find(c => c.table === 'vehicles' && !c.ops.some(op => op[0] === 'in'));
  assert.equal(lookup.ops.filter(op => op[0] === 'or').length, 1);
});

test('a fully ineligible stale ranked page retains raw candidate continuation without exposing payloads', async () => {
  const ranked = rows(101), parents = ranked.slice(0, 100).map((v, i) => ({ ...v,
    ...(i % 4 === 0 ? { is_public: false } : i % 4 === 1 ? { deleted_at: '2026-10-13T00:00:00Z' }
      : i % 4 === 2 ? { listing_kind: 'non_vehicle_item' } : { is_public: null }),
  }));
  const f = edgeFixture({ ranked, parents });
  const first = await f.search({ types: ['vehicle'] });
  assert.equal(first.status, 200); assert.deepEqual(first.results, []);
  assert.equal(first.meta.has_more, true); assert.equal(first.meta.next_offset, 100);
  assert.equal(first.meta.consumed_candidates, 100); assert.equal(first.meta.vehicle_source, 'ranked');
  const next = await f.search({ types: ['vehicle'], offset: 100, vehicle_source: 'ranked' });
  assert.deepEqual(next.results.map(v => v.id), [row(100).id]); assert.equal(next.meta.has_more, false);
});

test('deep/fuzzy payloads require current eligible parents, including current non-auto classification', async () => {
  for (const source of ['deep', 'fuzzy']) {
    const candidates = rows(6).map(v => ({ ...v, vehicle_id: v.id, match_source: 'comment', snippet: `snippet_${v.id}` }));
    const parents = rows(6);
    parents[0].is_public = false; parents[1].deleted_at = '2026-10-13T00:00:00Z';
    parents[2].listing_kind = 'non_vehicle_item'; parents[5].canonical_vehicle_type = 'BOAT';
    const f = edgeFixture({ ranked: [], [source]: candidates, parents, missingIds: [row(3).id] });
    const r = await f.search({ types: ['vehicle'] });
    assert.equal(r.status, 200); assert.deepEqual(r.results.map(v => v.id), [row(4).id]);
    for (const n of [0,1,2,3,5]) assert(!JSON.stringify(r).includes(`snippet_${row(n).id}`));
  }
});

test('deep/fuzzy eligibility lookup failures fail the page with no advanced/exhausted cursor', async () => {
  for (const source of ['deep', 'fuzzy']) {
    const f = edgeFixture({ ranked: [], [source]: [{ ...row(1), vehicle_id: row(1).id }], eligibilityError: () => true });
    const r = await f.search({ types: ['vehicle'] });
    assert.equal(r.status, 500); assert.equal(r.success, false); assert.deepEqual(r.results, []); assert.equal(r.meta, undefined);
  }
});

test('RPC over-return cannot expand deep/fuzzy current-parent validation beyond their bounded batches', async () => {
  for (const [source, bound] of [['deep', 20], ['fuzzy', 10]]) {
    const f = edgeFixture({ ranked: [], [source]: rows(bound + 5).map(v => ({ ...v, vehicle_id: v.id })) });
    const r = await f.search({ types: ['vehicle'] });
    assert.equal(r.status, 200); assert.equal(r.results.length, bound);
    const lookup = f.calls.find(c => c.table === 'vehicles' && c.ops.some(op => op[0] === 'in'));
    assert.equal(lookup.ops.find(op => op[0] === 'in')[2].length, bound);
  }
});

test('verified private-owned result survives but cannot receive a stale public deep/fuzzy payload', async () => {
  const owned = { ...row(999), is_public: false };
  const stale = { ...row(999), vehicle_id: owned.id, match_source: 'comment', snippet: 'unvalidated_private_snippet' };
  const f = edgeFixture({ ranked: [], owned: [owned], parents: [owned], deep: [stale], fuzzy: [stale], verifiedUser: 'verified_owner' });
  const r = await f.search({}, true);
  assert.equal(r.status, 200); assert.deepEqual(r.results.map(v => v.id), [owned.id]);
  assert.equal(r.results[0].relevance_score, 1.5);
  assert(!JSON.stringify(r).includes('unvalidated_private_snippet'));
});
