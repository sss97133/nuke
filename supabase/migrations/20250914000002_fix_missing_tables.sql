-- Fix missing tables and columns for vehicle profile functionality

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

-- Create indexes for live_streaming_sessions
CREATE INDEX IF NOT EXISTS idx_live_streaming_vehicle ON live_streaming_sessions(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_live_streaming_streamer ON live_streaming_sessions(streamer_id);
CREATE INDEX IF NOT EXISTS idx_live_streaming_active ON live_streaming_sessions(is_live) WHERE is_live = true;

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
    -- Unique constraint to prevent duplicate entries
    UNIQUE(vehicle_id, user_id),
    UNIQUE(vehicle_id, session_id)
);

-- Create indexes for user_presence
CREATE INDEX IF NOT EXISTS idx_user_presence_vehicle ON user_presence(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_user_presence_last_seen ON user_presence(last_seen_at);

-- Create timeline_event_comments table if it doesn't exist
CREATE TABLE IF NOT EXISTS timeline_event_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    event_id UUID NOT NULL REFERENCES timeline_events(id) ON DELETE CASCADE,
    user_id UUID REFERENCES profiles(id),
    comment_text TEXT NOT NULL,
    is_edited BOOLEAN DEFAULT false,
    edited_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for timeline_event_comments
CREATE INDEX IF NOT EXISTS idx_timeline_comments_vehicle ON timeline_event_comments(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_timeline_comments_event ON timeline_event_comments(event_id);
CREATE INDEX IF NOT EXISTS idx_timeline_comments_user ON timeline_event_comments(user_id);

-- Create vehicle_image_comments table if it doesn't exist
CREATE TABLE IF NOT EXISTS vehicle_image_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    image_id UUID NOT NULL REFERENCES vehicle_images(id) ON DELETE CASCADE,
    user_id UUID REFERENCES profiles(id),
    comment_text TEXT NOT NULL,
    is_edited BOOLEAN DEFAULT false,
    edited_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for vehicle_image_comments
CREATE INDEX IF NOT EXISTS idx_image_comments_vehicle ON vehicle_image_comments(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_image_comments_image ON vehicle_image_comments(image_id);
CREATE INDEX IF NOT EXISTS idx_image_comments_user ON vehicle_image_comments(user_id);

-- Enable RLS on new tables
ALTER TABLE live_streaming_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_presence ENABLE ROW LEVEL SECURITY;
ALTER TABLE timeline_event_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_image_comments ENABLE ROW LEVEL SECURITY;

-- RLS Policies for live_streaming_sessions
DROP POLICY IF EXISTS "Anyone can view live streams" ON live_streaming_sessions;
CREATE POLICY "Anyone can view live streams" ON live_streaming_sessions
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "Vehicle owners can create streams" ON live_streaming_sessions;
CREATE POLICY "Vehicle owners can create streams" ON live_streaming_sessions
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM vehicles
            WHERE vehicles.id = vehicle_id
            AND vehicles.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Stream owners can update their streams" ON live_streaming_sessions;
CREATE POLICY "Stream owners can update their streams" ON live_streaming_sessions
    FOR UPDATE USING (streamer_id = auth.uid());

DROP POLICY IF EXISTS "Stream owners can delete their streams" ON live_streaming_sessions;
CREATE POLICY "Stream owners can delete their streams" ON live_streaming_sessions
    FOR DELETE USING (streamer_id = auth.uid());

-- RLS Policies for user_presence
DROP POLICY IF EXISTS "Anyone can view presence" ON user_presence;
CREATE POLICY "Anyone can view presence" ON user_presence
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "Anyone can create presence" ON user_presence;
CREATE POLICY "Anyone can create presence" ON user_presence
    FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Users can update their own presence" ON user_presence;
CREATE POLICY "Users can update their own presence" ON user_presence
    FOR UPDATE USING (user_id = auth.uid() OR user_id IS NULL);

DROP POLICY IF EXISTS "Users can delete their own presence" ON user_presence;
CREATE POLICY "Users can delete their own presence" ON user_presence
    FOR DELETE USING (user_id = auth.uid() OR user_id IS NULL);

-- RLS Policies for timeline_event_comments
DROP POLICY IF EXISTS "Anyone can view timeline comments" ON timeline_event_comments;
CREATE POLICY "Anyone can view timeline comments" ON timeline_event_comments
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM vehicles
            WHERE vehicles.id = vehicle_id
            AND vehicles.is_public = true
        )
    );

DROP POLICY IF EXISTS "Authenticated users can create timeline comments" ON timeline_event_comments;
CREATE POLICY "Authenticated users can create timeline comments" ON timeline_event_comments
    FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Users can update their own timeline comments" ON timeline_event_comments;
CREATE POLICY "Users can update their own timeline comments" ON timeline_event_comments
    FOR UPDATE USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete their own timeline comments" ON timeline_event_comments;
CREATE POLICY "Users can delete their own timeline comments" ON timeline_event_comments
    FOR DELETE USING (user_id = auth.uid());

-- RLS Policies for vehicle_image_comments
DROP POLICY IF EXISTS "Anyone can view image comments" ON vehicle_image_comments;
CREATE POLICY "Anyone can view image comments" ON vehicle_image_comments
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM vehicles
            WHERE vehicles.id = vehicle_id
            AND vehicles.is_public = true
        )
    );

