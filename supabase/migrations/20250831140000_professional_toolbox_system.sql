-- Professional Toolbox and Skills Validation System
-- Enables professionals to validate their expertise through tool ownership and certifications

-- Tool categories and classifications
CREATE TABLE tool_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  icon_url TEXT,
  parent_category_id UUID REFERENCES tool_categories(id),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Tool suppliers/manufacturers
CREATE TABLE tool_suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  logo_url TEXT,
  website_url TEXT,
  api_endpoint TEXT, -- For integrations
  integration_type TEXT CHECK (integration_type IN ('api', 'oauth', 'manual', 'planned')),
  is_verified BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Master tool database
CREATE TABLE tools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID REFERENCES tool_suppliers(id),
  category_id UUID REFERENCES tool_categories(id),
  
  -- Tool identification
  name TEXT NOT NULL,
  model_number TEXT,
  part_number TEXT,
  description TEXT,
  image_url TEXT,
  
  -- Pricing and value
  msrp_cents INTEGER, -- Store in cents to avoid decimal issues
  typical_price_range_min_cents INTEGER,
  typical_price_range_max_cents INTEGER,
  
  -- Professional indicators
  professional_grade BOOLEAN DEFAULT false,
  certification_required BOOLEAN DEFAULT false,
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- User's tool inventory
CREATE TABLE user_tools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  tool_id UUID REFERENCES tools(id),
  
  -- Ownership details
  purchase_date DATE,
  purchase_price_cents INTEGER,
  condition TEXT CHECK (condition IN ('new', 'excellent', 'good', 'fair', 'poor')),
  serial_number TEXT,
  
  -- Validation status
  verification_status TEXT DEFAULT 'unverified' CHECK (verification_status IN ('unverified', 'pending', 'verified', 'disputed')),
  verification_method TEXT CHECK (verification_method IN ('supplier_api', 'receipt_upload', 'manual_verification', 'peer_verification')),
  verification_date TIMESTAMP,
  verified_by UUID REFERENCES auth.users(id),
  
  -- Integration data
  supplier_order_id TEXT, -- From supplier integration
  supplier_data JSONB DEFAULT '{}',
  
  -- User notes
  notes TEXT,
  is_public BOOLEAN DEFAULT true,
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  UNIQUE(user_id, tool_id, serial_number)
);

-- Professional skills and certifications
CREATE TABLE skill_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  icon_url TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID REFERENCES skill_categories(id),
  name TEXT NOT NULL,
  description TEXT,
  difficulty_level INTEGER CHECK (difficulty_level >= 1 AND difficulty_level <= 5),
  created_at TIMESTAMP DEFAULT NOW()
);

-- User skills and experience
CREATE TABLE user_skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  skill_id UUID REFERENCES skills(id),
  
  -- Experience level
  proficiency_level INTEGER CHECK (proficiency_level >= 1 AND proficiency_level <= 5),
  years_experience INTEGER,
  
  -- Validation
  is_verified BOOLEAN DEFAULT false,
  verification_method TEXT CHECK (verification_method IN ('certification', 'peer_review', 'work_history', 'self_reported')),
  verification_date TIMESTAMP,
  verified_by UUID REFERENCES auth.users(id),
  
  -- Evidence
  certification_url TEXT,
  evidence_urls TEXT[], -- Array of evidence links
  notes TEXT,
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  UNIQUE(user_id, skill_id)
);

-- Professional certifications
CREATE TABLE certifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  issuing_organization TEXT NOT NULL,
  description TEXT,
  logo_url TEXT,
  website_url TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE user_certifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  certification_id UUID REFERENCES certifications(id),
  
  -- Certification details
  certification_number TEXT,
  issue_date DATE,
  expiration_date DATE,
  
  -- Validation
  is_verified BOOLEAN DEFAULT false,
  verification_url TEXT,
  certificate_image_url TEXT,
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  UNIQUE(user_id, certification_id, certification_number)
);

-- Supplier integrations and connections
CREATE TABLE user_supplier_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  supplier_id UUID REFERENCES tool_suppliers(id),
  
  -- Connection details
  connection_type TEXT CHECK (connection_type IN ('oauth', 'api_key', 'rep_verification', 'manual')),
  connection_status TEXT DEFAULT 'pending' CHECK (connection_status IN ('pending', 'active', 'expired', 'revoked')),
  
  -- Integration data
  external_user_id TEXT, -- User ID in supplier system
  access_token_encrypted TEXT, -- Encrypted access token
  refresh_token_encrypted TEXT,
  token_expires_at TIMESTAMP,
  
  -- Representative information (for rep-based verification)
  rep_name TEXT,
  rep_email TEXT,
  rep_phone TEXT,
  
  -- Sync status
  last_sync_at TIMESTAMP,
  sync_status TEXT DEFAULT 'never' CHECK (sync_status IN ('never', 'success', 'failed', 'partial')),
  sync_error TEXT,
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  UNIQUE(user_id, supplier_id)
);

