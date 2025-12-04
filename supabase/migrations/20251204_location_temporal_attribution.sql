-- Location-Temporal Attribution System
-- 
-- Problem: Multiple organizations share same address at different times
-- Solution: Use GPS + date + work type to attribute correctly
--
-- Example:
-- - 707 Yucca St = Viva + Taylor + Ernies (all same location!)
-- - 676 Wells Rd = Nuke Ltd + co-located companies (different date ranges)
--
-- Need: Work type + date range to disambiguate

BEGIN;

-- ============================================
-- 1. ORGANIZATION LOCATION HISTORY
-- ============================================
-- Track when organizations were active at specific locations

CREATE TABLE IF NOT EXISTS organization_location_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  organization_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  
  -- Location
  address TEXT NOT NULL,
  latitude NUMERIC(10, 8),
  longitude NUMERIC(11, 8),
  
  -- Time period
  active_from DATE,
  active_until DATE,  -- NULL = still active
  
  -- What they did here
  capabilities TEXT[],  -- ['paint', 'upholstery', 'storage', 'assembly']
  primary_work_type TEXT,  -- Main specialty at this location
  
  -- Confidence
  date_confidence INTEGER CHECK (date_confidence BETWEEN 0 AND 100),
  source TEXT,  -- 'user_input', 'receipt_dates', 'photo_dates', 'inferred'
  
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_org_location_periods_org ON organization_location_periods(organization_id);
CREATE INDEX idx_org_location_periods_dates ON organization_location_periods(active_from, active_until);
CREATE INDEX idx_org_location_periods_address ON organization_location_periods(address);

-- ============================================
-- 2. SEED KNOWN DATA
-- ============================================

-- 707 Yucca St - Shared by Viva, Taylor, Ernies
INSERT INTO organization_location_periods (organization_id, address, latitude, longitude, active_from, capabilities, primary_work_type, date_confidence, source) 
SELECT 
  id,
  '707 Yucca St, Boulder City, NV 89005',
  35.972831,  -- Cluster 12 GPS
  -114.855897,
  '2020-01-01',  -- TBD: Need actual start dates
  CASE 
    WHEN business_name ILIKE '%viva%' THEN ARRAY['general_repair', 'restoration', 'storage']
    WHEN business_name ILIKE '%taylor%' THEN ARRAY['paint', 'bodywork', 'custom_paint']
    WHEN business_name ILIKE '%ernie%' THEN ARRAY['upholstery', 'interior', 'seats']
  END,
  CASE 
    WHEN business_name ILIKE '%viva%' THEN 'general_repair'
    WHEN business_name ILIKE '%taylor%' THEN 'paint'
    WHEN business_name ILIKE '%ernie%' THEN 'upholstery'
  END,
  50,  -- Low confidence until dates refined
  'initial_setup'
FROM businesses
WHERE business_name IN ('Viva! Las Vegas Autos', 'Taylor Customs', 'Ernies Upholstery')
ON CONFLICT DO NOTHING;

-- 676 Wells Rd - Nuke Ltd (transient)
INSERT INTO organization_location_periods (organization_id, address, latitude, longitude, active_from, active_until, capabilities, primary_work_type, date_confidence, source, notes)
SELECT 
  id,
  '676 Wells Rd, Boulder City, NV 89005',
  35.977414,  -- Cluster 1 GPS
  -114.854111,
  '2024-04-01',  -- TBD: Need actual dates
  NULL,  -- Still determining end date
  ARRAY['assembly', 'fabrication', 'storage', 'project_management'],
  'project_management',
  30,  -- Very low confidence - transient dates unknown
  'initial_setup',
  'Nuke Ltd was transient - exact date ranges TBD'
FROM businesses
WHERE business_name ILIKE '%nuke%'
ON CONFLICT DO NOTHING;

-- ============================================
-- 3. SMART ATTRIBUTION FUNCTION
-- ============================================
-- Attributes work to correct org based on location + date + work type

