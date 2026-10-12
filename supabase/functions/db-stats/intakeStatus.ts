// Read-only operator sections for the existing db-stats / SystemStatus owners.
// Each statement has its own clock and timeout. No source bodies or job commands.
import { intakeThrottle } from '../poll-listing-feeds/ledger.ts';
export const INTAKE_TABLES = ['source_targets', 'import_queue', 'listing_page_snapshots',
  'vehicle_events', 'auction_events', 'auction_comments', 'external_identities',
  'vehicle_observations', 'vehicles', 'vehicle_images', 'vehicle_field_consensus',
  'work_sessions', 'receipts', 'pipeline_registry'];
export const INTAKE_JOBS = ['poll-listing-feeds', 'source-monitor-poll', 'bat-live-pull', 'enrich-gooding-sitemap',
  'process-import-queue-batch-2', 'rmsothebys-discovery', 'mecum-snapshot-parser',
  'batch-extract-barrett-jackson', 'enrich-bonhams-10min', 'collecting-cars-discovery',
  'batch-vin-decode-backfill', 'drain-vehicle-derived-queues', 'derivation-queue-drain',
  'drain-vehicle-taxonomy', 'project-retained-listing-properties', 'qualify-retained-vin-references',
  'qualify-bat-archived-sales', 'drain-sale-residual-fold'];
// Read the inexpensive canonical output check first, then execution-only checks.
// Slow output assays may exhaust the section budget without erasing these results.
export const HEALTH_JOBS = ['drain-sale-residual-fold', 'poll-listing-feeds', 'batch-vin-decode-backfill',
  'derivation-queue-drain', 'rmsothebys-discovery', 'project-retained-listing-properties',
  'qualify-bat-archived-sales', 'bat-live-pull', 'drain-vehicle-derived-queues',
  'qualify-retained-vin-references'];
export type IntakeSection = 'coverage' | 'model' | 'jobs' | 'consumers';
export interface IntakeConnection {
  queryObject<T = Record<string, unknown>>(query: string, args?: unknown[]): Promise<{ rows: T[] }>;
}

// Prefer the recorded FK. A missing FK may resolve only by BOTH the source's
// exact observed name and canonical origin, and only to one public organization.
// Collections sharing an auction house's domain are not the source organization.
export const SOURCE_PROFILES_SQL = `source_profiles AS (
  SELECT s.slug AS source_slug, s.display_name, s.base_url,
    (SELECT CASE WHEN count(*) = 1 THEN min(o.id::text) END
      FROM public.organizations o WHERE o.is_public = true AND (
        (s.business_id IS NOT NULL AND o.id = s.business_id) OR
        (s.business_id IS NULL AND lower(trim(o.business_name)) = lower(trim(s.display_name))
          AND lower(regexp_replace(rtrim(o.website, '/'), '^https?://(www[.])?', ''))
            = lower(regexp_replace(rtrim(s.base_url, '/'), '^https?://(www[.])?', '')))
      )) AS organization_id
  FROM public.observation_sources s
)`;

export const COVERAGE_SQL = `WITH ${SOURCE_PROFILES_SQL}
SELECT statement_timestamp() AS measured_at,
  coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) AS rows
FROM (SELECT c.source_slug, total_targets, in_queue, extracted, pending, failed,
  skipped, duplicate, gap, p.organization_id, p.display_name, p.base_url
  FROM public.source_target_coverage c LEFT JOIN source_profiles p USING (source_slug)
  ORDER BY total_targets DESC, source_slug LIMIT 31) s`;

// Public provenance inventory only: no queue state, commands, contacts or bodies.
// One indexed count per matched source; sample reads stop after 25 URLs.
export const ORG_TARGETS_SQL = `WITH ${SOURCE_PROFILES_SQL}
SELECT statement_timestamp() AS measured_at,
  coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) AS rows
FROM (SELECT p.source_slug, p.display_name, p.base_url,
    (SELECT count(*) FROM public.source_targets t WHERE t.source_slug = p.source_slug) AS total_targets,
    coalesce((SELECT jsonb_agg(to_jsonb(t)) FROM (
      SELECT listing_url, first_discovered_at, last_seen_at FROM public.source_targets
      WHERE source_slug = p.source_slug LIMIT 25) t), '[]'::jsonb) AS targets
  FROM source_profiles p WHERE p.organization_id = $1 ORDER BY p.source_slug LIMIT 31) s`;

