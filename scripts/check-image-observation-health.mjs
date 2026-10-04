// C12/C17 bounded, read-only assay; no processing, inference or testimony writes.
// --since must be at/after the receipt deployment; older arrivals have no receipts.
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CACHE_ASSAY_BUDGET, runCachedImageProjection, cachedWorkerExitCode } from './lib/cached-image-worker.mjs';

export const SAMPLE_LIMIT = 1000;
const TABLES = ['vehicle_observations', 'observation_witnesses', 'vehicle_images'];
const FIELD = /^[a-z][a-z0-9_]{0,63}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function cachedAssayOptions(args) {
  if (args[0] !== '--cached-coverage') throw new Error('invalid assay arguments');
  const scope = {};
  for (let i = 1; i < args.length; i += 2) {
    const key = args[i]?.replace(/^--/, '');
    if (!['vehicle', 'sources'].includes(key) || !args[i].startsWith('--') ||
        !args[i + 1] || scope[key] !== undefined) throw new Error('invalid assay arguments');
    scope[key] = args[i + 1];
  }
  const sourceLimit = scope.sources === undefined ? CACHE_ASSAY_BUDGET.default_sources :
    /^\d+$/.test(scope.sources) ? Number(scope.sources) : NaN;
  if (!UUID.test(scope.vehicle ?? '') || !Number.isInteger(sourceLimit) ||
      sourceLimit < 1 || sourceLimit > CACHE_ASSAY_BUDGET.maximum_sources) throw new Error('invalid assay scope');
  return { verifyOnly: true, apply: false, vehicleId: scope.vehicle, sourceLimit };
}

export async function runCachedCoverage(args) {
  try {
    const scope = cachedAssayOptions(args);
    const { default: dotenv } = await import('dotenv');
    dotenv.config({ path: fileURLToPath(new URL('../.env.local', import.meta.url)), quiet: true });
    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('missing configuration');
    const { createClient } = await import('@supabase/supabase-js');
    const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    // The assay receives no Edge Function invocation capability. Its only RPCs are readers.
    const readers = new Set(['get_cached_image_projection_parents', 'get_field_provenance']);
    const readonly = { from: table => sb.from(table), rpc(name, input) {
      if (!readers.has(name)) throw new Error('unknown reader');
      return sb.rpc(name, input);
    } };
    const { checkpoint, ...result } = await runCachedImageProjection(readonly, scope);
    return { ...result, measured_cutoff: checkpoint?.cutoff ?? null,
      scope_note: 'One public vehicle; newest approved public-source image candidates. Reuses immutable testimony and canonical projection rules. Empty or capped samples are incomplete. No intake, checkpoint writes, inference, corpus or fresh-throughput claim.' };
  } catch {
    return { mode: 'cached_assay', status: 'failed', reason: 'cached_assay_initialization_failed', coverage: 'unknown' };
  }
}

export function options(args) {
  const result = { field: 'interior_color' };
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.replace(/^--/, '');
    if (!['vehicle', 'since', 'field'].includes(key) || !args[i].startsWith('--') || !args[i + 1]
        || (key !== 'field' && result[key] !== undefined)) throw new Error('invalid arguments');
    result[key] = args[i + 1];
  }
  if (!UUID.test(result.vehicle ?? '') || !Number.isFinite(Date.parse(result.since)) || !FIELD.test(result.field)) {
    throw new Error('invalid scope');
  }
  result.since = new Date(result.since).toISOString();
  return result;
}