CREATE OR REPLACE FUNCTION attribute_work_by_location_and_time(
  p_latitude NUMERIC,
  p_longitude NUMERIC,
  p_work_date DATE,
  p_work_type TEXT DEFAULT NULL
)
RETURNS TABLE(
  organization_id UUID,
  organization_name TEXT,
  confidence INTEGER,
  match_reason TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    b.id,
    b.business_name,
    CASE 
      -- Perfect match: location + date + work type
      WHEN p_work_type IS NOT NULL 
           AND olp.primary_work_type = p_work_type THEN 95
      -- Good match: location + date, work type compatible
      WHEN p_work_type IS NOT NULL 
           AND p_work_type = ANY(olp.capabilities) THEN 85
      -- Medium match: location + date only
      WHEN p_work_type IS NULL THEN 70
      -- Low match: location + date, but wrong work type
      ELSE 50
    END AS confidence,
    CASE 
      WHEN p_work_type IS NOT NULL AND olp.primary_work_type = p_work_type 
        THEN format('Exact match: %s work at %s during active period', p_work_type, olp.address)
      WHEN p_work_type IS NOT NULL AND p_work_type = ANY(olp.capabilities)
        THEN format('Compatible: %s is in capabilities at %s', p_work_type, olp.address)
      ELSE format('Location match: %s active at this address', b.business_name)
    END AS match_reason
  FROM organization_location_periods olp
  JOIN businesses b ON b.id = olp.organization_id
  WHERE 
    -- GPS within 100 meters
    ST_DWithin(
      ST_MakePoint(olp.longitude, olp.latitude)::geography,
      ST_MakePoint(p_longitude, p_latitude)::geography,
      100
    )
    -- Active during work date
    AND (olp.active_from IS NULL OR olp.active_from <= p_work_date)
    AND (olp.active_until IS NULL OR olp.active_until >= p_work_date)
  ORDER BY confidence DESC, b.business_name;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION attribute_work_by_location_and_time IS 
'Attributes work to organizations using GPS + date + work type. Handles shared addresses by temporal + capability matching.';

-- ============================================
-- 4. HELPER: Refine date ranges from photo evidence
-- ============================================

CREATE OR REPLACE FUNCTION refine_organization_dates_from_photos(
  p_organization_id UUID
)
RETURNS JSONB AS $$
DECLARE
  v_result JSONB;
  v_address TEXT;
  v_earliest DATE;
  v_latest DATE;
  v_photo_count INTEGER;
BEGIN
  -- Get organization's address
  SELECT address INTO v_address
  FROM organization_location_periods
  WHERE organization_id = p_organization_id
  LIMIT 1;
  
  IF v_address IS NULL THEN
    RETURN jsonb_build_object('error', 'No address found for organization');
  END IF;
  
  -- Find photos taken at this location
  SELECT 
    MIN(taken_at::DATE),
    MAX(taken_at::DATE),
    COUNT(*)
  INTO v_earliest, v_latest, v_photo_count
  FROM vehicle_images vi
  JOIN organization_location_periods olp ON 
    ST_DWithin(
      ST_MakePoint(olp.longitude, olp.latitude)::geography,
      ST_MakePoint(vi.longitude, vi.latitude)::geography,
      50  -- Within 50 meters
    )
  WHERE olp.organization_id = p_organization_id
    AND vi.taken_at IS NOT NULL;
  
  -- Update organization location period with photo evidence
  IF v_earliest IS NOT NULL THEN
    UPDATE organization_location_periods
    SET 
      active_from = LEAST(COALESCE(active_from, v_earliest), v_earliest),
      active_until = CASE 
        WHEN active_until IS NULL THEN v_latest
        ELSE GREATEST(active_until, v_latest)
      END,
      date_confidence = 85,  -- Photo evidence = high confidence
      source = 'photo_dates',
      updated_at = NOW()
    WHERE organization_id = p_organization_id;
  END IF;
  
  RETURN jsonb_build_object(
    'organization_id', p_organization_id,
    'address', v_address,
    'earliest_photo', v_earliest,
    'latest_photo', v_latest,
    'photo_count', v_photo_count,
    'confidence', 85
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION refine_organization_dates_from_photos IS 
'Uses photo dates to refine when organizations were active at locations. Auto-discovers date ranges from evidence.';

COMMIT;

