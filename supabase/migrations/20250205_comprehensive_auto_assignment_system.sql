-- ==========================================================================
-- COMPREHENSIVE AUTOMATIC VEHICLE-ORGANIZATION ASSIGNMENT SYSTEM
-- ==========================================================================
-- Purpose: Automatically assign vehicles to organizations with confidence scoring
-- Philosophy: Vehicles have "arboreal" relationships - they come from somewhere
-- System should understand relationships from initiation, not require manual bulk assignment
-- ==========================================================================

-- ==========================================================================
-- 1. PENDING ASSIGNMENTS TABLE
-- ==========================================================================
-- Stores suggested assignments awaiting approval/review

CREATE TABLE IF NOT EXISTS pending_vehicle_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  
  -- Assignment details
  suggested_relationship_type TEXT NOT NULL CHECK (suggested_relationship_type IN (
    'owner', 'consigner', 'service_provider', 'work_location', 
    'seller', 'buyer', 'parts_supplier', 'fabricator', 'painter',
    'upholstery', 'transport', 'storage', 'inspector', 'collaborator'
  )),
  
  -- Confidence scoring
  overall_confidence NUMERIC(5,2) NOT NULL CHECK (overall_confidence >= 0 AND overall_confidence <= 100),
  confidence_breakdown JSONB DEFAULT '{}'::JSONB, -- {gps: 85, receipt: 0, user_org: 90, vin_match: 0, ...}
  
  -- Evidence sources
  evidence_sources TEXT[] DEFAULT '{}', -- ['gps', 'receipt', 'user_org_membership', 'vin_match', 'historical_pattern']
  evidence_count INTEGER DEFAULT 0, -- Number of evidence points
  
  -- Status
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'auto_approved', 'expired')),
  auto_approve_threshold NUMERIC(5,2) DEFAULT 80.0, -- Auto-approve if confidence >= this
  
  -- Assignment metadata
  suggested_by_system BOOLEAN DEFAULT true,
  suggested_by_user_id UUID REFERENCES auth.users(id),
  reviewed_by_user_id UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 days'),
  
  -- Unique constraint: one pending assignment per vehicle-org-relationship
  UNIQUE(vehicle_id, organization_id, suggested_relationship_type, status)
);

