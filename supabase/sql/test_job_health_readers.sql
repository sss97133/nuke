\set ON_ERROR_STOP on
-- PostgreSQL 17 contract for 20261014090000_job_health_run_digest_and_assay_readings.sql.
-- Builds pg_cron's two tables as prod has them (owned by the superuser, SELECT for the deploy role, no cron schema
-- for service_role), installs the live v_job_health and get_live_auction_health definitions of 2026-10-14
-- (supabase/sql/helpers/*_live_20261014.sql) over stub assays, keeps a copy of each as the reference, applies the
-- migration as a non-superuser deploy role, then proves:
--   1. v_job_health returns exactly the live definition's rows and columns with the digest as the migration leaves it,
--      empty, fresh, stale with a live tail, with an open run, a run open for over an hour and an inverted start_time;
--   2. stored readings are used inside fresh_for, the assay runs live past it or when nothing is stored;
--   3. refresh_job_health() mirrors the run log, re-reads open runs, trims below 8 days, honours cadence and budget,
--      and keeps the previous reading when an assay raises;
--   4. get_live_auction_health(date) equals the live definition (cron_status by runid), with the one documented
--      difference for a run that never started;
--   5. grants, RLS, READ ONLY reads as service_role, the schedule, registry rows and the unchanged column list.
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' THEN RAISE EXCEPTION 'disposable dm_refinement_* database required'; END IF;
END $$;

DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('CREATE ROLE %I NOLOGIN', r); END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dm_contract_deployer') THEN CREATE ROLE dm_contract_deployer NOLOGIN; END IF;
END $$;
GRANT CREATE ON SCHEMA public TO dm_contract_deployer;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- pg_cron, owned by the superuser as supabase_admin owns it on prod ------------------------------------------------------
CREATE SCHEMA cron;
CREATE TABLE cron.job (
  jobid bigserial PRIMARY KEY, schedule text NOT NULL, command text NOT NULL, nodename text NOT NULL DEFAULT 'localhost',
  nodeport integer NOT NULL DEFAULT 5432, database text NOT NULL DEFAULT current_database(),
  username text NOT NULL DEFAULT current_user, active boolean NOT NULL DEFAULT true, jobname text);
CREATE TABLE cron.job_run_details (
  jobid bigint, runid bigint PRIMARY KEY, job_pid integer, database text, username text, command text, status text,
  return_message text, start_time timestamptz, end_time timestamptz);
CREATE FUNCTION cron.schedule(job_name text, schedule text, command text) RETURNS bigint
LANGUAGE sql SECURITY DEFINER AS
$$ INSERT INTO cron.job (jobname, schedule, command) VALUES (job_name, schedule, command) RETURNING jobid $$;
GRANT USAGE ON SCHEMA cron TO dm_contract_deployer;
GRANT SELECT ON cron.job, cron.job_run_details TO dm_contract_deployer;
GRANT EXECUTE ON FUNCTION cron.schedule(text, text, text) TO dm_contract_deployer;

INSERT INTO cron.job (jobid, jobname, schedule, command, active) VALUES
  (501, 'steady', '*/30 * * * *', 'SELECT 1', true),
  (502, 'failing-tail', '13 * * * *', $c$SELECT set_config('app.writer', 'tail_writer', true), public.tail()$c$, true),
  (503, 'always-failing', '17 */2 * * *', 'SELECT 1/0', true),
  (504, 'paused-recent', '0 0 * * *', 'SELECT 2', false),
  (505, 'paused-old', '0 0 * * *', 'SELECT 3', false),
  (506, 'never-ran', '0 0 1 1 *', 'SELECT 4', true),
  (507, 'long-runner', '*/10 * * * *', 'SELECT pg_sleep(1)', true),
  (508, 'hung', '0 */6 * * *', 'SELECT 5', true),
  (509, 'connect-fail', '0 */12 * * *', 'SELECT 6', true),
  (511, 'inverted', '0 * * * *', 'SELECT 7', true),
  (510, 'bat-live-pull', '* * * * *', 'SELECT public.bat_live_pull_run(3)', true),
  (500, 'drain-vehicle-derived-queues', '*/2 * * * *', 'SELECT 8', true),
  (513, 'drain-sale-residual-fold', '*/5 * * * *', 'SELECT 9', true),
  (514, 'drain-vehicle-taxonomy', '* * * * *', 'SELECT 10', true),
  (515, 'qualify-bat-archived-sales', '* * * * *', 'SELECT 11', true),
  (516, 'qualify-retained-vin-references', '* * * * *', 'SELECT 12', true),
  (517, 'project-retained-listing-properties', '* * * * *', 'SELECT 13', true);

-- Runs: runid follows the order pg_cron hands them out (seq), start_time stays NULL for runs that never started.
CREATE TEMP TABLE fixture_runs (jobid bigint, status text, start_time timestamptz, return_message text, seq timestamptz);
INSERT INTO fixture_runs
SELECT 501, 'succeeded', now() - interval '9 days' + interval '7 minutes' + k * interval '30 minutes', '1 row', NULL
  FROM generate_series(0, 430) k;
INSERT INTO fixture_runs
SELECT 502, CASE WHEN k >= 213 THEN 'failed' ELSE 'succeeded' END,
       now() - interval '9 days' + interval '13 minutes' + k * interval '1 hour',
       CASE WHEN k >= 213 THEN 'ERROR:  tail failure ' || k || ' ' || repeat('x', 400) ELSE 'SET' END, NULL
  FROM generate_series(0, 215) k;
INSERT INTO fixture_runs VALUES (503, 'succeeded', now() - interval '7 days 11 hours', 'ok', NULL);
INSERT INTO fixture_runs
SELECT 503, 'failed', now() - interval '3 days' + interval '17 minutes' + k * interval '2 hours', 'ERROR:  division by zero', NULL
  FROM generate_series(0, 35) k;
INSERT INTO fixture_runs VALUES
  (504, 'succeeded', now() - interval '3 days 5 hours', 'ok', NULL),
  (505, 'succeeded', now() - interval '7 days 12 hours', 'ok', NULL),
  (508, 'running', now() - interval '2 hours 10 minutes', NULL, NULL),
  (509, 'succeeded', now() - interval '2 days', 'ok', NULL),
  (509, 'failed', NULL, 'connection failed', now() - interval '1 day'),
  (511, 'succeeded', now() - interval '5 hours', 'first', now() - interval '5 hours'),
  (511, 'succeeded', now() - interval '5 hours 10 seconds', 'second, earlier clock', now() - interval '4 hours 59 minutes'),
  (514, 'starting', NULL, NULL, now() - interval '5 seconds'),
  (507, 'running', now() - interval '30 seconds', NULL, NULL);
INSERT INTO fixture_runs
SELECT 507, 'succeeded', now() - interval '2 hours' + k * interval '10 minutes', 'ok', NULL FROM generate_series(0, 11) k;
INSERT INTO fixture_runs
SELECT 510, 'succeeded', now() - k * interval '1 minute' - interval '20 seconds', '1 row', NULL FROM generate_series(1, 30) k;
INSERT INTO fixture_runs
SELECT 500, 'succeeded', now() - k * interval '2 minutes' - interval '20 seconds', '1 row', NULL FROM generate_series(1, 10) k;
INSERT INTO fixture_runs
SELECT 513, 'succeeded', now() - k * interval '5 minutes' - interval '20 seconds', '1 row', NULL FROM generate_series(1, 6) k;
INSERT INTO fixture_runs
SELECT j, 'succeeded', now() - k * interval '1 minute' - interval '20 seconds', '1 row', NULL
  FROM generate_series(1, 10) k, unnest(ARRAY[514, 515, 516, 517]) j;
INSERT INTO cron.job_run_details (jobid, runid, job_pid, database, username, command, status, return_message, start_time, end_time)
SELECT f.jobid, 100000 + row_number() OVER (ORDER BY coalesce(f.seq, f.start_time), f.jobid), 1, current_database(), 'postgres',
       j.command, f.status, f.return_message, f.start_time,
       CASE WHEN f.status IN ('succeeded', 'failed') THEN f.start_time + interval '1 second' END
  FROM fixture_runs f JOIN cron.job j USING (jobid);

-- What the deploy role owns on prod: the readers' inputs, the stub assays and the live definitions ------------------------
SET ROLE dm_contract_deployer;
CREATE TYPE public.observation_kind AS ENUM ('listing', 'comment', 'bid', 'sale_result');
CREATE TABLE public.live_auction_sources (id uuid PRIMARY KEY, slug text UNIQUE, is_active boolean DEFAULT true, health_status text);
CREATE TABLE public.monitored_auctions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_id uuid, external_auction_url text, vehicle_id uuid,
  auction_end_time timestamptz, is_live boolean, current_bid_cents bigint, bid_count integer,
  is_in_soft_close boolean DEFAULT false, next_poll_at timestamptz, updated_at timestamptz DEFAULT now(), stream_state jsonb);
