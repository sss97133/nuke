-- Discovery System Tables and Features
-- Tracks first discoveries, contributions, and gamification

-- Add discovery fields to vehicles table
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS discovered_by UUID REFERENCES auth.users(id);
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS discovered_at TIMESTAMPTZ;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS discovery_source TEXT;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS discovery_url TEXT;

-- Create index for discovery queries
CREATE INDEX IF NOT EXISTS idx_vehicles_discovered_by ON vehicles(discovered_by);
CREATE INDEX IF NOT EXISTS idx_vehicles_discovered_at ON vehicles(discovered_at DESC);

-- User contributions table for tracking all types of contributions
CREATE TABLE IF NOT EXISTS user_contributions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    contribution_type TEXT NOT NULL CHECK (contribution_type IN ('discovery', 'enrichment', 'verification', 'image', 'correction')),
    fields_added TEXT[],
    fields_corrected TEXT[],
    points_earned INTEGER NOT NULL DEFAULT 0,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, vehicle_id, contribution_type, created_at)
);

-- Indexes for contributions
CREATE INDEX idx_contributions_user ON user_contributions(user_id);
CREATE INDEX idx_contributions_vehicle ON user_contributions(vehicle_id);
CREATE INDEX idx_contributions_type ON user_contributions(contribution_type);
CREATE INDEX idx_contributions_created ON user_contributions(created_at DESC);

