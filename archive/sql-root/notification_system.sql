-- Notification System
-- Comprehensive notification system for user engagement

-- Create notification type enum
DO $$ BEGIN
    CREATE TYPE notification_type AS ENUM (
        'like', 'comment', 'follow', 'mention', 'share',
        'auction_outbid', 'auction_won', 'auction_ending', 'auction_started',
        'stream_live', 'stream_starting', 'stream_ended',
        'vehicle_featured', 'build_milestone', 'shop_review',
        'system_announcement', 'account_update', 'payment_received'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create notification status enum
DO $$ BEGIN
    CREATE TYPE notification_status AS ENUM ('unread', 'read', 'archived', 'dismissed');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create notification priority enum
DO $$ BEGIN
    CREATE TYPE notification_priority AS ENUM ('low', 'normal', 'high', 'urgent');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- User notification preferences table
CREATE TABLE IF NOT EXISTS notification_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    -- Push notification preferences
    push_enabled BOOLEAN DEFAULT true,
    push_likes BOOLEAN DEFAULT true,
    push_comments BOOLEAN DEFAULT true,
    push_follows BOOLEAN DEFAULT true,
    push_mentions BOOLEAN DEFAULT true,
    push_auctions BOOLEAN DEFAULT true,
    push_streams BOOLEAN DEFAULT true,
    push_system BOOLEAN DEFAULT true,

    -- Email notification preferences
    email_enabled BOOLEAN DEFAULT true,
    email_daily_digest BOOLEAN DEFAULT true,
    email_weekly_summary BOOLEAN DEFAULT true,
    email_auction_updates BOOLEAN DEFAULT true,
    email_stream_notifications BOOLEAN DEFAULT false,
    email_marketing BOOLEAN DEFAULT false,

    -- In-app notification preferences
    inapp_enabled BOOLEAN DEFAULT true,
    inapp_sound BOOLEAN DEFAULT true,
    inapp_desktop BOOLEAN DEFAULT true,

    -- Quiet hours (UTC)
    quiet_hours_enabled BOOLEAN DEFAULT false,
    quiet_hours_start TIME DEFAULT '22:00',
    quiet_hours_end TIME DEFAULT '08:00',
    quiet_hours_timezone TEXT DEFAULT 'UTC',

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(user_id)
);

-- Main notifications table
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recipient_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    sender_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

    -- Notification details
    type notification_type NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    status notification_status DEFAULT 'unread',
    priority notification_priority DEFAULT 'normal',

    -- Action data (JSON)
    action_data JSONB DEFAULT '{}',
    action_url TEXT, -- Deep link URL

    -- Related entity references
    entity_type TEXT, -- 'vehicle', 'timeline_event', 'auction_listing', 'stream', etc.
    entity_id UUID,

    -- Grouping (for similar notifications)
    group_key TEXT, -- For grouping similar notifications
    group_count INTEGER DEFAULT 1,

    -- Delivery tracking
    delivered_push BOOLEAN DEFAULT false,
    delivered_email BOOLEAN DEFAULT false,
    delivered_inapp BOOLEAN DEFAULT true,

    push_sent_at TIMESTAMPTZ,
    email_sent_at TIMESTAMPTZ,
    read_at TIMESTAMPTZ,

    -- Expiry
    expires_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Push notification tokens (for mobile devices)
CREATE TABLE IF NOT EXISTS push_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    -- Token details
    token TEXT NOT NULL,
    platform TEXT NOT NULL, -- 'ios', 'android', 'web'
    device_id TEXT,
    device_name TEXT,

    -- Token status
    active BOOLEAN DEFAULT true,
    last_used_at TIMESTAMPTZ DEFAULT NOW(),

    -- App version info
    app_version TEXT,
    os_version TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(token)
);

-- Email digest queue
CREATE TABLE IF NOT EXISTS email_digest_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    -- Digest details
    digest_type TEXT NOT NULL, -- 'daily', 'weekly'
    digest_date DATE NOT NULL,

    -- Content
    notification_ids UUID[] DEFAULT '{}',
    content_data JSONB DEFAULT '{}',

    -- Status
    processed BOOLEAN DEFAULT false,
    sent_at TIMESTAMPTZ,
    error_message TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(user_id, digest_type, digest_date)
);

-- Notification templates for consistent messaging
CREATE TABLE IF NOT EXISTS notification_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Template identification
    template_key TEXT NOT NULL UNIQUE,
    notification_type notification_type NOT NULL,

    -- Template content
    title_template TEXT NOT NULL,
    body_template TEXT,

    -- Localization
    language TEXT DEFAULT 'en',

    -- Template variables documentation
    variables JSONB DEFAULT '{}',

    active BOOLEAN DEFAULT true,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Functions for notification management

