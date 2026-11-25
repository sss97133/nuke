-- bat_stream_probe_v1: the BaT stream handoff is called between closes, and a job reads every answer.
--
-- WHY. bat_live_pull_run posts extract-bat-core {mode: live_stream} only in a minute with a closing lot
-- (v_stream_lots > 0). extract-bat-core hands off to ingest-observation (?native_collection_handoff=1), whose
-- closingBatTargets selection refused every run from 2026-11-24 21:08 PT to 2026-11-25 02:45 PT: net._http_response held
-- 304 answers, all HTTP 500 '{"success":false,"error":"bat_live_handoff_http_500"}' (read 2026-11-25 03:15 PT, pg_net
-- ttl 6 h). Nothing read those answers. After 20261125223000 bounded the window there were no closing lots, so the path
-- was not called at all, and the first call on the deployed version would come at the next BaT close (10:00 PT).
--
-- WHAT. A rule row, a patch, a job (one transaction):
--   1. Rule row live_auction_sources (bat) scraping_config.live_pull.stream_probe = {every_minutes 10,
--      response_wait_minutes 3, missed_slack_minutes 5, basis}, written only if absent.
--   2. bat_live_pull_run, in place (sha256 of the live body after 20261125223000 and 20261125213500, anchors once each):
--      a. In a minute with no closing lot, when the newest stamped call is older than every_minutes (or there is none),
--         it posts the same handoff with dry_run true. In a minute with a closing lot it posts the real handoff only, as
--         before: the probe never runs then. A dry run selects the targets and returns them; the collector, the only
--         code that contacts BaT, runs for accepted targets only, and dry_run is never accepted. Contracts on main that
--         fail if it were: batLiveCollector.test.ts "canonical collector dry-run and idle preserve target preview
--         without launching work" (accepted false, no background task, no socket) and liveStream.test.ts (the handoff
--         forwards dry_run true). Absent or malformed every_minutes: no probe (the rule before).
--      b. Every stream or probe call is stamped in live_pull.stream_calls, the newest 5 kept:
--         {request_id, at, kind stream|probe, targets}. The puller rewrites live_pull as
--         (live_pull - 'rest_probes') || {...}, so the key persists between calls.
--   3. bat_live_stream_check(): every 5 minutes (cron bat-live-stream-check) one reading in job_assay_readings under its
--      own job name, which v_job_health shows (20261125213500). failed when:
--        not_called               no call in 2 * every_minutes + missed_slack_minutes;
--        not_called_with_targets  the puller's last run had stream lots and made no call;
--        no_response / timed_out / error / http_<code>  for the newest call that is answered or older than
--                                 response_wait_minutes (a younger unanswered call is skipped, the one before it is read);
--        still_queued             a call pg_net has not sent (net.http_request_queue) after every_minutes.
--      passed on a 2xx. With only a young unanswered call it writes nothing (the previous reading stands, 15 min).
--   4. job_health_alarm_rules row bat-live-stream-check (alarm_after 15 min) when that table exists (20261125090700);
--      if this lands first, a one-row follow-up seeds it after 20261125090700 deploys.
--
-- BASIS. every_minutes 10: 144 dry runs a day, no BaT contact; a broken path answers within 10 minutes of breaking.
-- response_wait_minutes 3: the puller posts with a 150 s timeout. missed_slack_minutes 5: one check interval.
-- alarm_after 15 minutes: three failed readings.
--
-- REVERT. cron.unschedule('bat-live-stream-check'); drop bat_live_stream_check(); remove live_pull.stream_probe (the
-- probe stops; stream_calls stays as data); re-create bat_live_pull_run from the body hashed below to drop the stamp.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10s';

UPDATE public.live_auction_sources
SET scraping_config = jsonb_set(coalesce(scraping_config, '{}'::jsonb), '{live_pull}',
      coalesce(scraping_config -> 'live_pull', '{}'::jsonb) || jsonb_build_object('stream_probe', jsonb_build_object(
        'every_minutes', 10,
        'response_wait_minutes', 3,
        'missed_slack_minutes', 5,
        'basis', 'every 10 min: 144 dry runs a day with no BaT contact (dry_run is never accepted, so the collector does '
                 || 'not start); wait 3 min: the puller posts with a 150 s timeout; slack 5 min: one check interval')))
