-- Vehicle Interaction System
-- Creates foundation for enhanced vehicle interactions including viewing requests, streaming, bidding, and viewer reputation

-- Vehicle Interaction Requests Table
CREATE TABLE IF NOT EXISTS vehicle_interaction_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    requester_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Request details
    interaction_type TEXT NOT NULL CHECK (interaction_type IN (
        'viewing_request',      -- Request to view vehicle in person
        'streaming_request',    -- Request for live streaming session
        'video_call_request',   -- Request for video call tour
        'bidding_request',      -- Request to place bid
        'inspection_request',   -- Request for professional inspection
        'test_drive_request',   -- Request to test drive
        'purchase_inquiry',     -- General purchase inquiry
        'collaboration_request' -- Request to collaborate on vehicle project
    )),
    
    title TEXT NOT NULL,
    message TEXT,
    
    -- Scheduling
    preferred_date TIMESTAMPTZ,
    preferred_time_start TIME,
    preferred_time_end TIME,
    flexible_scheduling BOOLEAN DEFAULT true,
    
    -- Request specifics
    duration_minutes INTEGER DEFAULT 30,
    location_preference TEXT, -- 'owner_location', 'neutral_location', 'virtual'
    budget_range JSONB, -- { min: 0, max: 1000, currency: 'USD' }
    
    -- Status tracking
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
        'pending',
        'approved',
        'declined',
        'scheduled',
        'in_progress',
        'completed',
        'cancelled'
    )),
    
    -- Owner response
    owner_response TEXT,
    scheduled_date TIMESTAMPTZ,
    scheduled_location TEXT,
    
    -- Activity tracking
    viewed_by_owner BOOLEAN DEFAULT false,
    responded_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Vehicle Interaction Sessions Table (for tracking actual interactions)
