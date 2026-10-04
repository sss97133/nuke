-- A successful cron statement does not prove a derived fold landed its output.
-- Extends v_job_health and the existing six-hour pipeline-heartbeat alarm; no
-- new table, schedule, testimony write, or change to the worker's commit policy.
-- Queue retries must retain attempts/last_error until successful replay (PR519).
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '10s';

CREATE OR REPLACE FUNCTION public.assay_vehicle_metric_fold()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  reading jsonb;
BEGIN
  -- One statement snapshot. Three five-minute drain cycles are the grace period.
  -- Fixed caps, not caller-controlled fleet scans: 1,001 oldest queue rows;
  -- 100 most recently ingested mature observations; <=100 vehicle point reads,
  -- each capped at 5,001 observations using the existing vehicle_id index.
  WITH clock AS MATERIALIZED (
    SELECT statement_timestamp() AS as_of_at,
           statement_timestamp() - interval '15 minutes' AS cutoff_at
  ), queue_head AS MATERIALIZED (
    SELECT q.vehicle_id, q.queued_at, q.attempts, q.last_error IS NOT NULL AS has_error
    FROM public.vehicle_metric_recompute_queue q
    ORDER BY q.queued_at
    LIMIT 1001
  ), source_head AS MATERIALIZED (
    SELECT o.vehicle_id
    FROM public.vehicle_observations o, clock c
    WHERE o.ingested_at > c.as_of_at - interval '24 hours'
      AND o.ingested_at <= c.cutoff_at
    ORDER BY o.ingested_at DESC
    LIMIT 100
  ), candidates AS MATERIALIZED (
    SELECT vehicle_id FROM (
      SELECT q.vehicle_id, 0 AS priority
      FROM queue_head q, clock c
      WHERE q.queued_at <= c.cutoff_at OR q.has_error OR q.attempts > 0
      UNION ALL
      SELECT s.vehicle_id, 1 AS priority FROM source_head s
    ) ids
    WHERE vehicle_id IS NOT NULL
    GROUP BY vehicle_id
    ORDER BY min(priority), vehicle_id
    LIMIT 100
  ), checked AS MATERIALIZED (
    SELECT ids.vehicle_id, source.n, source.comment_n, source.last_event_at,
           source.last_ingested_at, source.null_ingest_n,
           q.queued_at, q.attempts, q.last_error IS NOT NULL AS has_error,
           m.vehicle_id IS NOT NULL AS output_present,
           m.observation_count, m.comment_count, m.last_observation_at, m.updated_at,
           c.as_of_at,
           v.observation_count AS vehicle_observation_count,
           (q.queued_at > c.cutoff_at AND q.last_error IS NULL AND q.attempts = 0)
             OR source.last_ingested_at > c.cutoff_at AS within_grace
    FROM candidates ids
    JOIN public.vehicles v ON v.id = ids.vehicle_id
    CROSS JOIN clock c
    LEFT JOIN public.vehicle_metric_recompute_queue q ON q.vehicle_id = ids.vehicle_id
    LEFT JOIN public.vehicle_live_metrics m ON m.vehicle_id = ids.vehicle_id
    CROSS JOIN LATERAL (
      -- Current metric contract counts ALL attached observations, including
      -- superseded testimony; it is not a historical/PIT feature or public feed.
      SELECT count(*) AS n, count(*) FILTER (WHERE o.kind::text = 'comment') AS comment_n,
             max(o.observed_at) AS last_event_at, max(o.ingested_at) AS last_ingested_at,
             count(*) FILTER (WHERE o.ingested_at IS NULL) AS null_ingest_n
      FROM (
        SELECT o.kind, o.observed_at, o.ingested_at
        FROM public.vehicle_observations o WHERE o.vehicle_id = ids.vehicle_id
        LIMIT 5001
      ) o
    ) source
  ), evaluated AS MATERIALIZED (
    SELECT x.*,
      x.n <= 5000 AND NOT coalesce(x.within_grace, false) AS eligible,
      x.output_present
        AND x.observation_count IS NOT DISTINCT FROM x.n
        AND x.comment_count IS NOT DISTINCT FROM x.comment_n
        AND x.last_observation_at IS NOT DISTINCT FROM x.last_event_at
        AND x.updated_at IS NOT NULL AND x.updated_at <= x.as_of_at
        AND (x.last_ingested_at IS NULL OR x.updated_at >= x.last_ingested_at)
        AND x.vehicle_observation_count IS NOT DISTINCT FROM x.n AS matches
    FROM checked x
  ), counts AS (
    SELECT
      (SELECT count(*) FROM queue_head) AS queue_sampled,
      (SELECT count(*) FROM queue_head q, clock c WHERE q.queued_at <= c.cutoff_at) AS overdue_queue_sampled,
      (SELECT count(*) FROM queue_head WHERE has_error OR attempts > 0) AS failed_queue_sampled,
      (SELECT count(*) FROM queue_head q, clock c WHERE q.queued_at > c.as_of_at) AS future_queue_clock_sampled,
      (SELECT max(attempts) FROM queue_head) AS max_attempts_sampled,
      (SELECT min(queued_at) FROM queue_head) AS oldest_queued_at,
      (SELECT count(*) FROM source_head) AS source_rows_sampled,
      count(*) AS vehicles_sampled,
      count(*) FILTER (WHERE eligible) AS vehicles_eligible,
      count(*) FILTER (WHERE eligible AND matches) AS vehicles_matching,
      count(*) FILTER (WHERE eligible AND NOT matches) AS vehicles_mismatching,
      count(*) FILTER (WHERE coalesce(within_grace, false)) AS vehicles_in_grace,
      count(*) FILTER (WHERE n > 5000) AS vehicles_over_scan_cap,
      count(*) FILTER (WHERE last_ingested_at > c.as_of_at) AS vehicles_future_ingest,
      count(*) FILTER (WHERE null_ingest_n > 0) AS vehicles_unknown_ingest
    FROM evaluated CROSS JOIN clock c
  )
  SELECT jsonb_build_object(
    'status', CASE
      WHEN k.failed_queue_sampled > 0 OR k.overdue_queue_sampled > 0 OR k.vehicles_mismatching > 0 THEN 'failed'
      WHEN k.queue_sampled = 1001 OR k.vehicles_over_scan_cap > 0
        OR k.vehicles_future_ingest > 0 OR k.vehicles_unknown_ingest > 0
        OR k.future_queue_clock_sampled > 0 THEN 'partial'
      WHEN k.vehicles_eligible = 0 THEN 'idle'
      ELSE 'passed' END,
    'reasons', to_jsonb(array_remove(ARRAY[
      CASE WHEN k.failed_queue_sampled > 0 THEN 'metric_queue_retry_error' END,
      CASE WHEN k.overdue_queue_sampled > 0 THEN 'metric_queue_overdue' END,
      CASE WHEN k.vehicles_mismatching > 0 THEN 'metric_output_mismatch' END,
      CASE WHEN k.queue_sampled = 1001 THEN 'queue_sample_capped' END,
      CASE WHEN k.future_queue_clock_sampled > 0 THEN 'future_queue_clock' END,
      CASE WHEN k.vehicles_over_scan_cap > 0 THEN 'vehicle_scan_capped' END,
      CASE WHEN k.vehicles_future_ingest > 0 THEN 'future_ingest_clock' END,
      CASE WHEN k.vehicles_unknown_ingest > 0 THEN 'unknown_ingest_clock' END,
      CASE WHEN k.vehicles_eligible = 0 THEN 'no_eligible_sample' END
    ]::text[], NULL)),
    'as_of_at', c.as_of_at, 'cutoff_at', c.cutoff_at,
    'scope', 'bounded_recent_ingest_and_oldest_dirty_vehicles',
    'fold', 'vehicle_observation_metrics',
    'source_window_hours', 24, 'grace_seconds', 900,
    'queue_sample_limit', 1001, 'source_sample_limit', 100,
    'vehicle_sample_limit', 100, 'observations_per_vehicle_limit', 5001,
    'counts', to_jsonb(k)
  ) INTO reading
  FROM counts k CROSS JOIN clock c;
  RETURN reading;
