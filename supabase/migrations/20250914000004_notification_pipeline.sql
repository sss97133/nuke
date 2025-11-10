-- Notification Pipeline System
-- Complete system for user notifications, requests, and approvals

-- User notifications table
CREATE TABLE IF NOT EXISTS user_notifications (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    type TEXT NOT NULL CHECK (type IN (
        'vin_request', 
        'verification_request', 
        'contribution_request', 
        'ownership_challenge',
        'data_correction',
        'photo_approval',
        'timeline_contribution'
    )),
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
    related_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    metadata JSONB DEFAULT '{}',
    is_read BOOLEAN DEFAULT FALSE,
    is_responded BOOLEAN DEFAULT FALSE,
    response_data JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE,
    priority INTEGER DEFAULT 1 CHECK (priority BETWEEN 1 AND 5)
);

-- User requests table (for tracking ongoing requests)
CREATE TABLE IF NOT EXISTS user_requests (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    requester_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    target_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
    request_type TEXT NOT NULL CHECK (request_type IN (
        'vin_validation',
        'ownership_verification', 
        'data_contribution',
        'photo_submission',
        'timeline_event'
    )),
    title TEXT NOT NULL,
    description TEXT,
    request_data JSONB DEFAULT '{}',
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
    response_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    responded_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '7 days')
);

-- Quick actions log (track user productivity)
CREATE TABLE IF NOT EXISTS user_quick_actions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    action_type TEXT NOT NULL,
    action_data JSONB DEFAULT '{}',
    vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- User activity feed (for dashboard recent activity)