-- Function to create notification
CREATE OR REPLACE FUNCTION create_notification(
    recipient_id_param UUID,
    sender_id_param UUID,
    type_param notification_type,
    title_param TEXT,
    body_param TEXT DEFAULT NULL,
    action_url_param TEXT DEFAULT NULL,
    entity_type_param TEXT DEFAULT NULL,
    entity_id_param UUID DEFAULT NULL,
    group_key_param TEXT DEFAULT NULL,
    priority_param notification_priority DEFAULT 'normal'
)
RETURNS UUID AS $$
DECLARE
    notification_id UUID;
    existing_notification_id UUID;
    user_prefs RECORD;
BEGIN
    -- Check if user wants this type of notification
    SELECT * INTO user_prefs FROM notification_preferences WHERE user_id = recipient_id_param;

    -- If no preferences found, use defaults
    IF user_prefs IS NULL THEN
        INSERT INTO notification_preferences (user_id) VALUES (recipient_id_param);
        SELECT * INTO user_prefs FROM notification_preferences WHERE user_id = recipient_id_param;
    END IF;

    -- Skip if user has disabled in-app notifications
    IF NOT user_prefs.inapp_enabled THEN
        RETURN NULL;
    END IF;

    -- Check for existing notification with same group_key (for grouping)
    IF group_key_param IS NOT NULL THEN
        SELECT id INTO existing_notification_id
        FROM notifications
        WHERE recipient_id = recipient_id_param
        AND group_key = group_key_param
        AND status = 'unread'
        AND created_at > NOW() - INTERVAL '24 hours'
        LIMIT 1;

        -- If found, update count and return existing ID
        IF existing_notification_id IS NOT NULL THEN
            UPDATE notifications
            SET
                group_count = group_count + 1,
                title = title_param,
                body = body_param,
                updated_at = NOW()
            WHERE id = existing_notification_id;

            RETURN existing_notification_id;
        END IF;
    END IF;

    -- Create new notification
    INSERT INTO notifications (
        recipient_id,
        sender_id,
        type,
        title,
        body,
        action_url,
        entity_type,
        entity_id,
        group_key,
        priority
    )
    VALUES (
        recipient_id_param,
        sender_id_param,
        type_param,
        title_param,
        body_param,
        action_url_param,
        entity_type_param,
        entity_id_param,
        group_key_param,
        priority_param
    )
    RETURNING id INTO notification_id;

    RETURN notification_id;
END;
$$ LANGUAGE plpgsql;

-- Function to mark notifications as read
CREATE OR REPLACE FUNCTION mark_notifications_read(
    user_id_param UUID,
    notification_ids_param UUID[] DEFAULT NULL
)
RETURNS INTEGER AS $$
DECLARE
    updated_count INTEGER;
BEGIN
    IF notification_ids_param IS NULL THEN
        -- Mark all unread notifications as read
        UPDATE notifications
        SET
            status = 'read',
            read_at = NOW(),
            updated_at = NOW()
        WHERE recipient_id = user_id_param
        AND status = 'unread';

        GET DIAGNOSTICS updated_count = ROW_COUNT;
    ELSE
        -- Mark specific notifications as read
        UPDATE notifications
        SET
            status = 'read',
            read_at = NOW(),
            updated_at = NOW()
        WHERE recipient_id = user_id_param
        AND id = ANY(notification_ids_param)
        AND status = 'unread';

        GET DIAGNOSTICS updated_count = ROW_COUNT;
    END IF;

    RETURN updated_count;
END;
$$ LANGUAGE plpgsql;

-- Function to get user's notification feed
CREATE OR REPLACE FUNCTION get_notification_feed(
    user_id_param UUID,
    limit_count INTEGER DEFAULT 50,
    offset_count INTEGER DEFAULT 0,
    include_read BOOLEAN DEFAULT true
)
RETURNS TABLE(
    notification_id UUID,
    type notification_type,
    title TEXT,
    body TEXT,
    status notification_status,
    priority notification_priority,
    action_url TEXT,
    group_count INTEGER,
    sender_name TEXT,
    sender_avatar TEXT,
    created_at TIMESTAMPTZ,
    time_ago TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        n.id as notification_id,
        n.type,
        n.title,
        n.body,
        n.status,
        n.priority,
        n.action_url,
        n.group_count,
        up.display_name as sender_name,
        up.avatar_url as sender_avatar,
        n.created_at,
        CASE
            WHEN n.created_at > NOW() - INTERVAL '1 minute' THEN 'Just now'
            WHEN n.created_at > NOW() - INTERVAL '1 hour' THEN EXTRACT(EPOCH FROM (NOW() - n.created_at))::INTEGER / 60 || 'm ago'
            WHEN n.created_at > NOW() - INTERVAL '1 day' THEN EXTRACT(EPOCH FROM (NOW() - n.created_at))::INTEGER / 3600 || 'h ago'
            WHEN n.created_at > NOW() - INTERVAL '7 days' THEN EXTRACT(EPOCH FROM (NOW() - n.created_at))::INTEGER / 86400 || 'd ago'
            ELSE TO_CHAR(n.created_at, 'Mon DD')
        END as time_ago
    FROM notifications n
    LEFT JOIN user_profiles up ON n.sender_id = up.user_id
    WHERE n.recipient_id = user_id_param
    AND (include_read OR n.status = 'unread')
    AND (n.expires_at IS NULL OR n.expires_at > NOW())
    ORDER BY n.created_at DESC
    LIMIT limit_count
    OFFSET offset_count;
END;
$$ LANGUAGE plpgsql;

-- Function to get unread notification count
CREATE OR REPLACE FUNCTION get_unread_notification_count(
    user_id_param UUID
)
RETURNS INTEGER AS $$
DECLARE
    unread_count INTEGER;
BEGIN
    SELECT COUNT(*)
    INTO unread_count
    FROM notifications
    WHERE recipient_id = user_id_param
    AND status = 'unread'
    AND (expires_at IS NULL OR expires_at > NOW());

    RETURN COALESCE(unread_count, 0);
END;
$$ LANGUAGE plpgsql;

-- Function to clean up old notifications
CREATE OR REPLACE FUNCTION cleanup_old_notifications()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    -- Delete read notifications older than 30 days
    DELETE FROM notifications
    WHERE status IN ('read', 'archived')
    AND created_at < NOW() - INTERVAL '30 days';

    GET DIAGNOSTICS deleted_count = ROW_COUNT;

    -- Delete expired notifications
    DELETE FROM notifications
    WHERE expires_at IS NOT NULL
    AND expires_at < NOW();

    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipient_id);
