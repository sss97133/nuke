-- ==========================================================================
-- FIX: Remove metadata reference from work detection trigger
-- ==========================================================================
-- Issue: Trigger was trying to access NEW.metadata which doesn't exist in vehicle_images
-- Fix: Use ai_processing_status instead to check if already processed
-- ==========================================================================

-- Drop and recreate the trigger function without metadata reference
DROP FUNCTION IF EXISTS trigger_work_detection_on_image_upload() CASCADE;

CREATE OR REPLACE FUNCTION trigger_work_detection_on_image_upload()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_vehicle_id UUID;
BEGIN
  -- Only process if image has vehicle_id and is not already processed
  -- Check ai_processing_status instead of metadata (which doesn't exist)
  IF NEW.vehicle_id IS NOT NULL AND (NEW.ai_processing_status IS NULL OR NEW.ai_processing_status = 'pending') THEN
    
    v_vehicle_id := NEW.vehicle_id;
    
    -- Mark as processing to prevent duplicate processing
    -- Note: We don't update metadata (it doesn't exist), but we can check ai_processing_status
    -- The status will be updated by the processing job
    
    -- Call edge function asynchronously (using pg_net if available, or log for processing)
    -- Note: Direct HTTP calls from triggers are not recommended, so we'll use a queue approach
    -- For now, we'll create a queue record that can be processed by a background job
    
    INSERT INTO image_work_extractions (
      image_id,
      vehicle_id,
      status,
      detected_location_lat,
      detected_location_lng,
      detected_date
    ) VALUES (
      NEW.id,
      v_vehicle_id,
      'pending', -- Will be processed by background job
      NEW.latitude,
      NEW.longitude,
      COALESCE(NEW.taken_at::DATE, NEW.created_at::DATE)
    )
    ON CONFLICT DO NOTHING;
    
    -- Log for background processing
    RAISE NOTICE 'Work detection queued for image % (vehicle %)', NEW.id, v_vehicle_id;
    
  END IF;
  
  RETURN NEW;
END;
$$;

-- Recreate the trigger
DROP TRIGGER IF EXISTS trg_auto_work_detection ON vehicle_images;
CREATE TRIGGER trg_auto_work_detection
  AFTER INSERT ON vehicle_images
  FOR EACH ROW
  WHEN (NEW.vehicle_id IS NOT NULL)
  EXECUTE FUNCTION trigger_work_detection_on_image_upload();

COMMENT ON FUNCTION trigger_work_detection_on_image_upload() IS 
  'Automatically queues work detection when vehicle images are uploaded. Processes via background job. Fixed to use ai_processing_status instead of non-existent metadata column.';

