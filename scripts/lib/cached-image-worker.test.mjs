import assert from 'node:assert/strict';
import test from 'node:test';
import { CACHE_BUDGET, CACHE_ASSAY_BUDGET, CACHE_WORKER_VERSION, initialCheckpoint, validateCheckpoint,
  publicCachedImageEligible, runCachedImageProjection, cachedWorkerExitCode } from './cached-image-worker.mjs';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const vehicle = id(1), source = id(2), witness = id(3);
const cutoff = '2026-10-03T00:00:00.000Z';
const properties = ['image_visible_rust_severity', 'image_visible_paint_stage', 'image_visible_assembly_state'];
function fixture(count = 1) {
  const rows = {
    observation_properties: properties.map((property_key, index) => ({ id: id(10 + index), property_key })),
    observation_sources: [{ id: source, slug: 'photo_pipeline' }],
    image_coverage_by_vehicle: [{ vehicle_id: vehicle, seen_t1: count }],
    vehicles: [{ id: vehicle, is_public: true }],
    vehicle_images: Array.from({ length: count }, (_, index) => ({ id: id(100 + index), vehicle_id: vehicle,
      image_url: `https://bringatrailer.com/wp-content/uploads/synthetic-${index}.jpg`, source: 'bat_import',
      vision_gate_status: 'approved', is_sensitive: false, is_duplicate: false, is_superseded: false,
      image_vehicle_match_status: null, created_at: '2026-10-01T00:00:00.000000+00:00' })),
    vehicle_observations: [],
  };
  for (const image of rows.vehicle_images) rows.vehicle_observations.push({
    id: id(1000 + Number(image.id.slice(-12))), vehicle_id: vehicle, kind: 'condition', is_superseded: false,
    observed_at: '2026-10-01T01:00:00Z', ingested_at: '2026-10-01T02:00:00Z', agent_model: 'recorded-vision-v1',
    extraction_method: 'recorded-image-method-v1', confidence: 'medium', confidence_score: 0.8,
    structured_data: { image_id: image.id, analysis_kind: 'image_deep_byok',
      state_observations: { rust_severity: 'surface', paint_state: 'aged', completeness: 'assembled' } },
  });
  const calls = [], saved = [], writes = [];
  const controls = { badTable: null, nullTable: null, emptyReader: false, readbackMismatch: false,
    applyFailed: false, partialApply: false, saveFailed: false, readerThrows: false, parentResponse: null };
  const value = (row, key) => key.includes('->>') ? row[key.split('->>')[0]]?.[key.split('->>')[1]] : row[key];
  function builder(table, rpcArgs) {
    const filters = [], orders = [];
    let limit = Infinity;
    const q = {
      select() { return q; }, limit(n) { limit = n; return q; }, abortSignal() { return q; },
      eq(key, v) { filters.push(row => value(row, key) === v); return q; },
      gt(key, v) { filters.push(row => value(row, key) > v); return q; },
      lte(key, v) { filters.push(row => key.endsWith('_at') ? Date.parse(value(row, key)) <= Date.parse(v) : value(row, key) <= v); return q; },
      in(key, values) { filters.push(row => values.includes(value(row, key))); return q; },
      not(key, op, v) { assert.equal(op, 'is'); filters.push(row => value(row, key) !== v); return q; },
      order(key, { ascending }) { orders.push([key, ascending]); return q; },
      or(expression) {
        const match = expression.match(/^created_at\.lt\.(.+),and\(created_at\.eq\.(.+),id\.lt\.([^,)]+)\)$/);
        assert.ok(match, expression); assert.equal(match[1], match[2]);
        filters.push(row => Date.parse(row.created_at) < Date.parse(match[1]) ||
          (Date.parse(row.created_at) === Date.parse(match[1]) && row.id < match[3])); return q;
      },
      then(resolve, reject) {
        return Promise.resolve().then(() => {
          calls.push({ table, rpcArgs });
          if (controls.badTable === table) return { error: { message: 'private failure text' }, data: null };
          if (controls.nullTable === table) return { error: null, data: null };
          if (table === 'get_cached_image_projection_parents') {
            const parents = rpcArgs.p_image_ids.map(image_id => ({ image_id, parent: rows.vehicle_observations
              .filter(row => row.vehicle_id === rpcArgs.p_vehicle_id && row.kind === 'condition' &&
                row.structured_data.image_id === image_id && row.structured_data.analysis_kind === 'image_deep_byok' &&
                Date.parse(row.ingested_at) <= Date.parse(rpcArgs.p_cutoff))
              .sort((a, b) => Date.parse(b.ingested_at) - Date.parse(a.ingested_at) || b.id.localeCompare(a.id))[0] ?? null }));
            const data = { parents: structuredClone(parents), requested: parents.length,
              found: parents.filter(entry => entry.parent).length, cutoff: rpcArgs.p_cutoff };
            if (controls.parentResponse) controls.parentResponse(data);
            return { data, error: null };
          }
          if (table === 'get_field_provenance') {
            if (controls.readerThrows) throw Error('private raw failure');
            return { data: { vehicle_id: rpcArgs.p_vehicle_id, field: rpcArgs.p_field,
              image_observations: controls.emptyReader ? [] : rows.vehicle_observations
                .filter(row => row.source_id === source && row.structured_data[rpcArgs.p_field])
                .map(row => ({ observation_id: row.id, image_id: row.structured_data.image_id,
                  witness_id: controls.missingReaderWitness ? null : witness,
                  witness_role: 'derived', value: row.structured_data[rpcArgs.p_field] })) }, error: null };
          }
          let data = (rows[table] ?? []).filter(row => filters.every(filter => filter(row)));
          data = [...data].sort((a, b) => {
            for (const [key, ascending] of orders) {
              if (a[key] !== b[key]) return (a[key] < b[key] ? -1 : 1) * (ascending ? 1 : -1);
            }
            return 0;
          }).slice(0, limit);
          return { data: structuredClone(data), error: null };
        }).then(resolve, reject);
      },
    };
    return q;
  }
  const sb = { from: table => builder(table), rpc: (name, args) => builder(name, args),
    functions: { invoke() { assert.fail('The stubbed writer is the only allowed mutation in this assay'); } } };
  const options = { checkpoint: initialCheckpoint(cutoff), apply: true,
    async saveCheckpoint(next) { if (controls.saveFailed) throw Error('private disk error'); saved.push(structuredClone(next)); },
    async applyClaims(_sb, claims) {
      writes.push(structuredClone(claims));
      assert.ok(claims.every(claim => claim.defer_analysis === true && claim.agent_cost_cents === 0));
      const inserted = controls.applyFailed ? 0 : controls.partialApply ? 1 : claims.length;
      for (const claim of claims.slice(0, inserted)) rows.vehicle_observations.push({
        id: id(3000 + rows.vehicle_observations.length), vehicle_id: claim.vehicle_id,
        kind: claim.kind, source_id: source, source_identifier: claim.source_identifier,
        property_id: rows.observation_properties.find(p => p.property_key === claim.property_key).id,
        confidence_score: controls.readbackMismatch ? 0.9 : 0.6, is_superseded: false,
        structured_data: structuredClone(claim.structured_data),
      });
      return { inserted, duplicates: 0, verified: inserted, failed: inserted === claims.length ? 0 : 1,
        unattempted: claims.length - inserted };
    },
  };
  return { rows, calls, saved, writes, controls, sb, options };
}

