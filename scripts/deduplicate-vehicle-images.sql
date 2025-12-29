-- ============================================================================
-- DEDUPLICATE VEHICLE IMAGES
-- Removes duplicate image records (same URL stored multiple times per vehicle)
-- ============================================================================

-- Step 1: Identify duplicates
CREATE TEMP TABLE image_duplicates AS
SELECT 
  vehicle_id,
  image_url,
  COUNT(*) as duplicate_count,
  MIN(id) as keep_id,  -- Keep the first one
  ARRAY_AGG(id ORDER BY created_at ASC) as all_ids
FROM vehicle_images
GROUP BY vehicle_id, image_url
HAVING COUNT(*) > 1;

-- Step 2: Show stats before deletion
SELECT 
  'BEFORE DEDUPLICATION' as status,
  COUNT(*) as total_duplicate_records,
  SUM(duplicate_count - 1) as records_to_delete,
  COUNT(DISTINCT vehicle_id) as affected_vehicles
FROM image_duplicates;

-- Step 3: Delete duplicates (keep only the first record for each URL)
DELETE FROM vehicle_images
WHERE id IN (
  SELECT unnest(all_ids[2:array_length(all_ids, 1)])  -- Delete all except the first
  FROM image_duplicates
);

-- Step 4: Show stats after deletion
SELECT 
  'AFTER DEDUPLICATION' as status,
  COUNT(*) as total_image_records,
  COUNT(DISTINCT image_url) as unique_urls,
  COUNT(*) - COUNT(DISTINCT image_url) as remaining_duplicates
FROM vehicle_images;

-- Step 5: Update position numbers to be sequential (fix gaps from deletions)
WITH ranked AS (
  SELECT 
    id,
    ROW_NUMBER() OVER (PARTITION BY vehicle_id ORDER BY position ASC, created_at ASC) - 1 as new_position
  FROM vehicle_images
)
UPDATE vehicle_images vi
SET position = ranked.new_position
FROM ranked
WHERE vi.id = ranked.id
  AND vi.position != ranked.new_position;

-- Step 6: Final verification
SELECT 
  v.year,
  v.make,
  v.model,
  COUNT(vi.id) as total_records,
  COUNT(DISTINCT vi.image_url) as unique_images,
  COUNT(vi.id) - COUNT(DISTINCT vi.image_url) as still_duplicated
FROM vehicles v
JOIN vehicle_images vi ON vi.vehicle_id = v.id
WHERE v.id IN (SELECT DISTINCT vehicle_id FROM image_duplicates)
GROUP BY v.id, v.year, v.make, v.model
ORDER BY (COUNT(vi.id) - COUNT(DISTINCT vi.image_url)) DESC
LIMIT 20;

DROP TABLE image_duplicates;

