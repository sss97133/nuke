-- Auto-Group Photos Into Timeline Events
-- When photo uploaded, automatically create or append to event for that date

CREATE OR REPLACE FUNCTION auto_group_photos_into_events()
RETURNS TRIGGER 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  event_id_existing UUID;
  photo_date DATE;
BEGIN
  -- Only process if image has a taken_at date
  IF NEW.taken_at IS NULL THEN
    RETURN NEW;
  END IF;
  
  photo_date := DATE(NEW.taken_at);
  
  -- Check if timeline event already exists for this date
  SELECT id INTO event_id_existing
  FROM timeline_events
  WHERE vehicle_id = NEW.vehicle_id
    AND event_date = photo_date
  LIMIT 1;
  
  IF event_id_existing IS NOT NULL THEN
    -- Event exists - append photo to it
    UPDATE timeline_events
    SET 
      image_urls = array_append(image_urls, NEW.image_url),
      metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
        'photo_count', array_length(image_urls, 1) + 1,
        'last_photo_added', NOW()
      ),
      title = (array_length(image_urls, 1) + 1) || ' photos from ' || TO_CHAR(photo_date, 'Mon DD, YYYY')
    WHERE id = event_id_existing;
    
    -- Link image to event
    NEW.timeline_event_id := event_id_existing;
  ELSE
    -- Create new event for this date
    INSERT INTO timeline_events (
      vehicle_id,
      user_id,
      event_type,
      source,
      event_date,
      title,
      description,
      image_urls,
      metadata
    ) VALUES (
      NEW.vehicle_id,
      NEW.user_id,
      'pending_analysis',
      'photo_upload',
      photo_date,
      '1 photo from ' || TO_CHAR(photo_date, 'Mon DD, YYYY'),
      'AI analysis pending',
      ARRAY[NEW.image_url],
      jsonb_build_object(
        'photo_count', 1,
        'needs_ai_analysis', true,
        'device_fingerprint', NEW.exif_data->'camera',
        'created_at', NOW()
      )
    ) RETURNING id INTO event_id_existing;
    
    -- Link image to new event
    NEW.timeline_event_id := event_id_existing;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create trigger
DROP TRIGGER IF EXISTS trg_auto_group_photos ON vehicle_images;
CREATE TRIGGER trg_auto_group_photos
  BEFORE INSERT ON vehicle_images
  FOR EACH ROW
  EXECUTE FUNCTION auto_group_photos_into_events();

COMMENT ON FUNCTION auto_group_photos_into_events IS 
'Automatically groups photos by date into timeline events. Photos taken same day = same event.';

