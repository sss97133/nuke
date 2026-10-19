-- Exact-make search currently scans/sorts the qualifying make before LIMIT.
-- Match its existing rank tuple for every make; leave auto classification as
-- a reader predicate. No source rows, reader order, grants or settings change.
-- Autocommit is required: existing supabase-deploy.yml applies with psql -f.
-- A failed concurrent build is NOT accepted or automatically dropped on retry.
SET statement_timeout = '120s';
SET lock_timeout = '10s';

DO $preflight$
DECLARE
  target oid := to_regclass('public.idx_vehicles_public_make_search_rank');
  expected constant text := 'CREATE INDEX idx_vehicles_public_make_search_rank ON public.vehicles USING btree (make, ((primary_image_url IS NOT NULL)) DESC, COALESCE(image_count, 0) DESC, COALESCE(bat_view_count, view_count, 0) DESC, sale_price DESC NULLS LAST, year DESC, id) WHERE ((is_public = true) AND (deleted_at IS NULL) AND (listing_kind IS DISTINCT FROM ''non_vehicle_item''::text) AND (year IS NOT NULL) AND (make IS NOT NULL) AND (model IS NOT NULL))';
BEGIN
  IF EXISTS (SELECT FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND wait_event_type = 'Lock')
    OR EXISTS (SELECT FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND datname = current_database()
      AND state IN ('idle in transaction', 'idle in transaction (aborted)'))
    OR EXISTS (SELECT FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND datname = current_database()
      AND state = 'active' AND query ~* '(\mvehicles\M|search_vehicles_)')
    OR EXISTS (SELECT FROM pg_stat_progress_create_index WHERE pid <> pg_backend_pid())
  THEN
    RAISE EXCEPTION 'Search rank index requires an idle DDL lane without lock waiters, idle transactions or active builds';
  END IF;

  IF target IS NOT NULL AND (
    NOT EXISTS (SELECT FROM pg_index WHERE indexrelid = target AND indrelid = 'public.vehicles'::regclass
      AND indisvalid AND indisready AND indislive)
    OR pg_get_indexdef(target) IS DISTINCT FROM expected
  ) THEN
    RAISE EXCEPTION 'Search rank index conflict or invalid state; inspect the existing object before retry: %', pg_get_indexdef(target);
  END IF;
END
$preflight$;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vehicles_public_make_search_rank
ON public.vehicles USING btree (
  make,
  (primary_image_url IS NOT NULL) DESC,
  (COALESCE(image_count, 0)) DESC,
  (COALESCE(bat_view_count, view_count, 0)) DESC,
  sale_price DESC NULLS LAST,
  year DESC,
  id
)
WHERE is_public = true
  AND deleted_at IS NULL
  AND listing_kind IS DISTINCT FROM 'non_vehicle_item'
  AND year IS NOT NULL AND make IS NOT NULL AND model IS NOT NULL;

DO $verify$
DECLARE
  target oid := to_regclass('public.idx_vehicles_public_make_search_rank');
  expected constant text := 'CREATE INDEX idx_vehicles_public_make_search_rank ON public.vehicles USING btree (make, ((primary_image_url IS NOT NULL)) DESC, COALESCE(image_count, 0) DESC, COALESCE(bat_view_count, view_count, 0) DESC, sale_price DESC NULLS LAST, year DESC, id) WHERE ((is_public = true) AND (deleted_at IS NULL) AND (listing_kind IS DISTINCT FROM ''non_vehicle_item''::text) AND (year IS NOT NULL) AND (make IS NOT NULL) AND (model IS NOT NULL))';
BEGIN
  IF target IS NULL OR NOT EXISTS (
    SELECT FROM pg_index WHERE indexrelid = target AND indrelid = 'public.vehicles'::regclass
      AND indisvalid AND indisready AND indislive
  ) OR pg_get_indexdef(target) IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'Search rank index is not ready/valid with the expected definition after build';
  END IF;
  IF EXISTS (SELECT FROM pg_stat_activity WHERE wait_event_type = 'Lock') THEN
    RAISE EXCEPTION 'Lock waiters observed after search rank index build; stop and inspect';
  END IF;
END
$verify$;

SELECT count(*) AS lock_waiters_after_search_rank_index FROM pg_stat_activity WHERE wait_event_type = 'Lock';
RESET lock_timeout;
RESET statement_timeout;
