-- Check the roadster specifically
SELECT 
    v.id,
    v.year,
    v.make,
    v.model,
    v.user_id,
    COUNT(vi.id) as image_count,
    COUNT(te.id) as timeline_count
FROM vehicles v
LEFT JOIN vehicle_images vi ON v.id = vi.vehicle_id
LEFT JOIN timeline_events te ON v.id = te.vehicle_id 
    AND te.metadata->>'source' = 'exif_corrected'
WHERE v.id = '21ee373f-765e-4e24-a69d-e59e2af4f467'
GROUP BY v.id, v.year, v.make, v.model, v.user_id;

-- Check if it has images and what their EXIF looks like
SELECT 
    COUNT(*) as total_images,
    COUNT(CASE WHEN exif_data IS NOT NULL THEN 1 END) as has_exif,
    COUNT(CASE WHEN exif_data->>'dateTimeOriginal' IS NOT NULL THEN 1 END) as has_datetime_original,
    COUNT(CASE WHEN exif_data->>'dateTime' IS NOT NULL THEN 1 END) as has_datetime
FROM vehicle_images
WHERE vehicle_id = '21ee373f-765e-4e24-a69d-e59e2af4f467';

-- Sample EXIF from this vehicle
SELECT 
    id,
    jsonb_pretty(exif_data) as exif_structure,
    created_at::date as upload_date
FROM vehicle_images
WHERE vehicle_id = '21ee373f-765e-4e24-a69d-e59e2af4f467'
LIMIT 3;

-- See what dates would be extracted
SELECT 
    CASE 
        WHEN exif_data->>'dateTimeOriginal' IS NOT NULL THEN 
            to_date(exif_data->>'dateTimeOriginal', 'YYYY:MM:DD HH24:MI:SS')
        WHEN exif_data->>'dateTime' IS NOT NULL THEN 
            to_date(exif_data->>'dateTime', 'YYYY:MM:DD HH24:MI:SS')
        ELSE 
            created_at::date
    END as actual_date,
    COUNT(*) as image_count
FROM vehicle_images
WHERE vehicle_id = '21ee373f-765e-4e24-a69d-e59e2af4f467'
GROUP BY actual_date
ORDER BY actual_date DESC;
