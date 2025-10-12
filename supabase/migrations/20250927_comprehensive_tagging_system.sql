-- Migration: Comprehensive Tagging System
-- Extends existing vehicle_images table with spatial tagging capabilities
-- Adds brand tracking and multi-level verification for corporate data harvesting

-- =====================================================================================
-- PHASE 1: SPATIAL TAGGING SYSTEM (Extends existing vehicle_images)
-- =====================================================================================

-- Add spatial tagging to existing vehicle_images table
ALTER TABLE vehicle_images ADD COLUMN IF NOT EXISTS spatial_tags JSONB DEFAULT '[]';

-- Create index for efficient spatial tag queries
CREATE INDEX IF NOT EXISTS idx_vehicle_images_spatial_tags ON vehicle_images USING gin(spatial_tags);

-- Spatial tag structure stored in JSONB:
-- [{
--   "id": "uuid-string",
--   "x": 45.2, "y": 67.8,  -- Percentage coordinates
--   "type": "person|location|product|damage|modification",
--   "text": "User description",
--   "data": {
--     "user_id": "uuid",         -- For person tags
--     "brand": "Snap-on",        -- For product tags
--     "serial": "12345",         -- For product tags
--     "model": "EPIQ 68",        -- For product tags
--     "location_name": "Bob's Auto Shop", -- For location tags
--     "lat": 40.7128, "lng": -74.0060,   -- For location tags
--     "damage_severity": "minor|moderate|severe", -- For damage tags
--     "part_affected": "engine|transmission|body"  -- For damage tags
--   },
--   "verification_status": "pending|user_verified|auto_verified|peer_verified|professional_verified|brand_verified",
--   "trust_score": 0,          -- 0-100 confidence score
--   "created_by": "uuid",      -- User who created tag
--   "created_at": "2025-01-01T00:00:00Z",
--   "verified_by": ["uuid1", "uuid2"], -- Users who verified tag
--   "disputed_by": ["uuid3"]   -- Users who disputed tag
-- }]

COMMENT ON COLUMN vehicle_images.spatial_tags IS 'JSONB array storing spatial tags with coordinates, types, verification status, and metadata';

-- =====================================================================================
-- PHASE 2: BRAND TRACKING & CORPORATE CLAIMING SYSTEM
-- =====================================================================================

-- Brands master table for corporate entities
CREATE TABLE IF NOT EXISTS brands (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    slug TEXT NOT NULL UNIQUE, -- URL-friendly version
    industry TEXT NOT NULL, -- 'automotive', 'tools', 'welding', 'parts', 'fluids'
    category TEXT, -- 'manufacturer', 'retailer', 'service_provider'
    description TEXT,
    logo_url TEXT,
    website_url TEXT,

    -- Corporate verification
    verification_status TEXT DEFAULT 'pending' CHECK (verification_status IN ('pending', 'verified', 'disputed')),
    verification_contact TEXT, -- Email for brand representatives
    verification_documents TEXT[], -- URLs to verification docs

    -- Claiming information
    claimed_at TIMESTAMPTZ,
    claimed_by UUID REFERENCES auth.users(id),
    claim_notes TEXT,

    -- Analytics
    total_tags INTEGER DEFAULT 0,
    total_verified_tags INTEGER DEFAULT 0,
    first_tagged_at TIMESTAMPTZ,
    last_tagged_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Brand aliases for flexible matching
CREATE TABLE IF NOT EXISTS brand_aliases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
    alias_name TEXT NOT NULL,
    alias_type TEXT DEFAULT 'common' CHECK (alias_type IN ('common', 'misspelling', 'abbreviation', 'legacy')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(brand_id, alias_name)
);

-- Brand tag associations (links brands to specific spatial tags)
CREATE TABLE IF NOT EXISTS brand_tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
    image_id UUID NOT NULL REFERENCES vehicle_images(id) ON DELETE CASCADE,
    spatial_tag_id TEXT NOT NULL, -- Points to ID in spatial_tags JSONB

    -- Tag classification
    tag_type TEXT NOT NULL CHECK (tag_type IN ('product', 'service', 'location', 'sponsorship')),
    confidence_score INTEGER DEFAULT 0 CHECK (confidence_score >= 0 AND confidence_score <= 100),

    -- Auto-tagging information
    detected_method TEXT, -- 'user_input', 'ai_recognition', 'serial_lookup', 'gps_location'
    detection_confidence INTEGER DEFAULT 0,
    detection_metadata JSONB DEFAULT '{}',

    -- Verification
    verification_status TEXT DEFAULT 'pending' CHECK (verification_status IN ('pending', 'verified', 'disputed', 'rejected')),
    verified_at TIMESTAMPTZ,
    verified_by UUID REFERENCES auth.users(id),

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(image_id, spatial_tag_id, brand_id)
);

