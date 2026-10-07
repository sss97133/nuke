// node --test scripts/stacks/stacks.test.mjs
// Offline tests: no database, no model, no network. Fixtures are synthetic; nothing here is private data.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { AskError, classifyOdyFailure, createOdyAsker, createOllamaAsker, killActive, odyArgv, runProcess } from './lib/ask.mjs';
import { atlasMeta, atlasSummary, liveTables, loadAtlas, loadRegistry, pickSeeds, seedDetails } from './lib/atlas.mjs';
import { assertSelectOnly, duplicateOf, nameKey, readonlySql, redact, tokens } from './lib/common.mjs';
import { DEFAULT_CASES_DOC, loadExistingStacks, parseExistingStacks } from './lib/existing.mjs';
import { LAYERS, NEED_LAYERS, batchSchema, buildPrompt, extractProposalObjects, validateProposal } from './lib/grammar.mjs';
import { rankRecords, readAllRecords, renderIndex } from './lib/output.mjs';
import { compare } from './check-registry-parity.mjs';
import { nextFreeStackId, promotionSql, sharedWith, slugify, stackIdFor, toRegistryRows, writePromotion, writeToRegistry } from './lib/registry.mjs';
import { choose, main as promoteMain } from './promote.mjs';
import { buildIndex, buildRecord, measureNeeds, proposalId, resolveNeed } from './measure.mjs';
import { admit, askBatch, main, parseArgs } from './propose.mjs';

