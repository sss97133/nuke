import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { computeSaturation, factFingerprint, CURRENT_SCHEMA_VERSION, DRY_PASS_LIMIT,
  attributionDoubt, landEntityPage, frameClock, loadAnalysisImages, receiptRoster, receiptRosterLine, prepare,
  receiptContextVendor, contextWithoutPersonalFields,
  groupReceiptRoster, receiptRosterSections } from './deep-image-analysis-byok.mjs';
import { projectImageProperties } from './lib/image-property-projection.mjs';

const now = '2026-10-30T20:00:00Z';
function prior() {
  return {
    scene_type: 'engine_bay', build_phase_guess: 'mechanical_assembly',
    intent: 'inspection', intent_confidence: 0.8,
    components_seen: [{ label: 'alternator', part_number_guess: null, confidence: 0.7, bbox: [10, 20, 100, 200] }],
    text_regions: [{ text: '1234', bbox: [12, 22, 60, 80] }],
    damage_localized: [{ label: 'corrosion', severity: 'surface', bbox: [30, 40, 130, 140] }],
    state_observations: { completeness: 'partial', paint_state: 'primer', damage_callouts: ['surface rust', 'scratch'] },
    workshop_signals: { fixturing: 'lift', tools_visible: ['ratchet', 'wrench'] },
    presence: { person: false, dog: false }, camera_pose: { azimuth_deg: 30, elevation_deg: 10 },
    narrative_one_line: 'An alternator is visible beside the engine.',
    open_questions: ['Need an adjacent frame to identify the mounting bracket', 'Need receipt context for the component'],
    context_complete: false,
    saturation: { version: CURRENT_SCHEMA_VERSION, passes: 2, dry_passes: DRY_PASS_LIMIT - 1 },
  };
}

for (const [name, correct] of [
  ['component identity', v => { v.components_seen[0].label = 'starter motor'; }],
  ['part number', v => { v.components_seen[0].part_number_guess = 'ALT-1234'; }],
  ['OCR reading', v => { v.text_regions[0].text = '1284'; }],
  ['localized damage', v => { v.damage_localized[0].severity = 'perforation'; }],
  ['assembly state', v => { v.state_observations.completeness = 'assembled'; }],
  ['intent', v => { v.intent = 'parts_sourcing'; }],
  ['camera coordinates', v => { v.camera_pose.azimuth_deg = 120; }],
  ['evidence region', v => { v.components_seen[0].bbox = [20, 10, 200, 100]; }],
]) {
  test(`a corrected ${name} is progress even with unchanged output counts`, () => {
    const before = prior(), candidate = structuredClone(before); correct(candidate);
    assert.notEqual(factFingerprint(candidate), factFingerprint(before));
    const result = computeSaturation(candidate, before, now);
    assert.equal(result.dry_passes, 0);
    assert.equal(result.saturated, false);
    assert.equal(result.resolved_at, null);
    assert.deepEqual(result.open_facts, candidate.open_questions);
    assert.equal(before.saturation.dry_passes, DRY_PASS_LIMIT - 1, 'the prior interpretation must remain unchanged');
  });
}

test('equivalent output converges despite ordering, caption, confidence and run metadata changes', () => {
  const before = prior(), candidate = structuredClone(before);
  candidate.open_questions.reverse();
  candidate.components_seen[0] = { bbox: [10, 20, 100, 200], confidence: 0.9, part_number_guess: null, label: 'alternator' };
  candidate.state_observations = { damage_callouts: ['scratch', 'surface rust'], paint_state: 'primer', completeness: 'partial' };
  candidate.workshop_signals.tools_visible.reverse();
  candidate.narrative_one_line = 'The frame shows an alternator next to an engine.';
  candidate.agent_notes = 'Another look'; candidate.analyzed_at = now;
  candidate.confidence = 0.99; candidate.intent_confidence = 0.9;
  candidate.provenance = { run_id: 'synthetic-new-run', agent_duration_ms: 2000 };
  assert.equal(factFingerprint(candidate), factFingerprint(before));
  const result = computeSaturation(candidate, before, now);
  assert.equal(result.dry_passes, DRY_PASS_LIMIT);
  assert.equal(result.saturated, true);
  assert.deepEqual(result.open_facts, []);
});