-- =====================================================================================
-- PHASE 3: MULTI-LEVEL VERIFICATION SYSTEM
-- =====================================================================================

-- Tag verifications - tracks who verified/disputed each tag
CREATE TABLE IF NOT EXISTS tag_verifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    image_id UUID NOT NULL REFERENCES vehicle_images(id) ON DELETE CASCADE,
    spatial_tag_id TEXT NOT NULL, -- Points to ID in spatial_tags JSONB

    -- Verifier information
    verifier_user_id UUID REFERENCES auth.users(id),
    verifier_type TEXT NOT NULL CHECK (verifier_type IN ('owner', 'peer', 'professional', 'brand_representative', 'ai_system')),

    -- Verification action
    action TEXT NOT NULL CHECK (action IN ('verify', 'dispute', 'correct', 'flag')),
    verification_data JSONB DEFAULT '{}', -- Additional context, corrections, etc.

    -- Trust scoring
    trust_weight INTEGER DEFAULT 1, -- How much this verification counts (professionals = higher weight)
    trust_score_impact INTEGER DEFAULT 0, -- How much this changed the tag's trust score

    -- Professional verification details
    professional_title TEXT, -- 'ASE Certified Mechanic', 'Snap-on Dealer', etc.
    professional_credentials TEXT[],
    organization TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- User expertise tracking (for weighted verification)
CREATE TABLE IF NOT EXISTS user_expertise (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    -- Expertise areas
    expertise_type TEXT NOT NULL CHECK (expertise_type IN ('automotive', 'tools', 'parts', 'damage_assessment', 'restoration')),
    expertise_level TEXT DEFAULT 'novice' CHECK (expertise_level IN ('novice', 'intermediate', 'expert', 'professional')),

    -- Credentials
    certifications TEXT[],
    years_experience INTEGER DEFAULT 0,
    specializations TEXT[], -- Specific brands, vehicle types, etc.

    -- Performance metrics
    verification_count INTEGER DEFAULT 0,
    accuracy_score DECIMAL(5,2) DEFAULT 0.00, -- Percentage accuracy of past verifications
    trust_rating INTEGER DEFAULT 0 CHECK (trust_rating >= 0 AND trust_rating <= 100),

    -- Professional information
    business_name TEXT,
    business_license TEXT,
    insurance_info TEXT,

    verified_at TIMESTAMPTZ,
    verified_by UUID REFERENCES auth.users(id),

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(user_id, expertise_type)
);

-- =====================================================================================
-- PHASE 4: ANALYTICS & REPORTING TABLES
-- =====================================================================================

