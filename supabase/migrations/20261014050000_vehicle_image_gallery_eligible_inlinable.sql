-- vehicle_image_gallery_eligible: same answer, but the planner can inline it, so a gallery read stops flattening every
-- column of every image row it tests.
--
-- Measured 2026-10-14 on the K5 Blazer (3,716 images), deploy role, no row policy involved:
--   gallery page 0 (the 500-row, 55-column select ImageGallery sends): 312 ms, 113,009 buffer hits
--   the same ids only, eligibility called as the function:           16,286 buffer hits
--   the same ids only, without the eligibility test:                  2,344 buffer hits
--   the gallery page with the function's body written into the WHERE: 201 ms, 99,145 buffer hits
-- ImageGallery loads the whole set in 500-row pages (eight for the K5), and every page repeats the filter, so the saving
-- is paid again on each page; the exact count on page 0 repeats it once more. Anon pays the same (330 ms against 300 ms
-- as the deploy role): the row policies are 10% of this read, the function is a third.
--
-- Cause: the live function takes the whole row ( (vehicle_images) ) and carries SET search_path TO ''. A function with a
-- SET clause is never inlined, so for each row the executor builds the composite argument, which detoasts every
-- external column of the row (ai_scan_metadata, exif_data, labels ...) before the first test runs. An inlined body reads
-- only the columns it names. The body also holds an EXISTS subquery, and a SQL function with a sublink is not inlined
-- either, so that one test moves into its own function; it is only reached for a pending frame, the rare branch.
--
-- Changes (nothing else):
--   1. public.bat_pending_image_has_listing(uuid, jsonb): the EXISTS, verbatim, taking the two values it reads. SECURITY
--      INVOKER and SET search_path TO '' as the original was, so vehicles and auction_events are read under the
--      caller's row policies exactly as before. EXECUTE for the roles that have it on the function that calls it.
--   2. public.vehicle_image_gallery_eligible(vehicle_images): the same boolean expression with that EXISTS replaced
--      by the call, and without the SET clause. Signature, return type, volatility, owner, grants and comment unchanged;
--      callers (ImageGallery, fetchVehicleImages, useVehicleImageEvidence, the iOS gallery, get_vehicle_profile_data,
--      get_user_garage, get_pipeline_pulse_24h and the observation_witnesses policy) keep working by OID and name.
-- Guarded on the md5 of the live definition (8e1b679106cda35298b92e827fb5e444). A second run is a no-op. The advisor's
-- function_search_path_mutable lint returns for the outer function, which an inlined body makes moot: the expression
-- runs in the caller's context, and every relation it names is schema-qualified.
-- Contract: supabase/sql/test_vehicle_image_gallery_eligible_inline.sql (CI job vehicle-image-gallery-eligible-contract).
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

DO $guard$
DECLARE
  cur text;
BEGIN
  cur := pg_get_functiondef(to_regprocedure('public.vehicle_image_gallery_eligible(vehicle_images)'));
  IF cur IS NULL THEN
    RAISE EXCEPTION 'vehicle_image_gallery_eligible(vehicle_images) is missing; inspect before retry';
  END IF;
  IF md5(cur) <> '8e1b679106cda35298b92e827fb5e444' AND cur NOT LIKE '%bat_pending_image_has_listing%' THEN
    RAISE EXCEPTION 'vehicle_image_gallery_eligible has drifted from its known definition (md5 %); inspect before retry', md5(cur);
  END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION public.bat_pending_image_has_listing(p_vehicle_id uuid, p_exif jsonb)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.vehicles v
    JOIN public.auction_events e ON e.vehicle_id=v.id
    WHERE v.id=p_vehicle_id AND v.is_public IS TRUE
      AND e.source::text='bat'
      AND e.source_url ~* '^https://(www\.)?bringatrailer\.com/listing/[^/?#]+/?$'
      AND (
        (jsonb_typeof(p_exif->'listing_urls')='array'
          AND (p_exif->'listing_urls') ? e.source_url)
        OR rtrim(e.source_url,'/')=rtrim(p_exif->>'discovery_url','/')
        OR rtrim(e.source_url,'/')=rtrim(p_exif->>'source_url','/')
      )
  );
$function$;

REVOKE ALL ON FUNCTION public.bat_pending_image_has_listing(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bat_pending_image_has_listing(uuid, jsonb) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.bat_pending_image_has_listing(uuid, jsonb) IS
  'Whether a public vehicle has a BaT auction event whose listing URL matches the listing a pending frame came from (exif listing_urls, discovery_url or source_url). The pending-frame branch of vehicle_image_gallery_eligible, split out so that function can be inlined. SECURITY INVOKER: the caller''s row policies on vehicles and auction_events apply.';

CREATE OR REPLACE FUNCTION public.vehicle_image_gallery_eligible(vehicle_images)
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
        AND public.bat_pending_image_has_listing(($1).vehicle_id, ($1).exif_data)
      ELSE false
    END;
$function$;

COMMENT ON FUNCTION public.vehicle_image_gallery_eligible(vehicle_images) IS
  'Canonical gallery read predicate, filter by vehicle_id first. Excludes superseded, duplicate, document, explicit mismatch/unrelated and invalid/test/local URLs. Preserves NULL/approved vision eligibility under existing caller RLS and reader privacy checks. Pending is eligible only for nonsensitive publication-approved external BaT images on a public vehicle whose listing provenance matches that same vehicle auction event. Rejected/review-needed and pending private/user uploads remain excluded. Returns visibility eligibility, never a vision verdict; performs no writes. PostgREST computed field.';

DO $verify$
BEGIN
  IF NOT has_function_privilege('anon', 'public.vehicle_image_gallery_eligible(vehicle_images)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.vehicle_image_gallery_eligible(vehicle_images)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.vehicle_image_gallery_eligible(vehicle_images)', 'EXECUTE')
     OR NOT has_function_privilege('anon', 'public.bat_pending_image_has_listing(uuid, jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.bat_pending_image_has_listing(uuid, jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'gallery eligibility lost EXECUTE for a role that read it before';
  END IF;
  IF (SELECT proconfig IS NOT NULL OR prosecdef OR proisstrict FROM pg_proc
       WHERE oid = to_regprocedure('public.vehicle_image_gallery_eligible(vehicle_images)')) THEN
    RAISE EXCEPTION 'vehicle_image_gallery_eligible would not be inlined (SET clause, SECURITY DEFINER or STRICT)';
  END IF;
END
$verify$;

COMMIT;

-- Live verification (after apply), as anon:
--   explain (verbose) select id from vehicle_images where vehicle_id = '83f6f033-a3c3-4cf4-a85e-a60d2c588838' and vehicle_image_gallery_eligible(vehicle_images)
--   -- the Filter shows the column tests, not vehicle_image_gallery_eligible(vehicle_images.*)
