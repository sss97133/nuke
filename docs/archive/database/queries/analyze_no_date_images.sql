-- Analyze the images with no dates to find patterns
SELECT 
  v.year || ' ' || v.make || ' ' || v.model as vehicle,
  substring(vi.image_url from '[^/]+$') as filename,
  vi.created_at,
  pg_size_pretty(octet_length(vi.image_url::text)::bigint) as url_size,
  vi.exif_data->>'make' as camera_make,
  vi.exif_data->>'model' as camera_model,
  vi.exif_data->>'software' as software,
  CASE 
    WHEN vi.image_url ~ '\d{10,13}_' THEN 'Has timestamp prefix'
    WHEN vi.image_url ~ 'IMG_\d+' THEN 'iPhone naming'
    WHEN vi.image_url ~ 'DSC' THEN 'Digital camera'
    WHEN vi.image_url ~ 'Screenshot' THEN 'Screenshot'
    ELSE 'Other pattern'
  END as filename_pattern
FROM vehicle_images vi
JOIN vehicles v ON vi.vehicle_id = v.id
WHERE vi.exif_data->>'dateTimeOriginal' IS NULL
  AND vi.exif_data->>'dateTime' IS NULL
  AND vi.exif_data->>'dateTimeDigitized' IS NULL
  AND v.id IN (
    '7176a5fc-24ae-4b42-9e65-0b96c4f9e50c', -- 1980 GMC K10
    'a84273ab-4e0d-45c4-bdaa-5c9ad023079d'  -- 1985 K20
  )
ORDER BY v.model, vi.created_at
LIMIT 20;

-- Group by upload session to see if they were batch uploaded
SELECT 
  v.year || ' ' || v.make || ' ' || v.model as vehicle,
  vi.created_at::date as upload_date,
  date_trunc('hour', vi.created_at) as upload_hour,
  COUNT(*) as images_in_batch,
  array_agg(substring(vi.image_url from '[^/]+$') ORDER BY vi.created_at LIMIT 3) as sample_files
FROM vehicle_images vi
JOIN vehicles v ON vi.vehicle_id = v.id
WHERE vi.exif_data->>'dateTimeOriginal' IS NULL
  AND vi.exif_data->>'dateTime' IS NULL
  AND v.id IN (
    '7176a5fc-24ae-4b42-9e65-0b96c4f9e50c', -- 1980 GMC K10
    'a84273ab-4e0d-45c4-bdaa-5c9ad023079d'  -- 1985 K20
  )
GROUP BY v.year, v.make, v.model, upload_date, upload_hour
ORDER BY upload_date DESC, upload_hour DESC;
