-- Clean up existing tables and recreate professional tools inventory system

-- Drop existing indexes if they exist
DROP INDEX IF EXISTS idx_user_tools_user_id CASCADE;
DROP INDEX IF EXISTS idx_user_tools_category CASCADE;
DROP INDEX IF EXISTS idx_user_tools_supplier CASCADE;
DROP INDEX IF EXISTS idx_tool_supplier_accounts_user CASCADE;
DROP INDEX IF EXISTS idx_tool_verification_tool CASCADE;
DROP INDEX IF EXISTS idx_user_tool_skills_user CASCADE;

-- Drop existing tables in correct order
DROP TABLE IF EXISTS tool_verification CASCADE;
DROP TABLE IF EXISTS user_tool_skills CASCADE;
DROP TABLE IF EXISTS tool_supplier_accounts CASCADE;
DROP TABLE IF EXISTS user_tools CASCADE;
DROP TABLE IF EXISTS tool_categories CASCADE;
DROP TABLE IF EXISTS tool_suppliers CASCADE;

-- Now run the original migration
-- Tool categories (based on professional automotive segments)
CREATE TABLE IF NOT EXISTS tool_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    parent_category_id UUID REFERENCES tool_categories(id),
    icon TEXT,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tool suppliers/manufacturers
CREATE TABLE IF NOT EXISTS tool_suppliers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    logo_url TEXT,
    website TEXT,
    integration_available BOOLEAN DEFAULT FALSE,
    api_endpoint TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- User's professional tools inventory
CREATE TABLE IF NOT EXISTS user_tools (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    category_id UUID REFERENCES tool_categories(id),
    supplier_id UUID REFERENCES tool_suppliers(id),
    
    -- Tool identification
    name TEXT NOT NULL,
    model_number TEXT,
    serial_number TEXT,
    
    -- Tool details
    description TEXT,
    purchase_date DATE,
    purchase_price DECIMAL(10, 2),
    current_value DECIMAL(10, 2),
    condition TEXT CHECK (condition IN ('new', 'excellent', 'good', 'fair', 'poor')),
    
    -- Verification
    is_verified BOOLEAN DEFAULT FALSE,
    verification_source TEXT, -- 'supplier_api', 'manual', 'receipt_upload'
    verification_date TIMESTAMPTZ,
    
    -- Media
    image_url TEXT,
    receipt_url TEXT,
    
    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(user_id, serial_number, supplier_id)
);

-- Supplier account connections (for automatic tool import)
CREATE TABLE IF NOT EXISTS tool_supplier_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    supplier_id UUID NOT NULL REFERENCES tool_suppliers(id),
    
    -- Connection details
    account_identifier TEXT, -- Could be account number, email, etc.
    is_connected BOOLEAN DEFAULT FALSE,
    connection_token TEXT, -- Encrypted OAuth token or API key
    
    -- Sync status
    last_sync_at TIMESTAMPTZ,
    sync_status TEXT,
    tools_imported INTEGER DEFAULT 0,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(user_id, supplier_id)
);

-- Skills derived from tool ownership
CREATE TABLE IF NOT EXISTS user_tool_skills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    skill_name TEXT NOT NULL,
    skill_level INTEGER DEFAULT 1 CHECK (skill_level BETWEEN 1 AND 10),
    
    -- Evidence
    tools_owned_count INTEGER DEFAULT 0,
    tools_value_total DECIMAL(10, 2) DEFAULT 0,
    years_experience INTEGER DEFAULT 0,
    
    -- Verification
    is_verified BOOLEAN DEFAULT FALSE,
    verified_by UUID REFERENCES profiles(id),
    verification_date TIMESTAMPTZ,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(user_id, skill_name)
);

-- Tool verification by other professionals
CREATE TABLE IF NOT EXISTS tool_verification (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tool_id UUID NOT NULL REFERENCES user_tools(id) ON DELETE CASCADE,
    verifier_id UUID NOT NULL REFERENCES profiles(id),
    
    verification_type TEXT CHECK (verification_type IN ('ownership', 'condition', 'value', 'authenticity')),
    is_verified BOOLEAN DEFAULT TRUE,
    notes TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(tool_id, verifier_id, verification_type)
);

-- Insert standard tool categories
INSERT INTO tool_categories (name, description, sort_order) VALUES
    ('Hand Tools', 'Basic hand tools for general automotive work', 1),
    ('Power Tools', 'Electric and pneumatic power tools', 2),
    ('Diagnostic Equipment', 'Scanners, meters, and diagnostic tools', 3),
    ('Specialty Tools', 'Make/model specific and specialized tools', 4),
    ('Shop Equipment', 'Lifts, jacks, and shop infrastructure', 5),
    ('Welding & Fabrication', 'Welding equipment and metal fabrication tools', 6),
    ('Measurement Tools', 'Precision measurement and alignment tools', 7),
    ('Safety Equipment', 'Personal protective equipment and safety tools', 8)
