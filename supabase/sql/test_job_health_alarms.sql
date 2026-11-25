-- Disposable PG17: job_health_alarms_v1 (migration 20261125090700). Covers: a failed stored assay reading opens one
-- episode, later failed readings extend it, a passing reading clears it; the flow rule (2 h window, 1 h
-- settle, 20 ended, 0.25 share) fails when the sold share of ended lots is below 0.25 (all-zero and partial), passes at
-- or above it, is idle below 20 ended; the alarm reader returns an episode only past its job's alarm_after and only the
-- rule's report_keys;
-- the migration runs twice; anon and authenticated cannot read or execute. Synthetic fixtures only.
-- Run from the repo root in an empty database named dm_refinement_<name>.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' OR to_regclass('public.job_assay_readings') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable dm_refinement_* database';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;

CREATE FUNCTION public.assert_true(c boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF c IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', msg; END IF; END $$;
-- Live shapes (2026-11-25), columns the migration reads.
CREATE TABLE public.job_assay_readings (
  jobname text PRIMARY KEY, reading jsonb, assayed_at timestamptz, elapsed_ms integer, attempted_at timestamptz,
  attempt_error text, refresh_every interval NOT NULL DEFAULT '5 minutes', fresh_for interval NOT NULL DEFAULT '15 minutes');
CREATE TABLE public.live_auction_sources (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text UNIQUE);
-- guardrail-allow(center-key-fk): monitored_auctions: disposable fixture with the live columns the folds read
CREATE TABLE public.monitored_auctions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_id uuid REFERENCES public.live_auction_sources,
  auction_end_time timestamptz, is_live boolean, vehicle_id uuid, external_auction_url text);
-- guardrail-allow(center-key-fk): auction_events: disposable fixture with the live columns the folds read
CREATE TABLE public.auction_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source text, outcome text,
  auction_end_date timestamptz, vehicle_id uuid, source_url text);
-- pg_cron, stubbed with its live columns: jobs, run details, schedule.
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text, command text, active boolean NOT NULL DEFAULT true);
CREATE TABLE cron.job_run_details (runid bigserial PRIMARY KEY, jobid bigint, status text, start_time timestamptz, end_time timestamptz);
CREATE FUNCTION cron.schedule(n text, sch text, cmd text) RETURNS bigint LANGUAGE sql AS
$$ INSERT INTO cron.job (jobname, schedule, command) VALUES (n, sch, cmd)
   ON CONFLICT (jobname) DO UPDATE SET schedule = EXCLUDED.schedule, command = EXCLUDED.command RETURNING jobid $$;
INSERT INTO cron.job (jobname) VALUES ('bat-live-pull');
-- Tonight's shape: successes, then 4 failures and one still running (not yet a streak of 5).
INSERT INTO cron.job_run_details (jobid, status)
SELECT 1, st FROM unnest(ARRAY['succeeded','succeeded','failed','failed','failed','failed','running']) st;
INSERT INTO public.live_auction_sources (slug) VALUES ('bat'), ('collecting-cars');
INSERT INTO public.job_assay_readings (jobname, reading, assayed_at, elapsed_ms)
VALUES ('bat-live-pull', '{"status":"failed","missing_lots":251,"overdue_lots":7,"lot_title":"private text"}', now() - interval '3 hours', 10),
       ('drain-vehicle-derived-queues', '{"status":"partial"}', now() - interval '3 hours', 10);
-- Watched BaT lots ended inside the window, none of them sold in auction_events (the outage shape).
INSERT INTO public.monitored_auctions (source_id, auction_end_time, is_live)
SELECT s.id, now() - interval '90 minutes', true FROM public.live_auction_sources s, generate_series(1, 40) WHERE s.slug = 'bat';
INSERT INTO public.auction_events (source, outcome, auction_end_date) VALUES ('bat', 'live', now() - interval '90 minutes');

\i supabase/migrations/20261125090700_job_health_alarms.sql
\i supabase/migrations/20261125090700_job_health_alarms.sql

