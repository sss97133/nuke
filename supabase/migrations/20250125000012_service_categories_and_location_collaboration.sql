-- ==========================================================================
-- SERVICE CATEGORIES AND LOCATION-BASED COLLABORATION
-- ==========================================================================
-- Purpose: 
-- 1. Add service status categories (currently_in_service, service_archive)
-- 2. Enable multi-organization collaboration at same location (e.g., 707 Yucca)
-- 3. Allow companies to exchange work information on each other's vehicles
-- ==========================================================================

-- ==========================================================================
-- 1. ADD SERVICE STATUS TO ORGANIZATION_VEHICLES
-- ==========================================================================

-- Add service_status column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'organization_vehicles' 
      AND column_name = 'service_status'
  ) THEN
    ALTER TABLE organization_vehicles 
    ADD COLUMN service_status TEXT CHECK (service_status IN (
      'currently_in_service',  -- Vehicle is actively being worked on
      'service_archive',        -- Service work completed, archived
      NULL                      -- Not in service (default)
    ));
    
    COMMENT ON COLUMN organization_vehicles.service_status IS 
      'Service workflow status: currently_in_service (active work), service_archive (completed), or NULL (not in service)';
  END IF;
END $$;

-- Add index for service status queries
CREATE INDEX IF NOT EXISTS idx_org_vehicles_service_status 
  ON organization_vehicles(service_status) 
  WHERE service_status IS NOT NULL;

-- ==========================================================================
-- 2. LOCATION-BASED COLLABORATION SYSTEM
-- ==========================================================================

-- Table to link organizations at the same location for collaboration
CREATE TABLE IF NOT EXISTS location_collaborations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Location identifier (address, GPS, or custom location name)
  location_address TEXT NOT NULL,
  location_latitude NUMERIC(10, 8),
  location_longitude NUMERIC(11, 8),
  location_name TEXT, -- e.g., "707 Yucca St HQ"
  
  -- Organizations at this location
  organization_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  
  -- Collaboration settings
  can_view_vehicles BOOLEAN DEFAULT true,      -- Can see vehicles from other orgs at this location
  can_add_work BOOLEAN DEFAULT true,            -- Can add work/timeline events to other orgs' vehicles
  can_view_work_history BOOLEAN DEFAULT true,    -- Can see work history from other orgs
  can_upload_images BOOLEAN DEFAULT false,      -- Can upload images to other orgs' vehicles
  
  -- Permissions granted by
  granted_by_organization_id UUID REFERENCES businesses(id),
  granted_by_user_id UUID REFERENCES auth.users(id),
  
  -- Status
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'pending', 'revoked')),
  
  -- Metadata
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Prevent duplicate entries
  UNIQUE(organization_id, location_address)
);

CREATE INDEX IF NOT EXISTS idx_location_collaborations_org ON location_collaborations(organization_id);
CREATE INDEX IF NOT EXISTS idx_location_collaborations_location ON location_collaborations(location_address);
CREATE INDEX IF NOT EXISTS idx_location_collaborations_gps ON location_collaborations(location_latitude, location_longitude) 
  WHERE location_latitude IS NOT NULL AND location_longitude IS NOT NULL;

COMMENT ON TABLE location_collaborations IS 
  'Links organizations at the same physical location (e.g., 707 Yucca) to enable collaboration on vehicles';

-- ==========================================================================
-- 3. VEHICLE WORK CONTRIBUTIONS (track who did what work)
-- ==========================================================================

