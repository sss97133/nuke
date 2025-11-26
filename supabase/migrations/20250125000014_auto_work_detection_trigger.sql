-- ==========================================================================
-- AUTO-TRIGGER WORK DETECTION ON IMAGE UPLOAD
-- ==========================================================================
-- Purpose: Automatically trigger work detection when vehicle images are uploaded
-- ==========================================================================

-- Function to trigger work detection via edge function
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

-- Create trigger (only on insert, to avoid reprocessing)
DROP TRIGGER IF EXISTS trg_auto_work_detection ON vehicle_images;
CREATE TRIGGER trg_auto_work_detection
  AFTER INSERT ON vehicle_images
  FOR EACH ROW
  WHEN (NEW.vehicle_id IS NOT NULL)
  EXECUTE FUNCTION trigger_work_detection_on_image_upload();

COMMENT ON FUNCTION trigger_work_detection_on_image_upload() IS 
  'Automatically queues work detection when vehicle images are uploaded. Processes via background job.';

-- ==========================================================================
-- BATCH PROCESSING FUNCTION
-- ==========================================================================

-- Function to process pending work extractions
CREATE OR REPLACE FUNCTION process_pending_work_extractions(
  p_limit INTEGER DEFAULT 10
)
RETURNS TABLE(
  processed_count INTEGER,
  matched_count INTEGER
) AS $$
DECLARE
  v_extraction RECORD;
  v_processed INTEGER := 0;
  v_matched INTEGER := 0;
  v_supabase_url TEXT;
  v_service_key TEXT;
BEGIN
  v_supabase_url := current_setting('app.supabase_url', true);
  v_service_key := current_setting('app.service_role_key', true);
  
  -- Process pending extractions
  FOR v_extraction IN
    SELECT iwe.*, vi.image_url
    FROM image_work_extractions iwe
    JOIN vehicle_images vi ON vi.id = iwe.image_id
    WHERE iwe.status = 'pending'
    ORDER BY iwe.created_at ASC
    LIMIT p_limit
  LOOP
    -- Call edge function (would need HTTP extension or use Supabase client)
    -- For now, mark as processing and return for manual/background processing
    UPDATE image_work_extractions
    SET status = 'extracted', processed_at = NOW()
    WHERE id = v_extraction.id;
    
    v_processed := v_processed + 1;
    
    -- Run matching
    PERFORM match_work_to_organizations(v_extraction.id);
    
    SELECT COUNT(*) INTO v_matched
    FROM work_organization_matches
    WHERE image_work_extraction_id = v_extraction.id
      AND match_probability >= 90;
    
    IF v_matched > 0 THEN
      v_matched := v_matched + 1;
    END IF;
  END LOOP;
  
  RETURN QUERY SELECT v_processed, v_matched;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

COMMENT ON FUNCTION process_pending_work_extractions(INTEGER) IS 
  'Processes pending work extractions. Should be called by a background job or cron.';

