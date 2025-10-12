-- Find timeline events with unrealistic image counts
SELECT 
  v.year || ' ' || v.make || ' ' || v.model as vehicle,
  te.event_date,
  array_length(te.image_urls, 1) as image_count,
  te.metadata->>'source' as source,
  te.id as timeline_id,
  -- Check how many of these images lack EXIF
  (SELECT COUNT(*) 
   FROM unnest(te.image_urls) as url
   JOIN vehicle_images vi ON vi.image_url = url
   WHERE vi.exif_data IS NULL 
      OR (vi.exif_data->>'dateTimeOriginal' IS NULL 
          AND vi.exif_data->>'dateTime' IS NULL)
  ) as images_without_exif
FROM timeline_events te
JOIN vehicles v ON te.vehicle_id = v.id
WHERE array_length(te.image_urls, 1) > 30  -- Large dumps
ORDER BY te.event_date DESC, array_length(te.image_urls, 1) DESC;

-- Specifically check the vehicles with missing EXIF
SELECT 
  v.year || ' ' || v.make || ' ' || v.model as vehicle,
  vi.created_at::date as upload_date,
  COUNT(*) as images_no_exif
FROM vehicle_images vi
JOIN vehicles v ON vi.vehicle_id = v.id
WHERE (vi.exif_data IS NULL 
   OR (vi.exif_data->>'dateTimeOriginal' IS NULL 
       AND vi.exif_data->>'dateTime' IS NULL))
AND v.model IN ('K10', 'Suburban', 'K5', 'K20')
GROUP BY v.year, v.make, v.model, vi.created_at::date
HAVING COUNT(*) > 5
ORDER BY vi.created_at::date DESC;
