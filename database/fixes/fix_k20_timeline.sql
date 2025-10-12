-- Check the current timeline events for 1985 K20
SELECT 
  te.id,
  te.event_date,
  array_length(te.image_urls, 1) as image_count,
  te.metadata,
  te.title
FROM timeline_events te
WHERE te.vehicle_id = 'a84273ab-4e0d-45c4-bdaa-5c9ad023079d'
ORDER BY te.event_date DESC;

-- Check which images have no dates for this vehicle
SELECT 
  vi.id,
  substring(vi.image_url from '[^/]+$') as filename,
  vi.created_at,
  vi.exif_data->>'dateTimeOriginal' as original,
  vi.exif_data->>'dateTime' as datetime,
  CASE 
    WHEN vi.exif_data->>'dateTimeOriginal' IS NULL 
     AND vi.exif_data->>'dateTime' IS NULL 
    THEN 'NO DATE'
    ELSE 'HAS DATE'
  END as date_status
FROM vehicle_images vi
WHERE vi.vehicle_id = 'a84273ab-4e0d-45c4-bdaa-5c9ad023079d'
  AND (vi.exif_data->>'dateTimeOriginal' IS NULL 
       AND vi.exif_data->>'dateTime' IS NULL)
ORDER BY vi.created_at DESC;

-- Delete the incorrect timeline events that include no-date images
DELETE FROM timeline_events 
WHERE vehicle_id = 'a84273ab-4e0d-45c4-bdaa-5c9ad023079d'
AND metadata->>'source' IN ('exif_universal', 'bulk_backfill', 'exif_corrected');

-- Create timeline events ONLY for images that HAVE valid dates
INSERT INTO timeline_events (
    vehicle_id,
    user_id,
    event_type,
    title,
    description,
    event_date,
    metadata,
    image_urls,
    source
)
SELECT 
    vi.vehicle_id,
    v.user_id,
    'maintenance' as event_type,
    CASE 
        WHEN COUNT(*) = 1 THEN 'Photo Documentation'
        ELSE 'Photo Documentation (' || COUNT(*) || ' photos)'
    END as title,
    'Vehicle work documented' as description,
    actual_date as event_date,
    jsonb_build_object(
        'image_count', COUNT(*),
        'source', 'dated_only',
        'note', 'Only includes images with valid EXIF dates'
    ) as metadata,
    array_agg(vi.image_url ORDER BY vi.created_at) as image_urls,
    'user_input' as source
FROM (
    SELECT 
        vehicle_id,
        image_url,
        created_at,
        CASE 
            WHEN exif_data->>'dateTimeOriginal' IS NOT NULL THEN 
                to_date(exif_data->>'dateTimeOriginal', 'YYYY:MM:DD HH24:MI:SS')
            WHEN exif_data->>'dateTime' IS NOT NULL THEN 
                to_date(exif_data->>'dateTime', 'YYYY:MM:DD HH24:MI:SS')
            ELSE NULL
        END as actual_date
    FROM vehicle_images
    WHERE vehicle_id = 'a84273ab-4e0d-45c4-bdaa-5c9ad023079d'
) vi
JOIN vehicles v ON vi.vehicle_id = v.id
WHERE actual_date IS NOT NULL  -- ONLY include images with real dates
GROUP BY vi.vehicle_id, v.user_id, actual_date;

-- Create a separate "Undated Images" entry for images without EXIF
INSERT INTO timeline_events (
    vehicle_id,
    user_id,
    event_type,
    title,
    description,
    event_date,
    metadata,
    image_urls,
    source
)
SELECT 
    vi.vehicle_id,
    v.user_id,
    'maintenance' as event_type,
    'Undated Photos (' || COUNT(*) || ' images)',
    'Photos without date information - actual dates unknown',
    '1985-01-01'::date,  -- Put at vehicle year as placeholder
    jsonb_build_object(
        'image_count', COUNT(*),
        'source', 'no_exif',
        'note', 'These images have no date metadata',
        'needs_manual_dating', true
    ) as metadata,
    array_agg(vi.image_url ORDER BY vi.created_at) as image_urls,
    'user_input' as source
FROM vehicle_images vi
JOIN vehicles v ON vi.vehicle_id = v.id
WHERE vi.vehicle_id = 'a84273ab-4e0d-45c4-bdaa-5c9ad023079d'
  AND (vi.exif_data IS NULL 
       OR (vi.exif_data->>'dateTimeOriginal' IS NULL 
           AND vi.exif_data->>'dateTime' IS NULL))
GROUP BY vi.vehicle_id, v.user_id
HAVING COUNT(*) > 0;

-- Show the new timeline
SELECT 
  te.event_date,
  te.title,
  array_length(te.image_urls, 1) as images,
  te.metadata->>'note' as note
FROM timeline_events te
WHERE te.vehicle_id = 'a84273ab-4e0d-45c4-bdaa-5c9ad023079d'
ORDER BY te.event_date DESC;
