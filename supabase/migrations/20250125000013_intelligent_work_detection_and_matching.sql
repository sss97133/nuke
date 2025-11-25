-- ==========================================================================
-- INTELLIGENT WORK DETECTION AND PROBABILISTIC MATCHING
-- ==========================================================================
-- Purpose: 
-- 1. Extract work data from images (work type, date, location)
-- 2. Probabilistically match work events to organizations
-- 3. Send approval notifications to likely organizations
-- 4. Auto-link work when approved
-- ==========================================================================

-- ==========================================================================
-- 1. WORK EVENT DETECTION FROM IMAGES
-- ==========================================================================

-- Table to store extracted work data from images
CREATE TABLE IF NOT EXISTS image_work_extractions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Image reference
  image_id UUID NOT NULL REFERENCES vehicle_images(id) ON DELETE CASCADE,
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  
  -- Extracted work data
  detected_work_type TEXT, -- 'upholstery', 'paint', 'engine', 'body_work', etc.
  detected_work_description TEXT,
  detected_components TEXT[], -- ['seats', 'door_panels', 'headliner']
  detected_date DATE, -- Extracted from image metadata or visual clues
  detected_location_address TEXT,
  detected_location_lat NUMERIC(10, 8),
  detected_location_lng NUMERIC(11, 8),
  
  -- AI confidence scores
  work_type_confidence NUMERIC(3,2), -- 0.0-1.0
  date_confidence NUMERIC(3,2),
  location_confidence NUMERIC(3,2),
  overall_confidence NUMERIC(3,2),
  
  -- AI analysis metadata
  ai_model TEXT DEFAULT 'gpt-4-vision',
  ai_analysis JSONB, -- Full AI response
  extraction_method TEXT, -- 'exif', 'ai_vision', 'ocr', 'combined'
  
  -- Processing status
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'extracted', 'matched', 'approved', 'rejected')),
  processed_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_work_extractions_image ON image_work_extractions(image_id);