test('healthy cached source lands only canonical missing properties and verifies real reader-shaped evidence', async () => {
  const f = fixture(); const result = await runCachedImageProjection(f.sb, f.options);
  assert.equal(cachedWorkerExitCode(result), 0);
  assert.equal(result.newly_persisted_claims, 3);
  assert.equal(result.confirmed_reader_visible_claims, 3);
  assert.equal(result.verified_sources, 1);
  assert.equal(result.model_calls, 0); assert.equal(result.hosted_spend_usd, 0);
  assert.equal(f.writes.length, 1); assert.equal(f.writes[0].length, 3);
  assert.equal(result.checkpoint.completed_cycles, 1);
  assert.equal(result.checkpoint.current_vehicle_id, null);
  assert.equal(result.remaining_unknown, true);
});

test('next run advances beyond the first source budget instead of reprocessing the same20', async () => {
  const f = fixture(23);
  const first = await runCachedImageProjection(f.sb, { ...f.options, sourceLimit: 20 });
  assert.equal(first.verified_sources, 20); assert.equal(first.newly_persisted_claims, 60);
  assert.equal(first.checkpoint.current_vehicle_id, vehicle);
  const second = await runCachedImageProjection(f.sb, { ...f.options, checkpoint: first.checkpoint });
  assert.equal(second.verified_sources, 3); assert.equal(second.newly_persisted_claims, 9);
  const unique = new Set(f.writes.flat().map(row => row.source_identifier));
  assert.equal(unique.size, 69);
  assert.equal(second.checkpoint.completed_cycles, 1);
});

