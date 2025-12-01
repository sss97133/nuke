-- Link Unorganized Images to Incomplete Vehicle Profiles
-- These vehicles were created from empty personal albums, so images weren't linked

-- For the 1970 Plymouth Roadrunner (created Nov 7, images uploaded before that)
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
  ORDER BY created_at DESC
  LIMIT 10
);

-- For the other 7 vehicles (created Nov 28, images uploaded Nov 29-30)
-- These need manual review since images came after vehicle creation
-- But we can link recent unorganized images to the most recent vehicle of that user
-- as a starting point

-- Link images uploaded around the time these vehicles were created
-- to the vehicle that matches the user
-- Only link to vehicles that currently have 0 images
UPDATE vehicle_images
SET 
  vehicle_id = subq.vehicle_id,
  organization_status = 'organized',
  organized_at = NOW(),
  updated_at = NOW()
FROM (
  SELECT 
    vi.id as image_id,
    v.id as vehicle_id,
    ROW_NUMBER() OVER (PARTITION BY v.id ORDER BY vi.created_at) as rn
  FROM vehicle_images vi
  CROSS JOIN vehicles v
  WHERE vi.user_id = v.uploaded_by
    AND vi.vehicle_id IS NULL
    AND vi.organization_status = 'unorganized'
    AND v.id IN (
      '7227bfd4-36a1-4122-9d24-cbcfc7f74362',
      '69571d27-d590-432f-abf6-f78e2885b401',
      'cc6a87d7-4fe7-4af2-9852-7d42397a0199',
      '4e01734f-e51d-493f-9013-e4c40e48d0ac',
      '3faa29a9-5f27-46de-83a1-9bce2b7fec6d',
      '83e27461-51f7-49ef-b9a6-b43fb3777068',
      'e7f4bda0-1dbd-4552-b551-4ccf025ea437'
    )
    AND vi.created_at BETWEEN '2025-11-28 13:00:00'::timestamptz AND '2025-11-30 16:00:00'::timestamptz
    AND NOT EXISTS (
      SELECT 1 FROM vehicle_images vi2 
      WHERE vi2.vehicle_id = v.id
    )
    AND rn <= 5  -- Link up to 5 images per vehicle
) subq
WHERE vehicle_images.id = subq.image_id;

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

