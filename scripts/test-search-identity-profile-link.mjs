// Run with the existing project dependencies: node --test this-file.mjs
// Execute the actual edge handler and installed Supabase query builder against
// a synthetic fetch adapter; no credentials, remote imports or network calls.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const { createClient } = require('@supabase/supabase-js');
const source = readFileSync(new URL('../supabase/functions/search-identities/index.ts', import.meta.url), 'utf8');
const { outputText, diagnostics } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  reportDiagnostics: true,
});
assert.equal(diagnostics?.length ?? 0, 0, 'Edge handler must transpile');

const identities = [
  { id: 'id-bat', platform: 'bat', handle: 'shared' },
  { id: 'id-cb', platform: 'carsandbids', handle: 'shared' },
  { id: 'id-legacy', platform: 'bat', handle: 'shared-legacy' },
  { id: 'id-mismatch', platform: 'bat', handle: 'shared-mismatch' },
  { id: 'id-unseen', platform: 'bat', handle: 'shared-unseen' },
].map((row) => ({ ...row, claimed_by_user_id: null }));
const profiles = [
  { username: 'shared', external_identity_id: 'id-bat', total_comments: 9, total_bids: 3 },
  { username: 'shared-legacy', external_identity_id: null, total_comments: 8, total_bids: 2 },
  { username: 'shared-mismatch', external_identity_id: 'id-different', total_comments: 99 },
  { username: 'wrong-handle', external_identity_id: 'id-unseen', total_comments: 77 },
];

function handlerFixture({ failProfile = false, profileRows = profiles } = {}) {
  const requests = [];
  let handler;
  async function fixtureFetch(input) {
    const url = new URL(typeof input === 'string' ? input : input.url ?? input.href);
    requests.push(url);
    const table = url.pathname.split('/').at(-1);
    assert.ok(['external_identities', 'bat_user_profiles'].includes(table), 'Unexpected table request');
    if (table === 'bat_user_profiles' && failProfile) {
      return Response.json({ code: 'XX000', message: 'Synthetic profile query failure' }, { status: 400 });
    }
    let rows = table === 'external_identities' ? identities : profileRows;
    for (const [key, value] of url.searchParams) {
      if (value.startsWith('eq.')) rows = rows.filter((row) => row[key] === value.slice(3));
      if (value === 'is.null') rows = rows.filter((row) => row[key] == null);
      if (value.startsWith('ilike.')) {
        const needle = value.slice(6).replaceAll('%', '').toLowerCase();
        rows = rows.filter((row) => row[key].toLowerCase().includes(needle));
      }
    }
    return Response.json(rows);
  }
  runInNewContext(outputText, {
    exports: {}, Request, Response, console,
    Deno: {
      env: { get: (name) => name === 'SUPABASE_URL' ? 'https://fixture.invalid' : 'fixture-key' },
      serve: (callback) => { handler = callback; },
    },
    require: (specifier) => {
      assert.equal(specifier, 'https://esm.sh/@supabase/supabase-js@2');
      return { createClient: (url, key) => createClient(url, key, {
        global: { fetch: fixtureFetch }, auth: { persistSession: false, autoRefreshToken: false },
      }) };
    },
  });
  return { handler, requests };
}

test('actual reader follows UUID, allows only NULL-keyed legacy fallback, and isolates platforms', async () => {
  const { handler, requests } = handlerFixture();
  const response = await handler(new Request('https://fixture.invalid/search', {
    method: 'POST', body: JSON.stringify({ query: 'shared' }),
  }));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.results.find((row) => row.id === 'id-bat').stats.comments, 9);
  assert.equal(result.results.find((row) => row.id === 'id-legacy').stats.comments, 8);
  for (const id of ['id-cb', 'id-mismatch', 'id-unseen']) {
    assert.equal(result.results.find((row) => row.id === id).stats, null);
  }
  const reads = requests.filter((url) => url.pathname.endsWith('/bat_user_profiles'));
  assert.ok(reads.some((url) => url.searchParams.get('external_identity_id') === 'eq.id-bat'));
  assert.ok(!reads.some((url) => url.searchParams.get('external_identity_id') === 'eq.id-cb'));
  for (const url of reads) {
    assert.ok(url.searchParams.has('username'), 'Both paths preserve exact source handle');
    assert.ok(url.searchParams.get('external_identity_id') === 'is.null' ||
      url.searchParams.get('external_identity_id').startsWith('eq.'));
  }
  assert.ok(!reads.some((url) => url.searchParams.get('username') === 'eq.shared' &&
    url.searchParams.get('external_identity_id') === 'is.null'));
});

test('profile query failure is visible instead of silently returning disconnected stats', async () => {
  const { handler } = handlerFixture({ failProfile: true });
  const response = await handler(new Request('https://fixture.invalid/search', {
    method: 'POST', body: JSON.stringify({ query: 'shared', platform: 'bat' }),
  }));
  assert.equal(response.status, 500);
  assert.match((await response.json()).error, /Synthetic profile query failure/);
});

test('unknown and legacy metrics remain unknown; published coverage qualifies measured zero', async () => {
  const profileRows = [
    { username: 'shared', external_identity_id: 'id-bat', total_comments: null,
      total_bids: null, total_wins: 9, expertise_score: 0, community_trust_score: 0 },
    { username: 'shared-legacy', external_identity_id: null, total_comments: 3,
      total_bids: 1, total_wins: null, community_trust_score: null,
      metadata: { bat_bidder_record: { method: 'published_buyer_v1',
        observed_bid_presentations: 1, eligible_closed_presentations: 0,
        unknown_outcome_presentations: 1, unlinked_presentations: 0,
        refreshed_at: '2026-10-04T04:00:00Z' } } },
    { username: 'shared-unseen', external_identity_id: 'id-unseen', total_comments: 3,
      total_bids: 1, total_wins: 0, community_trust_score: 0,
      metadata: { bat_bidder_record: { method: 'published_buyer_v1',
        observed_bid_presentations: 2, eligible_closed_presentations: 1,
        unknown_outcome_presentations: 1, unlinked_presentations: 0 } } },
  ];
  const { handler } = handlerFixture({ profileRows });
  const response = await handler(new Request('https://fixture.invalid/search', {
    method: 'POST', body: JSON.stringify({ query: 'shared' }),
  }));
  assert.equal(response.status, 200);
  const result = await response.json();
  const legacy = result.results.find((row) => row.id === 'id-bat').stats;
  for (const field of ['comments', 'bids', 'wins', 'expertise_score', 'trust_score', 'source_like_points']) {
    assert.equal(legacy[field], null, `${field} must not invent a measured zero`);
  }
  assert.equal(legacy.basis.counts, 'legacy_baseline_unreplayed');
  assert.equal(legacy.basis.coverage, null);
  const unknown = result.results.find((row) => row.id === 'id-legacy').stats;
  assert.equal(unknown.wins, null, 'No eligible outcome means no known win/loss count');
  assert.equal(unknown.basis.coverage.unknown_outcome_presentations, 1);
  assert.equal(unknown.basis.record_refreshed_at, '2026-10-04T04:00:00Z');
  const measured = result.results.find((row) => row.id === 'id-unseen').stats;
  assert.equal(measured.wins, 0, 'Measured zero is retained within the eligible observed population');
  assert.equal(measured.source_like_points, 0);
  assert.equal(measured.trust_score, null, 'Source likes never become calibrated trust');
  assert.equal(measured.basis.coverage.eligible_closed_presentations, 1);
});