test('lost checkpoint replays immutable identities without rewriting completed claims', async () => {
  const f = fixture();
  await runCachedImageProjection(f.sb, f.options);
  const replay = await runCachedImageProjection(f.sb, f.options);
  assert.equal(replay.existing_claims, 3); assert.equal(replay.newly_persisted_claims, 0);
  assert.equal(replay.verified_sources, 1); assert.equal(f.writes.length, 1);
});

test('partial persistence retains image cursor and next run writes only missing properties', async () => {
  const f = fixture(); f.controls.partialApply = true;
  const partial = await runCachedImageProjection(f.sb, f.options);
  assert.equal(partial.status, 'failed'); assert.equal(partial.reason, 'canonical_persistence_unverified');
  assert.equal(partial.checkpoint.image_cursor, null);
  f.controls.partialApply = false;
  const retry = await runCachedImageProjection(f.sb, { ...f.options, checkpoint: partial.checkpoint });
  assert.equal(retry.existing_claims, 1); assert.equal(retry.newly_persisted_claims, 2);
  assert.equal(retry.verified_sources, 1); assert.equal(f.writes[1].length, 2);
});

test('dry run neither persists evidence nor saves operational progress', async () => {
  const f = fixture(); const result = await runCachedImageProjection(f.sb, { ...f.options, apply: false });
  assert.equal(result.eligible_claims, 3); assert.equal(result.verified_sources, 0);
  assert.equal(f.writes.length, 0); assert.equal(f.saved.length, 0);
  assert.equal(result.checkpoint_saved, false);
});

for (const [name, change, reason] of [
  ['missing source', f => { f.rows.vehicle_observations = []; }, 'immutable_testimony_missing'],
  ['low confidence', f => { f.rows.vehicle_observations[0].confidence_score = 0.2; }, 'source_confidence_ineligible'],
  ['source mismatch', f => { f.rows.vehicle_observations[0].vehicle_id = id(99); }, 'immutable_testimony_missing'],
  ['missing model', f => { f.rows.vehicle_observations[0].agent_model = null; }, 'source_provenance_incomplete'],
  ['unknown properties', f => { f.rows.vehicle_observations[0].structured_data.state_observations = {}; }, 'no_known_scalar_values'],
  ['source review', f => { f.rows.vehicle_observations[0].structured_data.needs_review = true; }, 'source_requires_review'],
  ['document testimony', f => { f.rows.vehicle_observations[0].structured_data.scene_type = 'receipt_document'; }, 'document_testimony'],
  ['wrong public host', f => { f.rows.vehicle_images[0].image_url = 'https://private.invalid/photo'; }, 'image_not_public_qualified'],
]) test(`${name} advances safe deferral without producing a claim`, async () => {
  const f = fixture(); change(f); const result = await runCachedImageProjection(f.sb, f.options);
  assert.equal(f.writes.length, 0); assert.equal(result.deferred[reason], 1);
  assert.equal(result.checkpoint.completed_cycles, 1);
  assert.equal(result.verified_sources, 0);
});

