-- Add a timeline event for the existing vehicle
INSERT INTO vehicle_timeline_events (
  id,
  vehicle_id,
  user_id,
  event_type,
  title,
  description,
  event_date
)
SELECT 
  gen_random_uuid(),
  '7b07531f-e73a-4adb-b52c-d45922063edf'::uuid,
  v.user_id,
  'vehicle_added',
  'Vehicle Added',
  'Added 1995 Ford Bronco to the system',
  CURRENT_DATE
FROM vehicles v
WHERE v.id = '7b07531f-e73a-4adb-b52c-d45922063edf'
AND NOT EXISTS (
  SELECT 1 FROM vehicle_timeline_events 
  WHERE vehicle_id = '7b07531f-e73a-4adb-b52c-d45922063edf'
);
