-- Contract for 20261126114500_job_health_worst_of_run_and_assay (empty disposable PG17).
-- v_job_health is created from its live definition (pg_get_viewdef, production 2026-11-25) over fixture tables and
-- stub assay functions. Asserts: a generic job whose last run succeeded reads failed while its own fresh assay row says
-- failed, and passed when that row is stale, passed or absent; a paused job stays paused; a failed run stays failed;
-- bat-live-pull keeps its own rule; the other columns are unchanged; re-applying the migration changes nothing.
-- Synthetic rows only.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF to_regclass('public.job_assay_readings') IS NOT NULL THEN RAISE EXCEPTION 'Requires an empty disposable database'; END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
END $$;
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid bigint PRIMARY KEY, jobname text, schedule text, command text, active boolean DEFAULT true);
CREATE TABLE cron.job_run_details (runid bigint PRIMARY KEY, jobid bigint, status text, start_time timestamptz,
  end_time timestamptz, return_message text);
CREATE TABLE public.cron_run_digest (runid bigint PRIMARY KEY, jobid bigint, status text, start_time timestamptz, error_head text);
CREATE TABLE public.job_assay_readings (jobname text PRIMARY KEY, reading jsonb, assayed_at timestamptz, elapsed_ms int,
  attempted_at timestamptz, attempt_error text, refresh_every interval, fresh_for interval, run_started_at timestamptz);
CREATE FUNCTION public.job_health_live_from() RETURNS bigint LANGUAGE sql STABLE AS $$ select 0::bigint $$;
CREATE FUNCTION public.get_live_auction_health() RETURNS jsonb LANGUAGE sql AS $$ select '{"closing_stream": {"status": "passed"}}'::jsonb $$;
CREATE FUNCTION public.assay_bat_sale_intake() RETURNS jsonb LANGUAGE sql AS $$ select '{"status": "passed"}'::jsonb $$;
CREATE FUNCTION public.assay_retained_listing_properties() RETURNS jsonb LANGUAGE sql AS $$ select '{"status": "passed"}'::jsonb $$;
CREATE FUNCTION public.assay_vin_reference_intake() RETURNS jsonb LANGUAGE sql AS $$ select '{"status": "passed"}'::jsonb $$;
CREATE FUNCTION public.assay_vehicle_taxonomy_fold() RETURNS jsonb LANGUAGE sql AS $$ select '{"status": "passed"}'::jsonb $$;
CREATE FUNCTION public.assay_sale_residual_fold() RETURNS jsonb LANGUAGE sql AS $$ select '{"status": "passed"}'::jsonb $$;
CREATE FUNCTION public.assay_vehicle_metric_fold() RETURNS jsonb LANGUAGE sql AS $$ select '{"status": "passed"}'::jsonb $$;
SET search_path = public;

