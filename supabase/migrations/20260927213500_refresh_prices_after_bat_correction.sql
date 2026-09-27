-- clean_vehicle_prices after the all-BaT correction; its 6-hourly refresh back on.
-- Session cb179857, 2026-09-27.
--
-- The all-BaT correction (correct_vehicle_sale_provenance_batch, 16:12–21:30:52Z) wrote 431,591 field corrections on
-- 106,621 vehicles AFTER the prices view's last refresh (20260927180000, 15:44Z). Readers of is_sold / best_price
-- (calculate-market-indexes, compute-vehicle-valuation, extract-bat-core, the deal view's comps) see the corrected rows
-- only after a refresh. CONCURRENTLY: readers are never blocked (the BaT reader streams read this view while they run).
-- Job 147 refresh-clean-vehicle-prices (every 6 h) resumes with an explicit statement_timeout in its command: pg_cron
-- sessions get the role default (10 s), which a CONCURRENTLY refresh of ~500K rows cannot fit.

SET statement_timeout = '300s';
REFRESH MATERIALIZED VIEW CONCURRENTLY public.clean_vehicle_prices;
ANALYZE public.clean_vehicle_prices;
SET statement_timeout = '120s';

DO $do$
DECLARE v_id bigint;
BEGIN
  SELECT jobid INTO v_id FROM cron.job WHERE jobname = 'refresh-clean-vehicle-prices';
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'job refresh-clean-vehicle-prices not found';
  END IF;
  PERFORM cron.alter_job(job_id := v_id,
                         schedule := '0 */6 * * *',
                         command := $cmd$SET statement_timeout = '300s'; REFRESH MATERIALIZED VIEW CONCURRENTLY public.clean_vehicle_prices;$cmd$,
                         active := true);
END
$do$;

RESET statement_timeout;

-- POST-APPLY: SELECT count(*) FILTER (WHERE is_sold) FROM clean_vehicle_prices;  -- moves with the correction
--             SELECT active, command FROM cron.job WHERE jobname = 'refresh-clean-vehicle-prices';
