-- vehicles.merged_into_vehicle_id is set only by the merge writers, never by a client write.
--
-- Why (ta-skeptic2, PG17, live bodies, 2026-11-25). authenticated holds table-level INSERT and UPDATE on vehicles, and the
-- own-row policies admit merged_into_vehicle_id; no trigger watched it. A new sign-up inserts a car with user_id = self and
-- merged_into_vehicle_id = <someone else's car>; vehicle_merge_terminal then follows the pointer, so
-- user_associated_vehicle_ids(self) returns the other car and device_file_media_document files a capture onto it.
-- merge_duplicate_vehicles requires edit rights on both cars; the raw column skipped that check. No client writes it.
--
-- The guard: BEFORE INSERT OR UPDATE OF merged_into_vehicle_id. A write running as anon or authenticated (a PostgREST
-- client write, or an invoker function it calls) may clear the pointer (unmerge_vehicle sets NULL) but not set or move it.
-- The merge writers are SECURITY DEFINER owned by postgres (merge_duplicate_vehicles, fold_vehicle_into_primary_supersede,
-- merge_vehicle_into_primary_by_url, merge_craigslist_duplicates_by_image_signature, revert_vehicle_fold_run), or invoker
-- functions not executable by clients (merge_into_primary, merge_into_primary_batch), so they run as their owner or as
-- service_role, and pass. The function is not SECURITY DEFINER: current_user is the role the write runs as.
--
-- Locks: CREATE TRIGGER takes SHARE ROW EXCLUSIVE on vehicles for the catalog change only; lock_timeout 3 s.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.vehicles_merge_pointer_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'pg_catalog', 'public' AS $function$
BEGIN
  IF current_user IN ('anon', 'authenticated')
     AND NEW.merged_into_vehicle_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.merged_into_vehicle_id IS DISTINCT FROM OLD.merged_into_vehicle_id) THEN
    RAISE EXCEPTION 'vehicles.merged_into_vehicle_id is set only by the merge writers (merge_duplicate_vehicles)'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION public.vehicles_merge_pointer_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS vehicles_merge_pointer_guard ON public.vehicles;
CREATE TRIGGER vehicles_merge_pointer_guard
  BEFORE INSERT OR UPDATE OF merged_into_vehicle_id ON public.vehicles
  FOR EACH ROW EXECUTE FUNCTION public.vehicles_merge_pointer_guard();

COMMIT;
