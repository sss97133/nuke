-- Mark vehicles as 'pending' if they have no images
-- Run this in Supabase SQL Editor: https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/sql

-- First, apply the migration to set up triggers (if not already applied)
-- Then run this to fix the specific vehicles:

UPDATE vehicles
SET 
  status = 'pending',
  updated_at = NOW()
WHERE id IN (
  '21b489eb-6449-4096-a74a-fb9b5df33772',
  '24f38dc3-b970-45b5-8063-27dd7a59445f',
  '483f6a7c-8beb-45fd-afd1-9d8e3313bec6',
  '62fe83e8-e789-4275-81b5-f2fe53f0103f'
)
AND NOT EXISTS (
  SELECT 1 
  FROM vehicle_images 
  WHERE vehicle_images.vehicle_id = vehicles.id
)
AND status != 'pending';

-- Optional: Fix ALL vehicles without images (BAT listings and others)
-- Uncomment the line below to run:
-- SELECT * FROM fix_vehicles_without_images();

-- Verify the update
SELECT 
  v.id,
  v.year,
  v.make,
  v.model,
  v.status,
  COUNT(vi.id) as image_count
FROM vehicles v
LEFT JOIN vehicle_images vi ON v.id = vi.vehicle_id
WHERE v.id IN (
  '21b489eb-6449-4096-a74a-fb9b5df33772',
  '24f38dc3-b970-45b5-8063-27dd7a59445f',
  '483f6a7c-8beb-45fd-afd1-9d8e3313bec6',
  '62fe83e8-e789-4275-81b5-f2fe53f0103f'
)
GROUP BY v.id, v.year, v.make, v.model, v.status
ORDER BY v.id;

