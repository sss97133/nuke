-- Fix timeline events to use ACTUAL PHOTO DATES from EXIF, not upload dates
-- This is the correct pipeline: Images have EXIF dates → Timeline shows those dates

-- First, delete the bad backfill events
DELETE FROM timeline_events 
WHERE metadata->>'source' IN ('bulk_backfill', 'manual_backfill');

-- Now create timeline events using the CORRECT dates from EXIF
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
    'Photo Documentation' as title,
    'Vehicle work documented' as description,
    -- USE EXIF DATE IF IT EXISTS, OTHERWISE CREATED_AT
    COALESCE(
        (vi.exif_data->>'dateTaken')::date,
        (vi.exif_data->>'DateTimeOriginal')::date,
        (vi.exif_data->>'DateTime')::date,
        vi.created_at::date
    ) as event_date,
    jsonb_build_object(
        'image_id', vi.id,
        'category', COALESCE(vi.category, 'general'),
        'is_primary', COALESCE(vi.is_primary, false),
        'exif_date', vi.exif_data->>'dateTaken',
        'source', 'image_exif'
    ) as metadata,
    ARRAY[vi.image_url] as image_urls,
    'user_input' as source
FROM vehicle_images vi
JOIN vehicles v ON vi.vehicle_id = v.id
WHERE NOT EXISTS (
    SELECT 1 FROM timeline_events te
    WHERE te.vehicle_id = vi.vehicle_id
    AND te.metadata->>'image_id' = vi.id::text
)
AND v.user_id IS NOT NULL;

-- Check the results - group by actual dates
SELECT 
    v.year || ' ' || v.make || ' ' || v.model as vehicle,
    DATE_TRUNC('month', te.event_date) as month,
    COUNT(*) as events_in_month
FROM timeline_events te
JOIN vehicles v ON te.vehicle_id = v.id
GROUP BY v.year, v.make, v.model, month
ORDER BY v.year DESC, v.make, v.model, month DESC;
