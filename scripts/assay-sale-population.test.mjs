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
