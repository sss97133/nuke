-- Dedup vehicle_images: keep earliest row per (vehicle_id, image_url)
-- This runs outside the 8s PostgREST statement_timeout via migration path

-- Step 1: Temporarily disable statement_timeout for this session
SET statement_timeout = 0;

-- Step 2: Delete duplicates (keep earliest created_at, then lowest id as tiebreak)
DELETE FROM vehicle_images
WHERE id IN (
    SELECT id FROM (
        SELECT id,
               ROW_NUMBER() OVER (
                   PARTITION BY vehicle_id, image_url
                   ORDER BY created_at ASC, id ASC
               ) as rn
        FROM vehicle_images
        WHERE image_url IS NOT NULL
    ) ranked
    WHERE rn > 1
);

-- Step 3: Add unique index to prevent future duplicates
CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicle_images_unique_url
    ON vehicle_images (vehicle_id, image_url)
    WHERE image_url IS NOT NULL;