for (const [name, mutate] of [
  ['pending gate', image => { image.vision_gate_status = 'pending'; }],
  ['sensitive', image => { image.is_sensitive = true; }],
  ['duplicate', image => { image.is_duplicate = true; }],
  ['document', image => { image.is_document = true; }],
  ['superseded', image => { image.is_superseded = true; }],
  ['private source', image => { image.source = 'user_upload'; }],
  ['known mismatch', image => { image.image_vehicle_match_status = 'mismatch'; }],
  ['userinfo URL', image => { image.image_url = 'https://user:secret@bringatrailer.com/photo'; }],
  ['token URL', image => { image.image_url += '?token=private'; }],
  ['HTTP URL', image => { image.image_url = image.image_url.replace('https:', 'http:'); }],
]) test(`${name} fails public source eligibility`, () => {
  const f = fixture(); mutate(f.rows.vehicle_images[0]);
  assert.equal(publicCachedImageEligible(f.rows.vehicle_images[0], vehicle), false);
});

test('private vehicle never admits public-hosted photos', async () => {
  const f = fixture(); f.rows.vehicles[0].is_public = false;
  const result = await runCachedImageProjection(f.sb, f.options);
  assert.equal(result.deferred.vehicle_not_public, 1); assert.equal(f.writes.length, 0);
  assert.equal(f.calls.some(call => call.table === 'vehicle_images'), false);
});

for (const [name, change, reason] of [
  ['query error', f => { f.controls.badTable = 'vehicle_images'; }, 'database_query_failed'],
  ['null query result', f => { f.controls.nullTable = 'vehicle_images'; }, 'database_response_invalid'],
  ['persistence error', f => { f.controls.applyFailed = true; }, 'canonical_persistence_unverified'],
  ['false confidence readback', f => { f.controls.readbackMismatch = true; }, 'canonical_readback_mismatch'],
  ['reader missing citation', f => { f.controls.emptyReader = true; }, 'reader_evidence_unverified'],
  ['reader exception', f => { f.controls.readerThrows = true; }, 'database_query_failed'],
  ['checkpoint write error', f => { f.controls.saveFailed = true; }, 'checkpoint_write_failed'],
]) test(`${name} cannot report source completion or advance past failing image`, async () => {
  const f = fixture(); change(f); const result = await runCachedImageProjection(f.sb, f.options);
  assert.equal(result.status, 'failed'); assert.equal(result.reason, reason);
  assert.equal(cachedWorkerExitCode(result), 1); assert.equal(result.verified_sources, 0);
  assert.equal(result.checkpoint.image_cursor, null);
  assert.ok(!JSON.stringify(result).includes('private'));
});

test('empty bounded coverage cycle resets only operational cursor; never claims full corpus completion', async () => {
  const f = fixture(); f.rows.image_coverage_by_vehicle = [];
  const result = await runCachedImageProjection(f.sb, f.options);
  assert.equal(result.reason, 'bounded_coverage_cycle_complete');
  assert.equal(result.checkpoint.completed_cycles, 1);
  assert.equal(result.full_history_verified, false); assert.equal(result.remaining_unknown, true);
});

test('malformed checkpoints and expanded work budgets reject before evidence writes', async () => {
  for (const value of [null, {}, { ...initialCheckpoint(cutoff), image_cursor: { id: 'bad', created_at: cutoff } },
    { ...initialCheckpoint(cutoff), unexpected: true }]) assert.throws(() => validateCheckpoint(value));
  const f = fixture();
  const result = await runCachedImageProjection(f.sb, { ...f.options, sourceLimit: CACHE_BUDGET.maximum_sources + 1 });
  assert.equal(result.reason, 'invalid_work_budget'); assert.equal(f.writes.length, 0); assert.equal(f.calls.length, 0);
  assert.equal(cachedWorkerExitCode({ consumer: CACHE_WORKER_VERSION, status: 'success' }), 1);
});

test('full image page persists a precise keyset cursor and visits the next page on restart', async () => {
  const f = fixture(35);
  const first = await runCachedImageProjection(f.sb, { ...f.options, sourceLimit: 32 });
  assert.equal(first.verified_sources, 32);
  assert.equal(first.checkpoint.current_vehicle_id, vehicle);
  const second = await runCachedImageProjection(f.sb, { ...f.options, sourceLimit: 100, checkpoint: first.checkpoint });
  assert.equal(second.verified_sources, 3);
  assert.equal(new Set(f.writes.flat().map(claim => claim.source_identifier)).size, 105);
});

