import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VERSION, findExcerpts, sourceUrl, validateOptions, collectionSQL, collect,
  documentRegions, buildReport, renderReport, main } from './buying-evidence.mjs';
const ID = '11111111-1111-4111-8111-111111111111';
const ROW = '22222222-2222-4222-8222-222222222222';
const DATE = '2026-10-08T20:00:00.123456Z';
const options = { vehicleIds: [ID], query: null, pageSize: 2, maxPages: 3, seconds: 30 };
const sha = text => createHash('sha256').update(text).digest('hex');
const snapshot = { id: ROW, listing_url: 'https://bringatrailer.com/listing/test/',
  attested_vehicle_id: ID, vehicle_matched: 'true', success: true, http_status: 200, platform: 'bat',
  fetched_at: DATE, created_at: DATE,
  html: '<div class="post-excerpt"><p>The truck has 104k miles. The heater core was replaced in 2024. Stored outdoors since 2020.</p></div>' };
snapshot.html_sha256 = sha(snapshot.html);
const capture = rows => ({ schema_version: VERSION, options, started_at: DATE, ended_at: DATE,
  selection_cutoff: DATE, snapshot_semantics: 'separate_current_reads_not_historical_replay',
  vehicles: [{ id: ID, state: 'public_current_parent', mileage: 104000,
    collections: { comments: { state: 'exhausted_selected_scope', reason: null, pages: 2, rows } } }] });

test('questions, negation, hypothetical work and model generalizations stay exact search candidates', () => {
  const text = '😀 No rust was reported. Has the heater core been replaced? If I bought it, I would replace the clutch. These are million-mile trucks.';
  const { hits } = findExcerpts(text);
  assert.equal(hits.length, 4);
  for (const hit of hits) {
    assert.equal(Array.from(text).slice(hit.start, hit.end).join(''), hit.quote);
    assert.equal(hit.stage, 'lexical_candidate');
    assert.equal(hit.confidence, undefined);
  }
  assert.ok(hits[0].review_flags.includes('negation_or_unknown_language'));
  assert.ok(hits[1].review_flags.includes('question_present'));
  assert.ok(hits[2].review_flags.includes('conditional_or_uncertain_language'));
  assert.ok(hits[3].review_flags.includes('subject_scope_needs_review'));
});

test('literal query preserves decimals and does not execute regex supplied by the operator', () => {
  assert.equal(findExcerpts('Reported 94.5k miles. Rust free.', '94.5k').hits.length, 1);
  assert.equal(findExcerpts('Rust free.', '.*').hits.length, 0);
  assert.equal(findExcerpts('x'.repeat(32001)).state, 'oversized_or_invalid');
});

test('URL normalization preserves episode parameters and rejects executable schemes', () => {
  assert.equal(sourceUrl('https://example.com/lot/?id=2&utm_source=x#reply'), 'https://example.com/lot/?id=2');
  assert.equal(sourceUrl('javascript:alert(1)'), null);
});

test('input bounds reject SQL injection, duplicate subjects and unbounded pages', () => {
  assert.throws(() => validateOptions({ ...options, vehicleIds: ["'); DELETE FROM vehicles;"] }));
  assert.throws(() => validateOptions({ ...options, vehicleIds: [ID, ID] }));
  assert.throws(() => validateOptions({ ...options, pageSize: 201 }));
  assert.throws(() => validateOptions({ ...options, query: '' }));
  assert.throws(() => collectionSQL('comments', { id: ID }, DATE, 2, "'"));
});