-- Tag analytics for trending, popular tags, etc.
CREATE TABLE IF NOT EXISTS tag_analytics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Time period
    date_bucket DATE NOT NULL,
    time_granularity TEXT DEFAULT 'daily' CHECK (time_granularity IN ('hourly', 'daily', 'weekly', 'monthly')),

    -- Aggregated metrics
    total_tags_created INTEGER DEFAULT 0,
    total_tags_verified INTEGER DEFAULT 0,
    total_tags_disputed INTEGER DEFAULT 0,
    unique_users_tagging INTEGER DEFAULT 0,
    unique_images_tagged INTEGER DEFAULT 0,

    -- Top categories
    top_brands JSONB DEFAULT '[]', -- [{"brand": "Chevrolet", "count": 45}, ...]
    top_tag_types JSONB DEFAULT '[]', -- [{"type": "product", "count": 123}, ...]
    top_locations JSONB DEFAULT '[]',

    -- Quality metrics
    average_trust_score DECIMAL(5,2) DEFAULT 0.00,
    verification_rate DECIMAL(5,2) DEFAULT 0.00, -- % of tags that get verified

    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(date_bucket, time_granularity)
);

-- AI training exports log
CREATE TABLE IF NOT EXISTS ai_training_exports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Export details
    export_type TEXT NOT NULL CHECK (export_type IN ('full_dataset', 'incremental', 'brand_specific', 'category_specific')),
    export_format TEXT DEFAULT 'json' CHECK (export_format IN ('json', 'csv', 'parquet', 'tfrecord')),

    -- Filters applied
    date_range_start TIMESTAMPTZ,
    date_range_end TIMESTAMPTZ,
    min_trust_score INTEGER DEFAULT 0,
    brands_included TEXT[],
    tag_types_included TEXT[],
    verification_status_required TEXT,

    -- Export results
    total_records INTEGER DEFAULT 0,
    file_size_bytes BIGINT DEFAULT 0,
    export_url TEXT,
    checksum TEXT,

    -- Metadata
    exported_by UUID REFERENCES auth.users(id),
    export_purpose TEXT, -- 'model_training', 'analytics', 'brand_report', etc.

    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ -- When export files are cleaned up
);

-- =====================================================================================
-- INDEXES FOR PERFORMANCE
-- =====================================================================================

-- Brand tracking indexes
CREATE INDEX IF NOT EXISTS idx_brands_industry ON brands(industry);
CREATE INDEX IF NOT EXISTS idx_brands_claimed ON brands(claimed_at) WHERE claimed_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_brand_aliases_name ON brand_aliases(alias_name);

-- Brand tags indexes
CREATE INDEX IF NOT EXISTS idx_brand_tags_brand ON brand_tags(brand_id);
CREATE INDEX IF NOT EXISTS idx_brand_tags_image ON brand_tags(image_id);
CREATE INDEX IF NOT EXISTS idx_brand_tags_confidence ON brand_tags(confidence_score);
CREATE INDEX IF NOT EXISTS idx_brand_tags_verification ON brand_tags(verification_status);

-- Verification indexes
CREATE INDEX IF NOT EXISTS idx_tag_verifications_image_tag ON tag_verifications(image_id, spatial_tag_id);
CREATE INDEX IF NOT EXISTS idx_tag_verifications_verifier ON tag_verifications(verifier_user_id);
CREATE INDEX IF NOT EXISTS idx_tag_verifications_type ON tag_verifications(verifier_type);

-- User expertise indexes
CREATE INDEX IF NOT EXISTS idx_user_expertise_user ON user_expertise(user_id);
CREATE INDEX IF NOT EXISTS idx_user_expertise_type ON user_expertise(expertise_type);
CREATE INDEX IF NOT EXISTS idx_user_expertise_level ON user_expertise(expertise_level);

-- Analytics indexes
CREATE INDEX IF NOT EXISTS idx_tag_analytics_date ON tag_analytics(date_bucket);
CREATE INDEX IF NOT EXISTS idx_ai_exports_type ON ai_training_exports(export_type);
CREATE INDEX IF NOT EXISTS idx_ai_exports_created ON ai_training_exports(created_at);

-- =====================================================================================
-- ROW LEVEL SECURITY POLICIES
-- =====================================================================================

-- Enable RLS on all new tables
ALTER TABLE brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE brand_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE brand_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE tag_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_expertise ENABLE ROW LEVEL SECURITY;
ALTER TABLE tag_analytics ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_training_exports ENABLE ROW LEVEL SECURITY;