-- Run streaks: 4 failed in a row (the running one is not counted) is below 5; the fifth opens a 'runs' episode that is
-- due at once with failed_in_row and threshold only; a success clears it.
DO $$ DECLARE j jsonb; r record; BEGIN
  j := public.job_health_runs_fold();
  IF j->'rules'->0->>'failed_in_row' <> '4' OR j->'rules'->0->>'status' <> 'passed' THEN RAISE EXCEPTION 'FAIL: streak of 4 read %', j; END IF;
  UPDATE cron.job_run_details SET status = 'failed' WHERE status = 'running';
  j := public.job_health_runs_fold();
  IF j->'rules'->0->>'status' <> 'failed' THEN RAISE EXCEPTION 'FAIL: streak of 5 read %', j; END IF;
END $$;
-- A new statement, so now() is past the episode's open time (alarm_after 0).
DO $$ DECLARE r record; j jsonb; BEGIN
  SELECT * INTO r FROM public.job_health_alarms_due() WHERE check_key = 'runs';
  IF NOT FOUND OR r.numbers->>'failed_in_row' <> '5' OR r.numbers ? 'jobname' THEN RAISE EXCEPTION 'FAIL: runs alarm %', row_to_json(r); END IF;
  INSERT INTO cron.job_run_details (jobid, status) VALUES (1, 'succeeded');
  PERFORM public.job_health_runs_fold();
  IF EXISTS (SELECT FROM public.job_health_failures WHERE check_key = 'runs' AND cleared_at IS NULL) THEN
    RAISE EXCEPTION 'FAIL: a success did not clear the streak'; END IF;
  IF (SELECT count(*) FROM cron.job WHERE jobname IN ('job-health-flow-fold', 'job-health-runs-fold')) <> 2 THEN
    RAISE EXCEPTION 'FAIL: folds not scheduled'; END IF;
  -- A paused or missing ruled job fails with its reason, not silently.
  UPDATE cron.job SET active = false WHERE jobname = 'bat-live-pull';
  j := public.job_health_runs_fold();
  IF j->'rules'->0->>'reason' <> 'job_inactive' OR j->'rules'->0->>'status' <> 'failed' THEN RAISE EXCEPTION 'FAIL: inactive job read %', j; END IF;
  UPDATE cron.job SET active = true, jobname = 'bat-live-pull-renamed' WHERE jobname = 'bat-live-pull';
  j := public.job_health_runs_fold();
  IF j->'rules'->0->>'reason' <> 'job_missing' THEN RAISE EXCEPTION 'FAIL: missing job read %', j; END IF;
  UPDATE cron.job SET jobname = 'bat-live-pull' WHERE jobname = 'bat-live-pull-renamed';
  PERFORM public.job_health_runs_fold();
  IF EXISTS (SELECT FROM public.job_health_failures WHERE check_key = 'runs' AND cleared_at IS NULL) THEN
    RAISE EXCEPTION 'FAIL: restored job did not clear'; END IF;
END $$;

DO $$
DECLARE n int; r record;
BEGIN
  -- Seed: the failed assay opened one episode dated at its reading; the partial one opened nothing.
  SELECT count(*) INTO n FROM public.job_health_failures WHERE cleared_at IS NULL;
  IF n <> 2 THEN RAISE EXCEPTION 'FAIL: open episodes after seed %, want 2 (assay + flow)', n; END IF;
  SELECT * INTO r FROM public.job_health_failures WHERE jobname = 'bat-live-pull' AND check_key = 'assay';
  IF r.first_failed_at > now() - interval '2 hours' THEN RAISE EXCEPTION 'FAIL: assay episode not dated at its reading'; END IF;
  SELECT * INTO r FROM public.job_health_failures WHERE check_key = 'flow:bat:sold';
  IF r.last_reading->>'lots_ended' <> '40' OR r.last_reading->>'with_outcome' <> '0' THEN
    RAISE EXCEPTION 'FAIL: flow reading %', r.last_reading; END IF;
  -- Alarm: the assay episode is 3 h old (past 1 h); the flow episode was opened now (not yet due).
  SELECT count(*) INTO n FROM public.job_health_alarms_due();
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL: alarms due %, want 1', n; END IF;
  SELECT * INTO r FROM public.job_health_alarms_due();
  IF r.check_key <> 'assay' OR r.numbers ? 'lot_title' OR r.numbers ? 'overdue_lots' OR NOT r.numbers ? 'missing_lots' THEN
    RAISE EXCEPTION 'FAIL: alarm row %', row_to_json(r); END IF;
