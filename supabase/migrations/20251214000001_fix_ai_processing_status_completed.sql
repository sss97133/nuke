-- Normalize ai_processing_status values and update stats RPC to treat legacy/new values the same.
-- Goal: prevent reprocessing loops + make dashboards accurate.

BEGIN;

-- 1) Normalize existing data (legacy 'complete' -> 'completed')
DO $$
BEGIN
  IF to_regclass('public.vehicle_images') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'vehicle_images'
         AND column_name = 'ai_processing_status'
     ) THEN
    UPDATE public.vehicle_images
    SET ai_processing_status = 'completed'
    WHERE ai_processing_status = 'complete';
  END IF;
END $$;

-- 2) Update photo library stats RPC (keep 'complete' key for backwards compatibility)
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
        -- Keep the 'complete' key, but count both legacy and normalized values.
        'complete', COUNT(*) FILTER (WHERE ai_processing_status IN ('complete', 'completed'))::INTEGER,
        'pending', COUNT(*) FILTER (WHERE ai_processing_status = 'pending')::INTEGER,
        'processing', COUNT(*) FILTER (WHERE ai_processing_status = 'processing')::INTEGER,
        'failed', COUNT(*) FILTER (WHERE ai_processing_status = 'failed')::INTEGER,
        'duplicate_skipped', COUNT(*) FILTER (WHERE ai_processing_status = 'duplicate_skipped')::INTEGER
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

GRANT EXECUTE ON FUNCTION public.get_photo_library_stats(UUID) TO authenticated;

COMMIT;


