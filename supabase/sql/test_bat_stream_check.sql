-- Disposable PG17: bat_live_stream_check_v1 (migration 20261125233500), on top of job_health_alarms_v1 (20261125090700,
-- this branch's base) with the rule row and stamps of 20261125232500 written as that migration writes them. Applies the
-- migration twice. Proves: rule row written once, other live_pull keys kept; job scheduled once; alarm rule row; not
-- callable by anon; bat_live_stream_check() reads failed for the outage's own answer (HTTP 500, replayed), no response,
-- a timeout, a 4xx, no call, a missed call with targets; passed on 2xx; a young unanswered call is skipped and writes
-- nothing; refuses without its rule row; a failed reading opens a 'bat-live-stream-check' assay episode that
-- job_health_alarms_due() reports after 15 minutes with its numbers, and a passing reading clears it. Synthetic rows only.
-- Run from the repo root in an empty database named dm_refinement_<name>.
\set ON_ERROR_STOP on
DO $$ BEGIN IF current_database() NOT LIKE 'dm_refinement_%' THEN RAISE EXCEPTION 'disposable database only'; END IF; END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
CREATE FUNCTION public.assert(cond boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF cond IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', msg; END IF; END $$;

-- Live shapes (2026-11-25), the columns both migrations read.
CREATE TABLE public.job_assay_readings (jobname text PRIMARY KEY, reading jsonb, assayed_at timestamptz, elapsed_ms integer,
  attempted_at timestamptz, attempt_error text, refresh_every interval NOT NULL DEFAULT '5 minutes',
  fresh_for interval NOT NULL DEFAULT '15 minutes', run_started_at timestamptz,
  CHECK (refresh_every > interval '0' AND fresh_for > refresh_every), CHECK ((assayed_at IS NULL) = (elapsed_ms IS NULL) AND elapsed_ms >= 0));
CREATE TABLE public.live_auction_sources (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text UNIQUE, scraping_config jsonb DEFAULT '{}');
-- guardrail-allow(center-key-fk): monitored_auctions: disposable fixture with the live columns the folds read
CREATE TABLE public.monitored_auctions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_id uuid REFERENCES public.live_auction_sources,
  auction_end_time timestamptz, is_live boolean, vehicle_id uuid, external_auction_url text);
-- guardrail-allow(center-key-fk): auction_events: disposable fixture with the live columns the folds read
CREATE TABLE public.auction_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source text, outcome text,
  auction_end_date timestamptz, vehicle_id uuid, source_url text);
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text, command text, active boolean NOT NULL DEFAULT true);
CREATE TABLE cron.job_run_details (runid bigserial PRIMARY KEY, jobid bigint, status text, start_time timestamptz, end_time timestamptz);
CREATE FUNCTION cron.schedule(n text, sch text, cmd text) RETURNS bigint LANGUAGE sql AS
$$ INSERT INTO cron.job (jobname, schedule, command) VALUES (n, sch, cmd)
   ON CONFLICT (jobname) DO UPDATE SET schedule = EXCLUDED.schedule, command = EXCLUDED.command RETURNING jobid $$;
CREATE SCHEMA net;
CREATE TABLE net._http_response (id bigint PRIMARY KEY, status_code integer, content_type text, headers jsonb, content text,
  timed_out boolean, error_msg text, created timestamptz NOT NULL DEFAULT now());
-- 20261125232500's rule row, as it writes it; live_pull keys the puller keeps.
INSERT INTO public.live_auction_sources (id, slug, scraping_config) VALUES
  ('c8bb42ac-6d09-4453-bb0b-11a8689f5707', 'bat', '{"live_pull": {"lots_per_run": 8, "stream_window": {"lookback_minutes": 120},
     "stream_probe": {"every_minutes": 10, "basis": "as 20261125232500 writes it"}}}'),
  (gen_random_uuid(), 'other', '{}');

\i supabase/migrations/20261125090700_job_health_alarms.sql
\i supabase/migrations/20261125233500_bat_stream_check.sql
\i supabase/migrations/20261125233500_bat_stream_check.sql

