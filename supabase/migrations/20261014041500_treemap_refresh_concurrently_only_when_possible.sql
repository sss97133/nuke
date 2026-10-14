-- treemap_refresh_all: refresh concurrently only the views that can be, and never retry a failure every minute.
--
-- Measured 2026-10-14 03:53–04:02Z: the first refresh after #1113 failed eight times, once a minute, at
-- "cannot refresh materialized view public.mv_treemap_makes_by_source concurrently": four of the ten map views
-- (mv_treemap_makes_by_source, mv_treemap_models_by_brand, mv_treemap_models_by_source_make, mv_treemap_years) have
-- no unique index, which REFRESH ... CONCURRENTLY requires. Each failed run had refreshed the first views for ~70 s
-- and rolled back. The one-shot was unscheduled and its last run cancelled by hand at 04:02Z (skylar-83).
--
-- The function now looks up, per view, whether it has a valid unique non-partial index: if so it refreshes
-- concurrently (readers keep reading), otherwise plainly (readers of that one view wait for its refresh; the
-- daily run is at 09:10 UTC). It records its clock in treemap_refreshes as before. A new one-shot runs the first
-- refresh at the next minute and unschedules itself FIRST, so a failure cannot repeat. Job 175 is unchanged
-- (daily 09:10 UTC). Reversible: the previous body is in 20261014031500_treemap_refresh_daily_reissue.sql.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.treemap_refresh_all()
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  t0 timestamptz := clock_timestamp();
  v text;
  concurrent boolean;
  n_conc int := 0;
  n_plain int := 0;
BEGIN
  FOREACH v IN ARRAY ARRAY[
    'mv_treemap_by_source', 'mv_treemap_by_brand', 'mv_treemap_by_segment',
    'mv_treemap_makes_by_source', 'mv_treemap_makes_by_segment', 'mv_treemap_models_by_brand',
    'mv_treemap_models_by_source_make', 'mv_treemap_years', 'mv_treemap_nested_segment', 'mv_treemap_nested_brand'
  ] LOOP
    CONTINUE WHEN to_regclass(format('public.%I', v)) IS NULL;
    SELECT EXISTS (
      SELECT 1 FROM pg_index i
       WHERE i.indrelid = to_regclass(format('public.%I', v))
         AND i.indisunique AND i.indisvalid AND i.indpred IS NULL
    ) INTO concurrent;
    IF concurrent THEN
      EXECUTE format('REFRESH MATERIALIZED VIEW CONCURRENTLY public.%I', v);
      n_conc := n_conc + 1;
    ELSE
      EXECUTE format('REFRESH MATERIALIZED VIEW public.%I', v);
      n_plain := n_plain + 1;
    END IF;
  END LOOP;
  INSERT INTO public.treemap_refreshes (refreshed_at, seconds, note)
  VALUES (now(), round(extract(epoch FROM (clock_timestamp() - t0))::numeric, 1),
          format('treemap_refresh_all: %s concurrently, %s plainly', n_conc, n_plain));
END $$;

-- The first refresh now. The one-shot removes itself before it refreshes, so a failure is logged once, not every minute.
SELECT cron.schedule(
  'treemap-refresh-once-20261014b',
  '* * * * *',
  $once$SELECT cron.unschedule('treemap-refresh-once-20261014b'); SET statement_timeout = '20min'; SELECT public.treemap_refresh_all();$once$
);

COMMIT;
