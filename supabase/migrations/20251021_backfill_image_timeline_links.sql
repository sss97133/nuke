-- Backfill Timeline Event Links for Orphaned Images
-- 
-- PROBLEM: 200+ images exist but timeline_event_id is NULL
-- SOLUTION: Match images to their corresponding timeline events by date and vehicle
--
-- Strategy:
-- 1. Find all images without timeline_event_id
-- 2. Match each image to a timeline event by:
--    - Same vehicle_id
--    - Event type = 'photo_added'
--    - Event date matches image taken_at date
--    - Image URL is IN the event's image_urls array
-- 3. Update vehicle_images.timeline_event_id
-- 4. Add image URL to event's image_urls array if missing

-- First, let's see the damage
DO $$
DECLARE
  orphaned_count INTEGER;
  total_images INTEGER;
BEGIN
  SELECT COUNT(*) INTO total_images FROM vehicle_images;
  SELECT COUNT(*) INTO orphaned_count FROM vehicle_images WHERE timeline_event_id IS NULL;
  
  RAISE NOTICE 'Total images: %', total_images;
  RAISE NOTICE 'Orphaned images (no timeline link): %', orphaned_count;
  RAISE NOTICE 'Percentage orphaned: %', ROUND((orphaned_count::NUMERIC / NULLIF(total_images, 0) * 100), 2);
END $$;

-- Strategy 1: Link images to existing 'photo_added' events by date match
UPDATE vehicle_images vi
SET timeline_event_id = (
  SELECT vte.id
  FROM vehicle_timeline_events vte
  WHERE vte.vehicle_id = vi.vehicle_id
    AND vte.event_type = 'photo_added'
    AND DATE(vte.event_date) = DATE(COALESCE(vi.taken_at, vi.created_at))
    AND vte.image_urls @> ARRAY[vi.image_url] -- Event already has this image URL
  ORDER BY vte.created_at DESC
  LIMIT 1
)
WHERE vi.timeline_event_id IS NULL
  AND vi.vehicle_id IS NOT NULL
  AND EXISTS (
    SELECT 1 
    FROM vehicle_timeline_events vte
    WHERE vte.vehicle_id = vi.vehicle_id
      AND vte.event_type = 'photo_added'
      AND DATE(vte.event_date) = DATE(COALESCE(vi.taken_at, vi.created_at))
      AND vte.image_urls @> ARRAY[vi.image_url]
  );

-- Strategy 2: For images without matching events, create new 'photo_session' events
-- Group orphaned images by vehicle and date, create one event per day
WITH orphaned_images AS (
  SELECT 
    vi.vehicle_id,
    DATE(COALESCE(vi.taken_at, vi.created_at)) as photo_date,
    vi.user_id,
    ARRAY_AGG(vi.image_url ORDER BY vi.created_at) as image_urls,
    COUNT(*) as image_count,
    MIN(vi.created_at) as first_upload,
    MAX(vi.created_at) as last_upload
  FROM vehicle_images vi
  WHERE vi.timeline_event_id IS NULL
    AND vi.vehicle_id IS NOT NULL
  GROUP BY vi.vehicle_id, DATE(COALESCE(vi.taken_at, vi.created_at)), vi.user_id
),
new_events AS (
  INSERT INTO vehicle_timeline_events (
    vehicle_id,
    user_id,
    event_type,
    source,
    event_date,
    title,
    description,
    image_urls,
    metadata
  )
  SELECT 
    vehicle_id,
    user_id,
    'photo_session',
    'backfill_orphaned_images',
    photo_date,
    CASE 
      WHEN image_count = 1 THEN 'Photo Added'
      ELSE 'Photo Session (' || image_count || ' photos)'
    END,
    CASE 
      WHEN image_count = 1 THEN 'Orphaned image linked to timeline'
      ELSE image_count || ' orphaned images grouped into session'
    END,
    image_urls,
    jsonb_build_object(
      'backfill', true,
      'backfill_date', NOW(),
      'backfill_reason', 'Missing timeline_event_id on images',
      'photo_count', image_count,
      'upload_span', jsonb_build_object(
        'first', first_upload,
        'last', last_upload
      )
    )
  FROM orphaned_images
  RETURNING id, vehicle_id, photo_date as event_date, image_urls
)
-- Link the newly created events back to the orphaned images
UPDATE vehicle_images vi
SET timeline_event_id = ne.id
FROM new_events ne
WHERE vi.vehicle_id = ne.vehicle_id
  AND DATE(COALESCE(vi.taken_at, vi.created_at)) = ne.event_date
  AND vi.image_url = ANY(ne.image_urls)
  AND vi.timeline_event_id IS NULL;

-- Report results
DO $$
DECLARE
  remaining_orphaned INTEGER;
  total_events INTEGER;
  backfill_events INTEGER;
BEGIN
  SELECT COUNT(*) INTO remaining_orphaned FROM vehicle_images WHERE timeline_event_id IS NULL;
  SELECT COUNT(*) INTO total_events FROM vehicle_timeline_events;
  SELECT COUNT(*) INTO backfill_events FROM vehicle_timeline_events WHERE metadata->>'backfill' = 'true';
  
  RAISE NOTICE '=== BACKFILL COMPLETE ===';
  RAISE NOTICE 'Remaining orphaned images: %', remaining_orphaned;
  RAISE NOTICE 'Total timeline events: %', total_events;
  RAISE NOTICE 'Events created by backfill: %', backfill_events;
  
  IF remaining_orphaned = 0 THEN
    RAISE NOTICE '✅ SUCCESS: All images now linked to timeline events!';
  ELSE
    RAISE WARNING '⚠️  Still have % orphaned images - may need manual review', remaining_orphaned;
  END IF;
END $$;