CREATE TABLE public.vehicle_events (vehicle_id uuid, source_platform text, event_type text, source_url text, ended_at timestamptz);
CREATE TABLE public.auction_events (vehicle_id uuid, source text, source_url text, outcome text, auction_end_date timestamptz);
CREATE TABLE public.vehicle_observations (
  id uuid PRIMARY KEY, vehicle_id uuid, source_url text, kind public.observation_kind, extraction_method text,
  structured_data jsonb, observed_at timestamptz, ingested_at timestamptz);
CREATE TABLE public.pipeline_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), table_name text NOT NULL, column_name text, owned_by text NOT NULL,
  description text NOT NULL, do_not_write_directly boolean NOT NULL DEFAULT false, write_via text);
GRANT SELECT ON ALL TABLES IN SCHEMA public TO service_role;
INSERT INTO public.live_auction_sources VALUES ('00000000-0000-0000-0000-00000000000b', 'bat', true, 'healthy');
INSERT INTO public.monitored_auctions (source_id, external_auction_url, vehicle_id, auction_end_time, is_live, current_bid_cents,
  bid_count, next_poll_at, stream_state)
VALUES ('00000000-0000-0000-0000-00000000000b', 'https://bringatrailer.com/listing/contract-lot', '00000000-0000-0000-0000-0000000000a1',
  now() + interval '10 minutes', true, 1500000, 12, now(),
  jsonb_build_object('sessions', jsonb_build_object('s1', jsonb_build_object('connected', true, 'at', now() + interval '1 hour', 'pending', 0))));

