-- get_unorganized_photos_optimized and get_unorganized_photo_count answer only for the caller.
-- Both run as their owner (SECURITY DEFINER), authenticated can execute them, and neither compared p_user_id with
-- the caller, so a signed-in account passing another account's id reached that account's unfiled vehicle_images rows
-- (the inbox reader returns exif_data, latitude and longitude). The hole is latent today: both keep search_path ''
-- over unqualified table names (P3.8, 20260927190000, lists them as still broken), so every call, the owner's too,
-- fails with 42P01 before it reads a row (live call, 2026-10-20). Re-pinning their search_path would open it; the
-- caller check now runs first.
-- The check is get_photo_library_stats's (20261005021008): the caller's own id or the service role, otherwise 42501.
-- Everything else is live's (pg_get_functiondef, 2026-10-20): bodies, SECURITY DEFINER, search_path, volatility and
-- EXECUTE for authenticated and service_role only (not PUBLIC, not anon), restated below unchanged.
-- get_unorganized_photo_count moves from LANGUAGE sql to plpgsql only so it can raise; its query is live's.
-- Consumers (git grep, 2026-10-20): web personalPhotoLibraryService.ts passes the signed-in user's own id to
-- get_unorganized_photos_optimized and falls back to RLS-bound reads on any error; get_unorganized_photo_count has
-- no caller in web, iOS, edge functions, scripts or tools; no SQL function, view or cron job calls either. Gateway
-- logs 2026-10-17..20: no request to either.
-- Contract: supabase/sql/test_unorganized_photo_readers_caller_check.sql (PG17).
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.get_unorganized_photos_optimized(p_user_id uuid, p_limit integer DEFAULT 1000, p_offset integer DEFAULT 0, p_filter_status text DEFAULT NULL::text, p_filter_angle text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  result JSON;
BEGIN
  IF NOT (COALESCE(auth.uid() = p_user_id, false)
          OR COALESCE(auth.jwt() ->> 'role', '') = 'service_role') THEN
    RAISE EXCEPTION 'Photo library requires its owner' USING ERRCODE = '42501';
  END IF;
  SELECT json_build_object(
    'photos', (
      SELECT COALESCE(json_agg(photo_data ORDER BY created_at DESC), '[]'::json)
      FROM (
        SELECT 
          json_build_object(
            'id', vi.id,
            'user_id', vi.user_id,
            'image_url', vi.image_url,
            'thumbnail_url', vi.thumbnail_url,
            'variants', vi.variants,
            'file_name', vi.file_name,
            'file_size', vi.file_size,
            'mime_type', vi.mime_type,
            'vehicle_id', vi.vehicle_id,
            'organization_status', COALESCE(vi.organization_status, 'unorganized'),
            'organized_at', vi.organized_at,
            'album_count', COALESCE(album_counts.count, 0),
            'ai_processing_status', COALESCE(vi.ai_processing_status, 'pending'),
            'ai_processing_started_at', vi.ai_processing_started_at,
            'ai_processing_completed_at', vi.ai_processing_completed_at,
            'ai_suggestions', vi.ai_suggestions,
            'ai_detected_vehicle', vi.ai_detected_vehicle,
            'ai_detected_angle', vi.ai_detected_angle,
            'ai_detected_angle_confidence', vi.ai_detected_angle_confidence,
            'suggested_vehicle_id', vi.suggested_vehicle_id,
            'exif_data', vi.exif_data,
            'taken_at', vi.taken_at,
            'latitude', vi.latitude,
            'longitude', vi.longitude,
            'created_at', vi.created_at,
            'updated_at', vi.updated_at
          ) as photo_data,
          vi.created_at
        FROM vehicle_images vi
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::INTEGER as count
          FROM image_set_members ism
          WHERE ism.image_id = vi.id
        ) album_counts ON true
        WHERE vi.user_id = p_user_id
          AND vi.vehicle_id IS NULL
          AND (
            COALESCE(vi.organization_status, 'unorganized') = 'unorganized'
            OR vi.organization_status IS NULL
          )
          AND (
            p_filter_status IS NULL 
            OR vi.ai_processing_status = p_filter_status
          )
          AND (
            p_filter_angle IS NULL
            OR vi.ai_detected_angle ILIKE '%' || p_filter_angle || '%'
          )
        ORDER BY vi.created_at DESC
        LIMIT p_limit
        OFFSET p_offset
      ) subq
    ),
    'total_count', (
      SELECT COUNT(*)::INTEGER
      FROM vehicle_images
      WHERE user_id = p_user_id
        AND vehicle_id IS NULL
        AND (
          COALESCE(organization_status, 'unorganized') = 'unorganized'
          OR organization_status IS NULL
        )
        AND (
          p_filter_status IS NULL 
          OR ai_processing_status = p_filter_status
        )
        AND (
          p_filter_angle IS NULL
          OR ai_detected_angle ILIKE '%' || p_filter_angle || '%'
        )
    )
  ) INTO result;
  
  RETURN result;
END;
$function$;
REVOKE ALL ON FUNCTION public.get_unorganized_photos_optimized(uuid, integer, integer, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_unorganized_photos_optimized(uuid, integer, integer, text, text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_unorganized_photo_count(p_user_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF NOT (COALESCE(auth.uid() = p_user_id, false)
          OR COALESCE(auth.jwt() ->> 'role', '') = 'service_role') THEN
    RAISE EXCEPTION 'Photo library requires its owner' USING ERRCODE = '42501';
  END IF;
  RETURN (
  SELECT COUNT(*)::INTEGER
  FROM vehicle_images
  WHERE user_id = p_user_id
  AND vehicle_id IS NULL
  AND organization_status = 'unorganized'
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.get_unorganized_photo_count(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_unorganized_photo_count(uuid) TO authenticated, service_role;

COMMIT;
