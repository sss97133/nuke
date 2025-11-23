-- Backfill Orphaned Images (images without timeline events)
-- Fix images that don't have timeline_event_id set

-- For each orphaned image, create a timeline event and link it
DO $$
DECLARE
  orphan_record RECORD;
  new_event_id UUID;
  event_date DATE;
BEGIN
  -- Find all images without timeline events
  FOR orphan_record IN 
    SELECT 
      vi.id as image_id,
      vi.vehicle_id,
      vi.user_id,
      vi.image_url,
      vi.taken_at,
      vi.created_at,
      vi.exif_data
    FROM vehicle_images vi
    WHERE vi.timeline_event_id IS NULL
      AND vi.vehicle_id IS NOT NULL
    ORDER BY vi.created_at DESC
    LIMIT 1000 -- Process in batches
  LOOP
    -- Determine event date: use taken_at if available, otherwise created_at
    IF orphan_record.taken_at IS NOT NULL THEN
      event_date := DATE(orphan_record.taken_at);
    ELSE
      event_date := DATE(orphan_record.created_at);
    END IF;
    
    -- Create timeline event for this image
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
      orphan_record.vehicle_id,
      orphan_record.user_id,
      'photo_added',
      'backfill_orphaned',
      event_date,
      'Photo Added',
      'Photo documentation',
      ARRAY[orphan_record.image_url],
      jsonb_build_object(
        'image_url', orphan_record.image_url,
        'image_id', orphan_record.image_id,
        'backfilled', true,
        'backfilled_at', NOW(),
        'backfill_reason', 'orphaned_image_without_timeline_event'
      )
    ) RETURNING id INTO new_event_id;
    
    -- Link the image to the new timeline event
    UPDATE vehicle_images
    SET timeline_event_id = new_event_id
    WHERE id = orphan_record.image_id;
    
    RAISE NOTICE 'Created timeline event % for orphaned image %', new_event_id, orphan_record.image_id;
  END LOOP;
END $$;

-- Report results
DO $$
DECLARE
  orphaned_count INTEGER;
  total_images INTEGER;
BEGIN
  SELECT COUNT(*) INTO total_images FROM vehicle_images WHERE vehicle_id IS NOT NULL;
  SELECT COUNT(*) INTO orphaned_count FROM vehicle_images WHERE timeline_event_id IS NULL AND vehicle_id IS NOT NULL;
  
  RAISE NOTICE '=== ORPHANED IMAGES BACKFILL COMPLETE ===';
  RAISE NOTICE 'Total vehicle images: %', total_images;
  RAISE NOTICE 'Remaining orphaned images: %', orphaned_count;
  RAISE NOTICE 'Percentage linked: %', ROUND(100.0 * (total_images - orphaned_count) / NULLIF(total_images, 0), 2);
END $$;

