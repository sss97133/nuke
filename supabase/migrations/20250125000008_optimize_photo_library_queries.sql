-- Optimized Photo Library Queries
-- Replaces multiple separate queries with single RPC functions for better performance
-- Created: January 25, 2025

-- ============================================================================
-- RPC Function: Get Unorganized Photos with Album Counts
-- ============================================================================
-- Single query that returns photos with their album membership counts
-- Avoids N+1 query problem when fetching album counts separately

CREATE OR REPLACE FUNCTION public.get_unorganized_photos_optimized(
  p_user_id UUID,
  p_limit INTEGER DEFAULT 1000,
  p_offset INTEGER DEFAULT 0,
  p_filter_status TEXT DEFAULT NULL,
  p_filter_angle TEXT DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
  result JSON;
BEGIN
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
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.get_unorganized_photos_optimized(UUID, INTEGER, INTEGER, TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION public.get_unorganized_photos_optimized IS 
'Returns unorganized photos with album counts in a single optimized query. Supports filtering by AI status and angle. Includes total count for pagination.';

-- ============================================================================
-- RPC Function: Get Photo Library Statistics
-- ============================================================================
-- Single query for all library stats instead of 4 separate queries

CREATE OR REPLACE FUNCTION public.get_photo_library_stats(p_user_id UUID)
RETURNS JSON AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_build_object(
    'total_photos', (
      SELECT COUNT(*)::INTEGER
      FROM vehicle_images
      WHERE user_id = p_user_id
        AND vehicle_id IS NULL
    ),
    'unorganized_photos', (
      SELECT COUNT(*)::INTEGER
      FROM vehicle_images
      WHERE user_id = p_user_id
        AND vehicle_id IS NULL
        AND (
          COALESCE(organization_status, 'unorganized') = 'unorganized'
          OR organization_status IS NULL
        )
    ),
    'organized_photos', (
      SELECT COUNT(*)::INTEGER
      FROM vehicle_images
      WHERE user_id = p_user_id
        AND organization_status = 'organized'
    ),
    'pending_ai_processing', (
      SELECT COUNT(*)::INTEGER
      FROM vehicle_images
      WHERE user_id = p_user_id
        AND vehicle_id IS NULL
        AND ai_processing_status IN ('pending', 'processing')
    ),
    'ai_suggestions_count', (
      SELECT COUNT(*)::INTEGER
      FROM vehicle_suggestions
      WHERE user_id = p_user_id
        AND status = 'pending'
    ),
    'total_file_size', (
      SELECT COALESCE(SUM(file_size), 0)::BIGINT
      FROM vehicle_images
      WHERE user_id = p_user_id
        AND vehicle_id IS NULL
    ),
    'ai_status_breakdown', (
      SELECT json_build_object(
        'complete', COUNT(*) FILTER (WHERE ai_processing_status = 'complete')::INTEGER,
        'pending', COUNT(*) FILTER (WHERE ai_processing_status = 'pending')::INTEGER,
        'processing', COUNT(*) FILTER (WHERE ai_processing_status = 'processing')::INTEGER,
        'failed', COUNT(*) FILTER (WHERE ai_processing_status = 'failed')::INTEGER
      )
      FROM vehicle_images
      WHERE user_id = p_user_id
        AND vehicle_id IS NULL
    ),
    'angle_breakdown', (
      SELECT json_build_object(
        'front', COUNT(*) FILTER (WHERE ai_detected_angle ILIKE '%front%')::INTEGER,
        'rear', COUNT(*) FILTER (WHERE ai_detected_angle ILIKE '%rear%')::INTEGER,
        'side', COUNT(*) FILTER (WHERE ai_detected_angle ILIKE '%side%')::INTEGER,
        'interior', COUNT(*) FILTER (WHERE ai_detected_angle = 'interior')::INTEGER,
        'engine_bay', COUNT(*) FILTER (WHERE ai_detected_angle = 'engine_bay')::INTEGER,
        'undercarriage', COUNT(*) FILTER (WHERE ai_detected_angle = 'undercarriage')::INTEGER,
        'detail', COUNT(*) FILTER (WHERE ai_detected_angle = 'detail')::INTEGER
      )
      FROM vehicle_images
      WHERE user_id = p_user_id
        AND vehicle_id IS NULL
    ),
    'vehicle_detection', (
      SELECT json_build_object(
        'found', COUNT(*) FILTER (WHERE ai_detected_vehicle IS NOT NULL)::INTEGER,
        'not_found', COUNT(*) FILTER (WHERE ai_detected_vehicle IS NULL)::INTEGER
      )
      FROM vehicle_images
      WHERE user_id = p_user_id
        AND vehicle_id IS NULL
    )
  ) INTO result;
  
  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.get_photo_library_stats(UUID) TO authenticated;

COMMENT ON FUNCTION public.get_photo_library_stats IS 
'Returns comprehensive photo library statistics in a single query. Replaces 4+ separate queries with one optimized call.';

