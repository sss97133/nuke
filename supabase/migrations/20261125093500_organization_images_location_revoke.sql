-- organization_images_location_v1: where an organisation's photos were taken leaves the open API. latitude, longitude,
-- location_name and exif_data (which carries location on 404 rows) are read only through organization_image_locations
-- (20261125084500): the uploader, the organisation's active owner, and active members on public / internal_only rows.
--
-- WHY. A shop's or a home's location is a line item the owner's masking rule covers. After 20261125084500 these four
-- columns were still granted to anon and authenticated (anon read 404 coordinate and 502 EXIF rows, ta-skeptic
-- 2026-11-24), because the organisation page selected them. That page (same pull request as 20261125084500, live
-- 2026-11-25, chunk OrganizationProfile-attl5edh.js) now selects base columns only and merges the locations from the
-- tied reader, so revoking them refuses no page.
--
-- CONSUMERS (grep 2026-11-25, origin/main): OrganizationProfile.tsx base columns + organization_image_locations;
-- ImageLightbox selects urls; AddOrganizationData inserts the four columns (INSERT privilege is unchanged; no returning
-- select); edge functions auto-merge-duplicate-orgs and ralph-wiggum-rlm-extraction-coordinator use the service role; no
-- iOS reference. SQL: bundle_org_images_into_work_orders, a BEFORE INSERT trigger run as the inserting user, selects
-- latitude / longitude from the table, so it becomes SECURITY DEFINER here or a signed-in upload of a work-order photo
-- would fail with 42501 (3 such rows exist). match_investors_to_opportunity also reads latitude but already fails for
-- every caller (its investor_profiles table does not exist). Definer readers (auto_tag_organization_from_gps,
-- get_org_profile_fast, provider_profile_read) are unaffected.
--
-- REVERT. supabase/sql/revert_20261125093500_organization_images_location_revoke.sql.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

REVOKE SELECT (latitude, longitude, location_name, exif_data) ON public.organization_images FROM anon, authenticated;

ALTER FUNCTION public.bundle_org_images_into_work_orders() SECURITY DEFINER;
ALTER FUNCTION public.bundle_org_images_into_work_orders() SET search_path = public, pg_temp;
COMMENT ON FUNCTION public.bundle_org_images_into_work_orders() IS
  'organization_images_location_v1: SECURITY DEFINER since 20261125093500, because it reads latitude / longitude, which callers no longer hold.';
