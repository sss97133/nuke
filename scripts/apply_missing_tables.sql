-- Fix missing tables and columns for vehicle profile functionality
-- Apply this directly in Supabase SQL Editor

-- Add missing column to profile_stats if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'profile_stats'
        AND column_name = 'total_images'
    ) THEN
        ALTER TABLE profile_stats
        ADD COLUMN total_images INTEGER DEFAULT 0;
    END IF;
END $$;

-- Create live_streaming_sessions table if it doesn't exist
CREATE TABLE IF NOT EXISTS live_streaming_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    streamer_id UUID NOT NULL REFERENCES profiles(id),
    platform TEXT CHECK (platform IN ('youtube', 'twitch', 'custom')),
    stream_url TEXT,
    stream_key TEXT,
    title TEXT,
    description TEXT,
    is_live BOOLEAN DEFAULT true,
    viewer_count INTEGER DEFAULT 0,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create user_presence table if it doesn't exist
CREATE TABLE IF NOT EXISTS user_presence (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    user_id UUID REFERENCES profiles(id),
    session_id TEXT,
    is_authenticated BOOLEAN DEFAULT false,
    user_agent TEXT,
    ip_address INET,
    last_seen_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(vehicle_id, user_id),
    UNIQUE(vehicle_id, session_id)
);

-- Create or update timeline_event_comments table
CREATE TABLE IF NOT EXISTS timeline_event_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES vehicle_timeline_events(id) ON DELETE CASCADE,
    user_id UUID REFERENCES profiles(id),
    comment_text TEXT NOT NULL,
    is_edited BOOLEAN DEFAULT false,
    edited_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add vehicle_id column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'timeline_event_comments'
        AND column_name = 'vehicle_id'
    ) THEN
        ALTER TABLE timeline_event_comments
        ADD COLUMN vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE;
        
        -- Try to populate vehicle_id from the event's vehicle_id
        UPDATE timeline_event_comments tec
        SET vehicle_id = vte.vehicle_id
        FROM vehicle_timeline_events vte
        WHERE tec.event_id = vte.id
        AND tec.vehicle_id IS NULL;
    END IF;
END $$;

-- Create or update vehicle_image_comments table
CREATE TABLE IF NOT EXISTS vehicle_image_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    image_id UUID NOT NULL REFERENCES vehicle_images(id) ON DELETE CASCADE,
    user_id UUID REFERENCES profiles(id),
    comment_text TEXT NOT NULL,
    is_edited BOOLEAN DEFAULT false,
    edited_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add vehicle_id column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'vehicle_image_comments'
        AND column_name = 'vehicle_id'
    ) THEN
        ALTER TABLE vehicle_image_comments
        ADD COLUMN vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE;
        
        -- Try to populate vehicle_id from the image's vehicle_id
        UPDATE vehicle_image_comments vic
        SET vehicle_id = vi.vehicle_id
        FROM vehicle_images vi
        WHERE vic.image_id = vi.id
        AND vic.vehicle_id IS NULL;
    END IF;
END $$;

-- Enable RLS on new tables
ALTER TABLE live_streaming_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_presence ENABLE ROW LEVEL SECURITY;
ALTER TABLE timeline_event_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_image_comments ENABLE ROW LEVEL SECURITY;

-- RLS Policies for live_streaming_sessions
CREATE POLICY "Anyone can view live streams" ON live_streaming_sessions
    FOR SELECT USING (true);

CREATE POLICY "Vehicle owners can create streams" ON live_streaming_sessions
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM vehicles
            WHERE vehicles.id = live_streaming_sessions.vehicle_id
            AND vehicles.user_id = auth.uid()
        )
    );

CREATE POLICY "Stream owners can update their streams" ON live_streaming_sessions
    FOR UPDATE USING (streamer_id = auth.uid());

CREATE POLICY "Stream owners can delete their streams" ON live_streaming_sessions
    FOR DELETE USING (streamer_id = auth.uid());

-- RLS Policies for user_presence
CREATE POLICY "Anyone can view presence" ON user_presence
    FOR SELECT USING (true);

CREATE POLICY "Anyone can create presence" ON user_presence
    FOR INSERT WITH CHECK (true);

CREATE POLICY "Users can update their own presence" ON user_presence
    FOR UPDATE USING (user_id = auth.uid() OR user_id IS NULL);

CREATE POLICY "Users can delete their own presence" ON user_presence
    FOR DELETE USING (user_id = auth.uid() OR user_id IS NULL);

-- RLS Policies for timeline_event_comments
CREATE POLICY "Anyone can view timeline comments" ON timeline_event_comments
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM vehicles
            WHERE vehicles.id = timeline_event_comments.vehicle_id
            AND vehicles.is_public = true
        )
    );

CREATE POLICY "Authenticated users can create timeline comments" ON timeline_event_comments
    FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Users can update their own timeline comments" ON timeline_event_comments
    FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "Users can delete their own timeline comments" ON timeline_event_comments
    FOR DELETE USING (user_id = auth.uid());

-- RLS Policies for vehicle_image_comments
CREATE POLICY "Anyone can view image comments" ON vehicle_image_comments
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM vehicles
            WHERE vehicles.id = vehicle_image_comments.vehicle_id
            AND vehicles.is_public = true
        )
    );

CREATE POLICY "Authenticated users can create image comments" ON vehicle_image_comments
    FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Users can update their own image comments" ON vehicle_image_comments
    FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "Users can delete their own image comments" ON vehicle_image_comments
    FOR DELETE USING (user_id = auth.uid());