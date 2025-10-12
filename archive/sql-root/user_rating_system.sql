-- User Rating and Verification System
-- This enables the reputation system to incentivize quality contributions

-- Create verification levels enum
DO $$ BEGIN
    CREATE TYPE verification_level AS ENUM ('unverified', 'email_verified', 'phone_verified', 'business_verified', 'expert_verified');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create contribution types enum
DO $$ BEGIN
    CREATE TYPE contribution_type AS ENUM ('vehicle_add', 'image_upload', 'timeline_event', 'verification', 'review', 'data_correction', 'shop_create');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- User ratings table - core reputation system
CREATE TABLE IF NOT EXISTS user_ratings (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    overall_rating DECIMAL(3,2) DEFAULT 0.0 CHECK (overall_rating >= 0.0 AND overall_rating <= 5.0),
    contribution_score INTEGER DEFAULT 0,
    verification_level verification_level DEFAULT 'unverified',
    reputation_points INTEGER DEFAULT 0,
    badges TEXT[] DEFAULT '{}',
    trust_level INTEGER DEFAULT 1 CHECK (trust_level >= 1 AND trust_level <= 10),

    -- Detailed scoring breakdown
    vehicle_contributions INTEGER DEFAULT 0,
    image_contributions INTEGER DEFAULT 0,
    timeline_contributions INTEGER DEFAULT 0,
    verification_contributions INTEGER DEFAULT 0,
    community_rating DECIMAL(3,2) DEFAULT 0.0,

    -- Verification timestamps
    email_verified_at TIMESTAMPTZ,
    phone_verified_at TIMESTAMPTZ,
    business_verified_at TIMESTAMPTZ,
    expert_verified_at TIMESTAMPTZ,

    -- Profile completion incentives
    profile_completion_score INTEGER DEFAULT 0,
    last_activity_at TIMESTAMPTZ DEFAULT NOW(),

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- User contributions tracking - what users do to earn reputation
CREATE TABLE IF NOT EXISTS user_contributions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    contribution_type contribution_type NOT NULL,
    entity_id UUID NOT NULL,
    entity_type TEXT NOT NULL,

    -- Quality assessment
    quality_score INTEGER DEFAULT 50 CHECK (quality_score >= 0 AND quality_score <= 100),
    verified BOOLEAN DEFAULT FALSE,
    verified_by UUID REFERENCES auth.users(id),
    verified_at TIMESTAMPTZ,

    -- Contribution value
    points_awarded INTEGER DEFAULT 0,
    bonus_multiplier DECIMAL(3,2) DEFAULT 1.0,

    -- Content metadata
    metadata JSONB DEFAULT '{}',

    created_at TIMESTAMPTZ DEFAULT NOW(),

    -- Ensure one contribution per user per entity
    UNIQUE(user_id, entity_id, contribution_type)
);

-- User reviews/ratings from other users
CREATE TABLE IF NOT EXISTS user_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reviewer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    reviewed_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    review_text TEXT,
    category TEXT, -- 'knowledge', 'helpfulness', 'accuracy', 'professionalism'

    -- Context of interaction
    interaction_type TEXT, -- 'vehicle_transaction', 'shop_service', 'information_exchange'
    entity_id UUID, -- Related vehicle, shop, etc.

    created_at TIMESTAMPTZ DEFAULT NOW(),

    -- Prevent duplicate reviews
    UNIQUE(reviewer_id, reviewed_user_id, interaction_type, entity_id)
);

-- Verification requests - users can request verification
CREATE TABLE IF NOT EXISTS verification_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    verification_type verification_level NOT NULL,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),

    -- Supporting documents
    documents JSONB DEFAULT '{}', -- URLs to uploaded documents
    submission_data JSONB DEFAULT '{}',

    -- Review process
    reviewed_by UUID REFERENCES auth.users(id),
    reviewed_at TIMESTAMPTZ,
    review_notes TEXT,
    rejection_reason TEXT,

    -- Expiration for time-sensitive verifications
    expires_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Badge definitions - achievements users can unlock