END $$;

-- A later failed reading extends the same episode; a passing one clears it.
UPDATE public.job_assay_readings SET reading = '{"status":"failed","overdue_lots":300}', assayed_at = now() WHERE jobname = 'bat-live-pull';
DO $$ BEGIN
  IF (SELECT count(*) FROM public.job_health_failures WHERE jobname = 'bat-live-pull' AND check_key = 'assay') <> 1 THEN
    RAISE EXCEPTION 'FAIL: a second failed reading opened a second episode'; END IF;
END $$;
UPDATE public.job_assay_readings SET reading = '{"status":"passed"}', assayed_at = now() WHERE jobname = 'bat-live-pull';
DO $$ BEGIN
  IF EXISTS (SELECT FROM public.job_health_failures WHERE jobname = 'bat-live-pull' AND check_key = 'assay' AND cleared_at IS NULL) THEN
    RAISE EXCEPTION 'FAIL: passing reading did not clear the episode'; END IF;
END $$;
UPDATE public.job_assay_readings SET reading = '{"status":"failed"}', assayed_at = now() WHERE jobname = 'bat-live-pull';
DO $$ BEGIN
  IF (SELECT count(*) FROM public.job_health_failures WHERE jobname = 'bat-live-pull' AND check_key = 'assay') <> 2 THEN
    RAISE EXCEPTION 'FAIL: a failure after a clear must open a new episode'; END IF;
END $$;

-- A partial outage: 9 sold of 40 ended (below 0.25) still fails; 10 of 40 passes and clears the episode.
INSERT INTO public.auction_events (source, outcome, auction_end_date)
SELECT 'bat', 'sold', now() - interval '90 minutes' FROM generate_series(1, 9);
DO $$ DECLARE j jsonb; BEGIN
  j := public.job_health_flow_fold();
  IF j->'rules'->0->>'status' <> 'failed' THEN RAISE EXCEPTION 'FAIL: partial outage read %', j; END IF;
END $$;
-- A sold row outside the window does not count.
INSERT INTO public.auction_events (source, outcome, auction_end_date) VALUES ('bat', 'sold', now() - interval '4 hours');
DO $$ DECLARE j jsonb; BEGIN
  j := public.job_health_flow_fold();
  IF j->'rules'->0->>'status' <> 'failed' THEN RAISE EXCEPTION 'FAIL: out-of-window sold row counted %', j; END IF;
END $$;
INSERT INTO public.auction_events (source, outcome, auction_end_date) VALUES ('bat', 'sold', now() - interval '90 minutes');
DO $$ DECLARE j jsonb; BEGIN
  j := public.job_health_flow_fold();
  IF j->'rules'->0->>'status' <> 'passed' THEN RAISE EXCEPTION 'FAIL: flow at 0.25 share %', j; END IF;
  IF EXISTS (SELECT FROM public.job_health_failures WHERE check_key = 'flow:bat:sold' AND cleared_at IS NULL) THEN
    RAISE EXCEPTION 'FAIL: flow episode not cleared'; END IF;
END $$;
-- Fewer than 20 ended: idle (too few to tell), which is not a failure.
DELETE FROM public.auction_events;
DELETE FROM public.monitored_auctions WHERE id IN (SELECT id FROM public.monitored_auctions LIMIT 21);
DO $$ DECLARE j jsonb; BEGIN
  j := public.job_health_flow_fold();
  IF j->'rules'->0->>'status' <> 'idle' THEN RAISE EXCEPTION 'FAIL: 19 ended read %', j; END IF;