WHERE slug = 'bat'
  AND scraping_config #> '{live_pull,stream_probe}' IS NULL;

DO $patch$
DECLARE
  sig  text := 'public.bat_live_pull_run(integer,boolean)';
  body text;
  n    int;
  a1   text := $a$  IF v_stream_lots>0 THEN
    v_stream_req:=net.http_post(url:=v_base||'/functions/v1/extract-bat-core',
      headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_key),
      body:=jsonb_build_object('mode','live_stream'),timeout_milliseconds:=150000);
  END IF;$a$;
  r1   text := $r$  -- bat_stream_probe_v1: with no lot closing, a dry run of the same handoff at most every
  -- live_pull.stream_probe.every_minutes (the collector, the only code that contacts BaT, runs for accepted targets
  -- only), so the deployed path answers between closes. Every call is stamped in live_pull.stream_calls.
  IF v_stream_lots>0
     OR (CASE WHEN v_cfg #>> '{stream_probe,every_minutes}' ~ '^[0-9]{1,4}$'
              THEN coalesce(CASE WHEN pg_input_is_valid(v_cfg #>> '{stream_calls,-1,at}', 'timestamp with time zone')
                                 THEN (v_cfg #>> '{stream_calls,-1,at}')::timestamptz END, '-infinity'::timestamptz)
                   <= v_now - make_interval(mins => (v_cfg #>> '{stream_probe,every_minutes}')::integer)
              ELSE false END) THEN
    v_stream_req:=net.http_post(url:=v_base||'/functions/v1/extract-bat-core',
      headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_key),
      body:=jsonb_build_object('mode','live_stream')
            ||CASE WHEN v_stream_lots>0 THEN '{}'::jsonb ELSE '{"dry_run":true}'::jsonb END,timeout_milliseconds:=150000);
  END IF;$r$;
  a2   text := $a$(coalesce(scraping_config -> 'live_pull', '{}'::jsonb) - 'rest_probes') || jsonb_build_object($a$;
  r2   text := $r$(coalesce(scraping_config -> 'live_pull', '{}'::jsonb) - 'rest_probes')
        || CASE WHEN v_stream_req IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('stream_calls',
             (SELECT coalesce(jsonb_agg(c.e ORDER BY c.o), '[]'::jsonb)
                FROM (SELECT t.e, t.o, count(*) OVER () AS n
                        FROM jsonb_array_elements(
                               CASE WHEN jsonb_typeof(scraping_config #> '{live_pull,stream_calls}') = 'array'
                                    THEN scraping_config #> '{live_pull,stream_calls}' ELSE '[]'::jsonb END
                               || jsonb_build_array(jsonb_build_object('request_id', v_stream_req, 'at', v_now,
                                    'kind', CASE WHEN v_stream_lots>0 THEN 'stream' ELSE 'probe' END,
                                    'targets', v_stream_lots))) WITH ORDINALITY t(e, o)) c
               WHERE c.o > c.n - 5)) END
        || jsonb_build_object($r$;
BEGIN
  body := pg_get_functiondef(sig::regprocedure);
  IF position('bat_stream_probe_v1' IN body) > 0 THEN RETURN; END IF;
  IF encode(sha256(convert_to(body, 'UTF8')), 'base64') <> 'MM/n9x0BCWeA+bP7MkVV3jjq0UGWGtH07VLsqx2nrEk=' THEN
    RAISE EXCEPTION 'bat_stream_probe: bat_live_pull_run differs from the body read on 2026-11-25 11:15Z; rebase on the live body';
  END IF;
  n := (length(body) - length(replace(body, a1, ''))) / length(a1);
  IF n <> 1 THEN RAISE EXCEPTION 'bat_stream_probe anchor 1 drifted: % matches', n; END IF;
  n := (length(body) - length(replace(body, a2, ''))) / length(a2);
  IF n <> 1 THEN RAISE EXCEPTION 'bat_stream_probe anchor 2 drifted: % matches', n; END IF;
  EXECUTE replace(replace(body, a1, r1), a2, r2);
END
$patch$;

CREATE OR REPLACE FUNCTION public.bat_live_stream_check()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $f$
DECLARE
  v_started timestamptz := clock_timestamp();
  v_now     timestamptz := now();
  v_cfg     jsonb;
  v_every   integer;
  v_wait    integer;
  v_slack   integer;
  v_calls   jsonb;
  v_newest  jsonb;
  v_newest_at timestamptz;
  v_run_at  timestamptz;
  v_run_lots integer;
  v_call    jsonb;
  v_found   boolean := false;
  v_queued  boolean := false;
  v_code    integer;
  v_timed   boolean;
  v_err     text;
  v_status  text;
  v_reason  text;
  v_reading jsonb;
  c         record;
BEGIN
  SELECT coalesce(scraping_config -> 'live_pull', '{}'::jsonb) INTO v_cfg FROM live_auction_sources WHERE slug = 'bat';
  IF v_cfg IS NULL THEN RAISE EXCEPTION 'bat_live_stream_check: live_auction_sources has no bat row'; END IF;
  v_every := CASE WHEN v_cfg #>> '{stream_probe,every_minutes}' ~ '^[0-9]{1,4}$'
                  THEN (v_cfg #>> '{stream_probe,every_minutes}')::integer END;
  v_wait  := CASE WHEN v_cfg #>> '{stream_probe,response_wait_minutes}' ~ '^[0-9]{1,4}$'
                  THEN (v_cfg #>> '{stream_probe,response_wait_minutes}')::integer END;
  v_slack := CASE WHEN v_cfg #>> '{stream_probe,missed_slack_minutes}' ~ '^[0-9]{1,4}$'
                  THEN (v_cfg #>> '{stream_probe,missed_slack_minutes}')::integer END;
  IF v_every IS NULL OR v_wait IS NULL OR v_slack IS NULL THEN
    RAISE EXCEPTION 'bat_live_stream_check: rule row live_pull.stream_probe (every_minutes, response_wait_minutes, missed_slack_minutes) missing or malformed';
  END IF;
  v_calls := CASE WHEN jsonb_typeof(v_cfg -> 'stream_calls') = 'array' THEN v_cfg -> 'stream_calls' ELSE '[]'::jsonb END;
  v_newest := v_calls -> -1;
  v_newest_at := CASE WHEN pg_input_is_valid(v_newest ->> 'at', 'timestamp with time zone') THEN (v_newest ->> 'at')::timestamptz END;
  v_run_at := CASE WHEN pg_input_is_valid(v_cfg #>> '{last_run,at}', 'timestamp with time zone')
                   THEN (v_cfg #>> '{last_run,at}')::timestamptz END;
  v_run_lots := CASE WHEN v_cfg #>> '{last_run,stream_lots}' ~ '^[0-9]{1,9}$' THEN (v_cfg #>> '{last_run,stream_lots}')::integer END;

  IF v_newest_at IS NULL OR v_newest_at < v_now - make_interval(mins => 2 * v_every + v_slack) THEN
    v_status := 'failed'; v_reason := 'not_called';
  ELSIF v_run_lots > 0 AND v_run_at > v_newest_at THEN
    v_status := 'failed'; v_reason := 'not_called_with_targets';
  ELSE
    -- The newest call that is answered or old enough to have been; a younger unanswered call is skipped. A call pg_net
    -- has not sent yet (still in net.http_request_queue) waits every_minutes before it reads still_queued.
    FOR c IN SELECT e, o FROM jsonb_array_elements(v_calls) WITH ORDINALITY t(e, o) ORDER BY o DESC LOOP
      CONTINUE WHEN coalesce(c.e ->> 'request_id', '') !~ '^[0-9]{1,18}$'
                 OR NOT coalesce(pg_input_is_valid(c.e ->> 'at', 'timestamp with time zone'), false);
      SELECT true, r.status_code, r.timed_out, r.error_msg INTO v_found, v_code, v_timed, v_err
        FROM net._http_response r WHERE r.id = (c.e ->> 'request_id')::bigint;
      v_found := coalesce(v_found, false);
      v_queued := NOT v_found AND EXISTS (SELECT 1 FROM net.http_request_queue q WHERE q.id = (c.e ->> 'request_id')::bigint);
      IF v_found OR (c.e ->> 'at')::timestamptz <= v_now - make_interval(mins => CASE WHEN v_queued THEN v_every ELSE v_wait END) THEN
        v_call := c.e;
        EXIT;
      END IF;
    END LOOP;
    IF v_call IS NULL THEN
      RETURN jsonb_build_object('status', 'pending', 'checked_at', v_now, 'calls', jsonb_array_length(v_calls));
    END IF;
    v_status := 'failed';
    v_reason := CASE WHEN NOT v_found AND v_queued THEN 'still_queued'
                     WHEN NOT v_found THEN 'no_response'
                     WHEN v_timed THEN 'timed_out'
                     WHEN v_err IS NOT NULL THEN 'error'
                     WHEN v_code IS NULL OR v_code NOT BETWEEN 200 AND 299 THEN 'http_' || coalesce(v_code::text, 'none')
                END;
    IF v_reason IS NULL THEN v_status := 'passed'; END IF;
  END IF;

  v_reading := jsonb_build_object('status', v_status, 'reason', v_reason, 'checked_at', v_now,
    'kind', v_call ->> 'kind', 'targets', (v_call ->> 'targets')::integer, 'http_status', v_code,
    'request_id', (v_call ->> 'request_id')::bigint, 'call_at', v_call ->> 'at',
    'newest_call_at', v_newest_at, 'last_run_stream_lots', v_run_lots, 'calls', jsonb_array_length(v_calls));
  INSERT INTO job_assay_readings (jobname, reading, assayed_at, elapsed_ms, attempted_at, attempt_error, refresh_every, fresh_for)
  VALUES ('bat-live-stream-check', v_reading, v_now,
          greatest(round(extract(epoch FROM clock_timestamp() - v_started) * 1000), 0)::integer, v_now, NULL,
          interval '5 minutes', interval '15 minutes')
  ON CONFLICT (jobname) DO UPDATE
    SET reading = EXCLUDED.reading, assayed_at = EXCLUDED.assayed_at, elapsed_ms = EXCLUDED.elapsed_ms,
        attempted_at = EXCLUDED.attempted_at, attempt_error = NULL, refresh_every = EXCLUDED.refresh_every,
        fresh_for = EXCLUDED.fresh_for;
  RETURN v_reading;
END
$f$;
REVOKE ALL ON FUNCTION public.bat_live_stream_check() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.bat_live_stream_check() IS
'Reads the BaT stream handoff''s answers: live_pull.stream_calls (stamped by bat_live_pull_run) against net._http_response, one job_assay_readings row (bat-live-stream-check), failed on not_called, not_called_with_targets, no_response, still_queued, timed_out, error or a non-2xx. Rule row live_pull.stream_probe. Migration 20261125232500.';

-- The alarm rule row: written here when job_health_alarm_rules exists (20261125090700 deployed first); otherwise by the
-- follow-up that lands after it.
DO $alarm$
BEGIN
  IF to_regclass('public.job_health_alarm_rules') IS NOT NULL THEN
    INSERT INTO public.job_health_alarm_rules (jobname, alarm_after, report_keys, basis)
    VALUES ('bat-live-stream-check', interval '15 minutes', ARRAY['targets', 'http_status', 'last_run_stream_lots'],
            'the stream covers lots in their last minutes; three failed 5-minute readings is a close missed')
    ON CONFLICT (jobname) DO NOTHING;
  END IF;
END
$alarm$;

DO $cron$
BEGIN
  IF to_regnamespace('cron') IS NOT NULL THEN
    PERFORM cron.schedule('bat-live-stream-check', '*/5 * * * *', 'SELECT public.bat_live_stream_check()');
  END IF;
END
$cron$;

COMMIT;
