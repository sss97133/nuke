-- Check what's actually in the EXIF data for these "no date" images
SELECT 
  substring(vi.image_url from '[^/]+$') as filename,
  vi.created_at::date as upload_date,
  vi.exif_data->>'dateTime' as date_time,
  vi.exif_data->>'dateTimeOriginal' as datetime_original,
  vi.exif_data->>'dateTimeDigitized' as datetime_digitized,
  jsonb_pretty(vi.exif_data) as full_exif
FROM vehicle_images vi
JOIN vehicles v ON vi.vehicle_id = v.id
WHERE v.model = 'K10' 
  AND v.year = 1980
  AND vi.exif_data IS NOT NULL
LIMIT 10;

-- Check if these dates are valid or null strings
SELECT 
  v.year || ' ' || v.make || ' ' || v.model as vehicle,
  COUNT(*) as total,
  COUNT(CASE WHEN vi.exif_data->>'dateTimeOriginal' = '' THEN 1 END) as empty_string_dates,
  COUNT(CASE WHEN vi.exif_data->>'dateTimeOriginal' = 'null' THEN 1 END) as null_string_dates,
  COUNT(CASE WHEN vi.exif_data->>'dateTimeOriginal' IS NULL THEN 1 END) as actual_null_dates,
  COUNT(CASE WHEN length(vi.exif_data->>'dateTimeOriginal') > 0 
             AND vi.exif_data->>'dateTimeOriginal' != 'null' THEN 1 END) as has_real_date
FROM vehicle_images vi
JOIN vehicles v ON vi.vehicle_id = v.id
WHERE v.id IN (
  '7176a5fc-24ae-4b42-9e65-0b96c4f9e50c', -- 1980 GMC K10
  'b1fd848d-c64d-4b3a-8d09-0bacfeef9561', -- 1987 Suburban
  'e08bf694-970f-4cbe-8a74-8715158a0f2e', -- 1977 K5
  'a84273ab-4e0d-45c4-bdaa-5c9ad023079d'  -- 1985 K20
)
GROUP BY v.year, v.make, v.model;
