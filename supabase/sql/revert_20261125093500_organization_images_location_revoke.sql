-- Revert 20261125093500_organization_images_location_revoke: grants the four location columns back to anon and
-- authenticated and returns bundle_org_images_into_work_orders to SECURITY INVOKER with no search_path.
SET lock_timeout = '5s';
GRANT SELECT (latitude, longitude, location_name, exif_data) ON public.organization_images TO anon, authenticated;
ALTER FUNCTION public.bundle_org_images_into_work_orders() SECURITY INVOKER;
ALTER FUNCTION public.bundle_org_images_into_work_orders() RESET search_path;
COMMENT ON FUNCTION public.bundle_org_images_into_work_orders() IS NULL;
