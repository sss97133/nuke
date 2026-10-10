// Read-only operator sections for the existing db-stats / SystemStatus owners.
// Each statement has its own clock and timeout. No source bodies or job commands.
import { intakeThrottle } from '../poll-listing-feeds/ledger.ts';
// Include normalized retained-target controls in this deployed reader bundle;
// cursor state, lease tokens and provider responses remain outside its contract.
export const INTAKE_TABLES = ['source_targets', 'import_queue', 'listing_page_snapshots',
  'vehicle_events', 'auction_events', 'auction_comments', 'external_identities',
  'vehicle_observations', 'vehicles', 'vehicle_images', 'vehicle_field_consensus',
  'work_sessions', 'receipts', 'pipeline_registry'];
export const INTAKE_JOBS = ['poll-listing-feeds', 'source-monitor-poll', 'bat-live-pull', 'enrich-gooding-sitemap',
  'process-import-queue-batch-2', 'rmsothebys-discovery', 'mecum-snapshot-parser',
  'batch-extract-barrett-jackson', 'enrich-bonhams-10min', 'collecting-cars-discovery',
  'batch-vin-decode-backfill', 'drain-vehicle-derived-queues', 'derivation-queue-drain',
  'drain-vehicle-taxonomy'];
export const HEALTH_JOBS = ['poll-listing-feeds', 'bat-live-pull', 'batch-vin-decode-backfill',
  'drain-vehicle-derived-queues', 'derivation-queue-drain', 'rmsothebys-discovery'];
export type IntakeSection = 'coverage' | 'model' | 'jobs' | 'consumers';
export interface IntakeConnection {
  queryObject<T = Record<string, unknown>>(query: string, args?: unknown[]): Promise<{ rows: T[] }>;
}

export const COVERAGE_SQL = `SELECT statement_timestamp() AS measured_at,
  coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) AS rows
FROM (SELECT source_slug, total_targets, in_queue, extracted, pending, failed,
  skipped, duplicate, gap FROM public.source_target_coverage
  ORDER BY total_targets DESC, source_slug LIMIT 31) s`;

// The existing registry measures declared structure, not end-to-end delivery.
// Project only dependency names/verdicts and reasons, never raw evidence payloads.
export const CONSUMERS_SQL = `SELECT statement_timestamp() AS measured_at,
  coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.stack_id), '[]'::jsonb) AS rows
FROM (SELECT c.stack_id, c.version, s.name, s.question, s.status, c.coverage,
  c.n_needs, c.n_present, c.n_partial, c.n_missing,
  jsonb_array_length(c.needs) <= 64 AS needs_complete,
  coalesce((SELECT jsonb_agg(jsonb_build_object(
    'layer', n.value->>'layer', 'kind', n.value->>'kind',
    'object', n.value->>'object', 'verdict', n.value->>'verdict',
    'reason', n.value->'evidence'->>'reason',
    'related_table', CASE WHEN n.value->>'kind' = 'table' THEN n.value->>'object'
      WHEN n.value->>'kind' IN ('column','intake') THEN split_part(n.value->>'object','.',1)
      WHEN n.value->>'kind' = 'abstract' THEN n.value->'evidence'->>'declared_table' END)
    ORDER BY n.ordinality) FROM jsonb_array_elements(c.needs) WITH ORDINALITY n(value, ordinality)
    WHERE n.ordinality <= 64), '[]'::jsonb) AS needs
  FROM public.stack_coverage(NULL) c
  JOIN public.stacks s USING (stack_id, version)
  ORDER BY c.stack_id LIMIT 101) s`;

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

// Preserve executions and declarations when an output assay exceeds its budget.
// Omitting assay/health expressions avoids evaluating the view's expensive assays.
export const EXECUTION_SQL = `SELECT statement_timestamp() AS measured_at,
  coalesce(jsonb_agg(to_jsonb(j) ORDER BY j.jobname), '[]'::jsonb) AS rows
FROM (SELECT jobname, declared_writer, last_status, last_run_at,
  NULL::text AS assay_status, NULL::text AS health_status
  FROM public.v_job_health WHERE jobname = ANY($1::text[])) j`;