-- Stub assays: the live reading of each comes from contract_assay_live; {"raise": true} makes it raise.
CREATE TABLE public.contract_assay_live (fn text PRIMARY KEY, reading jsonb);
GRANT SELECT ON public.contract_assay_live TO service_role;
INSERT INTO public.contract_assay_live VALUES
  ('bat', '{"status": "passed", "source": "live", "counts": {"pending": 0}}'),
  ('retained', '{"status": "passed", "source": "live", "due": 0}'),
  ('vin', '{"status": "partial", "source": "live"}'),
  ('taxonomy', '{"status": "passed", "source": "live"}'),
  ('residual', '{"status": "passed", "source": "live"}'),
  ('metric', '{"status": "passed", "source": "live"}');
CREATE FUNCTION public.contract_assay(p_fn text) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE v jsonb;
BEGIN
  SELECT c.reading INTO v FROM public.contract_assay_live c WHERE c.fn = p_fn;
  IF v ? 'raise' THEN RAISE EXCEPTION 'contract assay % raised', p_fn; END IF;
  RETURN v;
END $$;
CREATE FUNCTION public.assay_bat_sale_intake() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT public.contract_assay('bat') $$;
CREATE FUNCTION public.assay_retained_listing_properties() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT public.contract_assay('retained') $$;
CREATE FUNCTION public.assay_vin_reference_intake() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT public.contract_assay('vin') $$;
CREATE FUNCTION public.assay_vehicle_taxonomy_fold() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT public.contract_assay('taxonomy') $$;
CREATE FUNCTION public.assay_sale_residual_fold() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT public.contract_assay('residual') $$;
CREATE FUNCTION public.assay_vehicle_metric_fold() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT public.contract_assay('metric') $$;

