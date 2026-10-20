-- Signed-out gallery reads: vehicle_images_public, a read-only view of the columns anon may read, carrying the same
-- vehicle_image_gallery_eligible gate.
--
-- 20261020190000 (#2293) replaced anon's table-wide SELECT on vehicle_images with column grants (precise location, EXIF
-- and device columns withheld). A whole-row reference needs every column, so the gate filter every gallery read sends,
-- `vehicle_image_gallery_eligible=eq.true` (that function takes the whole row), fails for anon with 42501 "permission
-- denied for table vehicle_images": no logged-out profile showed photos (found 2026-10-19; the page said "NO PHOTO" and
-- "Failed to load vehicle images"). Verified in PG17: `SELECT (vehicle_images).id` as anon is refused too.
--
-- Fix, keeping the privacy change and the database-owned gate:
--   1. vehicle_images_public: security_invoker view over exactly the anon-granted columns. Row policies and column grants
--      of vehicle_images apply to the caller as before; nothing new becomes readable. SELECT only.
--   2. vehicle_image_gallery_eligible(vehicle_images_public): the same predicate on the view's row type, so PostgREST
--      accepts it as a computed-column filter on the view. Its pending-frame test needs exif_data, which the view lacks, so
--      it asks bat_pending_image_listing_by_id(id): a SECURITY DEFINER helper that reads exif_data itself and returns
--      only a boolean. The function on vehicle_images is untouched.
-- Reverse: DROP VIEW public.vehicle_images_public CASCADE; DROP FUNCTION public.bat_pending_image_listing_by_id(uuid);
-- Contract: supabase/sql/test_gallery_eligible_without_exif.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.bat_pending_image_listing_by_id(p_image_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT coalesce((
    SELECT public.bat_pending_image_has_listing(vi.vehicle_id, vi.exif_data)
    FROM public.vehicle_images vi
    WHERE vi.id = p_image_id
  ), false);
$function$;

REVOKE ALL ON FUNCTION public.bat_pending_image_listing_by_id(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bat_pending_image_listing_by_id(uuid) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.bat_pending_image_listing_by_id(uuid) IS
  'bat_pending_image_has_listing for one image, reading exif_data as the definer so callers who may not read that column (anon) still get the boolean. Returns only true/false.';

DO $mk$
DECLARE cols text;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO cols
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'vehicle_images'
     AND column_name NOT IN ('latitude','longitude','location_name','location_confidence','exif_data','device_fingerprint','documented_by_device');
  EXECUTE format('CREATE OR REPLACE VIEW public.vehicle_images_public WITH (security_invoker = true) AS SELECT %s FROM public.vehicle_images', cols);
END
$mk$;

REVOKE ALL ON public.vehicle_images_public FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.vehicle_images_public TO anon, authenticated, service_role;
COMMENT ON VIEW public.vehicle_images_public IS
  'vehicle_images without precise location, EXIF and device columns, read under the caller''s row policies and column grants. What signed-out visitors read; carries vehicle_image_gallery_eligible.';

CREATE OR REPLACE FUNCTION public.vehicle_image_gallery_eligible(vehicle_images_public)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  SELECT
    coalesce(($1).is_document,false)=false
    AND coalesce(($1).is_duplicate,false)=false
    AND coalesce(($1).is_superseded,false)=false
    AND nullif(btrim(($1).image_url),'') IS NOT NULL
    AND ($1).image_url NOT LIKE 'file://%'
    AND (($1).source IS NULL OR ($1).source <> 'e2e_test')
    AND coalesce(($1).image_vehicle_match_status,'') NOT IN ('mismatch','unrelated')
    AND CASE
      WHEN ($1).vision_gate_status IS NULL OR ($1).vision_gate_status::text='approved' THEN true
      WHEN ($1).vision_gate_status::text='pending' THEN
        coalesce(($1).is_sensitive,false)=false
        AND coalesce(($1).source='bat_import',false)
        AND ($1).is_external IS TRUE
        AND ($1).is_approved IS TRUE
        AND coalesce(($1).approval_status::text IN ('approved','auto_approved'),false)
        AND coalesce(($1).verification_status='approved',false)
        AND coalesce(($1).redaction_level::text='none',false)
        AND ($1).image_url ~* '^https://(www\.)?bringatrailer\.com/wp-content/uploads/'
        AND public.bat_pending_image_listing_by_id(($1).id)
      ELSE false
    END;
$function$;

REVOKE ALL ON FUNCTION public.vehicle_image_gallery_eligible(vehicle_images_public) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vehicle_image_gallery_eligible(vehicle_images_public) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.vehicle_image_gallery_eligible(vehicle_images_public) IS
  'The gallery admission predicate of vehicle_image_gallery_eligible(vehicle_images), on the signed-out view. Keep the two bodies identical.';

NOTIFY pgrst, 'reload schema';
COMMIT;
