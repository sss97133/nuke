import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { applyImagePropertyClaims as applyBatchClaims, projectImageProperties, PROJECTION_VERSION } from './image-property-projection.mjs';

const applyImagePropertyClaims = (sb, claims, options = {}) => applyBatchClaims(sb, claims, { ...options, mode: 'legacy' });

const IDS = {
  source: '11111111-1111-4111-8111-111111111111',
  image: '22222222-2222-4222-8222-222222222222',
  vehicle: '33333333-3333-4333-8333-333333333333',
  output: '44444444-4444-4444-8444-444444444444',
  property: '55555555-5555-4555-8555-555555555555',
  witness: '66666666-6666-4666-8666-666666666666',
};
function fixtures() {
  return {
    observation: {
      id: IDS.source, vehicle_id: IDS.vehicle, kind: 'condition', is_superseded: false,
      observed_at: '2026-05-01T08:00:00Z', ingested_at: '2026-05-03T09:00:00Z',
      agent_model: 'recorded-model-v1', agent_tier: 'recorded-tier',
      extraction_method: 'recorded-image-method-v1', confidence_score: 0.8, confidence: 'medium',
      structured_data: {
        analysis_kind: 'image_deep_byok', image_id: IDS.image,
        state_observations: { rust_severity: 'surface', paint_state: 'primer', completeness: 'partial' },
      },
    },
    image: { id: IDS.image, vehicle_id: IDS.vehicle, is_sensitive: false, is_superseded: false,
      is_duplicate: false, vision_gate_status: 'approved', image_vehicle_match_status: null },
  };
}

test('projects only supported scalar properties with source identity and honest clocks', () => {
  const { observation, image } = fixtures();
  const { claims, deferred } = projectImageProperties(observation, image);
  assert.equal(deferred, null);
  assert.equal(claims.length, 3);
  for (const claim of claims) {
    assert.equal(claim.source_slug, 'photo_pipeline');
    assert.equal(claim.kind, 'condition');
    assert.equal(claim.agent_inferred, true);
    assert.equal(claim.defer_analysis, true);
    assert.equal(claim.agent_model, observation.agent_model);
    assert.equal(claim.agent_cost_cents, 0);
    assert.equal(claim.observed_at, observation.ingested_at);
    assert.equal(claim.structured_data.source_observed_at, observation.observed_at);
    assert.equal(claim.structured_data.observed_at_basis, 'source_testimony_recorded_at');
    assert.equal(claim.structured_data.analyzed_at, null);
    assert.equal(claim.structured_data.capture_at, null);
    assert.equal(claim.structured_data.source_observation_id, observation.id);
    assert.match(claim.source_identifier, new RegExp(`^${PROJECTION_VERSION}:${observation.id}:`));
    assert.equal(claim.structured_data.source_extraction_method, observation.extraction_method);
    assert.equal(Object.hasOwn(claim, 'confidence_score'), false);
  }
});

test('exact replay and differently ordered source fields produce identical bytes', () => {
  const { observation, image } = fixtures();
  const first = projectImageProperties(observation, image);
  const reordered = structuredClone(observation);
  reordered.structured_data.state_observations = { completeness: 'partial', paint_state: 'primer', rust_severity: 'surface' };
  assert.deepEqual(projectImageProperties(reordered, image), first);
  assert.deepEqual(projectImageProperties(observation, image), first);
});

test('transport source proof preserves the existing v1 identity and includes only the immutable hash inputs', () => {
  const { observation, image } = fixtures();
  const { claims } = projectImageProperties(observation, image);
  const expectedHash = ['b94f4925ade0599a', '65510972c1e6f7a0', 'b775b6cfaca3f6d2', 'cf992c11485f20a1'].join('');
  for (const claim of claims) {
    assert.equal(claim.structured_data.source_result_hash, expectedHash);
    assert.equal(createHash('sha256').update(claim.source_result_json).digest('hex'), expectedHash);
    assert.equal(claim.source_identifier, `${PROJECTION_VERSION}:${observation.id}:${expectedHash}:${claim.property_key}`);
    assert.equal(Object.hasOwn(claim.structured_data, 'source_result_json'), false);
    assert.deepEqual(Object.keys(JSON.parse(claim.source_result_json)),
      ['observation_id', 'image_id', 'vehicle_id', 'model', 'method', 'recorded_at', 'state_observations']);
  }
});

