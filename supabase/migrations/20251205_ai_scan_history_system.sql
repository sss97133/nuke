-- ============================================
-- AI SCAN HISTORY SYSTEM
-- ============================================
-- Saves ALL scans (never replaces) as snapshots of AI accuracy over time
-- Tracks confidence per field/table (0-100)
-- Enables forensic analysis for no-EXIF images
-- Links to source context (EXIF, URL, etc.)

-- ============================================
-- 1. SCAN SESSION TABLE
-- ============================================
-- Each time we run analysis, create a session
CREATE TABLE IF NOT EXISTS ai_scan_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- What was scanned
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  event_id UUID, -- Will be set after timeline event is created
  image_ids UUID[] NOT NULL, -- Array of image IDs analyzed
  
  -- When
  scanned_at TIMESTAMPTZ DEFAULT NOW(),
  ai_model_version TEXT NOT NULL, -- "gpt-4o-2024-11-20", "gpt-4o-mini", etc.
  ai_model_cost NUMERIC(10,6) DEFAULT 0,
  
  -- Context available at scan time
  context_available JSONB DEFAULT '{}'::jsonb, /*
  {
    "exif_data": true,
    "source_url": "https://...",
    "vehicle_history_count": 5,
    "organization_data": true,
    "participant_attribution": true,
    "catalog_data": false,
    "oem_manuals": false
  }
  */
  
  -- Overall scan metadata
  total_images_analyzed INTEGER,
  scan_duration_seconds NUMERIC(8,2),
  total_tokens_used INTEGER,
  
  -- Results summary
  overall_confidence NUMERIC(5,2) CHECK (overall_confidence >= 0 AND overall_confidence <= 100),
  fields_extracted TEXT[], -- ['parts', 'labor', 'materials', 'quality']
  concerns_flagged TEXT[],
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX idx_scan_sessions_vehicle ON ai_scan_sessions(vehicle_id);
CREATE INDEX idx_scan_sessions_event ON ai_scan_sessions(event_id);
CREATE INDEX idx_scan_sessions_date ON ai_scan_sessions(scanned_at DESC);
CREATE INDEX idx_scan_sessions_model ON ai_scan_sessions(ai_model_version);

COMMENT ON TABLE ai_scan_sessions IS 'Each AI analysis run creates a session - all sessions saved (never replaced)';

-- ============================================
-- 2. FIELD-LEVEL CONFIDENCE TRACKING
-- ============================================
-- Tracks confidence per field/table for each scan
CREATE TABLE IF NOT EXISTS ai_scan_field_confidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_session_id UUID NOT NULL REFERENCES ai_scan_sessions(id) ON DELETE CASCADE,
  
  -- What field/table
  field_category TEXT NOT NULL, -- 'parts', 'labor', 'materials', 'quality', 'participants', 'value'
  field_name TEXT NOT NULL, -- 'part_name', 'labor_hours', 'quality_rating', etc.
  
  -- Confidence
  confidence_score INTEGER CHECK (confidence_score >= 0 AND confidence_score <= 100),
  confidence_factors JSONB DEFAULT '{}'::jsonb, /*
  {
    "exif_available": true,
    "source_url_context": true,
    "historical_data": true,
    "multiple_images": true,
    "ai_model_capability": "high",
    "context_richness": 85
  }
  */
  
  -- What was extracted
  extracted_value JSONB, -- The actual value extracted
  extraction_reasoning TEXT, -- Why AI thinks this value
  
  -- Validation
  validated_by_user UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  validated_at TIMESTAMPTZ,
  validation_notes TEXT,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_scan_field_session ON ai_scan_field_confidence(scan_session_id);
CREATE INDEX idx_scan_field_category ON ai_scan_field_confidence(field_category);
CREATE INDEX idx_scan_field_confidence ON ai_scan_field_confidence(confidence_score) WHERE confidence_score < 70;

COMMENT ON TABLE ai_scan_field_confidence IS 'Confidence per field/table - tracks what AI extracted and how confident';