test('default run processes multiple1000-image batches, with one parent lookup and three reader calls each', async () => {
  const f = fixture(1003);
  const result = await runCachedImageProjection(f.sb, f.options);
  assert.equal(result.verified_sources, 1003);
  assert.equal(result.newly_persisted_claims, 3009);
  assert.equal(f.writes.length, 2); assert.equal(f.writes[0].length, 3000);
  assert.equal(f.calls.filter(call => call.table === 'get_cached_image_projection_parents').length, 2);
  assert.equal(f.calls.filter(call => call.table === 'get_field_provenance').length, 6);
  assert.equal(result.budget.run_ms, 300000);
  assert.equal(result.budget.sources, 100000);
  assert.equal(result.checkpoint.completed_cycles, 1);
});

test('explicit source budget remains bounded without becoming the default run capacity', async () => {
  const f = fixture(103);
  const result = await runCachedImageProjection(f.sb, { ...f.options, sourceLimit: 100 });
  assert.equal(result.verified_sources, 100); assert.equal(result.eligible_claims, 300);
  assert.equal(f.calls.filter(call => call.table === 'get_field_provenance').length, 3);
  assert.equal(result.checkpoint.current_vehicle_id, vehicle);
});

test('time budget expiring during persistence leaves the source retryable with no claimed reader completion', async () => {
  const f = fixture(); let clock = 0;
  const result = await runCachedImageProjection(f.sb, { ...f.options, now: () => clock,
    async applyClaims(...args) { const applied = await f.options.applyClaims(...args); clock = CACHE_BUDGET.run_ms; return applied; },
  });
  assert.equal(result.status, 'failed'); assert.equal(result.reason, 'run_budget_exhausted');
  assert.equal(result.newly_persisted_claims, 3);
  assert.equal(result.confirmed_reader_visible_claims, 0);
  assert.equal(result.verified_sources, 0); assert.equal(result.checkpoint.image_cursor, null);
  const retry = await runCachedImageProjection(f.sb, { ...f.options, checkpoint: result.checkpoint });
  assert.equal(retry.existing_claims, 3); assert.equal(retry.newly_persisted_claims, 0);
  assert.equal(retry.verified_sources, 1); assert.equal(f.writes.length, 1);
});

test('time budget expiring after a fully verified source retains that progress without claiming all work done', async () => {
  const f = fixture(2); let clock = 0;
  const result = await runCachedImageProjection(f.sb, { ...f.options, sourceLimit: 1, now: () => clock,
    async saveCheckpoint(next) { await f.options.saveCheckpoint(next); if (next.image_cursor) clock = CACHE_BUDGET.run_ms; },
  });
  assert.equal(result.status, 'incomplete');
  assert.equal(result.verified_sources, 1); assert.equal(result.newly_persisted_claims, 3);
  assert.ok(result.checkpoint.image_cursor); assert.equal(result.remaining_unknown, true);
  const resumed = await runCachedImageProjection(f.sb, { ...f.options, checkpoint: result.checkpoint });
  assert.equal(resumed.verified_sources, 1); assert.equal(resumed.newly_persisted_claims, 3);
});

test('a source outside the frozen cutoff is deferred and can be revisited in the next coverage cycle', async () => {
  const f = fixture(); f.rows.vehicle_observations[0].ingested_at = '2026-10-04T00:00:00Z';
  const result = await runCachedImageProjection(f.sb, f.options);
  assert.equal(result.deferred.immutable_testimony_missing, 1);
  assert.equal(f.writes.length, 0);
  const revisit = await runCachedImageProjection(f.sb, { ...f.options, checkpoint: initialCheckpoint('2026-10-05T00:00:00Z') });
  assert.equal(revisit.verified_sources, 1);
});

