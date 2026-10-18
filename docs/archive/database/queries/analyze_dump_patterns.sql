-- Analyze filename patterns in the September dumps
SELECT 
  v.year || ' ' || v.make || ' ' || v.model as vehicle,
  created_at::date as upload_date,
  COUNT(*) as total,
  -- Check for timestamp patterns in filenames (often indicates batch uploads)
  COUNT(CASE WHEN image_url ~ '\d{10,13}_' THEN 1 END) as timestamp_filenames,
  COUNT(CASE WHEN image_url ~ '\.png$' THEN 1 END) as png_files,
  COUNT(CASE WHEN image_url ~ '\.jpeg$' OR image_url ~ '\.jpg$' THEN 1 END) as jpeg_files,
  -- Sample filenames
  array_agg(substring(image_url from '[^/]+$') ORDER BY created_at LIMIT 5) as sample_filenames
FROM vehicle_images vi
JOIN vehicles v ON vi.vehicle_id = v.id
WHERE created_at::date BETWEEN '2025-09-16' AND '2025-09-21'
GROUP BY v.year, v.make, v.model, created_at::date
HAVING COUNT(*) > 10
ORDER BY upload_date DESC, total DESC;

-- Check if these are actually old photos being uploaded in bulk
-- by looking at the actual image content/metadata
SELECT 
  vi.id,
  substring(vi.image_url from '[^/]+$') as filename,
  vi.created_at,
  vi.exif_data->>'software' as software,
  vi.exif_data->>'make' as camera_make,
  vi.exif_data->>'model' as camera_model,
  pg_size_pretty(length(vi.image_url::text)) as url_length
FROM vehicle_images vi
WHERE vi.created_at::date = '2025-09-20'
AND vi.vehicle_id = (SELECT id FROM vehicles WHERE model = 'K5' LIMIT 1)
LIMIT 10;
