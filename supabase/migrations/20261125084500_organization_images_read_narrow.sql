-- organization_images_read_v1: organization photos are read by their own visibility_level, and the OCR family of
-- columns leaves every client path.
--
-- WHY. Audit 2026-11-24 (ta-skeptic, Trans Am war board): two SELECT policies with USING (true) ("Anyone views org
-- images", "Public can view org images") let anon read all 549 rows, including the 3 rows marked internal_only, all 3
-- marked contains_financial_data, and ocr_extracted_data on all 549. The table already carries per-level policies
-- (org_images_public_view, org_images_contributor_view, org_images_internal_view, org_images_owner_view) that the two
-- true policies overrode. extract_work_order_data(uuid) is SECURITY DEFINER, anon may execute it, and it returned
-- image_url for any id, internal rows included.
--
-- WHAT CHANGES.
--   * The two USING (true) SELECT policies are dropped. Rows are then read through the level policies: public rows
--     that are not sensitive to anyone; internal_only / contributor_only / owner_only rows to their uploader and the
--     organisation's active owners (and active contributors for internal_only), exactly as those policies say.
--   * SELECT becomes a column grant for anon and authenticated. ocr_extracted_data, ai_analysis and ai_description
--     are not granted: no client selects them (grep 2026-11-24: OrganizationProfile, ImageLightbox, AddOrganizationData;
--     edge functions use the service role). Columns added later are not readable until granted.
--   * anon loses UPDATE / DELETE on the table (no policy ever admitted them; grant hygiene).
--   * extract_work_order_data runs as the caller, so RLS decides whether the image exists for them; it reads image_url
--     only.
--   * organization_image_locations(org): where each photo was taken, for tied viewers only (below). The organisation
--     page (same pull request) reads base columns and merges this in for a signed-in caller.
-- NOT CHANGED HERE (next migration, after the page is live): latitude, longitude, location_name and exif_data (404 rows carry
-- exif_data.location) stay granted because the public organisation profile names them in its select; revoking them
-- before the page stops selecting them fails the logged-out gallery with 42501 (#2293, 2026-10-19).
--
-- REVERT. supabase/sql/revert_20261125084500_organization_images_read_narrow.sql.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

DROP POLICY IF EXISTS "Anyone views org images" ON public.organization_images;
DROP POLICY IF EXISTS "Public can view org images" ON public.organization_images;

REVOKE SELECT ON TABLE public.organization_images FROM anon, authenticated;
REVOKE UPDATE, DELETE ON TABLE public.organization_images FROM anon;
GRANT SELECT (id, organization_id, user_id, image_url, thumbnail_url, medium_url, large_url, taken_at, uploaded_at,
              caption, is_primary, category, exif_data, latitude, longitude, location_name, timeline_event_id,
              created_at, updated_at, ai_scanned, ai_scan_date, ai_confidence, is_sensitive, sensitivity_type,
              visibility_level, blur_preview, contains_financial_data, ai_tags, processed_at, queued_for_analysis,
              analysis_attempts, last_analysis_attempt)
  ON public.organization_images TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.extract_work_order_data(image_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_url text;
BEGIN
  -- organization_images_read_v1: runs as the caller, so the row exists only if RLS admits it to them.
  SELECT oi.image_url INTO v_url FROM public.organization_images oi WHERE oi.id = image_id;
  IF NOT FOUND THEN
    RETURN '{"error": "Image not found"}'::jsonb;
  END IF;
  RETURN jsonb_build_object('status', 'pending_ocr', 'image_url', v_url, 'requires_manual_entry', TRUE);
END;
$function$;

-- Where a photo was taken, for tied viewers only. The organisation page reads its gallery from the base columns and
-- merges these in for a signed-in caller; once that page is live, a later migration revokes latitude, longitude,
-- location_name and exif_data from anon and authenticated. Tie test: the uploader; the organisation's active owner
-- (business_ownership); an active member by work_order_org_member, for the levels its policies admit members to
-- (public, internal_only).
CREATE OR REPLACE FUNCTION public.organization_image_locations(p_organization_id uuid)
RETURNS TABLE (id uuid, latitude numeric, longitude numeric, location_name text, exif_data jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT oi.id, oi.latitude, oi.longitude, oi.location_name, oi.exif_data
    FROM public.organization_images oi
   WHERE oi.organization_id = p_organization_id
     AND (SELECT auth.uid()) IS NOT NULL
     AND (oi.user_id = (SELECT auth.uid())
          OR EXISTS (SELECT 1 FROM public.business_ownership bo
                      WHERE bo.business_id = oi.organization_id AND bo.owner_id = (SELECT auth.uid()) AND bo.status = 'active')
          OR (coalesce(oi.visibility_level, 'public') IN ('public', 'internal_only')
              AND public.work_order_org_member((SELECT auth.uid()), oi.organization_id)))
$$;
COMMENT ON FUNCTION public.organization_image_locations(uuid) IS
  'organization_images_read_v1: latitude, longitude, location_name, exif_data of an organisation''s photos, for the uploader, the active owner, and active members on public / internal_only rows. Anyone else gets no rows.';
REVOKE ALL ON FUNCTION public.organization_image_locations(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.organization_image_locations(uuid) TO authenticated, service_role;

COMMENT ON POLICY org_images_public_view ON public.organization_images IS
  'organization_images_read_v1: with the USING (true) policies dropped, this and the three level policies decide every read.';
