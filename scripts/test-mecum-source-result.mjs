#!/usr/bin/env node
// Actual existing-owner pure code; synthetic fixtures only in the repository.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash, createHmac, webcrypto } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

const require = createRequire(resolve('nuke_frontend/package.json'));
const ts = require('typescript');
const { parse: parseHtml } = require('parse5');
assert.equal(JSON.parse(readFileSync(resolve(dirname(require.resolve('parse5')), '../../package.json'), 'utf8')).version,
  '7.3.0', 'Installed parser matches the pinned edge import');
const owner = 'supabase/functions/extract-mecum/index.ts';
const source = readFileSync(owner, 'utf8');
const ast = ts.createSourceFile(owner, source, ts.ScriptTarget.Latest, true);
const functions = new Set(['parseMecumSourceResultCandidate', 'parseNextData', 'parseBlocksDescription', 'getEdgeName', 'titleCase']);
const statements = ast.statements.filter(s => ts.isFunctionDeclaration(s) && functions.has(s.name?.text)
  || ts.isVariableStatement(s) && s.declarationList.declarations.some(d => d.name.getText(ast) === 'MECUM_SOURCE_RESULT_PARSER_VERSION'));
assert.equal(statements.length, 6, 'Load exact actual-owner pure dependency closure');
// Importing the complete edge entrypoint would execute Deno.serve. Compile only
// actual pure declarations, with no remote imports, fetch/writer or serve code.
const isolated = ts.createPrinter().printFile(ts.factory.updateSourceFile(ast, statements))
  + '\nconst parseHtml = globalThis.__nukeMecumTestHtmlParser;\nexport { parseNextData };';
