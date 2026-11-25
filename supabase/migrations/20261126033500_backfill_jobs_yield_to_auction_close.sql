-- data-set-grades-backfill and data-set-public-counts skip a run while auctions close.
--
-- WHY (prod, 2026-11-25, lead's ruling on the war board). bat-live-pull's median run went from 2.5-2.8 s to 8-14.6 s
-- since the evening of 11-24, waiting on IO:DataFileRead. Since that evening it shares the disk with
-- data-set-grades-backfill (every minute: 716 calls, 6.47M shared blocks read, 13.6 s mean) and data-set-public-counts
-- (every 5 minutes: 149 calls, 8.25M blocks read, 55 s mean). Figures are from pg_stat_statements at 14:23Z, and both
-- jobs began after its 11-11 reset. Both are backfills that can wait.
--
-- RULE ROW. platform_config 'auction_close_yield': jobs (the cron job names that yield; retained-projection-grade is
-- listed for ta-readers' tick in 20261126111500, which calls this reader itself), minutes_before_end 30,
-- minutes_after_end 15, soft_close_max_minutes 60, basis.
--
-- READER. public.auction_close_yield(job) is true when the job is listed and a monitored_auctions row is_live with:
--   - auction_end_time inside (now - minutes_after_end, now + minutes_before_end], or
--   - is_in_soft_close and auction_end_time inside the last soft_close_max_minutes.
-- The flags are not trusted alone. On 2026-11-25 all 1,777 is_in_soft_close rows had ended more than an hour earlier,
-- and 141 is_live rows likewise, so every test is bounded by the end time. A job not listed is false (runs). A missing
-- or malformed rule row raises, so the job turns red with the reason rather than running or skipping silently.
-- Measured read-only (EXPLAIN ANALYZE, 14:30Z): seq scan of 13,848 rows, 96 ms, 4,049 buffers, all hit.
--
-- JOBS. The same names, schedules and commands, re-scheduled by name (cron.schedule replaces a job of the same name;
-- nothing is unscheduled). Each call gains WHERE NOT public.auction_close_yield('<job>'), a one-time filter, so the
-- backfill function is not called while lots close. cron.job_run_details then shows SELECT 0 for a yielded run and
-- SELECT 1 for a run that worked, and the jobs resume by themselves once the window is empty. Function bodies are not
-- changed. REVERT: re-schedule the commands without the WHERE clause.
SET lock_timeout = '5s';
SET statement_timeout = '30s';

INSERT INTO public.platform_config (config_key, config_value, description)
VALUES ('auction_close_yield',
  jsonb_build_object(
    'jobs', jsonb_build_array('data-set-grades-backfill', 'data-set-public-counts', 'retained-projection-grade'),
    'minutes_before_end', 30,
    'minutes_after_end', 15,
    'soft_close_max_minutes', 60,
    'basis', 'bat-live-pull median run 2.5-2.8 s -> 8-14.6 s on IO:DataFileRead after these backfills started (2026-11-24 evening); lead ruling 2026-11-25: backfills yield while lots close'),
  'Cron jobs listed here skip a run while a monitored auction ends within minutes_before_end, ended under minutes_after_end ago, or is in soft close (ended under soft_close_max_minutes ago). Read by public.auction_close_yield(job).')
ON CONFLICT (config_key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.auction_close_yield(p_job text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $f$
DECLARE
  r jsonb := (SELECT config_value FROM public.platform_config WHERE config_key = 'auction_close_yield');
  v_before integer;
  v_after integer;
  v_soft integer;
BEGIN
  IF r IS NULL OR jsonb_typeof(r -> 'jobs') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'auction_close_yield: rule row platform_config auction_close_yield is missing or has no jobs array';
  END IF;
  IF NOT (r -> 'jobs') ? p_job THEN
    RETURN false;
  END IF;
  v_before := CASE WHEN r ->> 'minutes_before_end' ~ '^\d{1,3}$' THEN (r ->> 'minutes_before_end')::integer END;
  v_after := CASE WHEN r ->> 'minutes_after_end' ~ '^\d{1,3}$' THEN (r ->> 'minutes_after_end')::integer END;
  v_soft := CASE WHEN r ->> 'soft_close_max_minutes' ~ '^\d{1,3}$' THEN (r ->> 'soft_close_max_minutes')::integer END;
  IF v_before IS NULL OR v_after IS NULL OR v_soft IS NULL THEN
    RAISE EXCEPTION 'auction_close_yield: rule row needs minutes_before_end, minutes_after_end and soft_close_max_minutes as whole minutes';
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.monitored_auctions m
     WHERE m.is_live
       AND ((m.auction_end_time > now() - make_interval(mins => v_after)
             AND m.auction_end_time <= now() + make_interval(mins => v_before))
         OR (m.is_in_soft_close AND m.auction_end_time > now() - make_interval(mins => v_soft))));
END
$f$;
REVOKE ALL ON FUNCTION public.auction_close_yield(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auction_close_yield(text) TO service_role;
COMMENT ON FUNCTION public.auction_close_yield(text) IS
  'True while the named cron job must skip a run because monitored auctions are closing (rule row platform_config auction_close_yield). Called in the job command as WHERE NOT auction_close_yield(job).';

DO $cron$
BEGIN
  IF to_regnamespace('cron') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'data-set-grades-backfill') THEN
      PERFORM cron.schedule('data-set-grades-backfill', '* * * * *',
        $cmd$SET client_min_messages = error; SET statement_timeout = '55s'; SET lock_timeout = '5s'; SELECT public.data_set_grades_backfill_v1(600) WHERE NOT public.auction_close_yield('data-set-grades-backfill');$cmd$);
    END IF;
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'data-set-public-counts') THEN
      PERFORM cron.schedule('data-set-public-counts', '*/5 * * * *',
        $cmd$SET statement_timeout = '120s'; SET lock_timeout = '5s'; SELECT public.data_set_public_counts_refresh_v2(90000) WHERE NOT public.auction_close_yield('data-set-public-counts');$cmd$);
    END IF;
  END IF;
END
$cron$;

RESET statement_timeout;
RESET lock_timeout;
