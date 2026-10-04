import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { assess, options, query, run, SAMPLE_LIMIT, cachedAssayOptions, assessFreshImages, runFreshImages } from './check-image-observation-health.mjs';

const scope = { vehicle: '10000000-0000-0000-0000-000000000001', since: '2026-10-04T05:00:00Z', field: 'interior_color' };

function admission() {
  return { assay: 'fresh_image_admission_v1', sample_limit: 20, candidate_vehicle_limit: 5,
    window_hours: 24, vehicle_selected: true, sample_truncated: false, output_coverage: 'not_measured',
    metrics: { sampled: 1, gallery_eligible: 1, source_policy_deferred: 1, unexplained_skips: 0,
      pending: 0, processing: 0, completed: 0, failed: 0, other_status: 0, pipeline_receipts: 0 } };
}
test('admission, gallery arrival and completed receipts never certify analysis output', () => {
  const a = admission();
  assert.equal(assessFreshImages(a).status, 'incomplete');
  assert(assessFreshImages(a).reasons.includes('external_link_analysis_requires_explicit_request'));
  a.metrics.source_policy_deferred = 0; a.metrics.completed = 1; a.metrics.pipeline_receipts = 1;
  assert.equal(assessFreshImages(a).status, 'incomplete');
  a.metrics.completed = 0; a.metrics.failed = 1;
  assert.equal(assessFreshImages(a).status, 'failed');
});
test('unknown skips, empty arrivals and caps remain explicit incomplete evidence', () => {
  const a = admission(); a.metrics.source_policy_deferred = 0; a.metrics.unexplained_skips = 1;
  assert(assessFreshImages(a).reasons.includes('skip_reason_unknown'));
  for (const k of Object.keys(a.metrics)) a.metrics[k] = 0;
  a.vehicle_selected = false;
  assert(assessFreshImages(a).reasons.includes('no_sampled_arrivals'));
  a.vehicle_selected = true; a.sample_truncated = true;
  a.metrics.sampled = a.metrics.source_policy_deferred = 20;
  assert(assessFreshImages(a).reasons.includes('sample_truncated'));
});
test('admission query failures and malformed counts cannot become zero or healthy', () => {
  for (const execute of [() => { throw Error('private credential-bearing error'); }, () => 'null',
    () => '[]', () => JSON.stringify([{ assay: null }])]) {
    const r = runFreshImages(execute);
    assert.equal(r.status, 'failed'); assert.equal(r.coverage, 'unknown');
    assert(!JSON.stringify(r).includes('private'));
  }
  for (const value of [null, -1, '1', 21]) {
    const a = admission(); a.metrics.sampled = value;
    assert.throws(() => assessFreshImages(a));
  }
  const a = admission(); a.metrics.processing = 1;
  assert.throws(() => assessFreshImages(a));
  a.metrics.processing = 0; a.output_coverage = 'passed';
  assert.throws(() => assessFreshImages(a));
  let sql;
  assert.equal(runFreshImages(q => { sql = q; return JSON.stringify([{ assay: admission() }]); }).status, 'incomplete');
  assert.equal(sql, "SELECT public.get_pipeline_pulse_24h()->'fresh_image_flow' AS assay;");
});

test('cached coverage requires an explicit bounded vehicle scope and always selects read-only mode', () => {
  const args = ['--cached-coverage', '--vehicle', scope.vehicle];
  assert.deepEqual(cachedAssayOptions(args), { verifyOnly: true, apply: false, vehicleId: scope.vehicle, sourceLimit: 20 });
  assert.equal(cachedAssayOptions([...args, '--sources', '100']).sourceLimit, 100);
  for (const invalid of [[], ['--cached-coverage'], [...args, '--sources', '101'], [...args, '--sources', '0'],
    [...args, '--sources', '1e2'], [...args, '--apply', '1'], [...args, '--vehicle', scope.vehicle],
    ['--cached-coverage', '--vehicle', "x';select"]]) assert.throws(() => cachedAssayOptions(invalid));
});

