-- Add Missing Event Tables and Views
-- Run this in Supabase SQL Editor

-- Step 1: Create event_images table for image storage
CREATE TABLE IF NOT EXISTS event_images (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    event_id UUID REFERENCES timeline_events(id) ON DELETE CASCADE,
    image_url TEXT NOT NULL,
    thumbnail_url TEXT,
    upload_source TEXT DEFAULT 'direct',
    ocr_status TEXT DEFAULT 'pending',
    ocr_text TEXT,
    detected_type TEXT,
    user_caption TEXT,
    is_primary BOOLEAN DEFAULT false,
    display_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Step 2: Create index for performance
CREATE INDEX IF NOT EXISTS idx_event_images_event_id ON event_images(event_id);

-- Step 3: Enable RLS on event_images
ALTER TABLE event_images ENABLE ROW LEVEL SECURITY;

-- Step 4: RLS Policy - users can manage images for their vehicle events
CREATE POLICY "Users can manage images for their vehicle events" ON event_images
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM timeline_events te
            JOIN vehicles v ON v.id = te.vehicle_id
            WHERE te.id = event_images.event_id
            AND v.user_id = auth.uid()
        )
    );

-- Step 5: Create view for events with images
CREATE OR REPLACE VIEW timeline_events_with_images AS
SELECT 
    te.*,
    COUNT(ei.id) as image_count,
    COALESCE(
        json_agg(
            json_build_object(
                'id', ei.id,
                'image_url', ei.image_url,
                'thumbnail_url', ei.thumbnail_url,
                'is_primary', ei.is_primary
            ) ORDER BY ei.display_order
        ) FILTER (WHERE ei.id IS NOT NULL), 
        '[]'::json
    ) as images
FROM timeline_events te
LEFT JOIN event_images ei ON ei.event_id = te.id
GROUP BY te.id;

-- Step 6: Grant permissions
GRANT SELECT ON timeline_events_with_images TO authenticated;
GRANT ALL ON event_images TO authenticated;
