-- Remove bad image and set good vehicle profile images as primary
-- Target image: import_queue_1765782670124_0.jpg
-- URL: https://qkgaybvrernstplzjaam.supabase.co/storage/v1/render/image/public/vehicle-images/6c455e2f-3bc8-4cdb-b971-aabb6d7ff557/import_queue_1765782670124_0.jpg?width=420&quality=70

-- Step 0: First, let's see what we're dealing with (diagnostic query)
SELECT 
  vi.id,
  vi.vehicle_id,
  vi.image_url,
  vi.filename,
  vi.storage_path,
  vi.is_primary,
  vi.is_document,
  vi.is_duplicate,
  vi.position,
  vi.created_at,
  v.make,
  v.model,
  v.year
FROM vehicle_images vi
LEFT JOIN vehicles v ON v.id = vi.vehicle_id
WHERE 
  (vi.filename = 'import_queue_1765782670124_0.jpg' 
   OR vi.filename LIKE '%import_queue_1765782670124_0.jpg%')
  OR (vi.image_url LIKE '%import_queue_1765782670124_0.jpg%')
  OR (vi.storage_path LIKE '%import_queue_1765782670124_0.jpg%')
ORDER BY vi.created_at DESC;

-- Step 1: Store affected vehicle IDs (vehicles that have the bad image as primary)
-- This needs to happen BEFORE we clear the primary flag
DROP TABLE IF EXISTS affected_vehicle_ids;
CREATE TEMP TABLE affected_vehicle_ids AS
SELECT DISTINCT vehicle_id
FROM vehicle_images
WHERE vehicle_id IS NOT NULL
  AND (
    (filename = 'import_queue_1765782670124_0.jpg' 
     OR filename LIKE '%import_queue_1765782670124_0.jpg%')
    OR (image_url LIKE '%import_queue_1765782670124_0.jpg%')
    OR (storage_path LIKE '%import_queue_1765782670124_0.jpg%')
  )
  AND is_primary = true;

-- Step 2: Clear primary flag from all bad images
UPDATE vehicle_images
SET is_primary = false
WHERE 
  (filename = 'import_queue_1765782670124_0.jpg' 
   OR filename LIKE '%import_queue_1765782670124_0.jpg%')
  OR (image_url LIKE '%import_queue_1765782670124_0.jpg%')
  OR (storage_path LIKE '%import_queue_1765782670124_0.jpg%');

-- Step 3: Set new primary images for affected vehicles
UPDATE vehicle_images vi
SET is_primary = true
FROM (
  SELECT DISTINCT ON (av.vehicle_id)
    av.vehicle_id,
    vi2.id as new_primary_id,
    vi2.image_url as new_primary_url
  FROM affected_vehicle_ids av
  CROSS JOIN LATERAL (
    SELECT 
      vi2.id,
      vi2.vehicle_id,
      vi2.image_url,
      vi2.position,
      vi2.taken_at,
      vi2.created_at,
      vi2.storage_path,
      CASE 
        WHEN vi2.storage_path IS NOT NULL AND vi2.storage_path != '' THEN 1
        WHEN vi2.image_url LIKE '%supabase.co/storage%' THEN 1
        ELSE 2
      END as hosting_priority
    FROM vehicle_images vi2
    WHERE vi2.vehicle_id = av.vehicle_id
      AND NOT (
        (vi2.filename = 'import_queue_1765782670124_0.jpg' 
         OR vi2.filename LIKE '%import_queue_1765782670124_0.jpg%')
        OR (vi2.image_url LIKE '%import_queue_1765782670124_0.jpg%')
        OR (vi2.storage_path LIKE '%import_queue_1765782670124_0.jpg%')
      )
      AND (vi2.is_document IS NULL OR vi2.is_document = false)
      AND (vi2.is_duplicate IS NULL OR vi2.is_duplicate = false)
      AND vi2.image_url IS NOT NULL
      AND vi2.image_url != ''
    ORDER BY 
      hosting_priority ASC,
      vi2.position ASC NULLS LAST,
      vi2.taken_at DESC NULLS LAST,
      vi2.created_at ASC,
      vi2.id ASC
    LIMIT 1
  ) vi2
  WHERE vi2.id IS NOT NULL
) new_primaries
WHERE vi.id = new_primaries.new_primary_id
  AND (vi.is_primary IS NULL OR vi.is_primary = false);

-- Step 4: Update vehicles table with new primary image URLs
UPDATE vehicles v
SET 
  primary_image_url = npc.new_primary_url,
  image_url = COALESCE(npc.new_primary_url, v.image_url)