SELECT public.assert(scraping_config #>> '{live_pull,stream_check,response_wait_minutes}' = '3'
  AND scraping_config #>> '{live_pull,stream_check,missed_slack_minutes}' = '5'
  AND length(scraping_config #>> '{live_pull,stream_check,basis}') > 40
  AND scraping_config #>> '{live_pull,stream_probe,every_minutes}' = '10'
  AND scraping_config #>> '{live_pull,lots_per_run}' = '8', 'rule row written with its basis; other live_pull keys kept')
  FROM public.live_auction_sources WHERE slug = 'bat';
SELECT public.assert(scraping_config = '{}', 'other source untouched') FROM public.live_auction_sources WHERE slug = 'other';
SELECT public.assert((SELECT count(*) FROM cron.job WHERE jobname = 'bat-live-stream-check' AND schedule = '*/5 * * * *'
  AND command = 'SELECT public.bat_live_stream_check()') = 1, 'check job scheduled once');
SELECT public.assert((SELECT alarm_after = interval '15 minutes' AND 'http_status' = ANY (report_keys)
  FROM public.job_health_alarm_rules WHERE jobname = 'bat-live-stream-check'), 'alarm rule row');
SELECT public.assert(NOT has_function_privilege('anon', 'public.bat_live_stream_check()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.bat_live_stream_check()', 'EXECUTE'), 'check not callable by anon');

-- bat_live_stream_check(): set the stamps and answers, read the reading.
CREATE FUNCTION public._set(calls jsonb, run jsonb) RETURNS void LANGUAGE sql AS $$
  UPDATE public.live_auction_sources SET scraping_config = jsonb_set(jsonb_set(scraping_config, '{live_pull,stream_calls}', calls),
    '{live_pull,last_run}', run) WHERE slug = 'bat' $$;
CREATE FUNCTION public._call(id bigint, ago interval, targets int DEFAULT 1) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('request_id', id, 'at', now() - ago, 'kind', CASE WHEN targets > 0 THEN 'stream' ELSE 'probe' END,
                            'targets', targets) $$;
INSERT INTO net._http_response (id, status_code, content, timed_out, error_msg) VALUES
  (9001, 500, '{"success":false,"error":"bat_live_handoff_http_500"}', false, NULL),
  (9002, 202, '{"success":true,"mode":"live_stream"}', false, NULL),
  (9003, 200, '{"success":true,"mode":"live_stream","dry_run":true}', false, NULL),
  (9006, NULL, NULL, true, 'Timeout of 150000 ms reached'),
  (9007, 200, '{"success":true}', false, NULL),
  (9009, 401, '{"error":"Live collection requires service role"}', false, NULL);

DO $check$
DECLARE r jsonb;
BEGIN
  PERFORM public._set(jsonb_build_array(public._call(9001, '4 minutes')), jsonb_build_object('at', now() - interval '4 minutes', 'stream_lots', 1));
  r := public.bat_live_stream_check();
  PERFORM public.assert(r ->> 'status' = 'failed' AND r ->> 'reason' = 'http_500' AND (r ->> 'http_status')::int = 500,
                        format('the outage''s own answer reads failed (%s)', r));
  PERFORM public.assert((SELECT reading ->> 'status' = 'failed' AND fresh_for = interval '15 minutes' AND refresh_every = interval '5 minutes'
                           FROM public.job_assay_readings WHERE jobname = 'bat-live-stream-check'), 'reading stored for v_job_health');

  PERFORM public._set(jsonb_build_array(public._call(9001, '5 minutes'), public._call(9002, '1 minute')),
                      jsonb_build_object('at', now() - interval '1 minute', 'stream_lots', 1));
  r := public.bat_live_stream_check();
  PERFORM public.assert(r ->> 'status' = 'passed' AND (r ->> 'request_id')::bigint = 9002, format('2xx passes (%s)', r));

  PERFORM public._set(jsonb_build_array(public._call(9003, '5 minutes', 0), public._call(9004, '30 seconds', 0)),
                      jsonb_build_object('at', now() - interval '30 seconds', 'stream_lots', 0));
  r := public.bat_live_stream_check();
  PERFORM public.assert(r ->> 'status' = 'passed' AND (r ->> 'request_id')::bigint = 9003 AND r ->> 'kind' = 'probe',
                        format('a young unanswered call is skipped; the dry run before it is read (%s)', r));

  PERFORM public._set(jsonb_build_array(public._call(9005, '4 minutes')), jsonb_build_object('at', now() - interval '4 minutes', 'stream_lots', 1));
  r := public.bat_live_stream_check();
  PERFORM public.assert(r ->> 'status' = 'failed' AND r ->> 'reason' = 'no_response', format('no answer after the wait (%s)', r));

  PERFORM public._set(jsonb_build_array(public._call(9006, '2 minutes')), jsonb_build_object('at', now() - interval '2 minutes', 'stream_lots', 1));
  r := public.bat_live_stream_check();
  PERFORM public.assert(r ->> 'status' = 'failed' AND r ->> 'reason' = 'timed_out', format('timeout (%s)', r));

  PERFORM public._set(jsonb_build_array(public._call(9009, '2 minutes')), jsonb_build_object('at', now() - interval '2 minutes', 'stream_lots', 1));
  r := public.bat_live_stream_check();
  PERFORM public.assert(r ->> 'status' = 'failed' AND r ->> 'reason' = 'http_401', format('4xx (%s)', r));

  PERFORM public._set(jsonb_build_array(public._call(9003, '26 minutes', 0)), jsonb_build_object('at', now() - interval '1 minute', 'stream_lots', 0));
  r := public.bat_live_stream_check();
  PERFORM public.assert(r ->> 'status' = 'failed' AND r ->> 'reason' = 'not_called', format('no call in 2 x 10 + 5 min (%s)', r));
  PERFORM public._set('[]'::jsonb, jsonb_build_object('at', now() - interval '1 minute', 'stream_lots', 0));
  r := public.bat_live_stream_check();
  PERFORM public.assert(r ->> 'reason' = 'not_called', format('no call ever (%s)', r));

  PERFORM public._set(jsonb_build_array(public._call(9007, '5 minutes')), jsonb_build_object('at', now() - interval '1 minute', 'stream_lots', 2));
  r := public.bat_live_stream_check();
  PERFORM public.assert(r ->> 'status' = 'failed' AND r ->> 'reason' = 'not_called_with_targets',
                        format('targets on the last run and no call (%s)', r));

  PERFORM public._set(jsonb_build_array(public._call(9008, '30 seconds')), jsonb_build_object('at', now() - interval '30 seconds', 'stream_lots', 1));
  r := public.bat_live_stream_check();
  PERFORM public.assert(r ->> 'status' = 'pending', format('only a young unanswered call: pending (%s)', r));
  PERFORM public.assert((SELECT reading ->> 'reason' = 'not_called_with_targets' FROM public.job_assay_readings
                          WHERE jobname = 'bat-live-stream-check'), 'pending writes nothing; the previous reading stands');

  UPDATE public.live_auction_sources SET scraping_config = scraping_config #- '{live_pull,stream_check}' WHERE slug = 'bat';
  BEGIN
    PERFORM public.bat_live_stream_check();
    RAISE EXCEPTION 'FAIL: ran without its rule row';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
  END;
END
$check$;

-- The episode: a failed reading opens one; the alarm reader reports it past 15 minutes with its numbers; a pass clears it.
DO $episode$
DECLARE r jsonb; a record;
BEGIN
  UPDATE public.live_auction_sources SET scraping_config = jsonb_set(scraping_config, '{live_pull,stream_check}',
    '{"response_wait_minutes": 3, "missed_slack_minutes": 5, "basis": "restored for the episode case"}') WHERE slug = 'bat';
  PERFORM public._set(jsonb_build_array(public._call(9001, '4 minutes')), jsonb_build_object('at', now() - interval '4 minutes', 'stream_lots', 1));
  r := public.bat_live_stream_check();
  PERFORM public.assert((SELECT count(*) FROM public.job_health_failures WHERE jobname = 'bat-live-stream-check'
                           AND check_key = 'assay' AND cleared_at IS NULL) = 1, 'a failed reading opens an assay episode');
  PERFORM public.assert(NOT EXISTS (SELECT 1 FROM public.job_health_alarms_due() WHERE jobname = 'bat-live-stream-check'),
                        'not due before 15 minutes');
  UPDATE public.job_health_failures SET first_failed_at = now() - interval '16 minutes'
   WHERE jobname = 'bat-live-stream-check' AND cleared_at IS NULL;
  SELECT * INTO a FROM public.job_health_alarms_due() WHERE jobname = 'bat-live-stream-check';
  PERFORM public.assert(a.check_key = 'assay' AND (a.numbers ->> 'http_status')::int = 500 AND a.numbers ->> 'reason' = 'http_500'
                        AND NOT (a.numbers ? 'request_id'), format('due after 15 minutes with its numbers only (%s)', a.numbers));
  PERFORM public._set(jsonb_build_array(public._call(9002, '1 minute')), jsonb_build_object('at', now() - interval '1 minute', 'stream_lots', 1));
  r := public.bat_live_stream_check();
  PERFORM public.assert(r ->> 'status' = 'passed' AND NOT EXISTS (SELECT 1 FROM public.job_health_failures
                          WHERE jobname = 'bat-live-stream-check' AND cleared_at IS NULL), 'a pass clears the episode');
END
$episode$;
SELECT 'test_bat_stream_check PASS';