END $$;
-- No watched lot ended in the window: idle.
UPDATE public.monitored_auctions SET auction_end_time = now() - interval '3 days';
DELETE FROM public.auction_events;
DO $$ DECLARE j jsonb; BEGIN
  j := public.job_health_flow_fold();
  IF j->'rules'->0->>'status' <> 'idle' THEN RAISE EXCEPTION 'FAIL: idle window read %', j; END IF;
  IF EXISTS (SELECT FROM public.job_health_failures WHERE check_key = 'flow:bat:sold' AND cleared_at IS NULL) THEN
    RAISE EXCEPTION 'FAIL: idle opened an episode'; END IF;
END $$;
-- Settle window: a lot that ended 10 minutes ago does not count yet.
UPDATE public.monitored_auctions SET auction_end_time = now() - interval '10 minutes';
DO $$ DECLARE j jsonb; BEGIN
  j := public.job_health_flow_fold();
  IF j->'rules'->0->>'status' <> 'idle' THEN RAISE EXCEPTION 'FAIL: unsettled lots counted %', j; END IF;
END $$;

-- Landing lag: a watched lot is stamped once, the first fold that sees a final outcome for its vehicle and URL.
DELETE FROM public.monitored_auctions;
INSERT INTO public.monitored_auctions (id, source_id, auction_end_time, is_live, vehicle_id, external_auction_url)
SELECT '00000000-0000-0000-0000-0000000000f1', s.id, now() - interval '3 hours', false,
       '00000000-0000-0000-0000-0000000000a1', 'https://bringatrailer.com/listing/x-1/'
  FROM public.live_auction_sources s WHERE s.slug = 'bat';
INSERT INTO public.monitored_auctions (id, source_id, auction_end_time, is_live, vehicle_id, external_auction_url)
SELECT '00000000-0000-0000-0000-0000000000f2', s.id, now() - interval '3 hours', false,
       '00000000-0000-0000-0000-0000000000a2', 'https://bringatrailer.com/listing/x-2/'
  FROM public.live_auction_sources s WHERE s.slug = 'bat';
INSERT INTO public.auction_events (source, outcome, vehicle_id, source_url) VALUES
  ('bat', 'sold', '00000000-0000-0000-0000-0000000000a1', 'https://bringatrailer.com/listing/x-1'),
  ('bat', 'live', '00000000-0000-0000-0000-0000000000a2', 'https://bringatrailer.com/listing/x-2');
DELETE FROM public.job_health_fold_clock;
DO $$ DECLARE t0 timestamptz; BEGIN
  PERFORM public.job_health_flow_fold();
  -- The first fold with no earlier clock: the lot's landing time is unknown (not_before NULL).
  IF (SELECT not_before FROM public.monitored_lot_resolutions) IS NOT NULL THEN RAISE EXCEPTION 'FAIL: first fold set not_before'; END IF;
  IF (SELECT count(*) FROM public.monitored_lot_resolutions) <> 1
     OR NOT EXISTS (SELECT FROM public.monitored_lot_resolutions WHERE monitored_auction_id = '00000000-0000-0000-0000-0000000000f1' AND outcome = 'sold') THEN
    RAISE EXCEPTION 'FAIL: resolutions %', (SELECT jsonb_agg(x) FROM public.monitored_lot_resolutions x); END IF;
  SELECT first_resolved_at INTO t0 FROM public.monitored_lot_resolutions;
  PERFORM pg_sleep(0.01);
  PERFORM public.job_health_flow_fold();
  IF (SELECT first_resolved_at FROM public.monitored_lot_resolutions) <> t0 THEN RAISE EXCEPTION 'FAIL: first stamp moved'; END IF;
