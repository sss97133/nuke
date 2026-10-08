-- Current live job-health owner inspected2026-10-08; preserve existing branches.
CREATE VIEW public.v_job_health AS  WITH taxonomy_assay AS MATERIALIZED (
         SELECT assay_vehicle_taxonomy_fold() AS reading
        ), residual_assay AS MATERIALIZED (
         SELECT assay_sale_residual_fold() AS reading
        ), stream_assay AS MATERIALIZED (
         SELECT get_live_auction_health() -> 'closing_stream'::text AS reading
        ), metric_assay AS MATERIALIZED (
         SELECT assay_vehicle_metric_fold() AS reading
          WHERE (EXISTS ( SELECT 1
                   FROM cron.job
                  WHERE job.jobname = 'drain-vehicle-derived-queues'::text))
        ), runs AS (
         SELECT d.jobid,
            d.status,
            d.start_time,
            d.return_message,
            row_number() OVER (PARTITION BY d.jobid ORDER BY d.start_time DESC) AS rn
           FROM cron.job_run_details d
          WHERE d.start_time > (now() - '7 days'::interval)
        ), first_ok AS (
         SELECT runs.jobid,
            min(runs.rn) AS rn
           FROM runs
          WHERE runs.status <> 'failed'::text
          GROUP BY runs.jobid
        ), streak AS (
         SELECT r.jobid,
            count(*) AS n
           FROM runs r
             LEFT JOIN first_ok f USING (jobid)
          WHERE r.status = 'failed'::text AND r.rn < COALESCE(f.rn, 2147483647::bigint)
          GROUP BY r.jobid
        ), day AS (
         SELECT runs.jobid,
            count(*) AS runs_24h,
            count(*) FILTER (WHERE runs.status = 'failed'::text) AS failed_24h
           FROM runs
          WHERE runs.start_time > (now() - '24:00:00'::interval)
          GROUP BY runs.jobid
        ), last_run AS (
         SELECT runs.jobid,
            runs.status AS last_status,
            runs.start_time AS last_run_at
           FROM runs
          WHERE runs.rn = 1
        ), last_err AS (
         SELECT DISTINCT ON (runs.jobid) runs.jobid,
            "left"(runs.return_message, 300) AS last_error
           FROM runs
          WHERE runs.status = 'failed'::text
          ORDER BY runs.jobid, runs.start_time DESC
        )
 SELECT j.jobid,
    j.jobname,
    j.schedule,
    j.active,
    COALESCE(day.runs_24h, 0::bigint) AS runs_24h,
    COALESCE(day.failed_24h, 0::bigint) AS failed_24h,
    COALESCE(s.n, 0::bigint) AS consecutive_failures,
    lr.last_status,
    lr.last_run_at,
    le.last_error,
    "substring"(j.command, 'app\.writer''\s*,\s*''([^'']+)'::text) AS declared_writer,
    "left"(regexp_replace(j.command, '\s+'::text, ' '::text, 'g'::text), 200) AS command,
        CASE
            WHEN j.jobname = 'bat-live-pull'::text THEN ( SELECT stream_assay.reading ->> 'status'::text
               FROM stream_assay)
            WHEN j.jobname = 'drain-vehicle-derived-queues'::text THEN ( SELECT metric_assay.reading ->> 'status'::text
               FROM metric_assay)
            WHEN j.jobname = 'drain-vehicle-taxonomy'::text THEN ( SELECT taxonomy_assay.reading ->> 'status'::text
               FROM taxonomy_assay)
            WHEN j.jobname = 'drain-sale-residual-fold'::text THEN ( SELECT residual_assay.reading ->> 'status'::text
               FROM residual_assay)
            ELSE NULL::text
        END AS assay_status,
        CASE
            WHEN j.jobname = 'bat-live-pull'::text THEN ( SELECT stream_assay.reading
               FROM stream_assay)
            WHEN j.jobname = 'drain-vehicle-derived-queues'::text THEN ( SELECT metric_assay.reading
               FROM metric_assay)
            WHEN j.jobname = 'drain-vehicle-taxonomy'::text THEN ( SELECT taxonomy_assay.reading
               FROM taxonomy_assay)
            WHEN j.jobname = 'drain-sale-residual-fold'::text THEN ( SELECT residual_assay.reading
               FROM residual_assay)
            ELSE NULL::jsonb
        END AS assay,
        CASE
            WHEN NOT j.active THEN 'paused'::text
            WHEN lr.last_status = 'failed'::text THEN 'failed'::text
            WHEN j.jobname = 'bat-live-pull'::text THEN
            CASE
                WHEN lr.last_run_at IS NULL OR lr.last_run_at < (now() - '00:02:00'::interval) THEN 'failed'::text
                WHEN (( SELECT stream_assay.reading ->> 'status'::text
                   FROM stream_assay)) = 'failed'::text THEN 'failed'::text
                WHEN (( SELECT stream_assay.reading ->> 'status'::text
                   FROM stream_assay)) = 'passed'::text THEN 'passed'::text
                ELSE 'idle'::text
            END
            WHEN j.jobname = 'drain-sale-residual-fold'::text THEN
            CASE
                WHEN lr.last_run_at IS NULL OR lr.last_run_at <= (statement_timestamp() - '00:15:00'::interval) THEN 'failed'::text
                WHEN (( SELECT residual_assay.reading ->> 'status'::text
                   FROM residual_assay)) = 'failed'::text THEN 'failed'::text
                WHEN (( SELECT residual_assay.reading ->> 'status'::text
                   FROM residual_assay)) = 'passed'::text AND lr.last_status = 'succeeded'::text THEN 'passed'::text
                ELSE 'unknown'::text
            END
            WHEN j.jobname = 'drain-vehicle-taxonomy'::text THEN
            CASE
                WHEN lr.last_run_at IS NULL OR lr.last_run_at <= (statement_timestamp() - '00:15:00'::interval) THEN 'failed'::text
                WHEN (( SELECT taxonomy_assay.reading ->> 'status'::text
                   FROM taxonomy_assay)) = 'failed'::text THEN 'failed'::text
                WHEN (( SELECT taxonomy_assay.reading ->> 'status'::text
                   FROM taxonomy_assay)) = 'passed'::text AND lr.last_status = 'succeeded'::text THEN 'passed'::text
                ELSE 'unknown'::text
            END
            WHEN j.jobname = 'drain-vehicle-derived-queues'::text THEN
            CASE
                WHEN lr.last_run_at IS NULL OR lr.last_run_at <= (statement_timestamp() - '00:15:00'::interval) THEN 'failed'::text
                WHEN (( SELECT metric_assay.reading ->> 'status'::text
                   FROM metric_assay)) = 'failed'::text THEN 'failed'::text
                WHEN (( SELECT metric_assay.reading ->> 'status'::text
                   FROM metric_assay)) = ANY (ARRAY['partial'::text, 'unavailable'::text]) THEN 'unknown'::text
                WHEN lr.last_status <> 'succeeded'::text THEN 'unknown'::text
                WHEN (( SELECT metric_assay.reading ->> 'status'::text
                   FROM metric_assay)) = 'passed'::text THEN 'passed'::text
                ELSE 'idle'::text
            END
            WHEN lr.last_status = 'succeeded'::text THEN 'passed'::text
            ELSE 'unknown'::text
        END AS health_status
   FROM cron.job j
     LEFT JOIN day ON day.jobid = j.jobid
     LEFT JOIN streak s ON s.jobid = j.jobid
     LEFT JOIN last_run lr ON lr.jobid = j.jobid
     LEFT JOIN last_err le ON le.jobid = j.jobid;
