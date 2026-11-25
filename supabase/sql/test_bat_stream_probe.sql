-- Disposable PG17: bat_stream_probe_v1 (migration 20261125232500). Loads the live body of bat_live_pull_run read on
-- 2026-11-25 11:15Z (fixture + 20261125174500 + 20261125223000 reproduce the sha256 the migration checks; unchanged by
-- 20261125213500, read again 11:17Z), applies the migration twice, then runs the stream step and the live_pull write
-- cut from the patched function as deployed, with the function's own DECLARE, against 1,600 stale is_live lots and a
-- closing lot. Proves: rule row written once, other live_pull keys kept; patched once; check job scheduled once; alarm
-- rule row when its table exists; with no closing lot a dry run is posted at most every every_minutes and none without
-- the rule; in a minute with a closing lot exactly one post, the real handoff, even when a probe is due; stream_calls
-- keeps the newest 5; and bat_live_stream_check() reads failed for the outage's own answer (HTTP 500, replayed), no
-- response, a call pg_net never sent, a timeout, a 4xx, no call, a missed call with targets; passed on 2xx; a young unanswered call is skipped
-- and writes nothing; refuses without its rule row. Synthetic rows only.
\set ON_ERROR_STOP on
DO $$ BEGIN IF current_database() NOT LIKE 'dm_refinement_%' THEN RAISE EXCEPTION 'disposable database only'; END IF; END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
END $$;

CREATE TABLE public.live_auction_sources (id uuid PRIMARY KEY, slug text UNIQUE, scraping_config jsonb DEFAULT '{}',
  last_successful_sync timestamptz, consecutive_failures integer DEFAULT 0, health_status text, last_sync_error text);
-- guardrail-allow(center-key-fk): monitored_auctions: disposable fixture with the live columns the stream step reads
CREATE TABLE public.monitored_auctions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_id uuid, vehicle_id uuid,
  auction_end_time timestamptz, is_live boolean, stream_state jsonb DEFAULT '{}');
INSERT INTO public.live_auction_sources (id, slug, scraping_config) VALUES
  ('c8bb42ac-6d09-4453-bb0b-11a8689f5707', 'bat', '{"live_pull": {"lots_per_run": 8, "closing_slots": 1}}'),
  ('00000000-0000-0000-0000-0000000000aa', 'other', '{}');
CREATE TABLE public.job_assay_readings (jobname text PRIMARY KEY, reading jsonb, assayed_at timestamptz, elapsed_ms integer,
  attempted_at timestamptz, attempt_error text, refresh_every interval, fresh_for interval, run_started_at timestamptz,
  CHECK (refresh_every > interval '0' AND fresh_for > refresh_every), CHECK ((assayed_at IS NULL) = (elapsed_ms IS NULL) AND elapsed_ms >= 0));
CREATE TABLE public.job_health_alarm_rules (jobname text PRIMARY KEY, alarm_after interval NOT NULL,
  report_keys text[] NOT NULL DEFAULT '{}', basis text NOT NULL CHECK (length(basis) >= 20), created_at timestamptz DEFAULT now());
CREATE SCHEMA net;
CREATE TABLE net._http_response (id bigint PRIMARY KEY, status_code integer, content_type text, headers jsonb, content text,
  timed_out boolean, error_msg text, created timestamptz NOT NULL DEFAULT now());
CREATE TABLE net._posts (id bigserial PRIMARY KEY, url text, body jsonb);
CREATE TABLE net.http_request_queue (id bigint PRIMARY KEY);
CREATE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}', params jsonb DEFAULT '{}', headers jsonb DEFAULT '{}',
  timeout_milliseconds integer DEFAULT 5000) RETURNS bigint LANGUAGE sql AS
  $$ INSERT INTO net._posts (url, body) VALUES (url, body) RETURNING id $$;
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text, command text);
CREATE FUNCTION cron.schedule(job_name text, schedule text, command text) RETURNS bigint LANGUAGE sql AS $$
  INSERT INTO cron.job (jobname, schedule, command) VALUES (job_name, schedule, command)
  ON CONFLICT (jobname) DO UPDATE SET schedule = EXCLUDED.schedule, command = EXCLUDED.command RETURNING jobid $$;
CREATE FUNCTION public.get_service_role_key_for_cron() RETURNS text LANGUAGE sql AS $$ SELECT 'test-key' $$;
CREATE FUNCTION public.get_service_url() RETURNS text LANGUAGE sql AS $$ SELECT 'https://example.invalid' $$;

