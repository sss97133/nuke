import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, stat, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { main, parseArgs } from './assay-sale-population.mjs';

function candidate() {
  return { vehicleId: 'synthetic-vehicle', sourceUrl: 'https://bringatrailer.com/listing/synthetic-lot/',
    amount: 24000, outcome: 'sold', eventAt: '2024-01-01', knownAt: null, currency: null, priceBasis: null,
    unitSource: null, conditionEvidence: 'unknown', capture: { table: 'vehicle_events', id: 'synthetic-event' },
    sourcePlatform: 'bat', sourceEpisodeKey: 'synthetic-lot', eventGrain: 'day', eventTimeBasis: 'native_day',
    knownAtEvidence: null, qualification: { status: 'candidate', basis: null, evidenceRefs: [] }, relevance: [] };
}
function input(rows = [candidate()]) {
  return { schemaVersion: 'sale_event_population_v1', rows, options: {
    population: { key: 'synthetic-explicit-page', label: 'Synthetic page', basis: 'saved_input_only', complete: false },
    subject: { sourcePlatform: null, sourceEpisodeKey: null, vehicleId: null, currency: null, priceBasis: null, relevance: [] },
    policy: { key: '', basis: '', requiredDimensions: [] }, eventFrom: '2010-01-01T00:00:00Z',
    eventBefore: '2026-10-01T00:00:00Z', evidenceAsOf: '2026-10-04T12:00:00Z', computedAt: '2026-10-04T12:00:00Z',
    knowledgeMode: 'retrospective', minimumMatchedSales: 10,
  } };
}
function nativeInput(rows = [candidate()], headers = []) {
  return { schemaVersion: 'sale_event_candidate_assay_v1', options: input().options,
    receipt: { contract: 'sale_event_candidates_v1', stage: 'private_candidate_assay_not_price_comps',
      population: { eligiblePublicParents: new Set(rows.map(r => r.vehicleId)).size },
      coverage: { complete: true, validRequest: true, captureHeadersComplete: true,
        vehicleEventPresentations: rows.length, batListingPresentations: 0 },
      candidates: rows, sourceCaptureHeaders: headers } };
}
async function files(t, contents = input()) {
  const directory = await mkdtemp(path.join(tmpdir(), 'nuke-sale-population-cli-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = path.join(directory, 'input.json'), output = path.join(directory, 'report.json');
  await writeFile(source, JSON.stringify(contents), { mode: 0o600 });
  return { directory, source, output };
}

test('requires explicit input/output and rejects duplicate or unknown flags', () => {
  assert.deepEqual(parseArgs(['--out', '/private/report.json', '--input', '/private/input.json']), { out: '/private/report.json', input: '/private/input.json' });
  for (const args of [[], ['--input', 'a'], ['--input', 'a', '--input', 'b', '--out', 'c'], ['--run', '--input', 'a', '--out', 'b']]) {
    assert.throws(() => parseArgs(args));
  }
});

test('runs the real selector, keeps an unqualified native price and withholds comparison', async t => {
  const f = await files(t), printed = [];
  assert.equal(await main(['--input', f.source, '--out', f.output], { print: x => printed.push(JSON.parse(x)) }), 0);
  const report = JSON.parse(await readFile(f.output, 'utf8'));
  assert.equal(report.stage, 'local_read_only_sale_population_assay');
  assert.equal(report.databaseWrites + report.modelCalls + report.networkCalls, 0);
  assert.equal(report.result.counts.inputCaptures, 1);
  assert.equal(report.result.counts.qualifiedEpisodes, 0);
  assert.equal(report.result.candidates[0].captures[0].amount, 24000);
  assert.equal(report.result.candidates[0].excluded[0].reason, 'candidate_unqualified');
  assert.equal(report.result.matchedDistribution, null);
  assert.match(report.source.inputSha256, /^[a-f0-9]{64}$/);
  assert.equal((await stat(f.output)).mode & 0o777, 0o600);
  assert.equal(printed[0].counts.inputCaptures, 1);
});

test('retains more than a display-sized slice without truncation', async t => {
  const rows = Array.from({ length: 160 }, (_, i) => ({ ...candidate(), capture: { table: 'vehicle_events', id: `synthetic-event-${i}` },
    sourceUrl: `https://bringatrailer.com/listing/synthetic-lot-${i}/`, sourceEpisodeKey: `synthetic-lot-${i}` }));
  const f = await files(t, input(rows));
  assert.equal(await main(['--input', f.source, '--out', f.output], { print: () => {} }), 0);
  const report = JSON.parse(await readFile(f.output, 'utf8'));
  assert.equal(report.result.counts.inputCaptures, 160);
  assert.equal(report.result.counts.candidateEpisodes, 160);
  assert.equal(report.result.candidates.flatMap(c => c.captures).length, 160);
});

test('refuses malformed qualification before opening an output', async t => {
  const malformed = input(); delete malformed.rows[0].qualification;
  const f = await files(t, malformed), printed = [];
  assert.equal(await main(['--input', f.source, '--out', f.output], { print: x => printed.push(JSON.parse(x)) }), 1);
  assert.equal(printed[0].error, 'invalid_capture_shape');
  await assert.rejects(stat(f.output), { code: 'ENOENT' });
});

test('refuses overwriting an earlier receipt or following its output symlink', async t => {
  const f = await files(t);
  await writeFile(f.output, 'original receipt');
  assert.equal(await main(['--input', f.source, '--out', f.output], { print: () => {} }), 1);
  assert.equal(await readFile(f.output, 'utf8'), 'original receipt');
  const link = path.join(f.directory, 'symlink.json'); await symlink(f.output, link);
  assert.equal(await main(['--input', f.source, '--out', link], { print: () => {} }), 1);
  assert.equal(await readFile(f.output, 'utf8'), 'original receipt');
});

test('native receipt supplies an episode repair queue without promoting prices', async t => {
  const first = { ...candidate(), sourcePlatform: 'mecum', eventAt: null, eventGrain: null },
    alias = { ...first, vehicleId: 'synthetic-alias', capture: { table: 'vehicle_events', id: 'synthetic-alias-event' } },
    resale = { ...candidate(), sourcePlatform: 'mecum', sourceEpisodeKey: 'synthetic-resale',
      capture: { table: 'vehicle_events', id: 'synthetic-resale-event' } },
    unknown = { ...candidate(), sourceEpisodeKey: null, capture: { table: 'vehicle_events', id: 'synthetic-unresolved' } };
  const headers = [{ capture: { table: 'listing_page_snapshots', id: 'synthetic-source' },
    vehicleId: first.vehicleId, sourcePlatform: 'mecum', sourceEpisodeKey: first.sourceEpisodeKey,
    success: true, httpStatus: 200, inlineBodyPresent: true, archivedBodyRecorded: false, parentAttested: false }];
  const f = await files(t, nativeInput([first, alias, resale, unknown], headers));
  assert.equal(await main(['--input', f.source, '--out', f.output], { print: () => {} }), 0);
  const report = JSON.parse(await readFile(f.output, 'utf8'));
  assert.equal(report.result.counts.qualifiedEpisodes, 0);
  assert.equal(report.repairPlan.counts.identifiedEpisodes, 2);
  assert.equal(report.repairPlan.counts.unresolvedPresentations, 1);
  assert.equal(report.repairPlan.counts.missingDateEpisodes, 1);
  assert.equal(report.repairPlan.counts.multipleParentEpisodes, 1);
  assert.equal(report.repairPlan.counts.missingDateEpisodesWithStoredBodyPointer, 1);
  const episode = report.repairPlan.episodes.find(e => e.sourceEpisodeKey === first.sourceEpisodeKey);
  assert.equal(episode.nativeRefs.length, 2);
  assert.equal(episode.sourceCaptureRefs[0].parentAttested, false);
  assert.equal(episode.sourceCaptureRefs[0].qualification, 'candidate_header_only');
  assert.equal(report.source.schemaVersion, 'sale_event_candidate_assay_v1');
});

test('native overflow refuses repair totals rather than reporting an empty market', async t => {
  const contents = nativeInput([]); contents.receipt.coverage.complete = false;
  contents.receipt.coverage.refusal = 'native_presentation_cap_no_sample';
  const f = await files(t, contents);
  assert.equal(await main(['--input', f.source, '--out', f.output], { print: () => {} }), 0);
  const report = JSON.parse(await readFile(f.output, 'utf8'));
  assert.equal(report.repairPlan.state, 'refused');
  assert.equal(report.repairPlan.counts, null);
  assert.deepEqual(report.repairPlan.episodes, []);
});

test('incomplete header selection leaves cached-recovery counts unknown', async t => {
  const contents = nativeInput([{ ...candidate(), eventAt: null, eventGrain: null }]);
  contents.receipt.coverage.captureHeadersComplete = false;
  const f = await files(t, contents);
  assert.equal(await main(['--input', f.source, '--out', f.output], { print: () => {} }), 0);
  const report = JSON.parse(await readFile(f.output, 'utf8'));
  assert.equal(report.repairPlan.counts.missingDateEpisodes, 1);
  assert.equal(report.repairPlan.counts.missingDateEpisodesWithStoredBodyPointer, null);
});

test('native receipt rejects duplicated or missing presentations before output', async t => {
  for (const contents of [nativeInput([candidate(), candidate()]), nativeInput()]) {
    if (contents.receipt.candidates.length === 1) contents.receipt.coverage.vehicleEventPresentations = 2;
    const f = await files(t, contents), printed = [];
    assert.equal(await main(['--input', f.source, '--out', f.output], { print: x => printed.push(JSON.parse(x)) }), 1);
    assert.equal(printed[0].error, 'invalid_native_receipt');
    await assert.rejects(stat(f.output), { code: 'ENOENT' });
  }
});

test('conflicting outcomes and recorded days remain targets; a failed capture is not cached recovery', async t => {
  const first = candidate(), contrary = { ...first, outcome: 'not_sold', eventAt: '2024-01-02',
    amount: null, capture: { table: 'vehicle_events', id: 'synthetic-contrary' } },
    unknownDay = { ...first, sourceEpisodeKey: 'synthetic-undated', eventAt: null, eventGrain: null,
      capture: { table: 'vehicle_events', id: 'synthetic-undated-event' } };
  const headers = [{ capture: { table: 'listing_page_snapshots', id: 'synthetic-failed-source' },
    vehicleId: unknownDay.vehicleId, sourcePlatform: 'bat', sourceEpisodeKey: unknownDay.sourceEpisodeKey,
    success: false, httpStatus: 500, inlineBodyPresent: true, archivedBodyRecorded: false }];
  const f = await files(t, nativeInput([first, contrary, unknownDay], headers));
  assert.equal(await main(['--input', f.source, '--out', f.output], { print: () => {} }), 0);
  const plan = JSON.parse(await readFile(f.output, 'utf8')).repairPlan;
  assert.equal(plan.counts.outcomeConflictEpisodes, 1);
  assert.equal(plan.counts.dateConflictEpisodes, 1);
  assert.equal(plan.counts.missingDateEpisodesWithStoredBodyPointer, 0);
});

test('a native receipt cannot promote qualifications or add a foreign source table', async t => {
  for (const row of [{ ...candidate(), qualification: { status: 'qualified', basis: 'synthetic', evidenceRefs: [] } },
    { ...candidate(), capture: { table: 'private_invoices', id: 'synthetic-foreign' } }]) {
    const f = await files(t, nativeInput([row])), printed = [];
    assert.equal(await main(['--input', f.source, '--out', f.output], { print: x => printed.push(JSON.parse(x)) }), 1);
    assert.equal(printed[0].error, 'invalid_native_receipt');
    await assert.rejects(stat(f.output), { code: 'ENOENT' });
  }
});

test('a capture for another parent and an impossible recorded date cannot establish recovery', async t => {
  const row = { ...candidate(), eventAt: '2024-02-30' },
    header = { capture: { table: 'listing_page_snapshots', id: 'synthetic-other-parent' },
      vehicleId: 'synthetic-other-parent', sourcePlatform: row.sourcePlatform, sourceEpisodeKey: row.sourceEpisodeKey,
      success: true, httpStatus: 200, inlineBodyPresent: true };
  const f = await files(t, nativeInput([row], [header]));
  assert.equal(await main(['--input', f.source, '--out', f.output], { print: () => {} }), 0);
  const plan = JSON.parse(await readFile(f.output, 'utf8')).repairPlan;
  assert.equal(plan.counts.missingDateEpisodes, 1);
  assert.equal(plan.counts.missingDateEpisodesWithStoredBodyPointer, 0);
  assert.deepEqual(plan.episodes[0].sourceCaptureRefs, []);
});

test('live subject mode reuses the bounded SELECT and sanctioned reader once', async t => {
  const f = await files(t), calls = [], subject = '11111111-1111-1111-1111-111111111111';
  assert.equal(await main(['--subject', subject, '--out', f.output], { print: () => {}, readQuery: async sql => {
    calls.push(sql);
    assert(sql.includes(`public.cohort_members('${subject}'::uuid)`));
    assert(sql.includes('LIMIT 10001'));
    assert(sql.includes('5000::integer'));
    assert(sql.includes('v.is_public IS TRUE'));
    assert(!/\$[1-5]\b/.test(sql));
    return JSON.stringify([{ receipt: nativeInput().receipt }]);
  } }), 0);
  const report = JSON.parse(await readFile(f.output, 'utf8'));
  assert.equal(calls.length, 1);
  assert.equal(report.liveRead.queryTool, 'scripts/data/q.sh');
  assert.equal(report.networkCalls, 1);
  assert.equal(report.databaseWrites + report.modelCalls, 0);
  assert.equal(report.repairPlan.counts.identifiedEpisodes, 1);
  assert.equal(report.result.counts.qualifiedEpisodes, 0);
});

test('live mode rejects injection, ambiguous modes and existing output without a query', async t => {
  const f = await files(t); let calls = 0;
  const deps = { print: () => {}, readQuery: () => { calls++; throw new Error('must not query'); } };
  assert.equal(await main(['--subject', "'; SELECT secret; --", '--out', f.output], deps), 1);
  assert.equal(await main(['--subject', '11111111-1111-1111-1111-111111111111', '--input', f.source, '--out', f.output], deps), 1);
  await writeFile(f.output, 'existing');
  assert.equal(await main(['--subject', '11111111-1111-1111-1111-111111111111', '--out', f.output], deps), 1);
  assert.equal(calls, 0);
  assert.equal(await readFile(f.output, 'utf8'), 'existing');
});

test('live read failures stay explicit without leaking tool errors or creating an empty receipt', async t => {
  const f = await files(t), printed = [];
  assert.equal(await main(['--subject', '11111111-1111-1111-1111-111111111111', '--out', f.output], {
    print: x => printed.push(JSON.parse(x)), readQuery: () => { throw new Error('synthetic-private-error'); },
  }), 1);
  assert.deepEqual(printed, [{ success: false, error: 'sanctioned_read_failed' }]);
  await assert.rejects(stat(f.output), { code: 'ENOENT' });
});
