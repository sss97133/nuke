-- The garage cover reader ranks whole-car frames without reading the photo-reading column through the view.
--
-- Before (prod, read-only, 2026-11-25):
--   * get_first_image_batch(uuid[]) (invoker, anon EXECUTE, LANGUAGE sql) ranks every candidate photo of each car with
--     garage_cover_class(zone, angle, category, vi.ai_scan_metadata->'byok_deep_analysis'), reading vi from
--     vehicle_images_public. With #3935 (20261125200000), that column becomes a per-row lateral call to the id-keyed
--     reader vehicle_image_scan_metadata(id), about 1.7 ms a photo on prod (825 ms per 481 photos, upper bound). The
--     sort needs the class of every candidate before LIMIT 1, so the reader runs once per candidate row: on PG17, 474
--     calls for 474 rows. pg_stats estimate (vehicle_id MCV list, all photos, a floor): 98 public cars over 4,000
--     photos, 26 over 8,800 (anon's 15 s at 1.7 ms), the largest about 12,800. One such car in a garage batch passes
--     anon's statement_timeout.
--   * After #3935 the stranger's copy of the reading has its narrative withheld, so the class (which reads the
--     narrative's words for the view) would also change which frame is the cover for logged-out viewers.
--
-- Changes:
--   1. vehicle_image_cover_class(p_image_id uuid) RETURNS integer, SECURITY DEFINER: the same garage_cover_class over the
--      photo row's own zone, angle (ai_detected_angle, else angle), category and stored reading. It returns only the
--      class (an integer, lower is a better whole-car cover), never the reading. Its visibility test is the one
--      vehicle_image_scan_metadata (20261125200000) states: the caller uploaded the photo, or it is not sensitive, on a
--      public non-deleted car and gallery-eligible (vehicle_image_gallery_eligible over the base row), or the caller is
--      tied (vehicle_viewer_tied: owner fields, access rows, service_role); otherwise NULL. Every term is COALESCEd.
--      Registered in private_row_policy_copies (vehicle_images, d00a311f..., checked live) as that reader is.
--   2. get_first_image_batch: an anchored edit replaces the one garage_cover_class(... vi.ai_scan_metadata ...) call with
--      vehicle_image_cover_class(vi.id). The call sits inside the existing CASE, so it runs only for approved frames no
--      cheap reading places elsewhere; the ranked query no longer names the view's ai_scan_metadata, so the planner
--      drops that column (and, under #3935, its per-row reader call). The admission step's whole-row gallery test
--      inlines to the columns it reads, so it calls no reader either (PG17 on production's view, overload and the
--      #3935 migration: 32 reader calls before, 0 after, with the ten best frames failing admission).
--   Covers are unchanged today: the class is computed from the same stored reading the view returns now. Under #3935
--   they stay the same for every viewer instead of shifting for logged-out ones.
-- Cost (prod, read-only, one public car with 1,542 qualifying frames of 2,746, warm): the class over those frames
-- 540 ms (the work today's body already does through the view), the gallery test's privacy rule over them 90 ms.
-- The heaviest public car (12,688 candidates) has 0 qualifying frames, so 0 helper calls.
-- Contract: supabase/sql/test_cover_class_no_view_scan.sql. Revert: supabase/sql/revert_20261126103000_cover_class_no_view_scan.sql.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $guard$
BEGIN
  IF to_regprocedure('public.garage_cover_class(text, text, text, jsonb)') IS NULL
     OR to_regprocedure('public.get_first_image_batch(uuid[])') IS NULL
     OR to_regprocedure('public.vehicle_viewer_tied(uuid)') IS NULL THEN
    RAISE EXCEPTION 'garage_cover_class, get_first_image_batch or vehicle_viewer_tied is missing';
  END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION public.vehicle_image_cover_class(p_image_id uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE SECURITY DEFINER COST 5
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  vi public.vehicle_images;
  v_uid uuid := auth.uid();
BEGIN
  -- cover_class_no_view_scan_v1 (20261126103000): the class only, from the photo row's own fields and stored reading,
  -- behind the visibility test of vehicle_image_scan_metadata (uploader, or shown on a public non-deleted car, or tied)
  SELECT * INTO vi FROM public.vehicle_images i WHERE i.id = p_image_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF NOT (COALESCE(v_uid IS NOT NULL AND vi.user_id = v_uid, false)
          OR COALESCE(COALESCE(vi.is_sensitive, false) = false
                      AND EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = vi.vehicle_id AND v.is_public = true AND v.deleted_at IS NULL)
                      AND public.vehicle_image_gallery_eligible(vi), false)
          OR COALESCE(public.vehicle_viewer_tied(vi.vehicle_id), false)) THEN
    RETURN NULL;
  END IF;
  RETURN public.garage_cover_class(vi.vehicle_zone, coalesce(vi.ai_detected_angle, vi.angle), vi.image_category,
                                   vi.ai_scan_metadata -> 'byok_deep_analysis');
END
$function$;

REVOKE ALL ON FUNCTION public.vehicle_image_cover_class(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vehicle_image_cover_class(uuid) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.vehicle_image_cover_class(uuid) IS
  'Whole-car cover class (garage_cover_class) of one photo from its own row; NULL unless the caller uploaded it, it is shown (gallery-eligible, not sensitive) on a public non-deleted car, or the caller is tied. Returns no reading text. 20261126103000.';

-- The read policies this helper restates must be the ones it was written against: vehicle_images SELECT/ALL policies
-- hash d00a311f... on production since #3971 (20261125 05:25 PT). Any other live hash stops the migration, so the
-- registry never records a hash the drift watch would flag on its first run.
DO $reg$
DECLARE v_live text;
BEGIN
  IF to_regclass('public.private_row_policy_copies') IS NOT NULL THEN
    SELECT h.policy_hash INTO v_live FROM public.private_row_policy_hash('vehicle_images', 'p.cmd IN (''SELECT'', ''ALL'')') h;
    IF v_live IS DISTINCT FROM 'd00a311fd7235bb19240f3fd812493c4' THEN
      RAISE EXCEPTION 'vehicle_images read policies hash % live; vehicle_image_cover_class restates d00a311f...: re-read them before applying', v_live;
    END IF;
    EXECUTE $i$INSERT INTO public.private_row_policy_copies (reader, relation, policy_filter, recorded_hash, owner_lane, note)
      VALUES ('vehicle_image_cover_class(uuid)', 'vehicle_images', 'p.cmd IN (''SELECT'', ''ALL'')',
              'd00a311fd7235bb19240f3fd812493c4', 'ta-policies',
              '20261126103000 restates the vehicle_images read policy (shown, uploader, tied) before returning a photo''s cover class')
      ON CONFLICT (reader, relation, policy_filter) DO NOTHING$i$;
  END IF;
END
$reg$;

-- Anchored edit: exactly one occurrence of the class call over the view's column; an applied body is left alone.
DO $edit$
DECLARE
  d text := pg_get_functiondef('public.get_first_image_batch(uuid[])'::regprocedure);
  a text := $a$THEN public.garage_cover_class(vi.vehicle_zone, coalesce(vi.ai_detected_angle, vi.angle), vi.image_category,
               vi.ai_scan_metadata->'byok_deep_analysis')$a$;
  b text := $b$THEN public.vehicle_image_cover_class(vi.id)$b$;
BEGIN
  IF (length(d) - length(replace(d, a, ''))) / length(a) = 1 THEN
    EXECUTE replace(d, a, b);
  ELSIF position(b IN d) = 0 THEN
    RAISE EXCEPTION 'get_first_image_batch: cover class anchor not found';
  END IF;
END
$edit$;

DO $verify$
DECLARE
  s text := (SELECT prosrc FROM pg_proc WHERE oid = 'public.get_first_image_batch(uuid[])'::regprocedure);
BEGIN
  IF position('vehicle_image_cover_class(vi.id)' IN s) = 0 OR position('ai_scan_metadata' IN s) > 0 THEN
    RAISE EXCEPTION 'get_first_image_batch still reads the view''s ai_scan_metadata';
  END IF;
  IF NOT (has_function_privilege('anon', 'public.get_first_image_batch(uuid[])', 'EXECUTE')
          AND has_function_privilege('anon', 'public.vehicle_image_cover_class(uuid)', 'EXECUTE')) THEN
    RAISE EXCEPTION 'a cover function lost its anon grant';
  END IF;
END
$verify$;
COMMIT;
