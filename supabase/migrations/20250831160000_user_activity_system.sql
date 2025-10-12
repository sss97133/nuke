-- Create user activities table for tracking work contributions and legitimacy
CREATE TABLE IF NOT EXISTS user_activities (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    activity_type TEXT NOT NULL CHECK (activity_type IN ('work_session', 'vehicle_contribution', 'image_upload', 'timeline_event', 'verification', 'peer_review')),
    title TEXT NOT NULL,
    description TEXT,
    vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL,
    work_session_id UUID REFERENCES work_sessions(id) ON DELETE SET NULL,
    timeline_event_id UUID,
    points_earned INTEGER NOT NULL DEFAULT 0,
    difficulty_level TEXT NOT NULL CHECK (difficulty_level IN ('basic', 'intermediate', 'advanced', 'expert')),
    verification_status TEXT NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending', 'verified', 'disputed', 'rejected')),
    evidence_urls TEXT[],
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    verified_at TIMESTAMPTZ,
    verified_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Create user legitimacy scores table
CREATE TABLE IF NOT EXISTS user_legitimacy_scores (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    total_points INTEGER NOT NULL DEFAULT 0,
    verified_points INTEGER NOT NULL DEFAULT 0,
    activity_count INTEGER NOT NULL DEFAULT 0,
    verification_rate DECIMAL(3,2) NOT NULL DEFAULT 0.00 CHECK (verification_rate >= 0 AND verification_rate <= 1),
    skill_level TEXT NOT NULL DEFAULT 'novice' CHECK (skill_level IN ('novice', 'apprentice', 'journeyman', 'expert', 'master')),
    specializations TEXT[],
    trust_score DECIMAL(3,2) NOT NULL DEFAULT 0.00 CHECK (trust_score >= 0 AND trust_score <= 1),
    last_activity TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for efficient querying
CREATE INDEX idx_user_activities_user_id ON user_activities(user_id);
CREATE INDEX idx_user_activities_type ON user_activities(activity_type);
CREATE INDEX idx_user_activities_vehicle ON user_activities(vehicle_id);
CREATE INDEX idx_user_activities_verification ON user_activities(verification_status);
CREATE INDEX idx_user_activities_created_at ON user_activities(created_at);
CREATE INDEX idx_user_activities_user_created ON user_activities(user_id, created_at);

-- Enable RLS
ALTER TABLE user_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_legitimacy_scores ENABLE ROW LEVEL SECURITY;

-- RLS Policies for user_activities
CREATE POLICY "Users can view their own activities"
    ON user_activities FOR SELECT
    TO authenticated
    USING (user_id = auth.uid());

CREATE POLICY "Vehicle owners can view activities on their vehicles"
    ON user_activities FOR SELECT
    TO authenticated
    USING (
        vehicle_id IS NOT NULL AND
        EXISTS (
            SELECT 1 FROM vehicles v 
            WHERE v.id = user_activities.vehicle_id 
            AND v.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can insert their own activities"
    ON user_activities FOR INSERT
    TO authenticated
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own unverified activities"
    ON user_activities FOR UPDATE
    TO authenticated
    USING (user_id = auth.uid() AND verification_status = 'pending')
    WITH CHECK (user_id = auth.uid());

-- RLS Policies for user_legitimacy_scores
CREATE POLICY "Users can view their own legitimacy score"
    ON user_legitimacy_scores FOR SELECT
    TO authenticated
    USING (user_id = auth.uid());

CREATE POLICY "Public can view legitimacy scores for transparency"
    ON user_legitimacy_scores FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Users can upsert their own legitimacy score"
    ON user_legitimacy_scores FOR INSERT
    TO authenticated
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own legitimacy score"
    ON user_legitimacy_scores FOR UPDATE
    TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

-- Create trigger for updated_at on legitimacy scores
CREATE OR REPLACE FUNCTION update_user_legitimacy_scores_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER user_legitimacy_scores_updated_at
    BEFORE UPDATE ON user_legitimacy_scores
    FOR EACH ROW
    EXECUTE FUNCTION update_user_legitimacy_scores_updated_at();

-- Add activity reference to work_sessions for cross-referencing
ALTER TABLE work_sessions 
ADD COLUMN IF NOT EXISTS user_activity_id UUID REFERENCES user_activities(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_work_sessions_activity ON work_sessions(user_activity_id);
