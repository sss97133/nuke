-- Independent operator reading of the existing v_job_health owner. Its history
-- and output assays retain their existing bounds; a timeout must not erase the
-- separately collected table and cron configuration metadata. Read-only, 5s cap.
WITH job_scope(job_name, ordinal) AS (
  VALUES ('drain-vehicle-derived-queues', 1), ('derivation-queue-drain', 2),
         ('derive-vehicle-image-attribution', 3),
         ('derive-vehicle-image-attribution-sweep', 4), ('bat-live-pull', 5)
), job_readings AS (
  SELECT s.ordinal, jsonb_build_object(
    'job_name', s.job_name, 'present', j.jobid IS NOT NULL,
    'active', j.active, 'schedule', j.schedule,
    'execution', jsonb_build_object(
      'state', CASE WHEN j.jobid IS NULL THEN 'missing'
                    WHEN j.active IS FALSE THEN 'paused'
                    WHEN j.last_status = 'succeeded' THEN 'succeeded'
                    WHEN j.last_status = 'failed' THEN 'failed'
                    WHEN j.last_status IN ('starting', 'running', 'connecting', 'sending') THEN 'in_progress'
                    ELSE 'unmeasured' END,
      'last_status', j.last_status, 'last_run_at', j.last_run_at,
      'runs_24h', j.runs_24h, 'failed_24h', j.failed_24h,
      'consecutive_failures', j.consecutive_failures),
    'assay', jsonb_build_object(
      'state', CASE WHEN j.assay_status IN ('passed', 'failed', 'partial', 'idle', 'unavailable')
                    THEN j.assay_status ELSE 'unmeasured' END,
      'reported_status', j.assay_status),
    'reported_health_status', j.health_status
  ) AS reading
  FROM job_scope s
  LEFT JOIN public.v_job_health j ON j.jobname = s.job_name
)
SELECT jsonb_build_object(
  'version', 'data_model_health_v1', 'section', 'jobHealth',
  'measured_at', statement_timestamp(),
  'scope', jsonb_build_object(
    'tables', jsonb_build_array('vehicles', 'vehicle_observations', 'vehicle_events',
      'listing_page_snapshots', 'vehicle_field_consensus', 'observation_properties', 'schema_proposals'),
    'jobs', (SELECT jsonb_agg(job_name ORDER BY ordinal) FROM job_scope)),
  'jobs', (SELECT jsonb_agg(reading ORDER BY ordinal) FROM job_readings),
  'limits', jsonb_build_array(
    'Five named jobs only; execution and output assays remain distinct.',
    'Existing job-specific sample, eligibility, grace and timing limits apply.',
    'This statement has its own clock; it is not atomic with the atlas metadata reading.',
    'No raw job command, error text or assay payload is returned.'
  )
) AS health;