test('a new source result keeps the old claim identity and creates a distinct new one', () => {
  const { observation, image } = fixtures();
  const old = projectImageProperties(observation, image).claims[0];
  const revised = structuredClone(observation);
  revised.id = IDS.output;
  revised.agent_model = 'recorded-model-v2';
  assert.notEqual(projectImageProperties(revised, image).claims[0].source_identifier, old.source_identifier);
  assert.deepEqual(projectImageProperties(observation, image).claims[0], old);
});

test('mutable image-cache provenance and private text never enter projected payloads', () => {
  const { observation, image } = fixtures();
  observation.structured_data.text_regions = ['private OCR'];
  observation.structured_data.narrative_one_line = 'private source narrative';
  image.ai_scan_metadata = { byok_deep_analysis: { agent_model: 'wrong-current-model', analyzed_at: new Date().toISOString() } };
  const serialized = JSON.stringify(projectImageProperties(observation, image));
  for (const privateText of ['private OCR', 'private source narrative', 'wrong-current-model']) {
    assert.equal(serialized.includes(privateText), false);
  }
});

test('missing provenance, invalid clocks and low/unknown confidence defer rather than fabricate', () => {
  for (const patch of [
    { agent_model: null }, { extraction_method: '' }, { ingested_at: null }, { ingested_at: 'invalid' },
    { confidence_score: null }, { confidence_score: NaN }, { confidence_score: '0.8' },
    { confidence_score: 0.59 }, { confidence_score: 1.1 },
  ]) {
    const { observation, image } = fixtures();
    const result = projectImageProperties({ ...observation, ...patch }, image);
    assert.deepEqual(result.claims, []);
    assert.ok(result.deferred);
  }
});

test('private, wrong-vehicle, superseded, duplicate and held images never project', () => {
  for (const patch of [
    { vehicle_id: IDS.output }, { id: IDS.output }, { is_sensitive: true },
    { is_superseded: true }, { is_duplicate: true }, { vision_gate_status: 'held' },
    { image_vehicle_match_status: 'mismatch' }, { image_vehicle_match_status: 'unrelated' },
  ]) {
    const { observation, image } = fixtures();
    assert.deepEqual(projectImageProperties(observation, { ...image, ...patch }).claims, []);
  }
});

test('review flags and legacy low-confidence qualification are honored', () => {
  for (const flag of ['needs_review', 'needs_clarification', 'attribution_doubt']) {
    const { observation, image } = fixtures();
    observation.structured_data[flag] = true;
    assert.deepEqual(projectImageProperties(observation, image).claims, []);
  }
  const { observation, image } = fixtures();
  observation.confidence = 'low'; // Existing raw BYOK writer stores needs_review here.
  assert.deepEqual(projectImageProperties(observation, image).claims, []);
});

test('unknown values and other analysis types never turn into defaults or specifications', () => {
  const { observation, image } = fixtures();
  observation.structured_data.state_observations = { rust_severity: 'unknown', paint_state: 'blue', completeness: 'running' };
  assert.deepEqual(projectImageProperties(observation, image).claims, []);
  observation.structured_data.analysis_kind = 'apple_labels';
  assert.deepEqual(projectImageProperties(observation, image).claims, []);
  observation.structured_data.analysis_kind = 'image_deep_byok';
  observation.is_superseded = true;
  assert.deepEqual(projectImageProperties(observation, image).claims, []);
});