const code = ts.transpileModule(isolated, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const previousDeno = globalThis.Deno, previousFetch = globalThis.fetch;
const previousHtmlParser = globalThis.__nukeMecumTestHtmlParser;
globalThis.__nukeMecumTestHtmlParser = parseHtml;
globalThis.Deno = { serve() { throw Error('Offline import executed Deno.serve'); } };
globalThis.fetch = () => { throw Error('Offline import made a network call'); };
let loaded;
try { loaded = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64')); }
finally { globalThis.Deno = previousDeno; globalThis.fetch = previousFetch; globalThis.__nukeMecumTestHtmlParser = previousHtmlParser; }
const { parseMecumSourceResultCandidate: parse, parseNextData: legacy } = loaded;
const taxonomy = (...values) => ({ edges: values.map(([name, slug = name]) => ({ node: { name, slug } })) });
const base = () => ({ title: '2000 Synthetic Example', databaseId: 999999, uri: '/lots/synthetic-source/', lotNumber: 'X1',
  hammerPrice: '12345', hideHammerPrice: '', hideSaleResult: '', saleResults: taxonomy(['sold']),
  runDates: taxonomy(['2020-06-15']), auctionDayStart: '2020-06-15 05:00:00',
  description: 'PRIVATE_UNREVIEWED_PROSE', vinSerial: 'PRIVATE_TEST_IDENTIFIER' });
const html = post => `<script type="application/json" id="__NEXT_DATA__">${JSON.stringify({ props: { pageProps: { post } } })}</script>`;
const result = changes => parse(html({ ...base(), ...changes }));
const refuses = (r, reason) => { assert.equal(r.qualified, false); assert(r.refusalReasons.includes(reason), JSON.stringify(r.refusalReasons)); };

test('well-formed sold source remains an unqualified candidate with original field paths and schedule grain', () => {
  const r = result({});
  assert.equal(r.status, 'candidate'); assert.equal(r.saleResult, 'sold'); assert.equal(r.reportedAmount, 12345);
  assert.equal(r.amountPath, 'props.pageProps.post.hammerPrice'); assert.equal(r.saleResults.path, 'props.pageProps.post.saleResults');
  assert.equal(r.scheduledRunDay, '2020-06-15'); assert.equal(r.scheduledRunDayBasis, 'source_runDates_schedule');
  assert.equal(r.auctionSchedule.value, '2020-06-15 05:00:00'); assert.equal(r.auctionSchedule.explicitZone, false);
  assert.equal(r.saleEventDay, null); assert.equal(r.currency, null); assert.equal(r.priceBasis, null);
  assert.equal(r.qualified, false); assert.equal(r.publicShareable, false);
  for (const gap of ['currency_unestablished', 'price_basis_unestablished', 'sale_event_clock_unestablished', 'parent_custody_not_evaluated']) refuses(r, gap);
  assert(!JSON.stringify(r).includes('PRIVATE_'), 'No description/VIN/contact/prose fields escape allowlist');
});
test('positive bid-goes-on source is retained without becoming a sold result', () => {
  const r = result({ saleResults: taxonomy(['bid-goes-on']) });
  assert.equal(r.saleResult, 'bid_goes_on'); assert.equal(r.reportedAmount, 12345);
  refuses(r, 'source_result_is_not_confirmed_sold');
});
test('unestablished unit/fee paths and dollar syntax cannot confer USD or buyer-total meaning', () => {
  const r = result({ currency: 'USD', buyerPremium: 10, priceType: 'buyer_total' });
  assert.equal(r.currency, null); assert.equal(r.priceBasis, null); assert.equal(r.qualified, false);
});
test('repeated agreeing taxonomy retains both source claims without inventing two events', () => {
  const r = result({ saleResults: taxonomy(['Sold', 'sold'], ['sold', 'sold']) });
  assert.equal(r.saleResults.claims.length, 2); assert.equal(r.saleResult, 'sold');
});
test('conflicting sale edges are preserved rather than first-edge selection', () => {
  const r = result({ saleResults: taxonomy(['sold'], ['bid-goes-on']) });
  assert.equal(r.saleResult, 'conflicting'); assert.equal(r.saleResults.claims.length, 2); refuses(r, 'sale_result_claims_conflict');
});
test('name/slug disagreement is preserved as conflict', () => {
  const r = result({ saleResults: taxonomy(['Sold', 'bid-goes-on']) });
  assert.equal(r.saleResult, 'conflicting'); refuses(r, 'sale_result_claims_conflict');
});
test('unknown and prototype-named statuses never become sold', () => {
  for (const label of ['withdrawn-unknown', 'constructor', 'toString', '__proto__']) {
    const r = result({ saleResults: taxonomy([label]) }); assert.equal(r.saleResult, 'unknown'); refuses(r, 'sale_result_unsupported');
  }
});
test('an incomplete sibling prevents a complete first edge from deciding the result', () => {
  const r = result({ saleResults: { edges: [...taxonomy(['sold']).edges, { node: null }] } });
  assert.equal(r.saleResult, 'unknown'); assert.equal(r.saleResults.claims.length, 2);
  assert.equal(r.saleResults.claims[1].incomplete, true); refuses(r, 'sale_result_claims_incomplete');
});
for (const [label, value, state] of [['null', null, 'null'], ['invalid', 3, 'invalid'], ['missing edges', {}, 'edges_missing'],
  ['null edges', { edges: null }, 'edges_null'], ['invalid edges', { edges: {} }, 'invalid'], ['empty edges', { edges: [] }, 'empty']]) {
  test(`missing source taxonomy state remains explicit: ${label}`, () => {
    const r = result({ saleResults: value }); assert.equal(r.saleResults.state, state); refuses(r, 'sale_result_claims_incomplete');
  });
}
test('absent taxonomy stays missing rather than empty/zero or sold', () => {
  const post = base(); delete post.saleResults; const r = parse(html(post));
  assert.equal(r.saleResults.state, 'missing'); assert.equal(r.saleResult, 'unknown'); refuses(r, 'sale_result_claims_incomplete');
});
test('hidden price is withheld and hidden result stays unknown', () => {
  const price = result({ hideHammerPrice: true }); assert.equal(price.reportedAmount, null); refuses(price, 'source_price_hidden');
  const status = result({ hideSaleResult: '1' }); assert.equal(status.saleResult, 'unknown'); refuses(status, 'source_result_hidden');
});
test('unestablished visibility flags refuse without exposing nominal price', () => {
  const post = base(); delete post.hideHammerPrice; delete post.hideSaleResult; const r = parse(html(post));
  assert.equal(r.reportedAmount, null); assert.equal(r.saleResult, 'unknown'); assert.equal(r.visibility.price, 'unknown');
  refuses(r, 'source_price_visibility_unestablished'); refuses(r, 'source_result_visibility_unestablished');
});
test('run-date disagreement keeps both claims and no chosen day', () => {
  const r = result({ runDates: taxonomy(['2020-06-15'], ['2020-06-16']) });
  assert.equal(r.scheduledRunDay, null); assert.equal(r.runDates.claims.length, 2); refuses(r, 'scheduled_run_days_conflict');
});
test('source run-date name/slug disagreement cannot become an auction-close instant', () => {
  const r = result({ runDates: taxonomy(['2020-06-15', '2020-06-16']) });
  assert.equal(r.scheduledRunDay, null); assert.equal(r.saleEventDay, null); refuses(r, 'scheduled_run_days_conflict');
});
test('invalid civil date, descriptive date and missing run edge are unestablished', () => {
  for (const value of ['2025-02-30', 'June 15, 2020']) { const r = result({ runDates: taxonomy([value]) }); assert.equal(r.scheduledRunDay, null); refuses(r, 'scheduled_run_day_unsupported'); }
  refuses(result({ runDates: { edges: [{ node: { name: '2020-06-15' } }] } }), 'scheduled_run_claims_incomplete');
});
test('source civil day survives LA timezone and an explicit schedule zone still is not a sale clock', () => {
  const before = process.env.TZ; process.env.TZ = 'America/Los_Angeles';
  try { const r = result({ auctionDayStart: '2020-06-15T05:00:00Z' }); assert.equal(r.scheduledRunDay, '2020-06-15'); assert.equal(r.auctionSchedule.explicitZone, true); assert.equal(r.saleEventDay, null); }
  finally { if (before === undefined) delete process.env.TZ; else process.env.TZ = before; }
});
test('retained midnight name/slug labels reconcile to a civil run day without changing original claims', () => {
  const runDates = taxonomy(['2020-06-15 00:00:00', '2020-06-15-000000']);
  const r = result({ runDates });
  assert.equal(r.status, 'candidate'); assert.equal(r.scheduledRunDay, '2020-06-15');
  assert.deepEqual(r.runDates.claims, [{ index: 0, name: '2020-06-15 00:00:00', slug: '2020-06-15-000000', incomplete: false }]);
  assert.equal(r.saleEventDay, null); assert.equal(r.qualified, false);
  assert(!r.refusalReasons.includes('scheduled_run_day_unsupported'));
});
test('civil ISO and serialized siblings can agree; serialized disagreement remains unresolved', () => {
  assert.equal(result({ runDates: taxonomy(['2020-06-15 00:00:00', '2020-06-15']) }).scheduledRunDay, '2020-06-15');
  const r = result({ runDates: taxonomy(['2020-06-15 00:00:00', '2020-06-16-000000']) });
  assert.equal(r.scheduledRunDay, null); refuses(r, 'scheduled_run_days_conflict');
});
test('timestamp prefixes, nonmidnight labels, zones, invalid civil dates and swapped field forms refuse', () => {
  for (const [name, slug] of [
    ['2020-06-15 01:00:00', '2020-06-15-010000'],
    ['2020-06-15T00:00:00Z', '2020-06-15-000000'],
    ['2020-06-15 00:00:00+00:00', '2020-06-15-000000'],
    ['2020-06-15 00:00:00junk', '2020-06-15-000000'],
    ['2025-02-30 00:00:00', '2025-02-30-000000'],
    ['2020-06-15-000000', '2020-06-15 00:00:00'],
    [' 2020-06-15 00:00:00', '2020-06-15-000000'],
  ]) {
    const r = result({ runDates: taxonomy([name, slug]) });
    assert.equal(r.scheduledRunDay, null); refuses(r, 'scheduled_run_day_unsupported');
  }
});
test('leap-day serialization is valid while an incomplete sibling keeps schedule unknown', () => {
  assert.equal(result({ runDates: taxonomy(['2020-02-29 00:00:00', '2020-02-29-000000']) }).scheduledRunDay, '2020-02-29');
  const r = result({ runDates: { edges: [...taxonomy(['2020-06-15 00:00:00', '2020-06-15-000000']).edges, { node: null }] } });
  assert.equal(r.scheduledRunDay, null); refuses(r, 'scheduled_run_claims_incomplete');
});
test('unsafe, partial, formatted, fractional, nonfinite and zero amounts remain unknown', () => {
  for (const hammerPrice of ['12345junk', '12,345', '$12345', 'USD12345', '12345.50', '1e5', '-1', 'NaN', 'Infinity', 0, null, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    const r = result({ hammerPrice }); assert.equal(r.reportedAmount, null); refuses(r, 'source_amount_missing_or_unsupported');
  }
});
test('source missing/ambiguous/malformed containers never select one presentation', () => {
  for (const [body, reason, count] of [['', 'next_data_missing', 0], ['<script id="__NEXT_DATA__">{</script>', 'next_data_malformed', 1],
    [html(base()) + html({ ...base(), saleResults: taxonomy(['bid-goes-on']) }), 'source_presentations_ambiguous', 2],
    ['<script id="__NEXT_DATA__">{"props":{}}</script>', 'source_post_missing_or_invalid', 1]]) {
    const r = parse(body); assert.equal(r.nextDataScriptCount, count); assert.equal(r.reportedAmount, null); refuses(r, reason);
  }
});
test('single-quoted script ID works but a different data-id is not the source container', () => {
  assert.equal(parse(html(base()).replace('id="__NEXT_DATA__"', "id='__NEXT_DATA__'")).saleResult, 'sold');
  refuses(parse(html(base()).replace('id="__NEXT_DATA__"', 'data-id="__NEXT_DATA__"')), 'next_data_missing');
});
test('HTML closing-tag whitespace works and does not hide a second source presentation', () => {
  const spaced = html(base()).replace('</script>', '</ScRiPt \n\t>');
  assert.equal(parse(spaced).saleResult, 'sold');
  assert.equal(parse(html(base()).replace('</script>', '</script\t\n bar>')).saleResult, 'sold');
  refuses(parse(spaced + html(base())), 'source_presentations_ambiguous');
  refuses(parse(html(base()).replace('</script>', '</scripture>')), 'next_data_malformed');
});
test('actual HTML containers survive quoted attributes while comments and inactive template content stay out', () => {
  const quoted = html(base()).replace('type="application/json"', 'data-note="quoted > marker" type="application/json"');
  assert.equal(parse(quoted).saleResult, 'sold');
  assert.equal(parse('<!--' + html(base()) + '-->' + html(base())).nextDataScriptCount, 1);
  refuses(parse('<template>' + html(base()) + '</template>'), 'next_data_missing');
  refuses(parse('<svg>' + html(base()) + '</svg>'), 'next_data_missing');
});
test('UTF8 source size limit refuses without treating a prefix as the complete source', () => {
  refuses(parse('é'.repeat(2 ** 20 + 1)), 'source_body_invalid_or_over_limit');
});
test('default parser output remains unchanged, including existing permissive amount behavior', () => {
  const body = html({ ...base(), hammerPrice: '1000.50', saleResults: taxonomy(['bid-goes-on']) });
  const before = legacy(body, 'https://www.mecum.com/lots/synthetic-source/');
  refuses(parse(body), 'source_amount_missing_or_unsupported');
  assert.deepEqual(legacy(body, 'https://www.mecum.com/lots/synthetic-source/'), before);
  assert.equal(before.status, 'bid-goes-on'); assert.equal(before.sale_price, 1000);
});

// Complete actual handler + archive reader + auth guard, using the installed
// Supabase SDK against synthetic HTTP. Every write/crawl/inference path fails.
const { createClient } = require('@supabase/supabase-js');
const previewId = '00000000-0000-4000-8000-000000000002';
const previewUrl = 'https://www.mecum.com/lots/999999/synthetic-source';
const previewHtml = html({ ...base(), runDates: taxonomy(['2020-06-15 00:00:00', '2020-06-15-000000']) });
const hash = body => createHash('sha256').update(body).digest('hex');
function compile(file) {
  const { outputText, diagnostics } = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }, reportDiagnostics: true,
  });
  assert.equal(diagnostics?.length ?? 0, 0, `${file} transpiles`);
  return outputText;
}
const previewSources = new Map([
  ['extractor', compile(owner)],
  ['archive', compile('supabase/functions/_shared/archiveFetch.ts')],
  ['guard', compile('supabase/functions/_shared/writeGuard.ts')],
]);
function previewFixture(options = {}) {
  const requests = [], modules = new Map(), handlers = new Map();
  const bytes = options.bytes ?? previewHtml;
  const snapshot = { id: previewId, platform: 'mecum', listing_url: previewUrl,
    success: true, http_status: 200, html_sha256: hash(bytes),
    fetched_at: '2020-06-16T00:00:00.123456+00:00', created_at: '2020-06-16T00:00:00.234567+00:00',
    html: null, html_storage_path: 'mecum/synthetic-source.html', markdown: 'PRIVATE_MARKDOWN',
    markdown_storage_path: 'mecum/private-markdown.md', metadata: { private_note: 'PRIVATE_METADATA' },
    ...options.snapshot };
  const requestedId = snapshot.id;
  async function http(raw, init) {
    const req = raw instanceof Request ? raw : new Request(raw, init), url = new URL(req.url);
    const query = Object.fromEntries(url.searchParams);
    requests.push({ method: req.method, path: url.pathname, query });
    assert.equal(req.method, 'GET', 'No database/storage/queue/model writes');
    if (url.pathname === '/rest/v1/listing_page_snapshots') {
      assert.equal(query.id, 'eq.' + requestedId, 'Capture is pinned by primary key, never URL/latest alone');
      if (options.readError) return Response.json({ code: '57014', message: 'PRIVATE_DATABASE_ERROR' }, { status: 500 });
      const rawRead = query.select.includes('html_storage_path');
      if (rawRead) {
        assert.equal(query.listing_url, 'eq.' + snapshot.listing_url);
        assert.equal(query.platform, 'eq.mecum'); assert.equal(query.success, 'eq.true');
      }
      return Response.json(options.missing ? null : rawRead ? { ...snapshot, ...options.rawSnapshot } : snapshot);
    }
    if (url.pathname.startsWith('/storage/v1/object/')) {
      assert(url.pathname.endsWith('/listing-snapshots/' + snapshot.html_storage_path), 'No unrelated markdown download');
      return new Response(options.storageMissing ? null : bytes, { status: options.storageMissing ? 404 : 200 });
    }
    assert.fail('Unexpected source/intake/model/auth request: ' + url.pathname);
  }
  const supabase = createClient('https://fixture.invalid', 'svc-test', {
    global: { fetch: http }, auth: { persistSession: false, autoRefreshToken: false },
  });
  const env = { SUPABASE_URL: 'https://fixture.invalid', SUPABASE_SERVICE_ROLE_KEY: 'svc-test', SUPABASE_JWT_SECRET: 'test-jwt' };
  function load(name) {
    if (modules.has(name)) return modules.get(name);
    const exports = {}; modules.set(name, exports);
    runInNewContext(previewSources.get(name), {
      exports, URL, URLSearchParams, Request, Response, Headers, TextEncoder, TextDecoder, Uint8Array, Date,
      crypto: webcrypto, AbortSignal, atob, btoa, fetch: http,
      console: { log() {}, warn() {}, error() {} },
      Deno: { env: { get: key => env[key] }, serve: callback => handlers.set(name, callback) },
      require: specifier => {
        if (specifier.startsWith('https://esm.sh/@supabase/supabase-js@')) return { createClient: () => supabase };
        if (specifier === 'https://esm.sh/parse5@7.3.0') return { parse: parseHtml };
        if (specifier === '../_shared/archiveFetch.ts') return load('archive');
        if (specifier === '../_shared/writeGuard.ts') return load('guard');
        if (specifier === './apiKeyAuth.ts') return { hashApiKey: () => assert.fail('No API-key path') };
        if (specifier === './batFetcher.ts') return { fetchBatPage: () => assert.fail('No source fetch'), logFetchCost: () => assert.fail('No paid fetch'), isLoginPage: () => false };
        if (specifier === './hybridFetcher.ts') return { fetchPage: () => assert.fail('No source fetch') };
        if (specifier === './firecrawl.ts') return { firecrawlScrape: () => assert.fail('No paid fetch') };
        if (specifier === './batParser.ts') return { parseQualifiedBaTSale: () => assert.fail('No BaT qualification') };
        if (specifier === '../_shared/qualityGate.ts' || specifier === '../_shared/extractionQualityGate.ts') return { qualityGate: () => assert.fail('No extraction/write path') };
        if (specifier === '../_shared/pollutionDetector.ts') return { cleanVehicleFields: () => assert.fail('No profile mutation') };
        if (specifier === '../_shared/observationWriter.ts') return { writeObservation: () => assert.fail('No testimony intake') };
        assert.fail('Unexpected import: ' + specifier);
      },
    });
    return exports;
  }
  return { requests, snapshot,
    run: async (body = {}, token = 'svc-test') => {
      load('extractor');
      const response = await handlers.get('extractor')(new Request('https://fixture.invalid/extract-mecum', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
        body: JSON.stringify({ action: 'source_result_preview', snapshot_id: requestedId, ...body }),
      }));
      return { status: response.status, body: await response.json() };
    },
    archive: (opts = {}) => load('archive').readArchivedPage(previewUrl, opts),
  };
}
test('actual service-only retained source route returns a hash-verified civil day with zero writes', async () => {
  const f = previewFixture(), r = await f.run();
  assert.equal(r.status, 200); assert.equal(r.body.success, true);
  assert.equal(r.body.snapshot.id, previewId); assert.equal(r.body.snapshot.sourceSha256, hash(previewHtml));
  assert.equal(r.body.snapshot.sourceCapturedAt, f.snapshot.fetched_at); assert.equal(r.body.snapshot.sourceRecordedAt, f.snapshot.created_at);
  assert.equal(r.body.result.scheduledRunDay, '2020-06-15'); assert.equal(r.body.result.saleEventDay, null);
  assert.equal(r.body.result.reportedAmount, 12345); assert.equal(r.body.result.currency, null); assert.equal(r.body.result.priceBasis, null);
  assert.equal(r.body.parentBinding, 'not_evaluated'); assert.equal(r.body.writes, 0); assert.equal(r.body.model_calls, 0);
  assert.equal(r.body.qualified, false); assert.equal(r.body.publicShareable, false);
  assert(!JSON.stringify(r.body).includes('PRIVATE_')); assert.equal(f.requests.length, 3);
});
test('inline preview avoids storage; ordinary archive reads still return markdown', async () => {
  const f = previewFixture({ snapshot: { html: previewHtml } });
  assert.equal((await f.run()).body.success, true); assert.equal(f.requests.length, 2);
  const archive = await f.archive({ snapshotId: previewId, platform: 'mecum' }); assert.equal(archive.markdown, 'PRIVATE_MARKDOWN');
});
test('anonymous and signed-in callers cannot access protected preview source', async () => {
  const f = previewFixture(); assert.equal((await f.run({}, '')).status, 401); assert.equal(f.requests.length, 0);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ role: 'authenticated', sub: '00000000-0000-4000-8000-000000000001', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  const token = header + '.' + payload + '.' + createHmac('sha256', 'test-jwt').update(header + '.' + payload).digest('base64url');
  const user = previewFixture(), r = await user.run({}, token);
  assert.equal(r.status, 403); assert.equal(r.body.reason, 'service_role_required'); assert.equal(user.requests.length, 0);
});
test('write/queue/URL options and invalid capture selectors refuse before source access', async () => {
  for (const body of [{ dry_run: false }, { snapshot_id: 'not-uuid' }, { force: true }, { use_queue: true }, { url: previewUrl }, { vehicle_id: previewId }]) {
    const f = previewFixture(), r = await f.run(body);
    assert.equal(r.status, 400); assert.equal(r.body.writes, 0); assert.equal(f.requests.length, 0);
  }
});
test('absent capture or failed header read stays explicit without source fallback', async () => {
  for (const [options, reason, status] of [[{ missing: true }, 'source_capture_missing', 200], [{ readError: true }, 'source_header_read_failed', 503]]) {
    const f = previewFixture(options), r = await f.run();
    assert.equal(r.status, status); assert.equal(r.body.reason, reason); assert.equal(f.requests.length, 1);
    assert(!JSON.stringify(r.body).includes('PRIVATE_'));
  }
});
test('wrong source, failed capture and unestablished hash refuse before raw access', async () => {
  for (const snapshot of [{ platform: 'bat' }, { success: false }, { http_status: 403 }, { html_sha256: null },
    { listing_url: 'https://mecum.com.attacker.invalid/lots/999999/synthetic-source' },
    { listing_url: 'https://person:secret@mecum.com/lots/999999/synthetic-source' },
    { listing_url: 'https://mecum.com:8443/lots/999999/synthetic-source' },
    { listing_url: 'https://mecum.com/other/synthetic-source' }]) {
    const f = previewFixture({ snapshot }), r = await f.run();
    assert.equal(r.body.success, false); assert.equal(r.body.writes, 0); assert.equal(f.requests.length, 1);
  }
});
test('missing body, changed capture and hash conflict stay unavailable instead of crawling', async () => {
  for (const [options, reason] of [[{ storageMissing: true }, 'source_body_unavailable'],
    [{ rawSnapshot: { id: '00000000-0000-4000-8000-000000000003' } }, 'source_capture_changed_or_unavailable'],
    [{ rawSnapshot: { fetched_at: '2020-06-17T00:00:00Z' } }, 'source_capture_changed_or_unavailable'],
    [{ snapshot: { html: previewHtml + ' changed' } }, 'source_hash_conflict']]) {
    const f = previewFixture(options), r = await f.run();
    assert.equal(r.body.reason, reason); assert.equal(r.body.writes, 0);
  }
});
test('preview preserves schedule conflict and no-sale result even with a positive reported amount', async () => {
  const bytes = html({ ...base(), saleResults: taxonomy(['bid-goes-on']), runDates: taxonomy(['2020-06-15 00:00:00', '2020-06-16-000000']) });
  const f = previewFixture({ bytes }), r = await f.run();
  assert.equal(r.body.success, true); assert.equal(r.body.result.scheduledRunDay, null);
  assert.equal(r.body.result.saleResult, 'bid_goes_on'); assert.equal(r.body.result.reportedAmount, 12345);
  assert.equal(r.body.result.qualified, false); assert.equal(r.body.writes, 0);
  assert(r.body.result.refusalReasons.includes('scheduled_run_days_conflict'));
});

