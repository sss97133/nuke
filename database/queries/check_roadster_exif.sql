-- Check the actual EXIF structure for roadster images
SELECT 
    id,
    substring(image_url from '[^/]+$') as filename,
    jsonb_pretty(exif_data) as exif_structure,
    exif_data->>'dateTimeOriginal' as datetime_original,
    exif_data->>'DateTimeOriginal' as datetime_original_caps,
    exif_data->>'dateTime' as datetime,
    exif_data->>'DateTime' as datetime_caps,
    exif_data->>'dateTaken' as date_taken,
    created_at::date as upload_date
FROM vehicle_images
WHERE vehicle_id = '21ee373f-765e-4e24-a69d-e59e2af4f467'
LIMIT 5;

-- Check if EXIF data even exists
SELECT 
    COUNT(*) as total,
    COUNT(CASE WHEN exif_data IS NULL THEN 1 END) as null_exif,
    COUNT(CASE WHEN exif_data = '{}' THEN 1 END) as empty_exif,
    COUNT(CASE WHEN jsonb_typeof(exif_data) = 'object' AND exif_data != '{}' THEN 1 END) as has_exif_data
FROM vehicle_images
WHERE vehicle_id = '21ee373f-765e-4e24-a69d-e59e2af4f467';

-- Show unique EXIF field names across all images
SELECT DISTINCT 
    jsonb_object_keys(exif_data) as exif_field
FROM vehicle_images
WHERE vehicle_id = '21ee373f-765e-4e24-a69d-e59e2af4f467'
AND exif_data IS NOT NULL 
AND exif_data != '{}';