-- Discovery notifications table
CREATE TABLE IF NOT EXISTS discovery_notifications (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    notification_type TEXT NOT NULL CHECK (notification_type IN ('first_discovery', 'enrichment', 'rank_up', 'milestone', 'overtaken')),
    title TEXT NOT NULL,
    message TEXT,
    data JSONB,
    read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for unread notifications
CREATE INDEX idx_notifications_unread ON discovery_notifications(user_id, read) WHERE read = FALSE;

-- Leaderboard snapshots for historical tracking
CREATE TABLE IF NOT EXISTS leaderboard_snapshots (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    snapshot_date DATE NOT NULL,
    rank INTEGER NOT NULL,
    points INTEGER NOT NULL,
    discoveries INTEGER NOT NULL,
    enrichments INTEGER NOT NULL,
    skill_level TEXT NOT NULL,
    UNIQUE(user_id, snapshot_date)
);

-- Index for leaderboard queries
CREATE INDEX idx_leaderboard_date ON leaderboard_snapshots(snapshot_date DESC);
CREATE INDEX idx_leaderboard_rank ON leaderboard_snapshots(snapshot_date, rank);

-- Discovery streaks for engagement
CREATE TABLE IF NOT EXISTS discovery_streaks (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    current_streak INTEGER NOT NULL DEFAULT 0,
    longest_streak INTEGER NOT NULL DEFAULT 0,
    last_discovery_date DATE,
    streak_start_date DATE,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Vehicle view tracking for discovery attribution
CREATE TABLE IF NOT EXISTS vehicle_views (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    session_id TEXT,
    referrer TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for view analytics
CREATE INDEX idx_vehicle_views_vehicle ON vehicle_views(vehicle_id);
CREATE INDEX idx_vehicle_views_created ON vehicle_views(created_at DESC);

-- Enable RLS on new tables
ALTER TABLE user_contributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE discovery_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE leaderboard_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE discovery_streaks ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_views ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- User contributions: users can see all, but only insert their own
CREATE POLICY "Anyone can view contributions"
    ON user_contributions FOR SELECT
    USING (true);

CREATE POLICY "Users can create their own contributions"
    ON user_contributions FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Notifications: users can only see and update their own
CREATE POLICY "Users can view their notifications"
    ON discovery_notifications FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can mark notifications as read"
    ON discovery_notifications FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Leaderboard: public read
CREATE POLICY "Leaderboard is public"
    ON leaderboard_snapshots FOR SELECT
    USING (true);

-- Streaks: users see their own
CREATE POLICY "Users can view their streaks"
    ON discovery_streaks FOR SELECT
    USING (auth.uid() = user_id);

-- Vehicle views: logged for analytics
CREATE POLICY "Vehicle views are write-only for users"
    ON vehicle_views FOR INSERT
    WITH CHECK (true);

-- Function to update discovery streak
CREATE OR REPLACE FUNCTION update_discovery_streak()
RETURNS TRIGGER AS $$
BEGIN
    -- Check if this is a discovery contribution
    IF NEW.contribution_type = 'discovery' THEN
        -- Update or insert streak record
        INSERT INTO discovery_streaks (
            user_id,
            current_streak,
            longest_streak,
            last_discovery_date,
            streak_start_date
        ) VALUES (
            NEW.user_id,
            1,
            1,
            CURRENT_DATE,
            CURRENT_DATE
        )
        ON CONFLICT (user_id) DO UPDATE SET
            current_streak = CASE
                WHEN discovery_streaks.last_discovery_date = CURRENT_DATE - INTERVAL '1 day' THEN discovery_streaks.current_streak + 1
                WHEN discovery_streaks.last_discovery_date < CURRENT_DATE - INTERVAL '1 day' THEN 1
                ELSE discovery_streaks.current_streak
            END,
            longest_streak = GREATEST(
                discovery_streaks.longest_streak,
                CASE
                    WHEN discovery_streaks.last_discovery_date = CURRENT_DATE - INTERVAL '1 day' THEN discovery_streaks.current_streak + 1
                    ELSE 1
                END
            ),
            last_discovery_date = CURRENT_DATE,
            streak_start_date = CASE
                WHEN discovery_streaks.last_discovery_date < CURRENT_DATE - INTERVAL '1 day' THEN CURRENT_DATE
                ELSE discovery_streaks.streak_start_date
            END,
            updated_at = NOW();
            
        -- Check for streak milestones
        IF (SELECT current_streak FROM discovery_streaks WHERE user_id = NEW.user_id) IN (7, 30, 100) THEN
            INSERT INTO discovery_notifications (
                user_id,
                notification_type,
                title,
                message,
                data
            ) VALUES (
                NEW.user_id,
                'milestone',
                'Streak Milestone!',
                'You''ve maintained a ' || (SELECT current_streak FROM discovery_streaks WHERE user_id = NEW.user_id) || ' day discovery streak!',
                jsonb_build_object('streak', (SELECT current_streak FROM discovery_streaks WHERE user_id = NEW.user_id))
            );
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger for streak updates
CREATE TRIGGER update_streak_on_contribution
    AFTER INSERT ON user_contributions
    FOR EACH ROW
    EXECUTE FUNCTION update_discovery_streak();

-- Function to create rank advancement notification
CREATE OR REPLACE FUNCTION notify_rank_advancement()
RETURNS TRIGGER AS $$
DECLARE
    old_level TEXT;
BEGIN
    -- Get the old skill level
    old_level := OLD.skill_level;
    
    -- Check if skill level increased
    IF NEW.skill_level != old_level AND (
        (old_level = 'novice' AND NEW.skill_level IN ('apprentice', 'journeyman', 'expert', 'master')) OR
        (old_level = 'apprentice' AND NEW.skill_level IN ('journeyman', 'expert', 'master')) OR
        (old_level = 'journeyman' AND NEW.skill_level IN ('expert', 'master')) OR
        (old_level = 'expert' AND NEW.skill_level = 'master')
    ) THEN
        INSERT INTO discovery_notifications (
            user_id,
            notification_type,
            title,
            message,
            data
        ) VALUES (
            NEW.user_id,
            'rank_up',
            'Rank Advancement!',
            'Congratulations! You''ve advanced from ' || old_level || ' to ' || NEW.skill_level || '!',
            jsonb_build_object(
                'old_rank', old_level,
                'new_rank', NEW.skill_level,
                'total_points', NEW.total_points
            )
        );
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger for rank notifications (only if dependency table exists)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'user_legitimacy_scores'
    ) THEN
        -- Ensure idempotency
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.triggers
            WHERE event_object_table = 'user_legitimacy_scores'
              AND trigger_name = 'notify_on_rank_change'
        ) THEN
            CREATE TRIGGER notify_on_rank_change
                AFTER UPDATE ON user_legitimacy_scores
                FOR EACH ROW
                WHEN (OLD.skill_level IS DISTINCT FROM NEW.skill_level)
                EXECUTE FUNCTION notify_rank_advancement();
        END IF;
    END IF;
END$$;

-- Function to record vehicle view
CREATE OR REPLACE FUNCTION record_vehicle_view(
    p_vehicle_id UUID,
    p_session_id TEXT DEFAULT NULL,
    p_referrer TEXT DEFAULT NULL
)
RETURNS void AS $$
BEGIN
    INSERT INTO vehicle_views (vehicle_id, user_id, session_id, referrer)
    VALUES (p_vehicle_id, auth.uid(), p_session_id, p_referrer);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get discovery stats for a user
CREATE OR REPLACE FUNCTION get_user_discovery_stats(p_user_id UUID)
RETURNS TABLE (
    total_discoveries INTEGER,
    total_enrichments INTEGER,
    total_points INTEGER,
    current_streak INTEGER,
    longest_streak INTEGER,
    rank_percentile NUMERIC,
    skill_level TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COALESCE(COUNT(DISTINCT v.id) FILTER (WHERE v.discovered_by = p_user_id), 0)::INTEGER as total_discoveries,
        COALESCE(COUNT(DISTINCT c.id) FILTER (WHERE c.contribution_type = 'enrichment'), 0)::INTEGER as total_enrichments,
        COALESCE(MAX(l.total_points), 0) as total_points,
        COALESCE(MAX(s.current_streak), 0) as current_streak,
        COALESCE(MAX(s.longest_streak), 0) as longest_streak,
        ROUND(
            100.0 * (
                1.0 - (
                    RANK() OVER (ORDER BY COALESCE(MAX(l.total_points), 0) DESC)::NUMERIC / 
                    COUNT(*) OVER ()::NUMERIC
                )
            ), 2
        ) as rank_percentile,
        COALESCE(MAX(l.skill_level), 'novice') as skill_level
    FROM auth.users u
    LEFT JOIN vehicles v ON v.discovered_by = u.id
    LEFT JOIN user_contributions c ON c.user_id = u.id
    LEFT JOIN user_legitimacy_scores l ON l.user_id = u.id
    LEFT JOIN discovery_streaks s ON s.user_id = u.id
    WHERE u.id = p_user_id
    GROUP BY u.id;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Daily leaderboard snapshot job (would be called by cron)
CREATE OR REPLACE FUNCTION create_daily_leaderboard_snapshot()
RETURNS void AS $$
DECLARE
    r RECORD;
    user_rank INTEGER := 0;
BEGIN
    -- Create snapshots for top 1000 users
    FOR r IN 
        SELECT 
            u.user_id,
            u.total_points,
            COUNT(DISTINCT v.id) as discoveries,
            COUNT(DISTINCT c.id) FILTER (WHERE c.contribution_type = 'enrichment') as enrichments,
            u.skill_level,
            ROW_NUMBER() OVER (ORDER BY u.total_points DESC) as rank
        FROM user_legitimacy_scores u
        LEFT JOIN vehicles v ON v.discovered_by = u.user_id
        LEFT JOIN user_contributions c ON c.user_id = u.user_id AND c.contribution_type = 'enrichment'
        GROUP BY u.user_id, u.total_points, u.skill_level
        ORDER BY u.total_points DESC
        LIMIT 1000
    LOOP
        INSERT INTO leaderboard_snapshots (
            user_id,
            snapshot_date,
            rank,
            points,
            discoveries,
            enrichments,
            skill_level
        ) VALUES (
            r.user_id,
            CURRENT_DATE,
            r.rank,
            r.total_points,
            r.discoveries,
            r.enrichments,
            r.skill_level
        )
        ON CONFLICT (user_id, snapshot_date) DO UPDATE SET
            rank = EXCLUDED.rank,
            points = EXCLUDED.points,
            discoveries = EXCLUDED.discoveries,
            enrichments = EXCLUDED.enrichments,
            skill_level = EXCLUDED.skill_level;
    END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