export const FEEDS_SQL = `SELECT statement_timestamp() AS measured_at,
  coalesce((SELECT jsonb_agg(to_jsonb(f)) FROM (
    SELECT source_slug, count(*)::int AS feeds,
      count(*) FILTER (WHERE enabled)::int AS enabled_feeds,
      count(*) FILTER (WHERE enabled AND last_error IS NOT NULL)::int AS errored_feeds,
      max(last_polled_at) FILTER (WHERE enabled) AS last_polled_at,
      min(poll_interval_minutes) FILTER (WHERE enabled) AS shortest_interval_minutes,
      bool_or(last_error ILIKE '%credits%' OR last_error ILIKE '%billing%') FILTER (WHERE enabled) AS billing_blocked,
      bool_or(last_error ILIKE '%rate limit%' OR last_error ILIKE '%429%') FILTER (WHERE enabled) AS rate_limited
    FROM public.listing_feeds GROUP BY source_slug ORDER BY source_slug LIMIT 61
  ) f), '[]'::jsonb) AS rows,
  (SELECT config_value FROM public.platform_config WHERE config_key = 'source_intake') AS controls`;

// Pooler-safe transaction-local limits; rollback on both success and failure.
export async function boundedRead(conn: IntakeConnection, sql: string, args: unknown[] = []) {
  await conn.queryObject('BEGIN READ ONLY');
  try {
    await conn.queryObject("SET LOCAL statement_timeout = '5s'");
    await conn.queryObject("SET LOCAL lock_timeout = '1s'");
    const result = await conn.queryObject<{ measured_at: string; rows: Record<string, unknown>[]; links?: Record<string, unknown>[]; controls?: unknown }>(sql, args);
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
    const output = await boundedRead(conn, HEALTH_SQL, [HEALTH_JOBS]);
    const health = output.status === 'measured' ? output
      : await boundedRead(conn, EXECUTION_SQL, [HEALTH_JOBS]);
    const feeds = await boundedRead(conn, FEEDS_SQL);
    let controls: { status: string; value?: ReturnType<typeof intakeThrottle> } = { status: 'unavailable' };
    if (feeds.status === 'measured') {
      try { controls = { status: 'measured', value: intakeThrottle(feeds.controls ?? {}) }; }
      catch { controls = { status: 'invalid' }; }
    }
    const { controls: _rawControls, ...feedReading } = feeds.status === 'measured' ? feeds : { ...feeds, controls: undefined };
    return { contract: 'intake_status_v1', section, config,
      health: { ...health, output_measured: output.status === 'measured' }, controls,
      feeds: { ...feedReading, rows: feeds.rows.slice(0, 60), complete: feeds.status === 'measured' && feeds.rows.length <= 60 },
      scope: INTAKE_JOBS, health_scope: HEALTH_JOBS };
  }
  const result = await boundedRead(conn, section === 'coverage' ? COVERAGE_SQL : section === 'consumers' ? CONSUMERS_SQL : MODEL_SQL,
    section === 'model' ? [INTAKE_TABLES] : []);
  const cap = section === 'coverage' ? 30 : section === 'consumers' ? 100 : 500;
  const links = 'links' in result ? result.links ?? [] : [];
  return { contract: 'intake_status_v1', section, ...result,
    rows: section === 'model' ? result.rows : result.rows.slice(0, cap),
    ...(section === 'model' ? { links: links.slice(0, cap), links_complete: result.status === 'measured' && links.length <= cap } : {}),
    complete: result.status === 'measured' && (section === 'model' || result.rows.length <= cap),
    scope: section === 'model' ? INTAKE_TABLES : section === 'consumers'
      ? { stack_limit: cap, needs_limit_per_stack: 64, basis: 'declared_stack_structure' }
      : { source_limit: cap, basis: 'known_target_url_queue_status' },
    ...(section === 'model' ? { receipt_limit_per_table: 32, receipt_window_days: 30 } : {}) };
}
