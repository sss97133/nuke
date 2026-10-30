import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { reconstructRetainedWork, atPointer } from './lib/retained-work-reconstruction.mjs';
import { run } from './reconstruct-retained-work.mjs';

const source = (id, data, extra = {}) => ({ id, vehicle_id: 'vehicle', kind: 'work_record',
  is_superseded: false, source_id: 'retained-file', observed_at: '2024-08-29T12:00:00Z',
  ingested_at: '2026-09-27T00:00:00Z', extraction_method: 'owner_file_read', structured_data: data, ...extra });
const line = () => source('line', { subject: 'client_billing_line', log: 'Original build.csv', row: 9,
  item: 'Cooler', category: 'transmission', supplier: 'Parts supplier', client: 'Customer',
  billing_column: 'Done', billing_status: 'billed and paid', billing_split: { Done: 100 }, labor_minutes: 90 });
const image = (id, extra = {}) => ({ id, vehicle_id: 'vehicle', taken_at: '2024-05-29T05:39:00Z',
  created_at: '2026-04-01T00:00:00Z', ai_processing_status: 'completed', vision_gate_status: 'approved',
  ai_scan_metadata: { byok_deep_analysis: { components_seen: [{ label: 'Engine', confidence: 0.9 }] } }, ...extra });
const fixture = () => ({ schemaVersion: 'technician_evidence_capture_v1', vehicle: { id: 'vehicle' },
  workOrders: [{ id: 'order', vehicle_id: 'vehicle', status: 'paid', completed_at: '2024-08-29T00:00:00Z' }],
  workRecords: [line(), source('statement', { trust: 'owner_stated', client: 'Customer',
    payment_status: 'paid_in_full', obligation: 'delivery_to_client' }, { content_text: 'Provider owes delivery of the completed vehicle. A report labelled Sign tier.' })],
  ownershipPeriods: [{ id: 'old-owner', vehicle_id: 'vehicle', owner_profile_id: 'technician', is_current: true }],
  images: [image('image')],
  imageObjects: { vehicle_id: 'vehicle', work_order_id: 'order', job_attribution: 'vehicle_context_only',
    frames: [{ observation_id: 'frame-one', image_id: 'image', sightings: [{ raw_claim: { label: 'Engine' } }] }],
    coverage: { has_more: false } }, coverage: { workRecords: { complete: true, count: 2 } } });

