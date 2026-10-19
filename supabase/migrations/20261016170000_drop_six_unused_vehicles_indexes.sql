-- Phase 2 of the public.vehicles index audit (2026-10-15): drop six indexes that no reader needs. Approved by the lead.
-- Evidence (report: ~/nuke-logs/vehicles-index-audit-20261015.md): 0 scans since the 03:00Z restart; no code under
-- supabase/functions, scripts or nuke_frontend/src filters vehicles by era, is_daily_driver or owner_shop_id; no view or
-- matview filters them (the 106 views and matviews that read vehicles.make, is_public, source, era, is_daily_driver or
-- owner_shop_id were read from pg_get_viewdef: era, is_daily_driver and owner_shop_id only appear in select lists, and
-- none filters (make, source) together). EXPLAIN (no ANALYZE) of the search reader (search_vector, make), the feed reader
-- (created_at desc) and the year/price orderings chooses vehicles_search_idx, idx_vehicles_feed_main,
-- idx_vehicles_make_trgm_raw and idx_vehicles_sale_price, none of the six. A hide-and-explain with DROP INDEX in a
-- rolled-back transaction was skipped on purpose: it needs ACCESS EXCLUSIVE on a 2.4 GB table under intake load.
--   idx_vehicles_era               22 MB  (era) WHERE era IS NOT NULL AND is_public
--   idx_vehicles_daily_driver      20 MB  (is_daily_driver)
--   idx_vehicles_lower_make_public 21 MB  (lower(make)) WHERE is_public; subsumed by idx_vehicles_lower_make_model
--   idx_vehicles_public            25 MB  (is_public), a boolean
--   idx_vehicles_make_source       53 MB  (make, source) WHERE is_public AND make IS NOT NULL
--   idx_vehicles_owner_shop        20 MB  (owner_shop_id); its FK points at the archived shops_archived_20260129
-- Kept on purpose: idx_vehicles_current_transfer and idx_vehicles_origin_org back foreign keys to live tables.
-- Revert (each rebuild runs outside a transaction):
--   CREATE INDEX CONCURRENTLY idx_vehicles_era ON public.vehicles USING btree (era) WHERE ((era IS NOT NULL) AND (is_public = true));
--   CREATE INDEX CONCURRENTLY idx_vehicles_daily_driver ON public.vehicles USING btree (is_daily_driver);
--   CREATE INDEX CONCURRENTLY idx_vehicles_lower_make_public ON public.vehicles USING btree (lower(make)) WHERE (is_public = true);
--   CREATE INDEX CONCURRENTLY idx_vehicles_public ON public.vehicles USING btree (is_public);
--   CREATE INDEX CONCURRENTLY idx_vehicles_make_source ON public.vehicles USING btree (make, source) WHERE ((is_public = true) AND (make IS NOT NULL));
--   CREATE INDEX CONCURRENTLY idx_vehicles_owner_shop ON public.vehicles USING btree (owner_shop_id);
-- DROP INDEX CONCURRENTLY cannot run in a transaction, so this file has none. It waits out older transactions on
-- vehicles (the first idx_vehicles_year drop timed out at 5 s under intake load), hence lock_timeout 120 s.
SET statement_timeout = '600s';
SET lock_timeout = '120s';
DROP INDEX CONCURRENTLY IF EXISTS public.idx_vehicles_era;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_vehicles_daily_driver;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_vehicles_lower_make_public;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_vehicles_public;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_vehicles_make_source;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_vehicles_owner_shop;
