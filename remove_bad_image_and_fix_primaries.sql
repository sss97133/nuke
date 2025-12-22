-- Remove bad image and set good vehicle profile images as primary
-- Target image: import_queue_1765782670124_0.jpg
-- URL: https://qkgaybvrernstplzjaam.supabase.co/storage/v1/render/image/public/vehicle-images/6c455e2f-3bc8-4cdb-b971-aabb6d7ff557/import_queue_1765782670124_0.jpg

-- Step 1: First, set a good primary image for affected vehicles
-- (Do this BEFORE deleting, so we have a replacement ready)
-- This updates vehicles that currently have the bad image as primary
UPDATE vehicle_images vi
SET is_primary = true
FROM (
  SELECT DISTINCT ON (av.vehicle_id)
    av.vehicle_id,
    vi2.id as new_primary_id
  FROM (
    -- Find vehicles that have the bad image as primary
    SELECT DISTINCT vehicle_id
    FROM vehicle_images
    WHERE is_primary = true
      AND vehicle_id IS NOT NULL
      AND (
        (filename = 'import_queue_1765782670124_0.jpg' 
         OR filename LIKE '%import_queue_1765782670124_0.jpg%')
        OR (image_url LIKE '%import_queue_1765782670124_0.jpg%')
        OR (storage_path LIKE '%import_queue_1765782670124_0.jpg%')
      )
  ) av
  CROSS JOIN LATERAL (
    SELECT 
      vi2.id,
      vi2.vehicle_id,
      vi2.position,
      vi2.taken_at,
      vi2.created_at,
      vi2.image_url,
      vi2.storage_path,
      -- Prefer Supabase-hosted images (have storage_path or Supabase URL)
      CASE 
        WHEN vi2.storage_path IS NOT NULL THEN 1
        WHEN vi2.image_url LIKE '%supabase.co/storage%' THEN 1
        ELSE 2
      END as hosting_priority
    FROM vehicle_images vi2
    WHERE vi2.vehicle_id = av.vehicle_id
      -- Exclude the bad image
      AND NOT (
        (vi2.filename = 'import_queue_1765782670124_0.jpg' 
         OR vi2.filename LIKE '%import_queue_1765782670124_0.jpg%')
        OR (vi2.image_url LIKE '%import_queue_1765782670124_0.jpg%')
        OR (vi2.storage_path LIKE '%import_queue_1765782670124_0.jpg%')
      )
      -- Only non-document, non-duplicate images
      AND (vi2.is_document IS NULL OR vi2.is_document = false)
      AND (vi2.is_duplicate IS NULL OR vi2.is_duplicate = false)
      -- Must have a valid image URL
      AND vi2.image_url IS NOT NULL
      AND vi2.image_url != ''
    ORDER BY 
      hosting_priority ASC,  -- Prefer Supabase-hosted
      vi2.position ASC NULLS LAST,  -- Lower position = earlier in gallery
      vi2.taken_at DESC NULLS LAST,  -- More recent taken_at
      vi2.created_at ASC,  -- Older created_at (more established)
      vi2.id ASC
    LIMIT 1
  ) vi2
  WHERE vi2.id IS NOT NULL
) new_primaries
WHERE vi.id = new_primaries.new_primary_id
  AND vi.is_primary = false;

-- Step 2: Clear primary flag from all bad images
UPDATE vehicle_images
SET is_primary = false
WHERE 
  (filename = 'import_queue_1765782670124_0.jpg' 
   OR filename LIKE '%import_queue_1765782670124_0.jpg%')
  OR (image_url LIKE '%import_queue_1765782670124_0.jpg%')
  OR (storage_path LIKE '%import_queue_1765782670124_0.jpg%');

-- Step 3: Delete the bad image(s)
DELETE FROM vehicle_images
WHERE 
  (filename = 'import_queue_1765782670124_0.jpg' 
   OR filename LIKE '%import_queue_1765782670124_0.jpg%')
  OR (image_url LIKE '%import_queue_1765782670124_0.jpg%')
  OR (storage_path LIKE '%import_queue_1765782670124_0.jpg%');

-- Step 4: Report what was done
DO $$
DECLARE
  remaining_count INTEGER;
  vehicles_with_primary INTEGER;
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
  
  -- Count vehicles that now have primary images (that were affected)
  -- We can't easily track which vehicles were affected after deletion,
  -- but we can verify that vehicles generally have primaries
  SELECT COUNT(DISTINCT vehicle_id) INTO vehicles_with_primary
  FROM vehicle_images
  WHERE is_primary = true
    AND vehicle_id IS NOT NULL;
  
  RAISE NOTICE 'Total vehicles with primary images: %', vehicles_with_primary;
END $$;

-- Step 5: Verification query - Show vehicles that might have been affected
-- (This shows vehicles with UUID matching the path in the original URL)
-- The UUID 6c455e2f-3bc8-4cdb-b971-aabb6d7ff557 might be the vehicle_id
SELECT 
  v.id as vehicle_id,
  v.make,
  v.model,
  v.year,
  vi.id as primary_image_id,
  vi.image_url as primary_image_url,
  vi.filename as primary_filename,
  vi.is_primary,
  vi.created_at as image_created_at,
  (SELECT COUNT(*) FROM vehicle_images vi2 WHERE vi2.vehicle_id = v.id) as total_images
FROM vehicles v
LEFT JOIN vehicle_images vi ON v.id = vi.vehicle_id AND vi.is_primary = true
WHERE v.id = '6c455e2f-3bc8-4cdb-b971-aabb6d7ff557'::uuid
ORDER BY v.created_at DESC;

