-- Minimal Timeline Schema Update
-- Just the essentials to support flexible, image-first events

-- Step 1: Make existing fields more flexible (nullable)
ALTER TABLE timeline_events 
ALTER COLUMN title DROP NOT NULL,
ALTER COLUMN description DROP NOT NULL;

-- Step 2: Add only essential tracking fields
ALTER TABLE timeline_events
ADD COLUMN IF NOT EXISTS data_source TEXT DEFAULT 'user_provided',
ADD COLUMN IF NOT EXISTS confidence_score DECIMAL(3,2) DEFAULT 0.5,
ADD COLUMN IF NOT EXISTS needs_review BOOLEAN DEFAULT false;

-- Step 3: Add the most commonly requested optional fields (all nullable)
ALTER TABLE timeline_events
ADD COLUMN IF NOT EXISTS mileage_at_event INTEGER,
ADD COLUMN IF NOT EXISTS cost_amount DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS location_name TEXT,
ADD COLUMN IF NOT EXISTS service_provider_name TEXT;

-- Step 4: Create event_images table for image storage
CREATE TABLE IF NOT EXISTS event_images (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
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

-- Step 5: Create index for performance
CREATE INDEX IF NOT EXISTS idx_event_images_event_id ON event_images(event_id);

-- Step 6: Enable RLS on event_images
ALTER TABLE event_images ENABLE ROW LEVEL SECURITY;

-- Step 7: RLS Policy - users can manage images for their vehicle events
CREATE POLICY "Users can manage images for their vehicle events" ON event_images
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM timeline_events te
            JOIN vehicles v ON v.id = te.vehicle_id
            WHERE te.id = event_images.event_id
            AND v.user_id = auth.uid()
        )
    );

-- Step 8: Create view for events with images
CREATE OR REPLACE VIEW timeline_events_with_images AS
SELECT 
    te.*,
    COUNT(ei.id) as image_count,
    json_agg(
        json_build_object(
            'id', ei.id,
            'image_url', ei.image_url,
            'thumbnail_url', ei.thumbnail_url,
            'is_primary', ei.is_primary
        ) ORDER BY ei.display_order
    ) FILTER (WHERE ei.id IS NOT NULL) as images
FROM timeline_events te
LEFT JOIN event_images ei ON ei.event_id = te.id
GROUP BY te.id;

-- Step 9: Grant permissions
GRANT SELECT ON timeline_events_with_images TO authenticated;
GRANT ALL ON event_images TO authenticated;
