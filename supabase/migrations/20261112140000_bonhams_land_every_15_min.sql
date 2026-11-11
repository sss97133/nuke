-- bonhams-typesense-land: every 5 min -> every 15 min (offset kept at 4).
--
-- Measured 2026-11-09 (pg_stat_statements since the 2026-11-08 21:06Z restart, net._http_response receipts):
-- the walk is in a re-land pass (pages 577-593 of 682 between 23:34Z and 00:09Z read 800 lots, created 1, updated ~47 a page).
-- Each run's cursor read (vehicle_events by metadata ts_pass/ts_page) costs ~13.5 s and ~32k shared blocks (704 s, 1.67M blocks
-- in 52 calls), and its per-lot vehicles.discovery_url ILIKE lookups added 647 s over 5,191 calls: together ~8% of all database
-- time for about one new lot per run. A cursor state row and exact-key lookups follow in the function; this cuts the cost by
-- two thirds until then.
-- Revert: cron.alter_job(<id>, schedule := '4-59/5 * * * *').
SET lock_timeout = '5s';
SET statement_timeout = '30s';

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM cron.job WHERE jobname = 'bonhams-typesense-land';
  IF n <> 1 THEN RAISE EXCEPTION 'bonhams_land_every_15_min: expected one job, found %', n; END IF;
  PERFORM cron.alter_job(jobid, schedule := '4-59/15 * * * *') FROM cron.job WHERE jobname = 'bonhams-typesense-land';  -- was 4-59/5
END $$;