-- live definition (2026-11-25)
CREATE VIEW public.v_job_health AS
WITH bat_sale_assay AS MATERIALIZED (
         SELECT
                CASE
                    WHEN (r.assayed_at > (statement_timestamp() - r.fresh_for)) THEN r.reading
                    ELSE assay_bat_sale_intake()
                END AS reading
           FROM (( SELECT 1 AS "?column?") one
             LEFT JOIN job_assay_readings r ON ((r.jobname = 'qualify-bat-archived-sales'::text)))
        ), retained_listing_assay AS MATERIALIZED (
         SELECT
                CASE
                    WHEN (r.assayed_at > (statement_timestamp() - r.fresh_for)) THEN r.reading
                    ELSE assay_retained_listing_properties()
                END AS reading
           FROM (( SELECT 1 AS "?column?") one
             LEFT JOIN job_assay_readings r ON ((r.jobname = 'project-retained-listing-properties'::text)))
        ), vin_reference_assay AS MATERIALIZED (
         SELECT
                CASE
                    WHEN (r.assayed_at > (statement_timestamp() - r.fresh_for)) THEN r.reading
                    ELSE assay_vin_reference_intake()
                END AS reading
           FROM (( SELECT 1 AS "?column?") one
             LEFT JOIN job_assay_readings r ON ((r.jobname = 'qualify-retained-vin-references'::text)))
        ), taxonomy_assay AS MATERIALIZED (
         SELECT assay_vehicle_taxonomy_fold() AS reading
        ), residual_assay AS MATERIALIZED (
         SELECT assay_sale_residual_fold() AS reading
        ), stream_assay AS MATERIALIZED (
         SELECT
                CASE
                    WHEN (r.assayed_at > (statement_timestamp() - r.fresh_for)) THEN r.reading
                    ELSE (get_live_auction_health() -> 'closing_stream'::text)
                END AS reading
           FROM (( SELECT 1 AS "?column?") one
             LEFT JOIN job_assay_readings r ON ((r.jobname = 'bat-live-pull'::text)))
        ), metric_assay AS MATERIALIZED (
         SELECT
                CASE
                    WHEN (r.assayed_at > (statement_timestamp() - r.fresh_for)) THEN r.reading
                    ELSE assay_vehicle_metric_fold()
                END AS reading
           FROM (( SELECT 1 AS "?column?") one
             LEFT JOIN job_assay_readings r ON ((r.jobname = 'drain-vehicle-derived-queues'::text)))
          WHERE (EXISTS ( SELECT 1
                   FROM cron.job
                  WHERE (job.jobname = 'drain-vehicle-derived-queues'::text)))
        ), recent_runs AS (
         SELECT g.jobid,
            g.status,
            g.start_time,
            g.error_head AS return_message
           FROM cron_run_digest g
          WHERE ((g.runid < ( SELECT job_health_live_from() AS job_health_live_from)) AND ((g.status = 'succeeded'::text) OR (g.status = 'failed'::text)))
        UNION ALL
         SELECT d.jobid,
            d.status,
            d.start_time,
            d.return_message
           FROM (cron_run_digest g
             JOIN cron.job_run_details d ON ((d.runid = g.runid)))
          WHERE ((g.runid < ( SELECT job_health_live_from() AS job_health_live_from)) AND (g.status IS DISTINCT FROM 'succeeded'::text) AND (g.status IS DISTINCT FROM 'failed'::text))
        UNION ALL
         SELECT d.jobid,
            d.status,
            d.start_time,
            d.return_message
           FROM cron.job_run_details d
          WHERE (d.runid >= job_health_live_from())
        ), runs AS (
         SELECT r.jobid,
            r.status,
            r.start_time,
            r.return_message,
            row_number() OVER (PARTITION BY r.jobid ORDER BY r.start_time DESC) AS rn
           FROM recent_runs r
          WHERE (r.start_time > (now() - '7 days'::interval))
        ), first_ok AS (
         SELECT runs.jobid,
            min(runs.rn) AS rn
           FROM runs
          WHERE (runs.status <> 'failed'::text)
          GROUP BY runs.jobid
        ), streak AS (
         SELECT r.jobid,
            count(*) AS n
           FROM (runs r
             LEFT JOIN first_ok f USING (jobid))
          WHERE ((r.status = 'failed'::text) AND (r.rn < COALESCE(f.rn, (2147483647)::bigint)))
          GROUP BY r.jobid
        ), day AS (
         SELECT runs.jobid,
            count(*) AS runs_24h,
            count(*) FILTER (WHERE (runs.status = 'failed'::text)) AS failed_24h
           FROM runs
          WHERE (runs.start_time > (now() - '24:00:00'::interval))
          GROUP BY runs.jobid
        ), last_run AS (
         SELECT runs.jobid,
            runs.status AS last_status,
            runs.start_time AS last_run_at
           FROM runs
          WHERE (runs.rn = 1)
        ), last_err AS (
         SELECT DISTINCT ON (runs.jobid) runs.jobid,
            "left"(runs.return_message, 300) AS last_error
           FROM runs
          WHERE (runs.status = 'failed'::text)
          ORDER BY runs.jobid, runs.start_time DESC
        )
 SELECT j.jobid,
    j.jobname,
    j.schedule,
    j.active,
    COALESCE(day.runs_24h, (0)::bigint) AS runs_24h,
    COALESCE(day.failed_24h, (0)::bigint) AS failed_24h,
    COALESCE(s.n, (0)::bigint) AS consecutive_failures,
    lr.last_status,
    lr.last_run_at,
    le.last_error,
    "substring"(j.command, 'app\.writer''\s*,\s*''([^'']+)'::text) AS declared_writer,
    "left"(regexp_replace(j.command, '\s+'::text, ' '::text, 'g'::text), 200) AS command,
        CASE
            WHEN (j.jobname = 'bat-live-pull'::text) THEN ( SELECT (stream_assay.reading ->> 'status'::text)
               FROM stream_assay)
            WHEN (j.jobname = 'drain-vehicle-derived-queues'::text) THEN ( SELECT (metric_assay.reading ->> 'status'::text)
               FROM metric_assay)
            WHEN (j.jobname = 'project-retained-listing-properties'::text) THEN ( SELECT (retained_listing_assay.reading ->> 'status'::text)
               FROM retained_listing_assay)
            WHEN (j.jobname = 'qualify-retained-vin-references'::text) THEN ( SELECT (vin_reference_assay.reading ->> 'status'::text)
               FROM vin_reference_assay)
            WHEN (j.jobname = 'qualify-bat-archived-sales'::text) THEN ( SELECT (bat_sale_assay.reading ->> 'status'::text)
               FROM bat_sale_assay)
            WHEN (j.jobname = 'drain-vehicle-taxonomy'::text) THEN ( SELECT (taxonomy_assay.reading ->> 'status'::text)
               FROM taxonomy_assay)
            WHEN (j.jobname = 'drain-sale-residual-fold'::text) THEN ( SELECT (residual_assay.reading ->> 'status'::text)
               FROM residual_assay)
            ELSE ( SELECT (own.reading ->> 'status'::text)
               FROM job_assay_readings own
              WHERE ((own.jobname = j.jobname) AND (own.assayed_at > (statement_timestamp() - own.fresh_for))))
        END AS assay_status,
        CASE
            WHEN (j.jobname = 'bat-live-pull'::text) THEN ( SELECT stream_assay.reading
               FROM stream_assay)
            WHEN (j.jobname = 'drain-vehicle-derived-queues'::text) THEN ( SELECT metric_assay.reading
               FROM metric_assay)
            WHEN (j.jobname = 'project-retained-listing-properties'::text) THEN ( SELECT retained_listing_assay.reading
               FROM retained_listing_assay)
            WHEN (j.jobname = 'qualify-retained-vin-references'::text) THEN ( SELECT vin_reference_assay.reading
               FROM vin_reference_assay)
            WHEN (j.jobname = 'qualify-bat-archived-sales'::text) THEN ( SELECT bat_sale_assay.reading
               FROM bat_sale_assay)
            WHEN (j.jobname = 'drain-vehicle-taxonomy'::text) THEN ( SELECT taxonomy_assay.reading
               FROM taxonomy_assay)
            WHEN (j.jobname = 'drain-sale-residual-fold'::text) THEN ( SELECT residual_assay.reading
               FROM residual_assay)
            ELSE ( SELECT own.reading
               FROM job_assay_readings own
              WHERE ((own.jobname = j.jobname) AND (own.assayed_at > (statement_timestamp() - own.fresh_for))))
        END AS assay,
        CASE
            WHEN (NOT j.active) THEN 'paused'::text
            WHEN (lr.last_status = 'failed'::text) THEN 'failed'::text
            WHEN (j.jobname = 'bat-live-pull'::text) THEN
            CASE
                WHEN ((lr.last_run_at IS NULL) OR (lr.last_run_at < (now() - '00:02:00'::interval))) THEN 'failed'::text
                WHEN (( SELECT (stream_assay.reading ->> 'status'::text)
                   FROM stream_assay) = 'failed'::text) THEN 'failed'::text
                WHEN (( SELECT (stream_assay.reading ->> 'status'::text)
                   FROM stream_assay) = 'passed'::text) THEN 'passed'::text
                ELSE 'idle'::text
            END
            WHEN (j.jobname = 'drain-sale-residual-fold'::text) THEN
            CASE
                WHEN ((lr.last_run_at IS NULL) OR (lr.last_run_at <= (statement_timestamp() - '00:15:00'::interval))) THEN 'failed'::text
                WHEN (( SELECT (residual_assay.reading ->> 'status'::text)
                   FROM residual_assay) = 'failed'::text) THEN 'failed'::text
                WHEN ((( SELECT (residual_assay.reading ->> 'status'::text)
                   FROM residual_assay) = 'passed'::text) AND (lr.last_status = 'succeeded'::text)) THEN 'passed'::text
                ELSE 'unknown'::text
            END
            WHEN (j.jobname = 'drain-vehicle-taxonomy'::text) THEN
            CASE
                WHEN ((lr.last_run_at IS NULL) OR (lr.last_run_at <= (statement_timestamp() - '00:15:00'::interval))) THEN 'failed'::text
                WHEN (( SELECT (taxonomy_assay.reading ->> 'status'::text)
                   FROM taxonomy_assay) = 'failed'::text) THEN 'failed'::text
                WHEN ((( SELECT (taxonomy_assay.reading ->> 'status'::text)
                   FROM taxonomy_assay) = 'passed'::text) AND (lr.last_status = 'succeeded'::text)) THEN 'passed'::text
                ELSE 'unknown'::text
            END
            WHEN (j.jobname = 'qualify-bat-archived-sales'::text) THEN
            CASE
                WHEN ((lr.last_run_at IS NULL) OR (lr.last_run_at <= (statement_timestamp() - '00:15:00'::interval))) THEN 'failed'::text
                WHEN (( SELECT (bat_sale_assay.reading ->> 'status'::text)
                   FROM bat_sale_assay) = 'failed'::text) THEN 'failed'::text
                WHEN ((( SELECT (bat_sale_assay.reading ->> 'status'::text)
                   FROM bat_sale_assay) = 'passed'::text) AND (lr.last_status = 'succeeded'::text)) THEN 'passed'::text
                ELSE 'unknown'::text
            END
            WHEN (j.jobname = 'project-retained-listing-properties'::text) THEN
            CASE
                WHEN ((lr.last_run_at IS NULL) OR (lr.last_run_at <= (statement_timestamp() - '00:05:00'::interval))) THEN 'failed'::text
                WHEN (( SELECT (retained_listing_assay.reading ->> 'status'::text)
                   FROM retained_listing_assay) = 'failed'::text) THEN 'failed'::text
                WHEN ((( SELECT (retained_listing_assay.reading ->> 'status'::text)
                   FROM retained_listing_assay) = 'passed'::text) AND (lr.last_status = 'succeeded'::text)) THEN 'passed'::text
                ELSE 'unknown'::text
            END
            WHEN (j.jobname = 'qualify-retained-vin-references'::text) THEN
            CASE
                WHEN ((lr.last_run_at IS NULL) OR (lr.last_run_at <= (statement_timestamp() - '00:30:00'::interval))) THEN 'failed'::text
                WHEN (( SELECT (vin_reference_assay.reading ->> 'status'::text)
                   FROM vin_reference_assay) = 'failed'::text) THEN 'failed'::text
                WHEN ((( SELECT (vin_reference_assay.reading ->> 'status'::text)
                   FROM vin_reference_assay) = 'passed'::text) AND (lr.last_status = 'succeeded'::text)) THEN 'passed'::text
                ELSE 'unknown'::text
            END
            WHEN (j.jobname = 'drain-vehicle-derived-queues'::text) THEN
            CASE
                WHEN ((lr.last_run_at IS NULL) OR (lr.last_run_at <= (statement_timestamp() - '00:15:00'::interval))) THEN 'failed'::text
                WHEN (( SELECT (metric_assay.reading ->> 'status'::text)
                   FROM metric_assay) = 'failed'::text) THEN 'failed'::text
                WHEN (( SELECT (metric_assay.reading ->> 'status'::text)
                   FROM metric_assay) = ANY (ARRAY['partial'::text, 'unavailable'::text])) THEN 'unknown'::text
                WHEN (lr.last_status <> 'succeeded'::text) THEN 'unknown'::text
                WHEN (( SELECT (metric_assay.reading ->> 'status'::text)
                   FROM metric_assay) = 'passed'::text) THEN 'passed'::text
                ELSE 'idle'::text
            END
            WHEN (lr.last_status = 'succeeded'::text) THEN 'passed'::text
            ELSE 'unknown'::text
        END AS health_status
   FROM ((((cron.job j
     LEFT JOIN day ON ((day.jobid = j.jobid)))
     LEFT JOIN streak s ON ((s.jobid = j.jobid)))
     LEFT JOIN last_run lr ON ((lr.jobid = j.jobid)))
     LEFT JOIN last_err le ON ((le.jobid = j.jobid)));
