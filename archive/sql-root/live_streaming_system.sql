-- Live Streaming System
-- Real-time content streaming for live build sessions, garage tours, and community events

-- Create stream status enum
DO $$ BEGIN
    CREATE TYPE stream_status AS ENUM ('scheduled', 'live', 'ended', 'cancelled');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create stream type enum
DO $$ BEGIN
    CREATE TYPE stream_type AS ENUM ('build_session', 'garage_tour', 'q_and_a', 'dyno_run', 'race_event', 'tutorial', 'general');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Live streams table
CREATE TABLE IF NOT EXISTS live_streams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    streamer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL,

    -- Stream metadata
    title TEXT NOT NULL,
    description TEXT,
    stream_type stream_type NOT NULL DEFAULT 'general',
    status stream_status NOT NULL DEFAULT 'scheduled',

    -- Streaming technical details
    stream_key TEXT UNIQUE,
    rtmp_url TEXT,
    hls_url TEXT,
    thumbnail_url TEXT,

    -- Scheduling
    scheduled_start TIMESTAMPTZ,
    actual_start TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    duration_seconds INTEGER DEFAULT 0,

    -- Stream statistics
    peak_viewers INTEGER DEFAULT 0,
    total_viewers INTEGER DEFAULT 0,
    chat_messages INTEGER DEFAULT 0,
    likes INTEGER DEFAULT 0,

    -- Content settings
    is_public BOOLEAN DEFAULT true,
    allow_chat BOOLEAN DEFAULT true,
    chat_slow_mode INTEGER DEFAULT 0, -- seconds between messages
    subscriber_only_chat BOOLEAN DEFAULT false,

    -- Recording settings
    auto_record BOOLEAN DEFAULT true,
    recording_url TEXT,
    highlight_clips TEXT[] DEFAULT '{}',

    -- Geographic info
    location_lat DECIMAL(10, 8),
    location_lng DECIMAL(11, 8),
    location_name TEXT,

    -- Tags and discovery
    tags TEXT[] DEFAULT '{}',
    featured BOOLEAN DEFAULT false,
    featured_until TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Stream viewers - track who's watching
