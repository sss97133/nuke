-- One-time fix: Set all vehicles without VINs to pending status
-- Run this after applying the migration

UPDATE vehicles
SET 
  status = 'pending',
  updated_at = NOW()
WHERE (vin IS NULL OR TRIM(vin) = '')
  AND status IN ('active', 'draft', NULL)
  AND status != 'pending';

-- Verify the update
SELECT 
  v.id,
  v.year,
  v.make,
  v.model,
  v.vin,
  v.status,
  COUNT(vi.id) as image_count
FROM vehicles v
LEFT JOIN vehicle_images vi ON v.id = vi.vehicle_id
WHERE (v.vin IS NULL OR TRIM(v.vin) = '')
GROUP BY v.id, v.year, v.make, v.model, v.vin, v.status
ORDER BY v.created_at DESC
LIMIT 20;