-- Table to track work contributions from collaborating organizations
CREATE TABLE IF NOT EXISTS vehicle_work_contributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Vehicle and organization
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  contributing_organization_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  vehicle_owner_organization_id UUID REFERENCES businesses(id), -- Org that owns the vehicle
  
  -- Work details
  work_type TEXT NOT NULL CHECK (work_type IN (
    'repair', 'maintenance', 'inspection', 'detailing', 'body_work', 
    'paint', 'fabrication', 'parts_installation', 'diagnostics', 'testing',
    'documentation', 'photography', 'other'
  )),
  work_description TEXT NOT NULL,
  work_date DATE NOT NULL,
  
  -- Timeline event link (if work was added as timeline event)
  timeline_event_id UUID REFERENCES business_timeline_events(id) ON DELETE SET NULL,
  
  -- Financial (optional)
  labor_hours NUMERIC(5,2),
  labor_rate NUMERIC(10,2),
  parts_cost NUMERIC(10,2),
  total_cost NUMERIC(10,2),
  
  -- Images/documentation
  images_uploaded INTEGER DEFAULT 0,
  notes TEXT,
  
  -- Status
  status TEXT DEFAULT 'completed' CHECK (status IN ('in_progress', 'completed', 'cancelled')),
  
  -- Attribution
  performed_by_user_id UUID REFERENCES auth.users(id),
  approved_by_owner BOOLEAN DEFAULT false,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_work_contributions_vehicle ON vehicle_work_contributions(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_work_contributions_contributor ON vehicle_work_contributions(contributing_organization_id);
CREATE INDEX IF NOT EXISTS idx_work_contributions_owner ON vehicle_work_contributions(vehicle_owner_organization_id);
CREATE INDEX IF NOT EXISTS idx_work_contributions_date ON vehicle_work_contributions(work_date DESC);
CREATE INDEX IF NOT EXISTS idx_work_contributions_timeline ON vehicle_work_contributions(timeline_event_id) 
  WHERE timeline_event_id IS NOT NULL;

COMMENT ON TABLE vehicle_work_contributions IS 
  'Tracks work contributions from collaborating organizations on vehicles. Enables multi-org collaboration at same location.';

-- ==========================================================================
-- 4. HELPER FUNCTIONS
-- ==========================================================================

-- Function to get all collaborating organizations at a location
CREATE OR REPLACE FUNCTION get_location_collaborators(
  p_location_address TEXT,
  p_organization_id UUID DEFAULT NULL
)
RETURNS TABLE(
  organization_id UUID,
  business_name TEXT,
  can_view_vehicles BOOLEAN,
  can_add_work BOOLEAN,
  can_view_work_history BOOLEAN,
  can_upload_images BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    b.id,
    b.business_name,
    lc.can_view_vehicles,
    lc.can_add_work,
    lc.can_view_work_history,
    lc.can_upload_images
  FROM location_collaborations lc
  JOIN businesses b ON b.id = lc.organization_id
  WHERE lc.location_address = p_location_address
    AND lc.status = 'active'
    AND (p_organization_id IS NULL OR lc.organization_id != p_organization_id)
  ORDER BY b.business_name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Function to get vehicles accessible to an organization at a location
CREATE OR REPLACE FUNCTION get_collaborative_vehicles(
  p_organization_id UUID,
  p_location_address TEXT
)
RETURNS TABLE(
  vehicle_id UUID,
  vehicle_year INTEGER,
  vehicle_make TEXT,
  vehicle_model TEXT,
  owner_organization_id UUID,
  owner_organization_name TEXT,
  service_status TEXT,
  can_add_work BOOLEAN,
  can_upload_images BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT
    v.id,
    v.year,
    v.make,
    v.model,
    ov.organization_id as owner_org_id,
    b.business_name as owner_org_name,
    ov.service_status,
    lc.can_add_work,
    lc.can_upload_images
  FROM vehicles v
  JOIN organization_vehicles ov ON ov.vehicle_id = v.id
  JOIN businesses b ON b.id = ov.organization_id
  JOIN location_collaborations lc ON lc.organization_id = p_organization_id
  WHERE lc.location_address = p_location_address
    AND lc.status = 'active'
    AND lc.can_view_vehicles = true
    AND ov.status = 'active'
    AND (ov.organization_id != p_organization_id OR ov.organization_id = p_organization_id) -- Include own vehicles too
  ORDER BY v.year DESC, v.make, v.model;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Function to get work contributions for a vehicle
CREATE OR REPLACE FUNCTION get_vehicle_work_contributions(
  p_vehicle_id UUID,
  p_organization_id UUID DEFAULT NULL
)
RETURNS TABLE(
  contribution_id UUID,
  contributing_organization_id UUID,
  contributing_organization_name TEXT,
  work_type TEXT,
  work_description TEXT,
  work_date DATE,
  labor_hours NUMERIC,
  total_cost NUMERIC,
  status TEXT,
  performed_by_user_id UUID
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    vwc.id,
    vwc.contributing_organization_id,
    b.business_name,
    vwc.work_type,
    vwc.work_description,
    vwc.work_date,
    vwc.labor_hours,
    vwc.total_cost,
    vwc.status,
    vwc.performed_by_user_id
  FROM vehicle_work_contributions vwc
  JOIN businesses b ON b.id = vwc.contributing_organization_id
  WHERE vwc.vehicle_id = p_vehicle_id
    AND (p_organization_id IS NULL OR vwc.contributing_organization_id = p_organization_id)
  ORDER BY vwc.work_date DESC, vwc.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ==========================================================================
-- 5. RLS POLICIES
-- ==========================================================================

ALTER TABLE location_collaborations ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_work_contributions ENABLE ROW LEVEL SECURITY;

-- Location collaborations: Organizations can view their own and others at same location
CREATE POLICY "Organizations can view location collaborations" ON location_collaborations
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM organization_contributors oc
      WHERE oc.organization_id = location_collaborations.organization_id
        AND oc.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM location_collaborations lc2
      WHERE lc2.location_address = location_collaborations.location_address
        AND EXISTS (
          SELECT 1 FROM organization_contributors oc2
          WHERE oc2.organization_id = lc2.organization_id
            AND oc2.user_id = auth.uid()
        )
    )
  );

-- Organizations can manage their own location collaborations
CREATE POLICY "Organizations can manage own location collaborations" ON location_collaborations
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM organization_contributors oc
      WHERE oc.organization_id = location_collaborations.organization_id
        AND oc.user_id = auth.uid()
        AND oc.role IN ('owner', 'co_founder', 'board_member', 'manager')
    )
  );

