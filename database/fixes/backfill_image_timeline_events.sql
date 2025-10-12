-- Backfill timeline events for vehicle images
-- Run this in Supabase SQL Editor

-- Step 1: Check current state
SELECT 
    'Current State' as report_section,
    COUNT(DISTINCT vi.vehicle_id) as vehicles_with_images,
    COUNT(vi.id) as total_images,
    COUNT(DISTINCT te.vehicle_id) as vehicles_with_timeline_events,
    COUNT(te.id) as total_timeline_events
FROM vehicle_images vi
LEFT JOIN vehicles v ON vi.vehicle_id = v.id
LEFT JOIN timeline_events te ON vi.vehicle_id = te.vehicle_id 
    AND te.event_type = 'maintenance'
    AND te.metadata->>'image_id' = vi.id::text
WHERE v.user_id IS NOT NULL;

-- Step 2: Create missing timeline events  
WITH image_data AS (
    SELECT 
        vi.vehicle_id,
        v.user_id,
        vi.id as image_id,
        vi.image_url,
        vi.category,
        vi.is_primary,
        vi.file_size,
        vi.mime_type,
        vi.created_at
    FROM vehicle_images vi
    JOIN vehicles v ON vi.vehicle_id = v.id
    WHERE NOT EXISTS (
        SELECT 1 FROM timeline_events te
        WHERE te.vehicle_id = vi.vehicle_id
        AND te.event_type = 'maintenance'
        AND te.metadata->>'image_id' = vi.id::text
    )
    AND vi.vehicle_id IS NOT NULL
    AND v.user_id IS NOT NULL
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
    id.vehicle_id,
    id.user_id,
    'maintenance',
    'backfill_migration',
    CASE 
        WHEN id.is_primary THEN 'Primary Image Upload'
        WHEN id.category IS NOT NULL THEN 'Image Upload - ' || INITCAP(id.category)
        ELSE 'Image Upload'
    END,
    CASE 
        WHEN id.is_primary THEN 'Primary vehicle image uploaded to profile'
        WHEN id.category IS NOT NULL THEN 'Image uploaded to ' || id.category || ' category'
        ELSE 'Image uploaded to vehicle profile'
    END,
    id.created_at::date,
    jsonb_build_object(
        'image_id', id.image_id,
        'image_url', id.image_url,
        'category', COALESCE(id.category, 'general'),
        'is_primary', COALESCE(id.is_primary, false),
        'file_size', id.file_size,
        'mime_type', id.mime_type,
        'source', 'backfill_sql',
        'backfilled_at', NOW(),
        'original_upload_date', id.created_at
    )
FROM image_data id;

-- Step 3: Final verification
SELECT 
    'After Backfill' as report_section,
    v.year,
    v.make,
    v.model,
    COUNT(vi.id) as image_count,
    COUNT(te.id) as timeline_event_count,
    CASE 
        WHEN COUNT(vi.id) = COUNT(te.id) THEN '✅ Complete'
        ELSE '❌ Missing Events'
    END as status
FROM vehicles v
LEFT JOIN vehicle_images vi ON v.id = vi.vehicle_id
LEFT JOIN timeline_events te ON v.id = te.vehicle_id 
    AND te.event_type = 'maintenance'
    AND te.metadata->>'image_id' IS NOT NULL
WHERE v.user_id IS NOT NULL
GROUP BY v.id, v.year, v.make, v.model
HAVING COUNT(vi.id) > 0
ORDER BY v.year DESC, v.make, v.model;