FROM (
  SELECT DISTINCT ON (av.vehicle_id)
    av.vehicle_id,
    vi2.image_url as new_primary_url
  FROM affected_vehicle_ids av
  CROSS JOIN LATERAL (
    SELECT 
      vi2.id,
      vi2.vehicle_id,
      vi2.image_url,
      vi2.position,
      vi2.taken_at,
      vi2.created_at,
      vi2.storage_path,
      CASE 
        WHEN vi2.storage_path IS NOT NULL AND vi2.storage_path != '' THEN 1
        WHEN vi2.image_url LIKE '%supabase.co/storage%' THEN 1
        ELSE 2
      END as hosting_priority
    FROM vehicle_images vi2
    WHERE vi2.vehicle_id = av.vehicle_id
      AND NOT (
        (vi2.filename = 'import_queue_1765782670124_0.jpg' 
         OR vi2.filename LIKE '%import_queue_1765782670124_0.jpg%')
        OR (vi2.image_url LIKE '%import_queue_1765782670124_0.jpg%')
        OR (vi2.storage_path LIKE '%import_queue_1765782670124_0.jpg%')
      )
      AND (vi2.is_document IS NULL OR vi2.is_document = false)
      AND (vi2.is_duplicate IS NULL OR vi2.is_duplicate = false)
      AND vi2.image_url IS NOT NULL
      AND vi2.image_url != ''
    ORDER BY 
      hosting_priority ASC,
      vi2.position ASC NULLS LAST,
      vi2.taken_at DESC NULLS LAST,
      vi2.created_at ASC,
      vi2.id ASC
    LIMIT 1
  ) vi2
  WHERE vi2.id IS NOT NULL
) npc
WHERE v.id = npc.vehicle_id;

-- Step 5: Delete the bad image(s)
DELETE FROM vehicle_images
WHERE 
  (filename = 'import_queue_1765782670124_0.jpg' 
   OR filename LIKE '%import_queue_1765782670124_0.jpg%')
  OR (image_url LIKE '%import_queue_1765782670124_0.jpg%')
  OR (storage_path LIKE '%import_queue_1765782670124_0.jpg%');

-- Step 6: Verification and reporting
DO $$
DECLARE
  remaining_count INTEGER;
  vehicles_with_primary INTEGER;
  affected_vehicles_count INTEGER;
BEGIN
  -- Count any remaining images matching the pattern (should be 0)
  SELECT COUNT(*) INTO remaining_count
  FROM vehicle_images
  WHERE 
    (filename = 'import_queue_1765782670124_0.jpg' 
     OR filename LIKE '%import_queue_1765782670124_0.jpg%')
    OR (image_url LIKE '%import_queue_1765782670124_0.jpg%')
    OR (storage_path LIKE '%import_queue_1765782670124_0.jpg%');
  
  RAISE NOTICE 'Images matching pattern remaining in DB (should be 0): %', remaining_count;
  
  -- Count vehicles that now have primary images
  SELECT COUNT(DISTINCT vehicle_id) INTO vehicles_with_primary
  FROM vehicle_images
  WHERE is_primary = true
    AND vehicle_id IS NOT NULL;
  
  RAISE NOTICE 'Total vehicles with primary images: %', vehicles_with_primary;
  
  -- Count vehicles that were potentially affected (by UUID in original URL)
  SELECT COUNT(*) INTO affected_vehicles_count
  FROM vehicles
  WHERE id = '6c455e2f-3bc8-4cdb-b971-aabb6d7ff557'::uuid;
  
  RAISE NOTICE 'Vehicles with UUID from original URL: %', affected_vehicles_count;
END $$;

-- Step 7: Final verification query - Show affected vehicle(s) and their new primary images
SELECT 
  v.id as vehicle_id,
  v.make,
  v.model,
  v.year,
  v.primary_image_url,
  v.image_url as vehicle_image_url,
  vi.id as primary_image_id,
  vi.image_url as primary_image_url,
  vi.filename as primary_filename,
  vi.is_primary,
  vi.created_at as image_created_at,
  (SELECT COUNT(*) FROM vehicle_images vi2 WHERE vi2.vehicle_id = v.id) as total_images
FROM vehicles v
LEFT JOIN vehicle_images vi ON v.id = vi.vehicle_id AND vi.is_primary = true
WHERE v.id = '6c455e2f-3bc8-4cdb-b971-aabb6d7ff557'::uuid
   OR EXISTS (
     SELECT 1 
     FROM vehicle_images vi_check
     WHERE vi_check.vehicle_id = v.id
       AND (
         (vi_check.filename = 'import_queue_1765782670124_0.jpg' 
          OR vi_check.filename LIKE '%import_queue_1765782670124_0.jpg%')
         OR (vi_check.image_url LIKE '%import_queue_1765782670124_0.jpg%')
         OR (vi_check.storage_path LIKE '%import_queue_1765782670124_0.jpg%')
       )
   )
ORDER BY v.created_at DESC;

