-- Create timeline_events table for vehicle event history
CREATE TABLE IF NOT EXISTS public.timeline_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vehicle_id UUID NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
    event_type VARCHAR(255) NOT NULL,
    event_date TIMESTAMP WITH TIME ZONE NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    source VARCHAR(255),
    source_url TEXT,
    confidence_score INTEGER DEFAULT 50,
    metadata JSONB,
    user_id UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    verified BOOLEAN DEFAULT FALSE,
    verification_source VARCHAR(255),
    verification_date TIMESTAMP WITH TIME ZONE,
    media_urls TEXT[]
);

-- Add comprehensive indexing for performant queries
CREATE INDEX IF NOT EXISTS timeline_events_vehicle_id_idx ON public.timeline_events(vehicle_id);
CREATE INDEX IF NOT EXISTS timeline_events_event_type_idx ON public.timeline_events(event_type);
CREATE INDEX IF NOT EXISTS timeline_events_event_date_idx ON public.timeline_events(event_date);
CREATE INDEX IF NOT EXISTS timeline_events_confidence_score_idx ON public.timeline_events(confidence_score);
CREATE INDEX IF NOT EXISTS timeline_events_user_id_idx ON public.timeline_events(user_id);

-- Add row-level security policies
ALTER TABLE public.timeline_events ENABLE ROW LEVEL SECURITY;

-- Policy to allow users to view events for vehicles they own
CREATE POLICY "Users can view timeline events for their vehicles" 
ON public.timeline_events FOR SELECT
USING (
    vehicle_id IN (
        SELECT id FROM public.vehicles WHERE user_id = auth.uid()
    )
    OR user_id = auth.uid()
);

-- Policy to allow users to create events for their vehicles
CREATE POLICY "Users can create timeline events for their vehicles" 
ON public.timeline_events FOR INSERT
WITH CHECK (
    vehicle_id IN (
        SELECT id FROM public.vehicles WHERE user_id = auth.uid()
    )
    OR user_id = auth.uid()
);

-- Policy to allow users to update events they created
CREATE POLICY "Users can update their timeline events" 
ON public.timeline_events FOR UPDATE
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- Policy to allow users to delete events they created
CREATE POLICY "Users can delete their timeline events" 
ON public.timeline_events FOR DELETE
USING (user_id = auth.uid());

-- Add example timeline events for testing
INSERT INTO public.timeline_events 
(vehicle_id, event_type, event_date, title, description, source, confidence_score, user_id, metadata) 
VALUES 
(
    -- Get the first vehicle ID (replace with your actual vehicle ID if needed)
    (SELECT id FROM public.vehicles LIMIT 1),
    'service',
    NOW() - INTERVAL '30 days',
    'Oil Change',
    'Regular maintenance oil change with synthetic oil',
    'User Input',
    90,
    (SELECT user_id FROM public.vehicles LIMIT 1),
    '{"parts": ["Oil filter", "5W-30 Synthetic Oil"], "mileage": 45000, "cost": 89.99}'::JSONB
);