CREATE TABLE IF NOT EXISTS user_activity_feed (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    activity_type TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_notifications_user_id ON user_notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_user_notifications_unread ON user_notifications(user_id, is_read) WHERE is_read = FALSE;
CREATE INDEX IF NOT EXISTS idx_user_notifications_type ON user_notifications(type);
CREATE INDEX IF NOT EXISTS idx_user_requests_target_user ON user_requests(target_user_id);
CREATE INDEX IF NOT EXISTS idx_user_requests_status ON user_requests(status);
CREATE INDEX IF NOT EXISTS idx_user_activity_feed_user_id ON user_activity_feed(user_id);

-- Row Level Security
ALTER TABLE user_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_quick_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_activity_feed ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Users can view their own notifications" ON user_notifications;
CREATE POLICY "Users can view their own notifications" ON user_notifications
    FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own notifications" ON user_notifications;
CREATE POLICY "Users can update their own notifications" ON user_notifications
    FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "System can insert notifications" ON user_notifications;
CREATE POLICY "System can insert notifications" ON user_notifications
    FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Users can view requests they made or received" ON user_requests;
CREATE POLICY "Users can view requests they made or received" ON user_requests
    FOR SELECT USING (auth.uid() = requester_id OR auth.uid() = target_user_id);

DROP POLICY IF EXISTS "Users can create requests" ON user_requests;
CREATE POLICY "Users can create requests" ON user_requests
    FOR INSERT WITH CHECK (auth.uid() = requester_id);

DROP POLICY IF EXISTS "Target users can update request responses" ON user_requests;
CREATE POLICY "Target users can update request responses" ON user_requests
    FOR UPDATE USING (auth.uid() = target_user_id);

DROP POLICY IF EXISTS "Users can view their own quick actions" ON user_quick_actions;
CREATE POLICY "Users can view their own quick actions" ON user_quick_actions
    FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own quick actions" ON user_quick_actions;
CREATE POLICY "Users can insert their own quick actions" ON user_quick_actions
    FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view their own activity feed" ON user_activity_feed;
CREATE POLICY "Users can view their own activity feed" ON user_activity_feed
    FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "System can insert activity feed items" ON user_activity_feed;
CREATE POLICY "System can insert activity feed items" ON user_activity_feed
    FOR INSERT WITH CHECK (true);

-- Helper functions
DROP FUNCTION IF EXISTS create_notification(UUID, TEXT, TEXT, TEXT, UUID, UUID, JSONB, INTEGER);

CREATE OR REPLACE FUNCTION create_notification(
    p_user_id UUID,
    p_type TEXT,
    p_title TEXT,
    p_message TEXT,
    p_vehicle_id UUID DEFAULT NULL,
    p_related_user_id UUID DEFAULT NULL,
    p_metadata JSONB DEFAULT '{}',
    p_priority INTEGER DEFAULT 1
) RETURNS UUID AS $$
DECLARE
    notification_id UUID;
BEGIN
    INSERT INTO user_notifications (
        user_id, type, title, message, vehicle_id, 
        related_user_id, metadata, priority
    ) VALUES (
        p_user_id, p_type, p_title, p_message, p_vehicle_id,
        p_related_user_id, p_metadata, p_priority
    ) RETURNING id INTO notification_id;
    
    RETURN notification_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP FUNCTION IF EXISTS create_user_request(UUID, UUID, TEXT, TEXT, TEXT, UUID, JSONB);

CREATE OR REPLACE FUNCTION create_user_request(
    p_requester_id UUID,
    p_target_user_id UUID,
    p_request_type TEXT,
    p_title TEXT,
    p_description TEXT DEFAULT NULL,
    p_vehicle_id UUID DEFAULT NULL,
    p_request_data JSONB DEFAULT '{}'
) RETURNS UUID AS $$
DECLARE
    request_id UUID;
    notification_id UUID;
BEGIN
    -- Create the request
    INSERT INTO user_requests (
        requester_id, target_user_id, request_type, title, 
        description, vehicle_id, request_data
    ) VALUES (
        p_requester_id, p_target_user_id, p_request_type, p_title,
        p_description, p_vehicle_id, p_request_data
    ) RETURNING id INTO request_id;
    
    -- Create notification for target user
    SELECT create_notification(
        p_target_user_id,
        CASE p_request_type
            WHEN 'vin_validation' THEN 'vin_request'
            WHEN 'ownership_verification' THEN 'verification_request'
            ELSE 'contribution_request'
        END,
        p_title,
        COALESCE(p_description, 'You have a new request'),
        p_vehicle_id,
        p_requester_id,
        jsonb_build_object('request_id', request_id),
        2
    ) INTO notification_id;
    
    RETURN request_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP FUNCTION IF EXISTS log_quick_action(UUID, TEXT, JSONB, UUID);

CREATE OR REPLACE FUNCTION log_quick_action(
    p_user_id UUID,
    p_action_type TEXT,
    p_action_data JSONB DEFAULT '{}',
    p_vehicle_id UUID DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
    action_id UUID;
BEGIN
    INSERT INTO user_quick_actions (
        user_id, action_type, action_data, vehicle_id
    ) VALUES (
        p_user_id, p_action_type, p_action_data, p_vehicle_id
    ) RETURNING id INTO action_id;
    
    RETURN action_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP FUNCTION IF EXISTS add_activity_feed_item(UUID, TEXT, TEXT, TEXT, UUID, JSONB);

CREATE OR REPLACE FUNCTION add_activity_feed_item(
    p_user_id UUID,
    p_activity_type TEXT,
    p_title TEXT,
    p_description TEXT DEFAULT NULL,
    p_vehicle_id UUID DEFAULT NULL,
    p_metadata JSONB DEFAULT '{}'
) RETURNS UUID AS $$
DECLARE
    activity_id UUID;
BEGIN
    INSERT INTO user_activity_feed (
        user_id, activity_type, title, description, vehicle_id, metadata
    ) VALUES (
        p_user_id, p_activity_type, p_title, p_description, p_vehicle_id, p_metadata
    ) RETURNING id INTO activity_id;
    
    RETURN activity_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Cleanup old notifications (run periodically)
DROP FUNCTION IF EXISTS cleanup_old_notifications();

CREATE OR REPLACE FUNCTION cleanup_old_notifications() RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM user_notifications 
    WHERE created_at < NOW() - INTERVAL '30 days' 
    AND is_read = TRUE;
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Expire old requests
DROP FUNCTION IF EXISTS expire_old_requests();

CREATE OR REPLACE FUNCTION expire_old_requests() RETURNS INTEGER AS $$
DECLARE
    expired_count INTEGER;
BEGIN
    UPDATE user_requests 
    SET status = 'expired'
    WHERE expires_at < NOW() 
    AND status = 'pending';
    
    GET DIAGNOSTICS expired_count = ROW_COUNT;
    RETURN expired_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
