-- Fix Image URL Storage Bucket Mismatch
-- Update all URLs from vehicle-data bucket to vehicle-images bucket

UPDATE vehicle_images 
SET image_url = REPLACE(image_url, '/storage/v1/object/public/vehicle-data/', '/storage/v1/object/public/vehicle-images/')
WHERE vehicle_id = 'e7ed3e29-456a-43ea-843d-2dc0468ea4ca'
  AND image_url LIKE '%vehicle-data%';

-- Also fix the storage_path if it exists
UPDATE vehicle_images 
SET storage_path = REPLACE(storage_path, 'vehicles/', '')
WHERE vehicle_id = 'e7ed3e29-456a-43ea-843d-2dc0468ea4ca'
  AND storage_path LIKE 'vehicles/%';

-- Verify the fix
SELECT 
  id,
  file_name,
  image_url,
  storage_path
FROM vehicle_images 
WHERE vehicle_id = 'e7ed3e29-456a-43ea-843d-2dc0468ea4ca'
ORDER BY created_at DESC;
