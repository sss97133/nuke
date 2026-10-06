-- Public profile rows previously exposed every column, including contact details,
-- identity documents and private tool values. RLS alone cannot redact columns.
-- Keep existing row visibility and public identity joins; deny private columns
-- to both anonymous callers and signed-in strangers. Owners use the existing
-- get_user_profile_fast RPC, whose authorization is enforced below.
BEGIN;
SET LOCAL statement_timeout = '120s';
SET LOCAL lock_timeout = '10s';

REVOKE SELECT ON TABLE public.profiles FROM PUBLIC, anon, authenticated;
DO $privileges$
DECLARE
  columns text;
BEGIN
  SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) INTO columns
  FROM pg_attribute
  WHERE attrelid = 'public.profiles'::regclass AND attnum > 0 AND NOT attisdropped;
  EXECUTE format('REVOKE SELECT (%s) ON public.profiles FROM PUBLIC, anon, authenticated', columns);
END;
$privileges$;
GRANT SELECT (id, full_name, avatar_url, bio, location, website, created_at, updated_at, user_type, phone_verified, id_verification_status, verification_level, verified_at, website_url, github_url, linkedin_url, is_public, is_verified, username, username_lower, payment_verified, role, moderator_level, tool_inventory_public, profession, expertise_areas, business_name, member_since, total_listings, total_bids, total_comments, total_auction_wins, total_success_stories)
  ON public.profiles TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_user_profile_fast(p_user_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  result JSON;
BEGIN
  -- Full contact/document data is only available to its owner or trusted service.
  IF NOT (
    COALESCE(auth.uid() = p_user_id, false)
    OR COALESCE(auth.jwt() ->> 'role', '') = 'service_role'
  ) THEN
    RAISE EXCEPTION 'Private profile requires its owner' USING ERRCODE = '42501';
  END IF;

  SELECT json_build_object(
    'profile', (
      SELECT row_to_json(p.*)
      FROM public.profiles p
      WHERE p.id = p_user_id
    ),
    'stats', json_build_object(
      'total_timeline_events', (SELECT COUNT(*) FROM public.timeline_events WHERE user_id = p_user_id),
      'total_images', (SELECT COUNT(*) FROM public.vehicle_images WHERE user_id = p_user_id),
      'total_business_events', (SELECT COUNT(*) FROM public.business_timeline_events WHERE created_by = p_user_id),
      'total_contributions', (
        (SELECT COUNT(*) FROM public.timeline_events WHERE user_id = p_user_id) +
        (SELECT COUNT(*) FROM public.vehicle_images WHERE user_id = p_user_id) +
        (SELECT COUNT(*) FROM public.business_timeline_events WHERE created_by = p_user_id)
      ),
      'vehicles_count', (SELECT COUNT(DISTINCT vehicle_id) FROM public.timeline_events WHERE user_id = p_user_id),
      'organizations_count', (
        SELECT COUNT(DISTINCT organization_id)
        FROM public.organization_contributors
        WHERE user_id = p_user_id
          AND status = 'active'
      )
    ),
    'recent_images', (
      SELECT COALESCE(json_agg(row_to_json(i.*)), '[]'::json)
      FROM (
        SELECT id, image_url, vehicle_id, created_at, taken_at
        FROM public.vehicle_images
        WHERE user_id = p_user_id
        ORDER BY taken_at DESC NULLS LAST
        LIMIT 12
      ) i
    ),
    'organizations', (
      SELECT COALESCE(
        json_agg(
          json_build_object(
            'id', b.id,
            'business_name', b.business_name,
            'role', oc.role,
            'logo_url', b.logo_url
          )
        ),
        '[]'::json
      )
      FROM public.organization_contributors oc
      JOIN public.businesses b ON b.id = oc.organization_id
      WHERE oc.user_id = p_user_id
        AND oc.status = 'active'
      LIMIT 10
    )
  ) INTO result;

  RETURN result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_user_profile_fast(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_profile_fast(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.get_user_profile_fast(uuid) IS
  'Owner-only private profile and existing aggregate payload. Caller must match p_user_id or carry the trusted service role. Public profile readers select the explicit nonprivate column projection; new profile columns are private by default.';
NOTIFY pgrst, 'reload schema';
COMMIT;
