-- Phase 1 of the index audit on the other hot write tables (2026-10-15): drop btree indexes that are exact duplicates or
-- leading prefixes (same predicate, not unique, backing no constraint) of an index that stays. Read from pg_index and
-- pg_get_indexdef. Nothing unique, primary or constraint-backed is touched; every foreign-key column keeps an index
-- that leads with it. Tables with nothing redundant: vehicle_events (15 indexes), vehicle_metric_recompute_queue (2).
-- Dropped (about 980 MB, 7 indexes):
--   vehicle_images       idx_vehicle_images_coordinates 8 MB     exact duplicate of idx_vehicle_images_gps (kept)
--   vehicle_images       idx_vehicle_images_primary     22 MB    (vehicle_id) WHERE is_primary, prefix of idx_vehicle_images_vehicle_primary
--   vehicle_images       vehicle_images_vehicle_id_idx  662 MB   (vehicle_id), prefix of idx_vehicle_images_created_at (vehicle_id, created_at DESC) 825 MB
--   auction_events       idx_auction_events_source      6 MB     (source), prefix of idx_auction_events_source_source_url
--   vehicle_observations idx_observations_kind          130 MB   (kind), prefix of idx_observations_kind_time (kind, ingested_at DESC)
--   vehicle_observations idx_observations_vehicle       148 MB   (vehicle_id) WHERE vehicle_id IS NOT NULL, prefix of idx_vobs_engagement_contrib (same predicate)
--   import_queue         idx_import_queue_status        4 MB     (status), prefix of idx_import_queue_next_attempt and idx_import_queue_status_priority
-- Redundant by the rule but NOT dropped, because the index that would stay is far larger than the one that serves the
-- hot lookups: idx_observations_source (137 MB, 261k scans) under unique_observation (2,924 MB), and
-- idx_auction_events_vehicle (17 MB, 1.17M scans) under the unique idx_auction_events_vehicle_source_url (67 MB).
-- Revert (each rebuild runs outside a transaction):
--   CREATE INDEX CONCURRENTLY idx_vehicle_images_coordinates ON public.vehicle_images USING btree (latitude, longitude) WHERE ((latitude IS NOT NULL) AND (longitude IS NOT NULL));
--   CREATE INDEX CONCURRENTLY idx_vehicle_images_primary ON public.vehicle_images USING btree (vehicle_id) WHERE (is_primary = true);
--   CREATE INDEX CONCURRENTLY vehicle_images_vehicle_id_idx ON public.vehicle_images USING btree (vehicle_id);
--   CREATE INDEX CONCURRENTLY idx_auction_events_source ON public.auction_events USING btree (source);
--   CREATE INDEX CONCURRENTLY idx_observations_kind ON public.vehicle_observations USING btree (kind);
--   CREATE INDEX CONCURRENTLY idx_observations_vehicle ON public.vehicle_observations USING btree (vehicle_id) WHERE (vehicle_id IS NOT NULL);
--   CREATE INDEX CONCURRENTLY idx_import_queue_status ON public.import_queue USING btree (status);
-- DROP INDEX CONCURRENTLY cannot run in a transaction, so this file has none. It waits out older transactions on each
-- table, hence lock_timeout 120 s.
SET statement_timeout = '600s';
SET lock_timeout = '120s';
DROP INDEX CONCURRENTLY IF EXISTS public.idx_vehicle_images_coordinates;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_vehicle_images_primary;
DROP INDEX CONCURRENTLY IF EXISTS public.vehicle_images_vehicle_id_idx;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_auction_events_source;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_observations_kind;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_observations_vehicle;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_import_queue_status;
