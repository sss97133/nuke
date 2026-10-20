-- Retire vehicle_map_county_listings (20261020004000): the one map's first listing fold, superseded by map_facts.
--
-- WHY. The owner retired the old maps on 2026-10-20 ("send it"). map_facts (20261020220000) holds the listing layer
-- at state, county and ZIP level with the same rule over a longer horizon, refreshed every 10 minutes and nightly;
-- /map (#2357) reads location rows and map_facts, and the reader's county-listing path that read this view is
-- removed in the same change. Keeping the hourly refresh would be an hourly scan of 30 days of location rows for a
-- view nothing reads. map_layers.listing.fold already names map_facts (20261020220000).
--
-- WHAT. Unschedule cron vehicle-map-county-listings, drop refresh_vehicle_map_county_listings() and the view with its
-- indexes. Reversible by re-applying 20261020004000. No testimony is touched: the view was derived.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'vehicle-map-county-listings';
DROP FUNCTION IF EXISTS public.refresh_vehicle_map_county_listings();
DROP MATERIALIZED VIEW IF EXISTS public.vehicle_map_county_listings;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'vehicle-map-county-listings')
     OR to_regclass('public.vehicle_map_county_listings') IS NOT NULL THEN
    RAISE EXCEPTION 'vehicle_map_county_listings is still present';
  END IF;
END $$;
COMMIT;
