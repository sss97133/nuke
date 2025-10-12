-- Check what EXIF dates actually exist for the K5 Blazer
SELECT 
    id,
    image_url,
    exif_data->>'dateTaken' as date_taken,
    exif_data->>'DateTimeOriginal' as datetime_original,
    exif_data->>'DateTime' as datetime,
    created_at::date as upload_date,
    -- What date would be used for timeline
    COALESCE(
        (exif_data->>'dateTaken')::date,
        (exif_data->>'DateTimeOriginal')::date,
        (exif_data->>'DateTime')::date,
        created_at::date
    ) as timeline_date
FROM vehicle_images
WHERE vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e'
ORDER BY created_at DESC
LIMIT 20;

-- Count how many unique dates we should have
SELECT 
    COUNT(DISTINCT COALESCE(
        (exif_data->>'dateTaken')::date,
        (exif_data->>'DateTimeOriginal')::date,
        (exif_data->>'DateTime')::date,
        created_at::date
    )) as unique_dates,
    COUNT(*) as total_images
FROM vehicle_images
WHERE vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e';

-- See the date distribution
SELECT 
    COALESCE(
        (exif_data->>'dateTaken')::date,
        (exif_data->>'DateTimeOriginal')::date,
        (exif_data->>'DateTime')::date,
        created_at::date
    ) as event_date,
    COUNT(*) as image_count
FROM vehicle_images
WHERE vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e'
GROUP BY event_date
ORDER BY event_date DESC;
