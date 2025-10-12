-- Identify September 2025 image dumps that are likely wrong
SELECT 
  v.year || ' ' || v.make || ' ' || v.model as vehicle,
  vi.created_at::date as upload_date,
  COUNT(*) as images_uploaded,
  COUNT(CASE 
    WHEN vi.exif_data->>'dateTimeOriginal' IS NULL 
    AND vi.exif_data->>'dateTime' IS NULL 
    THEN 1 
  END) as missing_dates,
  COUNT(CASE 
    WHEN to_date(vi.exif_data->>'dateTimeOriginal', 'YYYY:MM:DD HH24:MI:SS') = vi.created_at::date
    THEN 1 
  END) as suspicious_matching_dates,
  array_agg(DISTINCT vi.id) as image_ids
FROM vehicle_images vi
JOIN vehicles v ON vi.vehicle_id = v.id
WHERE vi.created_at::date BETWEEN '2025-09-16' AND '2025-09-21'
GROUP BY v.year, v.make, v.model, vi.created_at::date
HAVING COUNT(*) > 10
ORDER BY vi.created_at::date DESC, COUNT(*) DESC;

-- Check timeline events that were created for these dates
SELECT 
  te.event_date,
  v.year || ' ' || v.make || ' ' || v.model as vehicle,
  array_length(te.image_urls, 1) as image_count,
  te.metadata,
  te.id as timeline_event_id
FROM timeline_events te
JOIN vehicles v ON te.vehicle_id = v.id
WHERE te.event_date BETWEEN '2025-09-16' AND '2025-09-21'
AND array_length(te.image_urls, 1) > 20
ORDER BY te.event_date, image_count DESC;

-- Sample check: Look at a few images from these dumps to see their EXIF
SELECT 
  vi.id,
  substring(vi.image_url from '[^/]+$') as filename,
  vi.created_at,
  vi.exif_data->>'dateTimeOriginal' as exif_datetime_original,
  vi.exif_data->>'dateTime' as exif_datetime,
  jsonb_pretty(vi.exif_data) as full_exif
FROM vehicle_images vi
WHERE vi.created_at::date = '2025-09-16'
LIMIT 5;
