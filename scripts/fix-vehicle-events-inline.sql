-- Quick inline consolidation for vehicle 05f27cc4-914e-425a-8ed8-cfea35c1928d
-- Groups photos within 30 minutes into work sessions

WITH ordered_events AS (
  SELECT 
    id,
    vehicle_id,
    user_id,
    event_date,
    created_at,
    metadata,
    LAG(event_date) OVER (ORDER BY event_date, created_at) as prev_event_date
  FROM vehicle_timeline_events
  WHERE vehicle_id = '05f27cc4-914e-425a-8ed8-cfea35c1928d'
    AND event_type = 'photo_added'
  ORDER BY event_date, created_at
),
session_markers AS (
  SELECT 
    *,
    CASE 
      WHEN prev_event_date IS NULL THEN TRUE
      WHEN (event_date - prev_event_date) > INTERVAL '30 minutes' THEN TRUE
      ELSE FALSE
    END as is_new_session
  FROM ordered_events
),
session_groups AS (
  SELECT 
    *,
    SUM(CASE WHEN is_new_session THEN 1 ELSE 0 END) OVER (ORDER BY event_date, created_at) as session_num
  FROM session_markers
),
session_summary AS (
  SELECT 
    vehicle_id,
    user_id,
    session_num,
    MIN(event_date) as session_start,
    MAX(event_date) as session_end,
    COUNT(*) as photo_count,
    EXTRACT(EPOCH FROM (MAX(event_date) - MIN(event_date)))/60 as duration_minutes
  FROM session_groups
  GROUP BY vehicle_id, user_id, session_num
)
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
    ELSE 'Work Session - ' || photo_count || ' photos'
  END,
  CASE 
    WHEN photo_count = 1 THEN 'Vehicle photo'
    WHEN duration_minutes < 1 THEN photo_count || ' photos taken'
    ELSE photo_count || ' photos over ' || ROUND(duration_minutes::numeric, 0) || ' minutes'
  END,
  jsonb_build_object(
    'photo_count', photo_count,
    'duration_minutes', ROUND(duration_minutes::numeric, 0),
    'start_time', session_start,
    'end_time', session_end,
    'consolidated', true
  )
FROM session_summary;

-- Delete old photo_added events
DELETE FROM vehicle_timeline_events
WHERE vehicle_id = '05f27cc4-914e-425a-8ed8-cfea35c1928d'
  AND event_type = 'photo_added';

DELETE FROM timeline_events
WHERE vehicle_id = '05f27cc4-914e-425a-8ed8-cfea35c1928d'
  AND event_type = 'photo_added';

-- Show final results
SELECT event_type, COUNT(*) as count
FROM vehicle_timeline_events
WHERE vehicle_id = '05f27cc4-914e-425a-8ed8-cfea35c1928d'
GROUP BY event_type;
