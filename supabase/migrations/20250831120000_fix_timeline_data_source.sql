-- Simple fix for timeline events data_source column and user_trust_scores table

-- Add data_source column to timeline_events if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'timeline_events' AND column_name = 'data_source') THEN
        ALTER TABLE timeline_events ADD COLUMN data_source TEXT DEFAULT 'user_input';
    END IF;
END $$;

-- Create user_trust_scores table if it doesn't exist
CREATE TABLE IF NOT EXISTS user_trust_scores (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
    overall_score DECIMAL(3,2) DEFAULT 0.50 CHECK (overall_score >= 0.0 AND overall_score <= 1.0),
    verification_count INTEGER DEFAULT 0,
    contribution_count INTEGER DEFAULT 0,
    accuracy_rate DECIMAL(3,2) DEFAULT 0.50 CHECK (accuracy_rate >= 0.0 AND accuracy_rate <= 1.0),
    is_verified_professional BOOLEAN DEFAULT FALSE,
    professional_type TEXT,
    trust_level TEXT DEFAULT 'new' CHECK (trust_level IN ('new', 'basic', 'trusted', 'expert', 'moderator', 'suspended')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS on user_trust_scores
ALTER TABLE user_trust_scores ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for user_trust_scores
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'user_trust_scores' AND policyname = 'Public read access') THEN
        CREATE POLICY "Public read access" ON user_trust_scores FOR SELECT USING (true);
    END IF;
END $$;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_user_trust_scores_user_id ON user_trust_scores(user_id);
CREATE INDEX IF NOT EXISTS idx_timeline_events_data_source ON timeline_events(data_source);

-- Initialize trust scores for existing users
INSERT INTO user_trust_scores (user_id)
SELECT id FROM auth.users
WHERE NOT EXISTS (SELECT 1 FROM user_trust_scores WHERE user_trust_scores.user_id = auth.users.id);