-- ============================================
-- 3. FORENSIC ATTRIBUTION FOR NO-EXIF IMAGES
-- ============================================
-- Enhanced attribution when EXIF is missing
CREATE TABLE IF NOT EXISTS image_forensic_attribution (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  image_id UUID NOT NULL REFERENCES vehicle_images(id) ON DELETE CASCADE,
  
  -- 5W's Analysis
  who_uploaded UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  who_has_history_no_exif BOOLEAN DEFAULT false, -- Does uploader have history of no-EXIF uploads?
  what_curating JSONB, -- What does AI analysis indicate user is curating?
  
  where_source_url TEXT, -- Original source URL if scraped
  where_inferred_location TEXT, -- Inferred from image content
  
  when_created_before_url_date BOOLEAN, -- Image created before URL date?
  when_created_before_file_date BOOLEAN, -- Image created before file creation date?
  when_inferred_date DATE, -- Inferred date from context
  
  why_context JSONB, -- Why this attribution makes sense
  /*
  {
    "source_type": "scraped",
    "source_url": "https://bringatrailer.com/...",
    "listing_date": "2024-08-10",
    "image_analysis": "Professional photography, likely BaT photographer",
    "context_clues": ["watermark", "professional_lighting", "studio_background"]
  }
  */
  
  -- Confidence breakdown
  attribution_confidence INTEGER CHECK (attribution_confidence >= 0 AND attribution_confidence <= 100),
  confidence_factors JSONB DEFAULT '{}'::jsonb,
  /*
  {
    "exif_available": false,
    "source_url_available": true,
    "uploader_history": true,
    "ai_analysis_consistent": true,
    "context_richness": 60
  }
  */
  
  -- Ghost user assignment
  ghost_user_id UUID REFERENCES ghost_users(id) ON DELETE SET NULL,
  ghost_user_type TEXT CHECK (ghost_user_type IN ('exif_device', 'scraped_profile', 'unknown_photographer')),
  
  -- Metadata
  analyzed_at TIMESTAMPTZ DEFAULT NOW(),
  analyzed_by_ai_model TEXT
);

CREATE INDEX idx_forensic_image ON image_forensic_attribution(image_id);
CREATE INDEX idx_forensic_ghost ON image_forensic_attribution(ghost_user_id);
CREATE INDEX idx_forensic_confidence ON image_forensic_attribution(attribution_confidence) WHERE attribution_confidence < 70;

COMMENT ON TABLE image_forensic_attribution IS 'Forensic attribution for no-EXIF images using 5W analysis and source context';

-- ============================================
-- 4. GHOST USER ENHANCEMENT
-- ============================================
-- Allow building profiles from ghost users with enough data
ALTER TABLE ghost_users
ADD COLUMN IF NOT EXISTS profile_buildable BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS profile_build_score INTEGER DEFAULT 0 CHECK (profile_build_score >= 0 AND profile_build_score <= 100),
ADD COLUMN IF NOT EXISTS profile_data JSONB DEFAULT '{}'::jsonb, /*
{
  "total_images": 45,
  "vehicles_photographed": 3,
  "date_range": {"first": "2024-01-01", "last": "2024-12-04"},
  "inferred_name": "iPhone 12 Photographer",
  "inferred_location": "Las Vegas, NV",
  "photography_style": "professional",
  "common_subjects": ["interior", "exterior", "work_in_progress"]
}
*/
ADD COLUMN IF NOT EXISTS ghost_user_subclass TEXT CHECK (ghost_user_subclass IN ('exif_device', 'scraped_profile', 'unknown_photographer', 'automated_import'));

CREATE INDEX idx_ghost_buildable ON ghost_users(profile_buildable) WHERE profile_buildable = true;
CREATE INDEX idx_ghost_subclass ON ghost_users(ghost_user_subclass);

COMMENT ON COLUMN ghost_users.profile_buildable IS 'True if enough data to build a claimable profile';
COMMENT ON COLUMN ghost_users.ghost_user_subclass IS 'Type of ghost user for better classification';

-- ============================================
-- 5. HELPER FUNCTIONS
-- ============================================