CREATE INDEX IF NOT EXISTS idx_work_extractions_vehicle ON image_work_extractions(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_work_extractions_status ON image_work_extractions(status);
CREATE INDEX IF NOT EXISTS idx_work_extractions_work_type ON image_work_extractions(detected_work_type) WHERE detected_work_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_work_extractions_date ON image_work_extractions(detected_date) WHERE detected_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_work_extractions_location ON image_work_extractions(detected_location_lat, detected_location_lng) 
  WHERE detected_location_lat IS NOT NULL AND detected_location_lng IS NOT NULL;

COMMENT ON TABLE image_work_extractions IS 
  'Stores AI-extracted work data from images. Used for probabilistic matching to organizations.';

-- ==========================================================================
-- 2. PROBABILISTIC WORK MATCHING
-- ==========================================================================

-- Table to store probabilistic matches between work and organizations
CREATE TABLE IF NOT EXISTS work_organization_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Work reference
  image_work_extraction_id UUID REFERENCES image_work_extractions(id) ON DELETE CASCADE,
  timeline_event_id UUID REFERENCES business_timeline_events(id) ON DELETE CASCADE,
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  
  -- Matched organization
  matched_organization_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  
  -- Match criteria and scores
  match_probability NUMERIC(5,2) NOT NULL, -- 0-100%
  match_reasons JSONB, -- Array of reasons: ['location_match', 'work_type_match', 'date_range_match']
  
  -- Location matching
  location_match BOOLEAN DEFAULT false,
  location_distance_meters INTEGER, -- Distance between work location and org location
  
  -- Work type matching
  work_type_match BOOLEAN DEFAULT false,
  organization_capabilities TEXT[], -- What the org can do (from business_type, services, etc.)
  
  -- Date range matching
  date_range_match BOOLEAN DEFAULT false,
  organization_active_dates DATERANGE, -- When org was active at location
  
  -- Notification status
  notification_sent_at TIMESTAMPTZ,
  notification_status TEXT DEFAULT 'pending' CHECK (notification_status IN ('pending', 'sent', 'viewed', 'responded')),
  
  -- Approval status
  approval_status TEXT DEFAULT 'pending' CHECK (approval_status IN ('pending', 'approved', 'rejected', 'ignored')),
  approved_by_user_id UUID REFERENCES auth.users(id),
  approved_at TIMESTAMPTZ,
  rejection_reason TEXT,
  
  -- Auto-linking (when approved)
  auto_linked_work_contribution_id UUID REFERENCES vehicle_work_contributions(id) ON DELETE SET NULL,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_work_matches_extraction ON work_organization_matches(image_work_extraction_id);
CREATE INDEX IF NOT EXISTS idx_work_matches_vehicle ON work_organization_matches(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_work_matches_org ON work_organization_matches(matched_organization_id);
CREATE INDEX IF NOT EXISTS idx_work_matches_status ON work_organization_matches(approval_status, notification_status);
CREATE INDEX IF NOT EXISTS idx_work_matches_probability ON work_organization_matches(match_probability DESC) WHERE approval_status = 'pending';

COMMENT ON TABLE work_organization_matches IS 
  'Probabilistic matches between detected work and organizations. High-probability matches trigger approval notifications.';

-- ==========================================================================
-- 3. ORGANIZATION CAPABILITIES (for matching)
-- ==========================================================================

-- Table to store organization capabilities/specialties
CREATE TABLE IF NOT EXISTS organization_capabilities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  
  -- Capability details
  capability_type TEXT NOT NULL, -- 'upholstery', 'paint', 'engine', 'body_work', 'fabrication', etc.
  capability_name TEXT NOT NULL, -- 'Interior Upholstery', 'Custom Paint', etc.
  description TEXT,
  
  -- Capability strength
  proficiency_level TEXT DEFAULT 'expert' CHECK (proficiency_level IN ('beginner', 'intermediate', 'advanced', 'expert')),
  years_experience INTEGER,
  
  -- Evidence
  evidence_count INTEGER DEFAULT 0, -- Number of work examples
  last_work_date DATE, -- Most recent work of this type
  
  -- Status
  is_active BOOLEAN DEFAULT true,
  verified BOOLEAN DEFAULT false, -- Verified by org owner
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(organization_id, capability_type)
);

CREATE INDEX IF NOT EXISTS idx_org_capabilities_org ON organization_capabilities(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_capabilities_type ON organization_capabilities(capability_type);
CREATE INDEX IF NOT EXISTS idx_org_capabilities_active ON organization_capabilities(organization_id, capability_type) 
  WHERE is_active = true;

COMMENT ON TABLE organization_capabilities IS 
  'Stores organization capabilities/specialties for intelligent work matching.';

-- ==========================================================================
-- 4. PROBABILISTIC MATCHING FUNCTION
-- ==========================================================================

-- Function to probabilistically match work to organizations
CREATE OR REPLACE FUNCTION match_work_to_organizations(
  p_work_extraction_id UUID
)
RETURNS TABLE(
  organization_id UUID,
  business_name TEXT,
  match_probability NUMERIC,
  match_reasons JSONB,
  location_match BOOLEAN,
  work_type_match BOOLEAN,
  date_range_match BOOLEAN
) AS $$
DECLARE
  v_work RECORD;
  v_org RECORD;
  v_match_score NUMERIC;
  v_reasons JSONB;
  v_location_match BOOLEAN;
  v_work_type_match BOOLEAN;
  v_date_match BOOLEAN;
  v_distance_meters INTEGER;
BEGIN
  -- Get work extraction data
  SELECT * INTO v_work
  FROM image_work_extractions
  WHERE id = p_work_extraction_id;
  
  IF NOT FOUND THEN
    RETURN;
  END IF;
  
  -- Find organizations at the same location
  FOR v_org IN
    SELECT DISTINCT
      b.id,
      b.business_name,
      b.address,
      b.latitude,
      b.longitude,
      b.business_type,
      lc.location_address,
      lc.can_add_work
    FROM businesses b
    LEFT JOIN location_collaborations lc ON lc.organization_id = b.id
    WHERE 
      -- Location match (same address or within 100m)
      (
        (v_work.detected_location_address IS NOT NULL AND b.address ILIKE '%' || v_work.detected_location_address || '%')
        OR
        (v_work.detected_location_lat IS NOT NULL AND v_work.detected_location_lng IS NOT NULL
         AND b.latitude IS NOT NULL AND b.longitude IS NOT NULL
         AND ST_DWithin(
           ST_MakePoint(b.longitude, b.latitude)::geography,
           ST_MakePoint(v_work.detected_location_lng, v_work.detected_location_lat)::geography,
           100  -- 100 meters
         ))
      )
      AND lc.status = 'active'
  LOOP
    v_match_score := 0;
    v_reasons := '[]'::JSONB;
    v_location_match := false;
    v_work_type_match := false;
    v_date_match := false;
    
    -- 1. Location matching (40% weight)
    IF v_work.detected_location_address IS NOT NULL AND v_org.address ILIKE '%' || v_work.detected_location_address || '%' THEN
      v_location_match := true;
      v_match_score := v_match_score + 40;
      v_reasons := v_reasons || '{"type": "location_match", "reason": "Same address"}'::JSONB;
    ELSIF v_work.detected_location_lat IS NOT NULL AND v_org.latitude IS NOT NULL THEN
      SELECT ST_Distance(
        ST_MakePoint(v_org.longitude, v_org.latitude)::geography,
        ST_MakePoint(v_work.detected_location_lng, v_work.detected_location_lat)::geography
      )::INTEGER INTO v_distance_meters;
      
      IF v_distance_meters <= 100 THEN
        v_location_match := true;
        v_match_score := v_match_score + (40 * (1 - (v_distance_meters::NUMERIC / 100)));
        v_reasons := v_reasons || jsonb_build_object('type', 'location_match', 'reason', 'Within 100m', 'distance_meters', v_distance_meters);
      END IF;
    END IF;
    
    -- 2. Work type matching (50% weight)
    IF v_work.detected_work_type IS NOT NULL THEN
      -- Check organization capabilities
      IF EXISTS (
        SELECT 1 FROM organization_capabilities oc
        WHERE oc.organization_id = v_org.id
          AND oc.capability_type = v_work.detected_work_type
          AND oc.is_active = true
      ) THEN
        v_work_type_match := true;
        v_match_score := v_match_score + 50;
        v_reasons := v_reasons || jsonb_build_object('type', 'work_type_match', 'reason', 'Organization specializes in this work type');
      -- Fallback: Check business_type for common patterns
      ELSIF (
        (v_work.detected_work_type = 'upholstery' AND v_org.business_type ILIKE '%upholstery%')
        OR (v_work.detected_work_type = 'paint' AND v_org.business_type ILIKE '%paint%')
        OR (v_work.detected_work_type = 'body_work' AND v_org.business_type ILIKE '%body%')
        OR (v_work.detected_work_type = 'fabrication' AND v_org.business_type ILIKE '%fabrication%')
      ) THEN
        v_work_type_match := true;
        v_match_score := v_match_score + 40; -- Slightly lower confidence
        v_reasons := v_reasons || jsonb_build_object('type', 'work_type_match', 'reason', 'Business type suggests capability');
      END IF;
    END IF;
    
    -- 3. Date range matching (10% weight)
    IF v_work.detected_date IS NOT NULL THEN
      -- Check if organization was active at location during work date
      IF EXISTS (
        SELECT 1 FROM location_collaborations lc
        WHERE lc.organization_id = v_org.id
          AND lc.status = 'active'
          AND (lc.created_at::DATE <= v_work.detected_date OR lc.created_at IS NULL)
      ) THEN
        v_date_match := true;
        v_match_score := v_match_score + 10;
        v_reasons := v_reasons || jsonb_build_object('type', 'date_range_match', 'reason', 'Organization active during work period');
      END IF;
    END IF;
    
    -- Only return matches with probability >= 70%
    IF v_match_score >= 70 THEN
      -- Insert match record
      INSERT INTO work_organization_matches (
        image_work_extraction_id,
        vehicle_id,
        matched_organization_id,
        match_probability,
        match_reasons,
        location_match,
        work_type_match,
        date_range_match,
        location_distance_meters
      ) VALUES (
        p_work_extraction_id,
        v_work.vehicle_id,
        v_org.id,
        v_match_score,
        v_reasons,
        v_location_match,
        v_work_type_match,
        v_date_match,
        v_distance_meters
      )
      ON CONFLICT DO NOTHING;
      
      RETURN QUERY SELECT
        v_org.id,
        v_org.business_name,
        v_match_score,
        v_reasons,
        v_location_match,
        v_work_type_match,
        v_date_match;
    END IF;
  END LOOP;
  
  RETURN;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ==========================================================================
-- 5. AUTO-CREATE WORK CONTRIBUTION WHEN APPROVED
-- ==========================================================================

-- Function to auto-link work when organization approves
CREATE OR REPLACE FUNCTION auto_link_approved_work()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_work_extraction RECORD;
  v_vehicle_owner_org UUID;
BEGIN
  -- Only process when approval_status changes to 'approved'
  IF NEW.approval_status = 'approved' AND (OLD.approval_status IS NULL OR OLD.approval_status != 'approved') THEN
    
    -- Get work extraction data
    SELECT * INTO v_work_extraction
    FROM image_work_extractions
    WHERE id = NEW.image_work_extraction_id;
    
    IF NOT FOUND THEN
      RETURN NEW;
    END IF;
    
    -- Find vehicle owner organization
    SELECT organization_id INTO v_vehicle_owner_org
    FROM organization_vehicles
    WHERE vehicle_id = NEW.vehicle_id
      AND relationship_type = 'owner'
      AND status = 'active'
    LIMIT 1;
    
    -- Create work contribution
    INSERT INTO vehicle_work_contributions (
      vehicle_id,
      contributing_organization_id,
      vehicle_owner_organization_id,
      work_type,
      work_description,
      work_date,
      status,
      performed_by_user_id
    ) VALUES (
      NEW.vehicle_id,
      NEW.matched_organization_id,
      COALESCE(v_vehicle_owner_org, NEW.matched_organization_id),
      v_work_extraction.detected_work_type,
      COALESCE(v_work_extraction.detected_work_description, 'Work detected from images'),
      COALESCE(v_work_extraction.detected_date, CURRENT_DATE),
      'completed',
      NEW.approved_by_user_id
    )
    RETURNING id INTO NEW.auto_linked_work_contribution_id;
    
    -- Update work extraction status
    UPDATE image_work_extractions
    SET status = 'approved', processed_at = NOW()
    WHERE id = NEW.image_work_extraction_id;
    
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create trigger
DROP TRIGGER IF EXISTS trigger_auto_link_approved_work ON work_organization_matches;
CREATE TRIGGER trigger_auto_link_approved_work
  AFTER UPDATE OF approval_status
  ON work_organization_matches
  FOR EACH ROW
  WHEN (NEW.approval_status = 'approved')
  EXECUTE FUNCTION auto_link_approved_work();

-- ==========================================================================
-- 6. HELPER FUNCTIONS
-- ==========================================================================

-- Function to get pending approval requests for an organization
CREATE OR REPLACE FUNCTION get_pending_work_approvals(
  p_organization_id UUID
)
RETURNS TABLE(
  match_id UUID,
  vehicle_id UUID,
  vehicle_year INTEGER,
  vehicle_make TEXT,
  vehicle_model TEXT,
  work_type TEXT,
  work_description TEXT,
  work_date DATE,
  match_probability NUMERIC,
  match_reasons JSONB,
  image_url TEXT,
  requested_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    wom.id,
    wom.vehicle_id,
    v.year,
    v.make,
    v.model,
    iwe.detected_work_type,
    iwe.detected_work_description,
    iwe.detected_date,
    wom.match_probability,
    wom.match_reasons,
    vi.image_url,
    wom.created_at
  FROM work_organization_matches wom
  JOIN image_work_extractions iwe ON iwe.id = wom.image_work_extraction_id
  JOIN vehicles v ON v.id = wom.vehicle_id
  JOIN vehicle_images vi ON vi.id = iwe.image_id
  WHERE wom.matched_organization_id = p_organization_id
    AND wom.approval_status = 'pending'
    AND wom.notification_status IN ('pending', 'sent', 'viewed')
  ORDER BY wom.match_probability DESC, wom.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Function to approve/reject work match
CREATE OR REPLACE FUNCTION approve_work_match(
  p_match_id UUID,
  p_approved BOOLEAN,
  p_user_id UUID,
  p_rejection_reason TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  UPDATE work_organization_matches
  SET 
    approval_status = CASE WHEN p_approved THEN 'approved' ELSE 'rejected' END,
    approved_by_user_id = p_user_id,
    approved_at = NOW(),
    rejection_reason = p_rejection_reason,
    notification_status = 'responded',
    updated_at = NOW()
  WHERE id = p_match_id
    AND approval_status = 'pending';
  
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ==========================================================================
-- 7. RLS POLICIES
-- ==========================================================================

ALTER TABLE image_work_extractions ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_organization_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_capabilities ENABLE ROW LEVEL SECURITY;

-- Image work extractions: Viewable by vehicle owners and image uploaders
CREATE POLICY "View work extractions" ON image_work_extractions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM organization_vehicles ov
      WHERE ov.vehicle_id = image_work_extractions.vehicle_id
        AND EXISTS (
          SELECT 1 FROM organization_contributors oc
          WHERE oc.organization_id = ov.organization_id
            AND oc.user_id = auth.uid()
        )
    )
    OR EXISTS (
      SELECT 1 FROM vehicle_images vi
      WHERE vi.id = image_work_extractions.image_id
        AND vi.user_id = auth.uid()
    )
  );

-- Work matches: Viewable by matched organization and vehicle owner
CREATE POLICY "View work matches" ON work_organization_matches
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM organization_contributors oc
      WHERE oc.organization_id = work_organization_matches.matched_organization_id
        AND oc.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM organization_vehicles ov
      WHERE ov.vehicle_id = work_organization_matches.vehicle_id
        AND EXISTS (
          SELECT 1 FROM organization_contributors oc2
          WHERE oc2.organization_id = ov.organization_id
            AND oc2.user_id = auth.uid()
        )
    )
  );