for (const [name, mutate] of [
  ['omitted requested image', d => { d.parents.pop(); }],
  ['repeated image entry', d => { d.parents[1] = d.parents[0]; }],
  ['wrong vehicle', d => { d.parents[0].parent.vehicle_id = id(900); }],
  ['wrong image', d => { d.parents[0].parent.structured_data.image_id = id(900); }],
  ['unknown parent', d => { delete d.parents[0].parent; }],
  ['wrong found total', d => { d.found--; }],
  ['wrong cutoff', d => { d.cutoff = '2026-10-04T00:00:00Z'; }],
  ['future parent', d => { d.parents[0].parent.ingested_at = '2026-10-04T00:00:00Z'; }],
]) test(`batch parent ${name} stops before mutation and preserves the batch cursor`, async () => {
  const f = fixture(2); f.controls.parentResponse = mutate;
  const result = await runCachedImageProjection(f.sb, f.options);
  assert.equal(result.status, 'failed'); assert.equal(result.reason, 'parent_response_invalid');
  assert.equal(f.writes.length, 0); assert.equal(result.checkpoint.image_cursor, null);
});

test('newest low confidence testimony is deferred instead of selecting an older favorable result', async () => {
  const f = fixture();
  const newer = structuredClone(f.rows.vehicle_observations[0]);
  newer.id = id(9000); newer.ingested_at = '2026-10-02T00:00:00Z'; newer.confidence_score = 0.2;
  f.rows.vehicle_observations.push(newer);
  const result = await runCachedImageProjection(f.sb, f.options);
  assert.equal(result.deferred.source_confidence_ineligible, 1);
  assert.equal(f.writes.length, 0);
});

test('a missing reader citation holds the complete batch and replay reuses already persisted claims', async () => {
  const f = fixture(20); f.controls.emptyReader = true;
  const failed = await runCachedImageProjection(f.sb, f.options);
  assert.equal(failed.newly_persisted_claims, 60);
  assert.equal(failed.verified_sources, 0); assert.equal(failed.confirmed_reader_visible_claims, 0);
  assert.equal(failed.checkpoint.image_cursor, null);
  f.controls.emptyReader = false;
  const replay = await runCachedImageProjection(f.sb, { ...f.options, checkpoint: failed.checkpoint });
  assert.equal(replay.existing_claims, 60); assert.equal(replay.newly_persisted_claims, 0);
  assert.equal(replay.verified_sources, 20); assert.equal(f.writes.length, 1);
});

test('only a fully verified batch advances and a later failed batch preserves earlier progress', async () => {
  const f = fixture(1002); let batches = 0;
  const first = await runCachedImageProjection(f.sb, { ...f.options,
    async applyClaims(...args) {
      if (++batches === 2) f.controls.applyFailed = true;
      return f.options.applyClaims(...args);
    },
  });
  assert.equal(first.status, 'failed'); assert.equal(first.verified_sources, 1000);
  assert.equal(first.checkpoint.image_cursor.id, id(102));
  f.controls.applyFailed = false;
  const resumed = await runCachedImageProjection(f.sb, { ...f.options, checkpoint: first.checkpoint });
  assert.equal(resumed.verified_sources, 2); assert.equal(resumed.newly_persisted_claims, 6);
});

test('run can traverse multiple vehicle candidate pages without an artificial60-vehicle stop', async () => {
  const f = fixture();
  f.rows.image_coverage_by_vehicle = Array.from({ length: 62 }, (_, index) => ({ vehicle_id: id(10000 + index), seen_t1: 1 }));
  f.rows.vehicles = f.rows.image_coverage_by_vehicle.map(row => ({ id: row.vehicle_id, is_public: true }));
  f.rows.vehicle_images = [];
  const result = await runCachedImageProjection(f.sb, f.options);
  assert.equal(result.inspected_vehicles, 62);
  assert.equal(f.calls.filter(call => call.table === 'image_coverage_by_vehicle').length, 3);
  assert.equal(result.checkpoint.completed_cycles, 1);
});

