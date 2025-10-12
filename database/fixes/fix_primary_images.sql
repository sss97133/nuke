-- Fix primary images so vehicles show up in DiscoveryFeed like the K5 Blazer

-- Step 1: Check current state
SELECT 
    'Current Primary Images' as report,
    COUNT(DISTINCT vehicle_id) as vehicles_with_primary_images
FROM vehicle_images 
WHERE is_primary = true;

-- Step 2: Set primary image for vehicles that don't have one
-- This will make them show up in DiscoveryFeed like the K5 Blazer
UPDATE vehicle_images 
SET is_primary = true 
WHERE id IN (
    SELECT DISTINCT ON (vehicle_id) id
    FROM vehicle_images vi
    WHERE vehicle_id NOT IN (
        -- Exclude vehicles that already have a primary image
        SELECT DISTINCT vehicle_id 
        FROM vehicle_images 
        WHERE is_primary = true
    )
    AND vehicle_id IN (
        -- Only vehicles that exist and have a user
        SELECT id FROM vehicles WHERE user_id IS NOT NULL
    )
    ORDER BY vehicle_id, created_at ASC
);

-- Step 3: Verify the fix
SELECT 
    'After Fix' as report,
    COUNT(DISTINCT vehicle_id) as vehicles_with_primary_images,
    COUNT(*) as total_primary_images
FROM vehicle_images 
WHERE is_primary = true;

-- Step 4: Show vehicles that should now appear in DiscoveryFeed
SELECT 
    v.year,
    v.make, 
    v.model,
    COUNT(vi.id) as total_images,
    COUNT(CASE WHEN vi.is_primary THEN 1 END) as primary_images,
    CASE 
        WHEN COUNT(CASE WHEN vi.is_primary THEN 1 END) > 0 THEN '✅ Will show in feed'
        ELSE '❌ Still missing primary'
    END as status
FROM vehicles v
LEFT JOIN vehicle_images vi ON v.id = vi.vehicle_id
WHERE v.user_id IS NOT NULL
GROUP BY v.id, v.year, v.make, v.model
HAVING COUNT(vi.id) > 0
ORDER BY v.year DESC, v.make, v.model;
