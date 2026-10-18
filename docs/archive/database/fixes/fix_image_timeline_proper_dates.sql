-- Fix timeline events to use actual photo dates, not upload dates

-- Step 1: Check current problematic timeline events
SELECT 
    'Current Timeline Issues' as section,
    COUNT(*) as total_image_events,
    COUNT(CASE WHEN source = 'backfill_migration' THEN 1 END) as backfill_events,
    COUNT(CASE WHEN source = 'image_timeline_fix' THEN 1 END) as fix_events,
    COUNT(CASE WHEN metadata->>'source' = 'backfill_sql' THEN 1 END) as upload_date_events
FROM timeline_events 
WHERE event_type = 'maintenance' 
AND metadata->>'image_id' IS NOT NULL;

-- Step 2: Remove all the wrong timeline events (upload date based)
DELETE FROM timeline_events 
WHERE event_type = 'maintenance'
AND metadata->>'image_id' IS NOT NULL
AND (
    source = 'backfill_migration' 
    OR source = 'image_timeline_fix'
    OR metadata->>'source' = 'backfill_sql'
    OR metadata->>'source' = 'targeted_fix'
);

-- Step 3: Create proper timeline events using EXIF photo dates
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
    v.user_id,
    'maintenance',
    'photo_documentation',
    CASE 
        WHEN vi.is_primary THEN 'Primary Vehicle Photo'
        WHEN vi.category IS NOT NULL THEN INITCAP(vi.category) || ' Photo'
        ELSE 'Vehicle Photo'
    END,
    CASE 
        WHEN vi.is_primary THEN 'Primary vehicle photo taken'
        WHEN vi.category IS NOT NULL THEN 'Photo taken of vehicle ' || vi.category
        ELSE 'Vehicle photo taken'
    END,
    -- Use EXIF date if available, otherwise fall back to upload date
    COALESCE(
        (vi.exif_data->>'DateTimeOriginal')::date,
        (vi.exif_data->>'DateTime')::date,
        vi.created_at::date
    ),
    jsonb_build_object(
        'image_id', vi.id,
        'image_url', vi.image_url,
        'category', COALESCE(vi.category, 'general'),
        'is_primary', COALESCE(vi.is_primary, false),
        'photo_taken_date', COALESCE(
            vi.exif_data->>'DateTimeOriginal',
            vi.exif_data->>'DateTime',
            vi.created_at::text
        ),
        'upload_date', vi.created_at,
        'source', 'proper_photo_timeline',
        'created_at', NOW()
    )
FROM vehicle_images vi
JOIN vehicles v ON vi.vehicle_id = v.id
WHERE v.user_id IS NOT NULL;

-- Step 4: Verify the fix
SELECT 
    'After Proper Fix' as section,
    v.year,
    v.make,
    v.model,
    COUNT(vi.id) as image_count,
    COUNT(te.id) as timeline_count,
    COUNT(CASE WHEN te.event_date != vi.created_at::date THEN 1 END) as proper_photo_dates,
    CASE 
        WHEN COUNT(vi.id) = COUNT(te.id) THEN '✅ Complete'
        ELSE '❌ Missing events'
    END as status
FROM vehicles v
LEFT JOIN vehicle_images vi ON v.id = vi.vehicle_id
LEFT JOIN timeline_events te ON v.id = te.vehicle_id 
    AND te.source = 'photo_documentation'
    AND te.metadata->>'image_id' = vi.id::text
WHERE v.user_id IS NOT NULL
GROUP BY v.id, v.year, v.make, v.model
HAVING COUNT(vi.id) > 0
ORDER BY v.year DESC, v.make, v.model;