ON CONFLICT (name) DO NOTHING;

-- Insert major tool suppliers
INSERT INTO tool_suppliers (name, website, integration_available) VALUES
    ('Snap-on', 'https://www.snapon.com', true),
    ('Mac Tools', 'https://www.mactools.com', true),
    ('Matco Tools', 'https://www.matcotools.com', true),
    ('Cornwell Tools', 'https://www.cornwelltools.com', false),
    ('Milwaukee Tool', 'https://www.milwaukeetool.com', false),
    ('DeWalt', 'https://www.dewalt.com', false),
    ('Fluke', 'https://www.fluke.com', false),
    ('OTC Tools', 'https://www.otctools.com', false),
    ('Hunter Engineering', 'https://www.hunter.com', false),
    ('Launch Tech', 'https://www.launchtechusa.com', false)
ON CONFLICT (name) DO NOTHING;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_tools_user_id ON user_tools(user_id);
CREATE INDEX IF NOT EXISTS idx_user_tools_category ON user_tools(category_id);
CREATE INDEX IF NOT EXISTS idx_user_tools_supplier ON user_tools(supplier_id);
CREATE INDEX IF NOT EXISTS idx_tool_supplier_accounts_user ON tool_supplier_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_tool_verification_tool ON tool_verification(tool_id);
CREATE INDEX IF NOT EXISTS idx_user_tool_skills_user ON user_tool_skills(user_id);

-- Enable RLS
ALTER TABLE user_tools ENABLE ROW LEVEL SECURITY;
ALTER TABLE tool_supplier_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_tool_skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE tool_verification ENABLE ROW LEVEL SECURITY;

-- RLS Policies for user_tools
CREATE POLICY "Users can view their own tools" ON user_tools
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own tools" ON user_tools
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own tools" ON user_tools
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own tools" ON user_tools
    FOR DELETE USING (auth.uid() = user_id);

-- Public can view verified tools (for professional profiles)
CREATE POLICY "Public can view verified tools" ON user_tools
    FOR SELECT USING (is_verified = true);

-- RLS for tool_supplier_accounts
CREATE POLICY "Users manage their supplier accounts" ON tool_supplier_accounts
    FOR ALL USING (auth.uid() = user_id);

-- RLS for user_tool_skills
CREATE POLICY "Anyone can view skills" ON user_tool_skills
    FOR SELECT USING (true);

CREATE POLICY "Users manage their skills" ON user_tool_skills
    FOR ALL USING (auth.uid() = user_id);

-- RLS for tool_verification
CREATE POLICY "Anyone can view verifications" ON tool_verification
    FOR SELECT USING (true);

CREATE POLICY "Authenticated users can verify" ON tool_verification
    FOR INSERT WITH CHECK (auth.uid() = verifier_id);

-- Function to calculate skill level from tools
CREATE OR REPLACE FUNCTION calculate_tool_skill_level(
    p_user_id UUID,
    p_category TEXT
) RETURNS INTEGER AS $$
DECLARE
    v_tool_count INTEGER;
    v_tool_value DECIMAL;
    v_skill_level INTEGER;
BEGIN
    SELECT 
        COUNT(*),
        COALESCE(SUM(current_value), 0)
    INTO v_tool_count, v_tool_value
    FROM user_tools ut
    JOIN tool_categories tc ON ut.category_id = tc.id
    WHERE ut.user_id = p_user_id
    AND tc.name = p_category
    AND ut.is_verified = true;
    
    -- Calculate skill level based on tools owned and value
    v_skill_level := LEAST(10, GREATEST(1,
        CASE
            WHEN v_tool_count >= 50 AND v_tool_value >= 50000 THEN 10
            WHEN v_tool_count >= 30 AND v_tool_value >= 30000 THEN 8
            WHEN v_tool_count >= 20 AND v_tool_value >= 20000 THEN 6
            WHEN v_tool_count >= 10 AND v_tool_value >= 10000 THEN 4
            WHEN v_tool_count >= 5 THEN 2
            ELSE 1
        END
    ));
    
    RETURN v_skill_level;
END;
$$ LANGUAGE plpgsql;

-- Grant necessary permissions
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;

GRANT SELECT ON tool_categories TO anon;
GRANT SELECT ON tool_suppliers TO anon;
GRANT ALL ON user_tools TO authenticated;
GRANT ALL ON tool_supplier_accounts TO authenticated;
GRANT ALL ON user_tool_skills TO authenticated;
GRANT ALL ON tool_verification TO authenticated;
