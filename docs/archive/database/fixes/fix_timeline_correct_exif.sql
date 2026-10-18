-- DELETE all the wrong timeline events
DELETE FROM timeline_events 
WHERE metadata->>'source' IN ('bulk_backfill', 'manual_backfill', 'image_exif', 'grouped_by_day');

-- Create timeline events using the CORRECT EXIF field (dateTimeOriginal not dateTaken)
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
    actual_date as event_date,
    jsonb_build_object(
        'image_count', image_count,
        'source', 'exif_corrected'
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
JOIN vehicles v ON vi.vehicle_id = v.id
WHERE v.user_id IS NOT NULL;

-- Verify the fix
SELECT 
    v.year || ' ' || v.make || ' ' || v.model as vehicle,
    EXTRACT(YEAR FROM te.event_date) as year,
    EXTRACT(MONTH FROM te.event_date) as month,
    COUNT(*) as events_in_month,
    SUM((te.metadata->>'image_count')::int) as total_images
FROM timeline_events te
JOIN vehicles v ON te.vehicle_id = v.id
WHERE te.metadata->>'source' = 'exif_corrected'
GROUP BY v.year, v.make, v.model, EXTRACT(YEAR FROM te.event_date), EXTRACT(MONTH FROM te.event_date)
ORDER BY v.year DESC, v.make, v.model, year DESC, month DESC;