-- Function: Calculate profile build score for ghost user
CREATE OR REPLACE FUNCTION calculate_ghost_profile_score(p_ghost_user_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_score INTEGER := 0;
  v_image_count INTEGER;
  v_vehicle_count INTEGER;
  v_date_span_days INTEGER;
  v_has_location BOOLEAN;
BEGIN
  -- Count images
  SELECT COUNT(*) INTO v_image_count
  FROM device_attributions da
  JOIN vehicle_images vi ON vi.id = da.image_id
  WHERE da.ghost_user_id = p_ghost_user_id;
  
  -- Count vehicles
  SELECT COUNT(DISTINCT vi.vehicle_id) INTO v_vehicle_count
  FROM device_attributions da
  JOIN vehicle_images vi ON vi.id = da.image_id
  WHERE da.ghost_user_id = p_ghost_user_id;
  
  -- Date span
  SELECT EXTRACT(DAY FROM (MAX(vi.taken_at) - MIN(vi.taken_at))) INTO v_date_span_days
  FROM device_attributions da
  JOIN vehicle_images vi ON vi.id = da.image_id
  WHERE da.ghost_user_id = p_ghost_user_id;
  
  -- Has location data
  SELECT EXISTS(
    SELECT 1 FROM device_attributions da
    JOIN vehicle_images vi ON vi.id = da.image_id
    WHERE da.ghost_user_id = p_ghost_user_id
    AND vi.exif_data->'GPS' IS NOT NULL
  ) INTO v_has_location;
  
  -- Calculate score (0-100)
  -- Images: 40 points max (1 point per image, capped at 40)
  v_score := LEAST(v_image_count, 40);
  
  -- Vehicles: 20 points max (10 points per vehicle, capped at 20)
  v_score := v_score + LEAST(v_vehicle_count * 10, 20);
  
  -- Date span: 20 points max (1 point per day, capped at 20)
  v_score := v_score + LEAST(COALESCE(v_date_span_days, 0), 20);
  
  -- Location data: 20 points
  IF v_has_location THEN
    v_score := v_score + 20;
  END IF;
  
  RETURN LEAST(v_score, 100);
END;
$$;

-- Function: Update ghost user profile buildability
CREATE OR REPLACE FUNCTION update_ghost_profile_buildability()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_score INTEGER;
BEGIN
  -- Calculate score
  v_score := calculate_ghost_profile_score(NEW.id);
  
  -- Update if score >= 50 (buildable threshold)
  UPDATE ghost_users
  SET profile_build_score = v_score,
      profile_buildable = (v_score >= 50)
  WHERE id = NEW.id;
  
  RETURN NEW;
END;
$$;

-- Trigger to auto-update buildability
DROP TRIGGER IF EXISTS trg_update_ghost_buildability ON device_attributions;
CREATE TRIGGER trg_update_ghost_buildability
  AFTER INSERT OR UPDATE ON device_attributions
  FOR EACH ROW
  WHEN (NEW.ghost_user_id IS NOT NULL)
  EXECUTE FUNCTION update_ghost_profile_buildability();

-- ============================================
-- 6. VIEW: SCAN HISTORY SUMMARY
-- ============================================
CREATE OR REPLACE VIEW ai_scan_history_summary AS
SELECT 
  s.id as scan_session_id,
  s.vehicle_id,
  v.year || ' ' || v.make || ' ' || v.model as vehicle_name,
  s.event_id::UUID as event_id,
  s.scanned_at,
  s.ai_model_version,
  s.overall_confidence,
  s.fields_extracted,
  s.total_images_analyzed,
  s.context_available,
  
  -- Field confidence breakdown
  (SELECT jsonb_object_agg(field_category || '.' || field_name, confidence_score)
   FROM ai_scan_field_confidence
   WHERE scan_session_id = s.id) as field_confidence_map,
  
  -- Confidence trend (compare to previous scan)
  (SELECT overall_confidence 
   FROM ai_scan_sessions 
   WHERE vehicle_id = s.vehicle_id 
   AND scanned_at < s.scanned_at 
   ORDER BY scanned_at DESC 
   LIMIT 1) as previous_confidence,
  
  CASE 
    WHEN (SELECT overall_confidence FROM ai_scan_sessions WHERE vehicle_id = s.vehicle_id AND scanned_at < s.scanned_at ORDER BY scanned_at DESC LIMIT 1) IS NULL THEN 'FIRST_SCAN'
    WHEN s.overall_confidence > (SELECT overall_confidence FROM ai_scan_sessions WHERE vehicle_id = s.vehicle_id AND scanned_at < s.scanned_at ORDER BY scanned_at DESC LIMIT 1) THEN 'IMPROVED'
    WHEN s.overall_confidence < (SELECT overall_confidence FROM ai_scan_sessions WHERE vehicle_id = s.vehicle_id AND scanned_at < s.scanned_at ORDER BY scanned_at DESC LIMIT 1) THEN 'DECLINED'
    ELSE 'SAME'
  END as confidence_trend

FROM ai_scan_sessions s
JOIN vehicles v ON v.id = s.vehicle_id
ORDER BY s.scanned_at DESC;

COMMENT ON VIEW ai_scan_history_summary IS 'Summary of all scan sessions with confidence trends';

-- ============================================
-- 7. RLS POLICIES
-- ============================================
ALTER TABLE ai_scan_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_scan_field_confidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE image_forensic_attribution ENABLE ROW LEVEL SECURITY;

-- Public can view scans for vehicles they can see
CREATE POLICY "Public can view scan sessions" ON ai_scan_sessions
  FOR SELECT USING (true); -- Scans are public data

CREATE POLICY "Service role can create scan sessions" ON ai_scan_sessions
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Public can view field confidence" ON ai_scan_field_confidence
  FOR SELECT USING (true);

CREATE POLICY "Service role can create field confidence" ON ai_scan_field_confidence
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Public can view forensic attribution" ON image_forensic_attribution
  FOR SELECT USING (true);

CREATE POLICY "Service role can create forensic attribution" ON image_forensic_attribution
  FOR INSERT WITH CHECK (true);

