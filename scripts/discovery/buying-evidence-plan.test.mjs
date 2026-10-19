import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from './buying-evidence.mjs';
import { PLAN_CAPTURE_VERSION, planSQL, loadKeywordTable, validateKeywordTable, buildIdentity, buildClaims,
  matchOperations, buildChecklist, collectPlan, buildPlanReport, renderPlanText, liters, modelTokens } from './buying-evidence-plan.mjs';

// Synthetic fixtures only: invented IDs, listing text and catalog rows.
const ID = '11111111-1111-4111-8111-111111111111';
const IMG = '22222222-2222-4222-8222-222222222222';
const OBS = '33333333-3333-4333-8333-333333333333';
const OBS2 = '44444444-4444-4444-8444-444444444444';
const DD = '55555555-5555-4555-8555-555555555555';
const DD_FAIL = '66666666-6666-4666-8666-666666666666';
const DATE = '2026-10-19T06:00:00.123456Z';
const LISTING = 'https://bringatrailer.com/listing/example-truck';
const table = loadKeywordTable();
const options = { vehicleIds: [ID], query: null, pageSize: 50, maxPages: 2, seconds: 30 };
const parent = { id: ID, year: 1980, make: 'Chevrolet', model: 'K10', vin: null, engine_size: '6.6L V8', engine_liters: null,
  engine_displacement: null, displacement: null, transmission: 'Manual', drivetrain: '4WD', listing_url: LISTING,
  description: 'This 1980 Chevrolet K30 crew cab is powered by a 5.7-liter V8 with a 4-barrel carburetor. A dent is visible on the RR quarter. The frame is rust-free. The muffler has a leak.',
  description_bytes: 180 };
const discovery = { id: DD, vehicle_id: ID, discovered_at: DATE, model_used: 'example-model', prompt_version: 'v3', is_failure: false,
  raw_extraction: { auth: 0.7, e_fuel: 'fuel-injected', e_liters: 5.7, t_type: 'manual', drive: '4WD',
    flags: [{ f: 'Fading paint on the hood', sev: 'low' }], work: [{ w: 'Brake fluid flushed', d: null, s: null }],
    mods: ['2.5 inch lift'], docs: ['Build sheet'], title: 'clean', miles: 56000, mi_unit: 'miles' } };
const failure = { id: DD_FAIL, vehicle_id: ID, discovered_at: DATE, is_failure: true, raw_extraction: null, structured_bytes: 80 };
const imageObs = (id, source, imageVehicle = ID) => ({ id, vehicle_id: ID, source_url: null, observed_at: DATE, ingested_at: DATE,
  extraction_method: 'example_image_reader', confidence_score: '0.80', content_text: null,
  structured_data: { analysis_kind: 'image_deep_byok', image_id: IMG, state_observations: { damage_callouts: ['surface rust on rocker'], rust_severity: 'surface' } },
  image_id: IMG, image_vehicle_id: imageVehicle, image_source: source, image_is_sensitive: false });
const reference = {
  labor_operations: { state: 'read', rows: [
    { code: 'BODY-DENT-SMALL', name: 'Small dent', system: 'body', base_hours: '0.5', model_year_min: 1960, model_year_max: 2000 },
    { code: 'BODY-DENT-MED', name: 'Medium dent', system: 'body', base_hours: '1.5', model_year_min: 1960, model_year_max: 2000 },
    { code: 'BODY-DENT-LARGE', name: 'Large dent', system: 'body', base_hours: '3.0', model_year_min: 1960, model_year_max: 1975 },
    { code: 'EXH-MUFFLER-RR', name: 'Muffler R&R', system: 'exhaust', base_hours: '1.0', model_year_min: null, model_year_max: null },
    { code: 'PAINT-COMPLETE-PANEL', name: 'Panel paint', system: 'paint', base_hours: '4.0', model_year_min: 1960, model_year_max: 2000 }] },
  stage_map: { state: 'read', rows: [
    ['fabricated', 'primed', 1, 2, 3, 40, 120], ['primed', 'blocked', 2, 3, 6, 20, 60],
    ['blocked', 'basecoated', 1, 2, 3, 60, 200], ['basecoated', 'clearcoated', 0.5, 1, 2, 40, 120]]
    .map(([from, to, min, typ, max, mmin, mmax], i) => ({ id: `${i}`, category: 'body', from_stage: from, to_stage: to,
      zone_pattern: 'panel_*', description: `${from} to ${to}`, estimated_hours_min: min, estimated_hours_typical: typ,
      estimated_hours_max: max, materials_cost_min: mmin, materials_cost_max: mmax, confidence: 'high' })) },
  rate: { state: 'read', value: { rate: 160, source: 'spitball', rate_confidence: 'spitball_no_data', authenticated_sample_n: 4 } },
};

