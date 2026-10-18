-- Fix timeline events for the 1980 GMC K10 specifically

-- Step 1: Identify the 1980 GMC K10
SELECT 
    'Target Vehicle' as section,
    id as vehicle_id,
    make,
    model,
    year,
    user_id
FROM vehicles 
WHERE year = 1980 AND UPPER(make) = 'GMC' AND UPPER(model) = 'K10';

-- Step 2: Check its images
WITH target_vehicle AS (
    SELECT id FROM vehicles 
    WHERE year = 1980 AND UPPER(make) = 'GMC' AND UPPER(model) = 'K10'
)
SELECT 
    'Images for 1980 GMC K10' as section,
    COUNT(*) as total_images,
    COUNT(CASE WHEN is_primary THEN 1 END) as primary_images,
    MIN(created_at) as oldest_image,
    MAX(created_at) as newest_image
FROM vehicle_images vi
JOIN target_vehicle tv ON vi.vehicle_id = tv.id;

-- Step 3: Create timeline events for this vehicle's images
WITH target_vehicle AS (
    SELECT id, user_id FROM vehicles 
    WHERE year = 1980 AND UPPER(make) = 'GMC' AND UPPER(model) = 'K10'
)
INSERT INTO timeline_events (
    vehicle_id,
    user_id,
    event_type,
    source,
    title,
    description,
    event_date,
    metadata
)
SELECT 
    vi.vehicle_id,
    tv.user_id,
    'maintenance',
    'image_timeline_fix',
    CASE 
        WHEN vi.is_primary THEN 'Primary Image Upload'
        WHEN vi.category IS NOT NULL THEN 'Image Upload - ' || INITCAP(vi.category)
        ELSE 'Image Upload'
    END,
    CASE 
        WHEN vi.is_primary THEN 'Primary vehicle image uploaded to profile'
        WHEN vi.category IS NOT NULL THEN 'Image uploaded to ' || vi.category || ' category'
        ELSE 'Image uploaded to vehicle profile'
    END,
    vi.created_at::date,
    jsonb_build_object(
        'image_id', vi.id,
        'image_url', vi.image_url,
        'category', COALESCE(vi.category, 'general'),
        'is_primary', COALESCE(vi.is_primary, false),
        'file_size', vi.file_size,
        'mime_type', vi.mime_type,
        'source', 'targeted_fix',
        'fixed_at', NOW(),
        'original_upload_date', vi.created_at
    )
FROM vehicle_images vi
JOIN target_vehicle tv ON vi.vehicle_id = tv.id
WHERE NOT EXISTS (
    SELECT 1 FROM timeline_events te
    WHERE te.vehicle_id = vi.vehicle_id
    AND te.metadata->>'image_id' = vi.id::text
);

-- Step 4: Verify the fix
WITH target_vehicle AS (
    SELECT id FROM vehicles 
    WHERE year = 1980 AND UPPER(make) = 'GMC' AND UPPER(model) = 'K10'
)
SELECT 
    'After Fix' as section,
    COUNT(vi.id) as image_count,
    COUNT(te.id) as timeline_count,
    CASE 
        WHEN COUNT(vi.id) = COUNT(te.id) THEN '✅ Fixed'
        ELSE '❌ Still broken'
    END as status
FROM vehicle_images vi
JOIN target_vehicle tv ON vi.vehicle_id = tv.id
LEFT JOIN timeline_events te ON te.vehicle_id = tv.id 
    AND te.metadata->>'image_id' = vi.id::text;