const scratch = mkdtempSync(join(tmpdir(), 'stacks-test-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

// ---- fixtures ----------------------------------------------------------------------------------
const filler = Array.from({ length: 110 }, (_, i) => ({ name: `filler_table_${i}`, kind: 'r', cols: 'id,created_at' }));
const row = (table_name, est_rows, extra = {}) => ({ table_name, activity: 'written', est_rows, n_cols: 4, n_cols_described: 2, fk_out: 1, fk_in: 1, purpose: `${table_name} purpose`, registry_fields: 0, ...extra });
const atlas = {
  pulled_at: '2026-10-07T00:00:00Z',
  objects: [
    { name: 'bat_bids', kind: 'r', cols: 'id,lot_id,bidder_identity_id,amount,bid_at' },
    { name: 'auction_comments', kind: 'r', cols: 'id,body,author_identity_id,posted_at' },
    { name: 'places', kind: 'r', cols: 'id,name,county_fips' },
    { name: 'census_places', kind: 'r', cols: 'id,population' },
    { name: 'empty_table', kind: 'r', cols: 'id' },
    { name: 'derived_unowned', kind: 'r', cols: 'id' },
    { name: 'derived_owned', kind: 'r', cols: 'id' },
    { name: 'mv_bidder_profiles', kind: 'm', cols: 'identity_id,win_rate' },
    { name: 'v_job_health', kind: 'v', cols: 'jobid,jobname' },
    { name: 'vehicles', kind: 'r', cols: 'id,color,body_style,exterior_color_family,mileage' },
    ...filler,
  ],
  atlas: [
    row('bat_bids', 4300000, { n_cols: 5, n_cols_described: 5, fk_out: 3, fk_in: 0, purpose: 'Bids on Bring a Trailer lots: one row per bid', registry_fields: 2 }),
    row('auction_comments', 20000000, { fk_out: 5, fk_in: 2, purpose: 'The auction log of public comments' }),
    row('vehicles', 1000000, { n_cols: 5, n_cols_described: 5, fk_out: 15, fk_in: 291, purpose: 'CANONICAL for vehicle', registry_fields: 4 }),
    row('places', 1200),
    row('census_places', 3000),
    row('empty_table', 0),
    row('derived_unowned', 50),
    row('derived_owned', 50, { registry_fields: 1 }),
    row('idle_thing', 99000000, { activity: 'idle', purpose: 'not live' }),
    row('odometer_log', 500, { activity: 'read-only', n_cols: 2, n_cols_described: 0, purpose: 'Odometer readings with dates from many sources' }),
  ],
  residual: [
    { table_name: 'bat_bids', est_rows: 4300000, gaps: ['key', 'owner'] },
    { table_name: 'auction_comments', est_rows: 20000000, gaps: ['owner'] },
  ],
  registry: [
    { table_name: 'vehicles', column_name: 'paint_code', description: 'Factory paint code decoded from the VIN plate' },
  ],
  fill: {
    bat_bids: { id: 1, lot_id: 0.99, bidder_identity_id: 0.97, amount: 1, bid_at: 1 },
    auction_comments: { id: 1, body: 1, author_identity_id: 0.5, posted_at: 1 },
    places: { county_fips: 0.95 },
    vehicles: { color: 0.7, exterior_color_family: 0.95, mileage: 0.92 },
  },
  fks: { bat_bids: ['bidder_identity_id'], auction_comments: ['author_identity_id'] },
};
const registryFixture = {
  available: true,
  stacks: [
    { stack_id: 'S01', version: 1, name: 'Liquidity surface', status: 'measured', coverage: 0, n_needs: 1, n_present: 0, n_partial: 0, n_missing: 1 },
    { stack_id: 'S02', version: 1, name: 'Bidder record as of a date', status: 'measured', coverage: 1, n_needs: 1, n_present: 1, n_partial: 0, n_missing: 0 },
    { stack_id: 'S03', version: 1, name: 'Promoted earlier', status: 'proposed', coverage: 0.5, n_needs: 2, n_present: 1, n_partial: 0, n_missing: 1 },
    { stack_id: 'S04', version: 1, name: 'Auction rhythm spectrum', status: 'proposed', coverage: 0.5, n_needs: 2, n_present: 1, n_partial: 0, n_missing: 1 },
  ],
  needs: [
    { stack_id: 'S02', layer: 'log', kind: 'table', object: 'bat_bids' },
    { stack_id: 'S01', layer: 'dimension', kind: 'abstract', object: 'place entity' },
    { stack_id: 'S04', layer: 'dimension', kind: 'abstract', object: 'place entity' },
    { stack_id: 'S04', layer: 'key', kind: 'column', object: 'bat_bids.bidder_identity_id' },
  ],
  substrates: [
    { substrate: 'place entity', declared_table: null },
    { substrate: 'comment stance dimension', declared_table: null },
    { substrate: 'Census dimension', declared_table: 'census_places' },
    { substrate: 'text fold', declared_table: null },
    { substrate: 'the price model', declared_table: null },
  ],
};

const proposal = (name, needs) => ({
  name,
  question: `Which cohorts show the strongest signal for ${name.toLowerCase()}?`,
  who_cares: 'Buyers and sellers deciding when to list',
  layers: Object.fromEntries(LAYERS.map(l => [l, `The ${l} layer holds one sentence about this stack.`])),
  needs: needs ?? [
    { layer: 'log', kind: 'table', object: 'bat_bids' },
    { layer: 'key', kind: 'column', object: 'bat_bids.bidder_identity_id' },
    { layer: 'dimension', kind: 'dimension', object: 'exterior color family' },
    { layer: 'dimension', kind: 'dimension', object: 'paint code' },
    { layer: 'outcome', kind: 'source', object: 'bid frames at second precision' },
  ],
  external_dimensions: ['census population by county'],
  score_rule: 'Absolute percentage error against the cohort median at 14 days',
});

// ---- common --------------------------------------------------------------------------------------
describe('common', () => {
  it('refuses anything but one SELECT', () => {
    assert.doesNotThrow(() => assertSelectOnly('select 1'));
    assert.doesNotThrow(() => assertSelectOnly("with a as (select 'update' as w) select * from a;"));
    for (const bad of ['delete from t', 'select 1; select 2', 'with a as (select 1) insert into t select * from a', 'update t set a = 1', 'select 1 -- x\n; drop table t'])
      assert.throws(() => assertSelectOnly(bad), /read-only guard/);
  });
  it('wraps a query in a read-only transaction and terminates it once', () => {
    const sql = readonlySql('select 1;;');
    assert.match(sql, /^BEGIN READ ONLY;/);
    assert.match(sql, /select 1;\nROLLBACK;$/);
  });
  it('redacts credentials and email addresses but keeps ordinary text', () => {
    const dirty = 'key sbp_abcdefghijklmnopqrstuvwx and Bearer abcdefghijklmnop1234 and ODYSSEUS_API_TOKEN=abc123 mail me@example.com ok bat_bids';
    const clean = redact(dirty);
    assert.doesNotMatch(clean, /sbp_abcdef|abcdefghijklmnop1234|abc123|me@example/);
    assert.equal(redact('\x1b[1m\x1b[38;5;196mfailed\x1b[0m'), 'failed');
    assert.match(clean, /bat_bids/);
  });
  it('tokenizes with singular forms and drops stopwords', () => {
    assert.deepEqual([...tokens('The buyers of Bids and listings')].sort(), ['bid', 'buyer', 'listing']);
  });
  it('detects repeated names without flagging different ones', () => {
    const known = [{ name: 'Liquidity surface' }, { name: 'Odometer honesty' }, { name: 'Seller trust and its price' }];
    assert.equal(nameKey('The surface of liquidity'), nameKey('Liquidity surface'));
    assert.ok(duplicateOf('Liquidity Surface', known));
    assert.ok(duplicateOf('surface liquidity', known));
    assert.ok(duplicateOf('Odometer honesty index', known), 'one added word is still the same stack');
    assert.ok(duplicateOf('Snipe Cascade Detection', [{ name: 'snipe cascades and rivalry pairs' }]), 'two shared content words');
    assert.equal(duplicateOf('Bidder trust and sniping risk', known), null);
    assert.equal(duplicateOf('Seller response latency', known), null);
    assert.equal(duplicateOf('Shill detection graph', known), null);
  });
});

// ---- existing stacks -------------------------------------------------------------------------------
describe('existing stacks', () => {
  it('parses the table, the four built stacks and the forty more from a fragment', () => {
    const md = [
      '## 13. Aspiration', '| # | Stack | Chain | Missing |', '|---|---|---|---|', '| 1 | County performance surface | a -> b | place |',
      '| 2 | Flip ledger (the card) | c | d |',
      '*A. The auction as an order book.* log is bids.', '*B. The car as a bond.* value',
      '**Forty more, each with the layer it needs.**', 'Market: 21 bid hazard model (frames); 22 snipe cascades (chains).',
      'Physics: 23 corrosion exposure prior (state history, zone). 24 use profile (odometer curves).', '**How we get there**', '## 14. Next', '| 9 | Not ours | x | y |',
    ].join('\n');
    const names = parseExistingStacks(md).map(s => s.name);
    assert.deepEqual(names, ['County performance surface', 'Flip ledger', 'The auction as an order book', 'The car as a bond', 'bid hazard model', 'snipe cascades', 'corrosion exposure prior', 'use profile']);
  });
  it('finds all 64 names in the real case ledger when 13.2 is present', { skip: !existsSync(DEFAULT_CASES_DOC) }, () => {
    const { stacks } = loadExistingStacks();
    if (!/13\.2 The stack grammar/.test(readFileSync(DEFAULT_CASES_DOC, 'utf8'))) return; // checkout predates 13.2
    assert.equal(stacks.length, 64);
    for (const wanted of ['Liquidity surface', 'bid hazard model', 'trust calibration', 'Ownership as flow']) assert.ok(stacks.some(s => s.name === wanted), wanted);
  });
});

// ---- extraction and validation -------------------------------------------------------------------------
describe('extractProposalObjects', () => {
  const one = JSON.stringify(proposal('Alpha stack idea'));
  const two = JSON.stringify(proposal('Beta stack idea'));
  it('reads a clean array', () => assert.equal(extractProposalObjects(`[${one},${two}]`).items.length, 2));
  it('ignores thinking blocks and code fences', () => {
    const text = `<think>let me plan [1,2,3] {"a":1}</think>\nHere you go:\n\`\`\`json\n[${one}]\n\`\`\``;
    assert.equal(extractProposalObjects(text).items.length, 1);
  });
  it('tolerates trailing commas and chatter around the array', () => {
    assert.equal(extractProposalObjects(`Sure! [${one},] done.`).items.length, 1);
  });
  it('unwraps an object that holds the array, and a single proposal object', () => {
    assert.equal(extractProposalObjects(`{"stacks":[${one},${two}]}`).items.length, 2);
    assert.equal(extractProposalObjects(one).items.length, 1);
  });
  it('salvages complete elements from a reply cut off mid-array', () => {
    const cut = `[${one},${two},{"name":"Gamma","question":"cut off here and "`;
    const r = extractProposalObjects(cut);
    assert.equal(r.items.length, 2);
    assert.equal(r.complete, false);
    assert.match(r.problems.join(' '), /cut off/);
  });
  it('handles braces inside strings', () => {
    const tricky = JSON.stringify({ ...proposal('Brace stack idea'), question: 'What about {curly} and "quoted" text in a question?' });
    assert.equal(extractProposalObjects(`[${tricky},{"name":"cut`).items.length, 1);
  });
  it('reports garbage and an unfinished thinking block as no items', () => {
    assert.equal(extractProposalObjects('I cannot help with that.').items.length, 0);
    assert.equal(extractProposalObjects('<think>still thinking about [').items.length, 0);
    assert.equal(extractProposalObjects('').items.length, 0);
  });
});

describe('validateProposal', () => {
  it('accepts a well-formed proposal and normalizes objects', () => {
    const raw = proposal('Auction demand curve');
    raw.needs.push({ layer: 'log', kind: 'table', object: 'public.Bat Bids' }, { layer: 'log', kind: 'table', object: 'bat_bids' });
    const v = validateProposal(raw);
    assert.equal(v.ok, true, v.errors.join('; '));
    assert.equal(v.value.needs.filter(n => n.object === 'bat_bids').length, 1, 'duplicate needs collapse');
  });
  it('drops needs at the stack\'s own derived layers and records them; too few left is an error naming the drop', () => {
    const extra = ['fold', 'baseline', 'residual', 'feature', 'prediction'].map(layer => ({ layer, kind: 'table', object: `${layer}_table` }));
    const ok = validateProposal({ ...proposal('Derived layers dropped'), needs: [...proposal('x y').needs, ...extra] });
    assert.equal(ok.ok, true, ok.errors.join('; '));
    assert.equal(ok.value.needs.length, 5);
    assert.deepEqual(ok.value.dropped_needs.map(n => n.layer), ['fold', 'baseline', 'residual', 'feature', 'prediction']);
    const bad = validateProposal({ ...proposal('Only derived needs'), needs: extra });
    assert.equal(bad.ok, false);
    assert.match(bad.errors.join('; '), /layers log, key, dimension, outcome \(got 0; 5 at the stack's own derived layers were dropped\)/);
    assert.deepEqual(NEED_LAYERS, ['log', 'key', 'dimension', 'outcome']);
  });

  it('keys a need by layer and object, as the registry does', () => {
    const v = validateProposal({ ...proposal('Same object twice'), needs: [...proposal('x y').needs, { layer: 'dimension', kind: 'source', object: 'Exterior Color Family' }] });
    assert.equal(v.ok, true);
    assert.equal(v.value.needs.length, 5, 'a dimension and a source naming one phrase at one layer collapse');
  });

  it('rejects wrong shapes with specific messages', () => {
    const cases = [
      [{ ...proposal('Valid name here'), extra: 1 }, /unexpected key "extra"/],
      [{ ...proposal('Valid name here'), layers: { ...proposal('x y').layers, fold: undefined } }, /layers\.fold/],
      [{ ...proposal('Valid name here'), layers: { ...proposal('x y').layers, etl: 'a sentence here' } }, /unexpected layer "etl"/],
      [{ ...proposal('Valid name here'), needs: [{ layer: 'log', kind: 'table | column', object: 'x_y' }, ...proposal('x y').needs] }, /kind must be one of/],
      [{ ...proposal('Valid name here'), needs: [{ layer: 'etl', kind: 'table', object: 'bat_bids' }, ...proposal('x y').needs] }, /layer must be one of/],
      [{ ...proposal('Valid name here'), needs: [{ layer: 'log', kind: 'column', object: 'no_dot' }, ...proposal('x y').needs] }, /table\.column/],
      [{ ...proposal('Valid name here'), needs: proposal('x y').needs.slice(0, 2) }, /3 to 14 distinct/],
      [{ ...proposal('Stack 12') }, /name must be/],
      [{ ...proposal('Oneword') }, /name must be/],
      [{ ...proposal('Valid name here'), score_rule: '<how a prediction is graded>' }, /score_rule/],
      [{ ...proposal('Valid name here'), external_dimensions: 'census' }, /external_dimensions must be an array/],
      [null, /not an object/],
    ];
    for (const [raw, pattern] of cases) {
      const v = validateProposal(raw);
      assert.equal(v.ok, false, String(raw?.name));
      assert.match(v.errors.join('; '), pattern);
    }
  });
  it('builds a schema whose required keys match the validator', () => {
    const schema = batchSchema(3);
    assert.equal(schema.minItems, 3);
    assert.deepEqual(schema.items.properties.layers.required, LAYERS);
    assert.deepEqual(schema.items.properties.needs.items.properties.layer.enum, NEED_LAYERS);
  });
});

// ---- measuring ----------------------------------------------------------------------------------------
describe('measure', () => {
  const index = buildIndex(atlas, registryFixture);
  const need = (kind, object, layer = 'log', extra = {}) => ({ layer, kind, object, ...extra });
  const verdict = (n) => resolveNeed(index, n);

  it('table: present with rows; partial when empty or, at a derived layer, without an owner; views are not tables', () => {
    assert.equal(verdict(need('table', 'bat_bids')).verdict, 'present');
    assert.equal(verdict(need('table', 'place')).verdict, 'present', 'singular spelling of places');
    assert.equal(verdict(need('table', 'places')).resolved, 'places');
    const empty = verdict(need('table', 'empty_table'));
    assert.deepEqual([empty.verdict, empty.evidence], ['partial', 'public.empty_table has no rows by the planner estimate']);
    assert.equal(verdict(need('table', 'derived_unowned', 'fold')).verdict, 'partial');
    assert.match(verdict(need('table', 'derived_unowned', 'fold')).evidence, /no owner declared in pipeline_registry/);
    assert.equal(verdict(need('table', 'derived_unowned', 'log')).verdict, 'present', 'an owner only matters at the derived layers');
    assert.equal(verdict(need('table', 'derived_owned', 'prediction')).verdict, 'present');
    for (const name of ['v_job_health', 'mv_bidder_profiles']) {
      const r = verdict(need('table', name));
      assert.equal(r.verdict, 'missing');
      assert.match(r.evidence, /not a base table/);
    }
    assert.equal(verdict(need('table', 'nothing_here')).verdict, 'missing');
  });

  it('column: fill of at least 0.9; a key also needs a foreign key; unknown statistics are partial', () => {
    assert.equal(verdict(need('column', 'bat_bids.amount')).verdict, 'present');
    assert.equal(verdict(need('column', 'vehicles.color')).verdict, 'partial');
    assert.match(verdict(need('column', 'vehicles.color')).evidence, /filled 0\.7, below 0\.9/);
    assert.equal(verdict(need('column', 'bat_bids.bidder_identity_id', 'key')).verdict, 'present');
    assert.equal(verdict(need('column', 'auction_comments.author_identity_id', 'key')).verdict, 'partial', 'has a foreign key but fill 0.5');
    const noFk = verdict(need('column', 'bat_bids.lot_id', 'key'));
    assert.deepEqual([noFk.verdict, /no foreign key/.test(noFk.evidence)], ['partial', true]);
    assert.equal(verdict(need('column', 'bat_bids.lot_id', 'log')).verdict, 'present', 'a foreign key only matters at the key layer');
    assert.equal(verdict(need('column', 'census_places.population')).verdict, 'partial', 'no statistics for the column');
    const gone = verdict(need('column', 'bat_bids.bid_increment'));
    assert.deepEqual([gone.verdict, /table bat_bids exists, column bid_increment does not/.test(gone.evidence)], ['missing', true]);
    assert.equal(verdict(need('column', 'no_table.x')).verdict, 'missing');
    assert.equal(verdict(need('column', 'bat_bid.amount')).resolved, 'bat_bids.amount', 'singular table spelling resolves');
  });

  it('column: a denominator makes fill a share of the rows that carry the text', () => {
    assert.equal(verdict(need('column', 'vehicles.mileage', 'log', { denominator: 'vehicles.exterior_color_family' })).verdict, 'present'); // 0.92 / 0.95
    assert.equal(verdict(need('column', 'vehicles.color', 'log', { denominator: 'vehicles.exterior_color_family' })).verdict, 'partial'); // 0.7 / 0.95
    assert.match(verdict(need('column', 'vehicles.mileage', 'log', { denominator: 'vehicles.nothing' })).evidence, /no planner statistics for the column or its denominator/);
  });

  it('dimension and source: registry substrates first, declared or not', () => {
    const undeclared = verdict(need('dimension', 'place', 'dimension'));
    assert.deepEqual([undeclared.verdict, undeclared.substrate], ['missing', 'place entity']);
    assert.match(undeclared.evidence, /no table declared/);
    assert.equal(verdict(need('dimension', 'comment stance', 'dimension')).substrate, 'comment stance dimension');
    assert.equal(verdict(need('source', 'text fold', 'dimension')).substrate, 'text fold');
    assert.equal(verdict(need('dimension', 'comment stance dimension', 'dimension')).substrate, 'comment stance dimension', 'the exact name');
    const loose = verdict(need('dimension', 'price type', 'dimension'));
    assert.equal(loose.substrate, undefined, 'one shared word is not a substrate match');
    const declared = verdict(need('dimension', 'Census dimension', 'dimension'));
    assert.deepEqual([declared.verdict, declared.substrate], ['present', 'Census dimension']);
    assert.match(declared.evidence, /declared as census_places/);
  });

  it('dimension and source: without a substrate, an exact table or a well-filled column is present, related words are partial', () => {
    assert.equal(verdict(need('dimension', 'bat bids', 'dimension')).verdict, 'present', 'an exact table');
    const named = verdict(need('dimension', 'places', 'dimension'));
    assert.deepEqual([named.verdict, named.substrate], ['missing', 'place entity'], 'a substrate name wins over a table of the same name: the registry has declared no table for it');
    const column = verdict(need('dimension', 'exterior color family', 'dimension'));
    assert.deepEqual([column.verdict, column.resolved], ['present', 'vehicles.exterior_color_family']);
  });

  it('dimension and source: thin columns and word matches are partial, nothing is missing', () => {
    const thin = verdict(need('dimension', 'color', 'dimension'));
    assert.deepEqual([thin.verdict, thin.resolved], ['partial', 'vehicles.color'], 'the fullest column called color is filled to 0.7 only');
    assert.equal(verdict(need('dimension', 'paint code', 'dimension')).verdict, 'partial', 'registry description matches');
    assert.equal(verdict(need('dimension', 'odometer readings', 'dimension')).verdict, 'partial', 'table purpose matches');
    assert.equal(verdict(need('dimension', 'tidal harmonics of auction closing', 'dimension')).verdict, 'missing');
    assert.equal(verdict(need('source', 'bid frames at second precision', 'outcome')).verdict, 'missing');
    assert.equal(verdict(need('dimension', 'id', 'dimension')).verdict, 'missing');
  });

  it('computes coverage as present over needs, with counts by layer', () => {
    const m = measureNeeds(index, proposal('Coverage check here').needs);
    assert.deepEqual(m.coverage, { present: 3, partial: 1, missing: 1, total: 5, coverage: 0.6, coverage_with_partial: 0.8 });
    assert.deepEqual(m.by_layer, { log: { present: 1, partial: 0, missing: 0 }, key: { present: 1, partial: 0, missing: 0 }, dimension: { present: 1, partial: 1, missing: 0 }, outcome: { present: 0, partial: 0, missing: 1 } });
    assert.equal(measureNeeds(index, []).coverage.coverage, 0);
  });

  it('is deterministic', () => {
    const needs = proposal('Deterministic check').needs;
    assert.deepEqual(measureNeeds(index, needs), measureNeeds(buildIndex(atlas, registryFixture), needs));
  });

  it('works without a registry and without statistics (older cached pulls)', () => {
    const bare = buildIndex({ ...atlas, fill: undefined, fks: undefined });
    assert.equal(resolveNeed(bare, need('column', 'bat_bids.amount')).verdict, 'partial');
    assert.equal(resolveNeed(bare, need('dimension', 'place', 'dimension')).substrate, undefined);
  });

  it('gives the same id to the same name however it is written, and a registry id in the registry form', () => {
    assert.equal(proposalId('Bid hazard model'), proposalId('the hazard model of bids'));
    assert.match(stackIdFor('Bid hazard model'), /^S[0-9A-Z]+$/);
    assert.equal(stackIdFor('Bid hazard model'), stackIdFor('the hazard model of bids'));
  });

  it('records dropped derived-layer needs beside the proposal, not inside it', () => {
    const checked = validateProposal({ ...proposal('Derived needs dropped'), needs: [...proposal('x y').needs, { layer: 'fold', kind: 'table', object: 'bid_curve_per_minute' }] });
    assert.equal(checked.ok, true);
    const rec = buildRecord({ proposal: checked.value, asker: { via: 'fake', model: 'm' }, run: 'r', proposedAt: 'p', measuredAt: 'm', atlas, measured: measureNeeds(index, checked.value.needs) });
    assert.deepEqual(rec.dropped_needs, [{ layer: 'fold', kind: 'table', object: 'bid_curve_per_minute' }]);
    assert.equal('dropped_needs' in rec.proposal, false);
    assert.equal(rec.registry_stack_id, stackIdFor('Derived needs dropped'));
    assert.equal(rec.needs.length, 5);
  });
});

// ---- parity with the registry's own verdicts ---------------------------------------------------------------------------
describe('parity check', () => {
  it('counts agreement per kind, skips what is not modelled, and names every disagreement', () => {
    const index = buildIndex(atlas, registryFixture);
    const needs = [
      { stack_id: 'S01', layer: 'log', kind: 'table', object: 'bat_bids' },
      { stack_id: 'S01', layer: 'key', kind: 'column', object: 'bat_bids.bidder_identity_id' },
      { stack_id: 'S01', layer: 'dimension', kind: 'abstract', object: 'place entity' },
      { stack_id: 'S01', layer: 'log', kind: 'intake', object: 'bat_bids.bid_at' },
      { stack_id: 'S01', layer: 'log', kind: 'column', object: 'vehicles.color' },
    ];
    const live = [{ stack_id: 'S01', needs: [
      { layer: 'log', object: 'bat_bids', verdict: 'present' },
      { layer: 'key', object: 'bat_bids.bidder_identity_id', verdict: 'present' },
      { layer: 'dimension', object: 'place entity', verdict: 'missing' },
      { layer: 'log', object: 'bat_bids.bid_at', verdict: 'present' },
      { layer: 'log', object: 'vehicles.color', verdict: 'present', evidence: { fill: 0.95 } }, // the registry saw different statistics
    ] }];
    const { byKind, disagreements } = compare(index, needs, live);
    assert.deepEqual(byKind.table, { compared: 1, agree: 1, skipped: 0 });
    assert.deepEqual(byKind.abstract, { compared: 1, agree: 1, skipped: 0 });
    assert.deepEqual(byKind.intake, { compared: 0, agree: 0, skipped: 1 });
    assert.deepEqual(byKind.column, { compared: 2, agree: 1, skipped: 0 });
    assert.equal(disagreements.length, 1);
    assert.deepEqual([disagreements[0].object, disagreements[0].local, disagreements[0].registry], ['vehicles.color', 'partial', 'present']);
  });
});

// ---- the atlas ---------------------------------------------------------------------------------------------
describe('atlas', () => {
  it('lists live tables by rows and summarizes them for the prompt', () => {
    assert.deepEqual(liveTables(atlas).map(r => r.table_name), ['auction_comments', 'bat_bids', 'vehicles', 'census_places', 'places', 'derived_owned', 'derived_unowned']);
    const text = atlasSummary(atlas);
    assert.match(text, /^auction_comments \| 20\.0M rows \| 50% described/);
    assert.match(text, /key gap, largest first: bat_bids \(4\.3M\)/);
    assert.match(text, /owner gap, largest first: bat_bids \(4\.3M\), auction_comments \(20\.0M\)/);
    assert.doesNotMatch(text, /idle_thing/);
  });
  it('summarizes what was pulled, including columns with statistics', () => {
    assert.deepEqual(atlasMeta(atlas), { pulled_at: '2026-10-07T00:00:00Z', objects: 120, atlas_rows: 10, registry_rows: 1, columns_with_stats: 13 });
  });
  it('reads the registry once, caches it, and degrades to unavailable instead of failing the run', async () => {
    const dir = mkdtempSync(join(scratch, 'registry-'));
    let pulls = 0;
    const pull = async () => { pulls++; return [{ registry: { stacks: registryFixture.stacks, needs: registryFixture.needs, substrates: registryFixture.substrates } }]; };
    const first = await loadRegistry({ runDir: dir, pull });
    assert.deepEqual([first.available, first.stacks.length, first.needs.length, first.substrates.length], [true, 4, 4, 5]);
    await loadRegistry({ runDir: dir, pull });
    assert.equal(pulls, 1);
    const down = await loadRegistry({ runDir: mkdtempSync(join(scratch, 'registry-')), pull: async () => { throw new Error('relation "stacks" does not exist'); } });
    assert.deepEqual([down.available, down.stacks, down.needs, down.substrates], [false, [], [], []]);
    assert.match(down.error, /does not exist/);
  });
  it('pulls once and serves the cache afterwards', async () => {
    const dir = mkdtempSync(join(scratch, 'atlas-'));
    let pulls = 0;
    const pull = async () => { pulls++; return [{ atlas: structuredClone(atlas) }]; };
    await loadAtlas({ runDir: dir, pull });
    const again = await loadAtlas({ runDir: dir, pull });
    assert.equal(pulls, 1);
    assert.equal(again.objects.length, atlas.objects.length);
    await assert.rejects(loadAtlas({ runDir: mkdtempSync(join(scratch, 'atlas-')), pull: async () => [{ atlas: { objects: [] } }] }), /unexpected shape/);
  });
});

describe('seeds', () => {
  it('rotates through live tables deterministically and skips retired ones', () => {
    const big = { ...atlas, atlas: [...atlas.atlas, ...Array.from({ length: 12 }, (_, i) => ({ table_name: `live_${i}`, activity: 'written', est_rows: 900000 - i, n_cols: 1, n_cols_described: 1, fk_out: 2, fk_in: 1, purpose: i === 3 ? 'RETIRED in favor of x' : 'a live table' })),
      { table_name: 'plumbing_queue', activity: 'written', est_rows: 5000000, n_cols: 1, n_cols_described: 1, fk_out: 0, fk_in: 0, purpose: 'a queue' }] };
    const a = pickSeeds(big, { k: 4, salt: 1 });
    assert.equal(a.length, 4);
    assert.deepEqual(a, pickSeeds(big, { k: 4, salt: 1 }));
    assert.notDeepEqual(a, pickSeeds(big, { k: 4, salt: 2 }));
    assert.ok(!pickSeeds(big, { k: 20, salt: 5 }).includes('live_3'));
    assert.ok(!pickSeeds(big, { k: 8, salt: 5 }).includes('idle_thing'));
    assert.ok(!pickSeeds(big, { k: 8, salt: 5 }).includes('plumbing_queue'), 'unconnected tables are not seeds while the connected core is large enough');
    assert.ok(pickSeeds(big, { k: 20, salt: 5 }).includes('plumbing_queue'), 'the pool widens when the core is too small');
    assert.equal(new Set(pickSeeds(big, { k: 20, salt: 5 })).size, pickSeeds(big, { k: 20, salt: 5 }).length);
    assert.deepEqual(pickSeeds({ ...atlas, atlas: [] }, { k: 3 }), []);
  });
});

// ---- the prompt ---------------------------------------------------------------------------------------------
describe('prompt', () => {
  it('names the seed tables in order when given', () => {
    const text = buildPrompt({ k: 2, focus: 'x', atlasText: 'a', existingNames: [], earlierNames: [], seeds: ['bat_bids', { name: 'places', purpose: 'Named places with county codes' }] });
    assert.match(text, /stack 1: bat_bids\n/);
    assert.match(text, /stack 2: places \(Named places with county codes\)/);
    assert.doesNotMatch(buildPrompt({ k: 2, focus: 'x', atlasText: 'a', existingNames: [], earlierNames: [] }), /SEED TABLES/);
    assert.doesNotMatch(buildPrompt({ k: 2, focus: null, atlasText: 'a', existingNames: [], earlierNames: [] }), /FOCUS FOR THIS BATCH/);
    assert.deepEqual(seedDetails(atlas, ['bat_bids', 'unknown_table']).map(d => d.name), ['bat_bids', 'unknown_table']);
    assert.match(seedDetails(atlas, ['bat_bids'])[0].purpose, /^Bids on Bring a Trailer/);
  });
  it('carries the grammar, the atlas, the names to avoid and the shape', () => {
    const text = buildPrompt({ k: 4, focus: 'people and reputation', atlasText: atlasSummary(atlas), existingNames: ['Liquidity surface'], earlierNames: ['Odometer drift'] });
    for (const piece of ['nine typed layers', 'bat_bids | 4.3M rows', '- Liquidity surface', '- Odometer drift', 'people and reputation', 'exactly 4 elements', '"score_rule"']) assert.ok(text.includes(piece), piece);
    assert.ok(text.length < 16000);
  });
});

// ---- output -------------------------------------------------------------------------------------------------
describe('output', () => {
  const record = (name, measured, run = '20261007T000000Z') => buildRecord({
    proposal: proposal(name), asker: { via: 'fake', model: 'm' }, run, proposedAt: '2026-10-07T00:00:00.000Z', measuredAt: '2026-10-07T00:00:00.000Z', atlas, measured,
  });
  it('sorts the index by coverage and escapes table cells', () => {
    const idx = buildIndex(atlas, registryFixture);
    const high = record('High coverage stack', measureNeeds(idx, [need('bat_bids'), need('places'), need('vehicles')]));
    const low = record('Low | coverage stack', measureNeeds(idx, [need('nothing_here'), need('also_nothing'), need('bat_bids')]));
    const text = renderIndex([low, high]);
    assert.ok(text.indexOf('High coverage stack') < text.indexOf('Low \\| coverage stack'));
    assert.match(text, /\| 1 \| High coverage stack \| 100% \| 3 \/ 0 \/ 0 \| /);
    assert.match(text, /Shares needs with/);
    function need(object) { return { layer: 'log', kind: 'table', object }; }
  });
  it('keeps the latest measurement of each proposal across files', () => {
    const root = mkdtempSync(join(scratch, 'out-'));
    const dir = join(root, 'proposals');
    const idx = buildIndex(atlas, registryFixture);
    const first = record('Same stack twice', measureNeeds(idx, [{ layer: 'log', kind: 'table', object: 'nothing_here' }]));
    const later = { ...record('Same stack twice', measureNeeds(idx, [{ layer: 'log', kind: 'table', object: 'bat_bids' }])), measured_at: '2026-10-08T00:00:00.000Z' };
    import('node:fs').then(fs => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(join(dir, 'a.jsonl'), `${JSON.stringify(first)}\n`); fs.writeFileSync(join(dir, 'b.jsonl'), `${JSON.stringify(later)}\nnot json\n`); });
    return new Promise(resolve => setTimeout(resolve, 50)).then(() => {
      const rows = readAllRecords(root);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].coverage.coverage, 1);
    });
  });
});

// ---- asking ----------------------------------------------------------------------------------------------------
describe('ask', () => {
  it('classifies the two documented launcher refusals and the other failures', () => {
    const base = { stdout: '', stderr: '', timedOut: false, spawnError: null };
    assert.equal(classifyOdyFailure({ ...base, code: 3, stderr: 'ody: Odysseus not running at http://127.0.0.1:7860. Start it' }).kind, 'ody_not_running');
    assert.equal(classifyOdyFailure({ ...base, code: 2, stderr: 'ody: ODYSSEUS_API_TOKEN not set. Run through' }).kind, 'ody_token_missing');
    assert.equal(classifyOdyFailure({ ...base, code: 22 }).kind, 'ody_http_error');
    assert.equal(classifyOdyFailure({ ...base, code: 1, stderr: 'json.decoder.JSONDecodeError: Expecting value: line 1 column 1 (char 0)' }).kind, 'ody_http_error');
    assert.equal(classifyOdyFailure({ ...base, code: null, timedOut: true }).kind, 'timeout');
    assert.equal(classifyOdyFailure({ ...base, code: null, spawnError: 'ENOENT' }).kind, 'ody_missing');
    assert.equal(classifyOdyFailure({ ...base, code: 0, stdout: '  \n' }).kind, 'empty_reply');
    const empty = classifyOdyFailure({ ...base, code: 0, stdout: '{\n  "response": "",\n  "requested_model": "qwen3.5:9b"\n}' });
    assert.equal(empty.kind, 'ody_empty_reply');
    assert.equal(empty.fatal, true);
    assert.match(empty.hint, /thinking/);
    const payload = classifyOdyFailure({ ...base, code: 0, stdout: '{"detail": "API token missing required scope: chat"}' });
    assert.equal(payload.kind, 'ody_error_payload');
    assert.equal(payload.fatal, true);
    assert.equal(classifyOdyFailure({ ...base, code: 0, stdout: '[{"name":"x"}]' }).kind, 'ok');
    assert.equal(classifyOdyFailure({ ...base, code: 3 }).fatal, true);
  });
  it('builds the launcher argv with an isolated HOME and the message as one argument', () => {
    const prompt = 'line one\n`backticks` and "quotes" and $(subshell)';
    assert.deepEqual(odyArgv({ args: ['ask', prompt], home: '/tmp/h', odyBin: '/x/ody', haveToken: false }),
      ['dotenvx', 'run', '-q', '--', 'env', 'HOME=/tmp/h', '/x/ody', 'ask', prompt]);
    assert.deepEqual(odyArgv({ args: ['ask', prompt], home: '/tmp/h', odyBin: 'ody', haveToken: true }), ['env', 'HOME=/tmp/h', 'ody', 'ask', prompt]);
  });
  it('captures output, exit codes and spawn errors', async () => {
    const ok = await runProcess(['/bin/sh', '-c', 'printf hello; printf oops >&2; exit 3']);
    assert.deepEqual([ok.stdout, ok.stderr, ok.code, ok.timedOut], ['hello', 'oops', 3, false]);
    const missing = await runProcess(['/no/such/binary']);
    assert.equal(missing.spawnError, 'ENOENT');
  });
  it('aborts an in-flight ollama request when the run is stopped, and refuses non-loopback hosts', async () => {
    const hang = http.createServer(() => { /* never answers */ });
    await new Promise(r => hang.listen(0, '127.0.0.1', r));
    try {
      const asker = createOllamaAsker({ port: hang.address().port });
      const started = Date.now();
      const pending = asker.ask({}, [{ role: 'user', content: 'hi' }], { timeoutMs: 30000 });
      setTimeout(() => killActive(), 150);
      await assert.rejects(pending, error => error instanceof AskError && error.kind === 'aborted');
      assert.ok(Date.now() - started < 5000);
    } finally { hang.closeAllConnections?.(); hang.close(); }
    await assert.rejects(async () => createOllamaAsker({ host: 'example.com' }).ask({}, [{ role: 'user', content: 'hi' }], { timeoutMs: 1000 }), /loopback/);
  });

  it('kills the whole process group on timeout', async () => {
    const started = Date.now();
    const result = await runProcess(['/bin/sh', '-c', 'sleep 30 & sleep 30'], { timeoutMs: 300 });
    assert.equal(result.timedOut, true);
    assert.ok(Date.now() - started < 8000, 'returned long before the sleeps would have');
  });
});

// ---- the real `ody` launcher against a stub Odysseus on an ephemeral loopback port -------------------------------------
// Exercises prompt quoting, the isolated session, the cleanup call and the failure classes without the real workspace.
const odyInstalled = existsSync(join(homedir(), '.local', 'bin', 'ody')) && existsSync('/usr/bin/curl');
const stubOdysseus = ({ chat, requests }) => new Promise(resolveServer => {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, auth: req.headers.authorization, body });
      const json = (code, value) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
      if (req.url === '/api/version') return json(200, { version: 'stub' });
      if (req.method === 'POST' && req.url === '/api/session') return json(200, { id: 'stub-session-1' });
      if (req.method === 'GET' && req.url === '/api/session/stub-session-1') return json(200, { id: 'stub-session-1' });
      if (req.method === 'POST' && req.url === '/api/chat') return chat(JSON.parse(body), json, res);
      if (req.method === 'DELETE' && req.url === '/api/session/stub-session-1') return json(200, { status: 'deleted' });
      return json(404, { detail: 'not found' });
    });
  });
  server.listen(0, '127.0.0.1', () => resolveServer(server));
});
const withOdysseusEnv = async (url, fn) => {
  const saved = { url: process.env.ODYSSEUS_URL, key: process.env.ODYSSEUS_API_TOKEN };
  process.env.ODYSSEUS_URL = url;
  process.env.ODYSSEUS_API_TOKEN = 'stub-only';
  try { return await fn(); } finally {
    for (const [name, value] of [['ODYSSEUS_URL', saved.url], ['ODYSSEUS_API_TOKEN', saved.key]]) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
};
const realSessionFile = join(homedir(), '.nuke', 'odysseus-session');
const fingerprint = () => (existsSync(realSessionFile) ? createHash('sha1').update(readFileSync(realSessionFile)).digest('hex') : 'absent');

describe('ody launcher against a stub Odysseus', { skip: odyInstalled ? false : 'ody is not installed on this machine' }, () => {
  it('delivers a multi-line prompt intact, reads the reply, keeps the real session cache untouched and cleans up its own session', async () => {
    const requests = [];
    const server = await stubOdysseus({ requests, chat: (body, json) => json(200, { response: `<think>x</think>${JSON.stringify([proposal('Stub round trip stack')])}` }) });
    const before = fingerprint();
    const runDir = mkdtempSync(join(scratch, 'ody-'));
    const nasty = `line one\n"quotes" and 'single' and \`backticks\` and $(echo pwned) and \\ backslash\n${'x'.repeat(12000)}`;
    try {
      await withOdysseusEnv(`http://127.0.0.1:${server.address().port}`, async () => {
        const asker = createOdyAsker({ runDir });
        const session = asker.newSession('b1');
        const reply = await asker.ask(session, [{ role: 'user', content: nasty }], { timeoutMs: 30000 });
        assert.equal(extractProposalObjects(reply.text).items.length, 1);
        const chat = requests.find(r => r.url === '/api/chat');
        assert.equal(JSON.parse(chat.body).message, nasty, 'prompt arrives byte for byte');
        assert.equal(JSON.parse(chat.body).session, 'stub-session-1');
        assert.equal(chat.auth, 'Bearer stub-only');
        assert.ok(existsSync(join(session.home, '.nuke', 'odysseus-session')), 'session id is kept inside the scratch HOME');
        await asker.endSession(session);
        assert.ok(requests.some(r => r.method === 'DELETE' && r.url === '/api/session/stub-session-1'), 'the run deletes the session it made');
        assert.ok(!existsSync(session.home), 'scratch HOME removed');
      });
    } finally { server.close(); }
    assert.equal(fingerprint(), before, 'the shared ody session cache was not touched');
  });

  it('reports a workspace that is not running as a fatal, named failure', async () => {
    const probe = await stubOdysseus({ requests: [], chat: () => {} });
    const port = probe.address().port;
    await new Promise(r => probe.close(r));
    await withOdysseusEnv(`http://127.0.0.1:${port}`, async () => {
      const asker = createOdyAsker({ runDir: mkdtempSync(join(scratch, 'ody-')) });
      const session = asker.newSession('b1');
      await assert.rejects(asker.ask(session, [{ role: 'user', content: 'hi' }], { timeoutMs: 30000 }),
        error => error instanceof AskError && error.kind === 'ody_not_running' && error.fatal && /start-macos\.sh/.test(error.hint));
      await asker.endSession(session);
    });
  });

  it('recognizes the empty reply a thinking model leaves behind, through the real launcher', async () => {
    const server = await stubOdysseus({ requests: [], chat: (body, json) => json(200, { response: '', requested_model: 'qwen3.5:9b', model: 'qwen3.5:9b' }) });
    try {
      await withOdysseusEnv(`http://127.0.0.1:${server.address().port}`, async () => {
        const asker = createOdyAsker({ runDir: mkdtempSync(join(scratch, 'ody-')) });
        const session = asker.newSession('b1');
        await assert.rejects(asker.ask(session, [{ role: 'user', content: 'hi' }], { timeoutMs: 30000 }),
          error => error.kind === 'ody_empty_reply' && error.fatal && /qwen3\.5:9b/.test(error.detail.stdout));
        await asker.endSession(session);
      });
    } finally { server.close(); }
  });

  it('classifies an HTTP refusal as a non-fatal ody_http_error and a hung chat as a timeout', async () => {
    const requests = [];
    const server = await stubOdysseus({ requests, chat: (body, json, res) => (body.message === 'refuse' ? json(403, { detail: 'API token missing required scope: chat' }) : setTimeout(() => res.end('{}'), 20000).unref()) });
    try {
      await withOdysseusEnv(`http://127.0.0.1:${server.address().port}`, async () => {
        const asker = createOdyAsker({ runDir: mkdtempSync(join(scratch, 'ody-')) });
        const session = asker.newSession('b1');
        await assert.rejects(asker.ask(session, [{ role: 'user', content: 'refuse' }], { timeoutMs: 30000 }), error => error.kind === 'ody_http_error' && error.fatal === false);
        const started = Date.now();
        await assert.rejects(asker.ask(session, [{ role: 'user', content: 'hang' }], { timeoutMs: 700 }), error => error.kind === 'timeout');
        assert.ok(Date.now() - started < 10000);
        await asker.endSession(session);
      });
    } finally { server.closeAllConnections?.(); server.close(); }
  });
});

// ---- the registry hook --------------------------------------------------------------------------------------------------
describe('registry hook', () => {
  const index = buildIndex(atlas, registryFixture);
  const recordFor = (name, needs) => {
    const checked = validateProposal(proposal(name, needs));
    assert.equal(checked.ok, true, checked.errors.join('; '));
    return buildRecord({ proposal: checked.value, asker: { via: 'ollama', model: 'qwen3.5:9b' }, run: '20261007T000000Z', proposedAt: 'p', measuredAt: '2026-10-07T00:00:00.000Z', atlas, measured: measureNeeds(index, checked.value.needs), registry: registryFixture });
  };

  it('maps needs onto the registry kinds: tables and columns by their real names, phrases to substrates', () => {
    const record = recordFor('Registry mapping stack', [
      { layer: 'log', kind: 'table', object: 'bat_bid' },                 // singular spelling resolves to bat_bids
      { layer: 'key', kind: 'column', object: 'bat_bids.bidder_identity_id' },
      { layer: 'dimension', kind: 'dimension', object: 'place' },          // names the registry substrate "place entity"
      { layer: 'dimension', kind: 'dimension', object: 'Tidal Harmonics' }, // no substrate: becomes a new one
      { layer: 'outcome', kind: 'source', object: 'comment stance' },
      { layer: 'dimension', kind: 'dimension', object: 'exterior color family' }, // resolves to an existing column
    ]);
    const { stack, needs, newSubstrates, skipped } = toRegistryRows(record, registryFixture);
    assert.match(stack.stack_id, /^S[0-9A-Z]+$/);
    assert.deepEqual(needs.map(n => [n.layer, n.kind, n.object]), [
      ['log', 'table', 'bat_bids'], ['key', 'column', 'bat_bids.bidder_identity_id'], ['dimension', 'abstract', 'place entity'],
      ['dimension', 'abstract', 'Tidal Harmonics'], ['outcome', 'abstract', 'comment stance dimension'], ['dimension', 'column', 'vehicles.exterior_color_family']]);
    assert.deepEqual(newSubstrates, ['Tidal Harmonics']);
    assert.deepEqual(skipped, []);
    assert.equal(stack.status, 'proposed');
    assert.equal(stack.path.length, 9);
    assert.match(stack.path[0], /^log: /);
  });

  it('cites the registered stacks that already need the same table, column or substrate, with their live coverage', () => {
    const record = recordFor('Sharing check stack', [
      { layer: 'log', kind: 'table', object: 'bat_bids' },
      { layer: 'key', kind: 'column', object: 'bat_bids.bidder_identity_id' },
      { layer: 'dimension', kind: 'dimension', object: 'place' },
      { layer: 'dimension', kind: 'dimension', object: 'Tidal Harmonics' },
    ]);
    assert.deepEqual(record.shares_with, ['S01', 'S02', 'S04']);
    const byObject = Object.fromEntries(record.shares.map(sh => [sh.object, sh.stacks.map(t => [t.stack_id, t.coverage])]));
    assert.deepEqual(byObject, { bat_bids: [['S02', 1]], 'bat_bids.bidder_identity_id': [['S04', 0.5]], 'place entity': [['S01', 0], ['S04', 0.5]] });
    assert.deepEqual(sharedWith(record.needs, { stacks: [], needs: [] }), []);
    assert.deepEqual(recordFor('No registry given', undefined).shares.length > 0, true);
  });

  it('suggests the ledger\'s next stack number and slugs names for file names', () => {
    assert.equal(nextFreeStackId(registryFixture), 'S05');
    assert.equal(nextFreeStackId({ stacks: [] }), 'S01');
    const ledger = Array.from({ length: 60 }, (_, i) => ({ stack_id: `S${String(i + 1).padStart(2, '0')}` }));
    assert.equal(nextFreeStackId({ stacks: [...ledger, { stack_id: 'SA' }] }), 'S61', 'lettered stacks do not count');
    assert.equal(nextFreeStackId({ stacks: [...ledger, { stack_id: 'S61' }, { stack_id: 'S99' }] }), 'S62', 'a stray high number does not move the suggestion');
    assert.equal(slugify("O'Brien's Bidder Graph: v2!"), 'o-brien-s-bidder-graph-v2');
    assert.equal(slugify('!!!'), 'stack');
    assert.ok(slugify('x'.repeat(200)).length <= 60);
  });

  it('writes migration-ready INSERTs for one proposal: dependency order, no transaction control, quotes and control characters escaped', () => {
    const record = recordFor("O'Brien's bidder graph", undefined);
    record.proposal.who_cares = "Sellers who can't wait\nfor a reserve";
    const built = promotionSql(record, registryFixture);
    assert.equal(built.refused, undefined);
    const { sql, totals, stack_id } = built;
    assert.match(sql, /^-- PROMOTION CANDIDATE, NOT APPLIED\./);
    assert.ok(!/\b(BEGIN|COMMIT|ROLLBACK)\b;/.test(sql), 'a migration pastes this into its own transaction');
    assert.ok(sql.indexOf('INSERT INTO public.stack_substrates') < sql.indexOf('INSERT INTO public.stacks') && sql.indexOf('INSERT INTO public.stacks') < sql.indexOf('INSERT INTO public.stack_needs'));
    assert.match(sql, /'O''Brien''s bidder graph'/);
    assert.match(sql, /'Sellers who can''t wait for a reserve'/);
    assert.match(sql, /Stack id SG[0-9A-F]{8} is the generator's\. The ledger's next free number is S05/);
    assert.match(sql, /Already needed by registered stacks[\s\S]*log table bat_bids: S02 \(1\)/);
    assert.match(sql, /key column bat_bids\.bidder_identity_id: S04 \(0\.5\)/);
    assert.deepEqual(totals, { needs: 5, substrates: 2, skipped: 0 });
    assert.equal(stack_id, stackIdFor("O'Brien's bidder graph"));
    assert.ok(!/DELETE|UPDATE|DROP|TRUNCATE/.test(sql), 'inserts only');
  });

  it('uses a chosen stack id, and refuses a bad or taken id and a name the registry already holds', () => {
    const record = recordFor('Chosen id stack', undefined);
    assert.match(promotionSql(record, registryFixture, { stackId: 'S05' }).sql, /VALUES \('S05', 1, 'Chosen id stack'/);
    assert.match(promotionSql(record, registryFixture, { stackId: 's05' }).refused, /not in the registry's S\[0-9A-Z\]\+ form/);
    assert.match(promotionSql(record, registryFixture, { stackId: 'S03' }).refused, /already taken/);
    const repeat = recordFor('Auction rhythm spectrum', undefined);
    assert.match(promotionSql(repeat, registryFixture).refused, /already holds "Auction rhythm spectrum" \(S04\)/);
  });

  it('writes one file per proposal into promote/ named for the proposal, and nothing else', async () => {
    const root = mkdtempSync(join(scratch, 'promote-'));
    const a = recordFor('First promoted stack', undefined);
    const b = recordFor('Second promoted stack', undefined);
    const repeat = recordFor('Auction rhythm spectrum', undefined);
    const out = await writeToRegistry([a, b, repeat], { logRoot: root, registry: registryFixture });
    assert.equal(out.written, 0);
    assert.deepEqual(readdirSync(join(root, 'promote')).sort(), ['first-promoted-stack.sql', 'second-promoted-stack.sql']);
    assert.deepEqual(out.skipped.map(x => x.name), ['Auction rhythm spectrum']);
    assert.match(out.note, /no writer function/);
    assert.deepEqual(await writeToRegistry([], { logRoot: root }), { written: 0, note: 'no proposals to hand over' });
    const one = writePromotion(a, registryFixture, { dir: join(root, 'promote'), stackId: 'S05' });
    assert.equal(one.stack_id, 'S05');
    assert.match(readFileSync(one.file, 'utf8'), /VALUES \('S05', 1, 'First promoted stack'/);
  });
});

// ---- promoting a chosen proposal -----------------------------------------------------------------------------------------
describe('promote', () => {
  const index = buildIndex(atlas, registryFixture);
  const rec = (name, needs) => {
    const checked = validateProposal(proposal(name, needs));
    return buildRecord({ proposal: checked.value, asker: { via: 'ollama', model: 'm' }, run: '20261007T000000Z', proposedAt: '2026-10-07T00:00:00.000Z', measuredAt: '2026-10-07T00:00:00.000Z', atlas, measured: measureNeeds(index, checked.value.needs), registry: registryFixture });
  };
  const all = [
    rec('Low ranked stack', [{ layer: 'log', kind: 'table', object: 'nothing_here' }, { layer: 'key', kind: 'column', object: 'nope.nope' }, { layer: 'dimension', kind: 'dimension', object: 'tidal harmonics' }]),
    rec('High ranked stack', [{ layer: 'log', kind: 'table', object: 'bat_bids' }, { layer: 'key', kind: 'column', object: 'bat_bids.bidder_identity_id' }, { layer: 'outcome', kind: 'table', object: 'places' }]),
  ];

  it('chooses by rank in INDEX order, proposal id, registry id, or name', () => {
    assert.deepEqual(rankRecords(all).map(r => r.name), ['High ranked stack', 'Low ranked stack']);
    assert.equal(choose(all, '1').name, 'High ranked stack');
    assert.equal(choose(all, '#2').name, 'Low ranked stack');
    assert.equal(choose(all, all[0].id).name, 'Low ranked stack');
    assert.equal(choose(all, all[1].registry_stack_id.toLowerCase()).name, 'High ranked stack');
    assert.equal(choose(all, 'the Low-ranked STACK').name, 'Low ranked stack');
    assert.equal(choose(all, '3'), null);
    assert.equal(choose(all, 'no such stack'), null);
  });

  it('writes the chosen proposal to promote/, reading the registry fresh, and says where', async () => {
    const root = mkdtempSync(join(scratch, 'promote-run-'));
    const dir = join(root, 'proposals');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'a.jsonl'), all.map(r => JSON.stringify(r)).join('\n') + '\n');
    const lines = [];
    const log = console.log;
    console.log = (...a) => lines.push(a.join(' '));
    let code;
    try { code = await promoteMain(['1', '--stack-id', 'S05', '--log-dir', root], { loadRegistry: async () => registryFixture }); } finally { console.log = log; }
    assert.equal(code, 0);
    const sql = readFileSync(join(root, 'promote', 'high-ranked-stack.sql'), 'utf8');
    assert.match(sql, /VALUES \('S05', 1, 'High ranked stack'/);
    assert.match(lines.join('\n'), /nothing was applied/);
  });

  it('fails clearly: nothing matches, the registry is unreadable, the registry already has the name, no selector', async () => {
    const root = mkdtempSync(join(scratch, 'promote-run-'));
    mkdirSync(join(root, 'proposals'), { recursive: true });
    writeFileSync(join(root, 'proposals', 'a.jsonl'), all.map(r => JSON.stringify(r)).join('\n') + '\n');
    const quietErr = async fn => { const err = console.error, log = console.log; console.error = () => {}; console.log = () => {}; try { return await fn(); } finally { console.error = err; console.log = log; } };
    assert.equal(await quietErr(() => promoteMain(['9', '--log-dir', root], { loadRegistry: async () => registryFixture })), 1);
    assert.equal(await quietErr(() => promoteMain(['1', '--log-dir', root], { loadRegistry: async () => ({ available: false, error: 'down', stacks: [], needs: [], substrates: [] }) })), 1);
    const held = { ...registryFixture, stacks: [...registryFixture.stacks, { stack_id: 'S70', name: 'High ranked stack', coverage: 0 }] };
    assert.equal(await quietErr(() => promoteMain(['1', '--log-dir', root], { loadRegistry: async () => held })), 1);
    assert.equal(existsSync(join(root, 'promote', 'high-ranked-stack.sql')), false);
    assert.equal(await quietErr(() => promoteMain([], {})), 2);
    assert.equal(await quietErr(() => promoteMain(['1', '--bogus'], {})), 2);
  });
});

// ---- propose end to end, with a fake asker ----------------------------------------------------------------------------
const fakeAsker = replies => {
  const asked = [];
  const asker = {
    via: 'fake', model: 'fake-1', ended: 0,
    newSession: tag => ({ tag }),
    async ask(_session, messages) {
      asked.push(messages.map(m => m.role));
      const next = replies.shift();
      if (next instanceof Error) throw next;
      return { text: next, ms: 12, meta: { output_tokens: 99 } };
    },
    async endSession() { asker.ended++; },
  };
  return { asker, asked };
};
const existing = { found: true, stacks: [{ name: 'Liquidity surface' }, { name: 'Odometer honesty' }] };
const quiet = async (fn) => { const log = console.log; console.log = () => {}; try { return await fn(); } finally { console.log = log; } };

describe('propose', () => {
  it('parses flags and environment with bounds', () => {
    const o = parseArgs(['--n', '3'], { STACKS_BATCH: '8', STACKS_ASKER: 'ollama' });
    assert.deepEqual([o.n, o.batch, o.asker, o.registry, o.dryRun], [3, 3, 'ollama', false, false]);
    assert.equal(parseArgs([], {}).n, 10);
    assert.equal(parseArgs([], { STACKS_N: '20' }).n, 20);
    assert.throws(() => parseArgs(['--n', '0'], {}), /STACKS_N/);
    assert.throws(() => parseArgs(['--bogus'], {}), /unknown argument/);
    assert.equal(parseArgs([], { STACKS_ASKER: 'auto' }).asker, 'auto');
    assert.throws(() => parseArgs([], { STACKS_ASKER: 'gpt' }), /ody, ollama or auto/);
  });

  it('admits valid new names, drops repeats and malformed elements, caps at the limit', () => {
    const items = [proposal('Bidder tenure pace'), proposal('Liquidity surface'), { name: 'Broken one here' }, proposal('Bidder tenure pace'), proposal('Escrow delay penalties'), proposal('Wheel offset rarity')];
    const r = admit(items, existing.stacks, [], 2);
    assert.deepEqual(r.admitted.map(p => p.name), ['Bidder tenure pace', 'Escrow delay penalties']);
    assert.deepEqual(r.rejected.map(x => x.reason), ['duplicate', 'malformed', 'duplicate']);
    assert.equal(r.surplus, 1);
  });

  it('retries once with a repair prompt when the reply is not JSON, in the same session', async () => {
    const dir = mkdtempSync(join(scratch, 'batch-'));
    const { asker, asked } = fakeAsker(['Sorry, here is some prose.', JSON.stringify([proposal('Recovered after repair')])]);
    const out = await askBatch({ asker, runDir: dir, tag: 'b1', k: 1, prompt: 'p', known: [], taken: [], deadline: Date.now() + 60000, askTimeoutMs: 1000, rawLog: join(dir, 'raw.log'), useSchema: false });
    assert.deepEqual(out.admitted.map(p => p.name), ['Recovered after repair']);
    assert.equal(out.calls.length, 2);
    assert.equal(out.calls[1].repair, true);
    assert.deepEqual(asked[1], ['user', 'assistant', 'user'], 'the repair sees the earlier exchange');
    assert.equal(asker.ended, 1);
    assert.doesNotMatch(readFileSync(join(dir, 'raw.log'), 'utf8'), /undefined/);
  });

  it('does not spend a repair on a reply that held valid duplicates', async () => {
    const dir = mkdtempSync(join(scratch, 'batch-'));
    const { asker } = fakeAsker([JSON.stringify([proposal('Liquidity surface')])]);
    const out = await askBatch({ asker, runDir: dir, tag: 'b1', k: 1, prompt: 'p', known: existing.stacks, taken: [], deadline: Date.now() + 60000, askTimeoutMs: 1000, rawLog: join(dir, 'raw.log'), useSchema: false });
    assert.equal(out.admitted.length, 0);
    assert.equal(out.calls.length, 1);
  });

  it('runs end to end: batches until N, JSONL with verdicts, INDEX sorted, run.json, audit log', async () => {
    const logRoot = mkdtempSync(join(scratch, 'run-'));
    const replies = [
      JSON.stringify([proposal('Bid pace by bidder tenure'), proposal('Liquidity surface')]), // one new, one repeat of an existing stack
      `<think>hmm</think>\`\`\`json\n${JSON.stringify([proposal('Comment stance and closing price', [
        { layer: 'log', kind: 'table', object: 'auction_comments' }, { layer: 'log', kind: 'table', object: 'bat_bids' },
        { layer: 'key', kind: 'column', object: 'bat_bids.bidder_identity_id' }, { layer: 'outcome', kind: 'table', object: 'places' }])])}\n\`\`\``,
    ];
    const { asker } = fakeAsker(replies);
    const code = await quiet(() => main(['--n', '2', '--batch', '2', '--log-dir', logRoot], { STACKS_BUDGET_S: '600' }, { loadAtlas: async () => atlas, loadRegistry: async () => registryFixture, makeAsker: () => asker, existing, earlier: [] }));
    assert.equal(code, 0);
    const runs = readdirSync(join(logRoot, 'runs'));
    assert.equal(runs.length, 1);
    const files = readdirSync(join(logRoot, 'proposals'));
    assert.equal(files.length, 1);
    const lines = readFileSync(join(logRoot, 'proposals', files[0]), 'utf8').trim().split('\n').map(l => JSON.parse(l));
    assert.deepEqual(lines.map(l => l.name), ['Bid pace by bidder tenure', 'Comment stance and closing price']);
    assert.equal(lines[1].coverage.coverage, 1);
    assert.equal(lines[1].status, 'proposed');
    assert.deepEqual(lines[1].asker, { via: 'fake', model: 'fake-1' });
    assert.ok(lines[0].needs.every(n => ['present', 'partial', 'missing'].includes(n.verdict) && n.evidence));
    const index = readFileSync(join(logRoot, 'INDEX.md'), 'utf8');
    assert.ok(index.indexOf('Comment stance and closing price') < index.indexOf('Bid pace by bidder tenure'), 'higher coverage first');
    const summary = JSON.parse(readFileSync(join(logRoot, 'runs', runs[0], 'run.json'), 'utf8'));
    assert.equal(summary.accepted.length, 2);
    assert.equal(summary.rejected[0].reason, 'duplicate');
    assert.equal(summary.exit_code, 0);
    assert.ok(existsSync(join(logRoot, 'runs', runs[0], 'fake-raw.log')), 'raw replies are kept for audit, named for the asker that answered');
    assert.ok(!existsSync(join(logRoot, '.lock')), 'lock released');
  });

  it('exits 3 and writes nothing when the asker is unavailable, naming the fix', async () => {
    const logRoot = mkdtempSync(join(scratch, 'run-'));
    const { asker } = fakeAsker([new AskError('ody_not_running', 'Odysseus is not running on 127.0.0.1:7860.', { fatal: true })]);
    const code = await quiet(() => main(['--n', '2', '--log-dir', logRoot], {}, { loadAtlas: async () => atlas, loadRegistry: async () => registryFixture, makeAsker: () => asker, existing, earlier: [] }));
    assert.equal(code, 3);
    assert.equal(existsSync(join(logRoot, 'proposals')) ? readdirSync(join(logRoot, 'proposals')).length : 0, 0);
    const runs = readdirSync(join(logRoot, 'runs'));
    const summary = JSON.parse(readFileSync(join(logRoot, 'runs', runs[0], 'run.json'), 'utf8'));
    assert.equal(summary.fatal.kind, 'ody_not_running');
  });

  it('stops after two consecutive transport failures and keeps what it has', async () => {
    const logRoot = mkdtempSync(join(scratch, 'run-'));
    const { asker } = fakeAsker([JSON.stringify([proposal('Kept before failures')]), new AskError('timeout', 'slow'), new AskError('timeout', 'slow')]);
    const code = await quiet(() => main(['--n', '5', '--batch', '1', '--log-dir', logRoot], {}, { loadAtlas: async () => atlas, loadRegistry: async () => registryFixture, makeAsker: () => asker, existing, earlier: [] }));
    assert.equal(code, 0);
    const lines = readFileSync(join(logRoot, 'proposals', readdirSync(join(logRoot, 'proposals'))[0]), 'utf8').trim().split('\n');
    assert.equal(lines.length, 1);
  });

  it('auto mode: a fatal failure on ody switches to ollama, which finishes the batch; the switch is recorded', async () => {
    const logRoot = mkdtempSync(join(scratch, 'run-'));
    const down = fakeAsker([new AskError('ody_not_running', 'Odysseus is not running on 127.0.0.1:7860.', { fatal: true })]);
    down.asker.via = 'ody';
    const up = fakeAsker([JSON.stringify([proposal('Answered by the fallback')])]);
    up.asker.via = 'ollama';
    const made = [];
    const code = await quiet(() => main(['--n', '1', '--asker', 'auto', '--log-dir', logRoot], {}, {
      loadAtlas: async () => atlas, loadRegistry: async () => registryFixture, existing, earlier: [], makeAsker: kind => { made.push(kind); return kind === 'ody' ? down.asker : up.asker; },
    }));
    assert.equal(code, 0);
    assert.deepEqual(made, ['ody', 'ollama']);
    const runs = readdirSync(join(logRoot, 'runs'));
    const summary = JSON.parse(readFileSync(join(logRoot, 'runs', runs[0], 'run.json'), 'utf8'));
    assert.equal(summary.asker_switches.length, 1);
    assert.equal(summary.asker_switches[0].kind, 'ody_not_running');
    const line = JSON.parse(readFileSync(join(logRoot, 'proposals', readdirSync(join(logRoot, 'proposals'))[0]), 'utf8').trim());
    assert.equal(line.asker.via, 'ollama');
    assert.match(readFileSync(join(logRoot, 'runs', runs[0], 'ody-raw.log'), 'utf8'), /FAILED ody_not_running/, 'the failed ask is in the audit log');
  });

  it('auto mode: a reply with nothing parseable (after the repair prompt) also switches to the fallback', async () => {
    const logRoot = mkdtempSync(join(scratch, 'run-'));
    const prose = fakeAsker(['I think the answer is hard.', 'Still no JSON, sorry.']);
    prose.asker.via = 'ody';
    const good = fakeAsker([JSON.stringify([proposal('Fallback after prose')])]);
    good.asker.via = 'ollama';
    const code = await quiet(() => main(['--n', '1', '--asker', 'auto', '--log-dir', logRoot], {}, {
      loadAtlas: async () => atlas, loadRegistry: async () => registryFixture, existing, earlier: [], makeAsker: kind => (kind === 'ody' ? prose.asker : good.asker),
    }));
    assert.equal(code, 0);
    const runs = readdirSync(join(logRoot, 'runs'));
    const summary = JSON.parse(readFileSync(join(logRoot, 'runs', runs[0], 'run.json'), 'utf8'));
    assert.equal(summary.asker_switches[0].kind, 'no_usable_reply');
    assert.equal(summary.calls.filter(c => c.via === 'ody').length, 2, 'one ask plus one repair on ody, then the switch');
    assert.equal(summary.accepted.length, 1);
  });

  it('single asker: an empty ody reply ends the run at once with exit 3 and the reason', async () => {
    const logRoot = mkdtempSync(join(scratch, 'run-'));
    const { asker, asked } = fakeAsker([new AskError('ody_empty_reply', 'Odysseus answered with an empty response.', { fatal: true })]);
    const code = await quiet(() => main(['--n', '5', '--log-dir', logRoot], {}, { loadAtlas: async () => atlas, loadRegistry: async () => registryFixture, makeAsker: () => asker, existing, earlier: [] }));
    assert.equal(code, 3);
    assert.equal(asked.length, 1, 'no repair prompt and no second batch after an empty reply');
  });

  it('stops after two batches that return nothing parseable when there is no fallback', async () => {
    const logRoot = mkdtempSync(join(scratch, 'run-'));
    const { asker, asked } = fakeAsker(['prose', 'prose again', 'more prose', 'and more', 'unused']);
    const code = await quiet(() => main(['--n', '5', '--log-dir', logRoot], {}, { loadAtlas: async () => atlas, loadRegistry: async () => registryFixture, makeAsker: () => asker, existing, earlier: [] }));
    assert.equal(code, 1);
    assert.equal(asked.length, 4, 'two batches, each an ask plus one repair');
  });

  it('does not ask anything on a dry run', async () => {
    const logRoot = mkdtempSync(join(scratch, 'run-'));
    let made = 0;
    const code = await quiet(() => main(['--dry-run', '--n', '3', '--log-dir', logRoot], {}, { loadAtlas: async () => atlas, loadRegistry: async () => registryFixture, makeAsker: () => { made++; }, existing, earlier: [] }));
    assert.equal(code, 0);
    assert.equal(made, 0);
  });

  it('with --registry, writes one migration-ready file per proposal into promote/ and applies nothing', async () => {
    const logRoot = mkdtempSync(join(scratch, 'run-'));
    const { asker } = fakeAsker([JSON.stringify([proposal('Registry hook check')])]);
    const lines = [];
    const log = console.log;
    console.log = (...a) => lines.push(a.join(' '));
    try {
      await main(['--n', '1', '--registry', '--log-dir', logRoot], {}, { loadAtlas: async () => atlas, loadRegistry: async () => registryFixture, makeAsker: () => asker, existing, earlier: [] });
    } finally { console.log = log; }
    assert.ok(lines.some(l => /registry: the registry has no writer function/.test(l)), lines.join('\n'));
    const files = readdirSync(join(logRoot, 'promote'));
    assert.deepEqual(files, ['registry-hook-check.sql']);
    const sql = readFileSync(join(logRoot, 'promote', files[0]), 'utf8');
    assert.match(sql, /NOT APPLIED/);
    assert.match(sql, /INSERT INTO public\.stacks \(stack_id, version, name,/);
    assert.match(sql, new RegExp(`'${stackIdFor('Registry hook check')}', 1, 'Registry hook check'`));
  });

  it('rejects a proposal that repeats a stack only the registry holds', async () => {
    const logRoot = mkdtempSync(join(scratch, 'run-'));
    const { asker } = fakeAsker([JSON.stringify([proposal('Auction rhythm spectrum'), proposal('Escrow delay penalties')])]);
    const code = await quiet(() => main(['--n', '1', '--batch', '2', '--log-dir', logRoot], {}, { loadAtlas: async () => atlas, loadRegistry: async () => registryFixture, makeAsker: () => asker, existing, earlier: [] }));
    assert.equal(code, 0);
    const summary = JSON.parse(readFileSync(join(logRoot, 'runs', readdirSync(join(logRoot, 'runs'))[0], 'run.json'), 'utf8'));
    assert.deepEqual(summary.rejected.map(r => [r.reason, r.name, r.of]), [['duplicate', 'Auction rhythm spectrum', 'Auction rhythm spectrum']]);
    assert.deepEqual(summary.accepted.map(a => a.name), ['Escrow delay penalties']);
  });

  it('goes on without the registry when it cannot be read, and says so', async () => {
    const logRoot = mkdtempSync(join(scratch, 'run-'));
    const { asker } = fakeAsker([JSON.stringify([proposal('Escrow delay penalties')])]);
    const lines = [];
    const log = console.log;
    console.log = (...a) => lines.push(a.join(' '));
    try {
      const code = await main(['--n', '1', '--log-dir', logRoot], {}, { loadAtlas: async () => atlas, loadRegistry: async () => ({ available: false, error: 'relation does not exist', stacks: [], substrates: [] }), makeAsker: () => asker, existing, earlier: [] });
      assert.equal(code, 0);
    } finally { console.log = log; }
    assert.ok(lines.some(l => /registry not read \(relation does not exist\)/.test(l)));
  });
});
