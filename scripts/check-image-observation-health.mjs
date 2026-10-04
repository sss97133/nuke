// C12/C17 bounded, read-only assay; no processing, inference or testimony writes.
// --since must be at/after the receipt deployment; older arrivals have no receipts.
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const SAMPLE_LIMIT = 1000;
const TABLES = ['vehicle_observations', 'observation_witnesses', 'vehicle_images'];
const FIELD = /^[a-z][a-z0-9_]{0,63}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  SELECT id, vehicle_id, source_id, kind, structured_data, is_superseded, ingested_at
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
), links AS MATERIALIZED (
  SELECT r.*, i.id AS existing_image, i.vehicle_id AS image_vehicle, i.created_at AS image_created_at,
    w.id AS witness_id, w.added_at AS witness_added_at,
    r.image_claim AND NOT r.excluded_share AND i.id IS NOT NULL
      AND i.vehicle_id = r.vehicle_id AS eligible,
    r.structured_data ? '${field}' AND r.is_superseded IS NOT TRUE
      AND public.observation_is_public(r.kind, r.structured_data)
      AND i.is_sensitive IS NOT TRUE AND i.is_superseded IS NOT TRUE AND i.is_duplicate IS NOT TRUE
      AND (i.vision_gate_status IS NULL OR i.vision_gate_status::text = 'approved')
      AND coalesce(i.image_vehicle_match_status, '') NOT IN ('mismatch', 'unrelated')
      AND nullif(btrim(i.image_url), '') IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = r.vehicle_id AND v.is_public = true) AS reader_visible
  FROM refs r LEFT JOIN public.vehicle_images i ON i.id = r.image_key
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
    'mismatched_vehicles', 'eligible', 'missing_witnesses', 'fresh_witnesses', 'fresh_images', 'reader_eligible', 'reader_missing'];
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
      || m.missing_witnesses > m.eligible) throw new Error('inconsistent assay; coverage unknown');
  const failures = ['invalid_image_refs', 'missing_images', 'mismatched_vehicles', 'missing_witnesses', 'reader_missing'].filter(k => m[k] > 0);
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
    scope_note: 'Bounded vehicle/ingest-window sample. Receipt presence is table-level, not per-observation proof. No corpus, cadence, image-processing UPDATE, independent-source or calibrated-correctness claim.' };
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = run(options(process.argv.slice(2)));
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.status === 'passed_in_scope' ? 0 : result.status === 'incomplete' ? 2 : 1;
  } catch {
    console.error('usage: node scripts/check-image-observation-health.mjs --vehicle <uuid> --since <ISO timestamp> [--field interior_color]');
    process.exitCode = 2;
  }
}
