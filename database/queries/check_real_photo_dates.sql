-- Check ALL images to see their REAL photo dates from EXIF
SELECT 
    vehicle_id,
    COUNT(*) as image_count,
    COUNT(CASE WHEN exif_data IS NOT NULL THEN 1 END) as has_exif,
    COUNT(CASE WHEN exif_data->>'dateTimeOriginal' IS NOT NULL THEN 1 END) as has_datetime_original,
    COUNT(CASE WHEN exif_data->>'dateTaken' IS NOT NULL THEN 1 END) as has_date_taken
FROM vehicle_images
GROUP BY vehicle_id;

-- Get the actual date distribution using the CORRECT EXIF field
SELECT 
    vehicle_id,
    CASE 
        WHEN exif_data->>'dateTimeOriginal' IS NOT NULL THEN 
            to_date(exif_data->>'dateTimeOriginal', 'YYYY:MM:DD HH24:MI:SS')
        WHEN exif_data->>'dateTime' IS NOT NULL THEN 
            to_date(exif_data->>'dateTime', 'YYYY:MM:DD HH24:MI:SS')
        ELSE 
            created_at::date
    END as actual_photo_date,
    COUNT(*) as image_count
FROM vehicle_images
WHERE vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e'
GROUP BY vehicle_id, actual_photo_date
ORDER BY actual_photo_date DESC;

-- Show timeline events are using wrong dates
SELECT 
    event_date,
    COUNT(*) as event_count,
    array_length(image_urls, 1) as images_per_event
FROM timeline_events
WHERE vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e'
AND metadata->>'source' IN ('bulk_backfill', 'manual_backfill', 'image_exif')
GROUP BY event_date, image_urls
ORDER BY event_date DESC
LIMIT 20;