test('every child read repeats public parent eligibility, finite timeout and clocks; unknowns survive', () => {
  for (const family of ['comments', 'observations', 'images', 'snapshots']) {
    const sql = collectionSQL(family, { id: ID, listing_url: snapshot.listing_url }, DATE, 2, ROW);
    assert.match(sql, /BEGIN READ ONLY/);
    assert.match(sql, /statement_timeout='5s'/);
    assert.match(sql, /is_public IS TRUE/);
    assert.match(sql, /deleted_at IS NULL/);
    assert.match(sql, /non_vehicle_item/);
    assert.match(sql, /123456Z/); // Do not round PostgreSQL clocks to milliseconds.
    assert.match(sql, /ORDER BY id LIMIT 2/);
  }
  assert.match(collectionSQL('images', { id: ID }, DATE, 2), /is_sensitive IS FALSE/);
  assert.match(collectionSQL('observations', { id: ID }, DATE, 2), /observation_is_public/);
  assert.match(collectionSQL('comments', { id: ID }, DATE, 2), /posted_at IS NULL/);
});

test('denied parent causes zero child queries', async () => {
  let calls = 0;
  const result = await collect(options, async () => { calls++; return []; });
  assert.equal(calls, 1);
  assert.equal(result.vehicles[0].state, 'parent_unavailable');
  assert.deepEqual(result.vehicles[0].collections, {});
});

test('short pages continue until empty, and clocks/hashes retain each exact read', async () => {
  const calls = [];
  const result = await collect(options, async sql => {
    calls.push(sql);
    if (sql.includes('SELECT id,year')) return [{ id: ID }];
    if (sql.includes('FROM public.auction_comments') && !sql.includes('AND id >'))
      return [{ id: ROW, vehicle_id: ID, comment_text: 'Needs repair.' }];
    return [];
  });
  assert.equal(result.vehicles[0].collections.comments.pages, 2);
  assert.equal(result.vehicles[0].collections.comments.state, 'exhausted_selected_scope');
  assert.equal(result.reads[0].rows_sha256.length, 64);
  assert.match(calls[2], new RegExp(ROW));
});

test('page budget, SQL failure and invalid parent/cursor remain incomplete, not zero evidence', async () => {
  const limited = await collect({ ...options, maxPages: 1 }, async sql => sql.includes('SELECT id,year')
    ? [{ id: ID }] : [{ id: ROW, vehicle_id: ID }]);
  assert.equal(limited.vehicles[0].collections.comments.state, 'partial');
  assert.equal(limited.vehicles[0].collections.comments.reason, 'page_budget');
  const failed = await collect(options, async sql => {
    if (sql.includes('SELECT id,year')) return [{ id: ID }];
    throw Error('secret private body must not escape');
  });
  assert.equal(failed.vehicles[0].collections.comments.reason, 'read_failed');
  assert.ok(!JSON.stringify(failed).includes('secret private'));
  const wrong = await collect(options, async sql => sql.includes('SELECT id,year')
    ? [{ id: ID }] : [{ id: ROW, vehicle_id: ROW }]);
  assert.equal(wrong.vehicles[0].collections.comments.reason, 'invalid_page');
  assert.equal(wrong.vehicles[0].collections.comments.rows.length, 0);
});

test('two failures of a family stop that reader even when independent collections succeed', async () => {
  const other = '33333333-3333-4333-8333-333333333333';
  const third = '44444444-4444-4444-8444-444444444444';
  let observationCalls = 0;
  const result = await collect({ ...options, vehicleIds: [ID, other, third] }, async sql => {
    if (sql.includes('SELECT id,year')) return [{ id: [ID, other, third].find(id => sql.includes(id)) }];
    if (sql.includes('FROM public.vehicle_observations')) { observationCalls++; throw Error('failure'); }
    return [];
  });
  assert.equal(observationCalls, 2);
  assert.equal(result.vehicles[2].collections.observations.reason, 'repeated_read_failure_stop');
  assert.equal(result.vehicles[2].collections.comments.state, 'exhausted_selected_scope');
});

