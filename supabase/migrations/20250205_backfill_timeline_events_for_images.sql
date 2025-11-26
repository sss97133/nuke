-- Backfill timeline events for existing images that don't have events
-- This ensures all uploaded images have corresponding timeline events

CREATE OR REPLACE FUNCTION backfill_timeline_events_for_images()
RETURNS INTEGER AS $$
DECLARE
  images_processed INTEGER := 0;
  image_record RECORD;
  event_date DATE;
  existing_event_id UUID;
BEGIN
  -- Loop through all vehicle_images that don't have a timeline_event_id
  FOR image_record IN 
    SELECT 
      vi.id,
      vi.vehicle_id,
      vi.user_id,
      vi.image_url,
      vi.taken_at,
      vi.created_at,
      vi.exif_data
    FROM vehicle_images vi
    WHERE vi.timeline_event_id IS NULL
    ORDER BY vi.created_at ASC
  LOOP
    -- Determine event date: use taken_at if available, otherwise use created_at
    IF image_record.taken_at IS NOT NULL THEN
      event_date := DATE(image_record.taken_at);
    ELSE
      event_date := DATE(image_record.created_at);
    END IF;
    
    -- Check if an event already exists for this vehicle and date
    SELECT id INTO existing_event_id
    FROM timeline_events
    WHERE vehicle_id = image_record.vehicle_id
      AND event_date = event_date
      AND (image_urls @> ARRAY[image_record.image_url] OR metadata->>'uploadedUrls' LIKE '%' || image_record.image_url || '%')
    LIMIT 1;
    
    IF existing_event_id IS NOT NULL THEN
      -- Link image to existing event
      UPDATE vehicle_images
      SET timeline_event_id = existing_event_id
      WHERE id = image_record.id;
      
      -- Update event to include this image if not already included
      UPDATE timeline_events
      SET 
        image_urls = CASE 
          WHEN image_record.image_url = ANY(image_urls) THEN image_urls
          ELSE array_append(image_urls, image_record.image_url)
        END,
        metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
          'photo_count', array_length(
            CASE 
              WHEN image_record.image_url = ANY(image_urls) THEN image_urls
              ELSE array_append(image_urls, image_record.image_url)
            END, 
            1
          ),
          'backfilled', true
        )
      WHERE id = existing_event_id;
    ELSE
      -- Create new event for this image
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
        image_record.vehicle_id,
        image_record.user_id,
        'pending_analysis',
        'photo_upload',
        event_date,
        '1 photo from ' || TO_CHAR(event_date, 'Mon DD, YYYY'),
        'Photo uploaded' || CASE WHEN image_record.taken_at IS NULL THEN ' (no EXIF date)' ELSE '' END,
        ARRAY[image_record.image_url],
        jsonb_build_object(
          'photo_count', 1,
          'needs_ai_analysis', true,
          'backfilled', true,
          'device_fingerprint', image_record.exif_data->'camera'
        )
      ) RETURNING id INTO existing_event_id;
      
      -- Link image to new event
      UPDATE vehicle_images
      SET timeline_event_id = existing_event_id
      WHERE id = image_record.id;
    END IF;
    
    images_processed := images_processed + 1;
  END LOOP;
  
  RETURN images_processed;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Run the backfill
SELECT backfill_timeline_events_for_images() as images_processed;

COMMENT ON FUNCTION backfill_timeline_events_for_images IS 
'Backfills timeline events for existing images that don''t have events. Can be run multiple times safely.';