function applyFixture(options = {}) {
  const { observation, image } = fixtures();
  const claims = projectImageProperties(observation, image).claims;
  const calls = [];
  const first = claims[0];
  const row = {
    id: IDS.output, vehicle_id: first.vehicle_id, property_id: IDS.property,
    property_key: first.property_key, observation_properties: { property_key: first.property_key },
    structured_data: first.structured_data, confidence_score: 0.6, observed_at: first.observed_at,
    ingested_at: '2026-05-03T09:00:01.123456Z', source_identifier: first.source_identifier,
    extraction_method: first.extraction_method, agent_model: first.agent_model,
    raw_source_ref: first.raw_source_ref, kind: first.kind, is_superseded: false,
    source: { slug: first.source_slug },
    ...options.row,
  };
  const sb = {
    functions: { async invoke(name, argument) {
      calls.push({ name, argument });
      assert.equal(name, 'ingest-observation');
      if (options.invokeThrows) throw new Error('private invocation error');
      return options.invokeResponse ?? { data: { success: true, observation_id: IDS.output, duplicate: !!options.duplicate }, error: null };
    } },
    from(table) {
      const query = new Proxy({}, { get: (_, name) => {
        if (name === 'then') return (resolve, reject) => Promise.resolve().then(async () => {
          if (options.readThrows && table !== 'observation_properties') throw new Error('private readback error');
          if (table === 'vehicle_observations') return { data: row, error: options.rowError ?? null };
          if (table === 'observation_witnesses') return { data: options.witnesses ?? [{ id: IDS.witness }], error: options.witnessError ?? null };
          if (table === 'observation_properties') {
            if (options.registryDelayMs) await new Promise(resolve => setTimeout(resolve, options.registryDelayMs));
            if (options.registryThrows) throw new Error('private registry error');
            return { data: options.registryData ?? claims.map(claim => ({ id: IDS.property, property_key: claim.property_key })), error: options.registryError ?? null };
          }
          throw new Error(`unexpected read ${table}`);
        }).then(resolve, reject);
        return () => query;
      } });
      return query;
    },
  };
  return { sb, calls, claims };
}

test('canonical landing counts success only after typed property/witness readback', async () => {
  const { sb, claims, calls } = applyFixture();
  const result = await applyImagePropertyClaims(sb, claims.slice(0, 1));
  assert.equal(result.inserted, 1);
  assert.equal(result.verified, 1);
  assert.equal(result.failed, 0);
  assert.equal(calls[0].argument.body.defer_analysis, true);
});

test('exact replay reports a verified duplicate without inventing a new insertion', async () => {
  const { sb, claims } = applyFixture({ duplicate: true });
  const result = await applyImagePropertyClaims(sb, claims.slice(0, 1));
  assert.equal(result.inserted, 0);
  assert.equal(result.duplicates, 1);
  assert.equal(result.verified, 1);
});