// A fixed-size cache read; never fold a company's event history on page load.
// Gate by the canonical public parent and admit only the qualified contract.
export const ORG_ACTIVITY_SQL = `SELECT statement_timestamp() AS measured_at,
  coalesce(jsonb_agg(jsonb_build_object(
    'contract', s.evidence_summary->>'contract', 'calculated_at', s.calculated_at,
    'total_listings', s.total_listings, 'total_sold', s.total_sold,
    'total_unsold', s.total_unsold, 'active_listings', s.active_listings,
    'sell_through_rate', s.sell_through_rate,
    'input_rows', s.evidence_summary->'input_rows',
    'unresolved_identity_rows', s.evidence_summary->'unresolved_identity_rows',
    'unknown_outcomes', s.evidence_summary->'unknown_outcomes',
    'unpriced_sold', s.evidence_summary->'unpriced_sold',
    'identity_conflicts', s.evidence_summary->'identity_conflicts',
    'outcome_conflicts', s.evidence_summary->'outcome_conflicts',
    'amount_conflicts', s.evidence_summary->'amount_conflicts',
    'unknown_currency_sold', s.evidence_summary->'unknown_currency_sold',
    'latest_input_created_at', s.evidence_summary->'latest_input_created_at',
    'latest_input_extracted_at', s.evidence_summary->'latest_input_extracted_at',
    'currencies', coalesce((SELECT jsonb_agg(jsonb_build_object(
      'currency', c->>'currency', 'listings', c->'listings', 'total', c->'total'))
      FROM jsonb_array_elements(s.evidence_summary->'currencies') WITH ORDINALITY a(c,n)
      WHERE n <= 30), '[]'::jsonb),
    'currencies_complete', jsonb_array_length(s.evidence_summary->'currencies') <= 30
  )), '[]'::jsonb) AS rows
FROM public.organizations o JOIN public.organization_seller_stats s ON s.organization_id = o.id
WHERE o.id = $1 AND o.is_public = true
  AND s.evidence_summary->>'contract' = 'listing_activity_v1'
  AND s.evidence_summary->>'scope' = 'retained_public_organization_attributed_listings'
  AND s.evidence_summary->>'population_complete' = 'true'`;