test('every plan read is read-only, time-bounded and parent-gated; the rate call passes no arguments', () => {
  const page = { id: ID, cutoff: DATE, pageSize: 10 };
  for (const [kind, args] of [['parent', { id: ID }], ['vin_decode', { id: ID, vin: '1GCEK14K8RZ123456' }],
    ['discoveries', page], ['condition', page], ['parts', { id: ID, term: 'muffler', tokens: ['K10'], year: 1980 }]]) {
    const sql = planSQL(kind, args);
    assert.match(sql, /^BEGIN READ ONLY; SET LOCAL statement_timeout='5s';/);
    assert.match(sql, /is_public IS TRUE/);
    assert.match(sql, /deleted_at IS NULL/);
    assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|work_contracts)\b/i);
  }
  assert.match(planSQL('discoveries', page), /123456Z/);
  assert.match(planSQL('condition', page), /observation_is_public/);
  assert.match(planSQL('parts', { id: ID, term: 'muffler', tokens: ['K10'], year: 1980 }), /price_current>0/);
  assert.equal(planSQL('rate'), "BEGIN READ ONLY; SET LOCAL statement_timeout='5s'; SELECT public.resolve_labor_rate() AS rate; COMMIT;");
  assert.throws(() => planSQL('parent', { id: "'; DROP TABLE vehicles;--" }));
  assert.throws(() => planSQL('vin_decode', { id: ID, vin: "1GCEK14K8RZ12345'" }));
  assert.throws(() => planSQL('parts', { id: ID, term: "muffler%' OR 1=1", tokens: ['K10'], year: 1980 }));
  assert.throws(() => planSQL('parts', { id: ID, term: 'muffler', tokens: ["K10'"], year: 1980 }));
  assert.throws(() => planSQL('discoveries', { ...page, pageSize: 201 }));
});

test('checked-in keyword table validates; malformed tables are refused', () => {
  assert.equal(table.schema_version, 'buying_plan_keywords_v1');
  assert.ok(table.entries.length > 10);
  for (const patch of [{ schema_version: 'x' }, { entries: [] },
    { entries: [{ ...table.entries[0], pattern: '(' }] },
    { entries: [{ ...table.entries[0], targets: [{ type: 'price', code: 'X' }] }] },
    { entries: [{ ...table.entries[0], system: 'paint' }] },
    { entries: [table.entries[0], table.entries[0]] }])
    assert.throws(() => validateKeywordTable({ ...table, ...patch }));
});

test('units normalize to liters and model tokens stay bounded', () => {
  assert.equal(liters('350 ci'), 5.7);
  assert.equal(liters('6.6L V8'), 6.6);
  assert.equal(liters('454'), 7.4);
  assert.equal(liters('1600'), 1.6);
  assert.equal(liters('V8'), null);
  assert.deepEqual(modelTokens('K5 Blazer CST 4×4'), ['K5', 'BLAZER', 'CST', '4']);
});

test('identity conflicts come first: record vs listing text vs extraction vs VIN decode', () => {
  const identity = buildIdentity(parent, [], discovery, table);
  assert.equal(identity.fields.model.status, 'conflict');
  assert.equal(identity.fields.engine_displacement_l.status, 'conflict');
  assert.equal(identity.fields.induction.status, 'conflict');
  assert.equal(identity.fields.year.status, 'agree');
  assert.equal(identity.fields.transmission.status, 'agree');
  const text = identity.fields.model.values.find(v => v.source === 'listing_text');
  assert.equal(text.value, 'k30');
  assert.equal(Array.from(parent.description).slice(text.excerpt.start, text.excerpt.end).join(''), text.excerpt.quote);
  const decoded = buildIdentity({ ...parent, description: null, model: 'LX450', vin: 'JT6HJ88J0V0000000' },
    [{ make: 'LEXUS', model: 'LX', year: 1980, error_code: '0', provider: 'nhtsa' }], null, table);
  assert.equal(decoded.fields.model.status, 'unresolved_specificity');
  assert.equal(decoded.vin_decode.state, 'usable');
  const failedDecode = buildIdentity({ ...parent, description: null }, [{ make: 'OTHER', year: 1999, error_code: '8' }], null, table);
  assert.equal(failedDecode.vin_decode.state, 'error_code_not_success');
  assert.equal(failedDecode.fields.year.status, 'single_source');
});

