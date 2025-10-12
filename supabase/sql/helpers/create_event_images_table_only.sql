-- ONLY creates the missing event_images table
-- Uses existing vehicle-data bucket for storage

CREATE TABLE IF NOT EXISTS event_images (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    event_id UUID REFERENCES timeline_events(id) ON DELETE CASCADE,
    image_url TEXT NOT NULL,
    thumbnail_url TEXT,
    user_caption TEXT,
    is_primary BOOLEAN DEFAULT false,
    display_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_images_event_id ON event_images(event_id);
ALTER TABLE event_images ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage images for their vehicle events" ON event_images
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM timeline_events te
            JOIN vehicles v ON v.id = te.vehicle_id
            WHERE te.id = event_images.event_id
            AND v.user_id = auth.uid()
        )
    );

GRANT ALL ON event_images TO authenticated;