GRANT SELECT ON public.v_job_health TO service_role;

INSERT INTO cron.job (jobid, jobname, schedule, command, active) VALUES
  (1, 'job-failing-assay', '* * * * *', 'select 1', true),
  (2, 'job-stale-failed-assay', '* * * * *', 'select 1', true),
  (3, 'job-passing-assay', '* * * * *', 'select 1', true),
  (4, 'job-no-assay', '* * * * *', 'select 1', true),
  (5, 'job-paused', '* * * * *', 'select 1', false),
  (6, 'job-run-failed', '* * * * *', 'select 1', true),
  (7, 'bat-live-pull', '* * * * *', 'select 1', true),
  (8, 'job-assay-no-status', '* * * * *', 'select 1', true);
INSERT INTO cron.job_run_details (runid, jobid, status, start_time, end_time, return_message)
SELECT j.jobid, j.jobid, CASE WHEN j.jobid = 6 THEN 'failed' ELSE 'succeeded' END, now() - interval '30 seconds',
       now() - interval '29 seconds', CASE WHEN j.jobid = 6 THEN 'boom' END
  FROM cron.job j;
INSERT INTO public.job_assay_readings (jobname, reading, assayed_at, fresh_for) VALUES
  ('job-failing-assay', '{"status": "failed"}', now() - interval '1 minute', interval '15 minutes'),
  ('job-stale-failed-assay', '{"status": "failed"}', now() - interval '1 hour', interval '15 minutes'),
  ('job-passing-assay', '{"status": "passed"}', now() - interval '1 minute', interval '15 minutes'),
  ('job-paused', '{"status": "failed"}', now() - interval '1 minute', interval '15 minutes'),
  ('job-run-failed', '{"status": "passed"}', now() - interval '1 minute', interval '15 minutes'),
  ('bat-live-pull', '{"status": "passed"}', now() - interval '1 minute', interval '15 minutes'),
  ('job-assay-no-status', '{"rows": 3}', now() - interval '1 minute', interval '15 minutes');