test('claims keep verbatim excerpts, sources and clocks; failure rows and unattributed images are excluded and counted', () => {
  const rows = [imageObs(OBS, 'bat_import'), imageObs(OBS2, 'iphoto'),
    { ...imageObs('77777777-7777-4777-8777-777777777777', 'bat_import'), image_vehicle_id: null }];
  const { claims, exclusions } = buildClaims(parent, [discovery, failure], rows, table);
  assert.equal(exclusions.description_discovery_failure_rows, 1);
  assert.equal(exclusions.image_claims_excluded_unattributed, 1);
  assert.equal(exclusions.image_claims_excluded_image_row_missing, 1);
  const statement = claims.find(c => c.kind === 'listing_statement' && /muffler/.test(c.text));
  assert.equal(statement.excerpt_status, 'exact_excerpt_in_listing_text');
  assert.equal(statement.source.source_url, LISTING);
  const flag = claims.find(c => c.source.path === '/raw_extraction/flags/0/f');
  assert.equal(flag.verbatim_excerpt, null);
  assert.equal(flag.excerpt_status, 'extraction_paraphrase_no_exact_excerpt');
  assert.equal(flag.confidence.value, null);
  assert.equal(flag.clocks.extracted_at, DATE);
  const image = claims.filter(c => c.source.ref === `vehicle_observations:${OBS}`);
  assert.equal(image.length, 2);
  assert.equal(image[0].confidence.value, 0.8);
  assert.match(image[0].source.method, /image_inference_unverified/);
  assert.ok(!claims.some(c => c.source.ref === `vehicle_observations:${OBS2}`));
  assert.ok(claims.some(c => c.kind === 'reported_completed_work'));
  assert.ok(claims.some(c => c.kind === 'odometer'));
});

test('candidate operations come from the keyword table with seed ranges; negated and completed-work claims do not', () => {
  const { claims } = buildClaims(parent, [discovery], [], table);
  const { operations, keyword_matches_excluded_by_rule } = matchOperations(claims, table, reference, 1980);
  const ids = operations.map(op => op.keyword_entry_id).sort();
  assert.deepEqual(ids, ['dent', 'exhaust', 'paint_refinish']);
  assert.ok(keyword_matches_excluded_by_rule >= 1);
  const dent = operations.find(op => op.keyword_entry_id === 'dent');
  assert.equal(dent.targets[0].hours.typical, 0.5);
  assert.equal(dent.targets[0].hours.min, null);
  assert.equal(dent.targets[0].label, 'seed_uncalibrated');
  assert.equal(dent.targets[2].year_applicability, 'out_of_range');
  const chain = operations.find(op => op.keyword_entry_id === 'paint_refinish').targets.find(t => t.type === 'stage_chain');
  assert.deepEqual(chain.hours, { min: 4.5, typical: 8, max: 14 });
  assert.equal(chain.materials.currency, 'unstated_in_reference');
  const missing = matchOperations(claims, table, { ...reference, labor_operations: { state: 'read_failed' } }, 1980);
  assert.equal(missing.operations.find(op => op.keyword_entry_id === 'exhaust').targets[0].state, 'reference_unavailable');
  assert.ok(!operations.some(op => op.claim_ids.some(id => claims.find(c => c.claim_id === id).kind === 'reported_completed_work')));
});

test('PPI checklist has a pre_purchase finding slot for every conflict and every claim', () => {
  const identity = buildIdentity(parent, [], discovery, table);
  const { claims } = buildClaims(parent, [discovery], [], table);
  const { operations } = matchOperations(claims, table, reference, 1980);
  const items = buildChecklist(identity, claims, operations);
  assert.equal(items.filter(i => i.basis === 'identity_conflict').length, identity.conflicts.length);
  assert.deepEqual(new Set(items.flatMap(i => i.claim_ids || [])), new Set(claims.map(c => c.claim_id)));
  for (const item of items) {
    assert.equal(item.finding.inspection_type, 'pre_purchase');
    assert.equal(item.finding.verdict, null);
    assert.equal(item.finding.severity, null);
  }
  assert.equal(items[0].order, 0);
});

const fakeDb = (overrides = {}) => {
  const calls = [];
  const db = async sql => {
    calls.push(sql);
    for (const [needle, value] of Object.entries(overrides)) if (sql.includes(needle)) {
      if (value instanceof Error) throw value;
      return value;
    }
    if (sql.includes('FROM public.labor_operations')) return reference.labor_operations.rows;
    if (sql.includes('FROM public.stage_transition_labor_map')) return reference.stage_map.rows;
    if (sql.includes('resolve_labor_rate')) return [{ rate: reference.rate.value }];
    if (sql.includes('FROM public.vehicles WHERE id=')) return [parent];
    if (sql.includes('FROM public.description_discoveries')) return sql.includes('AND id >') ? [] : [discovery, failure].sort((a, b) => a.id.localeCompare(b.id));
    if (sql.includes('FROM public.vehicle_observations')) return sql.includes('AND o.id >') ? [] : [imageObs(OBS, 'bat_import')];
    if (sql.includes('FROM public.catalog_parts')) return sql.includes("'%muffler%'")
      ? [{ id: 'part-1', part_number: 'EX-1', name: 'EXAMPLE MUFFLER', price_current: '99.50', currency: 'USD', fits_models: ['K10'], year_start: 1973, year_end: 1987 }] : [];
    return [];
  };
  return { db, calls };
};

