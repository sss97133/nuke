-- ============================================
-- INTELLIGENT CONTENT EXTRACTION SYSTEM
-- ============================================
-- Detects valuable content in comments (URLs, specs, data)
-- Automatically extracts, validates, and attributes contributions

-- ============================================
-- CONTENT EXTRACTION QUEUE
-- ============================================
-- Stores detected content that needs processing
CREATE TABLE IF NOT EXISTS content_extraction_queue (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  
  -- Source
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  comment_id UUID, -- Link to source comment
  comment_table TEXT, -- Which comment table: 'vehicle_comments', 'timeline_event_comments', etc.
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Detected Content
  content_type TEXT NOT NULL CHECK (content_type IN (
    'listing_url',      -- BaT, Mecum, KSL, Craigslist, etc.
    'youtube_video',    -- Walkaround videos, reviews
    'document_url',     -- Service manual, brochure PDFs
    'specs_data',       -- Pasted specs (HP, torque, etc.)
    'price_data',       -- Sale prices, asking prices
    'timeline_event',   -- Maintenance records, history
    'image_url',        -- External image links
    'contact_info',     -- Seller/buyer contact details
    'vin_data',         -- VIN numbers
    'unknown'           -- Detected as valuable but unclear type
  )),
  
  raw_content TEXT NOT NULL, -- The actual content (URL, text block, etc.)
  context TEXT, -- Surrounding text for context
  
  -- Classification Confidence
  confidence_score NUMERIC(3,2) DEFAULT 0.0 CHECK (confidence_score >= 0.0 AND confidence_score <= 1.0),
  detection_method TEXT, -- 'regex', 'nlp', 'pattern_match', etc.
  
  -- Processing Status
  status TEXT DEFAULT 'pending' CHECK (status IN (
    'pending',        -- Awaiting processing
    'processing',     -- Currently being extracted
    'completed',      -- Successfully processed
    'failed',         -- Extraction failed
    'rejected',       -- User/system rejected the content
    'duplicate'       -- Already exists in system
  )),
  
  -- Processing Results
  extracted_data JSONB, -- Structured data after extraction
  error_message TEXT,
  processing_attempts INTEGER DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  
  -- Attribution & Provenance
  contribution_value INTEGER DEFAULT 0, -- Points awarded for this contribution
  data_quality_score NUMERIC(3,2), -- Quality of extracted data (0.0-1.0)
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_content_extraction_vehicle ON content_extraction_queue(vehicle_id);
CREATE INDEX idx_content_extraction_user ON content_extraction_queue(user_id);
CREATE INDEX idx_content_extraction_status ON content_extraction_queue(status);
CREATE INDEX idx_content_extraction_type ON content_extraction_queue(content_type);
CREATE INDEX idx_content_extraction_created ON content_extraction_queue(created_at DESC);

-- ============================================
-- ATTRIBUTED DATA SOURCES
-- ============================================
-- Tracks who contributed what data to vehicle profiles
CREATE TABLE IF NOT EXISTS attributed_data_sources (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  
  -- Target
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  data_field TEXT NOT NULL, -- 'images', 'specs', 'price', 'timeline_event', etc.
  
  -- Source Attribution
  contributed_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_comment_id UUID, -- Original comment that triggered extraction
  extraction_job_id UUID REFERENCES content_extraction_queue(id) ON DELETE SET NULL,
  
  -- Data Reference
  data_type TEXT NOT NULL, -- 'vehicle_images', 'vehicle_specs', 'timeline_events', etc.
  data_id UUID, -- ID of the created record (image_id, event_id, etc.)
  
  -- Contribution Metrics
  contribution_value INTEGER DEFAULT 0, -- Points for this specific contribution
  verification_status TEXT DEFAULT 'unverified' CHECK (verification_status IN (
    'unverified',        -- Newly added, not yet verified
    'auto_verified',     -- Passed automated checks (VIN match, etc.)
    'peer_verified',     -- Another user confirmed
    'expert_verified',   -- Professional/admin verified
    'disputed',          -- Flagged as potentially incorrect
    'rejected'           -- Confirmed incorrect
  )),
  
  -- Quality Tracking
  data_quality_score NUMERIC(3,2), -- 0.0 = poor, 1.0 = excellent
  verification_notes TEXT,
  verified_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  verified_at TIMESTAMPTZ,
  
  -- Provenance Chain
  source_url TEXT, -- Original source (listing URL, etc.)
  extraction_method TEXT, -- 'scraper', 'manual_input', 'ocr', etc.
  confidence_score NUMERIC(3,2),
  
  -- Metadata
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_attributed_data_vehicle ON attributed_data_sources(vehicle_id);
CREATE INDEX idx_attributed_data_contributor ON attributed_data_sources(contributed_by);
CREATE INDEX idx_attributed_data_type ON attributed_data_sources(data_type);
CREATE INDEX idx_attributed_data_verification ON attributed_data_sources(verification_status);

-- ============================================
-- USER CONTRIBUTION SCORES
-- ============================================
-- Enhanced user reputation based on data contribution quality
CREATE TABLE IF NOT EXISTS user_contribution_scores (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Overall Metrics
  total_contributions INTEGER DEFAULT 0,
  total_points INTEGER DEFAULT 0,
  avg_quality_score NUMERIC(3,2) DEFAULT 0.0,
  accuracy_rate NUMERIC(3,2) DEFAULT 0.0, -- Percentage of verified contributions
  
  -- Contribution Breakdown
  listings_found INTEGER DEFAULT 0,
  specs_added INTEGER DEFAULT 0,
  images_contributed INTEGER DEFAULT 0,
  timeline_events INTEGER DEFAULT 0,
  documents_uploaded INTEGER DEFAULT 0,
  
  -- Quality Indicators
  verified_contributions INTEGER DEFAULT 0,
  disputed_contributions INTEGER DEFAULT 0,
  rejected_contributions INTEGER DEFAULT 0,
  
  -- Reputation Tier
  reputation_tier TEXT DEFAULT 'novice' CHECK (reputation_tier IN (
    'novice',          -- 0-99 points
    'contributor',     -- 100-499 points
    'trusted',         -- 500-1999 points
    'expert',          -- 2000-4999 points
    'authority'        -- 5000+ points
  )),
  
  -- Badges & Achievements
  badges JSONB DEFAULT '[]', -- Array of earned badges
  
  -- Timestamps
  first_contribution_at TIMESTAMPTZ,
  last_contribution_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_contribution_scores_tier ON user_contribution_scores(reputation_tier);
CREATE INDEX idx_contribution_scores_points ON user_contribution_scores(total_points DESC);

-- ============================================
-- DATA MERGE CONFLICTS
-- ============================================
-- Tracks when extracted data conflicts with existing data
CREATE TABLE IF NOT EXISTS data_merge_conflicts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  
  -- Conflict Details
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  field_name TEXT NOT NULL, -- 'make', 'model', 'mileage', 'vin', etc.
  
  -- Existing vs New Data
  existing_value TEXT,
  proposed_value TEXT,
  
  -- Sources
  existing_source UUID REFERENCES attributed_data_sources(id) ON DELETE SET NULL,
  proposed_source UUID REFERENCES attributed_data_sources(id) ON DELETE SET NULL,
  proposed_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Resolution
  resolution_status TEXT DEFAULT 'pending' CHECK (resolution_status IN (
    'pending',       -- Needs review
    'auto_merged',   -- System auto-resolved
    'user_merged',   -- User chose which to keep
    'expert_merged', -- Admin/expert resolved
    'ignored'        -- Conflict dismissed
  )),
  
  resolved_value TEXT,
  resolved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  resolution_notes TEXT,
  
  -- Confidence Scores
  existing_confidence NUMERIC(3,2),
  proposed_confidence NUMERIC(3,2),
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_merge_conflicts_vehicle ON data_merge_conflicts(vehicle_id);
CREATE INDEX idx_merge_conflicts_status ON data_merge_conflicts(resolution_status);
CREATE INDEX idx_merge_conflicts_user ON data_merge_conflicts(proposed_by);

-- ============================================
-- TRIGGER: Auto-update contribution scores
-- ============================================
CREATE OR REPLACE FUNCTION update_contribution_scores()
RETURNS TRIGGER AS $$
DECLARE
  v_total_contributions INTEGER;
  v_verified_contributions INTEGER;
  v_total_points INTEGER;
  v_avg_quality NUMERIC(3,2);
  v_accuracy_rate NUMERIC(3,2);
  v_new_tier TEXT;
BEGIN
  -- Calculate aggregates
  SELECT 
    COUNT(*),
    COUNT(*) FILTER (WHERE verification_status IN ('auto_verified', 'peer_verified', 'expert_verified')),
    COALESCE(SUM(contribution_value), 0),
    COALESCE(AVG(data_quality_score), 0.0)
  INTO 
    v_total_contributions,
    v_verified_contributions,
    v_total_points,
    v_avg_quality
  FROM attributed_data_sources
  WHERE contributed_by = NEW.contributed_by;
  
  -- Calculate accuracy rate
  IF v_total_contributions > 0 THEN
    v_accuracy_rate := (v_verified_contributions::NUMERIC / v_total_contributions::NUMERIC);
  ELSE
    v_accuracy_rate := 0.0;
  END IF;
  
  -- Determine reputation tier
  IF v_total_points < 100 THEN
    v_new_tier := 'novice';
  ELSIF v_total_points < 500 THEN
    v_new_tier := 'contributor';
  ELSIF v_total_points < 2000 THEN
    v_new_tier := 'trusted';
  ELSIF v_total_points < 5000 THEN
    v_new_tier := 'expert';
  ELSE
    v_new_tier := 'authority';
  END IF;
  
  -- Upsert contribution scores
  INSERT INTO user_contribution_scores (
    user_id,
    total_contributions,
    verified_contributions,
    total_points,
    avg_quality_score,
    accuracy_rate,
    reputation_tier,
    last_contribution_at,
    first_contribution_at,
    updated_at
  )
  VALUES (
    NEW.contributed_by,
    v_total_contributions,
    v_verified_contributions,
    v_total_points,
    v_avg_quality,
    v_accuracy_rate,
    v_new_tier,
    NEW.created_at,
    NEW.created_at,
    NOW()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    total_contributions = v_total_contributions,
    verified_contributions = v_verified_contributions,
    total_points = v_total_points,
    avg_quality_score = v_avg_quality,
    accuracy_rate = v_accuracy_rate,
    reputation_tier = v_new_tier,
    last_contribution_at = NEW.created_at,
    updated_at = NOW();
    
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_contribution_scores
  AFTER INSERT OR UPDATE ON attributed_data_sources
  FOR EACH ROW
  EXECUTE FUNCTION update_contribution_scores();

-- ============================================
-- RLS POLICIES
-- ============================================

ALTER TABLE content_extraction_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE attributed_data_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_contribution_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_merge_conflicts ENABLE ROW LEVEL SECURITY;

-- Anyone can view extraction queue (transparency)
CREATE POLICY "Anyone can view content extraction queue"
  ON content_extraction_queue FOR SELECT
  USING (true);

-- Only authenticated users can insert to queue
CREATE POLICY "Authenticated users can queue content"
  ON content_extraction_queue FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Only system/admins can update processing status
CREATE POLICY "System can update extraction queue"
  ON content_extraction_queue FOR UPDATE
  USING (true); -- Edge functions use service role

-- Anyone can view attributed data (transparency)
CREATE POLICY "Anyone can view attributed data"
  ON attributed_data_sources FOR SELECT
  USING (true);

-- System can insert attributed data
CREATE POLICY "System can insert attributed data"
  ON attributed_data_sources FOR INSERT
  WITH CHECK (true); -- Edge functions use service role

-- Anyone can view contribution scores (public reputation)
CREATE POLICY "Anyone can view contribution scores"
  ON user_contribution_scores FOR SELECT
  USING (true);

-- Anyone can view merge conflicts (transparency)
CREATE POLICY "Anyone can view merge conflicts"
  ON data_merge_conflicts FOR SELECT
  USING (true);

-- Users can create merge conflicts
CREATE POLICY "Users can create merge conflicts"
  ON data_merge_conflicts FOR INSERT
  WITH CHECK (auth.uid() = proposed_by);

-- ============================================
-- HELPER FUNCTIONS
-- ============================================

-- Function: Queue content for extraction
CREATE OR REPLACE FUNCTION queue_content_extraction(
  p_vehicle_id UUID,
  p_comment_id UUID,
  p_comment_table TEXT,
  p_user_id UUID,
  p_content_type TEXT,
  p_raw_content TEXT,
  p_context TEXT,
  p_confidence_score NUMERIC DEFAULT 0.5,
  p_detection_method TEXT DEFAULT 'system'
)
RETURNS UUID AS $$
DECLARE
  v_queue_id UUID;
BEGIN
  INSERT INTO content_extraction_queue (
    vehicle_id,
    comment_id,
    comment_table,
    user_id,
    content_type,
    raw_content,
    context,
    confidence_score,
    detection_method,
    status
  )
  VALUES (
    p_vehicle_id,
    p_comment_id,
    p_comment_table,
    p_user_id,
    p_content_type,
    p_raw_content,
    p_context,
    p_confidence_score,
    p_detection_method,
    'pending'
  )
  RETURNING id INTO v_queue_id;
  
  RETURN v_queue_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Award contribution points
CREATE OR REPLACE FUNCTION award_contribution_points(
  p_user_id UUID,
  p_vehicle_id UUID,
  p_data_field TEXT,
  p_data_type TEXT,
  p_data_id UUID,
  p_source_comment_id UUID,
  p_extraction_job_id UUID,
  p_source_url TEXT,
  p_contribution_value INTEGER,
  p_data_quality_score NUMERIC DEFAULT 0.5
)
RETURNS UUID AS $$
DECLARE
  v_attribution_id UUID;
BEGIN
  INSERT INTO attributed_data_sources (
    vehicle_id,
    data_field,
    contributed_by,
    source_comment_id,
    extraction_job_id,
    data_type,
    data_id,
    contribution_value,
    data_quality_score,
    source_url,
    verification_status
  )
  VALUES (
    p_vehicle_id,
    p_data_field,
    p_user_id,
    p_source_comment_id,
    p_extraction_job_id,
    p_data_type,
    p_data_id,
    p_contribution_value,
    p_data_quality_score,
    p_source_url,
    'auto_verified'
  )
  RETURNING id INTO v_attribution_id;
  
  RETURN v_attribution_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON TABLE content_extraction_queue IS 'Queue for processing valuable content detected in comments';
COMMENT ON TABLE attributed_data_sources IS 'Tracks data provenance and user contributions to vehicle profiles';
COMMENT ON TABLE user_contribution_scores IS 'User reputation system based on data contribution quality';
COMMENT ON TABLE data_merge_conflicts IS 'Tracks conflicts when new data contradicts existing data';

