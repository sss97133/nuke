-- Fix vehicle image associations and backfill missing data
-- This addresses orphaned images and missing primary image flags

-- First, let's see what we're working with
DO $$
BEGIN
    RAISE NOTICE 'Current vehicle count: %', (SELECT COUNT(*) FROM vehicles);
    RAISE NOTICE 'Current image count: %', (SELECT COUNT(*) FROM vehicle_images);
    RAISE NOTICE 'Images with matching vehicles: %', (
        SELECT COUNT(*) 
        FROM vehicle_images vi 
        JOIN vehicles v ON vi.vehicle_id = v.id
    );
    RAISE NOTICE 'Orphaned images: %', (
        SELECT COUNT(*) 
        FROM vehicle_images vi 
        LEFT JOIN vehicles v ON vi.vehicle_id = v.id 
        WHERE v.id IS NULL
    );
END $$;

-- Update missing is_primary flags
-- If a vehicle has images but none are marked as primary, mark the first one as primary
UPDATE vehicle_images 
SET is_primary = true 
WHERE id IN (
    SELECT DISTINCT ON (vehicle_id) id
    FROM vehicle_images vi
    WHERE vehicle_id IN (
        -- Vehicles that have images but no primary image
        SELECT DISTINCT vehicle_id 
        FROM vehicle_images 
        WHERE vehicle_id NOT IN (
            SELECT DISTINCT vehicle_id 
            FROM vehicle_images 
            WHERE is_primary = true
        )
    )
    ORDER BY vehicle_id, created_at ASC
);

-- Clean up duplicate primary flags (ensure only one primary per vehicle)
WITH ranked_primaries AS (
    SELECT id, vehicle_id,
           ROW_NUMBER() OVER (PARTITION BY vehicle_id ORDER BY created_at ASC) as rn
    FROM vehicle_images 
    WHERE is_primary = true
)
UPDATE vehicle_images 
SET is_primary = false 
WHERE id IN (
    SELECT id FROM ranked_primaries WHERE rn > 1
);

-- Report on orphaned images that need manual cleanup
DO $$
DECLARE
    orphaned_record RECORD;
BEGIN
    RAISE NOTICE 'Orphaned images that need attention:';
    FOR orphaned_record IN 
        SELECT vi.id, vi.vehicle_id, vi.image_url, vi.created_at
        FROM vehicle_images vi 
        LEFT JOIN vehicles v ON vi.vehicle_id = v.id 
        WHERE v.id IS NULL
        ORDER BY vi.created_at DESC
    LOOP
        RAISE NOTICE 'Image ID: %, Vehicle ID: %, URL: %, Created: %', 
            orphaned_record.id, 
            orphaned_record.vehicle_id, 
            orphaned_record.image_url, 
            orphaned_record.created_at;
    END LOOP;
END $$;

-- Final report
DO $$
BEGIN
    RAISE NOTICE 'FINAL REPORT:';
    RAISE NOTICE 'Total vehicles: %', (SELECT COUNT(*) FROM vehicles);
    RAISE NOTICE 'Total images: %', (SELECT COUNT(*) FROM vehicle_images);
    RAISE NOTICE 'Vehicles with images: %', (
        SELECT COUNT(DISTINCT vehicle_id) 
        FROM vehicle_images vi 
        JOIN vehicles v ON vi.vehicle_id = v.id
    );
    RAISE NOTICE 'Vehicles with primary images: %', (
        SELECT COUNT(DISTINCT vehicle_id) 
        FROM vehicle_images 
        WHERE is_primary = true
    );
    RAISE NOTICE 'Remaining orphaned images: %', (
        SELECT COUNT(*) 
        FROM vehicle_images vi 
        LEFT JOIN vehicles v ON vi.vehicle_id = v.id 
        WHERE v.id IS NULL
    );
END $$;
