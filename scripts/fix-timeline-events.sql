-- Load the consolidation function
\i supabase/functions/consolidate_photo_events.sql

-- Fix the specific vehicle with 400 events
SELECT * FROM consolidate_photo_events_for_vehicle('05f27cc4-914e-425a-8ed8-cfea35c1928d');

-- Show results
SELECT 
  event_type,
  COUNT(*) as count,
  MIN(event_date) as earliest,
  MAX(event_date) as latest
FROM vehicle_timeline_events
WHERE vehicle_id = '05f27cc4-914e-425a-8ed8-cfea35c1928d'
GROUP BY event_type
ORDER BY event_type;