test('reordered component, text and damage collections do not create progress', () => {
  const before = prior();
  before.components_seen.push({ label: 'battery', confidence: 0.8, bbox: [50, 60, 100, 200] });
  before.text_regions.push({ text: 'XYZ', bbox: [30, 40, 100, 200] });
  before.damage_localized.push({ label: 'scratch', severity: 'minor', bbox: [40, 50, 100, 200] });
  const candidate = structuredClone(before);
  for (const key of ['components_seen', 'text_regions', 'damage_localized']) candidate[key].reverse();
  assert.equal(factFingerprint(candidate), factFingerprint(before));
  assert.equal(computeSaturation(candidate, before, now).saturated, true);
});

test('a new schema starts a fresh progress comparison', () => {
  const before = prior(); before.saturation.version = 'previous-schema';
  const result = computeSaturation(structuredClone(before), before, now);
  assert.equal(result.version, CURRENT_SCHEMA_VERSION);
  assert.equal(result.dry_passes, 0);
  assert.equal(result.saturated, false);
});

test('duplicate detections and absent optional collections do not create progress', () => {
  const before = prior(), candidate = structuredClone(before);
  candidate.components_seen.push(structuredClone(candidate.components_seen[0]));
  candidate.open_questions.push(candidate.open_questions[0]);
  assert.equal(factFingerprint(candidate), factFingerprint(before));
  assert.equal(computeSaturation(candidate, before, now).saturated, true);
  before.damage_localized = []; delete candidate.damage_localized;
  assert.equal(factFingerprint(candidate), factFingerprint(before));
});

test('capped evidence and owner clarification do not require repeated inference', () => {
  const candidate = prior(); candidate.context_complete = true;
  candidate.open_questions = ['Part number is illegible because of glare'];
  candidate.needs_clarification = true; candidate.intent = 'unknown'; candidate.intent_confidence = 0.2;
  const result = computeSaturation(candidate, null, now);
  assert.equal(result.saturated, true);
  assert.deepEqual(result.capped, candidate.open_questions);
  assert.deepEqual(result.open_facts, []);
});

test('a condition correction survives refinement and changes the existing projection without changing its prior', () => {
  const before = prior(), candidate = structuredClone(before);
  candidate.state_observations.completeness = 'assembled';
  assert.equal(computeSaturation(candidate, before, now).saturated, false);
  const image = { id: '10000000-0000-4000-8000-000000000001', vehicle_id: '10000000-0000-4000-8000-000000000002',
    is_sensitive: false, is_superseded: false, is_duplicate: false, vision_gate_status: 'approved' };
  const observation = (verdict, id) => ({ id, vehicle_id: image.vehicle_id, kind: 'condition', is_superseded: false,
    observed_at: now, ingested_at: now, confidence: 'medium', confidence_score: 0.8,
    agent_model: 'synthetic-vision-model', extraction_method: 'synthetic-image-method',
    structured_data: { analysis_kind: 'image_deep_byok', image_id: image.id, state_observations: verdict.state_observations } });
  const earlier = observation(before, '10000000-0000-4000-8000-000000000003');
  const corrected = observation(candidate, '10000000-0000-4000-8000-000000000004');
  const oldResult = projectImageProperties(earlier, image);
  const newResult = projectImageProperties(corrected, image);
  assert.equal(oldResult.deferred, null);
  assert.equal(newResult.deferred, null);
  const assembly = result => result.claims.find(claim => claim.property_key === 'image_visible_assembly_state');
  assert.equal(assembly(oldResult).structured_data.image_visible_assembly_state, 'partial');
  assert.equal(assembly(newResult).structured_data.image_visible_assembly_state, 'assembled');
  assert.notEqual(assembly(oldResult).source_identifier, assembly(newResult).source_identifier);
  assert.deepEqual(projectImageProperties(earlier, image), oldResult);
});

test('offline refinement import needs neither Supabase credentials nor network access', () => {
  const env = { ...process.env };
  for (const key of ['SUPABASE_URL', 'VITE_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) delete env[key];
  const moduleUrl = new URL('./deep-image-analysis-byok.mjs', import.meta.url).href;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e',
    `let calls = 0; globalThis.fetch = () => { calls++; throw Error('offline only'); }; await import(${JSON.stringify(moduleUrl)}); if (calls) process.exit(1);`],
  { env, encoding: 'utf8', timeout: 10_000 });
  assert.equal(result.status, 0, result.stderr);
});