\ir helpers/get_live_auction_health_live_20261014.sql
\ir helpers/v_job_health_live_20261014.sql
REVOKE ALL ON public.v_job_health FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_job_health TO service_role;

-- References: the live definitions under other names, taken before the migration replaces them.
SELECT format('CREATE VIEW public.v_job_health_reference AS %s', pg_get_viewdef('public.v_job_health'::regclass, true)) \gexec
SELECT replace(pg_get_functiondef('public.get_live_auction_health(date)'::regprocedure),
  'FUNCTION public.get_live_auction_health(p_day date)', 'FUNCTION public.contract_auction_health_reference(p_day date)') \gexec
GRANT SELECT ON public.v_job_health_reference TO service_role;

DO $$ BEGIN
  IF encode(sha256(convert_to(pg_get_viewdef('public.v_job_health'::regclass, true), 'UTF8')), 'base64')
       <> 'p+lMNHgRes+KIBCvLHpCkhx54qYexyu7DjDOeeSVwxw='
     OR encode(sha256(convert_to(pg_get_functiondef('public.get_live_auction_health(date)'::regprocedure), 'UTF8')), 'base64')
       <> 'vexAqbXh+D0e+xUoPin84xWhsEAww/HJdjkJSoo+m50=' THEN
    RAISE EXCEPTION 'fixture definitions do not reproduce the prod hashes of 2026-10-14';
  END IF;
END $$;

-- The migration, as the deploy role ------------------------------------------------------------------------------------
\ir ../migrations/20261014090000_job_health_run_digest_and_assay_readings.sql
RESET ROLE;