-- Brands - Public read, authenticated write
CREATE POLICY "Brands are publicly viewable" ON brands
    FOR SELECT TO public USING (true);

CREATE POLICY "Authenticated users can create brands" ON brands
    FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Brand owners can update their brands" ON brands
    FOR UPDATE TO authenticated USING (claimed_by = auth.uid());

-- Brand aliases follow brand permissions
CREATE POLICY "Brand aliases are publicly viewable" ON brand_aliases
    FOR SELECT TO public USING (true);

CREATE POLICY "Brand owners can manage aliases" ON brand_aliases
    FOR ALL TO authenticated USING (
        brand_id IN (SELECT id FROM brands WHERE claimed_by = auth.uid())
    );

-- Brand tags - Public read for analytics, authenticated write
CREATE POLICY "Brand tags are publicly viewable" ON brand_tags
    FOR SELECT TO public USING (true);

CREATE POLICY "Authenticated users can create brand tags" ON brand_tags
    FOR INSERT TO authenticated WITH CHECK (true);

-- Verifications - Public read, authenticated write
CREATE POLICY "Tag verifications are publicly viewable" ON tag_verifications
    FOR SELECT TO public USING (true);

CREATE POLICY "Authenticated users can create verifications" ON tag_verifications
    FOR INSERT TO authenticated WITH CHECK (verifier_user_id = auth.uid());

-- User expertise - Users can manage their own
CREATE POLICY "Users can view all expertise profiles" ON user_expertise
    FOR SELECT TO public USING (true);

CREATE POLICY "Users can manage their own expertise" ON user_expertise
    FOR ALL TO authenticated USING (user_id = auth.uid());

-- Analytics - Public read
CREATE POLICY "Tag analytics are publicly viewable" ON tag_analytics
    FOR SELECT TO public USING (true);

-- AI exports - Restricted access
CREATE POLICY "Users can view their own exports" ON ai_training_exports
    FOR SELECT TO authenticated USING (exported_by = auth.uid());

-- =====================================================================================
-- FUNCTIONS & TRIGGERS
-- =====================================================================================

-- Function to update brand statistics when tags are added/verified
CREATE OR REPLACE FUNCTION update_brand_statistics()
RETURNS TRIGGER AS $$
BEGIN
    -- Update brand tag counts
    UPDATE brands SET
        total_tags = (
            SELECT COUNT(*)
            FROM brand_tags
            WHERE brand_id = NEW.brand_id
        ),
        total_verified_tags = (
            SELECT COUNT(*)
            FROM brand_tags
            WHERE brand_id = NEW.brand_id
            AND verification_status = 'verified'
        ),
        last_tagged_at = NOW(),
        first_tagged_at = COALESCE(first_tagged_at, NOW()),
        updated_at = NOW()
    WHERE id = NEW.brand_id;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update brand stats
CREATE TRIGGER trigger_update_brand_statistics
    AFTER INSERT OR UPDATE ON brand_tags
    FOR EACH ROW
    EXECUTE FUNCTION update_brand_statistics();

-- Function to calculate trust score for spatial tags
CREATE OR REPLACE FUNCTION calculate_tag_trust_score(p_image_id UUID, p_spatial_tag_id TEXT)
RETURNS INTEGER AS $$
DECLARE
    base_score INTEGER := 10; -- Base score for any tag
    verification_bonus INTEGER := 0;
    dispute_penalty INTEGER := 0;
    professional_bonus INTEGER := 0;
    final_score INTEGER;