EXCEPTION WHEN OTHERS THEN
  -- A broken assay is unknown, never a healthy empty population. No payloads,
  -- vehicle IDs, or SQLERRM (which can contain testimony) enter operator output.
  RETURN jsonb_build_object('status', 'unavailable', 'reasons',
    jsonb_build_array('metric_assay_read_failed'), 'sqlstate', SQLSTATE,
    'as_of_at', statement_timestamp(), 'scope', 'bounded_recent_ingest_and_oldest_dirty_vehicles');
END;
$function$;

COMMENT ON FUNCTION public.assay_vehicle_metric_fold() IS
  'Read-only bounded assay of drain_vehicle_metric_queue: three 5-minute cycles grace, oldest 1001 dirty rows plus 100 mature observations ingested in 24 h, up to 100 keyed vehicle folds of at most 5001 events each. Compares actual count/comment count/event watermark and vehicles.observation_count with the current ALL-observations contract. Retry errors, overdue work or exact output mismatch fail; cap/clock gaps are partial; no eligible sample is idle. Aggregate operator output only; no fleet or historical assurance. Used by v_job_health and the existing 6-hour pipeline_heartbeat.';
REVOKE ALL ON FUNCTION public.assay_vehicle_metric_fold() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assay_vehicle_metric_fold() TO service_role;