test('worker and actual bulk helper share registry and count every caller request', async () => {
  const f = fixture(20); let invocations = 0;
  f.sb.functions.invoke = async (name, args) => {
    assert.equal(name, 'ingest-observation-batch');
    assert.equal(args.body.mode, 'cached_image_property_projection_v1');
    invocations++;
    const claims = args.body.observations;
    await f.options.applyClaims(f.sb, claims);
    const results = claims.map((claim, index) => {
      const row = f.rows.vehicle_observations.find(row => row.source_identifier === claim.source_identifier);
      return { index, success: true, duplicate: false, observation_id: row.id,
        vehicle_id: row.vehicle_id, image_id: row.structured_data.image_id,
        property_id: row.property_id, property_key: claim.property_key, value: row.structured_data[claim.property_key],
        source_observation_id: row.structured_data.source_observation_id,
        source_result_hash: row.structured_data.source_result_hash,
        source_recorded_at: row.structured_data.source_recorded_at,
        confidence_score: row.confidence_score, witness_id: id(50000 + index) };
    });
    return { data: { success: true, source_id: source, total: claims.length, ingested: claims.length, duplicates: 0, failed: 0, results }, error: null };
  };
  const result = await runCachedImageProjection(f.sb, { ...f.options, applyClaims: undefined });
  assert.equal(result.verified_sources, 20); assert.equal(result.newly_persisted_claims, 60);
  assert.equal(invocations, 1); assert.equal(result.canonical_batch_calls, 1);
  assert.equal(result.queries, f.calls.length + invocations);
  assert.equal(f.calls.filter(call => call.table === 'observation_properties').length, 1);
  assert.equal(f.calls.filter(call => call.table === 'get_field_provenance').length, 3);
  assert.equal(result.queries, 13);
});

test('a completed coverage cycle automatically revisits previously missing testimony with a fresh cutoff', async () => {
  const f = fixture(); f.rows.vehicle_observations[0].ingested_at = '2026-10-04T00:00:00Z';
  const first = await runCachedImageProjection(f.sb, { ...f.options, now: () => Date.parse('2026-10-05T00:00:00Z') });
  assert.equal(first.deferred.immutable_testimony_missing, 1);
  assert.equal(first.checkpoint.completed_cycles, 1);
  assert.equal(first.checkpoint.cutoff, '2026-10-05T00:00:00.000Z');
  const next = await runCachedImageProjection(f.sb, { ...f.options, checkpoint: first.checkpoint });
  assert.equal(next.verified_sources, 1); assert.equal(next.newly_persisted_claims, 3);
});

async function assayFixture(count = 1) {
  const f = fixture(count);
  await runCachedImageProjection(f.sb, f.options);
  f.calls.length = 0; f.writes.length = 0; f.saved.length = 0;
  f.assay = { checkpoint: initialCheckpoint(cutoff), verifyOnly: true, apply: false, vehicleId: vehicle,
    saveCheckpoint() { assert.fail('Read-only coverage must never save processing progress'); },
    applyClaims() { assert.fail('Read-only coverage must never invoke intake'); } };
  return f;
}

test('coverage verifies expected immutable-source claims and reader witnesses without writes or a fleet query', async () => {
  const f = await assayFixture();
  const result = await runCachedImageProjection(f.sb, f.assay);
  assert.equal(result.mode, 'cached_assay'); assert.equal(cachedWorkerExitCode(result), 0);
  assert.equal(result.existing_claims, 3); assert.equal(result.missing_claims, 0);
  assert.equal(result.confirmed_reader_visible_claims, 3);
  assert.equal(result.canonical_batch_calls, 0); assert.equal(result.newly_persisted_claims, 0);
  assert.equal(result.checkpoint_saved, false); assert.equal(result.budget.run_ms, 60000);
  assert.equal(result.budget.image_visits, 100); assert.equal(result.budget.queries, 20);
  assert.equal(f.calls.some(call => call.table === 'image_coverage_by_vehicle'), false);
  assert.equal(f.writes.length + f.saved.length, 0); assert.equal(result.full_history_verified, false);
});