CREATE TABLE IF NOT EXISTS vehicle_interaction_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID REFERENCES vehicle_interaction_requests(id) ON DELETE CASCADE,
    vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    host_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, -- Vehicle owner/responsible
    participant_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, -- Viewer/requester
    
    session_type TEXT NOT NULL CHECK (session_type IN (
        'live_streaming',
        'video_call',
        'in_person_viewing',
        'test_drive',
        'inspection'
    )),
    
    -- Session details
    title TEXT NOT NULL,
    description TEXT,
    
    -- Timing
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ,
    duration_minutes INTEGER,
    
    -- Technical details
    platform TEXT, -- 'youtube', 'twitch', 'zoom', 'custom', 'in_person'
    stream_url TEXT,
    recording_url TEXT,
    
    -- Quality metrics
    viewer_count INTEGER DEFAULT 0,
    max_concurrent_viewers INTEGER DEFAULT 0,
    engagement_score DECIMAL(3,2), -- 0.00 to 1.00
    
    -- Ratings
    host_rating INTEGER CHECK (host_rating >= 1 AND host_rating <= 5),
    participant_rating INTEGER CHECK (participant_rating >= 1 AND participant_rating <= 5),
    host_feedback TEXT,
    participant_feedback TEXT,
    
    -- Status
    status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN (
        'scheduled',
        'live',
        'completed',
        'cancelled',
        'failed'
    )),
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Viewer Activity Tracking (for building reputation/critic status)
CREATE TABLE IF NOT EXISTS viewer_activity (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    
    -- Activity details
    activity_type TEXT NOT NULL CHECK (activity_type IN (
        'profile_view',
        'image_view',
        'timeline_view',
        'streaming_session',
        'video_call',
        'in_person_viewing',
        'comment_added',
        'rating_given',
        'share_action',
        'bookmark_added',
        'inquiry_sent'
    )),
    
    -- Engagement metrics
    duration_seconds INTEGER DEFAULT 0,
    interaction_count INTEGER DEFAULT 0, -- clicks, scrolls, etc.
    engagement_quality TEXT CHECK (engagement_quality IN ('low', 'medium', 'high')),
    
    -- Content interaction
    images_viewed INTEGER DEFAULT 0,
    timeline_events_viewed INTEGER DEFAULT 0,
    comments_left INTEGER DEFAULT 0,
    
    -- Session info
    session_id UUID REFERENCES vehicle_interaction_sessions(id) ON DELETE SET NULL,
    
    -- Context
    referral_source TEXT, -- 'discovery', 'search', 'direct_link', 'social'
    user_agent TEXT,
    ip_address INET,
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Viewer Reputation System
CREATE TABLE IF NOT EXISTS viewer_reputation (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
    
    -- Core reputation metrics
    total_interactions INTEGER DEFAULT 0,
    total_viewing_time_minutes INTEGER DEFAULT 0,
    total_sessions_attended INTEGER DEFAULT 0,
    total_vehicles_viewed INTEGER DEFAULT 0,
    
    -- Quality metrics
    average_session_rating DECIMAL(3,2) DEFAULT 0.00, -- Based on host feedback
    reliability_score DECIMAL(3,2) DEFAULT 1.00, -- 1.00 = perfect attendance
    engagement_score DECIMAL(3,2) DEFAULT 0.00, -- Based on interaction quality
    
    -- Expertise indicators
    favorite_makes TEXT[],
    favorite_categories TEXT[], -- 'classic', 'sports', 'luxury', etc.
    expertise_areas TEXT[], -- 'engine', 'bodywork', 'restoration', etc.
    
    -- Critic status
    critic_level TEXT DEFAULT 'novice' CHECK (critic_level IN (
        'novice',      -- 0-10 vehicles viewed
        'enthusiast',  -- 11-50 vehicles viewed
        'expert',      -- 51-200 vehicles viewed
        'critic',      -- 201-500 vehicles viewed
        'master_critic' -- 500+ vehicles viewed
    )),
    
    -- Social metrics
    followers_count INTEGER DEFAULT 0,
    following_count INTEGER DEFAULT 0,
    reviews_written INTEGER DEFAULT 0,
    helpful_votes_received INTEGER DEFAULT 0,
    
    -- Achievements
    badges JSONB DEFAULT '[]', -- Array of earned badges
    achievements JSONB DEFAULT '[]',
    
    -- Timestamps
    first_activity_at TIMESTAMPTZ,
    last_activity_at TIMESTAMPTZ,
    critic_level_achieved_at TIMESTAMPTZ DEFAULT NOW(),
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Vehicle Reviews by Viewers (for building critic reputation)
CREATE TABLE IF NOT EXISTS vehicle_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    reviewer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    session_id UUID REFERENCES vehicle_interaction_sessions(id) ON DELETE SET NULL,
    
    -- Review content
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    overall_rating INTEGER NOT NULL CHECK (overall_rating >= 1 AND overall_rating <= 5),
    
    -- Detailed ratings
    condition_rating INTEGER CHECK (condition_rating >= 1 AND condition_rating <= 5),
    authenticity_rating INTEGER CHECK (authenticity_rating >= 1 AND authenticity_rating <= 5),
    presentation_rating INTEGER CHECK (presentation_rating >= 1 AND presentation_rating <= 5),
    owner_interaction_rating INTEGER CHECK (owner_interaction_rating >= 1 AND owner_interaction_rating <= 5),
    
    -- Review metadata
    review_type TEXT DEFAULT 'general' CHECK (review_type IN (
        'general',
        'streaming_session',
        'in_person_viewing',
        'test_drive',
        'expert_analysis'
    )),
    
    verified_interaction BOOLEAN DEFAULT false, -- Did reviewer actually interact with vehicle
    
    -- Community interaction
    helpful_votes INTEGER DEFAULT 0,
    total_votes INTEGER DEFAULT 0,
    
    -- Status
    status TEXT DEFAULT 'published' CHECK (status IN ('draft', 'published', 'flagged', 'removed')),
    
    -- Media
    images JSONB DEFAULT '[]',
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Prevent duplicate reviews from same user for same vehicle
    UNIQUE(vehicle_id, reviewer_id)
);

-- Interaction Notifications
CREATE TABLE IF NOT EXISTS interaction_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recipient_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    sender_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
    request_id UUID REFERENCES vehicle_interaction_requests(id) ON DELETE CASCADE,
    session_id UUID REFERENCES vehicle_interaction_sessions(id) ON DELETE CASCADE,
    
    notification_type TEXT NOT NULL CHECK (notification_type IN (
        'new_request',
        'request_approved',
        'request_declined',
        'session_scheduled',
        'session_starting',
        'session_reminder',
        'session_completed',
        'review_received',
        'rating_received'
    )),
    
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    
    -- Status
    read_at TIMESTAMPTZ,
    dismissed_at TIMESTAMPTZ,
    
    -- Action data
    action_url TEXT,
    action_data JSONB DEFAULT '{}',
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_interaction_requests_vehicle_id ON vehicle_interaction_requests(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_interaction_requests_requester_id ON vehicle_interaction_requests(requester_id);
CREATE INDEX IF NOT EXISTS idx_interaction_requests_status ON vehicle_interaction_requests(status) WHERE status IN ('pending', 'approved', 'scheduled');

CREATE INDEX IF NOT EXISTS idx_interaction_sessions_vehicle_id ON vehicle_interaction_sessions(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_interaction_sessions_host_id ON vehicle_interaction_sessions(host_id);
CREATE INDEX IF NOT EXISTS idx_interaction_sessions_participant_id ON vehicle_interaction_sessions(participant_id);
CREATE INDEX IF NOT EXISTS idx_interaction_sessions_start_time ON vehicle_interaction_sessions(start_time);

CREATE INDEX IF NOT EXISTS idx_viewer_activity_user_id ON viewer_activity(user_id);
CREATE INDEX IF NOT EXISTS idx_viewer_activity_vehicle_id ON viewer_activity(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_viewer_activity_created_at ON viewer_activity(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_vehicle_reviews_vehicle_id ON vehicle_reviews(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_reviews_reviewer_id ON vehicle_reviews(reviewer_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_reviews_rating ON vehicle_reviews(overall_rating);

CREATE INDEX IF NOT EXISTS idx_interaction_notifications_recipient_id ON interaction_notifications(recipient_id);
CREATE INDEX IF NOT EXISTS idx_interaction_notifications_unread ON interaction_notifications(recipient_id) WHERE read_at IS NULL;

-- Enable RLS for all tables
ALTER TABLE vehicle_interaction_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_interaction_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE viewer_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE viewer_reputation ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE interaction_notifications ENABLE ROW LEVEL SECURITY;

-- RLS Policies

-- Vehicle Interaction Requests
DROP POLICY IF EXISTS "Users can view requests for their vehicles" ON vehicle_interaction_requests;
CREATE POLICY "Users can view requests for their vehicles" ON vehicle_interaction_requests
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM vehicles WHERE vehicles.id = vehicle_interaction_requests.vehicle_id AND vehicles.user_id = auth.uid())
    );

DROP POLICY IF EXISTS "Users can view their own requests" ON vehicle_interaction_requests;
CREATE POLICY "Users can view their own requests" ON vehicle_interaction_requests
    FOR SELECT USING (requester_id = auth.uid());

DROP POLICY IF EXISTS "Users can create requests" ON vehicle_interaction_requests;
CREATE POLICY "Users can create requests" ON vehicle_interaction_requests
    FOR INSERT WITH CHECK (requester_id = auth.uid());

DROP POLICY IF EXISTS "Vehicle owners can update requests for their vehicles" ON vehicle_interaction_requests;
CREATE POLICY "Vehicle owners can update requests for their vehicles" ON vehicle_interaction_requests
    FOR UPDATE USING (
        EXISTS (SELECT 1 FROM vehicles WHERE vehicles.id = vehicle_interaction_requests.vehicle_id AND vehicles.user_id = auth.uid())
    );

-- Vehicle Interaction Sessions
DROP POLICY IF EXISTS "Users can view sessions they're involved in" ON vehicle_interaction_sessions;
CREATE POLICY "Users can view sessions they're involved in" ON vehicle_interaction_sessions
    FOR SELECT USING (host_id = auth.uid() OR participant_id = auth.uid());

DROP POLICY IF EXISTS "Hosts can create sessions" ON vehicle_interaction_sessions;
CREATE POLICY "Hosts can create sessions" ON vehicle_interaction_sessions
    FOR INSERT WITH CHECK (host_id = auth.uid());

DROP POLICY IF EXISTS "Involved users can update sessions" ON vehicle_interaction_sessions;
CREATE POLICY "Involved users can update sessions" ON vehicle_interaction_sessions
    FOR UPDATE USING (host_id = auth.uid() OR participant_id = auth.uid());

-- Viewer Activity (users can only see their own activity)
DROP POLICY IF EXISTS "Users can view their own activity" ON viewer_activity;
CREATE POLICY "Users can view their own activity" ON viewer_activity
    FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can insert their own activity" ON viewer_activity;
CREATE POLICY "Users can insert their own activity" ON viewer_activity
    FOR INSERT WITH CHECK (user_id = auth.uid());

-- Viewer Reputation (public read, own write)
DROP POLICY IF EXISTS "Anyone can view reputation" ON viewer_reputation;
CREATE POLICY "Anyone can view reputation" ON viewer_reputation
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users can update their own reputation" ON viewer_reputation;
CREATE POLICY "Users can update their own reputation" ON viewer_reputation
    FOR ALL USING (user_id = auth.uid());

-- Vehicle Reviews (public read, own write)
DROP POLICY IF EXISTS "Anyone can view published reviews" ON vehicle_reviews;
CREATE POLICY "Anyone can view published reviews" ON vehicle_reviews
    FOR SELECT USING (status = 'published');

DROP POLICY IF EXISTS "Users can manage their own reviews" ON vehicle_reviews;
CREATE POLICY "Users can manage their own reviews" ON vehicle_reviews
    FOR ALL USING (reviewer_id = auth.uid());

-- Interaction Notifications
DROP POLICY IF EXISTS "Users can view their own notifications" ON interaction_notifications;
CREATE POLICY "Users can view their own notifications" ON interaction_notifications
    FOR SELECT USING (recipient_id = auth.uid());

DROP POLICY IF EXISTS "Users can update their own notifications" ON interaction_notifications;
CREATE POLICY "Users can update their own notifications" ON interaction_notifications
    FOR UPDATE USING (recipient_id = auth.uid());

-- Functions for automation

-- Function to update viewer reputation based on activity
DROP TRIGGER IF EXISTS update_viewer_reputation_trigger ON viewer_activity;

DROP FUNCTION IF EXISTS update_viewer_reputation();

CREATE OR REPLACE FUNCTION update_viewer_reputation()
RETURNS TRIGGER AS $$
BEGIN
    -- Insert or update viewer reputation record
    INSERT INTO viewer_reputation (user_id, total_interactions, last_activity_at)
    VALUES (NEW.user_id, 1, NEW.created_at)
    ON CONFLICT (user_id) DO UPDATE SET
        total_interactions = viewer_reputation.total_interactions + 1,
        last_activity_at = NEW.created_at,
        updated_at = NOW();
    
    -- Update specific metrics based on activity type
    IF NEW.activity_type = 'streaming_session' THEN
        UPDATE viewer_reputation 
        SET total_sessions_attended = total_sessions_attended + 1,
            total_viewing_time_minutes = total_viewing_time_minutes + COALESCE(NEW.duration_seconds / 60, 0)
        WHERE user_id = NEW.user_id;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update reputation on new activity
CREATE TRIGGER update_viewer_reputation_trigger
    AFTER INSERT ON viewer_activity
    FOR EACH ROW EXECUTE FUNCTION update_viewer_reputation();

-- Function to update critic level based on vehicles viewed
DROP TRIGGER IF EXISTS update_critic_level_trigger ON viewer_activity;

DROP FUNCTION IF EXISTS update_critic_level();

CREATE OR REPLACE FUNCTION update_critic_level()
RETURNS TRIGGER AS $$
DECLARE
    vehicles_viewed INTEGER;
    new_level TEXT;
BEGIN
    -- Count unique vehicles viewed by user
    SELECT COUNT(DISTINCT vehicle_id) INTO vehicles_viewed
    FROM viewer_activity
    WHERE user_id = NEW.user_id;
    
    -- Determine new critic level
    IF vehicles_viewed >= 500 THEN
        new_level := 'master_critic';
    ELSIF vehicles_viewed >= 201 THEN
        new_level := 'critic';
    ELSIF vehicles_viewed >= 51 THEN
        new_level := 'expert';
    ELSIF vehicles_viewed >= 11 THEN
        new_level := 'enthusiast';
    ELSE
        new_level := 'novice';
    END IF;
    
    -- Update critic level if it changed
    UPDATE viewer_reputation 
    SET 
        critic_level = new_level,
        total_vehicles_viewed = vehicles_viewed,
        critic_level_achieved_at = CASE 
            WHEN critic_level != new_level THEN NOW() 
            ELSE critic_level_achieved_at 
        END
    WHERE user_id = NEW.user_id;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update critic level when viewing new vehicles
CREATE TRIGGER update_critic_level_trigger
    AFTER INSERT ON viewer_activity
    FOR EACH ROW EXECUTE FUNCTION update_critic_level();