CREATE TEMP TABLE before AS SELECT * FROM public.v_job_health;

-- A drifted anchor stops the migration and leaves the view as it was (the ERROR lines psql prints here are expected).
CREATE TEMP TABLE saved_def AS SELECT pg_get_viewdef('public.v_job_health'::regclass) AS d;
DO $$ BEGIN
  EXECUTE 'CREATE OR REPLACE VIEW public.v_job_health AS '
    || replace((SELECT d FROM saved_def), 'ELSE ''unknown''::text' || chr(10) || '        END AS health_status', 'ELSE ''idle''::text END AS health_status');
  IF pg_get_viewdef('public.v_job_health'::regclass) = (SELECT d FROM saved_def) THEN RAISE EXCEPTION 'drift fixture did not drift'; END IF;
END $$;
\set ON_ERROR_STOP off
\ir ../migrations/20261126114500_job_health_worst_of_run_and_assay.sql
\set ON_ERROR_STOP on
ROLLBACK;
DO $$ BEGIN
  IF pg_get_viewdef('public.v_job_health'::regclass) ~ 'own_fail' THEN RAISE EXCEPTION 'drifted anchor: view was patched'; END IF;
  EXECUTE 'CREATE OR REPLACE VIEW public.v_job_health AS ' || (SELECT d FROM saved_def);