-- Assertion helpers ------------------------------------------------------------------------------------------------------
CREATE FUNCTION pg_temp.assert_same(p_label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE n_new bigint; n_ref bigint; n_rows bigint;
BEGIN
  SELECT count(*) INTO n_new FROM (SELECT * FROM public.v_job_health EXCEPT ALL SELECT * FROM public.v_job_health_reference) x;
  SELECT count(*) INTO n_ref FROM (SELECT * FROM public.v_job_health_reference EXCEPT ALL SELECT * FROM public.v_job_health) x;
  SELECT count(*) INTO n_rows FROM public.v_job_health;
  IF n_new <> 0 OR n_ref <> 0 OR n_rows < 17 THEN
    RAISE EXCEPTION '%: v_job_health differs from the live definition (% new-only, % live-only, % rows)', p_label, n_new, n_ref, n_rows;
  END IF;
END $$;
CREATE FUNCTION pg_temp.assert_digest_mirrors(p_label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM (
    (SELECT runid, jobid, status, start_time, CASE WHEN status = 'failed' THEN left(return_message, 300) END
       FROM cron.job_run_details WHERE runid >= (SELECT min(runid) FROM public.cron_run_digest)
     EXCEPT SELECT runid, jobid, status, start_time, error_head FROM public.cron_run_digest)
    UNION ALL
    (SELECT runid, jobid, status, start_time, error_head FROM public.cron_run_digest
     EXCEPT SELECT runid, jobid, status, start_time, CASE WHEN status = 'failed' THEN left(return_message, 300) END
       FROM cron.job_run_details)) x;
  IF n <> 0 THEN RAISE EXCEPTION '%: cron_run_digest differs from cron.job_run_details in % rows', p_label, n; END IF;
  IF EXISTS (SELECT 1 FROM public.cron_run_digest WHERE start_time <= now() - interval '8 days') THEN
    RAISE EXCEPTION '%: cron_run_digest kept a run older than 8 days', p_label;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cron_run_digest d JOIN cron.job j USING (jobid) WHERE j.jobname = 'paused-old') THEN
    RAISE EXCEPTION '%: cron_run_digest lost a run inside 8 days', p_label;
  END IF;
END $$;

-- 1. Runs: the same rows as the live definition in every digest state ----------------------------------------------------
SELECT pg_temp.assert_digest_mirrors('after migration');
SELECT pg_temp.assert_same('after migration');
DO $$ BEGIN
  IF (SELECT consecutive_failures FROM public.v_job_health WHERE jobname = 'failing-tail') <> 3
     OR (SELECT consecutive_failures FROM public.v_job_health WHERE jobname = 'always-failing') <> 36
     OR (SELECT last_status FROM public.v_job_health WHERE jobname = 'paused-old') IS NOT NULL
     OR (SELECT last_status FROM public.v_job_health WHERE jobname = 'long-runner') <> 'running'
     OR (SELECT length(last_error) FROM public.v_job_health WHERE jobname = 'failing-tail') <> 300
     OR (SELECT declared_writer FROM public.v_job_health WHERE jobname = 'failing-tail') <> 'tail_writer' THEN
    RAISE EXCEPTION 'fixture does not exercise streaks, the 7-day edge, open runs, error heads and writers';
  END IF;
END $$;

TRUNCATE public.cron_run_digest;
SELECT pg_temp.assert_same('empty digest');
DO $$ BEGIN
  IF public.job_health_live_from() <> 0 THEN RAISE EXCEPTION 'empty digest must read the run log from runid 0'; END IF;
END $$;

SELECT public.refresh_job_health(p_assays := false);
SELECT pg_temp.assert_digest_mirrors('refilled');
SELECT pg_temp.assert_same('refilled');
DO $$ BEGIN
  IF public.job_health_live_from() <> (SELECT min(runid) FROM public.cron_run_digest
                                       WHERE status NOT IN ('succeeded', 'failed')) THEN
    RAISE EXCEPTION 'live mark must hold at the oldest open run';
  END IF;
END $$;

-- Stale digest: new runs, a finished open run and a new failure arrive without a refresh.
UPDATE cron.job_run_details SET status = 'succeeded', return_message = 'done', end_time = now()
 WHERE jobid = 507 AND status = 'running';
UPDATE cron.job_run_details SET status = 'running', start_time = now() - interval '1 second' WHERE jobid = 514 AND status = 'starting';
INSERT INTO cron.job_run_details (jobid, runid, status, return_message, start_time, end_time)
SELECT v.jobid, (SELECT max(runid) FROM cron.job_run_details) + v.n, v.status, v.msg, now() - interval '2 seconds', now()
  FROM (VALUES (501, 1, 'succeeded', '1 row'), (502, 2, 'failed', 'ERROR:  newest failure'), (504, 3, 'succeeded', 'ok')) v(jobid, n, status, msg);
SELECT pg_temp.assert_same('stale digest with a live tail');

-- A run open for more than an hour stops holding the mark and is re-read by runid; then it finishes.
UPDATE public.cron_run_digest SET first_seen_at = now() - interval '2 hours'
 WHERE runid = (SELECT runid FROM cron.job_run_details WHERE jobid = 508);
DO $$ BEGIN
  IF public.job_health_live_from() <= (SELECT runid FROM cron.job_run_details WHERE jobid = 508) THEN
    RAISE EXCEPTION 'a run open for over an hour must not hold the live mark';
  END IF;
END $$;
UPDATE cron.job_run_details SET status = 'failed', return_message = 'ERROR:  hung run gave up', end_time = now() WHERE jobid = 508;
SELECT pg_temp.assert_same('old open run re-read by runid');
DO $$ DECLARE r jsonb; BEGIN
  r := public.refresh_job_health(p_assays := false);
  IF (r->>'reread')::int < 1 THEN RAISE EXCEPTION 'refresh must re-read the old open run: %', r; END IF;
END $$;
SELECT pg_temp.assert_digest_mirrors('after the tail');
SELECT pg_temp.assert_same('after the tail');

-- Documented difference: a run deleted from the run log after it was copied stays in the window.
CREATE TEMP TABLE parked AS SELECT * FROM cron.job_run_details WHERE jobid = 504 AND start_time < now() - interval '1 day';
DELETE FROM cron.job_run_details WHERE jobid = 504 AND start_time < now() - interval '1 day';
DO $$ BEGIN
  IF (SELECT runs_24h FROM public.v_job_health WHERE jobname = 'paused-recent')
     IS DISTINCT FROM (SELECT runs_24h FROM public.v_job_health_reference WHERE jobname = 'paused-recent')
     OR NOT EXISTS (SELECT 1 FROM public.cron_run_digest d JOIN parked p USING (runid)) THEN
    RAISE EXCEPTION 'deleted-run behaviour changed';
  END IF;
END $$;
INSERT INTO cron.job_run_details SELECT * FROM parked;
SELECT pg_temp.assert_same('restored');

-- 2. Stored readings: used inside fresh_for, live past it ----------------------------------------------------------------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.job_assay_readings WHERE assayed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'the migration must not run assays';
  END IF;
  IF (SELECT assay->>'source' FROM public.v_job_health WHERE jobname = 'qualify-bat-archived-sales') <> 'live' THEN
    RAISE EXCEPTION 'no stored reading must run the assay live';
  END IF;
END $$;
UPDATE public.job_assay_readings
   SET reading = '{"status": "failed", "source": "stored"}', assayed_at = now() - interval '1 minute', elapsed_ms = 5,
       attempted_at = now() - interval '1 minute'
 WHERE jobname IN ('qualify-bat-archived-sales', 'drain-vehicle-derived-queues', 'bat-live-pull');
DO $$ BEGIN
  IF (SELECT assay->>'source' FROM public.v_job_health WHERE jobname = 'qualify-bat-archived-sales') <> 'stored'
     OR (SELECT assay_status FROM public.v_job_health WHERE jobname = 'qualify-bat-archived-sales') <> 'failed'
     OR (SELECT health_status FROM public.v_job_health WHERE jobname = 'qualify-bat-archived-sales') <> 'failed'
     OR (SELECT health_status FROM public.v_job_health WHERE jobname = 'drain-vehicle-derived-queues') <> 'failed'
     OR (SELECT assay->>'source' FROM public.v_job_health WHERE jobname = 'bat-live-pull') <> 'stored'
     OR (SELECT health_status FROM public.v_job_health WHERE jobname = 'bat-live-pull') <> 'failed' THEN
    RAISE EXCEPTION 'a fresh stored reading must drive assay, assay_status and health_status';
  END IF;
END $$;
UPDATE public.job_assay_readings SET assayed_at = now() - fresh_for - interval '1 second'
 WHERE jobname IN ('qualify-bat-archived-sales', 'drain-vehicle-derived-queues', 'bat-live-pull');
DO $$ BEGIN
  IF (SELECT assay->>'source' FROM public.v_job_health WHERE jobname = 'qualify-bat-archived-sales') <> 'live'
     OR (SELECT assay->>'source' FROM public.v_job_health WHERE jobname = 'drain-vehicle-derived-queues') <> 'live'
     OR (SELECT assay ? 'source' FROM public.v_job_health WHERE jobname = 'bat-live-pull') THEN
    RAISE EXCEPTION 'a reading older than fresh_for must be replaced by the live assay';
  END IF;
END $$;
SELECT pg_temp.assert_same('stale readings run live');

-- 3. The writer: all due assays, then nothing until the cadence, a raising assay, the budget -----------------------------
UPDATE public.job_assay_readings SET reading = NULL, assayed_at = NULL, elapsed_ms = NULL, attempted_at = NULL;
BEGIN;
DO $$ DECLARE r jsonb; BEGIN
  r := public.refresh_job_health();
  IF jsonb_array_length(r->'assays') <> 5 OR r->'assays'->0->>'jobname' <> 'bat-live-pull' THEN
    RAISE EXCEPTION 'all five assays are due, the closing stream first: %', r;
  END IF;
END $$;
SELECT pg_temp.assert_same('stored readings equal live readings');
COMMIT;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.job_assay_readings WHERE assayed_at IS NULL OR elapsed_ms < 0 OR attempt_error IS NOT NULL)
     OR (SELECT reading FROM public.job_assay_readings WHERE jobname = 'project-retained-listing-properties')
        <> public.assay_retained_listing_properties() THEN
    RAISE EXCEPTION 'refresh must store every reading with its clock';
  END IF;
  IF jsonb_array_length(public.refresh_job_health()->'assays') <> 0 THEN
    RAISE EXCEPTION 'nothing is due right after a refresh';
  END IF;