CREATE OR REPLACE VIEW public.v_job_health AS
WITH metric_assay AS MATERIALIZED (
  SELECT public.assay_vehicle_metric_fold() AS reading
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'drain-vehicle-derived-queues')
), runs AS (
  SELECT d.jobid, d.status, d.start_time, d.return_message,
         row_number() OVER (PARTITION BY d.jobid ORDER BY d.start_time DESC) AS rn
  FROM cron.job_run_details d
  WHERE d.start_time > now() - interval '7 days'
),
first_ok AS (
  SELECT jobid, min(rn) AS rn FROM runs WHERE status <> 'failed' GROUP BY jobid
),
streak AS (
  SELECT r.jobid, count(*) AS n
  FROM runs r LEFT JOIN first_ok f USING (jobid)
  WHERE r.status = 'failed' AND r.rn < coalesce(f.rn, 2147483647)
  GROUP BY r.jobid
),
day AS (
  SELECT jobid, count(*) AS runs_24h, count(*) FILTER (WHERE status = 'failed') AS failed_24h
  FROM runs WHERE start_time > now() - interval '24 hours' GROUP BY jobid
),
last_run AS (
  SELECT jobid, status AS last_status, start_time AS last_run_at FROM runs WHERE rn = 1
),
last_err AS (
  SELECT DISTINCT ON (jobid) jobid, left(return_message, 300) AS last_error
  FROM runs WHERE status = 'failed' ORDER BY jobid, start_time DESC
)
SELECT j.jobid,
       j.jobname,
       j.schedule,
       j.active,
       coalesce(day.runs_24h, 0)   AS runs_24h,
       coalesce(day.failed_24h, 0) AS failed_24h,
       coalesce(s.n, 0)            AS consecutive_failures,
       lr.last_status,
       lr.last_run_at,
       le.last_error,
       substring(j.command FROM 'app\.writer''\s*,\s*''([^'']+)') AS declared_writer,
       left(regexp_replace(j.command, '\s+', ' ', 'g'), 200) AS command,
       CASE WHEN j.jobname = 'drain-vehicle-derived-queues'
         THEN (SELECT reading->>'status' FROM metric_assay) END AS assay_status,
       CASE WHEN j.jobname = 'drain-vehicle-derived-queues'
         THEN (SELECT reading FROM metric_assay) END AS assay,
       CASE
         WHEN NOT j.active THEN 'paused'
         WHEN lr.last_status = 'failed' THEN 'failed'
         WHEN j.jobname = 'drain-vehicle-derived-queues' THEN CASE
           WHEN lr.last_run_at IS NULL OR lr.last_run_at <= statement_timestamp() - interval '15 minutes' THEN 'failed'
           WHEN (SELECT reading->>'status' FROM metric_assay) = 'failed' THEN 'failed'
           WHEN (SELECT reading->>'status' FROM metric_assay) IN ('partial','unavailable') THEN 'unknown'
           WHEN lr.last_status <> 'succeeded' THEN 'unknown'
           WHEN (SELECT reading->>'status' FROM metric_assay) = 'passed' THEN 'passed'
           ELSE 'idle' END
         WHEN lr.last_status = 'succeeded' THEN 'passed'
         ELSE 'unknown' END AS health_status