-- Professional validation scores
CREATE TABLE professional_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  
  -- Score components
  tool_verification_score INTEGER DEFAULT 0,
  skill_verification_score INTEGER DEFAULT 0,
  certification_score INTEGER DEFAULT 0,
  peer_validation_score INTEGER DEFAULT 0,
  work_history_score INTEGER DEFAULT 0,
  
  -- Composite scores
  total_professional_score INTEGER DEFAULT 0,
  credibility_rating TEXT DEFAULT 'unverified' CHECK (credibility_rating IN ('unverified', 'basic', 'verified', 'expert', 'master')),
  
  -- Tool investment value (indicator of professional commitment)
  total_tool_value_cents INTEGER DEFAULT 0,
  verified_tool_value_cents INTEGER DEFAULT 0,
  
  -- Activity indicators
  last_tool_added TIMESTAMP,
  last_skill_updated TIMESTAMP,
  last_verification TIMESTAMP,
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Seed data for common tool categories
INSERT INTO tool_categories (name, description) VALUES
('Hand Tools', 'Basic hand tools like wrenches, screwdrivers, pliers'),
('Power Tools', 'Electric and pneumatic power tools'),
('Diagnostic Equipment', 'Scan tools, multimeters, oscilloscopes'),
('Specialty Tools', 'Vehicle-specific and specialized tools'),
('Lifting Equipment', 'Jacks, lifts, hoists'),
('Measuring Tools', 'Calipers, micrometers, gauges'),
('Cutting Tools', 'Saws, grinders, cutting wheels'),
('Welding Equipment', 'Welders, torches, safety equipment');

-- Seed data for major tool suppliers
INSERT INTO tool_suppliers (name, website_url, integration_type) VALUES
('Snap-on', 'https://www.snapon.com', 'planned'),
('Mac Tools', 'https://www.mactools.com', 'planned'),
('Matco Tools', 'https://www.matcotools.com', 'planned'),
('Cornwell Tools', 'https://www.cornwelltools.com', 'planned'),
('Milwaukee Tool', 'https://www.milwaukeetool.com', 'planned'),
('DeWalt', 'https://www.dewalt.com', 'planned'),
('Fluke', 'https://www.fluke.com', 'planned'),
('OTC Tools', 'https://www.otctools.com', 'planned');

-- Seed data for skill categories
INSERT INTO skill_categories (name, description) VALUES
('Engine Repair', 'Internal combustion engine diagnosis and repair'),
('Transmission', 'Manual and automatic transmission service'),
('Electrical Systems', 'Automotive electrical diagnosis and repair'),
('HVAC Systems', 'Heating, ventilation, and air conditioning'),
('Brake Systems', 'Brake service and repair'),
('Suspension & Steering', 'Chassis and steering system work'),
('Bodywork', 'Body repair, painting, and refinishing'),
('Diagnostics', 'Computer diagnostics and troubleshooting');

-- Functions for professional score calculation
CREATE OR REPLACE FUNCTION calculate_professional_score(user_uuid UUID)
RETURNS INTEGER AS $$
DECLARE
  tool_score INTEGER := 0;
  skill_score INTEGER := 0;
  cert_score INTEGER := 0;
  total_score INTEGER := 0;
  tool_value INTEGER := 0;
BEGIN
  -- Calculate tool verification score (0-300 points)
  SELECT 
    COALESCE(COUNT(*) * 5, 0) + 
    COALESCE(SUM(CASE WHEN verification_status = 'verified' THEN 15 ELSE 0 END), 0)
  INTO tool_score
  FROM user_tools 
  WHERE user_id = user_uuid;
  
  -- Cap tool score at 300
  tool_score := LEAST(tool_score, 300);
  
  -- Calculate verified tool value
  SELECT COALESCE(SUM(
    CASE 
      WHEN ut.verification_status = 'verified' AND t.msrp_cents IS NOT NULL 
      THEN t.msrp_cents 
      ELSE 0 
    END
  ), 0)
  INTO tool_value
  FROM user_tools ut
  JOIN tools t ON ut.tool_id = t.id
  WHERE ut.user_id = user_uuid;
  
  -- Calculate skill score (0-200 points)
  SELECT COALESCE(SUM(
    CASE 
      WHEN is_verified THEN proficiency_level * 15
      ELSE proficiency_level * 5
    END
  ), 0)
  INTO skill_score
  FROM user_skills
  WHERE user_id = user_uuid;
  
  -- Cap skill score at 200
  skill_score := LEAST(skill_score, 200);
  
  -- Calculate certification score (0-100 points)
  SELECT COALESCE(COUNT(*) * 25, 0)
  INTO cert_score
  FROM user_certifications
  WHERE user_id = user_uuid 
    AND is_verified = true
    AND (expiration_date IS NULL OR expiration_date > CURRENT_DATE);
  
  -- Cap certification score at 100
  cert_score := LEAST(cert_score, 100);
  
  total_score := tool_score + skill_score + cert_score;
  
  -- Update professional scores table
  INSERT INTO professional_scores (
    user_id, tool_verification_score, skill_verification_score, 
    certification_score, total_professional_score, verified_tool_value_cents
  ) VALUES (
    user_uuid, tool_score, skill_score, cert_score, total_score, tool_value
  ) ON CONFLICT (user_id) DO UPDATE SET
    tool_verification_score = EXCLUDED.tool_verification_score,
    skill_verification_score = EXCLUDED.skill_verification_score,
    certification_score = EXCLUDED.certification_score,
    total_professional_score = EXCLUDED.total_professional_score,
    verified_tool_value_cents = EXCLUDED.verified_tool_value_cents,
    credibility_rating = CASE
      WHEN EXCLUDED.total_professional_score >= 400 THEN 'master'
      WHEN EXCLUDED.total_professional_score >= 300 THEN 'expert'
      WHEN EXCLUDED.total_professional_score >= 150 THEN 'verified'
      WHEN EXCLUDED.total_professional_score >= 50 THEN 'basic'
      ELSE 'unverified'
    END,
    updated_at = NOW();
  
  RETURN total_score;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update professional scores when tools/skills change
