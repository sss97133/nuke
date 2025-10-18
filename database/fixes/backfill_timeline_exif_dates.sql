-- Backfill Timeline Events with Correct EXIF Dates
-- 
-- Problem: Timeline events were created with upload date instead of EXIF date_taken,
-- breaking vehicle timeline chronology and user contribution graphs.
--
-- Solution: Update timeline_events.event_date to match vehicle_images.taken_at
--
-- This fixes:
-- - Vehicle timeline showing events on wrong dates
-- - User contribution graphs (GitHub-style) showing work on wrong dates
-- - Work hour tracking based on timeline events
--
-- Created: 2025-10-18

-- Show what will be updated (dry run)
SELECT 
  te.id AS timeline_event_id,
  te.event_type,
  te.event_date AS current_event_date,
  vi.taken_at AS correct_date_from_exif,
  vi.taken_at::date AS new_event_date,
  te.metadata->>'image_url' AS image_url,
  vi.vehicle_id
FROM timeline_events te
JOIN vehicle_images vi ON te.metadata->>'image_url' = vi.image_url
WHERE 
  te.event_type IN ('image_upload', 'photo_added', 'document_added')
  AND vi.taken_at IS NOT NULL
  AND te.event_date::date != vi.taken_at::date
ORDER BY vi.vehicle_id, vi.taken_at;

-- Uncomment below to execute the update
-- WARNING: This modifies data. Make a backup first!

/*
-- Update timeline events with correct EXIF dates
WITH updated AS (
  UPDATE timeline_events te
  SET 
    event_date = vi.taken_at::date,
    metadata = jsonb_set(
      COALESCE(te.metadata, '{}'::jsonb),
      '{when,photo_taken}',
      to_jsonb(vi.taken_at),
      true
    )
  FROM vehicle_images vi
  WHERE 
    te.event_type IN ('image_upload', 'photo_added', 'document_added')
    AND te.metadata->>'image_url' = vi.image_url
    AND vi.taken_at IS NOT NULL
    AND te.event_date::date != vi.taken_at::date
  RETURNING 
    te.id,
    te.vehicle_id,
    te.event_type,
    te.event_date,
    vi.taken_at AS corrected_from
)
SELECT 
  COUNT(*) AS total_updated,
  COUNT(DISTINCT vehicle_id) AS vehicles_affected
FROM updated;

-- Show updated records
SELECT 
  te.id,
  te.vehicle_id,
  te.event_type,
  te.event_date,
  te.metadata->'when'->>'photo_taken' AS photo_taken_metadata
FROM timeline_events te
WHERE 
  te.event_type IN ('image_upload', 'photo_added', 'document_added')
  AND te.metadata->'when'->>'photo_taken' IS NOT NULL
ORDER BY te.event_date DESC
LIMIT 20;
*/

-- Verification queries (run after update)
/*
-- Check that timeline events now match image taken_at dates
SELECT 
  te.vehicle_id,
  COUNT(*) AS events_with_correct_dates,
  COUNT(DISTINCT DATE(te.event_date)) AS unique_event_dates
FROM timeline_events te
JOIN vehicle_images vi ON te.metadata->>'image_url' = vi.image_url
WHERE 
  te.event_type IN ('image_upload', 'photo_added', 'document_added')
  AND vi.taken_at IS NOT NULL
  AND te.event_date::date = vi.taken_at::date
GROUP BY te.vehicle_id
ORDER BY events_with_correct_dates DESC;

-- Check user contributions are now on correct dates
SELECT 
  te.user_id,
  DATE(te.event_date) AS contribution_date,
  COUNT(*) AS events_on_date
FROM timeline_events te
WHERE te.event_type IN ('image_upload', 'photo_added', 'document_added')
GROUP BY te.user_id, DATE(te.event_date)
ORDER BY te.user_id, contribution_date DESC;
*/

