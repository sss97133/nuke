-- Photos captured from a public web listing are eligible for the public gallery by provenance, as BaT's already were.
--
-- Measured 2026-10-15: vehicle_image_gallery_eligible admits a vision_gate_status = 'pending' frame only when it is a
-- BaT import whose listing matches the same vehicle's auction event. Every other listing source lands its photos
-- 'pending' and nothing promotes them (the approver job has not run since 2026-09-26), so a Mecum, Bonhams, Cars & Bids,
-- Gooding or Craigslist vehicle page showed one fallback photo: a 1975 Porsche 914 with 18 stored photos rendered 1.
-- The photos are already public on the source site.
--
-- Pending is now also eligible for a listing-capture frame: is_external, no user_id (not a user or device upload: those
-- carry a user_id or are not external), not sensitive, publication-approved (is_approved, verification_status
-- approved, redaction none, approval_status not rejected), an https URL, and not a bat_import frame (those keep their
-- stricter listing-match rule). Duplicates, superseded rows, documents, mismatch/unrelated and every non-pending gate
-- verdict (rejected_personal, rejected_misattributed, review_needed) are decided exactly as before. Personal, owner and iOS uploads stay
-- behind the gate. No row is written; the function stays a plain SQL expression so the planner still inlines it.
-- Guarded on the live definition naming the BaT helper and not yet carrying this branch; a second run is a no-op.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

DO $guard$
DECLARE cur text;
BEGIN
  cur := pg_get_functiondef(to_regprocedure('public.vehicle_image_gallery_eligible(vehicle_images)'));
  IF cur IS NULL THEN RAISE EXCEPTION 'vehicle_image_gallery_eligible(vehicle_images) is missing'; END IF;
  IF cur NOT LIKE '%bat_pending_image_has_listing%' THEN RAISE EXCEPTION 'live definition has drifted (no BaT helper); inspect before retry'; END IF;
END
$guard$;

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
        AND (
          (
            coalesce(($1).source='bat_import',false)
            AND ($1).is_external IS TRUE
            AND ($1).is_approved IS TRUE
            AND coalesce(($1).approval_status::text IN ('approved','auto_approved'),false)
            AND coalesce(($1).verification_status='approved',false)
            AND coalesce(($1).redaction_level::text='none',false)
            AND ($1).image_url ~* '^https://(www\.)?bringatrailer\.com/wp-content/uploads/'
            AND public.bat_pending_image_has_listing(($1).vehicle_id, ($1).exif_data)
          )
          OR (
            -- listing capture: a photo taken from a public web listing by an extractor, never an upload
            coalesce(($1).source='bat_import',false)=false
            AND ($1).is_external IS TRUE
            AND ($1).user_id IS NULL
            AND ($1).is_approved IS TRUE
            AND coalesce(($1).approval_status::text,'') <> 'rejected'
            AND coalesce(($1).verification_status='approved',false)
            AND coalesce(($1).redaction_level::text='none',false)
            AND ($1).image_url ~* '^https://'
          )
        )
      ELSE false
    END;
$function$;

COMMENT ON FUNCTION public.vehicle_image_gallery_eligible(vehicle_images) IS
  'Canonical gallery read predicate, filter by vehicle_id first. Excludes superseded, duplicate, document, explicit mismatch/unrelated and invalid/test/local URLs. Preserves NULL/approved vision eligibility under existing caller RLS and reader privacy checks. Pending is eligible for (a) nonsensitive publication-approved external BaT images on a public vehicle whose listing provenance matches that same vehicle auction event, and (b) listing-capture frames: external, no user_id, nonsensitive, is_approved, verification approved, redaction none, approval not rejected, https URL (photos already public on the source listing). Rejected/review-needed gate verdicts and pending private/user/device uploads remain excluded. Returns visibility eligibility, never a vision verdict; performs no writes. PostgREST computed field.';

DO $verify$
BEGIN
  IF (SELECT proconfig IS NOT NULL OR prosecdef OR proisstrict FROM pg_proc
       WHERE oid = to_regprocedure('public.vehicle_image_gallery_eligible(vehicle_images)')) THEN
    RAISE EXCEPTION 'vehicle_image_gallery_eligible would not be inlined (SET clause, SECURITY DEFINER or STRICT)';
  END IF;
  IF NOT has_function_privilege('anon', 'public.vehicle_image_gallery_eligible(vehicle_images)', 'EXECUTE') THEN
    RAISE EXCEPTION 'gallery eligibility lost EXECUTE for anon';
  END IF;
END
$verify$;
COMMIT;
