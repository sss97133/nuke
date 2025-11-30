-- Check if the auto-group photos trigger exists and is enabled
SELECT 
  trigger_name,
  event_manipulation,
  action_timing,
  action_statement
FROM information_schema.triggers
WHERE event_object_table = 'vehicle_images'
  AND trigger_name = 'trg_auto_group_photos';

-- Check if the function exists
SELECT 
  routine_name,
  routine_type
FROM information_schema.routines
WHERE routine_name = 'auto_group_photos_into_events';

-- Check recent timeline events for a specific vehicle
SELECT 
  id,
  vehicle_id,
  event_type,
  event_date,
  title,
  source,
  created_at
FROM timeline_events
WHERE vehicle_id = '2b620b41-f53e-440c-aba0-ad61ed41c4a6'
ORDER BY created_at DESC
LIMIT 10;

-- Check images for that vehicle
SELECT 
  id,
  vehicle_id,
  user_id,
  image_url,
  created_at,
  timeline_event_id
FROM vehicle_images
WHERE vehicle_id = '2b620b41-f53e-440c-aba0-ad61ed41c4a6'
ORDER BY created_at DESC
LIMIT 10;