END $$;
UPDATE public.contract_assay_live SET reading = '{"raise": true}' WHERE fn = 'bat';
UPDATE public.job_assay_readings SET attempted_at = now() - interval '15 minutes' WHERE jobname = 'qualify-bat-archived-sales';
DO $$ DECLARE r jsonb; kept jsonb; BEGIN
  SELECT reading INTO kept FROM public.job_assay_readings WHERE jobname = 'qualify-bat-archived-sales';
  r := public.refresh_job_health();
  IF jsonb_array_length(r->'assays') <> 1 OR r->'assays'->0->>'sqlstate' <> 'P0001'
     OR (SELECT attempt_error FROM public.job_assay_readings WHERE jobname = 'qualify-bat-archived-sales') <> 'P0001'
     OR (SELECT reading FROM public.job_assay_readings WHERE jobname = 'qualify-bat-archived-sales') <> kept THEN
    RAISE EXCEPTION 'a raising assay must keep the previous reading and record its SQLSTATE: %', r;
  END IF;
  IF jsonb_array_length(public.refresh_job_health()->'assays') <> 0 THEN
    RAISE EXCEPTION 'a failed attempt waits for the cadence';
  END IF;
END $$;
UPDATE public.contract_assay_live SET reading = '{"status": "passed", "source": "live", "counts": {"pending": 0}}' WHERE fn = 'bat';
UPDATE public.job_assay_readings SET attempted_at = now() - interval '1 hour';
DO $$ BEGIN
  IF jsonb_array_length(public.refresh_job_health(p_assay_budget := interval '0 seconds')->'assays') <> 0 THEN
    RAISE EXCEPTION 'no assay may start after the budget';
  END IF;
