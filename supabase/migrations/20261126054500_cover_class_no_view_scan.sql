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
--      class (an integer, lower is a better whole-car cover), never the reading. NULL unless the photo is not sensitive
--      and on a public non-deleted car, or the caller uploaded it, or the caller is tied to the car
--      (vehicle_viewer_tied: owner fields, access rows, service_role). Every term is COALESCEd.
--   2. get_first_image_batch: an anchored edit replaces the one garage_cover_class(... vi.ai_scan_metadata ...) call with
--      vehicle_image_cover_class(vi.id). The call sits inside the existing CASE, so it runs only for approved frames no
--      cheap reading places elsewhere; the ranked query no longer names the view's ai_scan_metadata, so the planner
--      drops that column (and, under #3935, its per-row reader call). The admission step still reads the chosen row
--      through the view (one reader call per row tried, usually one).
--   Covers are unchanged today: the class is computed from the same stored reading the view returns now. Under #3935
--   they stay the same for every viewer instead of shifting for logged-out ones.
-- Residual (stated, not closed here): for a photo the gallery hides on a public car, the helper returns its class
-- integer (scene, distance, finish and staging folded into one number); no reading text leaves the function.
-- Contract: supabase/sql/test_cover_class_no_view_scan.sql. Revert: supabase/sql/revert_20261126054500_cover_class_no_view_scan.sql.

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
  r record;
  v_uid uuid := auth.uid();
BEGIN
  -- cover_class_no_view_scan_v1 (20261126054500): the class only, from the photo row's own fields and stored reading
  SELECT i.vehicle_id, i.user_id, i.is_sensitive, i.vehicle_zone, coalesce(i.ai_detected_angle, i.angle) AS ang,
         i.image_category, i.ai_scan_metadata -> 'byok_deep_analysis' AS reading, v.is_public, v.deleted_at
    INTO r
    FROM public.vehicle_images i
    JOIN public.vehicles v ON v.id = i.vehicle_id
   WHERE i.id = p_image_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF NOT (COALESCE(r.is_public = true AND r.deleted_at IS NULL AND COALESCE(r.is_sensitive, false) = false, false)
          OR COALESCE(v_uid IS NOT NULL AND r.user_id = v_uid, false)
          OR COALESCE(public.vehicle_viewer_tied(r.vehicle_id), false)) THEN
    RETURN NULL;
  END IF;
  RETURN public.garage_cover_class(r.vehicle_zone, r.ang, r.image_category, r.reading);
END
$function$;

REVOKE ALL ON FUNCTION public.vehicle_image_cover_class(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vehicle_image_cover_class(uuid) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.vehicle_image_cover_class(uuid) IS
  'Whole-car cover class (garage_cover_class) of one photo from its own row; NULL unless shown-eligible on a public car, the caller''s upload, or the caller is tied. Returns no reading text. 20261126054500.';

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
