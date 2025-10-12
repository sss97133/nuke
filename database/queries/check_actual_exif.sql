-- Check if EXIF data is actually being extracted
SELECT 
    id,
    substring(image_url from '[^/]+$') as filename,
    exif_data IS NOT NULL as has_exif,
    exif_data->>'dateTaken' as date_taken,
    exif_data->>'DateTimeOriginal' as datetime_original,  
    created_at::date as upload_date,
    -- What's actually being used
    COALESCE(
        (exif_data->>'dateTaken')::date,
        (exif_data->>'DateTimeOriginal')::date,
        (exif_data->>'DateTime')::date,
        created_at::date
    ) as computed_date
FROM vehicle_images
WHERE vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e'
ORDER BY created_at DESC
LIMIT 20;

-- Check how many images actually have EXIF data
SELECT 
    COUNT(*) as total_images,
    COUNT(CASE WHEN exif_data IS NOT NULL THEN 1 END) as has_exif_data,
    COUNT(CASE WHEN exif_data->>'dateTaken' IS NOT NULL THEN 1 END) as has_date_taken,
    COUNT(CASE WHEN exif_data->>'DateTimeOriginal' IS NOT NULL THEN 1 END) as has_datetime_original
FROM vehicle_images
WHERE vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e';

-- Show the actual EXIF structure for a few images
SELECT 
    id,
    jsonb_pretty(exif_data) as exif_structure
FROM vehicle_images
WHERE vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e'
AND exif_data IS NOT NULL
LIMIT 3;
