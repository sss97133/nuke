SET statement_timeout = '45min';
SET lock_timeout = '15min';
-- idx_vehicle_images_gps_cover: the photo-GPS readers answer from a small partial index instead of the 57 GB heap.
--
-- WHY. Two readers touch every GPS photo they need through the heap:
--   admit_photo_gps_locations (cron photo-gps-location, 60 s statement timeout) reads the ~46,500 eligible GPS photos
--     through idx_vehicle_images_gps, then a heap fetch for each, scattered over the 57 GB heap. Its runs on
--     2026-11-12 took 19.5 s, 38.5 s and 47.5 s.
--   vehicle_location_fold (vehicle_location_areas, get_field_provenance 'location') looks up each admitted photo by
--     primary key, about 5 buffers a photo. 043c6d8b has 2,476 photos: 61 ms warm, 4-15 s cold (anon hit its 15 s
--     statement timeout, 500, twice on 2026-11-12).
-- 99.4% of vehicle_images pages are all-visible (relallvisible 7,486,863 of 7,533,363 on 2026-11-12), so an index
-- holding every column both readers test answers them with index-only scans.
--
-- WHAT. A partial btree on (vehicle_id, id), INCLUDE the columns the readers test, WHERE the photo has a point and an
-- image URL (the writer's own predicates). About 46,500 entries. The fold gains the same latitude/longitude test in
-- 20261116026000 so the planner can use it.
--
-- BUILD. Through supabase-deploy, as 20261006121500 built its GIN index: SET statement_timeout is this file's first
-- statement, before any transaction, so it governs the build over the deploy's 120 s PGOPTIONS and the postgres
-- role's 10 s. CREATE INDEX CONCURRENTLY scans the whole 57 GB heap without blocking writes. lock_timeout is long
-- because a concurrent build waits for older transactions at each phase; giving up there would leave an INVALID
-- index (maintained on every write, read by nothing). If the build fails anyway, a follow-up migration drops it with
-- DROP INDEX CONCURRENTLY IF EXISTS. Merged right after a :17 photo-gps-location run, memory headroom checked first.
-- Reversal: DROP INDEX CONCURRENTLY public.idx_vehicle_images_gps_cover;

DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_index WHERE indexrelid = to_regclass('public.idx_vehicle_images_gps_cover') AND NOT indisvalid) THEN
    RAISE EXCEPTION 'idx_vehicle_images_gps_cover exists but is INVALID; drop it CONCURRENTLY and rebuild';
  END IF;
END $guard$;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vehicle_images_gps_cover
  ON public.vehicle_images (vehicle_id, id)
  INCLUDE (taken_at, latitude, longitude, is_sensitive, is_superseded, is_duplicate, vision_gate_status,
           image_vehicle_match_status)
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL AND nullif(btrim(image_url), '') IS NOT NULL;
RESET lock_timeout;
RESET statement_timeout;

COMMENT ON INDEX public.idx_vehicle_images_gps_cover IS
'Photo-GPS covering index (20261116025000): every column admit_photo_gps_locations and vehicle_location_fold test, for photos with a point and an image URL, so both answer by index-only scan. Built CONCURRENTLY by supabase-deploy.';

DO $check$
DECLARE d text;
BEGIN
  SELECT pg_get_indexdef(i.indexrelid) INTO d FROM pg_index i
   WHERE i.indexrelid = to_regclass('public.idx_vehicle_images_gps_cover') AND i.indisvalid;
  IF d IS NULL OR d NOT LIKE '%(vehicle_id, id) INCLUDE (taken_at, latitude, longitude, is_sensitive, is_superseded, is_duplicate, vision_gate_status, image_vehicle_match_status) WHERE ((latitude IS NOT NULL) AND (longitude IS NOT NULL) AND (NULLIF(btrim(image_url),%' THEN
    RAISE EXCEPTION 'idx_vehicle_images_gps_cover not as intended: %', d;
  END IF;
END $check$;