FROM cron.job j
LEFT JOIN day          ON day.jobid = j.jobid
LEFT JOIN streak s     ON s.jobid = j.jobid
LEFT JOIN last_run lr  ON lr.jobid = j.jobid
LEFT JOIN last_err le  ON le.jobid = j.jobid;

COMMENT ON VIEW public.v_job_health IS
  'One row per pg_cron job. Existing cron execution columns unchanged. Appended assay_status/assay/health_status measure current metric fold output for drain-vehicle-derived-queues: once per reading, bounded, aggregate-only, 15-minute grace; failed even after successful cron exits when retries, stale work or source/output mismatch exist. An active derived job without a run in 15 minutes also fails. Idle/partial/unavailable do not claim verified output. Other jobs have execution health only. Operator-only existing grants preserved.';
COMMENT ON COLUMN public.v_job_health.assay_status IS
  'Current bounded metric-fold assay result: passed, failed, idle, partial, unavailable; NULL for other jobs. Not cron execution status or fleet assurance.';
COMMENT ON COLUMN public.v_job_health.assay IS
  'Aggregate source-to-state comparison, coverage caps, queue lower-bound counts, cutoff and ingestion grace. No vehicle IDs, payloads or queue error text.';
COMMENT ON COLUMN public.v_job_health.health_status IS
  'Operational health combining execution and output: failed, passed, paused, idle or unknown. For the derived drainer, a successful cron exit alone cannot produce passed.';

CREATE OR REPLACE FUNCTION public.pipeline_heartbeat()
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  p jsonb;
  new_non_unknown bigint;
  unknown_new bigint;
  vegas_err text;
  reasons text[] := '{}';
  cron_reasons text[] := '{}';