if (process.env.MECUM_WITNESS_HTML && process.env.MECUM_WITNESS_PIN && process.env.MECUM_WITNESS_OUTPUT) {
  test('optional private pinned capture reaches the actual preview consumer with verified source hash', async () => {
    const bytes = readFileSync(process.env.MECUM_WITNESS_HTML);
    const pin = JSON.parse(readFileSync(process.env.MECUM_WITNESS_PIN, 'utf8'));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), pin.html_sha256);
    assert.equal(pin.source_url, pin.listing_url); assert.equal(pin.snapshot_platform, 'mecum');
    const f = previewFixture({ bytes: bytes.toString('utf8'), snapshot: { id: pin.snapshot_id, listing_url: pin.listing_url,
      html_sha256: pin.html_sha256, fetched_at: pin.fetched_at, created_at: pin.snapshot_created_at } });
    const preview = await f.run(); assert.equal(preview.status, 200); assert.equal(preview.body.success, true);
    const r = preview.body.result; assert.equal(r.qualified, false); assert.equal(r.currency, null); assert.equal(r.priceBasis, null); assert.equal(r.saleEventDay, null);
    if (pin.expected_run_day) assert.equal(r.scheduledRunDay, pin.expected_run_day);
    assert.equal(preview.body.writes, 0); assert.equal(preview.body.snapshot.id, pin.snapshot_id);
    writeFileSync(process.env.MECUM_WITNESS_OUTPUT, JSON.stringify({ stage: 'local_retained_source_preview_consumer_replay', snapshotId: pin.snapshot_id,
      sourceHash: pin.html_sha256, sourceUrl: pin.listing_url, nativeCandidateStatus: pin.event_status,
      captureClock: pin.fetched_at, sourceRowCreatedClock: pin.snapshot_created_at,
      rawBodyReprinted: false, productionWritten: false, sourceFetched: false, syntheticHttpReads: f.requests.length,
      preview: preview.body }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  });
}
