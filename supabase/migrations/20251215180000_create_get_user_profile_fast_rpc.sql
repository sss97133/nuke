-- Create get_user_profile_fast RPC (codifies existing prod function to eliminate schema drift)
-- This RPC is used by nuke_frontend/src/pages/Profile.tsx for the initial fast profile render.

CREATE OR REPLACE FUNCTION public.get_user_profile_fast(p_user_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  result JSON;
BEGIN
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

GRANT EXECUTE ON FUNCTION public.get_user_profile_fast(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_profile_fast(uuid) TO anon;

COMMENT ON FUNCTION public.get_user_profile_fast(uuid)
IS 'Fast user profile payload: profile + basic stats + recent images + organizations (used for initial Profile render)';