test('raw capture parsing requires matching vehicle, parser, status and recomputed digest', () => {
  const good = documentRegions('snapshots', snapshot, { id: ID });
  assert.equal(good.regions.length, 1);
  assert.match(good.regions[0].text, /heater core/);
  assert.equal(good.regions[0].basis, 'verified_capture_parser_region');
  assert.equal(good.gaps[0].reason, 'parser_region_completeness_unestablished');
  for (const patch of [{ attested_vehicle_id: ROW }, { vehicle_matched: 'false' }, { platform: 'mecum' },
    { http_status: 500 }, { html_sha256: 'a'.repeat(64) }, { html: null, html_storage_path: 'bat/test.html' }]) {
    const bad = documentRegions('snapshots', { ...snapshot, ...patch }, { id: ID });
    assert.equal(bad.regions.length, 0);
    assert.ok(bad.gaps.length);
  }
});

test('existing image output is attributed as unverified; no analysis is not healthy condition', () => {
  const empty = documentRegions('images', { ai_extractions: [] }, { id: ID });
  assert.equal(empty.gaps[0].reason, 'image_ai_extractions_has_no_searchable_text');
  assert.equal(empty.gaps[0].path, '/ai_extractions');
  const found = documentRegions('images', { ai_extractions: { condition: { note: 'Rust on frame.' } } }, { id: ID });
  assert.equal(found.regions[0].path, '/ai_extractions/condition/note');
  assert.equal(found.regions[0].basis, 'existing_image_extraction_unverified');
  let nested = 'Frame rust';
  for (let i = 0; i < 14; i++) nested = { child: nested };
  const withheld = documentRegions('images', { ai_extractions: nested }, { id: ID });
  assert.equal(withheld.regions.length, 0);
  assert.ok(withheld.gaps.some(g => g.reason === 'structured_depth_budget'));
});

test('reports preserve contradictory testimony, duplicates, missing clocks and unknown owner relation', () => {
  const rows = [
    { id: ROW, is_seller: true, posted_at: DATE, created_at: DATE, comment_text: 'No rust on frame.' },
    { id: ID, posted_at: null, created_at: DATE, comment_text: 'Rust on frame.' },
    { id: '33333333-3333-4333-8333-333333333333', posted_at: DATE, created_at: DATE, comment_text: 'No rust on frame.' },
  ];
  const report = buildReport(capture(rows));
  const v = report.vehicles[0];
  assert.equal(v.candidates.length, 3);
  assert.equal(v.candidates[0].owner_relation, 'unestablished');
  assert.equal(v.candidates[1].event_at, null);
  assert.equal(v.candidates[0].duplicate_text_key, v.candidates[2].duplicate_text_key);
  assert.equal(v.candidates[0].event_at, DATE);
  assert.equal(report.monetary_weights, 'not_estimated');
  assert.deepEqual(report.retrieval_boundary.image_analysis_fields_searched, ['ai_extractions']);
  assert.equal(report.retrieval_boundary.other_image_analysis_fields, 'not_read');
  assert.ok(v.next_evidence.some(n => n.facet === 'storage' && n.condition === 'unknown_not_absent'));
});

test('private HTML escapes hostile testimony and never follows executable URLs', () => {
  const report = buildReport(capture([{ id: ROW, source_url: 'javascript:alert(1)',
    comment_text: 'Needs repair. <script>alert(1)</script> Rust on frame.' }]));
  const html = renderReport(report);
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('href="javascript:'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('offline run preserves retrieval clocks, creates private files and refuses public output/overwrite', async () => {
  const base = mkdtempSync(join(tmpdir(), 'buying-evidence-test-'));
  const { writeFileSync } = await import('node:fs');
  const file = join(base, 'capture.json');
  writeFileSync(file, JSON.stringify(capture([{ id: ROW, comment_text: 'Needs a heater core.' }])));
  const out = join(base, 'review');
  assert.equal(await main(['--cache', file, '--out', out]), 0);
  assert.equal(JSON.parse(readFileSync(join(out, 'report.json'))).retrieval_started_at, DATE);
  assert.equal(statSync(join(out, 'report.json')).mode & 0o777, 0o600);
  assert.equal(statSync(out).mode & 0o777, 0o700);
  await assert.rejects(main(['--cache', file, '--out', out]));
  await assert.rejects(main(['--cache', file, '--out', 'scripts/discovery/private-output']));
});
