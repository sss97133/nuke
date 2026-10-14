-- Re-issue of 20261014012500_treemap_refresh_daily: the ledger map's clock, refreshed daily, through the cron API.
--
-- The first issue failed on apply (supabase-deploy 38504896966, 2026-10-14 03:11Z, "permission denied for table job")
-- because it updated cron.job directly; the deploy role may call cron.alter_job and cron.schedule but not write the
-- table. The transaction rolled back whole: no table, no function change, job 175 untouched (verified 03:12Z).
--
-- What this does, unchanged in intent: the ten mv_treemap_* views behind the market tab's map were refreshed every
-- 30 minutes by cron job 175 (treemap-refresh) until 2026-04-25, when the intake fleet stalled and every job was
-- paused; nothing refreshed them since. Job 175 now runs daily at 09:10 UTC with a 20-minute statement timeout,
-- treemap_refresh_all() records its clock and duration in treemap_refreshes (public read) for the map's "as of",
-- and a self-removing one-shot runs the first refresh at the next minute. Reversible:
-- select cron.alter_job(job_id := 175, active := false).
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.treemap_refreshes (
  refreshed_at timestamptz PRIMARY KEY DEFAULT now(),
  seconds numeric,
  note text
);
COMMENT ON TABLE public.treemap_refreshes IS
  'One row per refresh of the mv_treemap_* views by treemap_refresh_all(): when it finished and how long it took. The map''s "as of" clock. Refreshed daily by cron job 175 (treemap-refresh) since 2026-10-14; paused 2026-04-25..2026-10-14.';
ALTER TABLE public.treemap_refreshes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS treemap_refreshes_public_read ON public.treemap_refreshes;
CREATE POLICY treemap_refreshes_public_read ON public.treemap_refreshes FOR SELECT USING (true);
GRANT SELECT ON public.treemap_refreshes TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.treemap_refresh_all()
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE t0 timestamptz := clock_timestamp();
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_treemap_by_source;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_treemap_by_brand;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_treemap_by_segment;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_treemap_makes_by_source;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_treemap_makes_by_segment;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_treemap_models_by_brand;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_treemap_models_by_source_make;
  REFRESH MATERIALIZED VIEW mv_treemap_years;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_treemap_nested_segment;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_treemap_nested_brand;
  INSERT INTO public.treemap_refreshes (refreshed_at, seconds, note)
  VALUES (now(), round(extract(epoch FROM (clock_timestamp() - t0))::numeric, 1), 'treemap_refresh_all');
END $$;

-- Through the cron API: daily at 09:10 UTC, bounded inside pg_cron's worker.
SELECT cron.alter_job(
  job_id   := 175,
  schedule := '10 9 * * *',
  command  := $cmd$SET statement_timeout = '20min'; SELECT public.treemap_refresh_all();$cmd$,
  active   := true
);

-- The first refresh now, not tomorrow morning: a one-shot that runs at the next minute and removes itself.
SELECT cron.schedule(
  'treemap-refresh-once-20261014',
  '* * * * *',
  $once$SET statement_timeout = '20min'; SELECT public.treemap_refresh_all(); SELECT cron.unschedule('treemap-refresh-once-20261014');$once$
);

DO $check$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobid = 175 AND jobname = 'treemap-refresh' AND active AND schedule = '10 9 * * *') THEN
    RAISE EXCEPTION 'cron job 175 treemap-refresh was not re-enabled daily';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'treemap-refresh-once-20261014') THEN
    RAISE EXCEPTION 'the first-refresh one-shot was not scheduled';
  END IF;
END $check$;

COMMIT;