CREATE INDEX IF NOT EXISTS idx_notifications_status ON notifications(recipient_id, status);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);
CREATE INDEX IF NOT EXISTS idx_notifications_entity ON notifications(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_notifications_group_key ON notifications(group_key) WHERE group_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notification_preferences_user ON notification_preferences(user_id);

CREATE INDEX IF NOT EXISTS idx_push_tokens_user ON push_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_push_tokens_active ON push_tokens(user_id, active) WHERE active = true;

CREATE INDEX IF NOT EXISTS idx_email_digest_queue_user ON email_digest_queue(user_id, digest_type, digest_date);
CREATE INDEX IF NOT EXISTS idx_email_digest_queue_processed ON email_digest_queue(processed, created_at) WHERE processed = false;

-- RLS Policies
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_digest_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_templates ENABLE ROW LEVEL SECURITY;

-- Notifications policies
CREATE POLICY "Users can view their own notifications" ON notifications FOR SELECT USING (recipient_id = auth.uid());
CREATE POLICY "System can create notifications" ON notifications FOR INSERT WITH CHECK (true);
CREATE POLICY "Users can update their own notifications" ON notifications FOR UPDATE USING (recipient_id = auth.uid());
CREATE POLICY "Users can delete their own notifications" ON notifications FOR DELETE USING (recipient_id = auth.uid());

-- Notification preferences policies
CREATE POLICY "Users can manage their own preferences" ON notification_preferences FOR ALL USING (user_id = auth.uid());

-- Push tokens policies
CREATE POLICY "Users can manage their own push tokens" ON push_tokens FOR ALL USING (user_id = auth.uid());

-- Email digest queue policies
CREATE POLICY "Users can view their own digest queue" ON email_digest_queue FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "System can manage digest queue" ON email_digest_queue FOR ALL WITH CHECK (true);

-- Notification templates policies
CREATE POLICY "Anyone can view active templates" ON notification_templates FOR SELECT USING (active = true);

-- Insert default notification templates
INSERT INTO notification_templates (template_key, notification_type, title_template, body_template) VALUES
('like_vehicle', 'like', '{{sender_name}} liked your {{entity_type}}', '{{sender_name}} liked your {{vehicle_name}}'),
('comment_timeline', 'comment', '{{sender_name}} commented on your post', '{{sender_name}}: "{{comment_text}}"'),
('follow_user', 'follow', '{{sender_name}} started following you', '{{sender_name}} is now following your builds'),
('auction_outbid', 'auction_outbid', 'You''ve been outbid on {{auction_title}}', 'Current bid: ${{current_bid}} • Ends {{end_time}}'),
('auction_won', 'auction_won', 'Congratulations! You won {{auction_title}}', 'Winning bid: ${{winning_bid}} • Payment due within 7 days'),
('stream_live', 'stream_live', '{{streamer_name}} is now live!', 'Streaming: {{stream_title}}'),
('build_milestone', 'build_milestone', 'Milestone reached on {{vehicle_name}}', 'Your {{vehicle_name}} has reached {{milestone_name}}!')
ON CONFLICT (template_key) DO NOTHING;

-- Insert default user preferences for existing users
INSERT INTO notification_preferences (user_id)
SELECT id FROM auth.users
WHERE id NOT IN (SELECT user_id FROM notification_preferences)
ON CONFLICT (user_id) DO NOTHING;

COMMIT;