function entityClient() {
  const saved = { records: [], components: [], updates: [] };
  const client = { from(table) {
    const q = { select() { return q; }, in() { return q; }, is() { return q; }, ilike() { return q; },
      order() { return Promise.resolve({ data: [], error: null }); },
      insert(rows) {
        if (table === 'image_analysis_records') {
          saved.records.push(...structuredClone(rows));
          return { select: () => Promise.resolve({ data: rows.map((r, i) => ({ id: `record-${i}`, image_id: r.image_id })), error: null }) };
        }
        assert.equal(table, 'component_identifications'); saved.components.push(...structuredClone(rows));
        return Promise.resolve({ error: null });
      },
    }; return q;
  } };
  return { client, saved };
}
function entityFrame(scene, intent = 'parts_sourcing') {
  return { image_id: 'synthetic-image', vehicle_id: 'synthetic-vehicle', taken_at: '2026-01-01T12:00:00Z',
    verdict: { ...prior(), scene_type: scene, intent, analyzed_at: now,
      components_seen: [{ label: 'valve cover', part_number_guess: 'PART-1234', confidence: 0.7, bbox: [10, 20, 100, 200] }],
      text_regions: [],
    } };
}
const roster = [{ id: 'synthetic-receipt-line', pn: 'PART-1234', pnNorm: 'PART1234', description: 'Valve cover' }];

for (const scene of ['cross_reference', 'product_screenshot', 'spreadsheet', 'hand_drawn_diagram']) {
  test(`${scene} retains its receipt candidate without becoming a confirmed build component`, async () => {
    const { client, saved } = entityClient(), frame = entityFrame(scene);
    const snapshot = structuredClone(frame);
    const result = await landEntityPage([frame], roster, { client });
    assert.equal(result.confirmed, 0);
    assert.equal(saved.records[0].confirmed_findings.length, 0);
    assert.equal(saved.records[0].inferred_findings[0].receipt_candidate.receipt_item_id, roster[0].id);
    assert.equal(saved.components[0].status, 'inferred');
    assert.equal(saved.components[0].confidence, 0.7, 'a reference match must not boost visual confidence');
    assert.equal(saved.components[0].source_references.evidence_role, 'reference');
    assert.equal(saved.records[0].reference_coverage_snapshot.component_qualification_rule, 'reference_context_v1');
    assert.equal(saved.components[0].source_references.receipt_item_id, roster[0].id);
    assert.deepEqual(frame, snapshot);
  });
}

test('the separate physical-image control retains its existing receipt confirmation', async () => {
  const { client, saved } = entityClient();
  const result = await landEntityPage([entityFrame('undercarriage', 'documentation')], roster, { client });
  assert.equal(result.confirmed, 1);
  assert.equal(saved.components[0].status, 'confirmed');
  assert.equal(saved.records[0].confirmed_findings.length, 1);
  assert.equal(saved.components[0].source_references.evidence_role, undefined);
});

test('a receipt document retains the paper citation without being relabeled as a reference photograph', async () => {
  const { client, saved } = entityClient(), frame = entityFrame('receipt_document', 'documentation');
  frame.verdict.text_regions = [{ text: 'PART-1234', bbox: [20, 30, 50, 80] }];
  await landEntityPage([frame], roster, { client });
  assert.equal(saved.components[0].status, 'confirmed');
  assert.equal(saved.components[0].source_references.scene_type, 'receipt_document');
  assert.equal(saved.components[0].source_references.match_basis, 'ocr_text');
});

test('explicit attribution doubt remains binding even when the scene resembles a build photograph', async () => {
  const { client, saved } = entityClient(), frame = entityFrame('engine_bay');
  frame.verdict.attribution_doubt = 'The source reading explicitly withholds this vehicle association';
  assert.equal(attributionDoubt(frame.verdict), frame.verdict.attribution_doubt);
  await landEntityPage([frame], roster, { client });
  assert.equal(saved.components[0].status, 'inferred');
});


