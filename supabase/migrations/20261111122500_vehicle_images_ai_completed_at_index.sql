-- photo_analysis_yield_daily_refresh(2) (cron photo-analysis-yield-hourly, '17 * * * *') failed 48/48 runs
-- over 2 days with "canceling statement due to statement timeout ... line 4 at FOR over SELECT rows".
-- Its loop query
--   select distinct vi.user_id from vehicle_images vi
--   where ai_processing_status = 'completed' and ai_processing_completed_at >= now() - make_interval(hours => 2)
-- planned as a Parallel Seq Scan on vehicle_images (cost ~8.2M, fetched live 2026-11-07); no index
-- covered ai_processing_completed_at. This partial index serves that range probe.
--
-- Convention (see 20260618230325_perf_load_timeout_fixes.sql): migrations run in a transaction, so
-- CREATE INDEX CONCURRENTLY cannot live here. The sanctioned path is to build it CONCURRENTLY online first
-- under the same name; this IF NOT EXISTS statement then no-ops and keeps a fresh DB in parity.
-- If it does not exist yet, this plain build takes a write lock on vehicle_images for its duration.
--
-- NOT captured here: the live bodies of photo_analysis_yield_daily_refresh / _snapshot_run / _by_day
-- (drift, in no migration). They were not available to the author; capture them verbatim from
-- pg_get_functiondef in a follow-up rather than reconstructing them.
SET lock_timeout = '10s';
SET statement_timeout = '30min';

CREATE INDEX IF NOT EXISTS idx_vehicle_images_ai_completed_at
  ON public.vehicle_images (ai_processing_completed_at)
  WHERE ai_processing_status = 'completed';