export function query(scope) {
  const { vehicle, since, field } = options(['--vehicle', scope.vehicle, '--since', scope.since, '--field', scope.field ?? 'interior_color']);
  return `WITH arrivals AS MATERIALIZED (
  SELECT id, vehicle_id, source_id, kind, structured_data, is_superseded, ingested_at,
    observed_at, extraction_method, agent_model, raw_source_ref, source_identifier, confidence_score
  FROM public.vehicle_observations
  WHERE vehicle_id = '${vehicle}'::uuid AND ingested_at >= '${since}'::timestamptz
  ORDER BY ingested_at DESC, id DESC LIMIT ${SAMPLE_LIMIT + 1}
), refs AS MATERIALIZED (
  SELECT a.*,
    coalesce(a.structured_data->>'image_id' IS NOT NULL
      AND lower(btrim(a.structured_data->>'image_id')) <> 'unknown', false) AS image_claim,
    coalesce(a.kind::text = 'comment' AND a.structured_data->>'kind_detail' = 'professional_review'
      AND s.slug = 'shop', false) AS excluded_share,
    CASE WHEN a.structured_data->>'image_id' ~* '${UUID.source}'
      THEN (a.structured_data->>'image_id')::uuid END AS image_key
  FROM arrivals a LEFT JOIN public.observation_sources s ON s.id = a.source_id
), ancestry AS MATERIALIZED (
  SELECT r.*, coalesce(r.extraction_method='cached_byok_property_projection_v1'
    OR r.structured_data->>'analysis_kind'='image_property_projection'
    OR r.structured_data->>'projection_version'='byok_image_properties_v1',false) AS cached_projection,
    coalesce(EXISTS(SELECT 1 FROM public.vehicles v WHERE v.id=r.vehicle_id AND v.is_public IS TRUE
          AND v.deleted_at IS NULL AND coalesce(v.listing_kind,'')<>'non_vehicle_item')
        AND a.id IS NOT NULL AND a.vehicle_id=r.vehicle_id AND a.kind::text='condition'
        AND a.is_superseded IS NOT TRUE AND public.observation_is_public(a.kind,a.structured_data)
        AND a.structured_data->>'analysis_kind'='image_deep_byok'
        AND a.structured_data->>'image_id'=r.structured_data->>'image_id'
        AND a.structured_data->>'scene_type' IS DISTINCT FROM 'receipt_document'
        AND a.structured_data->'needs_review' IS DISTINCT FROM 'true'::jsonb
        AND a.structured_data->'needs_clarification' IS DISTINCT FROM 'true'::jsonb
        AND (NOT a.structured_data ? 'attribution_doubt' OR a.structured_data->'attribution_doubt' IN ('null'::jsonb,'false'::jsonb,'0'::jsonb,'""'::jsonb))
        AND a.confidence::text IS DISTINCT FROM 'low' AND a.confidence_score BETWEEN 0.6 AND 1
        AND nullif(btrim(a.agent_model),'') IS NOT NULL AND nullif(btrim(a.extraction_method),'') IS NOT NULL
        AND isfinite(a.ingested_at) AND r.kind::text='condition'
        AND r.extraction_method='cached_byok_property_projection_v1'
        AND r.structured_data->>'analysis_kind'='image_property_projection'
        AND r.structured_data->>'projection_version'='byok_image_properties_v1'
        AND (r.structured_data->>'property_key') IN ('image_visible_rust_severity','image_visible_paint_stage','image_visible_assembly_state')
        AND r.structured_data->(r.structured_data->>'property_key')=a.structured_data->'state_observations'->
          CASE (r.structured_data->>'property_key') WHEN 'image_visible_rust_severity' THEN 'rust_severity'
            WHEN 'image_visible_paint_stage' THEN 'paint_state' ELSE 'completeness' END
        AND r.confidence_score BETWEEN 0 AND 0.6
        AND r.structured_data->>'claim_role'='inferred'
        AND r.structured_data->>'source_family'='image:'||(r.structured_data->>'image_id')
        AND r.structured_data->'source_model_confidence'=to_jsonb(a.confidence_score)
        AND r.agent_model=a.agent_model
        AND r.structured_data->>'source_extraction_method'=a.extraction_method
        AND r.raw_source_ref='vehicle_observations:'||a.id::text
        AND r.structured_data->>'source_result_hash' ~ '^[0-9a-f]{64}$'
        AND r.source_identifier='byok_image_properties_v1:'||a.id::text||':'||
          (r.structured_data->>'source_result_hash')||':'||(r.structured_data->>'property_key')
        AND r.structured_data->>'observed_at_basis'='source_testimony_recorded_at'
        AND r.structured_data->'capture_at'='null'::jsonb AND r.structured_data->'analyzed_at'='null'::jsonb
        AND r.observed_at=a.ingested_at
        AND CASE WHEN pg_catalog.pg_input_is_valid(r.structured_data->>'source_recorded_at','timestamptz')
          AND (r.structured_data->>'source_observed_at' IS NULL OR
            pg_catalog.pg_input_is_valid(r.structured_data->>'source_observed_at','timestamptz'))
          THEN (r.structured_data->>'source_recorded_at')::timestamptz=a.ingested_at
            AND (r.structured_data->>'source_observed_at')::timestamptz IS NOT DISTINCT FROM a.observed_at
          ELSE false END, false) AS source_eligible
  FROM refs r LEFT JOIN public.vehicle_observations a ON a.id=CASE
    WHEN r.structured_data->>'source_observation_id' ~* '${UUID.source}'
    THEN (r.structured_data->>'source_observation_id')::uuid END
), links AS MATERIALIZED (
  SELECT r.*, i.id AS existing_image, i.vehicle_id AS image_vehicle, i.created_at AS image_created_at,
    w.id AS witness_id, w.added_at AS witness_added_at,
    r.image_claim AND NOT r.excluded_share AND i.id IS NOT NULL
      AND i.vehicle_id = r.vehicle_id AND (NOT r.cached_projection OR r.source_eligible) AS eligible,
    r.structured_data ? '${field}' AND r.is_superseded IS NOT TRUE
      AND public.observation_is_public(r.kind, r.structured_data)
      AND (NOT r.cached_projection OR r.source_eligible)
      AND i.is_sensitive IS NOT TRUE AND i.is_superseded IS NOT TRUE AND i.is_duplicate IS NOT TRUE
      AND (i.vision_gate_status IS NULL OR i.vision_gate_status::text = 'approved')
      AND coalesce(i.image_vehicle_match_status, '') NOT IN ('mismatch', 'unrelated')
      AND nullif(btrim(i.image_url), '') IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = r.vehicle_id AND v.is_public = true) AS reader_visible
  FROM ancestry r LEFT JOIN public.vehicle_images i ON i.id = r.image_key
  LEFT JOIN public.observation_witnesses w
    ON w.observation_id = r.id AND w.image_id = r.image_key AND w.witness_role = 'derived'
), reader AS MATERIALIZED (
  SELECT CASE WHEN EXISTS (SELECT 1 FROM public.vehicles WHERE id = '${vehicle}'::uuid AND is_public = true)
    THEN public.get_field_provenance('${vehicle}'::uuid, '${field}') END AS result
), metrics AS (
  SELECT count(*) AS sampled,
    count(*) FILTER (WHERE image_claim) AS image_claims,
    count(*) FILTER (WHERE image_claim AND excluded_share) AS excluded_share,
    count(*) FILTER (WHERE image_claim AND NOT excluded_share AND image_key IS NULL) AS invalid_image_refs,
    count(*) FILTER (WHERE image_key IS NOT NULL AND NOT excluded_share AND existing_image IS NULL) AS missing_images,
    count(*) FILTER (WHERE existing_image IS NOT NULL AND NOT excluded_share AND image_vehicle IS DISTINCT FROM vehicle_id) AS mismatched_vehicles,
    count(*) FILTER (WHERE cached_projection) AS cached_projections,
    count(*) FILTER (WHERE cached_projection AND NOT source_eligible) AS cached_source_ineligible,
    count(*) FILTER (WHERE cached_projection AND EXISTS (
      SELECT 1 FROM reader, jsonb_array_elements(CASE WHEN jsonb_typeof(result->'image_observations') = 'array'
        THEN result->'image_observations' ELSE '[]'::jsonb END) c
      WHERE c->>'observation_id'=links.id::text
        AND (NOT source_eligible OR c->>'image_id' IS DISTINCT FROM links.image_key::text))) AS cached_bad_reader_visible,
    count(*) FILTER (WHERE eligible) AS eligible,
    count(*) FILTER (WHERE eligible AND witness_id IS NULL) AS missing_witnesses,
    count(*) FILTER (WHERE eligible AND witness_added_at >= '${since}'::timestamptz) AS fresh_witnesses,
    count(DISTINCT existing_image) FILTER (WHERE eligible AND image_created_at >= '${since}'::timestamptz) AS fresh_images,
    count(*) FILTER (WHERE eligible AND reader_visible) AS reader_eligible,
    count(*) FILTER (WHERE eligible AND reader_visible AND NOT EXISTS (
      SELECT 1 FROM reader, jsonb_array_elements(CASE WHEN jsonb_typeof(result->'image_observations') = 'array'
        THEN result->'image_observations' ELSE '[]'::jsonb END) c
      WHERE c->>'observation_id' = links.id::text AND c->>'image_id' = links.image_key::text
        AND c->>'witness_id' = links.witness_id::text)) AS reader_missing
  FROM links
), sensors AS (
  SELECT tbl,
    EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = ('public.' || tbl)::regclass
      AND NOT t.tgisinternal AND t.tgenabled IN ('O', 'A') AND (t.tgtype & 4) = 4 AND (t.tgtype & 1) = 0
      AND t.tgnewtable = 'new_rows' AND t.tgfoid = 'public.record_write_receipt()'::regprocedure) AS enabled,
    (SELECT at FROM public.write_receipts WHERE write_receipts.tbl = names.tbl AND op = 'INSERT'
      AND at >= '${since}'::timestamptz ORDER BY at DESC LIMIT 1) AS last_receipt_at,
    coalesce((SELECT writer NOT IN ('', 'undeclared') FROM public.write_receipts
      WHERE write_receipts.tbl = names.tbl AND op = 'INSERT' AND at >= '${since}'::timestamptz
      ORDER BY at DESC LIMIT 1), false) AS writer_declared
  FROM (VALUES ('vehicle_observations'), ('observation_witnesses'), ('vehicle_images')) names(tbl)
)
SELECT jsonb_build_object('assay', 'image_observation_health_v1', 'measured_at', now(),
  'vehicle_id', '${vehicle}', 'since', '${since}', 'field', '${field}', 'sample_limit', ${SAMPLE_LIMIT},
  'metrics', (SELECT to_jsonb(m) FROM metrics m),
  'sensors', (SELECT jsonb_agg(to_jsonb(s)) FROM sensors s)) AS assay;`;
}

