-- Delete ALL timeline events for ALL vehicles
DELETE FROM timeline_events 
WHERE metadata->>'source' IN ('exif_universal', 'bulk_backfill', 'exif_corrected', 'spread_dumps', 'dated_only');

-- Create timeline events ONLY for images with VALID EXIF dates
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
        'source', 'verified_dates_only'
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
) vi
JOIN vehicles v ON vi.vehicle_id = v.id
WHERE actual_date IS NOT NULL  -- ONLY include images with real dates
GROUP BY vi.vehicle_id, v.user_id, actual_date;

-- Create a table to track images needing date information
CREATE TABLE IF NOT EXISTS images_needing_dates (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    image_id uuid REFERENCES vehicle_images(id) UNIQUE,
    vehicle_id uuid REFERENCES vehicles(id),
    user_id uuid REFERENCES auth.users(id),
    notification_sent boolean DEFAULT false,
    date_provided date,
    provided_at timestamptz,
    created_at timestamptz DEFAULT now()
);

-- Populate images that need dates
INSERT INTO images_needing_dates (image_id, vehicle_id, user_id)
SELECT 
    vi.id,
    vi.vehicle_id,
    v.user_id
FROM vehicle_images vi
JOIN vehicles v ON vi.vehicle_id = v.id
WHERE (vi.exif_data IS NULL 
       OR (vi.exif_data->>'dateTimeOriginal' IS NULL 
           AND vi.exif_data->>'dateTime' IS NULL))
  AND v.user_id IS NOT NULL
ON CONFLICT (image_id) DO NOTHING;

-- Create notifications table if it doesn't exist
CREATE TABLE IF NOT EXISTS notifications (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid REFERENCES auth.users(id),
    type text NOT NULL,
    title text NOT NULL,
    message text NOT NULL,
    metadata jsonb,
    action_url text,
    read boolean DEFAULT false,
    created_at timestamptz DEFAULT now()
);

-- Create notifications for users about undated images
INSERT INTO notifications (
    user_id,
    type,
    title,
    message,
    metadata,
    action_url,
    created_at
)
SELECT DISTINCT
    v.user_id,
    'missing_image_dates' as type,
    'Images Need Dating' as title,
    'You have ' || COUNT(DISTINCT vi.id) || ' images for your ' || 
    v.year || ' ' || v.make || ' ' || v.model || 
    ' that are missing date information. Please provide dates to add them to your timeline.' as message,
    jsonb_build_object(
        'vehicle_id', v.id,
        'image_count', COUNT(DISTINCT vi.id),
        'image_ids', array_agg(DISTINCT vi.id)
    ) as metadata,
    '/vehicle/' || v.id || '/date-images' as action_url,
    now() as created_at
FROM vehicle_images vi
JOIN vehicles v ON vi.vehicle_id = v.id
WHERE (vi.exif_data IS NULL 
       OR (vi.exif_data->>'dateTimeOriginal' IS NULL 
           AND vi.exif_data->>'dateTime' IS NULL))
  AND v.user_id IS NOT NULL
GROUP BY v.id, v.user_id, v.year, v.make, v.model;

-- Show summary of what needs dating
SELECT 
    v.year || ' ' || v.make || ' ' || v.model as vehicle,
    COUNT(DISTINCT vi.id) as images_without_dates,
    v.user_id IS NOT NULL as has_owner,
    CASE 
        WHEN v.user_id IS NOT NULL THEN 'Notification will be sent'
        ELSE 'Anonymous vehicle - no notification'
    END as status
FROM vehicle_images vi
JOIN vehicles v ON vi.vehicle_id = v.id
WHERE (vi.exif_data IS NULL 
       OR (vi.exif_data->>'dateTimeOriginal' IS NULL 
           AND vi.exif_data->>'dateTime' IS NULL))
GROUP BY v.id, v.year, v.make, v.model, v.user_id
ORDER BY COUNT(DISTINCT vi.id) DESC;