-- Work contributions: Viewable by vehicle owner and contributing organization
CREATE POLICY "View work contributions" ON vehicle_work_contributions
  FOR SELECT USING (
    -- Vehicle owner can see all contributions
    EXISTS (
      SELECT 1 FROM organization_vehicles ov
      WHERE ov.vehicle_id = vehicle_work_contributions.vehicle_id
        AND EXISTS (
          SELECT 1 FROM organization_contributors oc
          WHERE oc.organization_id = ov.organization_id
            AND oc.user_id = auth.uid()
        )
    )
    OR
    -- Contributing organization can see their own contributions
    EXISTS (
      SELECT 1 FROM organization_contributors oc
      WHERE oc.organization_id = vehicle_work_contributions.contributing_organization_id
        AND oc.user_id = auth.uid()
    )
  );

-- Contributing organizations can add work if they have permission
CREATE POLICY "Add work contributions" ON vehicle_work_contributions
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM organization_contributors oc
      WHERE oc.organization_id = vehicle_work_contributions.contributing_organization_id
        AND oc.user_id = auth.uid()
        AND EXISTS (
          SELECT 1 FROM location_collaborations lc
          JOIN organization_vehicles ov ON ov.vehicle_id = vehicle_work_contributions.vehicle_id
          JOIN businesses b ON b.id = ov.organization_id
          WHERE lc.organization_id = vehicle_work_contributions.contributing_organization_id
            AND lc.location_address = COALESCE(b.address, '')
            AND lc.can_add_work = true
            AND lc.status = 'active'
        )
    )
  );

-- Contributing organizations can update their own work
CREATE POLICY "Update own work contributions" ON vehicle_work_contributions
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM organization_contributors oc
      WHERE oc.organization_id = vehicle_work_contributions.contributing_organization_id
        AND oc.user_id = auth.uid()
    )
  );

-- ==========================================================================
-- 6. GRANTS
-- ==========================================================================

GRANT SELECT, INSERT, UPDATE ON location_collaborations TO authenticated;
GRANT SELECT, INSERT, UPDATE ON vehicle_work_contributions TO authenticated;
GRANT EXECUTE ON FUNCTION get_location_collaborators(TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_collaborative_vehicles(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_vehicle_work_contributions(UUID, UUID) TO authenticated;