END $$;

\ir ../migrations/20261126114500_job_health_worst_of_run_and_assay.sql
\ir ../migrations/20261126114500_job_health_worst_of_run_and_assay.sql

DO $$
DECLARE r record; want jsonb := '{"job-failing-assay": "failed", "job-stale-failed-assay": "passed", "job-passing-assay": "passed",
  "job-no-assay": "passed", "job-paused": "paused", "job-run-failed": "failed", "bat-live-pull": "passed",
  "job-assay-no-status": "passed"}';
BEGIN
  FOR r IN SELECT jobname, health_status FROM public.v_job_health LOOP
    IF r.health_status IS DISTINCT FROM want ->> r.jobname THEN
      RAISE EXCEPTION '%: health_status % (want %)', r.jobname, r.health_status, want ->> r.jobname;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM public.v_job_health) <> 8 THEN RAISE EXCEPTION 'row count'; END IF;
  -- before the migration the failing assay read passed: this is the change
  IF (SELECT health_status FROM before WHERE jobname = 'job-failing-assay') <> 'passed' THEN RAISE EXCEPTION 'before: expected passed'; END IF;
  -- every other column and row is unchanged
  IF EXISTS (SELECT jobid, jobname, schedule, active, runs_24h, failed_24h, consecutive_failures, last_status, last_run_at,
                    last_error, declared_writer, command, assay_status, assay::text FROM before
             EXCEPT SELECT jobid, jobname, schedule, active, runs_24h, failed_24h, consecutive_failures, last_status, last_run_at,
                    last_error, declared_writer, command, assay_status, assay::text FROM public.v_job_health) THEN
    RAISE EXCEPTION 'other columns changed';
  END IF;
  IF EXISTS (SELECT jobname, health_status FROM before WHERE jobname <> 'job-failing-assay'
             EXCEPT SELECT jobname, health_status FROM public.v_job_health) THEN
    RAISE EXCEPTION 'another job changed colour';
  END IF;
  IF (SELECT count(*) FROM regexp_matches(pg_get_viewdef('public.v_job_health'::regclass), 'own_fail\.assayed_at', 'g')) <> 1 THEN
    RAISE EXCEPTION 're-apply added the arm twice';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.v_job_health', 'SELECT') THEN RAISE EXCEPTION 'grant lost'; END IF;
END $$;
-- The stale row turns failed once refreshed, and back to passed when its assay passes.
UPDATE public.job_assay_readings SET assayed_at = now() WHERE jobname = 'job-stale-failed-assay';
DO $$ BEGIN
  IF (SELECT health_status FROM public.v_job_health WHERE jobname = 'job-stale-failed-assay') <> 'failed' THEN RAISE EXCEPTION 'refreshed failed assay'; END IF;
END $$;
UPDATE public.job_assay_readings SET reading = '{"status": "passed"}' WHERE jobname = 'job-stale-failed-assay';
DO $$ BEGIN
  IF (SELECT health_status FROM public.v_job_health WHERE jobname = 'job-stale-failed-assay') <> 'passed' THEN RAISE EXCEPTION 'recovered assay'; END IF;
END $$;
\echo 'test_job_health_worst_of_run_and_assay: ok'