BEGIN
    -- Add points for verifications
    SELECT COALESCE(SUM(
        CASE verifier_type
            WHEN 'professional' THEN 25
            WHEN 'brand_representative' THEN 30
            WHEN 'peer' THEN 10
            WHEN 'owner' THEN 15
            ELSE 5
        END
    ), 0) INTO verification_bonus
    FROM tag_verifications
    WHERE image_id = p_image_id
    AND spatial_tag_id = p_spatial_tag_id
    AND action = 'verify';

    -- Subtract points for disputes
    SELECT COALESCE(COUNT(*) * 10, 0) INTO dispute_penalty
    FROM tag_verifications
    WHERE image_id = p_image_id
    AND spatial_tag_id = p_spatial_tag_id
    AND action = 'dispute';

    -- Calculate final score
    final_score := base_score + verification_bonus - dispute_penalty;

    -- Cap between 0 and 100
    final_score := GREATEST(0, LEAST(100, final_score));

    RETURN final_score;
END;
$$ LANGUAGE plpgsql;

-- Function to generate daily analytics
CREATE OR REPLACE FUNCTION generate_daily_analytics(p_date DATE DEFAULT CURRENT_DATE)
RETURNS VOID AS $$
DECLARE
    tags_created INTEGER;
    tags_verified INTEGER;
    tags_disputed INTEGER;
    unique_users INTEGER;
    unique_images INTEGER;
BEGIN
    -- Get daily metrics
    SELECT
        COUNT(*) FILTER (WHERE created_at::date = p_date),
        COUNT(*) FILTER (WHERE created_at::date = p_date AND verification_status = 'verified'),
        COUNT(*) FILTER (WHERE created_at::date = p_date AND verification_status = 'disputed')
    INTO tags_created, tags_verified, tags_disputed
    FROM brand_tags;

    -- Count unique users and images for the day
    SELECT COUNT(DISTINCT verifier_user_id), COUNT(DISTINCT image_id)
    INTO unique_users, unique_images
    FROM tag_verifications
    WHERE created_at::date = p_date;

    -- Insert or update analytics record
    INSERT INTO tag_analytics (
        date_bucket,
        total_tags_created,
        total_tags_verified,
        total_tags_disputed,
        unique_users_tagging,
        unique_images_tagged
    ) VALUES (
        p_date,
        tags_created,
        tags_verified,
        tags_disputed,
        unique_users,
        unique_images
    )
    ON CONFLICT (date_bucket, time_granularity)
    DO UPDATE SET
        total_tags_created = EXCLUDED.total_tags_created,
        total_tags_verified = EXCLUDED.total_tags_verified,
        total_tags_disputed = EXCLUDED.total_tags_disputed,
        unique_users_tagging = EXCLUDED.unique_users_tagging,
        unique_images_tagged = EXCLUDED.unique_images_tagged;

END;
$$ LANGUAGE plpgsql;

-- =====================================================================================
-- SEED DATA - INITIAL BRANDS
-- =====================================================================================

-- Insert major automotive brands
INSERT INTO brands (name, slug, industry, category, description) VALUES
-- Automotive Manufacturers
('Chevrolet', 'chevrolet', 'automotive', 'manufacturer', 'American automobile division of General Motors'),
('Ford', 'ford', 'automotive', 'manufacturer', 'American multinational automaker'),
('Toyota', 'toyota', 'automotive', 'manufacturer', 'Japanese multinational automotive manufacturer'),
('Honda', 'honda', 'automotive', 'manufacturer', 'Japanese public multinational conglomerate manufacturer'),
('BMW', 'bmw', 'automotive', 'manufacturer', 'German multinational corporation producing luxury vehicles'),
('Mercedes-Benz', 'mercedes-benz', 'automotive', 'manufacturer', 'German luxury automotive marque'),
('Audi', 'audi', 'automotive', 'manufacturer', 'German luxury automotive marque'),
('Volkswagen', 'volkswagen', 'automotive', 'manufacturer', 'German motor vehicle manufacturer'),
('Nissan', 'nissan', 'automotive', 'manufacturer', 'Japanese multinational automobile manufacturer'),
('Hyundai', 'hyundai', 'automotive', 'manufacturer', 'South Korean multinational automotive manufacturer'),