CREATE TABLE IF NOT EXISTS badges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT UNIQUE NOT NULL,
    description TEXT,
    icon TEXT, -- emoji or icon identifier
    category TEXT, -- 'contribution', 'expertise', 'community', 'verification'

    -- Requirements to earn badge
    requirements JSONB NOT NULL, -- JSON describing how to earn this badge
    points_value INTEGER DEFAULT 0,

    -- Badge rarity/difficulty
    rarity TEXT DEFAULT 'common' CHECK (rarity IN ('common', 'uncommon', 'rare', 'epic', 'legendary')),

    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- User badges earned
CREATE TABLE IF NOT EXISTS user_badges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    badge_id UUID NOT NULL REFERENCES badges(id) ON DELETE CASCADE,
    earned_at TIMESTAMPTZ DEFAULT NOW(),

    -- Context of earning
    trigger_entity_id UUID,
    trigger_entity_type TEXT,

    -- Display preferences
    is_displayed BOOLEAN DEFAULT TRUE,
    display_order INTEGER DEFAULT 0,

    UNIQUE(user_id, badge_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_ratings_verification ON user_ratings(verification_level);
CREATE INDEX IF NOT EXISTS idx_user_ratings_trust_level ON user_ratings(trust_level);
CREATE INDEX IF NOT EXISTS idx_user_ratings_reputation ON user_ratings(reputation_points DESC);

CREATE INDEX IF NOT EXISTS idx_user_contributions_user ON user_contributions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_contributions_type ON user_contributions(contribution_type);
CREATE INDEX IF NOT EXISTS idx_user_contributions_entity ON user_contributions(entity_id, entity_type);
CREATE INDEX IF NOT EXISTS idx_user_contributions_quality ON user_contributions(quality_score DESC);

CREATE INDEX IF NOT EXISTS idx_user_reviews_reviewed ON user_reviews(reviewed_user_id);
CREATE INDEX IF NOT EXISTS idx_user_reviews_reviewer ON user_reviews(reviewer_id);
CREATE INDEX IF NOT EXISTS idx_user_reviews_rating ON user_reviews(rating);

CREATE INDEX IF NOT EXISTS idx_verification_requests_status ON verification_requests(status);
CREATE INDEX IF NOT EXISTS idx_verification_requests_type ON verification_requests(verification_type);

CREATE INDEX IF NOT EXISTS idx_user_badges_user ON user_badges(user_id);
CREATE INDEX IF NOT EXISTS idx_user_badges_display ON user_badges(user_id, is_displayed, display_order);

-- Functions for reputation calculation
CREATE OR REPLACE FUNCTION calculate_user_reputation(target_user_id UUID)
RETURNS INTEGER AS $$
DECLARE
    total_points INTEGER := 0;
    contribution_points INTEGER := 0;
    review_points INTEGER := 0;
    verification_bonus INTEGER := 0;
BEGIN
    -- Points from contributions
    SELECT COALESCE(SUM(points_awarded * bonus_multiplier), 0) INTO contribution_points
    FROM user_contributions
    WHERE user_id = target_user_id AND verified = true;

    -- Points from user reviews (average rating * 20)
    SELECT COALESCE(AVG(rating) * 20, 0) INTO review_points
    FROM user_reviews
    WHERE reviewed_user_id = target_user_id;

    -- Verification level bonus
    SELECT CASE
        WHEN verification_level = 'expert_verified' THEN 500
        WHEN verification_level = 'business_verified' THEN 300
        WHEN verification_level = 'phone_verified' THEN 100
        WHEN verification_level = 'email_verified' THEN 50
        ELSE 0
    END INTO verification_bonus
    FROM user_ratings
    WHERE user_id = target_user_id;

    total_points := contribution_points + review_points + verification_bonus;

    -- Update the user's reputation
    UPDATE user_ratings
    SET reputation_points = total_points,
        updated_at = NOW()
    WHERE user_id = target_user_id;

    RETURN total_points;
END;
$$ LANGUAGE plpgsql;

-- Function to award contribution points
CREATE OR REPLACE FUNCTION award_contribution_points(
    target_user_id UUID,
    contrib_type contribution_type,
    entity_id UUID,
    entity_type TEXT,
    base_points INTEGER DEFAULT 10
)
RETURNS VOID AS $$
DECLARE
    quality_multiplier DECIMAL := 1.0;
    trust_multiplier DECIMAL := 1.0;
BEGIN
    -- Get user's trust level for multiplier
    SELECT CASE
        WHEN trust_level >= 8 THEN 1.5
        WHEN trust_level >= 5 THEN 1.2
        ELSE 1.0
    END INTO trust_multiplier
    FROM user_ratings
    WHERE user_id = target_user_id;

    -- Insert contribution record
    INSERT INTO user_contributions (
        user_id,
        contribution_type,
        entity_id,
        entity_type,
        points_awarded,
        bonus_multiplier
    ) VALUES (
        target_user_id,
        contrib_type,
        entity_id,
        entity_type,
        base_points,
        trust_multiplier
    ) ON CONFLICT (user_id, entity_id, contribution_type) DO NOTHING;

    -- Update user stats
    UPDATE user_ratings
    SET
        vehicle_contributions = CASE WHEN contrib_type = 'vehicle_add' THEN vehicle_contributions + 1 ELSE vehicle_contributions END,
        image_contributions = CASE WHEN contrib_type = 'image_upload' THEN image_contributions + 1 ELSE image_contributions END,
        timeline_contributions = CASE WHEN contrib_type = 'timeline_event' THEN timeline_contributions + 1 ELSE timeline_contributions END,
        verification_contributions = CASE WHEN contrib_type = 'verification' THEN verification_contributions + 1 ELSE verification_contributions END,
        contribution_score = contribution_score + 1,
        last_activity_at = NOW(),
        updated_at = NOW()
    WHERE user_id = target_user_id;

    -- Recalculate reputation
    PERFORM calculate_user_reputation(target_user_id);
END;
$$ LANGUAGE plpgsql;

-- Trigger to create user rating record when user signs up
CREATE OR REPLACE FUNCTION create_user_rating_on_signup()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO user_ratings (user_id, created_at)
    VALUES (NEW.id, NOW())
    ON CONFLICT (user_id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger if it doesn't exist
DO $$ BEGIN
    CREATE TRIGGER trigger_create_user_rating
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION create_user_rating_on_signup();
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- RLS Policies
ALTER TABLE user_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_contributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_badges ENABLE ROW LEVEL SECURITY;

-- User ratings are publicly viewable
CREATE POLICY "User ratings are publicly viewable" ON user_ratings FOR SELECT USING (true);
CREATE POLICY "Users can update their own ratings" ON user_ratings FOR UPDATE USING (auth.uid() = user_id);

-- Contributions are publicly viewable
CREATE POLICY "Contributions are publicly viewable" ON user_contributions FOR SELECT USING (true);

-- Reviews are publicly viewable
CREATE POLICY "Reviews are publicly viewable" ON user_reviews FOR SELECT USING (true);
CREATE POLICY "Users can create reviews" ON user_reviews FOR INSERT WITH CHECK (auth.uid() = reviewer_id);

-- Verification requests - users can manage their own
CREATE POLICY "Users can manage their verification requests" ON verification_requests
FOR ALL USING (auth.uid() = user_id OR auth.uid() IN (SELECT id FROM auth.users WHERE email LIKE '%admin%'));

-- User badges are publicly viewable
CREATE POLICY "User badges are publicly viewable" ON user_badges FOR SELECT USING (true);

-- Insert some initial badges
INSERT INTO badges (name, description, icon, category, requirements, points_value, rarity) VALUES
('First Contributor', 'Added your first vehicle to the platform', '🚗', 'contribution', '{"vehicles_added": 1}', 50, 'common'),
('Photography Enthusiast', 'Uploaded 10+ high-quality vehicle images', '📸', 'contribution', '{"images_uploaded": 10, "min_quality_score": 70}', 100, 'uncommon'),
('Community Helper', 'Received 5+ helpful reviews from other users', '🤝', 'community', '{"avg_rating": 4.0, "review_count": 5}', 150, 'uncommon'),
('Verified Professional', 'Business verification completed', '✅', 'verification', '{"verification_level": "business_verified"}', 300, 'rare'),
('Data Detective', 'Contributed 100+ timeline events', '🔍', 'contribution', '{"timeline_events": 100}', 250, 'rare'),
('Master Contributor', 'Achieved trust level 8+', '👑', 'expertise', '{"trust_level": 8}', 500, 'epic')
ON CONFLICT (name) DO NOTHING;

COMMIT;