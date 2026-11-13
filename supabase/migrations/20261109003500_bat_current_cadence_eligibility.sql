-- A successful daily read must become eligible when its lot enters the existing
-- six-hour/hourly cadence. Keep slots, pause, sessions, in-flight and retry rules.
-- Change only the due predicate in the deployed body, preserving later repairs.
SELECT current_setting('statement_timeout') AS statement_timeout,
       current_setting('lock_timeout') AS lock_timeout \gset bat_cadence_prior_
SELECT set_config('statement_timeout',
  CASE WHEN current_setting('statement_timeout')::interval = interval '0'
    OR current_setting('statement_timeout')::interval > interval '10 seconds'
    THEN '10s' ELSE current_setting('statement_timeout') END, false);
SELECT set_config('lock_timeout',
  CASE WHEN current_setting('lock_timeout')::interval = interval '0'
    OR current_setting('lock_timeout')::interval > interval '2 seconds'
    THEN '2s' ELSE current_setting('lock_timeout') END, false);
DO $repair$
DECLARE
  body text := pg_get_functiondef('public.bat_live_pull_run(integer,boolean)'::regprocedure);
  anchor text := $old$AND (m.next_poll_at IS NULL OR m.next_poll_at <= v_now
               OR (m.auction_end_time <= v_now + interval '10 minutes'$old$;
  replacement text := $new$AND (m.next_poll_at IS NULL OR m.next_poll_at <= v_now
               -- Current cadence transition; failed reads retain their retry backoff.
               OR (m.sync_latency_ms IS NOT NULL
                   AND m.last_comment_synced_at >= m.last_synced_at
                   AND m.auction_end_time > v_now + interval '10 minutes'
                   AND EXISTS (
                     SELECT 1 FROM (SELECT CASE
                       WHEN m.auction_end_time <= v_now + interval '12 hours' THEN make_interval(mins => coalesce(CASE WHEN v_cfg #>> '{cadence_minutes,under_12h}' ~ '^\d{1,6}$' THEN (v_cfg #>> '{cadence_minutes,under_12h}')::integer END, 60))
                       WHEN m.auction_end_time <= v_now + v_window THEN make_interval(mins => coalesce(CASE WHEN v_cfg #>> '{cadence_minutes,h12_to_48}' ~ '^\d{1,6}$' THEN (v_cfg #>> '{cadence_minutes,h12_to_48}')::integer END, 360))
                       ELSE make_interval(mins => coalesce(CASE WHEN v_cfg #>> '{cadence_minutes,over_48h}' ~ '^\d{1,6}$' THEN (v_cfg #>> '{cadence_minutes,over_48h}')::integer END, 1440))
                     END AS interval) cadence
                     WHERE m.poll_interval_ms > extract(epoch FROM cadence.interval) * 1000
                       AND m.last_synced_at <= v_now - cadence.interval))
               OR (m.auction_end_time <= v_now + interval '10 minutes'$new$;
BEGIN
  IF strpos(body, replacement) > 0 THEN RETURN; END IF;
  IF (length(body)-length(replace(body,anchor,'')))/length(anchor) <> 1 THEN
    RAISE EXCEPTION 'Unexpected BaT due predicate; review current scheduler before replacing';
  END IF;
  EXECUTE replace(body,anchor,replacement);
END;
$repair$;
SET statement_timeout = :'bat_cadence_prior_statement_timeout';
SET lock_timeout = :'bat_cadence_prior_lock_timeout';