END $$;

-- 4. get_live_auction_health(date): the live reading, cron_status by runid ----------------------------------------------
DO $$ DECLARE d date := (now() AT TIME ZONE 'America/Los_Angeles')::date; BEGIN
  IF public.get_live_auction_health(d) <> public.contract_auction_health_reference(d)
     OR public.get_live_auction_health()->'cron_status'->>'last_status' <> 'succeeded' THEN
    RAISE EXCEPTION 'get_live_auction_health(date) must equal the live definition';
  END IF;
END $$;
INSERT INTO cron.job_run_details (jobid, runid, status, return_message) VALUES (510, 99999, 'failed', 'server restarted');
DO $$ DECLARE d date := (now() AT TIME ZONE 'America/Los_Angeles')::date; BEGIN
  IF public.contract_auction_health_reference(d)->'cron_status'->>'last_run' IS NOT NULL
     OR public.get_live_auction_health(d)->'cron_status'->>'last_status' <> 'succeeded' THEN
    RAISE EXCEPTION 'documented difference: a never-started run no longer shadows the newest run';
  END IF;
END $$;
DELETE FROM cron.job_run_details WHERE runid = 99999;

-- 5. Grants, RLS, READ ONLY readers, the schedule, registry rows, columns ------------------------------------------------
UPDATE public.job_assay_readings SET assayed_at = now() - fresh_for - interval '1 second';
BEGIN READ ONLY;
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_same('service_role, read only, assays live');
COMMIT;
UPDATE public.job_assay_readings SET assayed_at = now();
BEGIN READ ONLY;
SET LOCAL ROLE service_role;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.cron_run_digest) = 0 OR (SELECT count(*) FROM public.job_assay_readings) <> 5
     OR (SELECT assay FROM public.v_job_health WHERE jobname = 'bat-live-pull')
        IS DISTINCT FROM (SELECT reading FROM public.job_assay_readings WHERE jobname = 'bat-live-pull')
     OR (SELECT count(*) FROM public.v_job_health) <> (SELECT count(*) FROM public.v_job_health_reference) THEN
    RAISE EXCEPTION 'service_role must read both tables and the stored readings through the view';
  END IF;
