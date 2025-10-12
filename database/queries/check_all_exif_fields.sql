-- For images with NULL dateTimeOriginal, check ALL other EXIF fields
SELECT 
  substring(vi.image_url from '[^/]+$') as filename,
  vi.created_at::date as upload_date,
  vi.exif_data->>'dateTime' as date_time,
  vi.exif_data->>'dateTimeOriginal' as datetime_original,
  vi.exif_data->>'dateTimeDigitized' as datetime_digitized,
  -- Check for ANY other date-like fields
  jsonb_object_keys(vi.exif_data) as all_keys,
  jsonb_pretty(vi.exif_data) as full_exif
FROM vehicle_images vi
JOIN vehicles v ON vi.vehicle_id = v.id
WHERE v.model = 'K10' 
  AND v.year = 1980
  AND vi.exif_data->>'dateTimeOriginal' IS NULL
  AND vi.exif_data IS NOT NULL
LIMIT 5;

-- Check if dateTime or dateTimeDigitized exist when dateTimeOriginal is NULL
SELECT 
  v.year || ' ' || v.make || ' ' || v.model as vehicle,
  COUNT(*) as images_no_datetime_original,
  COUNT(CASE WHEN vi.exif_data->>'dateTime' IS NOT NULL THEN 1 END) as has_datetime,
  COUNT(CASE WHEN vi.exif_data->>'dateTimeDigitized' IS NOT NULL THEN 1 END) as has_datetime_digitized,
  COUNT(CASE 
    WHEN vi.exif_data->>'dateTimeOriginal' IS NULL 
    AND vi.exif_data->>'dateTime' IS NOT NULL 
    THEN 1 
  END) as can_use_datetime_instead,
  COUNT(CASE 
    WHEN vi.exif_data->>'dateTimeOriginal' IS NULL 
    AND vi.exif_data->>'dateTime' IS NULL
    AND vi.exif_data->>'dateTimeDigitized' IS NOT NULL 
    THEN 1 
  END) as can_use_digitized
FROM vehicle_images vi
JOIN vehicles v ON vi.vehicle_id = v.id
WHERE vi.exif_data->>'dateTimeOriginal' IS NULL
  AND v.id IN (
    '7176a5fc-24ae-4b42-9e65-0b96c4f9e50c', -- 1980 GMC K10
    'b1fd848d-c64d-4b3a-8d09-0bacfeef9561', -- 1987 Suburban
    'e08bf694-970f-4cbe-8a74-8715158a0f2e', -- 1977 K5
    'a84273ab-4e0d-45c4-bdaa-5c9ad023079d'  -- 1985 K20
  )
GROUP BY v.year, v.make, v.model;

-- Look at the actual values in dateTime field for these problem images
SELECT 
  substring(vi.image_url from '[^/]+$') as filename,
  vi.exif_data->>'dateTime' as date_time_value,
  vi.exif_data->>'dateTimeDigitized' as digitized_value,
  vi.created_at::date as upload_date
FROM vehicle_images vi
JOIN vehicles v ON vi.vehicle_id = v.id
WHERE v.model = 'K10' 
  AND v.year = 1980
  AND vi.exif_data->>'dateTimeOriginal' IS NULL
  AND (vi.exif_data->>'dateTime' IS NOT NULL 
       OR vi.exif_data->>'dateTimeDigitized' IS NOT NULL);
