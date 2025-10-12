-- Delete ALL backfilled timeline events to start fresh
DELETE FROM timeline_events 
WHERE metadata->>'source' IN ('bulk_backfill', 'manual_backfill', 'image_exif', 'grouped_by_day', 'exif_corrected', 'exif_universal');

-- Create timeline events for ALL vehicles that have images
-- This handles vehicles with OR without user_id
INSERT INTO timeline_events (
    vehicle_id,
    user_id,
    event_type,
    title,
    description,
    event_date,
    metadata,
    image_urls,
    source
)
SELECT 
    vi.vehicle_id,
    v.user_id,  -- Can be NULL, that's OK
    'maintenance' as event_type,
    CASE 
        WHEN image_count = 1 THEN 'Photo Documentation'
        ELSE 'Photo Documentation (' || image_count || ' photos)'
    END as title,
    'Vehicle work documented' as description,
    actual_date as event_date,
    jsonb_build_object(
        'image_count', image_count,
        'source', 'exif_universal'
    ) as metadata,
    image_urls,
    'user_input' as source
FROM (
    SELECT 
        vehicle_id,
        CASE 
            WHEN exif_data->>'dateTimeOriginal' IS NOT NULL THEN 
                to_date(exif_data->>'dateTimeOriginal', 'YYYY:MM:DD HH24:MI:SS')
            WHEN exif_data->>'dateTime' IS NOT NULL THEN 
                to_date(exif_data->>'dateTime', 'YYYY:MM:DD HH24:MI:SS')
            ELSE 
                created_at::date
        END as actual_date,
        array_agg(image_url ORDER BY created_at) as image_urls,
        COUNT(*) as image_count
    FROM vehicle_images
    GROUP BY vehicle_id, actual_date
) vi
JOIN vehicles v ON vi.vehicle_id = v.id;  -- Removed WHERE clause that filtered by user_id

-- Check results for ALL vehicles
SELECT 
    v.id,
    v.year || ' ' || v.make || ' ' || v.model as vehicle,
    v.user_id IS NOT NULL as has_user,
    COUNT(DISTINCT vi.id) as image_count,
    COUNT(DISTINCT te.id) as timeline_events,
    MIN(te.event_date) as earliest_event,
    MAX(te.event_date) as latest_event
FROM vehicles v
LEFT JOIN vehicle_images vi ON v.id = vi.vehicle_id
LEFT JOIN timeline_events te ON v.id = te.vehicle_id 
    AND te.metadata->>'source' = 'exif_universal'
GROUP BY v.id, v.year, v.make, v.model, v.user_id
HAVING COUNT(vi.id) > 0
ORDER BY COUNT(vi.id) DESC;

-- Specifically check the roadster
SELECT 
    'Roadster Check:' as check_type,
    COUNT(DISTINCT te.id) as timeline_events,
    COUNT(DISTINCT te.event_date) as unique_days
FROM timeline_events te
WHERE te.vehicle_id = '21ee373f-765e-4e24-a69d-e59e2af4f467'
    AND te.metadata->>'source' = 'exif_universal';