export async function readOrganizationTargets(conn: IntakeConnection, organizationId: string) {
  const result = await boundedRead(conn, ORG_TARGETS_SQL, [organizationId]);
  const listingActivity = await boundedRead(conn, ORG_ACTIVITY_SQL, [organizationId], '3s');
  return { contract: 'organization_targets_v1', organization_id: organizationId, ...result,
    rows: result.rows.slice(0, 30), complete: result.status === 'measured' && result.rows.length <= 30,
    sample_limit: 25, listing_activity: listingActivity };
}
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
FROM (SELECT jobname, declared_writer, last_status, last_run_at, assay_status, health_status,
  (SELECT coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
    FROM jsonb_each(coalesce(assay, '{}'::jsonb) ||
      CASE WHEN jsonb_typeof(assay->'counts') = 'object' THEN assay->'counts' ELSE '{}'::jsonb END)
    WHERE key IN ('pending','claimed','failed','stale_qualified','sample_stale','due',
      'custody_sampled','completed_work','canonical_observations','vehicles_mismatching',
      'overdue_queue_sampled','failed_queue_sampled') AND jsonb_typeof(value) = 'number') AS assay_counts
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

// Two existing receipt stores, not newest-row or cron-success proxies. Bounded
// 24-hour run scope; no raw cards, target URLs, contacts or provider error text.
// Counts describe acknowledged row operations, not new vehicles/fleet coverage.
export const ACTIVITY_SQL = `WITH feed_runs AS MATERIALIZED (
  SELECT id, source, started_at, completed_at, status, metadata FROM public.extraction_runs
  WHERE source = 'poll-listing-feeds' AND metadata->>'contract' = 'source_intake_run_v1'
    AND started_at >= statement_timestamp() - interval '24 hours'
  ORDER BY started_at DESC, id LIMIT 51
), fb_runs AS MATERIALIZED (
  SELECT id, started_at, completed_at, status, metadata FROM public.fb_sweep_jobs
  WHERE metadata->>'writer' = 'extract-facebook-marketplace' AND metadata->>'capture_version' = '1'
    AND started_at >= statement_timestamp() - interval '24 hours'
  ORDER BY started_at DESC, id LIMIT 51
), runs AS (
  SELECT id AS run_id, 'poll-listing-feeds'::text AS worker, started_at, completed_at, status,
    NULL::text AS observed_at, NULL::text AS retrieval_surface, NULL::text AS actual_region,
    metadata->'target_scope_complete' AS scope_complete,
    CASE WHEN metadata->>'reason' IN('controls_zero','no_due_targets','worker_failed','worker_deadline') THEN metadata->>'reason' END AS reason,
    'selected_feed_targets; dispatch_intent_is_not_fetch_success'::text AS basis,
    coalesce((SELECT jsonb_agg(jsonb_build_object('source', s->'source',
      'selected_targets', s->'selected_targets', 'attempted_targets', s->'attempted_targets',
      'unattempted_targets',s->'unattempted_targets','unfinished_started_targets',s->'unfinished_started_targets',
      'completed_targets', s->'completed_targets', 'deferred_targets', s->'deferred_targets', 'failed_targets', s->'failed_targets',
      'counts', jsonb_build_object('discovered_items', s->'counts'->'discovered_items',
        'queue_rows_acknowledged', s->'counts'->'queue_rows_acknowledged',
        'ingestion_requests', s->'counts'->'ingestion_requests',
        'landed_ledger_acknowledged', s->'counts'->'landed_ledger_acknowledged',
        'ledger_write_failures', s->'counts'->'ledger_write_failures',
        'known_or_matched', s->'counts'->'known_or_matched', 'backing_off', s->'counts'->'backing_off'),
      'reasons', coalesce((SELECT jsonb_agg(reason) FROM jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(s->'reasons')='array' THEN s->'reasons' ELSE '[]'::jsonb END) reason
        WHERE reason IN('paused','invocation_limit','source_limit','worker_deadline','billing','rate_limited','blocked','timeout','worker_failed')),'[]'),
      'consumer_usable', NULL)) FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(metadata->'source_totals')='array' THEN metadata->'source_totals' ELSE '[]'::jsonb END)
        WITH ORDINALITY a(s,n) WHERE n<=100), '[]') AS sources
  FROM (SELECT * FROM feed_runs ORDER BY started_at DESC,id LIMIT 50) f
  UNION ALL
  SELECT id, 'extract-facebook-marketplace', started_at, completed_at, status,
    metadata->'capture'->>'observed_at', left(metadata->'capture'->>'retrieval_surface',64),
    left(metadata->'capture'->>'actual_region',100), metadata->'capture'->'complete',
    NULL::text,
    'declared_browser_capture; first_seen_is_not_listed_time',
    jsonb_build_array(jsonb_build_object('source','facebook_marketplace',
      'counts', CASE WHEN jsonb_typeof(metadata->'results')='array' THEN (
        SELECT jsonb_build_object(
          'captured_cards', CASE WHEN jsonb_typeof(metadata->'batch')='array' THEN jsonb_array_length(metadata->'batch') END,
          'result_rows',count(*),
          'listing_rows_acknowledged',count(*) FILTER(WHERE item->'listing_landed'='true'::jsonb),
          'listing_rows_verified',count(*) FILTER(WHERE listing.id IS NOT NULL AND item->'listing_landed'='true'::jsonb),
          'sightings_acknowledged',count(*) FILTER(WHERE item->'sighting_landed'='true'::jsonb),
          'sightings_verified',count(*) FILTER(WHERE sighting.id IS NOT NULL AND sighting.listing_id=listing.id AND sighting.sweep_job_id=f.id),
          'linked_observation_receipts',count(*) FILTER(WHERE item->'observation_landing'->>'status' IN('written','duplicate')),
          'linked_observations_verified',count(*) FILTER(WHERE observation.id IS NOT NULL AND observation.vehicle_id=listing.vehicle_id
            AND observation_source.slug='facebook_marketplace' AND observation.kind::text='listing'
            AND observation.extraction_method='fb_direct_input'
            AND observation.source_identifier=listing.facebook_id||':'||f.id::text
            AND observation.source_url=listing.url),
          'unlinked_results',count(*) FILTER(WHERE item->'observation_landing'->>'status'='unlinked'),
          'observation_errors',count(*) FILTER(WHERE item->'observation_landing'->>'status'='error'))
        FROM jsonb_array_elements(metadata->'results') item
        LEFT JOIN public.marketplace_listings listing ON listing.id=CASE WHEN pg_catalog.pg_input_is_valid(item->>'listing_id','uuid') THEN (item->>'listing_id')::uuid END
        LEFT JOIN public.fb_listing_sightings sighting ON sighting.id=CASE WHEN pg_catalog.pg_input_is_valid(item->>'sighting_id','uuid') THEN (item->>'sighting_id')::uuid END
        LEFT JOIN public.vehicle_observations observation ON observation.id=CASE WHEN pg_catalog.pg_input_is_valid(item->'observation_landing'->>'observation_id','uuid') THEN (item->'observation_landing'->>'observation_id')::uuid END
        LEFT JOIN public.observation_sources observation_source ON observation_source.id=observation.source_id
      ) ELSE NULL END, 'consumer_usable',NULL, 'reasons','[]'::jsonb))
  FROM (SELECT * FROM fb_runs ORDER BY started_at DESC,id LIMIT 50) f
)
SELECT statement_timestamp() AS measured_at, coalesce(jsonb_agg(to_jsonb(r) ORDER BY started_at DESC,run_id),'[]') AS rows,
  (SELECT count(*)<=50 FROM feed_runs) AND (SELECT count(*)<=50 FROM fb_runs) AS complete
FROM runs r`;

// Pooler-safe transaction-local limits; rollback on both success and failure.
export async function boundedRead(conn: IntakeConnection, sql: string, args: unknown[] = [], timeout: '5s' | '3s' = '5s') {
  await conn.queryObject('BEGIN READ ONLY');
  try {
    await conn.queryObject(timeout === '3s'
      ? "SET LOCAL statement_timeout = '3s'" : "SET LOCAL statement_timeout = '5s'");
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
    const deadline = Date.now() + 20_000;
    const config = await boundedRead(conn, CONFIG_SQL, [INTAKE_JOBS]);
    const executions = await boundedRead(conn, EXECUTION_SQL, [HEALTH_JOBS]);
    const feeds = await boundedRead(conn, FEEDS_SQL);
    const activity = await boundedRead(conn, ACTIVITY_SQL, [], '3s');
    // Read canonical checks independently. A slow assay loses its own result,
    // while the execution reading and other checks survive. Leave headroom for
    // transport inside the frontend's 25-second request limit.
    const rows = new Map(executions.rows.map(row => [row.jobname, row]));
    const readings: { jobname: string; status: 'measured' | 'unavailable'; measured_at: string | null; reason: string | null }[] = [];
    for (const jobname of HEALTH_JOBS) {
      if (Date.now() + 3000 >= deadline) {
        readings.push({ jobname, status: 'unavailable', measured_at: null, reason: 'reading_budget_exhausted' });
        continue;
      }
      const reading = await boundedRead(conn, HEALTH_SQL, [[jobname]], '3s');
      const row = reading.rows.find(row => row.jobname === jobname);
      if (row) rows.set(jobname, { ...row, ...rows.get(jobname),
        assay_status: row.assay_status, health_status: row.health_status, assay_counts: row.assay_counts });
      const measured = reading.status === 'measured' && !!row && row.assay_status !== 'unavailable';
      readings.push({ jobname, status: measured ? 'measured' : 'unavailable', measured_at: reading.measured_at,
        reason: measured ? null : reading.status === 'unavailable' ? 'query_unavailable'
          : row ? 'assay_unavailable' : 'job_absent' });
    }
    const measured_at = executions.measured_at ?? readings.find(r => r.measured_at)?.measured_at ?? null;
    const health = { status: rows.size > 0 && measured_at ? 'measured' : 'unavailable', measured_at,
      rows: [...rows.values()], readings, output_measured: readings.every(r => r.status === 'measured') };
    let controls: { status: string; value?: ReturnType<typeof intakeThrottle> } = { status: 'unavailable' };
    if (feeds.status === 'measured') {
      try { controls = { status: 'measured', value: intakeThrottle(feeds.controls ?? {}) }; }
      catch { controls = { status: 'invalid' }; }
    }
    const { controls: _rawControls, ...feedReading } = feeds.status === 'measured' ? feeds : { ...feeds, controls: undefined };
    return { contract: 'intake_status_v1', section, config,
      health, controls,
      activity: { ...activity, window_hours: 24, limit_per_worker: 50,
        complete: activity.status === 'measured' && 'complete' in activity && activity.complete === true },
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