\i supabase/sql/fixtures/bat_live_pull_run_live_20261125.sql
\i supabase/migrations/20261125174500_bat_live_pull_relive_fence.sql
\i supabase/migrations/20261125223000_bat_stream_closing_window.sql
CREATE FUNCTION public.assert(cond boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF cond IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', msg; END IF; END $$;
SELECT public.assert(encode(sha256(convert_to(pg_get_functiondef('public.bat_live_pull_run(integer,boolean)'::regprocedure), 'UTF8')), 'base64')
  = 'MM/n9x0BCWeA+bP7MkVV3jjq0UGWGtH07VLsqx2nrEk=', 'fixture + relive fence + stream window reproduce the live body');

\i supabase/migrations/20261125232500_bat_stream_probe.sql
\i supabase/migrations/20261125232500_bat_stream_probe.sql

SELECT public.assert((SELECT (length(d) - length(replace(d, 'bat_stream_probe_v1', ''))) / length('bat_stream_probe_v1') = 1
  FROM (SELECT pg_get_functiondef('public.bat_live_pull_run(integer,boolean)'::regprocedure) d) x), 'patched once');
SELECT public.assert(scraping_config #>> '{live_pull,stream_probe,every_minutes}' = '10'
  AND scraping_config #>> '{live_pull,stream_probe,response_wait_minutes}' = '3'
  AND scraping_config #>> '{live_pull,stream_probe,missed_slack_minutes}' = '5'
  AND length(scraping_config #>> '{live_pull,stream_probe,basis}') > 40
  AND scraping_config #>> '{live_pull,stream_window,lookback_minutes}' = '120'
  AND scraping_config #>> '{live_pull,lots_per_run}' = '8',
  'rule row written with its basis; other live_pull keys kept') FROM public.live_auction_sources WHERE slug = 'bat';
SELECT public.assert(scraping_config = '{}', 'other source untouched') FROM public.live_auction_sources WHERE slug = 'other';
SELECT public.assert((SELECT count(*) FROM cron.job WHERE jobname = 'bat-live-stream-check' AND schedule = '*/5 * * * *'
  AND command = 'SELECT public.bat_live_stream_check()') = 1, 'check job scheduled once');
SELECT public.assert((SELECT alarm_after = interval '15 minutes' AND 'http_status' = ANY (report_keys)
  FROM public.job_health_alarm_rules WHERE jobname = 'bat-live-stream-check'), 'alarm rule row');
SELECT public.assert(NOT has_function_privilege('anon', 'public.bat_live_stream_check()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.bat_live_stream_check()', 'EXECUTE'), 'check not callable by anon');

-- The stream step and the live_pull write, cut from the patched function, run with the function's own DECLARE.
DO $make$
DECLARE
  fn text := pg_get_functiondef('public.bat_live_pull_run(integer,boolean)'::regprocedure);
  d0 int := position(E'DECLARE\n' IN fn);
  d1 int := position(E'\nBEGIN\n' IN fn);
  s1 int := position('  SELECT count(*) INTO v_stream_lots FROM monitored_auctions' IN fn);
  s2 int := position(E'  UPDATE live_auction_sources\n  SET scraping_config = jsonb_set(' IN fn);
  e1 int; e2 int;
BEGIN
  IF d0 = 0 OR d1 = 0 OR s1 = 0 OR s2 = 0 THEN RAISE EXCEPTION 'FAIL: cut points not found'; END IF;
  e1 := position(E'\n  END IF;\n' IN substr(fn, s1)) + length(E'\n  END IF;\n') - 1;
  e2 := position(E'  WHERE id = v_src;\n' IN substr(fn, s2)) + length(E'  WHERE id = v_src;\n') - 1;
  EXECUTE 'CREATE FUNCTION public._tail(p_now timestamptz) RETURNS bigint LANGUAGE plpgsql AS $t$ '
    || substr(fn, d0, d1 - d0)
    || E'\nBEGIN\n  v_now := p_now; v_samples := ''[]''::jsonb;\n'
    || E'  SELECT id, coalesce(scraping_config -> ''live_pull'', ''{}''::jsonb) INTO v_src, v_cfg FROM live_auction_sources WHERE slug = ''bat'';\n'
    || substr(fn, s1, e1) || substr(fn, s2, e2) || E'\n  RETURN v_stream_req;\nEND $t$';
END
$make$;
CREATE FUNCTION public._lp() RETURNS jsonb LANGUAGE sql AS
  $$ SELECT scraping_config -> 'live_pull' FROM public.live_auction_sources WHERE slug = 'bat' $$;

INSERT INTO public.monitored_auctions (source_id, auction_end_time, is_live)
  SELECT 'c8bb42ac-6d09-4453-bb0b-11a8689f5707', now() - (1 + g % 13) * interval '1 day', true FROM generate_series(1, 1600) g;

DO $probe$
DECLARE r bigint; r_second bigint; n bigint;
BEGIN
  r := public._tail(now() - interval '40 minutes');
  PERFORM public.assert(r IS NOT NULL, 'no closing lot, no call yet: a probe is posted');
  PERFORM public.assert((SELECT body = '{"mode": "live_stream", "dry_run": true}'::jsonb AND url = 'https://example.invalid/functions/v1/extract-bat-core'
                           FROM net._posts WHERE id = r), 'the probe is a dry run of the same handoff');
  PERFORM public.assert(jsonb_array_length(public._lp() -> 'stream_calls') = 1
    AND public._lp() #>> '{stream_calls,0,kind}' = 'probe' AND public._lp() #>> '{stream_calls,0,targets}' = '0'
    AND (public._lp() #>> '{stream_calls,0,request_id}')::bigint = r
    AND (public._lp() #>> '{last_run,stream_request_id}')::bigint = r, 'the probe is stamped');

  r := public._tail(now() - interval '39 minutes');
  PERFORM public.assert(r IS NULL AND (SELECT count(*) FROM net._posts) = 1, 'a minute later: no probe');
  PERFORM public.assert(jsonb_array_length(public._lp() -> 'stream_calls') = 1
    AND public._lp() #>> '{last_run,stream_request_id}' IS NULL, 'the stamp survives a minute with no call');

  r_second := public._tail(now() - interval '30 minutes');
  PERFORM public.assert(r_second IS NOT NULL AND jsonb_array_length(public._lp() -> 'stream_calls') = 2, 'every_minutes later: probe again');

  INSERT INTO public.monitored_auctions (source_id, auction_end_time, is_live)
    VALUES ('c8bb42ac-6d09-4453-bb0b-11a8689f5707', now() + interval '10 minutes', true);
  n := (SELECT count(*) FROM net._posts);
  r := public._tail(now() - interval '2 minutes');
  PERFORM public.assert((SELECT count(*) FROM net._posts) = n + 1 AND (SELECT body = '{"mode": "live_stream"}'::jsonb FROM net._posts WHERE id = r),
                        'a closing lot with a probe due: one post, the real handoff, no dry run');
  PERFORM public.assert(public._lp() #>> '{stream_calls,-1,kind}' = 'stream' AND public._lp() #>> '{stream_calls,-1,targets}' = '1',
                        'stamped as stream with its targets');
  r := public._tail(now() - interval '1 minute');
  PERFORM public.assert(r IS NOT NULL, 'a closing lot: every minute');
  PERFORM public._tail(now());
  PERFORM public._tail(now());
  PERFORM public.assert(jsonb_array_length(public._lp() -> 'stream_calls') = 5
    AND (public._lp() #>> '{stream_calls,0,request_id}')::bigint = r_second, 'newest 5 kept, oldest dropped');
  PERFORM public.assert(public._lp() #>> '{stream_window,lookback_minutes}' = '120'
    AND public._lp() #>> '{stream_probe,every_minutes}' = '10' AND public._lp() #>> '{lots_per_run}' = '8', 'other keys kept');

  DELETE FROM public.monitored_auctions WHERE auction_end_time > now();
  UPDATE public.live_auction_sources SET scraping_config = jsonb_set(scraping_config, '{live_pull}',
    ((scraping_config -> 'live_pull') - 'stream_probe')
    || jsonb_build_object('stream_calls', jsonb_build_array(jsonb_build_object('request_id', 1, 'at', now() - interval '1 hour'))))
    WHERE slug = 'bat';
  n := (SELECT count(*) FROM net._posts);
  PERFORM public.assert(public._tail(now()) IS NULL AND (SELECT count(*) FROM net._posts) = n, 'no rule row: no probe');
  UPDATE public.live_auction_sources SET scraping_config = jsonb_set(scraping_config, '{live_pull,stream_probe}',
    '{"every_minutes": "ten"}') WHERE slug = 'bat';
  PERFORM public.assert(public._tail(now()) IS NULL, 'malformed rule: no probe, no error');
  UPDATE public.live_auction_sources SET scraping_config = jsonb_set(jsonb_set(scraping_config, '{live_pull,stream_probe}',
    '{"every_minutes": 10, "response_wait_minutes": 3, "missed_slack_minutes": 5, "basis": "restored for the check cases below"}'),
    '{live_pull,stream_calls}', '"garbage"') WHERE slug = 'bat';
  r := public._tail(now());
  PERFORM public.assert(r IS NOT NULL AND jsonb_array_length(public._lp() -> 'stream_calls') = 1, 'malformed stamp: probe due, stamp restarts');
END
$probe$;

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

  INSERT INTO net.http_request_queue (id) VALUES (9010), (9011);
  PERFORM public._set(jsonb_build_array(public._call(9003, '9 minutes'), public._call(9010, '5 minutes')),
                      jsonb_build_object('at', now() - interval '5 minutes', 'stream_lots', 1));
  r := public.bat_live_stream_check();
  PERFORM public.assert(r ->> 'status' = 'passed' AND (r ->> 'request_id')::bigint = 9003,
                        format('a call still queued at pg_net under every_minutes is skipped (%s)', r));
  PERFORM public._set(jsonb_build_array(public._call(9011, '11 minutes')), jsonb_build_object('at', now() - interval '11 minutes', 'stream_lots', 0));
  r := public.bat_live_stream_check();
  PERFORM public.assert(r ->> 'status' = 'failed' AND r ->> 'reason' = 'still_queued', format('still queued after every_minutes (%s)', r));

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

  UPDATE public.live_auction_sources SET scraping_config = scraping_config #- '{live_pull,stream_probe}' WHERE slug = 'bat';
  BEGIN
    PERFORM public.bat_live_stream_check();
    RAISE EXCEPTION 'FAIL: ran without its rule row';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
  END;
END
$check$;
SELECT 'test_bat_stream_probe PASS';
