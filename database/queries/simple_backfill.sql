-- Simple backfill - just create the missing timeline events
-- No fancy reporting, just the INSERT

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
        WHEN vi.is_primary THEN 'Primary Image Upload'
        WHEN vi.category IS NOT NULL THEN 'Image Upload - ' || INITCAP(vi.category)
        ELSE 'Image Upload'
    END as title,
    CASE 
        WHEN vi.is_primary THEN 'Primary vehicle image uploaded to profile'
        WHEN vi.category IS NOT NULL THEN 'Image uploaded to ' || vi.category || ' category'
        ELSE 'Image uploaded to vehicle profile'
    END as description,
    COALESCE(vi.created_at::date, v.created_at::date) as event_date,
    jsonb_build_object(
        'image_id', vi.id,
        'category', COALESCE(vi.category, 'general'),
        'is_primary', COALESCE(vi.is_primary, false),
        'file_size', vi.file_size,
        'mime_type', vi.mime_type,
        'source', 'bulk_backfill',
        'backfilled_at', NOW()
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

-- Check how many were created
SELECT 
    COUNT(*) as events_created,
    COUNT(DISTINCT vehicle_id) as vehicles_updated
FROM timeline_events
WHERE metadata->>'source' = 'bulk_backfill'
AND created_at >= NOW() - INTERVAL '1 minute';
