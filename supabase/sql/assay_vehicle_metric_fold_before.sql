-- Private operator acceptance probe; SELECT only, no schema/data mutation.
-- Exact read body of assay_vehicle_metric_fold; useful before authorized CI deploy.
-- All counters are bounded samples, never whole-fleet coverage. No payloads/IDs.
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
  ) AS reading
  FROM counts k CROSS JOIN clock c;
