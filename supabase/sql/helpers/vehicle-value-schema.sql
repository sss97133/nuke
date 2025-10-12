-- Extended Vehicle Value Assessment Schema
-- Captures comprehensive value indicators extracted from AI analysis

-- Extend vehicles table with value assessment fields
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS generation TEXT;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS doors INTEGER;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS drivetrain TEXT;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS cab_config TEXT;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS bed_type TEXT;

-- Vehicle Condition Indicators (critical for value)
CREATE TABLE IF NOT EXISTS vehicle_condition_indicators (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  rust_severity INTEGER CHECK (rust_severity >= 0 AND rust_severity <= 10),
  rust_locations TEXT[],
  paint_quality INTEGER CHECK (paint_quality >= 0 AND paint_quality <= 10),
  paint_type TEXT, -- 'original', 'repaint', 'primer', etc.
  body_alignment INTEGER CHECK (body_alignment >= 0 AND body_alignment <= 10),
  chrome_condition INTEGER CHECK (chrome_condition >= 0 AND chrome_condition <= 10),
  glass_condition INTEGER CHECK (glass_condition >= 0 AND glass_condition <= 10),
  interior_wear INTEGER CHECK (interior_wear >= 0 AND interior_wear <= 10),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Vehicle Originality Factors (major value impact)
CREATE TABLE IF NOT EXISTS vehicle_originality_factors (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  stock_appearance BOOLEAN,
  original_wheels BOOLEAN,
  engine_modifications TEXT[],
  suspension_mods TEXT[],
  exhaust_mods TEXT[],
  interior_mods TEXT[],
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Vehicle Desirability Features (varies by vehicle type)
CREATE TABLE IF NOT EXISTS vehicle_desirability_features (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  transmission_type TEXT, -- 'manual', 'automatic', etc.
  special_packages TEXT[],
  rare_options TEXT[],
  performance_indicators TEXT[],
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Vehicle Red Flags (value killers)
CREATE TABLE IF NOT EXISTS vehicle_red_flags (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  accident_damage TEXT[],
  poor_repairs TEXT[],
  rust_through TEXT[],
  mismatched_panels TEXT[],
  cheap_mods TEXT[],
  missing_components TEXT[],
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Vehicle Rarity Indicators
CREATE TABLE IF NOT EXISTS vehicle_rarity_indicators (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  special_badges TEXT[],
  unusual_colors TEXT[],
  limited_features TEXT[],
  build_tags TEXT[],
  production_numbers INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Vehicle Value Assessment (comprehensive scoring)
CREATE TABLE IF NOT EXISTS vehicle_value_assessments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  condition_score INTEGER CHECK (condition_score >= 0 AND condition_score <= 100),
  originality_score INTEGER CHECK (originality_score >= 0 AND originality_score <= 100),
  rarity_score INTEGER CHECK (rarity_score >= 0 AND rarity_score <= 100),
  overall_value_tier TEXT CHECK (overall_value_tier IN ('project', 'driver', 'nice', 'show', 'concours')),
  estimated_value_low DECIMAL(10, 2),
  estimated_value_high DECIMAL(10, 2),
  market_context TEXT,
  assessment_confidence INTEGER CHECK (assessment_confidence >= 0 AND assessment_confidence <= 100),
  assessed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  assessed_by TEXT, -- 'ai_vision', 'user_input', 'expert_review'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Vehicle Analysis Sessions (track AI analysis runs)
CREATE TABLE IF NOT EXISTS vehicle_analysis_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  image_count INTEGER NOT NULL,
  user_context TEXT, -- User-provided context/notes
  ai_model_version TEXT,
  analysis_confidence INTEGER CHECK (analysis_confidence >= 0 AND analysis_confidence <= 100),
  raw_ai_response JSONB, -- Store full AI response for debugging
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Vehicle Market Context (link to external market data)
CREATE TABLE IF NOT EXISTS vehicle_market_context (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  bring_a_trailer_url TEXT,
  classics_com_url TEXT,
  barrett_jackson_url TEXT,
  recent_sales JSONB, -- Array of recent sale prices and dates
  market_trend TEXT, -- 'rising', 'stable', 'declining'
  collectibility_rating INTEGER CHECK (collectibility_rating >= 0 AND collectibility_rating <= 10),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_vehicle_condition_indicators_vehicle_id ON vehicle_condition_indicators(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_originality_factors_vehicle_id ON vehicle_originality_factors(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_desirability_features_vehicle_id ON vehicle_desirability_features(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_red_flags_vehicle_id ON vehicle_red_flags(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_rarity_indicators_vehicle_id ON vehicle_rarity_indicators(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_value_assessments_vehicle_id ON vehicle_value_assessments(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_analysis_sessions_vehicle_id ON vehicle_analysis_sessions(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_analysis_sessions_user_id ON vehicle_analysis_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_market_context_vehicle_id ON vehicle_market_context(vehicle_id);

-- Value tier index for market queries
CREATE INDEX IF NOT EXISTS idx_vehicle_value_assessments_tier ON vehicle_value_assessments(overall_value_tier);
CREATE INDEX IF NOT EXISTS idx_vehicle_value_assessments_scores ON vehicle_value_assessments(condition_score, originality_score, rarity_score);