CREATE OR REPLACE FUNCTION update_professional_score_trigger()
RETURNS TRIGGER AS $$
DECLARE
  user_uuid UUID;
BEGIN
  -- Get user_id from the changed record
  IF TG_OP = 'DELETE' THEN
    user_uuid := OLD.user_id;
  ELSE
    user_uuid := NEW.user_id;
  END IF;
  
  -- Recalculate professional score
  PERFORM calculate_professional_score(user_uuid);
  
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for automatic score updates
CREATE TRIGGER user_tools_score_trigger
  AFTER INSERT OR UPDATE OR DELETE ON user_tools
  FOR EACH ROW
  EXECUTE FUNCTION update_professional_score_trigger();

CREATE TRIGGER user_skills_score_trigger
  AFTER INSERT OR UPDATE OR DELETE ON user_skills
  FOR EACH ROW
  EXECUTE FUNCTION update_professional_score_trigger();

CREATE TRIGGER user_certifications_score_trigger
  AFTER INSERT OR UPDATE OR DELETE ON user_certifications
  FOR EACH ROW
  EXECUTE FUNCTION update_professional_score_trigger();

-- Enable RLS on all tables
ALTER TABLE tool_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE tool_suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE tools ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_tools ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE certifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_certifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_supplier_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE professional_scores ENABLE ROW LEVEL SECURITY;

-- RLS Policies

-- Public read access for reference data
CREATE POLICY "Anyone can view tool categories" ON tool_categories FOR SELECT USING (true);
CREATE POLICY "Anyone can view tool suppliers" ON tool_suppliers FOR SELECT USING (true);
CREATE POLICY "Anyone can view tools" ON tools FOR SELECT USING (true);
CREATE POLICY "Anyone can view skill categories" ON skill_categories FOR SELECT USING (true);
CREATE POLICY "Anyone can view skills" ON skills FOR SELECT USING (true);
CREATE POLICY "Anyone can view certifications" ON certifications FOR SELECT USING (true);

-- User data - own data + public profiles
CREATE POLICY "Users can manage own tools" ON user_tools 
  FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Anyone can view public tools" ON user_tools 
  FOR SELECT USING (is_public = true);

CREATE POLICY "Users can manage own skills" ON user_skills 
  FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Anyone can view user skills" ON user_skills 
  FOR SELECT USING (true);

CREATE POLICY "Users can manage own certifications" ON user_certifications 
  FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Anyone can view user certifications" ON user_certifications 
  FOR SELECT USING (true);

CREATE POLICY "Users can manage own supplier connections" ON user_supplier_connections 
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Anyone can view professional scores" ON professional_scores 
  FOR SELECT USING (true);
CREATE POLICY "System can update professional scores" ON professional_scores 
  FOR ALL USING (true);

-- Create indexes for performance
CREATE INDEX idx_user_tools_user_id ON user_tools(user_id);
CREATE INDEX idx_user_tools_verification ON user_tools(verification_status);
CREATE INDEX idx_user_skills_user_id ON user_skills(user_id);
CREATE INDEX idx_user_certifications_user_id ON user_certifications(user_id);
CREATE INDEX idx_professional_scores_rating ON professional_scores(credibility_rating);
CREATE INDEX idx_professional_scores_total_score ON professional_scores(total_professional_score DESC);

-- Comments for documentation
COMMENT ON TABLE user_tools IS 'User-owned tools with verification status and supplier integration data';
COMMENT ON TABLE user_skills IS 'User skills and experience levels with verification';
COMMENT ON TABLE professional_scores IS 'Calculated professional credibility scores based on tools, skills, and certifications';
COMMENT ON TABLE user_supplier_connections IS 'Connections to tool suppliers for automated tool verification';
