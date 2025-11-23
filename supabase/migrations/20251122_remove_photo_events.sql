-- Remove Photo Events from Timeline
-- Photos are not events - they are evidence/documentation
-- This migration permanently removes all photo_added, photo_session, and image_upload events

-- First, clear the timeline_event_id references from images
UPDATE vehicle_images
SET timeline_event_id = NULL
WHERE timeline_event_id IN (
  SELECT id FROM timeline_events 
  WHERE event_type IN ('photo_added', 'photo_session', 'image_upload')
);

-- Delete all photo-related timeline events
DELETE FROM timeline_events
WHERE event_type IN ('photo_added', 'photo_session', 'image_upload');

-- Drop the trigger that tries to delete timeline events when images are deleted
DROP TRIGGER IF EXISTS tr_delete_image_timeline_event ON vehicle_images;

-- Report cleanup results
DO $$
DECLARE
  remaining_events INTEGER;
  total_images INTEGER;
  orphaned_images INTEGER;
BEGIN
  SELECT COUNT(*) INTO remaining_events FROM timeline_events;
  SELECT COUNT(*) INTO total_images FROM vehicle_images;
  SELECT COUNT(*) INTO orphaned_images FROM vehicle_images WHERE timeline_event_id IS NOT NULL;
  
  RAISE NOTICE '=== PHOTO EVENTS CLEANUP COMPLETE ===';
  RAISE NOTICE 'Remaining timeline events: %', remaining_events;
  RAISE NOTICE 'Total vehicle images: %', total_images;
  RAISE NOTICE 'Images with timeline refs: % (should be 0)', orphaned_images;
END $$;

COMMENT ON TABLE timeline_events IS 
'Timeline of actual events (work performed, purchases, sales, repairs, etc). 
Photos are NOT events - they are evidence stored in vehicle_images table.';

COMMENT ON COLUMN vehicle_images.timeline_event_id IS 
'Legacy column - no longer used. Images are evidence shown in gallery, not timeline events.';