for (const [name, options] of [
  ['invoke rejection', { invokeThrows: true }],
  ['HTTP success without persisted ID', { invokeResponse: { data: { success: true }, error: null } }],
  ['consumer failure', { invokeResponse: { data: { success: false }, error: null } }],
  ['invoke error with apparent success', { invokeResponse: { data: { success: true, observation_id: IDS.output }, error: {} } }],
  ['readback error', { rowError: {} }],
  ['readback rejection', { readThrows: true }],
  ['missing property link', { row: { property_id: null } }],
  ['wrong property identity', { row: { property_id: IDS.witness } }],
  ['wrong vehicle', { row: { vehicle_id: IDS.output } }],
  ['missing witness', { witnesses: [] }],
  ['multiple derived witnesses', { witnesses: [{ id: IDS.witness }, { id: IDS.output }] }],
  ['witness query error', { witnessError: {} }],
  ['null stored confidence', { row: { confidence_score: null } }],
  ['negative stored confidence', { row: { confidence_score: -0.1 } }],
  ['unqualified stored confidence', { row: { confidence_score: 0.8 } }],
  ['wrong event clock', { row: { observed_at: '2026-05-03T09:00:01Z' } }],
  ['microsecond event drift', { row: { observed_at: '2026-05-03T09:00:00.000001Z' } }],
  ['missing ingest clock', { row: { ingested_at: null } }],
  ['invalid ingest clock', { row: { ingested_at: 'unknown' } }],
  ['ingest before source record', { row: { ingested_at: '2026-05-03T08:59:59.999999Z' } }],
  ['wrong source identity', { row: { source_identifier: 'different-result' } }],
  ['wrong canonical source', { row: { source: { slug: 'other-source' } } }],
  ['wrong method', { row: { extraction_method: 'new-visual-inference' } }],
  ['wrong model', { row: { agent_model: 'unrecorded-model' } }],
  ['wrong source reference', { row: { raw_source_ref: 'different-parent' } }],
  ['wrong kind', { row: { kind: 'specification' } }],
  ['superseded output', { row: { is_superseded: true } }],
]) {
  test(`${name} stops the bounded pass with failed persistence`, async () => {
    const { sb, claims, calls } = applyFixture(options);
    const result = await applyImagePropertyClaims(sb, claims);
    assert.equal(result.failed, 1);
    assert.equal(result.verified, 0);
    assert.equal(result.inserted, 0);
    assert.equal(calls.length, 1);
  });
}

test('equivalent timezone clocks and an old first-ingest receipt remain valid on replay', async () => {
  const { sb, claims } = applyFixture({ duplicate: true, row: {
    observed_at: '2026-05-03T02:00:00.000000-07:00',
    ingested_at: '2026-05-03T09:00:00.000001+00:00',
  } });
  const result = await applyImagePropertyClaims(sb, claims.slice(0, 1));
  assert.equal(result.failed, 0);
  assert.equal(result.duplicates, 1);
  assert.equal(result.verified, 1);
});

for (const [field, value] of [
  ['projection_version', 'different-version'], ['analysis_kind', 'new-analysis'],
  ['property_key', 'different-property'], ['source_extraction_method', 'different-source-method'],
  ['source_model_confidence', 0.99], ['source_observed_at', '2026-05-02T08:00:00Z'],
  ['observed_at_basis', 'photo_capture'], ['capture_at', '2026-05-01T08:00:00Z'],
  ['analyzed_at', '2026-05-01T08:00:00Z'],
]) {
  test(`altered ${field} cannot count as verified output`, async () => {
    const { observation, image } = fixtures();
    const first = projectImageProperties(observation, image).claims[0];
    const { sb, claims } = applyFixture({ row: {
      structured_data: { ...first.structured_data, [field]: value },
    } });
    const result = await applyImagePropertyClaims(sb, claims.slice(0, 1));
    assert.equal(result.failed, 1);
    assert.equal(result.verified, 0);
  });
}

test('wrong source-result identity cannot count as verified output', async () => {
  const { observation, image } = fixtures();
  const first = projectImageProperties(observation, image).claims[0];
  const { sb, claims } = applyFixture({ row: {
    structured_data: { ...first.structured_data, source_result_hash: 'different-result' },
  } });
  const result = await applyImagePropertyClaims(sb, claims.slice(0, 1));
  assert.equal(result.failed, 1);
  assert.equal(result.verified, 0);
});

for (const [name, options] of [
  ['registry error', { registryError: {} }],
  ['registry rejection', { registryThrows: true }],
  ['missing registered properties', { registryData: [] }],
]) {
  test(`${name} fails before any write attempt`, async () => {
    const { sb, claims, calls } = applyFixture(options);
    const result = await applyImagePropertyClaims(sb, claims);
    assert.equal(result.failed, 1);
    assert.equal(result.verified, 0);
    assert.equal(calls.length, 0);
    assert.equal(JSON.stringify(result).includes('private registry error'), false);
  });
}