test('analysis preparation never turns record creation into a capture/work day', () => {
  assert.deepEqual(frameClock({ created_at: '2026-11-09T00:00:00Z' }), { value: null, basis: 'unknown', day: 'unknown' });
  assert.equal(frameClock({ taken_at: '2025-10-07T00:00:00Z', created_at: '2026-11-09' }).basis, 'recorded_taken_at');
  assert.deepEqual(frameClock({ exif_data: { DateTimeOriginal: '2025:10:07 11:00:00' } }),
    { value: '2025:10:07 11:00:00', basis: 'exif_reported_capture', day: '2025-10-07' });
  assert.deepEqual(frameClock({ exif_data: { DateTimeOriginal: '2025-10-07T11:00:00Z' } }),
    { value: '2025-10-07T11:00:00Z', basis: 'exif_reported_capture', day: '2025-10-07' });
});

test('analysis worklist paginates the canonical eligible, nonsensitive population without writes', async () => {
  const calls = []; let page = 0;
  const client = { from(table) {
    assert.equal(table, 'vehicle_images');
    const q = new Proxy({}, { get(_, method) { return (...args) => {
      calls.push([method, ...args]);
      if (method === 'abortSignal') return Promise.resolve({ data: page++ === 0 ? Array.from({ length: 1000 }, (_, i) => ({ id: i })) : [{ id: 1000 }], error: null });
      return q;
    }; } }); return q;
  } };
  const result = await loadAnalysisImages(client, 'vehicle');
  assert.equal(result.length, 1001);
  assert.equal(calls.filter(c => c[0] === 'eq' && c[1] === 'vehicle_image_gallery_eligible' && c[2] === true).length, 2);
  assert.equal(calls.filter(c => c[0] === 'or' && c[1] === 'is_sensitive.is.null,is_sensitive.eq.false').length, 2);
  assert.deepEqual(calls.filter(c => c[0] === 'range'), [['range', 0, 999], ['range', 1000, 1999]]);
  assert.ok(!calls.some(c => c[0] === 'in'), 'whole-queue selection remains unbounded by explicit IDs');
  assert.ok(!calls.some(c => ['insert', 'update', 'upsert', 'delete'].includes(c[0])));
  await assert.rejects(loadAnalysisImages({ from() {
    const q = new Proxy({}, { get(_, method) { return () => method === 'abortSignal' ? Promise.resolve({ data: null, error: { message: 'unavailable' } }) : q; } }); return q;
  } }, 'vehicle'), /unavailable/);
});