test('collection reads parents first, records receipts, and reports parts only from priced text-fitment rows', async () => {
  const { db, calls } = fakeDb();
  const capture = await collectPlan(options, db, table);
  assert.equal(capture.schema_version, PLAN_CAPTURE_VERSION);
  assert.ok(calls.every(sql => sql.startsWith('BEGIN READ ONLY')));
  assert.ok(capture.reads.every(r => r.query_sha256.length === 64));
  const report = buildPlanReport(capture);
  const v = report.vehicles[0];
  assert.deepEqual(report.rate.value, reference.rate.value);
  assert.equal(report.rate.contract_branch, 'not_executed_requires_client_and_organization');
  const muffler = v.parts.find(p => p.term === 'muffler');
  assert.equal(muffler.state, 'priced_text_fitment_match');
  assert.equal(muffler.fitment, 'text_match_unverified');
  assert.equal(muffler.identity_dependency, 'identity_conflict_unresolved_fitment_unusable');
  assert.equal(muffler.rows[0].price_current, 99.5);
  assert.equal(v.exclusions.description_discovery_failure_rows, 1);
  assert.equal(report.database_writes, 0);
  assert.equal(report.model_calls, 0);
  assert.match(renderPlanText(report), /seed_uncalibrated/);
});

test('denied parent gets no child reads; repeated failures stop a family; rate failure stays unknown', async () => {
  const denied = fakeDb({ 'FROM public.vehicles WHERE id=': [] });
  const capture = await collectPlan(options, denied.db, table);
  assert.equal(capture.vehicles[0].state, 'parent_unavailable');
  assert.ok(!denied.calls.some(sql => /description_discoveries|vehicle_observations|catalog_parts/.test(sql)));
  const other = '88888888-8888-4888-8888-888888888888', third = '99999999-9999-4999-8999-999999999999';
  let conditionReads = 0;
  const failing = fakeDb({ 'FROM public.vehicles WHERE id=': null });
  const result = await collectPlan({ ...options, vehicleIds: [ID, other, third] }, async (sql, deadline) => {
    if (sql.includes('FROM public.vehicles WHERE id=')) return [{ ...parent, id: [ID, other, third].find(id => sql.includes(id)) }];
    if (sql.includes('FROM public.vehicle_observations')) { conditionReads++; throw Error('private body'); }
    if (sql.includes('resolve_labor_rate')) throw Error('private body');
    return failing.db(sql, deadline);
  }, table);
  assert.equal(conditionReads, 2);
  assert.equal(result.vehicles[2].collections.condition.reason, 'repeated_read_failure_stop');
  assert.ok(!JSON.stringify(result).includes('private body'));
  const report = buildPlanReport(result);
  assert.equal(report.rate.state, 'unknown');
  assert.ok(report.vehicles[0].gaps.some(g => g.family === 'condition'));
});

test('offline replay is deterministic, private and refuses forged captures', async () => {
  const capture = await collectPlan(options, fakeDb().db, table);
  const base = mkdtempSync(join(tmpdir(), 'buying-plan-test-'));
  const file = join(base, 'capture.json');
  writeFileSync(file, JSON.stringify(capture));
  assert.equal(await main(['--cache', file, '--out', join(base, 'a')]), 0);
  assert.equal(await main(['--cache', file, '--out', join(base, 'b')]), 0);
  const strip = r => ({ ...r, generated_at: null });
  const a = JSON.parse(readFileSync(join(base, 'a/plan.json'))), b = JSON.parse(readFileSync(join(base, 'b/plan.json')));
  assert.deepEqual(strip(a), strip(b));
  assert.equal(statSync(join(base, 'a/plan.txt')).mode & 0o777, 0o600);
  assert.equal(statSync(join(base, 'a')).mode & 0o777, 0o700);
  assert.match(readFileSync(join(base, 'a/plan.txt'), 'utf8'), /PPI CHECKLIST/);
  await assert.rejects(main(['--cache', file, '--out', join(base, 'c'), '--query', 'rust']));
  await assert.rejects(main(['--plan', '--cache', file, '--out', join(base, 'd')]));
  assert.throws(() => buildPlanReport({ ...capture, keyword_table: { ...capture.keyword_table, reviewed_at: '2099-01-01' } }));
});