test('invalid or exhausted run budgets stop before any write attempt', async () => {
  for (const runMs of [0, -1, 0.5, Infinity, NaN, 60001]) {
    const { sb, claims, calls } = applyFixture();
    const result = await applyImagePropertyClaims(sb, claims, { runMs });
    assert.equal(result.reason, 'invalid_budget');
    assert.equal(result.failed, 1);
    assert.equal(calls.length, 0);
  }
  const { sb, claims, calls } = applyFixture({ registryDelayMs: 10 });
  const result = await applyImagePropertyClaims(sb, claims, { runMs: 1 });
  assert.equal(result.reason, 'run_budget_exhausted');
  assert.equal(result.failed, 1);
  assert.equal(calls.length, 0);
});

function batchFixture(options = {}) {
  const { observation, image } = fixtures();
  const claims = projectImageProperties(observation, image).claims;
  const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const registry = claims.map((claim, index) => ({ property_key: claim.property_key, id: uuid(10 + index) }));
  const calls = [];
  const sb = {
    from(table) {
      calls.push({ table });
      assert.equal(table, 'observation_properties');
      const q = { select() { return q; }, in() { return q; },
        async abortSignal() { return { data: registry, error: null }; } };
      return q;
    },
    functions: { async invoke(name, args) {
      calls.push({ name, args });
      assert.equal(name, 'ingest-observation-batch');
      if (options.reject) throw Error('private failed request');
      const results = claims.map((claim, index) => ({ index, success: true,
        observation_id: uuid(100 + index), duplicate: !!options.duplicate,
        vehicle_id: claim.vehicle_id, image_id: claim.structured_data.image_id,
        property_id: registry[index].id, property_key: claim.property_key,
        value: claim.structured_data[claim.property_key],
        source_observation_id: claim.structured_data.source_observation_id,
        source_result_hash: claim.structured_data.source_result_hash,
        source_recorded_at: claim.structured_data.source_recorded_at,
        confidence_score: 0.6, witness_id: uuid(200 + index) }));
      const data = { success: true, source_id: IDS.source, total: claims.length, ingested: options.duplicate ? 0 : claims.length,
        duplicates: options.duplicate ? claims.length : 0, failed: 0, results };
      options.change?.(data);
      return { data, error: options.error ?? null };
    } },
  };
  return { sb, claims, registry, calls };
}

test('default batch mode lands all claims with one canonical request and transaction proof', async () => {
  const f = batchFixture(); let requests = 0;
  const result = await applyBatchClaims(f.sb, f.claims, { registry: f.registry, onRequest: () => requests++ });
  assert.equal(result.verified, 3); assert.equal(result.inserted, 3); assert.equal(result.failed, 0);
  assert.equal(result.requests, 1); assert.equal(requests, 1); assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].args.body.mode, 'cached_image_property_projection_v1');
  assert.deepEqual(f.calls[0].args.body.observations, f.claims);
  assert.ok(f.calls[0].args.timeout > 10000 && f.calls[0].args.timeout <= 45000);
});

test('batch exact replay counts existing verified claims without new insertions', async () => {
  const f = batchFixture({ duplicate: true });
  const result = await applyBatchClaims(f.sb, f.claims);
  assert.equal(result.inserted, 0); assert.equal(result.duplicates, 3); assert.equal(result.verified, 3);
  assert.equal(result.requests, 2); assert.equal(f.calls.length, 2);
});

