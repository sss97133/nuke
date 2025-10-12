-- Drop and recreate timeline_events with correct schema
DROP TABLE IF EXISTS timeline_events CASCADE;

CREATE TABLE timeline_events (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Event Classification (Simplified)
    event_type TEXT NOT NULL,
    source TEXT NOT NULL,
    
    -- Core Event Details
    title TEXT NOT NULL,
    description TEXT,
    event_date DATE NOT NULL,
    
    -- Supporting Data
    image_urls TEXT[],
    metadata JSONB DEFAULT '{}',
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Indexes
CREATE INDEX idx_timeline_events_vehicle_id ON timeline_events(vehicle_id);
CREATE INDEX idx_timeline_events_user_id ON timeline_events(user_id);
CREATE INDEX idx_timeline_events_event_date ON timeline_events(event_date);

-- Enable RLS
ALTER TABLE timeline_events ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view timeline events for vehicles they own" ON timeline_events
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM vehicles 
            WHERE vehicles.id = timeline_events.vehicle_id 
            AND vehicles.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can create timeline events for their vehicles" ON timeline_events
    FOR INSERT WITH CHECK (
        auth.uid() = user_id AND
        EXISTS (
            SELECT 1 FROM vehicles 
            WHERE vehicles.id = timeline_events.vehicle_id 
            AND vehicles.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can update their own timeline events" ON timeline_events
    FOR UPDATE USING (
        auth.uid() = user_id AND
        EXISTS (
            SELECT 1 FROM vehicles 
            WHERE vehicles.id = timeline_events.vehicle_id 
            AND vehicles.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can delete their own timeline events" ON timeline_events
    FOR DELETE USING (
        auth.uid() = user_id AND
        EXISTS (
            SELECT 1 FROM vehicles 
            WHERE vehicles.id = timeline_events.vehicle_id 
            AND vehicles.user_id = auth.uid()
        )
    );
