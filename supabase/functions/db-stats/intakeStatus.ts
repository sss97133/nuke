// Read-only operator sections for the existing db-stats / SystemStatus owners.
// Each statement has its own clock and timeout. No source bodies or job commands.
export const INTAKE_TABLES = ['source_targets', 'import_queue', 'listing_page_snapshots',
  'vehicle_events', 'auction_events', 'auction_comments', 'external_identities',
  'vehicle_observations', 'vehicles', 'vehicle_images', 'vehicle_field_consensus',
  'work_sessions', 'receipts', 'pipeline_registry'];
export const INTAKE_JOBS = ['bat-live-pull', 'enrich-gooding-sitemap',
  'process-import-queue-batch-2', 'rmsothebys-discovery', 'mecum-snapshot-parser',
  'batch-extract-barrett-jackson', 'enrich-bonhams-10min', 'collecting-cars-discovery',
  'batch-vin-decode-backfill', 'drain-vehicle-derived-queues', 'derivation-queue-drain',
  'drain-vehicle-taxonomy'];
export const HEALTH_JOBS = ['bat-live-pull', 'batch-vin-decode-backfill',
  'drain-vehicle-derived-queues', 'derivation-queue-drain', 'rmsothebys-discovery'];
export type IntakeSection = 'coverage' | 'model' | 'jobs';
export interface IntakeConnection {
  queryObject<T = Record<string, unknown>>(query: string, args?: unknown[]): Promise<{ rows: T[] }>;
}

export const COVERAGE_SQL = `SELECT statement_timestamp() AS measured_at,
  coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) AS rows
FROM (SELECT source_slug, total_targets, in_queue, extracted, pending, failed,
  skipped, duplicate, gap FROM public.source_target_coverage
  ORDER BY total_targets DESC, source_slug LIMIT 31) s`;

export const MODEL_SQL = `WITH scope AS (SELECT unnest($1::text[]) AS table_name),
tables AS (SELECT s.table_name, a.activity, a.est_rows, a.n_cols, a.n_cols_described,
  a.fk_in, a.fk_out, a.triggers, a.registry_owners,
  r.writers AS receipt_writers, r.undeclared_stmts AS receipt_undeclared_stmts,
  r.last_write, r.sample_count AS receipt_sample_count, r.sample_complete AS receipt_sample_complete,
  a.table_name IS NOT NULL AS atlas_present
  FROM scope s LEFT JOIN public.v_schema_atlas a USING (table_name)
  LEFT JOIN LATERAL (SELECT array_agg(DISTINCT p.writer) FILTER (WHERE p.ordinal <= 32) AS writers,
    count(*) FILTER (WHERE p.ordinal <= 32 AND p.writer = 'undeclared') AS undeclared_stmts,
    max(p.at) AS last_write, least(count(*),32) AS sample_count, count(*) <= 32 AS sample_complete
    FROM (SELECT writer, at, row_number() OVER (ORDER BY at DESC) AS ordinal FROM (
      SELECT writer, at FROM public.write_receipts
      WHERE tbl = s.table_name AND at > now() - interval '30 days'
      ORDER BY at DESC LIMIT 33) recent) p) r ON true),
links AS (SELECT c.conname AS constraint_name, child.relname AS child_table,
  parent.relname AS parent_table, c.convalidated AS validated
  FROM pg_catalog.pg_constraint c
  JOIN pg_catalog.pg_class child ON child.oid = c.conrelid
  JOIN pg_catalog.pg_class parent ON parent.oid = c.confrelid
  WHERE c.contype = 'f' AND child.relnamespace = 'public'::regnamespace
    AND parent.relnamespace = 'public'::regnamespace
    AND (child.relname = ANY($1::text[]) OR parent.relname = ANY($1::text[]))
  ORDER BY child.relname, parent.relname, c.conname LIMIT 501)
SELECT statement_timestamp() AS measured_at,
  (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.table_name) FROM tables t) AS rows,
  coalesce((SELECT jsonb_agg(to_jsonb(l)) FROM links l), '[]'::jsonb) AS links`;

export const CONFIG_SQL = `SELECT statement_timestamp() AS measured_at,
  jsonb_agg(to_jsonb(j) ORDER BY j.jobname) AS rows
FROM (SELECT s.jobname, c.jobid IS NOT NULL AS present, c.active, c.schedule
  FROM unnest($1::text[]) AS s(jobname)
  LEFT JOIN cron.job c USING (jobname)) j`;
export const HEALTH_SQL = `SELECT statement_timestamp() AS measured_at,
  coalesce(jsonb_agg(to_jsonb(j) ORDER BY j.jobname), '[]'::jsonb) AS rows
FROM (SELECT jobname, declared_writer, last_status, last_run_at, assay_status, health_status
  FROM public.v_job_health WHERE jobname = ANY($1::text[])) j`;

// Pooler-safe transaction-local limits; rollback on both success and failure.
export async function boundedRead(conn: IntakeConnection, sql: string, args: unknown[] = []) {
  await conn.queryObject('BEGIN READ ONLY');
  try {
    await conn.queryObject("SET LOCAL statement_timeout = '5s'");
    await conn.queryObject("SET LOCAL lock_timeout = '1s'");
    const result = await conn.queryObject<{ measured_at: string; rows: Record<string, unknown>[]; links?: Record<string, unknown>[] }>(sql, args);
    const row = result.rows[0];
    if (!row || !Array.isArray(row.rows)) throw new Error('invalid_reading');
    return { status: 'measured' as const, ...row };
  } catch {
    return { status: 'unavailable' as const, measured_at: null, rows: [] };
  } finally { await conn.queryObject('ROLLBACK'); }
}

export async function readIntakeSection(conn: IntakeConnection, section: IntakeSection) {
  if (section === 'jobs') {
    const config = await boundedRead(conn, CONFIG_SQL, [INTAKE_JOBS]);
    const health = await boundedRead(conn, HEALTH_SQL, [HEALTH_JOBS]);
    return { contract: 'intake_status_v1', section, config, health,
      scope: INTAKE_JOBS, health_scope: HEALTH_JOBS };
  }
  const result = await boundedRead(conn, section === 'coverage' ? COVERAGE_SQL : MODEL_SQL,
    section === 'model' ? [INTAKE_TABLES] : []);
  const cap = section === 'coverage' ? 30 : 500;
  const links = 'links' in result ? result.links ?? [] : [];
  return { contract: 'intake_status_v1', section, ...result,
    rows: section === 'coverage' ? result.rows.slice(0, cap) : result.rows,
    ...(section === 'model' ? { links: links.slice(0, cap), links_complete: result.status === 'measured' && links.length <= cap } : {}),
    complete: result.status === 'measured' && (section !== 'coverage' || result.rows.length <= cap),
    scope: section === 'model' ? INTAKE_TABLES : { source_limit: cap, basis: 'known_target_url_queue_status' },
    ...(section === 'model' ? { receipt_limit_per_table: 32, receipt_window_days: 30 } : {}) };
}