test('actual cached coverage CLI ignores apply and progress configuration and cannot call a writer', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cached-image-coverage-test-'));
  try {
    const script = join(directory, 'assay.mjs'), checkpoint = join(directory, 'checkpoint.json');
    await copyFile(new URL('./check-image-observation-health.mjs', import.meta.url), script);
    await mkdir(join(directory, 'lib'));
    for (const name of ['cached-image-worker.mjs', 'image-property-projection.mjs']) {
      await copyFile(new URL(`./lib/${name}`, import.meta.url), join(directory, 'lib', name));
    }
    for (const name of ['dotenv', '@supabase/supabase-js']) {
      const target = join(directory, 'node_modules', name); await mkdir(target, { recursive: true });
      await writeFile(join(target, 'package.json'), JSON.stringify({ type: 'module', main: 'index.js' }));
    }
    await writeFile(join(directory, 'node_modules/dotenv/index.js'), 'export default { config() {} };');
    await writeFile(join(directory, 'node_modules/@supabase/supabase-js/index.js'), `
      export function createClient() {
        const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12,'0');
        const data = { observation_properties: ['image_visible_rust_severity','image_visible_paint_stage','image_visible_assembly_state']
          .map((property_key,i) => ({id:id(i+1),property_key})), observation_sources: [{id:id(10),slug:'photo_pipeline'}],
          vehicles: [{id:${JSON.stringify(scope.vehicle)},is_public:true}], vehicle_images: [] };
        return {from(table) { if (!(table in data)) throw Error('unexpected table');
          const q = new Proxy({}, {get(_, key) { if (key === 'then') return resolve => resolve({data:data[table],error:null});
            if (['insert','update','delete','upsert'].includes(key)) throw Error('write forbidden'); return () => q; }}); return q; },
          rpc() {throw Error('unexpected RPC');}, functions: {invoke() {throw Error('write forbidden');}}};
      }
    `);
    await writeFile(checkpoint, 'preserved owner progress');
    const result = spawnSync(process.execPath, [script, '--cached-coverage', '--vehicle', scope.vehicle], {
      encoding: 'utf8', timeout: 5000, env: { SUPABASE_URL: 'https://example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'offline-only',
        IMAGE_CACHE_APPLY: '1', IMAGE_CACHE_SOURCE_LIMIT: '100000', IMAGE_CACHE_CHECKPOINT: checkpoint, IMAGE_PROCESSING_MODE: 'cached' },
    });
    assert.equal(result.error, undefined); assert.equal(result.status, 2, result.stderr);
    const receipt = JSON.parse(result.stdout);
    assert.equal(receipt.mode, 'cached_assay'); assert.equal(receipt.reason, 'no_eligible_claims');
    assert.equal(receipt.budget.sources, 20); assert.equal(receipt.checkpoint_saved, false);
    assert.equal(receipt.canonical_batch_calls, 0); assert.equal(receipt.newly_persisted_claims, 0);
    assert.equal(await readFile(checkpoint, 'utf8'), 'preserved owner progress');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
function fixture() {
  return {
    assay: 'image_observation_health_v1', sample_limit: SAMPLE_LIMIT,
    metrics: { sampled: 1, image_claims: 1, excluded_share: 0, invalid_image_refs: 0, missing_images: 0,
      mismatched_vehicles: 0, cached_projections: 0, cached_source_ineligible: 0, cached_bad_reader_visible: 0, eligible: 1, missing_witnesses: 0, fresh_witnesses: 1, fresh_images: 1,
      reader_eligible: 1, reader_missing: 0 },
    sensors: ['vehicle_observations', 'observation_witnesses', 'vehicle_images'].map(tbl => ({
      tbl, enabled: true, last_receipt_at: '2026-10-04T05:01:00Z', writer_declared: true,
    })),
  };
}

test('complete sample requires persisted witness, reader and receipt evidence', () => {
  assert.equal(assess(fixture()).status, 'passed_in_scope');
  for (const key of ['invalid_image_refs', 'missing_images', 'mismatched_vehicles', 'missing_witnesses', 'reader_missing']) {
    const f = fixture(); f.metrics[key] = 1;
    assert.equal(assess(f).status, 'failed', key);
  }
});
test('installed sensor cannot conceal a swallowed receipt failure', () => {
  for (let i = 0; i < 3; i++) {
    const f = fixture(); f.sensors[i].last_receipt_at = null;
    assert.equal(assess(f).status, 'failed');
    assert(assess(f).reasons.includes(`${f.sensors[i].tbl}:receipt_missing`));
  }
  const f = fixture(); f.sensors[1].enabled = false;
  assert.equal(assess(f).status, 'failed');
});
test('undeclared writer, no reader and truncated samples stay incomplete', () => {
  const f = fixture(); f.sensors[0].writer_declared = false;
  assert.equal(assess(f).status, 'incomplete');
  const hidden = fixture(); hidden.metrics.reader_eligible = 0;
  assert.equal(assess(hidden).status, 'incomplete');
  const capped = fixture(); capped.metrics.sampled = SAMPLE_LIMIT + 1;
  assert.equal(assess(capped).status, 'incomplete');
});
test('zero arrivals never certifies useful processing', () => {
  const f = fixture(); for (const k of Object.keys(f.metrics)) f.metrics[k] = 0;
  for (const s of f.sensors) s.last_receipt_at = null;
  const r = assess(f);
  assert.equal(r.status, 'incomplete');
  assert(r.reasons.includes('no_eligible_arrivals') && r.reasons.includes('reader_not_measured'));
});
test('malformed, null or inconsistent metrics cannot become zero', () => {
  for (const patch of [null, '0', -1, NaN, undefined]) {
    const f = fixture(); f.metrics.sampled = patch;
    assert.throws(() => assess(f));
  }
  const f = fixture(); f.metrics.eligible = 2;
  assert.throws(() => assess(f));
  f.metrics.eligible = 1; f.sensors[1].tbl = f.sensors[0].tbl;
  assert.throws(() => assess(f));
});
test('transport, null responses and database errors fail with sanitized unknown coverage', () => {
  for (const execute of [() => { throw new Error('private credential-bearing error'); },
    () => 'null', () => '[]', () => JSON.stringify({ error: 'private failure' }),
    () => JSON.stringify([{ assay: null }])]) {
    const r = run(scope, execute);
    assert.equal(r.status, 'failed'); assert.equal(r.coverage, 'unknown');
    assert(!JSON.stringify(r).includes('private'));
  }
});
test('CLI scope validation prevents injection and requires an explicit ingest boundary', () => {
  const valid = ['--vehicle', scope.vehicle, '--since', scope.since];
  assert.equal(options(valid).since, '2026-10-04T05:00:00.000Z');
  assert.equal(options([...valid, '--field', 'image_visible_rust_severity']).field, 'image_visible_rust_severity');
  for (const args of [[], ['--vehicle', scope.vehicle], [...valid, '--field', "color');delete"],
    ['--vehicle', "x';select", '--since', scope.since], [...valid, '--other', '1']]) {
    assert.throws(() => options(args));
  }
});
test('successful execution still assesses actual evidence and uses a bounded read-only query', () => {
  let sql;
  const r = run(scope, q => { sql = q; return JSON.stringify([{ assay: fixture() }]); });
  assert.equal(r.status, 'passed_in_scope');
  assert(sql.includes(`LIMIT ${SAMPLE_LIMIT + 1}`));
  assert(!/\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\s+(?:INTO|public\.)/i.test(sql));
});

test('actual SQL detects broken links, missing receipts and visibility exclusions', {
  skip: !process.env.IMAGE_HEALTH_TEST_SOCKET,
}, () => {
  const socket = process.env.IMAGE_HEALTH_TEST_SOCKET;
  assert(socket.startsWith('/private/tmp/nuke-image-health-') && socket.endsWith('/socket'), 'disposable socket only');
  const sql = (mutation = '', sample = scope) => execFileSync(process.env.IMAGE_HEALTH_TEST_PSQL ?? 'psql',
    ['-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1', '-h', socket, '-p', '55466',
      '-d', 'dm_refinement_image_assay', '-c', `BEGIN; ${mutation} ${query(sample)} ROLLBACK;`], { encoding: 'utf8' });
  const check = (mutation, status, sample = scope) => {
    const r = assess(JSON.parse(sql(mutation, sample)));
    assert.equal(r.status, status, mutation || 'healthy baseline');
    return r;
  };
  check('', 'passed_in_scope');
  check('DELETE FROM public.observation_witnesses;', 'failed');
  check("UPDATE public.test_reader SET payload = '{\"image_observations\":[]}';", 'failed');
  check("UPDATE public.vehicle_observations SET structured_data = jsonb_set(structured_data,'{image_id}','\"not-a-uuid\"');", 'failed');
  check("UPDATE public.vehicle_observations SET structured_data = jsonb_set(structured_data,'{image_id}','\"30000000-0000-0000-0000-000000000009\"');", 'failed');
  check("UPDATE public.vehicle_images SET vehicle_id = '10000000-0000-0000-0000-000000000009';", 'failed');
  check('DROP TRIGGER trg_write_receipt_ins ON public.vehicle_images;', 'failed');
  check("DELETE FROM public.write_receipts WHERE tbl='observation_witnesses';", 'failed');
  check("UPDATE public.write_receipts SET writer='undeclared' WHERE tbl='vehicle_observations';", 'incomplete');
  check('UPDATE public.vehicle_images SET is_sensitive=true;', 'incomplete');
  check('UPDATE public.vehicles SET is_public=false;', 'incomplete');
  check('UPDATE public.vehicle_observations SET is_superseded=true;', 'incomplete');
  check("UPDATE public.vehicle_observations SET kind='comment',source_id='20000000-0000-0000-0000-000000000002', structured_data=structured_data || '{\"kind_detail\":\"professional_review\"}';", 'incomplete');
  check('', 'incomplete', { ...scope, since: '2099-01-01T00:00:00Z' });
  check(`INSERT INTO public.vehicle_observations (id,vehicle_id,source_id,kind,structured_data,is_superseded,ingested_at)
    SELECT ('60000000-0000-0000-0000-' || lpad(i::text,12,'0'))::uuid,
      '${scope.vehicle}'::uuid,'20000000-0000-0000-0000-000000000001'::uuid,
      'specification','{}'::jsonb,false,'2026-10-04T05:02:00Z'::timestamptz
    FROM generate_series(1,1000) i;`, 'incomplete');
});


test('ineligible cached source is a deferral; leaked child is an actual health failure', () => {
  const hidden = fixture();
  Object.assign(hidden.metrics, { cached_projections: 1, cached_source_ineligible: 1,
    eligible: 0, reader_eligible: 0, fresh_witnesses: 0, fresh_images: 0 });
  assert.equal(assess(hidden).status, 'incomplete');
  hidden.metrics.cached_bad_reader_visible = 1;
  assert.equal(assess(hidden).status, 'failed');
  assert(assess(hidden).reasons.includes('cached_bad_reader_visible'));
});

test('actual PG17 cached ancestry excludes restricted originals and forbids reader leakage', {
  skip: !process.env.IMAGE_ANCESTRY_DATABASE,
}, () => {
  const database = process.env.IMAGE_ANCESTRY_DATABASE;
  assert.equal(database, 'dm_refinement_image_ancestry', 'disposable fixture only');
  const sample = { vehicle: '11111111-1111-1111-1111-111111111111',
    since: '2026-10-04T00:00:00Z', field: 'image_visible_rust_severity' };
  const sql = mutation => execFileSync(process.env.IMAGE_ANCESTRY_PSQL ?? 'psql',
    ['-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1', '-d', database,
      '-c', `BEGIN; ${mutation} ${query(sample)} ROLLBACK;`], { encoding: 'utf8' });
  const check = mutation => assess(JSON.parse(sql(mutation)));
  const baseline = check('');
  assert.equal(baseline.status, 'passed_in_scope');
  assert.equal(baseline.metrics.sampled, 6, 'Only late cached children arrive in this ingest window');
  assert.equal(baseline.metrics.cached_projections, 6);
  assert.equal(baseline.metrics.cached_source_ineligible, 3);
  assert.equal(baseline.metrics.cached_bad_reader_visible, 0);
  assert.equal(baseline.metrics.eligible, 3, 'Other valid scalar properties retain arrival eligibility');
  assert.equal(baseline.metrics.reader_eligible, 1, 'Selected-field reader coverage is separate');
  for (const mutation of [
    "UPDATE public.vehicles SET deleted_at=now() WHERE id='11111111-1111-1111-1111-111111111111';",
    "UPDATE public.vehicles SET listing_kind='non_vehicle_item' WHERE id='11111111-1111-1111-1111-111111111111';",
    "UPDATE public.vehicle_observations SET is_superseded=true WHERE id='55555555-5555-5555-5555-000000000001';",
    "UPDATE public.vehicle_observations SET vehicle_id='22222222-2222-2222-2222-222222222222' WHERE id='55555555-5555-5555-5555-000000000001';",
    "UPDATE public.vehicle_observations SET structured_data=structured_data||'{\"receipt_id\":\"new-restriction\"}' WHERE id='55555555-5555-5555-5555-000000000001';",
    "UPDATE public.vehicle_observations SET structured_data=jsonb_set(structured_data,'{source_recorded_at}','\"invalid\"') WHERE extraction_method='cached_byok_property_projection_v1';",
  ]) {
    const result = check(mutation);
    assert.equal(result.status, 'incomplete');
    assert.equal(result.metrics.cached_source_ineligible, 6);
    assert.equal(result.metrics.cached_bad_reader_visible, 0);
    assert.equal(result.metrics.eligible, 0);
  }
  // Reproduce the old leaked output, using the same stored child/witness rows.
  const leaked = check(`CREATE OR REPLACE FUNCTION public.get_field_provenance(p_vehicle_id uuid,p_field text)
    RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
    SELECT jsonb_build_object('image_observations',jsonb_agg(jsonb_build_object(
      'observation_id',o.id,'image_id',w.image_id,'witness_id',w.id)))
    FROM public.vehicle_observations o JOIN public.observation_witnesses w ON w.observation_id=o.id
    WHERE o.vehicle_id=$1 AND o.structured_data ? $2 $$;`);
  assert.equal(leaked.status, 'failed');
  assert.equal(leaked.metrics.cached_bad_reader_visible, 1);
  assert(leaked.reasons.includes('cached_bad_reader_visible'));
  const wrongWitness = `UPDATE public.observation_witnesses w
    SET image_id='44444444-4444-4444-4444-000000000002'
    FROM public.vehicle_observations o WHERE o.id=w.observation_id
      AND o.extraction_method='cached_byok_property_projection_v1'
      AND o.structured_data->>'source_observation_id'='55555555-5555-5555-5555-000000000001';`;
  const withheld = check(wrongWitness);
  assert.equal(withheld.status, 'failed', 'Broken typed receipt still needs repair even when reader withholds it');
  assert.equal(withheld.metrics.cached_bad_reader_visible, 0);
  assert.equal(withheld.metrics.missing_witnesses, 3);
  const wrongCitation = check(`${wrongWitness}
    CREATE OR REPLACE FUNCTION public.get_field_provenance(p_vehicle_id uuid,p_field text)
    RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
    SELECT jsonb_build_object('image_observations',jsonb_agg(jsonb_build_object(
      'observation_id',o.id,'image_id',w.image_id,'witness_id',w.id)))
    FROM public.vehicle_observations o JOIN public.observation_witnesses w ON w.observation_id=o.id
    WHERE o.vehicle_id=$1 AND o.structured_data ? $2
      AND o.structured_data->>'source_observation_id'='55555555-5555-5555-5555-000000000001' $$;`);
  assert.equal(wrongCitation.status, 'failed');
  assert.equal(wrongCitation.metrics.cached_source_ineligible, 3);
  assert.equal(wrongCitation.metrics.cached_bad_reader_visible, 1, 'Eligible ancestor cannot justify a different cited image');
  const capped = check(`SET LOCAL app.writer='fixture-sample-bound';
    INSERT INTO public.vehicle_observations(vehicle_id,kind,structured_data,ingested_at)
    SELECT '${sample.vehicle}'::uuid,'specification','{}'::jsonb,'2026-10-04T06:01Z'
    FROM generate_series(1,1000);`);
  assert.equal(capped.metrics.sampled, SAMPLE_LIMIT + 1);
  assert.equal(capped.status, 'incomplete');
  assert(capped.reasons.includes('sample_truncated'));
});
