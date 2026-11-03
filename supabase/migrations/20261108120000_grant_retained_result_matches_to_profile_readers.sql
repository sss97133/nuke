-- vehicle_profile_read (SECURITY INVOKER, executable by anon) has called
-- public.retained_listing_property_result_matches since 20261101003500_retained_bat_sale_properties.sql.
-- That helper was executable by service_role only, so every logged-out profile read failed with
-- 42501 (PostgREST: HTTP 401 on /rest/v1/rpc/vehicle_profile_read). Grant it to the same roles as its
-- sibling retained_*_matches witnesses. No function body, other ACL, policy or data changes.
BEGIN;
SET LOCAL lock_timeout = '2s';
GRANT EXECUTE ON FUNCTION public.retained_listing_property_result_matches(uuid, uuid, uuid)
  TO anon, authenticated;
COMMIT;