END $$;
-- A lot that ends, stays unresolved through a fold, then resolves: bounded by (that fold, the next fold].
INSERT INTO public.monitored_auctions (id, source_id, auction_end_time, is_live, vehicle_id, external_auction_url)
SELECT '00000000-0000-0000-0000-0000000000f3', s.id, now() - interval '30 minutes', false,
       '00000000-0000-0000-0000-0000000000a3', 'https://bringatrailer.com/listing/x-3/'
  FROM public.live_auction_sources s WHERE s.slug = 'bat';
SELECT public.job_health_flow_fold();
SELECT checked_at AS unresolved_fold FROM public.job_health_fold_clock WHERE fold = 'flow' \gset
SELECT public.assert_true(NOT EXISTS (SELECT FROM public.monitored_lot_resolutions WHERE monitored_auction_id = '00000000-0000-0000-0000-0000000000f3'), 'unresolved lot not stamped');
INSERT INTO public.auction_events (source, outcome, vehicle_id, source_url)
VALUES ('bat', 'sold', '00000000-0000-0000-0000-0000000000a3', 'https://bringatrailer.com/listing/x-3');
SELECT pg_sleep(0.01);
SELECT public.job_health_flow_fold();
SELECT public.assert_true((SELECT not_before FROM public.monitored_lot_resolutions WHERE monitored_auction_id = '00000000-0000-0000-0000-0000000000f3')
                          = :'unresolved_fold'::timestamptz, 'not_before is the fold that saw the lot unresolved');
-- A lot that ends after the last fold and resolves before the next: bounded by (previous fold, this fold].
UPDATE public.monitored_auctions SET auction_end_time = (SELECT checked_at FROM public.job_health_fold_clock WHERE fold = 'flow') + interval '1 millisecond'
 WHERE id = '00000000-0000-0000-0000-0000000000f2';
UPDATE public.auction_events SET outcome = 'sold' WHERE vehicle_id = '00000000-0000-0000-0000-0000000000a2';
SELECT pg_sleep(0.05);  -- the lot's end must be before the next fold's transaction clock
DO $$ DECLARE prev timestamptz; BEGIN
  SELECT checked_at INTO prev FROM public.job_health_fold_clock WHERE fold = 'flow';
  PERFORM pg_sleep(0.01);
  PERFORM public.job_health_flow_fold();
  IF (SELECT not_before FROM public.monitored_lot_resolutions WHERE monitored_auction_id = '00000000-0000-0000-0000-0000000000f2')
     IS DISTINCT FROM prev THEN RAISE EXCEPTION 'FAIL: not_before is not the previous fold'; END IF;
END $$;

-- Constraints: one open episode per (job, check); unknown check keys refused.
DO $$ BEGIN
  BEGIN
    INSERT INTO public.job_health_failures (jobname, check_key, first_failed_at, last_seen_at) VALUES ('x', 'whatever', now(), now());
    RAISE EXCEPTION 'FAIL: bad check_key accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  INSERT INTO public.job_health_failures (jobname, check_key, first_failed_at, last_seen_at) VALUES ('x', 'assay', now(), now());
  BEGIN
    INSERT INTO public.job_health_failures (jobname, check_key, first_failed_at, last_seen_at) VALUES ('x', 'assay', now(), now());
    RAISE EXCEPTION 'FAIL: two open episodes for one check';
  EXCEPTION WHEN unique_violation THEN NULL; END;
END $$;

-- Grants.
DO $$ BEGIN
  IF has_table_privilege('anon', 'public.job_health_failures', 'SELECT')
     OR has_table_privilege('authenticated', 'public.source_outcome_flow_rules', 'SELECT')
     OR has_function_privilege('anon', 'public.job_health_alarms_due()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.job_health_flow_fold()', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.job_health_flow_fold()', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.job_health_alarms_due()', 'EXECUTE')
     OR has_table_privilege('service_role', 'public.job_health_failures', 'INSERT') THEN
    RAISE EXCEPTION 'FAIL: grants';
  END IF;
END $$;
\echo test_job_health_alarms: PASS
