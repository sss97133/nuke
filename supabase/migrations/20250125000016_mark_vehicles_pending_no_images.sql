-- Mark specific vehicles as 'pending' if they have no images
-- This migration handles vehicles that were created but have no images uploaded yet

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

-- Log the update
DO $$
DECLARE
  updated_count INTEGER;
BEGIN
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RAISE NOTICE 'Updated % vehicles to pending status (no images)', updated_count;
END $$;

