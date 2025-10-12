-- Fix missing profile tables causing 404 errors

-- Create profile_completion table
CREATE TABLE IF NOT EXISTS profile_completion (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    completion_percentage INTEGER DEFAULT 0,
    missing_fields JSONB DEFAULT '[]'::jsonb,
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create profile_stats table
CREATE TABLE IF NOT EXISTS profile_stats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    vehicles_count INTEGER DEFAULT 0,
    images_count INTEGER DEFAULT 0,
    verifications_count INTEGER DEFAULT 0,
    contributions_count INTEGER DEFAULT 0,
    last_activity TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create user_contributions table
CREATE TABLE IF NOT EXISTS user_contributions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    contribution_type TEXT NOT NULL,
    contribution_date DATE DEFAULT CURRENT_DATE,
    contribution_count INTEGER DEFAULT 1,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create profile_achievements table
CREATE TABLE IF NOT EXISTS profile_achievements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    achievement_type TEXT NOT NULL,
    achievement_name TEXT NOT NULL,
    description TEXT,
    points INTEGER DEFAULT 0,
    earned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'::jsonb
);

-- Create profile_activity table
CREATE TABLE IF NOT EXISTS profile_activity (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    activity_type TEXT NOT NULL,
    activity_description TEXT,
    related_vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS on all tables
ALTER TABLE profile_completion ENABLE ROW LEVEL SECURITY;
ALTER TABLE profile_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_contributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE profile_achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE profile_activity ENABLE ROW LEVEL SECURITY;

-- RLS Policies for profile_completion
CREATE POLICY "users_can_view_own_completion" ON profile_completion
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "users_can_insert_own_completion" ON profile_completion
    FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users_can_update_own_completion" ON profile_completion
    FOR UPDATE USING (auth.uid() = user_id);

-- RLS Policies for profile_stats
CREATE POLICY "users_can_view_own_stats" ON profile_stats
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "users_can_insert_own_stats" ON profile_stats
    FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users_can_update_own_stats" ON profile_stats
    FOR UPDATE USING (auth.uid() = user_id);

-- RLS Policies for user_contributions
CREATE POLICY "users_can_view_own_contributions" ON user_contributions
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "users_can_insert_own_contributions" ON user_contributions
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- RLS Policies for profile_achievements
CREATE POLICY "users_can_view_own_achievements" ON profile_achievements
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "users_can_insert_own_achievements" ON profile_achievements
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- RLS Policies for profile_activity
CREATE POLICY "users_can_view_own_activity" ON profile_activity
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "users_can_insert_own_activity" ON profile_activity
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_profile_completion_user_id ON profile_completion(user_id);
CREATE INDEX IF NOT EXISTS idx_profile_stats_user_id ON profile_stats(user_id);
CREATE INDEX IF NOT EXISTS idx_user_contributions_user_id ON user_contributions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_contributions_date ON user_contributions(contribution_date);
CREATE INDEX IF NOT EXISTS idx_profile_achievements_user_id ON profile_achievements(user_id);
CREATE INDEX IF NOT EXISTS idx_profile_activity_user_id ON profile_activity(user_id);
CREATE INDEX IF NOT EXISTS idx_profile_activity_created_at ON profile_activity(created_at);