for (const [name, change] of [
  ['false success', d => { d.success = false; }],
  ['omitted success', d => { delete d.success; }],
  ['missing result', d => { d.results.pop(); }],
  ['duplicate index', d => { d.results[1].index = 0; }],
  ['string index', d => { d.results[0].index = '0'; }],
  ['negative index', d => { d.results[0].index = -1; }],
  ['out of range index', d => { d.results[0].index = 3; }],
  ['missing observation ID', d => { delete d.results[0].observation_id; }],
  ['same observation twice', d => { d.results[1].observation_id = d.results[0].observation_id; }],
  ['same witness twice', d => { d.results[1].witness_id = d.results[0].witness_id; }],
  ['missing witness', d => { delete d.results[0].witness_id; }],
  ['wrong property', d => { d.results[0].property_id = IDS.output; }],
  ['wrong key', d => { d.results[0].property_key = 'wrong'; }],
  ['wrong vehicle', d => { d.results[0].vehicle_id = IDS.output; }],
  ['wrong image', d => { d.results[0].image_id = IDS.output; }],
  ['wrong source', d => { d.results[0].source_observation_id = IDS.output; }],
  ['wrong source hash', d => { d.results[0].source_result_hash = 'wrong'; }],
  ['wrong source clock', d => { d.results[0].source_recorded_at = '2026-10-03T00:00:00Z'; }],
  ['missing source registry identity', d => { delete d.source_id; }],
  ['wrong value', d => { d.results[0].value = 'perforation'; }],
  ['truth confidence', d => { d.results[0].confidence_score = 1; }],
  ['unknown confidence', d => { d.results[0].confidence_score = null; }],
  ['missing duplicate classification', d => { delete d.results[0].duplicate; }],
  ['failed item', d => { d.results[0].success = false; }],
  ['failed aggregate', d => { d.failed = 1; }],
  ['wrong submitted total', d => { d.total = 4; }],
  ['wrong inserted aggregate', d => { d.ingested = 2; d.duplicates = 1; }],
]) test(`batch ${name} rejects all unproven completion and never falls back`, async () => {
  const f = batchFixture({ change });
  const result = await applyBatchClaims(f.sb, f.claims, { registry: f.registry });
  assert.equal(result.failed, 1); assert.equal(result.verified, 0); assert.equal(result.inserted, 0);
  assert.equal(f.calls.length, 1); assert.equal(result.reason, 'batch_receipt_invalid');
});

test('batch request rejection or error does not retry, fallback, or expose raw errors', async () => {
  for (const options of [{ reject: true }, { error: { message: 'private failed request' } }]) {
    const f = batchFixture(options);
    const result = await applyBatchClaims(f.sb, f.claims, { registry: f.registry });
    assert.equal(result.failed, 1); assert.equal(f.calls.length, 1);
    assert.equal(JSON.stringify(result).includes('private'), false);
  }
});

test('batch bounds reject duplicate identities, missing registry and oversized payload before invocation', async () => {
  for (const mutation of [
    f => { f.claims[1].source_identifier = f.claims[0].source_identifier; },
    f => { f.registry.pop(); },
    f => { f.claims[0].structured_data.unexpected = 'x'.repeat(8 * 1024 * 1024); },
  ]) {
    const f = batchFixture(); mutation(f);
    const result = await applyBatchClaims(f.sb, f.claims, { registry: f.registry });
    assert.equal(result.failed, 1); assert.equal(result.verified, 0); assert.equal(f.calls.length, 0);
  }
});

test('batch accepts shuffled complete receipts by explicit index and retains remaining time cap', async () => {
  const f = batchFixture({ change: d => d.results.reverse() });
  const result = await applyBatchClaims(f.sb, f.claims, { registry: f.registry, runMs: 500 });
  assert.equal(result.verified, 3); assert.equal(result.failed, 0);
  assert.ok(f.calls[0].args.timeout <= 500);
});

test('batch source registry mismatch fails even when the returned source ID is a valid UUID', async () => {
  const f = batchFixture();
  const result = await applyBatchClaims(f.sb, f.claims, { registry: f.registry, sourceId: IDS.output });
  assert.equal(result.failed, 1); assert.equal(result.verified, 0); assert.equal(f.calls.length, 1);
});
