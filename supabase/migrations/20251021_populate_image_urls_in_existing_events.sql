-- Populate image_urls in Existing Timeline Events
--
-- PROBLEM: Existing 171 events don't have image_urls populated
-- SOLUTION: For each event, collect all linked images and populate image_urls array

-- Update existing timeline events to include their linked images
UPDATE vehicle_timeline_events vte
SET image_urls = (
  SELECT ARRAY_AGG(vi.image_url ORDER BY vi.created_at)
  FROM vehicle_images vi
  WHERE vi.timeline_event_id = vte.id
)
WHERE EXISTS (
  SELECT 1 
  FROM vehicle_images vi 
  WHERE vi.timeline_event_id = vte.id
)
AND (vte.image_urls IS NULL OR ARRAY_LENGTH(vte.image_urls, 1) = 0);

-- Report results
DO $$
DECLARE
  events_with_images INTEGER;
  total_events INTEGER;
  events_updated INTEGER;
BEGIN
  SELECT COUNT(*) INTO total_events FROM vehicle_timeline_events;
  SELECT COUNT(*) INTO events_with_images 
  FROM vehicle_timeline_events 
  WHERE image_urls IS NOT NULL AND ARRAY_LENGTH(image_urls, 1) > 0;
  
  GET DIAGNOSTICS events_updated = ROW_COUNT;
  
  RAISE NOTICE '=== IMAGE_URLS POPULATION COMPLETE ===';
  RAISE NOTICE 'Total timeline events: %', total_events;
  RAISE NOTICE 'Events with image_urls: %', events_with_images;
  RAISE NOTICE 'Events updated in this migration: %', events_updated;
  RAISE NOTICE 'Percentage with images: %', ROUND(100.0 * events_with_images / NULLIF(total_events, 0), 2);
END $$;