BEGIN
  -- ── Cron alarm (2026-09-27) ──────────────────────────────────────────────────
  BEGIN
    WITH metric_assay AS MATERIALIZED (
      SELECT public.assay_vehicle_metric_fold() AS reading
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'drain-vehicle-derived-queues' AND active)
    ), m AS (SELECT max(runid) AS r FROM cron.job_run_details),
    runs AS (
      SELECT d.jobid, d.status, d.start_time,
             row_number() OVER (PARTITION BY d.jobid ORDER BY d.runid DESC) AS rn
      FROM cron.job_run_details d, m
      WHERE d.runid > m.r - 12000
    ),
    first_ok AS (
      SELECT jobid, min(rn) AS rn FROM runs WHERE status <> 'failed' GROUP BY jobid
    ),
    streak AS (
      SELECT r.jobid, count(*) AS n
      FROM runs r LEFT JOIN first_ok f USING (jobid)
      WHERE r.status = 'failed' AND r.rn < coalesce(f.rn, 2147483647)
      GROUP BY r.jobid
    ),
    day AS (
      SELECT jobid,
             count(*) AS runs_24h,
             count(*) FILTER (WHERE status = 'failed') AS failed_24h
      FROM runs
      WHERE start_time > now() - interval '24 hours'
      GROUP BY jobid
    )
    SELECT coalesce(array_agg(f.reason ORDER BY f.jobid, f.reason), '{}')
    INTO cron_reasons
    FROM (
      SELECT j.jobid, format('cron_failing:%s %s/%s in 24h (streak %s)',
        j.jobname, day.failed_24h, day.runs_24h, coalesce(s.n, 0)) AS reason
      FROM cron.job j
      JOIN day ON day.jobid = j.jobid
      LEFT JOIN streak s ON s.jobid = j.jobid
      WHERE j.active AND day.runs_24h >= 4
        AND (day.failed_24h * 2 > day.runs_24h OR coalesce(s.n, 0) >= 20)
      UNION ALL
      SELECT j.jobid, format('fold_assay:%s %s (%s)', j.jobname,
        a.reading->>'status', a.reading->'reasons')
      FROM cron.job j CROSS JOIN metric_assay a
      WHERE j.jobname = 'drain-vehicle-derived-queues' AND j.active
        AND a.reading->>'status' IN ('failed','partial','unavailable')
      UNION ALL
      SELECT j.jobid, 'fold_worker_no_run_15m:drain-vehicle-derived-queues'
      FROM cron.job j
      WHERE j.jobname = 'drain-vehicle-derived-queues' AND j.active
        AND NOT EXISTS (SELECT 1 FROM runs r WHERE r.jobid = j.jobid
          AND r.start_time > statement_timestamp() - interval '15 minutes')
    ) f;
  EXCEPTION WHEN others THEN
    -- The reading failing is itself a finding, never a silent pass.
    cron_reasons := ARRAY['cron_health_reading_failed: ' || SQLERRM];
  END;

  IF array_length(cron_reasons, 1) IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM admin_notifications
    WHERE notification_type = 'system_alert'
      AND metadata->>'kind' = 'cron_health'
      AND created_at > now() - interval '24 hours'
  ) THEN
    INSERT INTO admin_notifications (notification_type, title, message, action_required, priority, metadata)
    VALUES (
      'system_alert',
      'Cron health: ' || array_length(cron_reasons, 1) || ' finding(s)',
      array_to_string(cron_reasons, '; ')
        || '. Ledger: docs/ledger/CRON_LEDGER.md (npm run ledger:facts). Pause: select cron.alter_job(job_id := <id>, active := false).',
      'system_action', 2,
      jsonb_build_object('kind', 'cron_health', 'reasons', to_jsonb(cron_reasons)));
  END IF;

  -- ── Intake heartbeat (unchanged from 20260702003000) ─────────────────────────
  -- Alarm signals computed DIRECTLY (cheap: vehicles-24h brin, listing_feeds tiny).
  -- The alarm must never depend on the full reading surviving.
  SELECT count(*) INTO new_non_unknown
  FROM vehicles
  WHERE created_at > now() - interval '24 hours'
    AND COALESCE(source, 'unknown') <> 'unknown';

  SELECT count(*) INTO unknown_new
  FROM vehicles
  WHERE source = 'unknown' AND created_at > now() - interval '24 hours';

  SELECT last_error INTO vegas_err
  FROM listing_feeds WHERE id = '46b8373b-2454-4cbb-926c-7646c90e560d';

  IF new_non_unknown = 0 THEN
    reasons := reasons || 'no_new_non_unknown_vehicles_24h';
  END IF;
  IF unknown_new > 0 THEN
    reasons := reasons || format('unknown_source_new_24h=%s', unknown_new);
  END IF;
  IF vegas_err IS NOT NULL THEN
    reasons := reasons || 'vegas_feed_last_error_present';
  END IF;

  -- Pulse snapshot is opportunistic context, never a dependency.
  BEGIN
    p := public.get_pipeline_pulse_24h();
  EXCEPTION WHEN others THEN
    p := jsonb_build_object('pulse_error', SQLERRM);
    reasons := reasons || 'pulse_reading_failed';
  END;

  IF array_length(reasons, 1) IS NULL THEN
    RETURN;  -- healthy, stay silent
  END IF;

  IF EXISTS (
    SELECT 1 FROM admin_notifications
    WHERE notification_type = 'system_alert'
      AND metadata->>'kind' = 'pipeline_heartbeat'
      AND created_at > now() - interval '24 hours'
  ) THEN
    RETURN;
  END IF;

  INSERT INTO admin_notifications (notification_type, title, message, action_required, priority, metadata)
  VALUES (
    'system_alert',
    'Pipeline heartbeat: ' || array_to_string(reasons, ', '),
    'Dead-man heartbeat tripped. Reasons: ' || array_to_string(reasons, '; ')
      || '. Pulse snapshot (or its error) in metadata.pulse.',
    'system_action', 2,
    jsonb_build_object('kind', 'pipeline_heartbeat', 'reasons', to_jsonb(reasons), 'pulse', p));
END;
$function$;

COMMENT ON FUNCTION public.pipeline_heartbeat() IS
  'Existing six-hour dead-man switch. Independent cron_health alert (24 h dedup) includes execution failures, bounded metric-fold failure/partial/unavailable findings and a derived worker with no run in 15 minutes; successful cron exits cannot hide missing fold output. Existing intake alerts, bounds and cadence preserved.';

