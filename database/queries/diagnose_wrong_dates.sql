-- Find images that are likely using upload date instead of photo date
WITH image_dates AS (
  SELECT 
    vi.vehicle_id,
    v.year || ' ' || v.make || ' ' || v.model as vehicle_name,
    vi.id,
    vi.image_url,
    vi.created_at::date as upload_date,
    -- Extract actual photo date from EXIF
    CASE 
      WHEN vi.exif_data->>'dateTimeOriginal' IS NOT NULL THEN 
        to_date(vi.exif_data->>'dateTimeOriginal', 'YYYY:MM:DD HH24:MI:SS')
      WHEN vi.exif_data->>'dateTime' IS NOT NULL THEN 
        to_date(vi.exif_data->>'dateTime', 'YYYY:MM:DD HH24:MI:SS')
      ELSE NULL
    END as exif_date,
    vi.exif_data IS NOT NULL as has_exif,
    vi.exif_data->>'dateTimeOriginal' as datetime_original,
    vi.exif_data->>'dateTime' as datetime
  FROM vehicle_images vi
  JOIN vehicles v ON vi.vehicle_id = v.id
)
SELECT 
  vehicle_name,
  upload_date,
  COUNT(*) as image_count,
  COUNT(CASE WHEN exif_date IS NULL THEN 1 END) as missing_exif_date,
  COUNT(CASE WHEN exif_date = upload_date THEN 1 END) as exif_matches_upload,
  array_agg(DISTINCT exif_date) as unique_exif_dates
FROM image_dates
GROUP BY vehicle_name, upload_date
HAVING COUNT(*) > 10  -- Show dumps of 10+ images
ORDER BY upload_date DESC, image_count DESC;

-- Check specific problem dates you mentioned (Sept 16-21, 2025)
SELECT 
  te.event_date,
  te.title,
  array_length(te.image_urls, 1) as image_count,
  te.metadata->>'source' as source,
  v.year || ' ' || v.make || ' ' || v.model as vehicle
FROM timeline_events te
JOIN vehicles v ON te.vehicle_id = v.id
WHERE te.event_date BETWEEN '2025-09-16' AND '2025-09-21'
AND array_length(te.image_urls, 1) > 20
ORDER BY te.event_date DESC, array_length(te.image_urls, 1) DESC;

-- Find images with suspicious dates (future dates or upload dates)
SELECT 
  v.year || ' ' || v.make || ' ' || v.model as vehicle,
  COUNT(*) as total_images,
  COUNT(CASE 
    WHEN vi.exif_data->>'dateTimeOriginal' IS NULL 
    AND vi.exif_data->>'dateTime' IS NULL 
    THEN 1 
  END) as no_exif_date,
  COUNT(CASE 
    WHEN to_date(vi.exif_data->>'dateTimeOriginal', 'YYYY:MM:DD HH24:MI:SS') = vi.created_at::date
    THEN 1 
  END) as exif_equals_upload,
  COUNT(CASE 
    WHEN to_date(vi.exif_data->>'dateTimeOriginal', 'YYYY:MM:DD HH24:MI:SS') > CURRENT_DATE
    THEN 1 
  END) as future_dates
FROM vehicle_images vi
JOIN vehicles v ON vi.vehicle_id = v.id
GROUP BY v.id, v.year, v.make, v.model
HAVING COUNT(*) > 20
ORDER BY no_exif_date DESC;
