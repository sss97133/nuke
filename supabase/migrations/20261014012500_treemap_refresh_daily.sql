-- The ledger map's clock: refresh its views daily again, and record when.
--
-- The ten mv_treemap_* views behind the market tab's map (884,883 vehicles with a recorded price, medians by make,
-- model and year) were refreshed by cron job 175 (treemap-refresh, every 30 min) until 2026-04-25, when the whole
-- intake fleet stalled on pg_cron worker timeouts and every job was paused. Nothing refreshed them since: the map
-- a visitor opens today is April's. The page says "as of the last refresh of the ledger's views" because no clock
-- of that refresh exists anywhere.
--
-- This re-enables the job once a day at a quiet hour (09:10 UTC, after the 06:20 UTC README stats run) instead of
-- every 30 minutes, bounds it with a statement timeout, and has the refresh write its own clock and duration to
-- treemap_refreshes, which the map reads for its "as of". Reversible: cron.alter_job(175, active := false).
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.treemap_refreshes (
  refreshed_at timestamptz PRIMARY KEY DEFAULT now(),
  seconds numeric,
  note text
);
COMMENT ON TABLE public.treemap_refreshes IS
  'One row per refresh of the mv_treemap_* views by treemap_refresh_all(): when it finished and how long it took. The map''s "as of" clock. Refreshes run daily by cron job 175 (treemap-refresh) since 2026-10-14; paused 2026-04-25..2026-10-14.';
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

-- The refresh runs inside pg_cron's worker: bound it so a stuck refresh cannot hold the worker for hours.
UPDATE cron.job
   SET schedule = '10 9 * * *',
       command  = $cmd$SET statement_timeout = '20min'; SELECT public.treemap_refresh_all();$cmd$,
       active   = true
 WHERE jobid = 175 AND jobname = 'treemap-refresh';

DO $check$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobid = 175 AND jobname = 'treemap-refresh' AND active AND schedule = '10 9 * * *') THEN
    RAISE EXCEPTION 'cron job 175 treemap-refresh was not re-enabled daily';
  END IF;
END $check$;

-- The first refresh now, not tomorrow morning: a one-shot job that runs at the next minute and removes itself
-- (the pattern of migration 20261001150000). The daily job carries on from 09:10 UTC.
SELECT cron.schedule(
  'treemap-refresh-once-20261014',
  '* * * * *',
  $once$SET statement_timeout = '20min'; SELECT public.treemap_refresh_all(); SELECT cron.unschedule('treemap-refresh-once-20261014');$once$
);

COMMIT;