-- Keep ownership at the canonical worker, not the read-only assay. NULL table
-- entries need NOT EXISTS because the registry unique key allows multiple NULLs.
INSERT INTO public.pipeline_registry
  (table_name, column_name, owned_by, description, do_not_write_directly, write_via)
SELECT 'vehicle_metric_recompute_queue', NULL, 'drain_vehicle_metric_queue',
  'Dirty vehicle folds queued by observation triggers; oldest queued_at is ingest/work age, attempts and last_error survive retries until successful replay. Five-minute drain-vehicle-derived-queues; bounded assay via v_job_health and six-hour heartbeat.',
  true, 'update_vehicle_live_metrics() / drain_vehicle_metric_queue()'
WHERE NOT EXISTS (SELECT 1 FROM public.pipeline_registry WHERE table_name = 'vehicle_metric_recompute_queue' AND column_name IS NULL);
INSERT INTO public.pipeline_registry
  (table_name, column_name, owned_by, description, do_not_write_directly, write_via)
SELECT 'vehicle_live_metrics', fields.name, 'drain_vehicle_metric_queue', fields.description,
  true, 'drain_vehicle_metric_queue()'
FROM (VALUES
  ('observation_count', 'Current count of ALL attached observations; bounded exact source/output assay in v_job_health.'),
  ('comment_count', 'Current count of ALL attached comment observations; same fold and assay as observation_count.'),
  ('last_observation_at', 'Source event-time watermark for the current observation fold; late ingestion does not imply a newer event.'),
  ('updated_at', 'Ingestion/computation clock for metric replay; distinct from source event time.')
) fields(name, description)
ON CONFLICT (table_name, column_name) DO NOTHING;
COMMENT ON TABLE public.vehicle_live_metrics IS
  'Per-vehicle current observation activity, keyed by vehicle_id. drain_vehicle_metric_queue maintains observation_count, comment_count, last_observation_at and updated_at through the five-minute drain-vehicle-derived-queues job. Sentiment/auction fields have separate contracts. Bounded operational source/output assay in v_job_health; not a historical/PIT feature.';
COMMENT ON COLUMN public.vehicle_metric_recompute_queue.vehicle_id IS
  'Vehicle FK and queue grain; one dirty row per vehicle collapses concurrent enqueues.';
COMMENT ON COLUMN public.vehicle_metric_recompute_queue.live_metrics_dirty IS
  'Needs current observation metric/consensus replay by drain_vehicle_metric_queue; set by the canonical observation trigger.';
COMMENT ON COLUMN public.vehicle_metric_recompute_queue.observation_count_dirty IS
  'Needs vehicles.observation_count replay from all attached source observations; independent of live_metrics_dirty.';
COMMENT ON COLUMN public.vehicle_metric_recompute_queue.queued_at IS
  'UTC ingest/work clock for oldest pending enqueue; retry writer may renew this clock, so attempts/last_error independently trip the assay. Fifteen-minute stale threshold, not source event time.';
COMMENT ON COLUMN public.vehicle_metric_recompute_queue.attempts IS
  'Failed replay attempts retained until success by the canonical worker; any nonzero value is an operational finding, not an instruction to drop testimony/work.';
COMMENT ON COLUMN public.vehicle_metric_recompute_queue.last_error IS
  'Private latest replay failure text retained for operators; assay exposes only its presence, never this text.';
COMMENT ON COLUMN public.vehicle_live_metrics.observation_count IS
  'Current count of ALL vehicle_observations attached to this vehicle, including superseded testimony; integer rows. Replayed by drain_vehicle_metric_queue, not historical/public-filtered.';
COMMENT ON COLUMN public.vehicle_live_metrics.comment_count IS
  'Current count of ALL attached observations whose kind is comment, including superseded testimony; integer rows, same worker/snapshot as observation_count.';
COMMENT ON COLUMN public.vehicle_live_metrics.last_observation_at IS
  'UTC source event-time watermark max(vehicle_observations.observed_at) for all attached observations; may remain old when late testimony is ingested.';
COMMENT ON COLUMN public.vehicle_live_metrics.updated_at IS
  'UTC fold computation/ingestion clock written by drain_vehicle_metric_queue; distinct from last_observation_at event time. Not a historical feature cutoff.';

COMMIT;
