-- Consolidate duplicate photo_added events into work sessions
-- Groups photos taken within 30 minutes into single events

-- Step 1: Create temporary table to track sessions
CREATE TEMP TABLE photo_sessions AS
WITH ordered_photos AS (
  SELECT 
    id,
    vehicle_id,
    event_date,
    metadata,
    user_id,
    created_at,
    ROW_NUMBER() OVER (PARTITION BY vehicle_id ORDER BY event_date, created_at) as rn
  FROM vehicle_timeline_events
  WHERE event_type = 'photo_added'
),
session_breaks AS (
  SELECT 
    p1.id,
    p1.vehicle_id,
    p1.event_date,
    p1.metadata,
    p1.user_id,
    p1.created_at,
    CASE 
      WHEN p2.event_date IS NULL THEN 1
      WHEN (p1.event_date - p2.event_date) > INTERVAL '30 minutes' THEN 1
      ELSE 0
    END as is_session_start
  FROM ordered_photos p1
  LEFT JOIN ordered_photos p2 ON p1.vehicle_id = p2.vehicle_id AND p1.rn = p2.rn + 1
),
session_groups AS (
  SELECT 
    *,
    SUM(is_session_start) OVER (PARTITION BY vehicle_id ORDER BY event_date, created_at) as session_id
  FROM session_breaks
)
SELECT 
  vehicle_id,
  session_id,
  user_id,
  MIN(event_date) as session_start,
  MAX(event_date) as session_end,
  COUNT(*) as photo_count,
  ARRAY_AGG(id ORDER BY event_date) as event_ids,
  EXTRACT(EPOCH FROM (MAX(event_date) - MIN(event_date)))/60 as duration_minutes
FROM session_groups
GROUP BY vehicle_id, session_id, user_id
HAVING COUNT(*) > 0;

-- Step 2: Create consolidated work session events
INSERT INTO vehicle_timeline_events (
  vehicle_id,
  user_id,
  event_type,
  source,
  event_date,
  title,
  description,
  metadata
)
SELECT 
  vehicle_id,
  user_id,
  'photo_session',
  'consolidated',
  session_start,
  CASE 
    WHEN photo_count = 1 THEN 'Photo Added'
    ELSE 'Work Session (' || photo_count || ' photos)'
  END,
  CASE 
    WHEN photo_count = 1 THEN 'Vehicle photo uploaded'
    ELSE 'Photo session - ' || photo_count || ' photos over ' || ROUND(duration_minutes::numeric) || ' minutes'
  END,
  jsonb_build_object(
    'photo_count', photo_count,
    'duration_minutes', ROUND(duration_minutes::numeric),
    'start_time', session_start,
    'end_time', session_end,
    'consolidated', true,
    'original_event_ids', event_ids
  )
FROM photo_sessions
WHERE photo_count > 0;

-- Step 3: Delete old individual photo_added events
DELETE FROM vehicle_timeline_events
WHERE event_type = 'photo_added';

-- Step 4: Also clean up duplicate events from timeline_events (legacy table)
DELETE FROM timeline_events
WHERE event_type = 'photo_added';

-- Report
SELECT 
  vehicle_id,
  COUNT(*) as session_count,
  SUM((metadata->>'photo_count')::int) as total_photos
FROM vehicle_timeline_events
WHERE event_type = 'photo_session'
GROUP BY vehicle_id;
