-- Create get_org_profile_fast RPC (fast org/shop profile payload)
-- Patterned after get_vehicle_profile_data + get_user_profile_fast for consistent profile loading.

CREATE OR REPLACE FUNCTION public.get_org_profile_fast(p_org_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  result JSON;
BEGIN
  SELECT json_build_object(
    'organization', (
      SELECT row_to_json(b.*)
      FROM public.businesses b
      WHERE b.id = p_org_id
    ),
    'stats', json_build_object(
      'total_vehicles', (SELECT COUNT(*) FROM public.organization_vehicles ov WHERE ov.organization_id = p_org_id),
      'total_images', (SELECT COUNT(*) FROM public.organization_images oi WHERE oi.organization_id = p_org_id),
      'total_business_events', (SELECT COUNT(*) FROM public.business_timeline_events be WHERE be.business_id = p_org_id),
      'total_activity_events', (SELECT COUNT(*) FROM public.organization_activity_view oav WHERE oav.org_id = p_org_id)
    ),
    'recent_vehicles', (
      SELECT COALESCE(
        json_agg(row_to_json(x.*)),
        '[]'::json
      )
      FROM (
        SELECT
          ov.vehicle_id,
          ov.relationship_type,
          ov.status,
          v.year,
          v.make,
          v.model,
          v.trim,
          v.series,
          v.vin,
          v.primary_image_url,
          v.updated_at
        FROM public.organization_vehicles ov
        JOIN public.vehicles v ON v.id = ov.vehicle_id
        WHERE ov.organization_id = p_org_id
        ORDER BY v.updated_at DESC NULLS LAST
        LIMIT 12
      ) x
    ),
    'recent_images', (
      SELECT COALESCE(
        json_agg(row_to_json(i.*)),
        '[]'::json
      )
      FROM (
        SELECT
          id,
          image_url,
          category,
          caption,
          taken_at,
          uploaded_at,
          user_id
        FROM public.organization_images
        WHERE organization_id = p_org_id
        ORDER BY taken_at DESC NULLS LAST, created_at DESC
        LIMIT 12
      ) i
    ),
    'recent_activity', (
      SELECT COALESCE(
        json_agg(row_to_json(a.*)),
        '[]'::json
      )
      FROM (
        SELECT *
        FROM public.organization_activity_view
        WHERE org_id = p_org_id
        ORDER BY created_at DESC
        LIMIT 25
      ) a
    )
  ) INTO result;

  RETURN result;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_org_profile_fast(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_org_profile_fast(uuid) TO anon;

COMMENT ON FUNCTION public.get_org_profile_fast(uuid)
IS 'Fast org profile payload: org row + basic stats + recent vehicles/images/activity';