test('receipt grounding preserves order, shipment and return lines and exact source citations', () => {
  const receipt = { is_superseded: false, vendor_name: 'Example supplier', receipt_date: '2025-09-08', source_document_table: 'vehicle_documents', source_document_id: 'doc' };
  const line = { receipt_id: 'receipt', description: 'Seat foam BACKORDERED, shipped 0', quantity: 1, total_price: 0, part_number: 'FOAM1', receipts: receipt };
  const rows = receiptRoster([{ ...line, id: 'order' }, { ...line, id: 'return', description: 'Seat foam RETURN', quantity: -1, total_price: -20 },
    { ...line, id: 'later', description: 'Seat foam', total_price: 20, receipts: { ...receipt, receipt_date: '2025-10-01' } },
    { ...line, id: 'superseded', receipts: { ...receipt, is_superseded: true } }]);
  assert.equal(rows.length, 3, 'same PN is not a unique purchase');
  const output = rows.map(receiptRosterLine).join('\n');
  assert.match(output, /BACKORDERED, shipped 0/);
  assert.match(output, /RETURN/);
  assert.match(output, /line amount 0/);
  assert.match(output, /item order; source vehicle_documents:doc/);
  assert.match(output, /receipt_date=2025-10-01/);
  const transactionOnly = receiptRoster([{ ...line, id: 'transaction-only', receipts: { ...receipt, receipt_date: null, transaction_date: '2025-11-01' } }])[0];
  assert.match(receiptRosterLine(transactionOnly), /transaction_date=2025-11-01/);
  assert.doesNotMatch(receiptRosterLine(transactionOnly), /document date|receipt_date=/);
});
test('authorized receipt context keeps financial detail and marketplace handle while excluding personal seller name', () => {
  assert.equal(receiptContextVendor('eBay seller fixture-shop (Example Person)'), 'eBay seller fixture-shop');
  assert.equal(receiptContextVendor('eBay seller Fixture Supply; message signed Example Person'), 'eBay seller Fixture Supply');
  const compact = 'Receipt {"vendor":"eBay seller Fixture Supply; message signed Example Person","receipt_id":"kept"}\n  Item {"amount":49.99,"description":"repair work","quantity":1}';
  assert.equal(contextWithoutPersonalFields(compact), compact.replace('; message signed Example Person', ''));
  assert.equal(receiptContextVendor("O'Reilly Auto Parts (Store 1)"), "O'Reilly Auto Parts (Store 1)");
  const original = 'PN123; line amount 49.99; vendor eBay seller fixture-shop (Example Person); receipt receipt-id; item item-id';
  assert.equal(contextWithoutPersonalFields(original), 'PN123; line amount 49.99; vendor eBay seller fixture-shop; receipt receipt-id; item item-id');
});
test('compact receipt context retains every item and exact metadata without summing or deduplicating', () => {
  const base = { receiptId: 'receipt', vendor: 'Example Parts', dates: { receipt_date: '2025-01-01', purchase_date: null, transaction_date: '2025-01-02' },
    sourceTable: 'vehicle_documents', sourceId: 'document', itemId: 'order', cat: 'interior', desc: 'Seat foam BACKORDERED, shipped 0; printed quantity ordered', pn: 'FOAM1', quantity: 1, amount: 0, lineDate: null };
  const rows = [base, { ...base, itemId: 'return', desc: 'RETURN seat foam', quantity: -1, amount: -20 },
    { ...base, itemId: 'labor', cat: 'labor', desc: 'Inspect and machine. Technician 1.5h.\nSeparate operation.', pn: null, quantity: null, amount: 120, lineDate: '2024-12-28' },
    { ...base, itemId: 'changed-source', sourceId: 'other-document' }];
  const groups = groupReceiptRoster(rows); assert.equal(groups.length, 2);
  const restored = groups.flatMap(g => g.items.map(i => ({ receiptId: g.receipt_id, vendor: g.vendor, dates: g.dates, sourceTable: g.source_table, sourceId: g.source_id,
    itemId: i.item_id, cat: i.category, desc: i.description, pn: i.part_number, quantity: i.quantity, amount: i.amount, lineDate: i.line_date })));
  assert.deepEqual(restored, rows);
  const output = receiptRosterSections(rows);
  assert.equal(output.split('\n').filter(l => l.startsWith('  Item ')).length, 4);
  assert.match(output, /"amount":-20/); assert.match(output, /Technician 1\.5h/); assert.match(output, /"source_id":"other-document"/);
});