CREATE TABLE IF NOT EXISTS stream_viewers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stream_id UUID NOT NULL REFERENCES live_streams(id) ON DELETE CASCADE,
    viewer_id UUID REFERENCES auth.users(id) ON DELETE CASCADE, -- null for anonymous

    -- Viewer session tracking
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    left_at TIMESTAMPTZ,
    watch_time_seconds INTEGER DEFAULT 0,

    -- Viewer engagement
    sent_chat_messages INTEGER DEFAULT 0,
    liked_stream BOOLEAN DEFAULT false,
    followed_streamer BOOLEAN DEFAULT false,

    -- Technical info
    viewer_ip INET,
    user_agent TEXT,
    quality_level TEXT, -- 1080p, 720p, 480p, etc.

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Stream chat messages
CREATE TABLE IF NOT EXISTS stream_chat (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stream_id UUID NOT NULL REFERENCES live_streams(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

    -- Message content
    message TEXT NOT NULL,
    message_type TEXT DEFAULT 'chat', -- chat, system, highlight, super_chat

    -- Message metadata
    timestamp_offset INTEGER NOT NULL, -- seconds from stream start
    highlighted BOOLEAN DEFAULT false,
    pinned BOOLEAN DEFAULT false,

    -- Moderation
    deleted BOOLEAN DEFAULT false,
    deleted_by UUID REFERENCES auth.users(id),
    deleted_reason TEXT,

    -- Super chat / donations
    donation_amount DECIMAL(10,2) DEFAULT 0,
    donation_currency TEXT DEFAULT 'USD',

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Stream highlights and clips
CREATE TABLE IF NOT EXISTS stream_clips (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stream_id UUID NOT NULL REFERENCES live_streams(id) ON DELETE CASCADE,
    creator_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    -- Clip details
    title TEXT NOT NULL,
    description TEXT,
    start_time_seconds INTEGER NOT NULL,
    duration_seconds INTEGER NOT NULL,

    -- Clip media
    clip_url TEXT NOT NULL,
    thumbnail_url TEXT,

    -- Engagement
    views INTEGER DEFAULT 0,
    likes INTEGER DEFAULT 0,
    shares INTEGER DEFAULT 0,

    -- Visibility
    is_public BOOLEAN DEFAULT true,
    featured BOOLEAN DEFAULT false,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Stream followers - users following streamers
CREATE TABLE IF NOT EXISTS stream_follows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    follower_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    streamer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    -- Follow preferences
    push_notifications BOOLEAN DEFAULT true,
    email_notifications BOOLEAN DEFAULT false,

    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(follower_id, streamer_id)
);

-- Stream notifications - notify followers when streams go live
CREATE TABLE IF NOT EXISTS stream_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stream_id UUID NOT NULL REFERENCES live_streams(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    -- Notification details
    notification_type TEXT NOT NULL, -- 'stream_live', 'stream_starting', 'stream_ended'
    sent_at TIMESTAMPTZ DEFAULT NOW(),
    read_at TIMESTAMPTZ,

    -- Delivery channels
    sent_push BOOLEAN DEFAULT false,
    sent_email BOOLEAN DEFAULT false,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Functions for stream management

-- Function to start a stream
CREATE OR REPLACE FUNCTION start_stream(
    stream_id_param UUID,
    rtmp_url_param TEXT DEFAULT NULL,
    hls_url_param TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE live_streams
    SET
        status = 'live',
        actual_start = NOW(),
        rtmp_url = COALESCE(rtmp_url_param, rtmp_url),
        hls_url = COALESCE(hls_url_param, hls_url),
        updated_at = NOW()
    WHERE id = stream_id_param AND status = 'scheduled';

    -- Send notifications to followers
    INSERT INTO stream_notifications (stream_id, user_id, notification_type)
    SELECT
        stream_id_param,
        sf.follower_id,
        'stream_live'
    FROM stream_follows sf
    JOIN live_streams ls ON sf.streamer_id = ls.streamer_id
    WHERE ls.id = stream_id_param
    AND sf.push_notifications = true;

    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- Function to end a stream
CREATE OR REPLACE FUNCTION end_stream(
    stream_id_param UUID
)
RETURNS BOOLEAN AS $$
DECLARE
    stream_duration INTEGER;
    viewer_count INTEGER;
BEGIN
    -- Calculate duration and final stats
    SELECT
        EXTRACT(EPOCH FROM (NOW() - actual_start))::INTEGER,
        COUNT(DISTINCT viewer_id)
    INTO stream_duration, viewer_count
    FROM live_streams ls
    LEFT JOIN stream_viewers sv ON ls.id = sv.stream_id
    WHERE ls.id = stream_id_param
    GROUP BY ls.id, ls.actual_start;

    UPDATE live_streams
    SET
        status = 'ended',
        ended_at = NOW(),
        duration_seconds = COALESCE(stream_duration, 0),
        total_viewers = COALESCE(viewer_count, 0),
        updated_at = NOW()
    WHERE id = stream_id_param AND status = 'live';

    -- Mark all viewers as left
    UPDATE stream_viewers
    SET
        left_at = NOW(),
        watch_time_seconds = COALESCE(
            EXTRACT(EPOCH FROM (NOW() - joined_at))::INTEGER,
            watch_time_seconds
        ),
        updated_at = NOW()
    WHERE stream_id = stream_id_param
    AND left_at IS NULL;

    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- Function to add viewer to stream
CREATE OR REPLACE FUNCTION join_stream(
    stream_id_param UUID,
    viewer_id_param UUID DEFAULT NULL,
    viewer_ip_param INET DEFAULT NULL,
    user_agent_param TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    viewer_session_id UUID;
BEGIN
    INSERT INTO stream_viewers (
        stream_id,
        viewer_id,
        viewer_ip,
        user_agent
    )
    VALUES (
        stream_id_param,
        viewer_id_param,
        viewer_ip_param,
        user_agent_param
    )
    RETURNING id INTO viewer_session_id;

    -- Update peak viewers count if needed
    WITH current_viewers AS (
        SELECT COUNT(*) as viewer_count
        FROM stream_viewers
        WHERE stream_id = stream_id_param
        AND left_at IS NULL
    )
    UPDATE live_streams
    SET
        peak_viewers = GREATEST(peak_viewers, (SELECT viewer_count FROM current_viewers)),
        updated_at = NOW()
    WHERE id = stream_id_param;

    RETURN viewer_session_id;
END;
$$ LANGUAGE plpgsql;

-- Function to add chat message
CREATE OR REPLACE FUNCTION add_chat_message(
    stream_id_param UUID,
    user_id_param UUID,
    message_param TEXT,
    timestamp_offset_param INTEGER
)
RETURNS UUID AS $$
DECLARE
    message_id UUID;
BEGIN
    INSERT INTO stream_chat (
        stream_id,
        user_id,
        message,
        timestamp_offset
    )
    VALUES (
        stream_id_param,
        user_id_param,
        message_param,
        timestamp_offset_param
    )
    RETURNING id INTO message_id;

    -- Update chat message count
    UPDATE live_streams
    SET
        chat_messages = chat_messages + 1,
        updated_at = NOW()
    WHERE id = stream_id_param;

    RETURN message_id;
END;
$$ LANGUAGE plpgsql;

-- Function to get live streams feed
CREATE OR REPLACE FUNCTION get_live_streams_feed(
    viewer_user_id UUID DEFAULT NULL,
    limit_count INTEGER DEFAULT 50,
    offset_count INTEGER DEFAULT 0
)
RETURNS TABLE(
    stream_id UUID,
    title TEXT,
    description TEXT,
    stream_type stream_type,
    status stream_status,
    streamer_name TEXT,
    streamer_avatar TEXT,
    thumbnail_url TEXT,
    viewer_count BIGINT,
    started_at TIMESTAMPTZ,
    duration_seconds INTEGER,
    tags TEXT[],
    is_following BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        ls.id as stream_id,
        ls.title,
        ls.description,
        ls.stream_type,
        ls.status,
        up.display_name as streamer_name,
        up.avatar_url as streamer_avatar,
        ls.thumbnail_url,
        COALESCE(sv_count.viewer_count, 0) as viewer_count,
        ls.actual_start as started_at,
        ls.duration_seconds,
        ls.tags,
        COALESCE(sf.follower_id IS NOT NULL, false) as is_following
    FROM live_streams ls
    JOIN user_profiles up ON ls.streamer_id = up.user_id
    LEFT JOIN (
        SELECT
            stream_id,
            COUNT(*) as viewer_count
        FROM stream_viewers
        WHERE left_at IS NULL
        GROUP BY stream_id
    ) sv_count ON ls.id = sv_count.stream_id
    LEFT JOIN stream_follows sf ON (
        sf.streamer_id = ls.streamer_id
        AND sf.follower_id = viewer_user_id
    )
    WHERE ls.status IN ('live', 'scheduled')
    AND ls.is_public = true
    ORDER BY
        CASE WHEN ls.status = 'live' THEN 0 ELSE 1 END,
        ls.peak_viewers DESC,
        ls.scheduled_start ASC
    LIMIT limit_count
    OFFSET offset_count;
END;
$$ LANGUAGE plpgsql;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_live_streams_status ON live_streams(status);
CREATE INDEX IF NOT EXISTS idx_live_streams_streamer ON live_streams(streamer_id);
CREATE INDEX IF NOT EXISTS idx_live_streams_scheduled_start ON live_streams(scheduled_start);
CREATE INDEX IF NOT EXISTS idx_live_streams_location ON live_streams(location_lat, location_lng) WHERE location_lat IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_live_streams_tags ON live_streams USING gin(tags);

CREATE INDEX IF NOT EXISTS idx_stream_viewers_stream ON stream_viewers(stream_id);
CREATE INDEX IF NOT EXISTS idx_stream_viewers_active ON stream_viewers(stream_id, left_at) WHERE left_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_stream_viewers_viewer ON stream_viewers(viewer_id) WHERE viewer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_stream_chat_stream ON stream_chat(stream_id);
CREATE INDEX IF NOT EXISTS idx_stream_chat_timestamp ON stream_chat(stream_id, timestamp_offset);

CREATE INDEX IF NOT EXISTS idx_stream_clips_stream ON stream_clips(stream_id);
CREATE INDEX IF NOT EXISTS idx_stream_clips_creator ON stream_clips(creator_id);

CREATE INDEX IF NOT EXISTS idx_stream_follows_follower ON stream_follows(follower_id);
CREATE INDEX IF NOT EXISTS idx_stream_follows_streamer ON stream_follows(streamer_id);

-- RLS Policies
ALTER TABLE live_streams ENABLE ROW LEVEL SECURITY;
ALTER TABLE stream_viewers ENABLE ROW LEVEL SECURITY;
ALTER TABLE stream_chat ENABLE ROW LEVEL SECURITY;
ALTER TABLE stream_clips ENABLE ROW LEVEL SECURITY;
ALTER TABLE stream_follows ENABLE ROW LEVEL SECURITY;
ALTER TABLE stream_notifications ENABLE ROW LEVEL SECURITY;

-- Live streams policies
CREATE POLICY "Users can view public streams" ON live_streams FOR SELECT USING (is_public = true OR streamer_id = auth.uid());
CREATE POLICY "Users can create their own streams" ON live_streams FOR INSERT WITH CHECK (streamer_id = auth.uid());
CREATE POLICY "Users can update their own streams" ON live_streams FOR UPDATE USING (streamer_id = auth.uid());
CREATE POLICY "Users can delete their own streams" ON live_streams FOR DELETE USING (streamer_id = auth.uid());

-- Stream viewers policies
CREATE POLICY "Anyone can view stream viewer counts" ON stream_viewers FOR SELECT USING (true);
CREATE POLICY "Users can join streams" ON stream_viewers FOR INSERT WITH CHECK (true);
CREATE POLICY "Users can update their own viewer sessions" ON stream_viewers FOR UPDATE USING (viewer_id = auth.uid() OR viewer_id IS NULL);

-- Stream chat policies
CREATE POLICY "Anyone can view chat for public streams" ON stream_chat FOR SELECT USING (
    stream_id IN (SELECT id FROM live_streams WHERE is_public = true)
);
CREATE POLICY "Authenticated users can send chat messages" ON stream_chat FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Users can update their own chat messages" ON stream_chat FOR UPDATE USING (user_id = auth.uid());

-- Stream clips policies
CREATE POLICY "Anyone can view public clips" ON stream_clips FOR SELECT USING (is_public = true);
CREATE POLICY "Users can create clips" ON stream_clips FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Users can update their own clips" ON stream_clips FOR UPDATE USING (creator_id = auth.uid());

-- Stream follows policies
CREATE POLICY "Users can view their follows" ON stream_follows FOR SELECT USING (follower_id = auth.uid() OR streamer_id = auth.uid());
CREATE POLICY "Users can manage their follows" ON stream_follows FOR ALL USING (follower_id = auth.uid());

-- Stream notifications policies
CREATE POLICY "Users can view their notifications" ON stream_notifications FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "System can create notifications" ON stream_notifications FOR INSERT WITH CHECK (true);
CREATE POLICY "Users can mark notifications as read" ON stream_notifications FOR UPDATE USING (user_id = auth.uid());

COMMIT;