export function assess(assay) {
  const counts = ['sampled', 'image_claims', 'excluded_share', 'invalid_image_refs', 'missing_images',
    'mismatched_vehicles', 'cached_projections', 'cached_source_ineligible', 'cached_bad_reader_visible', 'eligible', 'missing_witnesses', 'fresh_witnesses', 'fresh_images', 'reader_eligible', 'reader_missing'];
  if (assay?.assay !== 'image_observation_health_v1' || assay.sample_limit !== SAMPLE_LIMIT
      || !counts.every(k => Number.isSafeInteger(assay.metrics?.[k]) && assay.metrics[k] >= 0)
      || !Array.isArray(assay.sensors) || assay.sensors.length !== TABLES.length
      || !TABLES.every(tbl => assay.sensors.filter(s => s.tbl === tbl && typeof s.enabled === 'boolean'
        && typeof s.writer_declared === 'boolean' && (s.last_receipt_at === null
          || typeof s.last_receipt_at === 'string' && Number.isFinite(Date.parse(s.last_receipt_at)))).length === 1)) {
    throw new Error('invalid assay; coverage unknown');
  }
  const m = assay.metrics;
  if (m.sampled > SAMPLE_LIMIT + 1 || counts.slice(1).some(k => m[k] > m.sampled)
      || m.reader_eligible > m.eligible || m.reader_missing > m.reader_eligible
      || m.missing_witnesses > m.eligible || m.cached_source_ineligible > m.cached_projections
      || m.cached_bad_reader_visible > m.cached_projections) throw new Error('inconsistent assay; coverage unknown');
  const failures = ['invalid_image_refs', 'missing_images', 'mismatched_vehicles', 'missing_witnesses', 'reader_missing', 'cached_bad_reader_visible'].filter(k => m[k] > 0);
  const incomplete = [];
  for (const s of assay.sensors) {
    if (!s.enabled) failures.push(`${s.tbl}:sensor_missing`);
    const arrivals = s.tbl === 'vehicle_observations' ? m.sampled : s.tbl === 'observation_witnesses' ? m.fresh_witnesses : m.fresh_images;
    if (arrivals > 0 && s.last_receipt_at === null) failures.push(`${s.tbl}:receipt_missing`);
    if (arrivals > 0 && s.last_receipt_at !== null && !s.writer_declared) incomplete.push(`${s.tbl}:writer_undeclared`);
  }
  if (m.sampled > SAMPLE_LIMIT) incomplete.push('sample_truncated');
  if (m.eligible === 0) incomplete.push('no_eligible_arrivals');
  if (m.reader_eligible === 0) incomplete.push('reader_not_measured');
  const status = failures.length ? 'failed' : incomplete.length ? 'incomplete' : 'passed_in_scope';
  return { ...assay, status, reasons: [...failures, ...incomplete],
    scope_note: 'Bounded vehicle/ingest-window sample. Receipt presence is table-level, not per-observation proof. Cached claims require current full-source ancestry; hidden ineligible sources are excluded, visible ineligible-source children fail. Capture/analysis clocks remain unverified. No corpus, cadence, image-processing UPDATE, independent-source or calibrated-correctness claim.' };
}

export function run(scope, execute = sql => execFileSync('/bin/bash', [fileURLToPath(new URL('./data/q.sh', import.meta.url)),
  `BEGIN READ ONLY; SET LOCAL statement_timeout = '15s'; ${sql} COMMIT;`],
  { encoding: 'utf8', timeout: 25000, stdio: ['ignore', 'pipe', 'pipe'] })) {
  try {
    const rows = JSON.parse(execute(query(scope)));
    return assess(Array.isArray(rows) ? rows[0]?.assay : null);
  } catch {
    return { assay: 'image_observation_health_v1', status: 'failed', reasons: ['query_or_assay_failed'], coverage: 'unknown' };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    const result = args[0] === '--cached-coverage' ? await runCachedCoverage(args) : run(options(args));
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.mode === 'cached_assay' ? cachedWorkerExitCode(result) :
      result.status === 'passed_in_scope' ? 0 : result.status === 'incomplete' ? 2 : 1;
  } catch {
    console.error('usage: node scripts/check-image-observation-health.mjs --vehicle <uuid> --since <ISO timestamp> [--field interior_color]; or --cached-coverage --vehicle <uuid> [--sources 1..100]');
    process.exitCode = 2;
  }
}