test('successful empty preparation replaces a stale worklist for image and day selections', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'byok-empty-'));
  const worklist = join(dir, 'work.jsonl');
  const client = { from() {
    const q = new Proxy({}, { get(_, method) { return () => method === 'abortSignal'
      ? Promise.resolve({ data: [], error: null }) : q; } }); return q;
  } };
  try {
    for (const byDay of [false, true]) {
      writeFileSync(worklist, '{"image_id":"stale"}\n'); writeFileSync(`${worklist}.date`, '2025-01-01');
      await prepare(client, { vehicleId: 'vehicle', limit: 3, worklist, byDay });
      assert.equal(readFileSync(worklist, 'utf8'), '');
      assert.equal(readFileSync(`${worklist}.date`, 'utf8'), '');
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('exact representative selection preserves IDs across days and refuses already analyzed or missing sources', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'byok-exact-')), worklist = join(dir, 'work.jsonl');
  const first = '10000000-0000-4000-8000-000000000001', second = '10000000-0000-4000-8000-000000000002';
  const rows = [{ id: first, taken_at: '2025-01-01T12:00:00Z', image_url: 'https://example.invalid/one.jpeg', updated_at: now },
    { id: second, taken_at: '2026-01-01T12:00:00Z', image_url: 'https://example.invalid/two.jpeg', updated_at: now }];
  const client = { from() { const q = new Proxy({}, { get(_, method) { return () => method === 'abortSignal' ? Promise.resolve({ data: rows, error: null }) : q; } }); return q; } };
  try {
    await prepare(client, { vehicleId: 'vehicle', limit: 2, worklist, byDay: true, imageIds: [second, first] });
    const work = readFileSync(worklist, 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(work.map(w => w.image_id), [second, first]); assert.deepEqual(work.map(w => w.day), ['2026-01-01', '2025-01-01']);
    rows[0].ai_scan_metadata = { byok_deep_analysis: { already: 'read' } };
    await assert.rejects(prepare(client, { vehicleId: 'vehicle', limit: 2, worklist, imageIds: [first] }), /already analyzed/);
    assert.equal(readFileSync(worklist, 'utf8'), '');
    await assert.rejects(prepare(client, { vehicleId: 'vehicle', limit: 2, worklist, imageIds: [second, second] }), /invalid exact/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('exact preparation queries only requested current eligible sources and preserves their clocks', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'byok-targeted-')), worklist = join(dir, 'work.jsonl');
  const id = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const rows = Array.from({ length: 6 }, (_, i) => ({ id: id(i + 1), vehicle_id: 'vehicle',
    image_url: `https://example.invalid/${i + 1}.jpeg`, updated_at: now, taken_at: '2025-01-01T12:00:00Z',
    vehicle_image_gallery_eligible: true, is_sensitive: false, ai_scan_metadata: {} }));
  rows[2].vehicle_id = 'other-vehicle'; rows[3].vehicle_image_gallery_eligible = false; rows[4].is_sensitive = true;
  const calls = [], logs = [], oldLog = console.log;
  const client = { from(table) {
    assert.equal(table, 'vehicle_images'); let selected = rows;
    const q = new Proxy({}, { get(_, method) { return (...values) => {
      calls.push([method, ...values]);
      if (method === 'eq') selected = selected.filter(r => r[values[0]] === values[1]);
      if (method === 'or') selected = selected.filter(r => r.is_sensitive == null || r.is_sensitive === false);
      if (method === 'in') selected = selected.filter(r => values[1].includes(r[values[0]]));
      if (method === 'abortSignal') return Promise.resolve({ data: selected, error: null });
      return q;
    }; } }); return q;
  } };
  try {
    console.log = message => logs.push(message);
    rows[1].updated_at = '2026-11-10T12:34:56.123456Z';
    await prepare(client, { vehicleId: 'vehicle', limit: 2, worklist, imageIds: [id(2), id(1)] });
    assert.deepEqual(calls.filter(c => c[0] === 'in'), [['in', 'id', [id(2), id(1)]]]);
    assert.ok(calls.some(c => c[0] === 'eq' && c[1] === 'vehicle_id' && c[2] === 'vehicle'));
    assert.ok(calls.some(c => c[0] === 'eq' && c[1] === 'vehicle_image_gallery_eligible' && c[2] === true));
    assert.ok(calls.some(c => c[0] === 'or' && c[1] === 'is_sensitive.is.null,is_sensitive.eq.false'));
    const work = readFileSync(worklist, 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(work.map(w => w.image_id), [id(2), id(1)]);
    assert.equal(work[0].expected_updated_at, rows[1].updated_at);
    assert.equal(work[0].image_url, rows[1].image_url);
    assert.equal(work[0].day_basis, 'recorded_taken_at');
    assert.match(logs.join('\n'), /eligible requested images = 2/);
    assert.match(logs.join('\n'), /Whole-inventory coverage was not queried/);
    for (const excluded of [id(3), id(4), id(5), id(99)]) {
      await assert.rejects(prepare(client, { vehicleId: 'vehicle', limit: 2, worklist, imageIds: [id(1), excluded] }), /unavailable or already analyzed/);
      assert.equal(readFileSync(worklist, 'utf8'), '', 'never process an incomplete requested cohort');
    }
    rows[0].ai_scan_metadata.byok_deep_analysis = { already: 'read' };
    await assert.rejects(prepare(client, { vehicleId: 'vehicle', limit: 2, worklist, imageIds: [id(1)] }), /already analyzed/);
    const queryCount = calls.length;
    await assert.rejects(prepare(client, { vehicleId: 'vehicle', limit: 2, worklist, imageIds: ['bad-id'] }), /invalid exact/);
    assert.equal(calls.length, queryCount, 'invalid IDs refuse before database access');
  } finally { console.log = oldLog; rmSync(dir, { recursive: true, force: true }); }
});
