-- Delete all existing timeline events for images
DELETE FROM timeline_events 
WHERE metadata->>'image_id' IS NOT NULL
   OR metadata->>'source' IN ('bulk_backfill', 'manual_backfill', 'image_exif');

-- Create ONE timeline event per DAY with all images from that day
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
    v.user_id,
    'maintenance' as event_type,
    CASE 
        WHEN image_count = 1 THEN 'Photo Documentation'
        ELSE 'Photo Documentation (' || image_count || ' photos)'
    END as title,
    'Vehicle work documented' as description,
    work_date as event_date,
    jsonb_build_object(
        'image_count', image_count,
        'source', 'grouped_by_day'
    ) as metadata,
    image_urls,
    'user_input' as source
FROM (
    SELECT 
        vehicle_id,
        COALESCE(
            (exif_data->>'dateTaken')::date,
            (exif_data->>'DateTimeOriginal')::date,
            (exif_data->>'DateTime')::date,
            created_at::date
        ) as work_date,
        array_agg(image_url ORDER BY created_at) as image_urls,
        COUNT(*) as image_count
    FROM vehicle_images
    GROUP BY vehicle_id, work_date
) vi
JOIN vehicles v ON vi.vehicle_id = v.id
WHERE v.user_id IS NOT NULL;

-- Check the results
SELECT 
    v.year || ' ' || v.make || ' ' || v.model as vehicle,
    COUNT(DISTINCT te.event_date) as unique_days_with_work,
    COUNT(te.id) as timeline_events,
    SUM(jsonb_array_length(te.image_urls)) as total_images_linked
FROM timeline_events te
JOIN vehicles v ON te.vehicle_id = v.id
WHERE te.metadata->>'source' = 'grouped_by_day'
GROUP BY v.year, v.make, v.model
ORDER BY v.year DESC, v.make, v.model;