test('recovers the exact build line and all source pointers without converting billing into performance', () => {
  const input = fixture(), result = reconstructRetainedWork(input);
  const item = result.scopeEntries[0].interpretations[0];
  for (const [key, claim] of Object.entries(item.claims)) {
    assert.deepEqual(atPointer(input.workRecords[0], claim.source.pointer), claim.value);
    assert.equal(claim.source.id, 'line'); assert.equal(claim.source.sourceId, 'retained-file');
    assert.equal(claim.source.eventAt, '2024-08-29T12:00:00Z');
  }
  assert.equal(item.claims.billing_column.value, 'Done');
  assert.equal(item.execution, 'not_established_by_billing_entry');
  assert.equal(item.minutesBasis, 'recorded_log_value_not_measured_duration');
  assert.equal(item.jobBinding.state, 'candidate_same_vehicle_only');
  assert.equal(result.workOrders[0].recordedStatus, 'paid');
  assert.equal(result.workOrders[0].fulfillment, 'requires_scoped_execution_acceptance_and_delivery_evidence');
});
test('payment and delivery owed coexist without an authenticated Sign or invented technician identity', () => {
  const result = reconstructRetainedWork(fixture());
  assert.equal(result.paymentReports[0].value, 'paid_in_full');
  assert.equal(result.paymentReports[0].authenticatedPaymentWitness, false);
  assert.equal(result.obligations[0].kind, 'delivery_to_client');
  assert.equal(result.obligations[0].assurance, 'retained_owner_report');
  assert.equal(result.obligations[0].performerActorId, null);
  assert.equal(result.obligations[0].fulfillment, 'not_inferred_from_payment_or_job_status');
});
test('retains the recorded ownership period separately from the delivery obligation', () => {
  const input = fixture(); input.ownershipPeriods.push({ id: 'foreign-owner', vehicle_id: 'another', owner_profile_id: 'other-person' });
  const result = reconstructRetainedWork(input);
  assert.equal(result.ownershipPeriods.length, 1);
  assert.equal(result.ownershipPeriods[0].recorded.owner_profile_id, 'technician');
  assert.equal(result.obligations[0].client.value, 'Customer');
  assert.equal(result.effects.identityClaimsApproved, false);
});
test('earlier ownership, current ownership and continuing work duty coexist with exact owner-answer provenance', () => {
  const input = fixture(); input.ownerContext = {
    sources: [{ id: 'owner-answer', text: 'I owned it before the sale. The customer owns it now. I still owe finishing and delivery.' }],
    claims: [
      { relationship: 'ownership_period', vehicleId: 'vehicle', partyLabel: 'Technician', period: 'before_sale', basisSourceId: 'owner-answer', basisExcerpt: 'I owned it before the sale.' },
      { relationship: 'ownership_period', vehicleId: 'vehicle', partyLabel: 'Customer', period: 'current', basisSourceId: 'owner-answer', basisExcerpt: 'The customer owns it now.' },
      { relationship: 'delivery_obligation', vehicleId: 'vehicle', responsiblePartyLabel: 'Technician', beneficiaryLabel: 'Customer', state: 'owed', basisSourceId: 'owner-answer', basisExcerpt: 'I still owe finishing and delivery.' },
    ],
  };
  const result = reconstructRetainedWork(input);
  assert.equal(result.reportedRelationships.length, 3);
  assert.ok(result.reportedRelationships.every(row => row.admission === 'not_written_to_canonical_relationships'));
  assert.equal(result.reportedRelationships[2].claim.state, 'owed');
  input.ownerContext.claims[2].basisExcerpt = 'It is complete';
  assert.throws(() => reconstructRetainedWork(input), /unsupported_owner_context_claim/);
});
test('withdrawal removes the affected derived claim while retaining other evidence', () => {
  const input = fixture(); input.workRecords[0].is_superseded = true;
  const result = reconstructRetainedWork(input);
  assert.equal(result.scopeEntries.length, 0); assert.equal(result.obligations.length, 1);
  assert.equal(result.coverage.excludedWorkRecords[0].reason, 'superseded_source');
});
test('foreign, differently typed and unknown-currentness records cannot become current work', () => {
  const input = fixture(); input.workRecords = [
    { ...line(), id: 'foreign', vehicle_id: 'another' },
    { ...line(), id: 'other-kind', kind: 'condition' },
    { ...line(), id: 'unknown-state', is_superseded: null },
  ];
  const result = reconstructRetainedWork(input);
  assert.equal(result.scopeEntries.length, 0); assert.equal(result.coverage.excludedWorkRecords.length, 3);
});
test('duplicate replay is idempotent and changed bytes under one observation id are refused', () => {
  const input = fixture(); input.workRecords.push(structuredClone(input.workRecords[0]));
  assert.equal(reconstructRetainedWork(input).scopeEntries[0].interpretations.length, 1);
  input.workRecords.at(-1).structured_data.item = 'Different item';
  assert.throws(() => reconstructRetainedWork(input), /source_revision_conflict/);
});
test('two retained interpretations of a document row remain visible instead of silently selecting one', () => {
  const input = fixture(); const revised = structuredClone(input.workRecords[0]); revised.id = 'second-read';
  revised.structured_data.billing_status = 'different retained interpretation'; input.workRecords.push(revised);
  const result = reconstructRetainedWork(input);
  assert.equal(result.scopeEntries.length, 1); assert.equal(result.scopeEntries[0].interpretations.length, 2);
  assert.equal(result.scopeEntries[0].sourceState, 'multiple_retained_interpretations');
});
test('a capped capture cannot claim complete source access, and no capture measures all real work', () => {
  const input = fixture(); input.coverage = {}; input.limits = { workRecords: 1 };
  assert.equal(reconstructRetainedWork(input).coverage.workRecords.state, 'incomplete_page');
  input.coverage.workRecords = { complete: true, count: 3 };
  const result = reconstructRetainedWork(input);
  assert.equal(result.coverage.workRecords.state, 'capture_population_mismatch');
  assert.equal(result.coverage.realWorldWorkPopulation, 'not_assessed');
});
test('historical work remains recoverable before any work-order header has been created', () => {
  const input = fixture(); input.workOrders = []; input.imageObjects = null;
  const result = reconstructRetainedWork(input);
  assert.equal(result.scopeEntries.length, 1); assert.equal(result.obligations.length, 1);
  assert.equal(result.scopeEntries[0].interpretations[0].jobBinding.state, 'unbound_work_scope');
  assert.deepEqual(result.scopeEntries[0].interpretations[0].jobBinding.candidateWorkOrderIds, []);
  assert.equal(result.imageContext.coverage.state, 'not_read');
  assert.equal(result.effects.canonicalJobsCreated, false);
});
test('completed analysis, failed analysis and attribution review remain different backlog dimensions', () => {
  const input = fixture(); input.images = [
    image('review', { vision_gate_status: 'review_needed' }),
    image('failed', { ai_processing_status: 'failed' }),
    image('missing', { ai_scan_metadata: null }),
    image('pending', { ai_processing_status: 'pending', ai_scan_metadata: null }),
    image('rejected', { vision_gate_status: 'rejected_misattributed' }),
  ];
  const result = reconstructRetainedWork(input);
  assert.equal(result.imageBacklog[0].analysisState, 'retained_analysis_available');
  assert.equal(result.imageBacklog[0].attributionState, 'attribution_review');
  assert.equal(result.imageBacklog[1].analysisState, 'processing_failed');
  assert.equal(result.imageBacklog[1].retainedAnalysisAvailable, true);
  assert.equal(result.imageBacklog[2].analysisState, 'completed_without_retained_analysis');
  assert.equal(result.imageBacklog[3].analysisState, 'analysis_pending');
  assert.equal(result.imageBacklog[4].attributionState, 'attribution_rejected');
  assert.ok(result.appearances.every(claim => claim.operationPerformed === 'not_established'));
});
test('malformed component output is visible instead of appearing as zero detected work', () => {
  const input = fixture(); input.images[0].ai_scan_metadata.byok_deep_analysis.components_seen = 'invalid';
  const result = reconstructRetainedWork(input);
  assert.equal(result.imageBacklog[0].componentSchema, 'missing_or_malformed'); assert.equal(result.appearances.length, 0);
});
test('missing capture dates do not become upload dates', () => {
  const input = fixture(); input.images[0].taken_at = null;
  const result = reconstructRetainedWork(input);
  assert.equal(result.imageBacklog[0].capturedAt, null); assert.equal(result.imageBacklog[0].addedAt, '2026-04-01T00:00:00Z');
});
test('repeated analyses preserve source occurrences and distinguish images from sightings', () => {
  const input = fixture(); input.imageObjects.frames.push({ observation_id: 'frame-two', image_id: 'image',
    sightings: [{ raw_claim: { label: 'Engine' } }, { raw_claim: { label: 'Engine' } }] });
  const result = reconstructRetainedWork(input);
  assert.equal(result.imageContext.observations, 2); assert.equal(result.imageContext.distinctImages, 1);
  assert.equal(result.imageContext.sightings, 3); assert.equal(result.effects.operationsCompleted, false);
});
test('wrong vehicle/work-order context and changed frame revisions are refused', () => {
  for (const field of ['vehicle_id', 'work_order_id', 'job_attribution']) {
    const input = fixture(); input.imageObjects[field] = 'foreign';
    assert.throws(() => reconstructRetainedWork(input), /invalid_image_job_context/);
  }
  const input = fixture(); input.imageObjects.frames.push({ ...input.imageObjects.frames[0], sightings: [] });
  assert.throws(() => reconstructRetainedWork(input), /image_source_revision_conflict/);
  input.workOrders[0].vehicle_id = 'other';
  assert.throws(() => reconstructRetainedWork(input), /foreign_work_order/);
});
test('JSON pointer escaping preserves unusual source keys and rejects prototype inheritance', () => {
  assert.equal(atPointer({ a: { 'x/y~': 4 } }, '/a/x~1y~0'), 4);
  assert.equal(atPointer({}, '/toString'), undefined);
  assert.throws(() => atPointer({}, 'missing_slash'), /invalid_source_pointer/);
});
test('CLI writes a private receipt outside git without overwriting a prior result', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'retained-work-'));
  try {
    const input = path.join(dir, 'input.json'), out = path.join(dir, 'result.json');
    await writeFile(input, JSON.stringify(fixture()));
    const result = await run(['--input', input, '--out', out]);
    assert.equal(result.scopeEntries, 1); assert.equal(result.effects.databaseWrites, false);
    const saved = JSON.parse(await readFile(out, 'utf8'));
    assert.match(saved.receipt.inputSha256, /^[a-f0-9]{64}$/);
    assert.equal((await stat(out)).mode & 0o777, 0o600);
    await assert.rejects(run(['--input', input, '--out', out]), { code: 'EEXIST' });
    await assert.rejects(run(['--input', input, '--out', 'scripts/should-not-exist.json']), /private_output_outside_git_required/);
    await symlink(path.resolve('scripts'), path.join(dir, 'checkout-link'));
    await assert.rejects(run(['--input', input, '--out', path.join(dir, 'checkout-link', 'should-not-exist.json')]), /private_output_outside_git_required/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('CLI errors do not echo malformed private source content', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'retained-work-error-'));
  try {
    const input = path.join(dir, 'input.json'); await writeFile(input, 'PRIVATE SOURCE CONTENT');
    const result = spawnSync(process.execPath, ['scripts/reconstruct-retained-work.mjs', '--input', input, '--out', path.join(dir, 'result.json')], { encoding: 'utf8' });
    assert.equal(result.status, 1); assert.equal(result.stdout, '');
    assert.doesNotMatch(result.stderr, /PRIVATE SOURCE CONTENT/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