END $$;
COMMIT;
DO $$ BEGIN
  IF has_function_privilege('service_role', 'public.refresh_job_health(boolean,interval)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.refresh_job_health(boolean,interval)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.job_health_live_from()', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.job_health_live_from()', 'EXECUTE')
     OR has_table_privilege('anon', 'public.v_job_health', 'SELECT')
     OR has_table_privilege('authenticated', 'public.cron_run_digest', 'SELECT')
     OR has_table_privilege('anon', 'public.job_assay_readings', 'SELECT')
     OR has_table_privilege('service_role', 'public.cron_run_digest', 'INSERT')
     OR has_table_privilege('service_role', 'public.job_assay_readings', 'UPDATE')
     OR NOT has_table_privilege('service_role', 'public.v_job_health', 'SELECT') THEN
    RAISE EXCEPTION 'grants are wrong';
  END IF;
  IF (SELECT count(*) FROM pg_class WHERE oid IN ('public.cron_run_digest'::regclass, 'public.job_assay_readings'::regclass)
       AND relrowsecurity) <> 2 THEN
    RAISE EXCEPTION 'RLS must be on for both tables';
  END IF;
  IF pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid = 'public.v_job_health'::regclass)) <> 'dm_contract_deployer' THEN
    RAISE EXCEPTION 'v_job_health owner changed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-job-health' AND schedule = '*/5 * * * *' AND active
                   AND command = $c$SET statement_timeout = '120s'; SELECT public.refresh_job_health();$c$) THEN
    RAISE EXCEPTION 'refresh-job-health must run every 5 minutes with a 120 s budget';
  END IF;
  IF (SELECT count(*) FROM public.pipeline_registry WHERE owned_by = 'refresh_job_health' AND do_not_write_directly
       AND table_name IN ('cron_run_digest', 'job_assay_readings') AND column_name IS NULL) <> 2 THEN
    RAISE EXCEPTION 'registry rows missing';
  END IF;
  IF (SELECT string_agg(attname || ':' || format_type(atttypid, atttypmod), ',' ORDER BY attnum) FROM pg_attribute
       WHERE attrelid = 'public.v_job_health'::regclass AND attnum > 0)
     IS DISTINCT FROM (SELECT string_agg(attname || ':' || format_type(atttypid, atttypmod), ',' ORDER BY attnum) FROM pg_attribute
       WHERE attrelid = 'public.v_job_health_reference'::regclass AND attnum > 0) THEN
    RAISE EXCEPTION 'v_job_health columns changed';
  END IF;
  IF obj_description('public.cron_run_digest'::regclass, 'pg_class') IS NULL
     OR (SELECT count(*) FROM pg_attribute a WHERE a.attrelid IN ('public.cron_run_digest'::regclass, 'public.job_assay_readings'::regclass)
          AND a.attnum > 0 AND NOT a.attisdropped AND col_description(a.attrelid, a.attnum) IS NULL) <> 0 THEN
    RAISE EXCEPTION 'every new table and column carries a description';
  END IF;
END $$;

SELECT 'job health readers contract passed' AS result;
