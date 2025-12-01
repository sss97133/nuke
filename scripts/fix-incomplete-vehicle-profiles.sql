-- Fix Incomplete Vehicle Profiles
-- Links missing images to vehicles that were created from personal albums
-- but didn't get their images linked properly

-- Vehicle 1: 1970 Plymouth Roadrunner
-- Link unorganized images uploaded before vehicle creation
UPDATE vehicle_images
SET 
  vehicle_id = '18377b38-4232-4549-ba36-acce06b7f67e',
  organization_status = 'organized',
  organized_at = NOW(),
  updated_at = NOW()
WHERE id IN (
  SELECT id FROM vehicle_images
  WHERE user_id = '0b9f107a-d124-49de-9ded-94698f63c1c4'
    AND vehicle_id IS NULL
    AND organization_status = 'unorganized'
    AND created_at < '2025-11-07 15:00:00'::timestamptz
  LIMIT 10
);

-- For vehicles created on Nov 28, check if there are images uploaded around that time
-- that should be linked. These vehicles were created from empty albums or albums
-- that didn't have images in image_set_members.

-- Note: The other 7 vehicles (created Nov 28) have images uploaded AFTER they were created,
-- which suggests the albums were converted before images were added to them.
-- These would need manual review or a different linking strategy.

-- Check results
SELECT 
  v.id,
  v.year || ' ' || v.make || ' ' || v.model as vehicle_name,
  COUNT(vi.id) as image_count,
  COUNT(te.id) as timeline_event_count
FROM vehicles v
LEFT JOIN vehicle_images vi ON vi.vehicle_id = v.id
LEFT JOIN timeline_events te ON te.vehicle_id = v.id
WHERE v.id IN (
  '18377b38-4232-4549-ba36-acce06b7f67e',
  '7227bfd4-36a1-4122-9d24-cbcfc7f74362',
  '69571d27-d590-432f-abf6-f78e2885b401',
  'cc6a87d7-4fe7-4af2-9852-7d42397a0199',
  '4e01734f-e51d-493f-9013-e4c40e48d0ac',
  '3faa29a9-5f27-46de-83a1-9bce2b7fec6d',
  '83e27461-51f7-49ef-b9a6-b43fb3777068',
  'e7f4bda0-1dbd-4552-b551-4ccf025ea437'
)
GROUP BY v.id, v.year, v.make, v.model
ORDER BY v.id;