DROP POLICY IF EXISTS "Authenticated users can create image comments" ON vehicle_image_comments;
CREATE POLICY "Authenticated users can create image comments" ON vehicle_image_comments
    FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Users can update their own image comments" ON vehicle_image_comments;
CREATE POLICY "Users can update their own image comments" ON vehicle_image_comments
    FOR UPDATE USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete their own image comments" ON vehicle_image_comments;
CREATE POLICY "Users can delete their own image comments" ON vehicle_image_comments
    FOR DELETE USING (user_id = auth.uid());

-- Function to clean up old presence records
DROP FUNCTION IF EXISTS cleanup_old_presence();

CREATE OR REPLACE FUNCTION cleanup_old_presence()
RETURNS void AS $$
BEGIN
    DELETE FROM user_presence
    WHERE last_seen_at < NOW() - INTERVAL '1 hour';
END;
$$ LANGUAGE plpgsql;

-- Function to update user presence
CREATE OR REPLACE FUNCTION update_user_presence(
    p_vehicle_id UUID,
    p_user_id UUID DEFAULT NULL,
    p_session_id TEXT DEFAULT NULL,
    p_user_agent TEXT DEFAULT NULL,
    p_ip_address INET DEFAULT NULL
)
RETURNS void AS $$
BEGIN
    IF p_user_id IS NOT NULL THEN
        INSERT INTO user_presence (
            vehicle_id, 
            user_id, 
            is_authenticated, 
            user_agent, 
            ip_address, 
            last_seen_at
        ) VALUES (
            p_vehicle_id,
            p_user_id,
            true,
            p_user_agent,
            p_ip_address,
            NOW()
        )
        ON CONFLICT (vehicle_id, user_id) 
        DO UPDATE SET 
            last_seen_at = NOW(),
            user_agent = COALESCE(p_user_agent, user_presence.user_agent),
            ip_address = COALESCE(p_ip_address, user_presence.ip_address);
    ELSIF p_session_id IS NOT NULL THEN
        INSERT INTO user_presence (
            vehicle_id, 
            session_id, 
            is_authenticated, 
            user_agent, 
            ip_address, 
            last_seen_at
        ) VALUES (
            p_vehicle_id,
            p_session_id,
            false,
            p_user_agent,
            p_ip_address,
            NOW()
        )
        ON CONFLICT (vehicle_id, session_id) 
        DO UPDATE SET 
            last_seen_at = NOW(),
            user_agent = COALESCE(p_user_agent, user_presence.user_agent),
            ip_address = COALESCE(p_ip_address, user_presence.ip_address);
    END IF;
END;
$$ LANGUAGE plpgsql;