-- Organizations can update their own matches (approve/reject)
CREATE POLICY "Update own work matches" ON work_organization_matches
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM organization_contributors oc
      WHERE oc.organization_id = work_organization_matches.matched_organization_id
        AND oc.user_id = auth.uid()
        AND oc.role IN ('owner', 'co_founder', 'board_member', 'manager')
    )
  );

-- Organization capabilities: Viewable by all, manageable by org owners
CREATE POLICY "View organization capabilities" ON organization_capabilities
  FOR SELECT USING (true);

CREATE POLICY "Manage own capabilities" ON organization_capabilities
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM organization_contributors oc
      WHERE oc.organization_id = organization_capabilities.organization_id
        AND oc.user_id = auth.uid()
        AND oc.role IN ('owner', 'co_founder', 'board_member', 'manager')
    )
  );

-- ==========================================================================
-- 8. GRANTS
-- ==========================================================================

GRANT SELECT, INSERT, UPDATE ON image_work_extractions TO authenticated;
GRANT SELECT, INSERT, UPDATE ON work_organization_matches TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON organization_capabilities TO authenticated;
GRANT EXECUTE ON FUNCTION match_work_to_organizations(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_pending_work_approvals(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION approve_work_match(UUID, BOOLEAN, UUID, TEXT) TO authenticated;

