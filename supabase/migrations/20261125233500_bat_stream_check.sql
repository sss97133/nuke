-- bat_live_stream_check_v1: a job reads every answer of the BaT stream handoff.
--
-- WHY. The handoff (extract-bat-core live_stream -> ingest-observation closingBatTargets) answered HTTP 500 to all 304
-- calls from 2026-11-24 21:08 PT to 2026-11-25 02:45 PT (net._http_response, read 03:15 PT; pg_net ttl 6 h), and nothing
-- read those answers: bat-live-pull's own assay (get_live_auction_health) reads failed whenever settled lots from the
-- last 24 h are uncovered, so a stream failure hung on it would not show.
--
-- WHAT. Rows, a function, a job. Stacked on 20261125090700 (job_health_alarm_rules, the assay episode trigger) and on
-- 20261125232500 (live_pull.stream_probe and the stamps live_pull.stream_calls {request_id, at, kind, targets}).
--   1. Rule row live_auction_sources (bat) scraping_config.live_pull.stream_check = {response_wait_minutes 3,
--      missed_slack_minutes 5, basis}, written only if absent.
--   2. bat_live_stream_check(): one job_assay_readings row 'bat-live-stream-check' (v_job_health shows it,
--      20261125213500; the assay trigger of 20261125090700 folds it into an episode). failed when:
--        not_called               no call in 2 * stream_probe.every_minutes + missed_slack_minutes;
--        not_called_with_targets  the puller's last run had stream lots and made no call;
--        no_response / timed_out / error / http_<code>  for the newest call that is answered or older than
--                                 response_wait_minutes (a younger unanswered call is skipped, the one before it is read).
--      passed on a 2xx. With only a young unanswered call it writes nothing (the previous reading stands, 15 min).
--   3. job_health_alarm_rules row: bat-live-stream-check, alarm_after 15 minutes.
--   4. cron bat-live-stream-check, every 5 minutes.
--
-- BASIS. response_wait_minutes 3: the puller posts with a 150 s timeout. missed_slack_minutes 5: one check interval.
-- alarm_after 15 minutes: three failed readings.
--
-- REVERT. cron.unschedule('bat-live-stream-check'); delete the alarm rule row; drop bat_live_stream_check().

SET lock_timeout = '5s';

UPDATE public.live_auction_sources
SET scraping_config = jsonb_set(coalesce(scraping_config, '{}'::jsonb), '{live_pull}',
      coalesce(scraping_config -> 'live_pull', '{}'::jsonb) || jsonb_build_object('stream_check', jsonb_build_object(
        'response_wait_minutes', 3,
        'missed_slack_minutes', 5,
        'basis', 'wait 3 min: the puller posts with a 150 s timeout; slack 5 min: one check interval')))
WHERE slug = 'bat'
  AND scraping_config #> '{live_pull,stream_check}' IS NULL;

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
  v_wait  := CASE WHEN v_cfg #>> '{stream_check,response_wait_minutes}' ~ '^[0-9]{1,4}$'
                  THEN (v_cfg #>> '{stream_check,response_wait_minutes}')::integer END;
  v_slack := CASE WHEN v_cfg #>> '{stream_check,missed_slack_minutes}' ~ '^[0-9]{1,4}$'
                  THEN (v_cfg #>> '{stream_check,missed_slack_minutes}')::integer END;
  IF v_every IS NULL OR v_wait IS NULL OR v_slack IS NULL THEN
    RAISE EXCEPTION 'bat_live_stream_check: rule rows live_pull.stream_probe.every_minutes and live_pull.stream_check (response_wait_minutes, missed_slack_minutes) missing or malformed';
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
    -- The newest call that is answered or old enough to have been; a younger unanswered call is skipped.
    FOR c IN SELECT e, o FROM jsonb_array_elements(v_calls) WITH ORDINALITY t(e, o) ORDER BY o DESC LOOP
      CONTINUE WHEN coalesce(c.e ->> 'request_id', '') !~ '^[0-9]{1,18}$'
                 OR NOT coalesce(pg_input_is_valid(c.e ->> 'at', 'timestamp with time zone'), false);
      SELECT true, r.status_code, r.timed_out, r.error_msg INTO v_found, v_code, v_timed, v_err
        FROM net._http_response r WHERE r.id = (c.e ->> 'request_id')::bigint;
      v_found := coalesce(v_found, false);
      IF v_found OR (c.e ->> 'at')::timestamptz <= v_now - make_interval(mins => v_wait) THEN
        v_call := c.e;
        EXIT;
      END IF;
    END LOOP;
    IF v_call IS NULL THEN
      RETURN jsonb_build_object('status', 'pending', 'checked_at', v_now, 'calls', jsonb_array_length(v_calls));
    END IF;
    v_status := 'failed';
    v_reason := CASE WHEN NOT v_found THEN 'no_response'
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
'Reads the BaT stream handoff''s answers: live_pull.stream_calls (stamped by bat_live_pull_run) against net._http_response, one job_assay_readings row (bat-live-stream-check), failed on not_called, not_called_with_targets, no_response, timed_out, error or a non-2xx. Rule rows live_pull.stream_probe (20261125232500) and live_pull.stream_check. Migration 20261125233500.';

INSERT INTO public.job_health_alarm_rules (jobname, alarm_after, report_keys, basis)
VALUES ('bat-live-stream-check', interval '15 minutes', ARRAY['targets', 'http_status', 'last_run_stream_lots'],
        'the stream covers lots in their last minutes; three failed 5-minute readings is a close missed')
ON CONFLICT (jobname) DO NOTHING;

DO $cron$
BEGIN
  IF to_regnamespace('cron') IS NOT NULL THEN
    PERFORM cron.schedule('bat-live-stream-check', '*/5 * * * *', 'SELECT public.bat_live_stream_check()');
  END IF;
END
$cron$;