CREATE INDEX IF NOT EXISTS idx_pending_assignments_vehicle ON pending_vehicle_assignments(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_pending_assignments_org ON pending_vehicle_assignments(organization_id);
CREATE INDEX IF NOT EXISTS idx_pending_assignments_status ON pending_vehicle_assignments(status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_pending_assignments_confidence ON pending_vehicle_assignments(overall_confidence DESC) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_pending_assignments_expires ON pending_vehicle_assignments(expires_at) WHERE status = 'pending';

COMMENT ON TABLE pending_vehicle_assignments IS 'Pending vehicle-organization assignments awaiting review or auto-approval';
COMMENT ON COLUMN pending_vehicle_assignments.overall_confidence IS 'Overall confidence score 0-100, calculated from multiple evidence sources';
COMMENT ON COLUMN pending_vehicle_assignments.confidence_breakdown IS 'JSON breakdown of confidence by source: {gps: 85, receipt: 70, user_org: 90}';
COMMENT ON COLUMN pending_vehicle_assignments.evidence_sources IS 'Array of evidence types that contributed to this suggestion';

-- ==========================================================================
-- 2. COMPREHENSIVE CONFIDENCE SCORING FUNCTION
-- ==========================================================================
-- Multi-factor confidence calculation considering all evidence sources

CREATE OR REPLACE FUNCTION calculate_vehicle_org_assignment_confidence(
  p_vehicle_id UUID,
  p_organization_id UUID,
  p_user_id UUID DEFAULT NULL
)
RETURNS TABLE (
  overall_confidence NUMERIC,
  confidence_breakdown JSONB,
  evidence_sources TEXT[],
  suggested_relationship_type TEXT,
  evidence_count INTEGER
)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_gps_confidence NUMERIC := 0;
  v_receipt_confidence NUMERIC := 0;
  v_user_org_confidence NUMERIC := 0;
  v_vin_match_confidence NUMERIC := 0;
  v_historical_confidence NUMERIC := 0;
  v_image_count_confidence NUMERIC := 0;
  
  v_breakdown JSONB := '{}'::JSONB;
  v_sources TEXT[] := '{}';
  v_evidence_count INTEGER := 0;
  v_overall NUMERIC := 0;
  v_relationship_type TEXT := 'service_provider';
  
  -- GPS evidence
  v_gps_distance NUMERIC;
  v_gps_image_count INTEGER;
  
  -- Receipt evidence
  v_receipt_count INTEGER;
  v_receipt_similarity NUMERIC;
  
  -- User org membership
  v_user_is_member BOOLEAN := false;
  v_user_role TEXT;
  
  -- VIN matching
  v_vin_match_count INTEGER;
  
  -- Historical patterns
  v_historical_match_count INTEGER;
BEGIN
  -- ============================================
  -- 1. GPS-BASED CONFIDENCE (0-100)
  -- ============================================
  SELECT 
    MIN(ST_Distance(
      ST_MakePoint(b.longitude, b.latitude)::geography,
      ST_MakePoint(vi.longitude, vi.latitude)::geography
    )),
    COUNT(DISTINCT vi.id)
  INTO v_gps_distance, v_gps_image_count
  FROM vehicle_images vi
  CROSS JOIN businesses b
  WHERE vi.vehicle_id = p_vehicle_id
    AND vi.latitude IS NOT NULL
    AND vi.longitude IS NOT NULL
    AND b.id = p_organization_id
    AND b.latitude IS NOT NULL
    AND b.longitude IS NOT NULL
    AND ST_DWithin(
      ST_MakePoint(b.longitude, b.latitude)::geography,
      ST_MakePoint(vi.longitude, vi.latitude)::geography,
      500  -- 500 meters max
    );
  
  IF v_gps_distance IS NOT NULL THEN
    -- Distance-based confidence: closer = higher confidence
    v_gps_confidence := GREATEST(0, LEAST(100, (1 - (v_gps_distance / 500.0)) * 100));
    
    -- Boost for multiple images at same location
    IF v_gps_image_count > 1 THEN
      v_gps_confidence := LEAST(100, v_gps_confidence + (v_gps_image_count * 2));
    END IF;
    
    v_sources := array_append(v_sources, 'gps');
    v_evidence_count := v_evidence_count + 1;
    v_relationship_type := 'work_location';
  END IF;
  
  -- ============================================
  -- 2. RECEIPT-BASED CONFIDENCE (0-100)
  -- ============================================
  SELECT 
    COUNT(*),
    MAX(similarity(LOWER(b.business_name), LOWER(vd.vendor_name)))
  INTO v_receipt_count, v_receipt_similarity
  FROM vehicle_documents vd
  CROSS JOIN businesses b
  WHERE vd.vehicle_id = p_vehicle_id
    AND vd.vendor_name IS NOT NULL
    AND LENGTH(vd.vendor_name) > 3
    AND b.id = p_organization_id
    AND similarity(LOWER(b.business_name), LOWER(vd.vendor_name)) > 0.5;
  
  IF v_receipt_count > 0 THEN
    -- Similarity score (0-1) * 100 = confidence
    v_receipt_confidence := v_receipt_similarity * 100;
    
    -- Boost for multiple receipts
    IF v_receipt_count > 1 THEN
      v_receipt_confidence := LEAST(100, v_receipt_confidence + (v_receipt_count * 5));
    END IF;
    
    v_sources := array_append(v_sources, 'receipt');
    v_evidence_count := v_evidence_count + 1;
    v_relationship_type := 'service_provider';
  END IF;
  
  -- ============================================
  -- 3. USER ORGANIZATION MEMBERSHIP (0-100)
  -- ============================================
  IF p_user_id IS NOT NULL THEN
    SELECT 
      EXISTS(
        SELECT 1 FROM organization_contributors oc
        WHERE oc.organization_id = p_organization_id
          AND oc.user_id = p_user_id
          AND oc.status = 'active'
      ),
      oc.role
    INTO v_user_is_member, v_user_role
    FROM organization_contributors oc
    WHERE oc.organization_id = p_organization_id
      AND oc.user_id = p_user_id
      AND oc.status = 'active'
    LIMIT 1;
    
    IF v_user_is_member THEN
      -- High confidence if user is member
      v_user_org_confidence := 90;
      
      -- Boost for owner/manager roles
      IF v_user_role IN ('owner', 'manager', 'co_founder') THEN
        v_user_org_confidence := 95;
        v_relationship_type := 'owner';
      ELSIF v_user_role IN ('employee', 'technician') THEN
        v_relationship_type := 'work_location';
      END IF;
      
      v_sources := array_append(v_sources, 'user_org_membership');
      v_evidence_count := v_evidence_count + 1;
    END IF;
  END IF;
  
  -- ============================================
  -- 4. VIN MATCHING (0-100)
  -- ============================================
  -- Check if vehicle VIN matches other vehicles in this organization
  SELECT COUNT(DISTINCT v2.id)
  INTO v_vin_match_count
  FROM vehicles v1
  JOIN vehicles v2 ON v2.vin = v1.vin AND v2.id != v1.id
  JOIN organization_vehicles ov ON ov.vehicle_id = v2.id
  WHERE v1.id = p_vehicle_id
    AND v1.vin IS NOT NULL
    AND v1.vin != ''
    AND ov.organization_id = p_organization_id
    AND ov.status = 'active';
  
  IF v_vin_match_count > 0 THEN
    -- High confidence for VIN matches (same vehicle, different relationship)
    v_vin_match_confidence := 85;
    
    -- Boost for multiple matches
    IF v_vin_match_count > 1 THEN
      v_vin_match_confidence := 95;
    END IF;
    
    v_sources := array_append(v_sources, 'vin_match');
    v_evidence_count := v_evidence_count + 1;
  END IF;
  
  -- ============================================
  -- 5. HISTORICAL PATTERNS (0-100)
  -- ============================================
  -- Check if user has historically linked vehicles to this org
  IF p_user_id IS NOT NULL THEN
    SELECT COUNT(DISTINCT ov.vehicle_id)
    INTO v_historical_match_count
    FROM organization_vehicles ov
    WHERE ov.organization_id = p_organization_id
      AND ov.linked_by_user_id = p_user_id
      AND ov.status = 'active'
      AND ov.created_at > NOW() - INTERVAL '90 days';
    
    IF v_historical_match_count > 0 THEN
      -- Confidence based on historical frequency
      v_historical_confidence := LEAST(100, 50 + (v_historical_match_count * 5));
      
      v_sources := array_append(v_sources, 'historical_pattern');
      v_evidence_count := v_evidence_count + 1;
    END IF;
  END IF;
  
  -- ============================================
  -- 6. IMAGE COUNT BOOST (0-20)
  -- ============================================
  -- More images = more evidence
  SELECT COUNT(*)
  INTO v_image_count_confidence
  FROM vehicle_images
  WHERE vehicle_id = p_vehicle_id;
  
  IF v_image_count_confidence > 0 THEN
    v_image_count_confidence := LEAST(20, v_image_count_confidence * 2);
  END IF;
  
  -- ============================================
  -- CALCULATE OVERALL CONFIDENCE
  -- ============================================
  -- Weighted average with bonuses for multiple evidence sources
  v_overall := (
    (v_gps_confidence * 0.30) +
    (v_receipt_confidence * 0.25) +
    (v_user_org_confidence * 0.25) +
    (v_vin_match_confidence * 0.10) +
    (v_historical_confidence * 0.05) +
    (v_image_count_confidence * 0.05)
  );
  
  -- Bonus for multiple evidence sources (convergence)
  IF v_evidence_count > 1 THEN
    v_overall := LEAST(100, v_overall + (v_evidence_count * 3));
  END IF;
  
  -- Build confidence breakdown
  v_breakdown := jsonb_build_object(
    'gps', ROUND(v_gps_confidence, 2),
    'receipt', ROUND(v_receipt_confidence, 2),
    'user_org_membership', ROUND(v_user_org_confidence, 2),
    'vin_match', ROUND(v_vin_match_confidence, 2),
    'historical_pattern', ROUND(v_historical_confidence, 2),
    'image_count_boost', ROUND(v_image_count_confidence, 2)
  );
  
  RETURN QUERY SELECT
    ROUND(v_overall, 2)::NUMERIC,
    v_breakdown,
    v_sources,
    v_relationship_type,
    v_evidence_count;
END;
$$;

COMMENT ON FUNCTION calculate_vehicle_org_assignment_confidence IS 
'Comprehensive multi-factor confidence scoring for vehicle-organization assignments. 
Considers GPS, receipts, user memberships, VIN matching, and historical patterns.';

-- ==========================================================================
-- 3. AUTOMATIC ASSIGNMENT FUNCTION
-- ==========================================================================
-- Finds best organization matches for a vehicle and creates pending assignments

CREATE OR REPLACE FUNCTION suggest_vehicle_organization_assignments(
  p_vehicle_id UUID,
  p_user_id UUID DEFAULT NULL,
  p_auto_approve_threshold NUMERIC DEFAULT 80.0
)
RETURNS TABLE (
  organization_id UUID,
  business_name TEXT,
  suggested_relationship_type TEXT,
  overall_confidence NUMERIC,
  status TEXT,
  evidence_sources TEXT[]
)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_org RECORD;
  v_confidence RECORD;
  v_assignment_status TEXT;
BEGIN
  -- Find all potential organizations
  FOR v_org IN
    SELECT DISTINCT b.id, b.business_name
    FROM businesses b
    WHERE b.is_public = true
      AND (
        -- Has GPS coordinates (for GPS matching)
        (b.latitude IS NOT NULL AND b.longitude IS NOT NULL) OR
        -- User is member (for user org matching)
        (p_user_id IS NOT NULL AND EXISTS(
          SELECT 1 FROM organization_contributors oc
          WHERE oc.organization_id = b.id
            AND oc.user_id = p_user_id
            AND oc.status = 'active'
        )) OR
        -- Has similar name to receipts (for receipt matching)
        EXISTS(
          SELECT 1 FROM vehicle_documents vd
          WHERE vd.vehicle_id = p_vehicle_id
            AND vd.vendor_name IS NOT NULL
            AND similarity(LOWER(b.business_name), LOWER(vd.vendor_name)) > 0.5
        )
      )
  LOOP
    -- Calculate confidence for this organization
    SELECT * INTO v_confidence
    FROM calculate_vehicle_org_assignment_confidence(
      p_vehicle_id,
      v_org.id,
      p_user_id
    );
    
    -- Only suggest if confidence > 0
    IF v_confidence.overall_confidence > 0 THEN
      -- Determine status based on confidence
      IF v_confidence.overall_confidence >= p_auto_approve_threshold THEN
        v_assignment_status := 'auto_approved';
        
        -- Auto-create organization_vehicles record
        INSERT INTO organization_vehicles (
          organization_id,
          vehicle_id,
          relationship_type,
          auto_tagged,
          gps_match_confidence,
          linked_by_user_id,
          status
        )
        VALUES (
          v_org.id,
          p_vehicle_id,
          v_confidence.suggested_relationship_type,
          true,
          v_confidence.overall_confidence,
          p_user_id,
          'active'
        )
        ON CONFLICT (organization_id, vehicle_id, relationship_type)
        DO UPDATE SET
          gps_match_confidence = GREATEST(
            organization_vehicles.gps_match_confidence,
            v_confidence.overall_confidence
          ),
          auto_tagged = true,
          status = 'active',
          updated_at = NOW();
      ELSE
        v_assignment_status := 'pending';
        
        -- Create pending assignment for review
        INSERT INTO pending_vehicle_assignments (
          vehicle_id,
          organization_id,
          suggested_relationship_type,
          overall_confidence,
          confidence_breakdown,
          evidence_sources,
          evidence_count,
          suggested_by_user_id,
          status,
          auto_approve_threshold
        )
        VALUES (
          p_vehicle_id,
          v_org.id,
          v_confidence.suggested_relationship_type,
          v_confidence.overall_confidence,
          v_confidence.confidence_breakdown,
          v_confidence.evidence_sources,
          v_confidence.evidence_count,
          p_user_id,
          'pending',
          p_auto_approve_threshold
        )
        ON CONFLICT (vehicle_id, organization_id, suggested_relationship_type, status)
        DO UPDATE SET
          overall_confidence = EXCLUDED.overall_confidence,
          confidence_breakdown = EXCLUDED.confidence_breakdown,
          evidence_sources = EXCLUDED.evidence_sources,
          evidence_count = EXCLUDED.evidence_count,
          updated_at = NOW();
      END IF;
      
      RETURN QUERY SELECT
        v_org.id,
        v_org.business_name,
        v_confidence.suggested_relationship_type,
        v_confidence.overall_confidence,
        v_assignment_status,
        v_confidence.evidence_sources;
    END IF;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION suggest_vehicle_organization_assignments IS 
'Automatically suggests vehicle-organization assignments with confidence scoring.
High-confidence assignments (>= threshold) are auto-approved, others are pending review.';

-- ==========================================================================
-- 4. TRIGGER: AUTO-SUGGEST ON VEHICLE CREATION/UPDATE
-- ==========================================================================

CREATE OR REPLACE FUNCTION trigger_suggest_vehicle_assignments()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  -- Only run if vehicle has meaningful data (not just created empty)
  IF NEW.vin IS NOT NULL OR EXISTS(
    SELECT 1 FROM vehicle_images WHERE vehicle_id = NEW.id
  ) THEN
    -- Suggest assignments (async via function call)
    PERFORM suggest_vehicle_organization_assignments(
      NEW.id,
      NEW.uploaded_by,
      80.0  -- Auto-approve threshold
    );
  END IF;
  
  RETURN NEW;
END;
$$;

-- Trigger on vehicle creation
DROP TRIGGER IF EXISTS trg_suggest_assignments_on_vehicle_create ON vehicles;
CREATE TRIGGER trg_suggest_assignments_on_vehicle_create
  AFTER INSERT ON vehicles
  FOR EACH ROW
  EXECUTE FUNCTION trigger_suggest_vehicle_assignments();

-- Trigger on vehicle update (when new images/receipts added)
DROP TRIGGER IF EXISTS trg_suggest_assignments_on_vehicle_update ON vehicles;
CREATE TRIGGER trg_suggest_assignments_on_vehicle_update
  AFTER UPDATE OF vin, updated_at ON vehicles
  FOR EACH ROW
  WHEN (OLD.vin IS DISTINCT FROM NEW.vin OR NEW.updated_at > OLD.updated_at)
  EXECUTE FUNCTION trigger_suggest_vehicle_assignments();

-- ==========================================================================
-- 5. FUNCTION: APPROVE PENDING ASSIGNMENT
-- ==========================================================================

CREATE OR REPLACE FUNCTION approve_pending_assignment(
  p_assignment_id UUID,
  p_user_id UUID,
  p_notes TEXT DEFAULT NULL
)
RETURNS BOOLEAN
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_assignment RECORD;
BEGIN
  -- Get assignment
  SELECT * INTO v_assignment
  FROM pending_vehicle_assignments
  WHERE id = p_assignment_id
    AND status = 'pending';
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assignment not found or already processed';
  END IF;
  
  -- Create organization_vehicles record
  INSERT INTO organization_vehicles (
    organization_id,
    vehicle_id,
    relationship_type,
    auto_tagged,
    gps_match_confidence,
    linked_by_user_id,
    status
  )
  VALUES (
    v_assignment.organization_id,
    v_assignment.vehicle_id,
    v_assignment.suggested_relationship_type,
    true,
    v_assignment.overall_confidence,
    p_user_id,
    'active'
  )
  ON CONFLICT (organization_id, vehicle_id, relationship_type)
  DO UPDATE SET
    gps_match_confidence = GREATEST(
      organization_vehicles.gps_match_confidence,
      v_assignment.overall_confidence
    ),
    auto_tagged = true,
    status = 'active',
    updated_at = NOW();
  
  -- Update assignment status
  UPDATE pending_vehicle_assignments
  SET 
    status = 'approved',
    reviewed_by_user_id = p_user_id,
    reviewed_at = NOW(),
    review_notes = p_notes,
    updated_at = NOW()
  WHERE id = p_assignment_id;
  
  RETURN true;
END;
$$;

COMMENT ON FUNCTION approve_pending_assignment IS 'Approve a pending vehicle-organization assignment';

-- ==========================================================================
-- 6. FUNCTION: REJECT PENDING ASSIGNMENT
-- ==========================================================================

CREATE OR REPLACE FUNCTION reject_pending_assignment(
  p_assignment_id UUID,
  p_user_id UUID,
  p_notes TEXT DEFAULT NULL
)
RETURNS BOOLEAN
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE pending_vehicle_assignments
  SET 
    status = 'rejected',
    reviewed_by_user_id = p_user_id,
    reviewed_at = NOW(),
    review_notes = p_notes,
    updated_at = NOW()
  WHERE id = p_assignment_id
    AND status = 'pending';
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assignment not found or already processed';
  END IF;
  
  RETURN true;
END;
$$;

COMMENT ON FUNCTION reject_pending_assignment IS 'Reject a pending vehicle-organization assignment';

-- ==========================================================================
-- 7. RLS POLICIES
-- ==========================================================================

ALTER TABLE pending_vehicle_assignments ENABLE ROW LEVEL SECURITY;

-- Users can view pending assignments for their vehicles
CREATE POLICY "Users can view pending assignments for their vehicles"
ON pending_vehicle_assignments FOR SELECT
USING (
  vehicle_id IN (
    SELECT id FROM vehicles WHERE uploaded_by = auth.uid()
  ) OR
  vehicle_id IN (
    SELECT vehicle_id FROM organization_vehicles ov
    JOIN organization_contributors oc ON oc.organization_id = ov.organization_id
    WHERE oc.user_id = auth.uid() AND oc.status = 'active'
  )
);

-- Users can approve/reject assignments for their vehicles
CREATE POLICY "Users can update pending assignments for their vehicles"
ON pending_vehicle_assignments FOR UPDATE
USING (
  vehicle_id IN (
    SELECT id FROM vehicles WHERE uploaded_by = auth.uid()
  ) OR
  vehicle_id IN (
    SELECT vehicle_id FROM organization_vehicles ov
    JOIN organization_contributors oc ON oc.organization_id = ov.organization_id
    WHERE oc.user_id = auth.uid() 
      AND oc.status = 'active'
      AND oc.role IN ('owner', 'manager')
  )
);

-- Service role full access
CREATE POLICY "Service role full access to pending assignments"
ON pending_vehicle_assignments FOR ALL
TO service_role
USING (true);