test('coverage detects a claim that never arrived, without repairing it as a side effect', async () => {
  const f = await assayFixture(); f.rows.vehicle_observations.pop();
  const result = await runCachedImageProjection(f.sb, f.assay);
  assert.equal(cachedWorkerExitCode(result), 1);
  assert.equal(result.reason, 'canonical_readback_incomplete');
  assert.equal(result.eligible_claims, 3); assert.equal(result.existing_claims, 2); assert.equal(result.missing_claims, 1);
  assert.equal(f.writes.length + f.saved.length, 0);
});

for (const control of ['emptyReader', 'missingReaderWitness', 'readerThrows']) {
  test(`coverage fails for ${control} despite all claims being stored`, async () => {
    const f = await assayFixture(); f.controls[control] = true;
    const result = await runCachedImageProjection(f.sb, f.assay);
    assert.equal(cachedWorkerExitCode(result), 1); assert.equal(result.existing_claims, 3);
    assert.equal(result.confirmed_reader_visible_claims, 0);
    assert.equal(f.writes.length + f.saved.length, 0);
  });
}

test('coverage validates existing values instead of treating identity presence as evidence', async () => {
  const f = await assayFixture(); const row = f.rows.vehicle_observations.at(-1);
  row.structured_data.image_visible_assembly_state = 'stripped';
  const result = await runCachedImageProjection(f.sb, f.assay);
  assert.equal(result.reason, 'canonical_readback_mismatch'); assert.equal(cachedWorkerExitCode(result), 1);
});

test('empty, private, missing-testimony and unresolved samples remain incomplete', async () => {
  for (const mutate of [f => { f.rows.vehicle_images = []; }, f => { f.rows.vehicles[0].is_public = false; },
    f => { f.rows.vehicle_observations = []; }, f => { f.rows.vehicle_observations[0].structured_data.needs_review = true; }]) {
    const f = await assayFixture(); mutate(f);
    const result = await runCachedImageProjection(f.sb, f.assay);
    assert.equal(result.reason, 'no_eligible_claims'); assert.equal(cachedWorkerExitCode(result), 2);
    assert.equal(result.confirmed_reader_visible_claims, 0);
  }
});

test('coverage caps sources and image visits; verified capped samples cannot exit healthy', async () => {
  const f = await assayFixture(101);
  const result = await runCachedImageProjection(f.sb, { ...f.assay, sourceLimit: 100 });
  assert.equal(result.inspected_images, 100); assert.equal(result.confirmed_reader_visible_claims, 300);
  assert.equal(result.reason, 'work_budget_reached'); assert.equal(cachedWorkerExitCode(result), 2);
  assert.equal(result.checkpoint_saved, false);
});

test('coverage cannot inherit apply mode, another vehicle checkpoint or expanded source budget', async () => {
  for (const override of [{ apply: true }, { vehicleId: null }, { sourceLimit: 101 }, { sourceLimit: 0 },
    { checkpoint: { ...initialCheckpoint(cutoff), current_vehicle_id: id(999) } }]) {
    const f = await assayFixture(); const result = await runCachedImageProjection(f.sb, { ...f.assay, ...override });
    assert.equal(result.reason, 'invalid_work_budget'); assert.equal(cachedWorkerExitCode(result), 1);
    assert.equal(f.calls.length, 0);
  }
  assert.throws(() => { CACHE_ASSAY_BUDGET.image_visits = 100000; }, TypeError);
});

test('coverage query failure stays unknown instead of reporting no missing output', async () => {
  const f = await assayFixture(); f.controls.badTable = 'vehicle_observations';
  const result = await runCachedImageProjection(f.sb, f.assay);
  assert.equal(result.reason, 'database_query_failed'); assert.equal(cachedWorkerExitCode(result), 1);
  assert.equal(result.confirmed_reader_visible_claims, 0);
});

test('coverage run deadline is incomplete and never expands or writes progress', async () => {
  const f = await assayFixture(); let time = 0;
  const result = await runCachedImageProjection(f.sb, { ...f.assay, now: () => time += 30000 });
  assert.equal(result.reason, 'run_budget_exhausted'); assert.equal(cachedWorkerExitCode(result), 2);
  assert.equal(f.writes.length + f.saved.length, 0);
});
