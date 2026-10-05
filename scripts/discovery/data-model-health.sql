-- Operator-only metadata reading for the existing ingestion-health monitor.
-- Run in a READ ONLY transaction with a bounded statement_timeout. This installs
-- no database object, worker, schedule or write authority. This statement reads
-- atlas metadata and tiny cron configuration only; execution/output health is
-- independently read in data-model-job-health.sql so its timeout loses no metadata.
-- The named tables/jobs are the complete requested scope, not a fleet sample.
-- Descriptions, declared owners, successful exits and validated constraints do
-- not establish source truth or source-to-reader correctness. Missing receipts
-- are unmeasured activity; NOT VALID constraints await historical validation.
WITH table_scope(table_name, ordinal) AS (
  VALUES ('vehicles', 1), ('vehicle_observations', 2), ('vehicle_events', 3),
         ('listing_page_snapshots', 4), ('vehicle_field_consensus', 5),
         ('observation_properties', 6), ('schema_proposals', 7)
), job_scope(job_name, ordinal) AS (
  VALUES ('drain-vehicle-derived-queues', 1), ('derivation-queue-drain', 2),
         ('derive-vehicle-image-attribution', 3),
         ('derive-vehicle-image-attribution-sweep', 4), ('bat-live-pull', 5)
), table_readings AS (
  SELECT s.ordinal, jsonb_build_object(
    'table_name', s.table_name,
    'catalog_present', c.oid IS NOT NULL,
    'atlas_present', a.table_name IS NOT NULL,
    'activity', a.activity,
    'estimated_rows', a.est_rows,
    'columns', jsonb_build_object(
      'total', a.n_cols, 'described', a.n_cols_described,
      'description_status', CASE
        WHEN a.n_cols IS NULL OR a.n_cols_described IS NULL THEN 'unmeasured'
        WHEN a.n_cols_described = 0 THEN 'undocumented'
        WHEN a.n_cols_described < a.n_cols THEN 'partial'
        ELSE 'described' END),
    'registry', jsonb_build_object(
      'owners', a.registry_owners, 'fields', a.registry_fields,
      'status', CASE WHEN a.table_name IS NULL THEN 'unmeasured'
                     WHEN coalesce(a.registry_fields, 0) = 0 THEN 'unregistered'
                     ELSE 'registered' END),
    'write_receipt', jsonb_build_object(
      'last_write', a.last_write,
      'status', CASE WHEN a.last_write IS NULL THEN 'unmeasured' ELSE 'recorded' END),
    'constraints', jsonb_build_object(
      'total', CASE WHEN c.oid IS NOT NULL THEN constraints.total END,
      'validated', CASE WHEN c.oid IS NOT NULL THEN constraints.validated END,
      'unvalidated', constraints.unvalidated,
      'status', CASE WHEN c.oid IS NULL THEN 'unmeasured'
                    WHEN constraints.total = 0 THEN 'none_registered'
                    WHEN constraints.total > constraints.validated THEN 'pending_validation'
                    ELSE 'validated' END)
  ) AS reading
  FROM table_scope s
  LEFT JOIN pg_catalog.pg_class c
    ON c.relnamespace = 'public'::regnamespace AND c.relname = s.table_name
   AND c.relkind IN ('r', 'p')
  LEFT JOIN public.v_schema_atlas a ON a.table_name = s.table_name
  LEFT JOIN LATERAL (
    SELECT count(*) AS total,
           count(*) FILTER (WHERE con.convalidated) AS validated,
           coalesce(jsonb_agg(jsonb_build_object(
             'name', con.conname,
             'type', CASE con.contype WHEN 'f' THEN 'foreign_key'
                       WHEN 'c' THEN 'check' WHEN 'p' THEN 'primary_key'
                       WHEN 'u' THEN 'unique' WHEN 'x' THEN 'exclusion'
                       ELSE con.contype::text END)
             ORDER BY con.conname) FILTER (WHERE NOT con.convalidated), '[]'::jsonb) AS unvalidated
    FROM pg_catalog.pg_constraint con
    WHERE con.conrelid = c.oid
  ) constraints ON true
), job_readings AS (
  SELECT s.ordinal, jsonb_build_object(
    'job_name', s.job_name,
    'present', j.jobid IS NOT NULL,
    'active', j.active,
    'schedule', j.schedule,
    'execution', jsonb_build_object(
      'state', CASE WHEN j.jobid IS NULL THEN 'missing'
                    WHEN j.active IS FALSE THEN 'paused'
                    ELSE 'unmeasured' END,
      'last_status', NULL, 'last_run_at', NULL,
      'runs_24h', NULL, 'failed_24h', NULL, 'consecutive_failures', NULL),
    'assay', jsonb_build_object(
      'state', 'unmeasured', 'reported_status', NULL),
    'reported_health_status', NULL
  ) AS reading
  FROM job_scope s
  LEFT JOIN cron.job j ON j.jobname = s.job_name
)
SELECT jsonb_build_object(
  'version', 'data_model_health_v1',
  'section', 'metadata',
  'measured_at', statement_timestamp(),
  'scope', jsonb_build_object(
    'tables', (SELECT jsonb_agg(table_name ORDER BY ordinal) FROM table_scope),
    'jobs', (SELECT jsonb_agg(job_name ORDER BY ordinal) FROM job_scope)),
  'tables', (SELECT jsonb_agg(reading ORDER BY ordinal) FROM table_readings),
  'jobs', (SELECT jsonb_agg(reading ORDER BY ordinal) FROM job_readings),
  'limits', jsonb_build_array(
    'Named tables and jobs only; no fleet or semantic completeness claim.',
    'Estimated rows and activity come from database statistics, not exact counts.',
    'Descriptions and registry owners are declarations, not independently verified meaning or responsibility.',
    'A missing write receipt does not establish inactivity; receipt coverage is incomplete.',
    'Constraint validation concerns declared constraints, not every intended relationship or source truth.',
    'Job execution, reported health and output assay are separate; a successful exit without an assay is unmeasured output.',
    'This metadata statement does not read job history or execute output assays; those have an independent timeout and clock.',
    'Agent work and source-to-reader acceptance require separate evidence.'
  )
) AS health;