-- Tool Manufacturers
('Snap-on', 'snap-on', 'tools', 'manufacturer', 'American designer, manufacturer and marketer of high-end tools and equipment'),
('Milwaukee Tool', 'milwaukee-tool', 'tools', 'manufacturer', 'American power tool manufacturer'),
('DeWalt', 'dewalt', 'tools', 'manufacturer', 'American worldwide brand of power tools and hand tools'),
('Craftsman', 'craftsman', 'tools', 'manufacturer', 'American tool brand'),
('Matco Tools', 'matco-tools', 'tools', 'manufacturer', 'American supplier of professional tools'),
('Mac Tools', 'mac-tools', 'tools', 'manufacturer', 'American tool company subsidiary of Stanley Black & Decker'),

-- Welding Equipment
('Miller Electric', 'miller-electric', 'welding', 'manufacturer', 'American welding equipment manufacturer'),
('Lincoln Electric', 'lincoln-electric', 'welding', 'manufacturer', 'American welding company'),
('ESAB', 'esab', 'welding', 'manufacturer', 'Swedish industrial company producing welding and cutting equipment'),

-- Automotive Parts
('Bosch', 'bosch', 'parts', 'manufacturer', 'German multinational engineering and technology company'),
('ACDelco', 'acdelco', 'parts', 'manufacturer', 'American automotive parts brand owned by General Motors'),
('Mobil 1', 'mobil-1', 'fluids', 'manufacturer', 'Brand of synthetic motor oil and other automotive lubrication products')

ON CONFLICT (name) DO NOTHING;

-- Insert brand aliases for common variations
INSERT INTO brand_aliases (brand_id, alias_name, alias_type) VALUES
((SELECT id FROM brands WHERE name = 'Chevrolet'), 'Chevy', 'common'),
((SELECT id FROM brands WHERE name = 'Mercedes-Benz'), 'Mercedes', 'common'),
((SELECT id FROM brands WHERE name = 'Mercedes-Benz'), 'Benz', 'common'),
((SELECT id FROM brands WHERE name = 'Volkswagen'), 'VW', 'abbreviation'),
((SELECT id FROM brands WHERE name = 'BMW'), 'Beemer', 'common'),
((SELECT id FROM brands WHERE name = 'BMW'), 'Bimmer', 'common'),
((SELECT id FROM brands WHERE name = 'Snap-on'), 'Snapon', 'common'),
((SELECT id FROM brands WHERE name = 'Snap-on'), 'Snap On', 'common'),
((SELECT id FROM brands WHERE name = 'Miller Electric'), 'Miller', 'common'),
((SELECT id FROM brands WHERE name = 'Lincoln Electric'), 'Lincoln', 'common')
ON CONFLICT (brand_id, alias_name) DO NOTHING;

-- =====================================================================================
-- COMMENTS & DOCUMENTATION
-- =====================================================================================

COMMENT ON TABLE brands IS 'Master table of brands/companies for corporate claiming and analytics';
COMMENT ON TABLE brand_aliases IS 'Alternative names and spellings for brands to improve matching';
COMMENT ON TABLE brand_tags IS 'Links brands to specific spatial tags in images for corporate analytics';
COMMENT ON TABLE tag_verifications IS 'Multi-level verification system tracking who verified/disputed each tag';
COMMENT ON TABLE user_expertise IS 'User expertise profiles for weighted verification scoring';
COMMENT ON TABLE tag_analytics IS 'Aggregated analytics for trending tags, popular brands, quality metrics';
COMMENT ON TABLE ai_training_exports IS 'Log of AI training dataset exports with filters and metadata';

COMMENT ON FUNCTION calculate_tag_trust_score IS 'Calculates trust score (0-100) for spatial tags based on verifications and disputes';
COMMENT ON FUNCTION generate_daily_analytics IS 'Generates daily analytics aggregations for dashboard reporting';
COMMENT ON FUNCTION update_brand_statistics IS 'Updates brand tag counts and timestamps when brand_tags are modified';