-- ==========================================================================
-- COLLABORATION & RESPONSIBILITY SYSTEM
-- ==========================================================================
-- Purpose: Track data originator vs responsible party
-- Problem: Viva imported data but doesn't own/manage many vehicles
-- Solution: Separate "uploaded_by" (originator) from "responsible_party"
-- ==========================================================================

-- ==========================================================================
-- 1. ADD RESPONSIBLE PARTY TRACKING
-- ==========================================================================

ALTER TABLE organization_vehicles
ADD COLUMN IF NOT EXISTS responsible_party_user_id UUID REFERENCES auth.users(id),
ADD COLUMN IF NOT EXISTS assigned_by_user_id UUID REFERENCES auth.users(id),
ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS responsibility_type TEXT CHECK (responsibility_type IN (
  'owner',           -- Legal owner
  'manager',         -- Managing the vehicle (dealer principal, sales manager)
  'listing_agent',   -- Responsible for selling/listing
  'custodian',       -- Physical custody
  'consignment_agent', -- Handling consignment sale
  'data_contributor' -- Just added data, not responsible
)),
ADD COLUMN IF NOT EXISTS responsibility_notes TEXT,
ADD COLUMN IF NOT EXISTS pending_responsibility_transfer BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_org_vehicles_responsible_party 
ON organization_vehicles(responsible_party_user_id) 
WHERE responsible_party_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_org_vehicles_pending_transfer
ON organization_vehicles(pending_responsibility_transfer)
WHERE pending_responsibility_transfer = true;

COMMENT ON COLUMN organization_vehicles.responsible_party_user_id IS 'User responsible for this vehicle (may differ from data originator)';
COMMENT ON COLUMN organization_vehicles.responsibility_type IS 'Type of responsibility this party has';

-- ==========================================================================
-- 2. VEHICLE COLLABORATORS TABLE
-- ==========================================================================
-- Track all users who have contributed to or are involved with a vehicle
-- ==========================================================================

CREATE TABLE IF NOT EXISTS vehicle_collaborators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES businesses(id) ON DELETE SET NULL,
  
  -- Role
  role TEXT NOT NULL CHECK (role IN (
    'owner',
    'co_owner',
    'manager',
    'contributor',
    'photographer',
    'technician',
    'appraiser',
    'viewer'
  )),
  
  -- Permissions
  can_edit BOOLEAN DEFAULT false,
  can_delete BOOLEAN DEFAULT false,
  can_approve BOOLEAN DEFAULT false,
  can_sell BOOLEAN DEFAULT false,
  
  -- Status
  status TEXT DEFAULT 'active' CHECK (status IN ('pending', 'active', 'inactive', 'rejected')),
  invited_by_user_id UUID REFERENCES auth.users(id),
  invitation_sent_at TIMESTAMPTZ,
  invitation_accepted_at TIMESTAMPTZ,
  
  -- Contribution tracking
  contribution_count INTEGER DEFAULT 0,
  last_contribution_at TIMESTAMPTZ,
  
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(vehicle_id, user_id, organization_id)
);

CREATE INDEX IF NOT EXISTS idx_vehicle_collaborators_vehicle ON vehicle_collaborators(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_collaborators_user ON vehicle_collaborators(user_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_collaborators_org ON vehicle_collaborators(organization_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_collaborators_pending ON vehicle_collaborators(status) WHERE status = 'pending';

COMMENT ON TABLE vehicle_collaborators IS 'Tracks all users involved with a vehicle and their roles/permissions';

-- ==========================================================================
-- 3. COLLABORATION NOTIFICATIONS TABLE
-- ==========================================================================

CREATE TABLE IF NOT EXISTS collaboration_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_type TEXT NOT NULL CHECK (notification_type IN (
    'verify_responsibility',      -- "Are you responsible for this vehicle?"
    'collaboration_invite',       -- "You've been invited to collaborate"
    'responsibility_transfer',    -- "Vehicle responsibility transferred to you"
    'data_quality_check',        -- "Please verify this vehicle data"
    'missing_vin',               -- "This vehicle needs a VIN to be public"
    'invalid_vin',               -- "This vehicle has an invalid VIN"
    'assignment_needed'          -- "This vehicle needs a responsible party"
  )),
  
  -- Recipients
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  
  -- Related entities
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
  collaboration_id UUID REFERENCES vehicle_collaborators(id) ON DELETE CASCADE,
  org_vehicle_id UUID REFERENCES organization_vehicles(id) ON DELETE CASCADE,
  
  -- Notification content
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  action_url TEXT,
  action_label TEXT,
  
  -- Metadata
  metadata JSONB DEFAULT '{}'::JSONB,
  priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  
  -- Status
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'read', 'acted', 'dismissed', 'expired')),
  sent_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  acted_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 days'),
  
  created_by_user_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_collab_notif_user ON collaboration_notifications(user_id, status);
CREATE INDEX IF NOT EXISTS idx_collab_notif_org ON collaboration_notifications(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_collab_notif_vehicle ON collaboration_notifications(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_collab_notif_pending ON collaboration_notifications(status) WHERE status IN ('pending', 'sent');
CREATE INDEX IF NOT EXISTS idx_collab_notif_expires ON collaboration_notifications(expires_at) WHERE status IN ('pending', 'sent');

COMMENT ON TABLE collaboration_notifications IS 'Notifications for collaboration and responsibility verification';

-- ==========================================================================
-- 4. FUNCTION: Send Collaboration Verification Notifications
-- ==========================================================================

CREATE OR REPLACE FUNCTION send_collaboration_verification(
  p_organization_id UUID,
  p_vehicle_ids UUID[] DEFAULT NULL
) RETURNS INTEGER AS $$
DECLARE
  v_vehicle RECORD;
  v_collaborator RECORD;
  v_org_name TEXT;
  v_notification_count INTEGER := 0;
BEGIN
  -- Get organization name
  SELECT business_name INTO v_org_name
  FROM businesses
  WHERE id = p_organization_id;
  
  -- Get all organization members/contributors
  FOR v_collaborator IN
    SELECT DISTINCT 
      oc.user_id,
      oc.role,
      p.full_name,
      p.email
    FROM organization_contributors oc
    JOIN profiles p ON p.id = oc.user_id
    WHERE oc.organization_id = p_organization_id
      AND oc.status = 'active'
      AND oc.role IN ('owner', 'manager', 'employee', 'contributor')
  LOOP
    -- Get vehicles linked to this org (filter by specific vehicle_ids if provided)
    FOR v_vehicle IN
      SELECT 
        ov.id as org_vehicle_id,
        ov.vehicle_id,
        ov.relationship_type,
        ov.responsible_party_user_id,
        v.year,
        v.make,
        v.model,
        v.vin,
        v.vin_is_valid,
        v.uploaded_by,
        (SELECT COUNT(*) FROM vehicle_images WHERE vehicle_id = v.id) as image_count
      FROM organization_vehicles ov
      JOIN vehicles v ON v.id = ov.vehicle_id
      WHERE ov.organization_id = p_organization_id
        AND ov.status = 'active'
        AND (p_vehicle_ids IS NULL OR ov.vehicle_id = ANY(p_vehicle_ids))
        AND ov.responsible_party_user_id IS NULL  -- No responsible party assigned yet
    LOOP
      -- Create notification
      INSERT INTO collaboration_notifications (
        notification_type,
        user_id,
        organization_id,
        vehicle_id,
        org_vehicle_id,
        title,
        message,
        action_url,
        action_label,
        priority,
        metadata
      ) VALUES (
        'verify_responsibility',
        v_collaborator.user_id,
        p_organization_id,
        v_vehicle.vehicle_id,
        v_vehicle.org_vehicle_id,
        'Verify Vehicle Responsibility',
        format(
          'Are you responsible for this %s %s %s at %s? Please verify your role or assign to the correct person.',
          v_vehicle.year,
          v_vehicle.make,
          v_vehicle.model,
          v_org_name
        ),
        format('/vehicles/%s', v_vehicle.vehicle_id),
        'Verify Now',
        CASE 
          WHEN v_vehicle.vin_is_valid = false THEN 'urgent'
          WHEN v_vehicle.image_count > 5 THEN 'high'
          ELSE 'normal'
        END,
        jsonb_build_object(
          'vehicle', jsonb_build_object(
            'year', v_vehicle.year,
            'make', v_vehicle.make,
            'model', v_vehicle.model,
            'vin', v_vehicle.vin,
            'vin_is_valid', v_vehicle.vin_is_valid,
            'image_count', v_vehicle.image_count
          ),
          'relationship_type', v_vehicle.relationship_type,
          'collaborator_role', v_collaborator.role
        )
      )
      ON CONFLICT DO NOTHING;
      
      v_notification_count := v_notification_count + 1;
    END LOOP;
  END LOOP;
  
  RETURN v_notification_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION send_collaboration_verification IS 'Send notifications to org collaborators to verify vehicle responsibilities';

-- ==========================================================================
-- 5. FUNCTION: Assign Responsible Party
-- ==========================================================================

CREATE OR REPLACE FUNCTION assign_vehicle_responsibility(
  p_org_vehicle_id UUID,
  p_user_id UUID,
  p_responsibility_type TEXT,
  p_assigned_by_user_id UUID,
  p_notes TEXT DEFAULT NULL
) RETURNS BOOLEAN AS $$
DECLARE
  v_vehicle_id UUID;
  v_org_id UUID;
BEGIN
  -- Get vehicle and org IDs
  SELECT vehicle_id, organization_id INTO v_vehicle_id, v_org_id
  FROM organization_vehicles
  WHERE id = p_org_vehicle_id;
  
  -- Update organization_vehicles
  UPDATE organization_vehicles
  SET 
    responsible_party_user_id = p_user_id,
    responsibility_type = p_responsibility_type,
    assigned_by_user_id = p_assigned_by_user_id,
    assigned_at = NOW(),
    responsibility_notes = p_notes,
    pending_responsibility_transfer = false,
    updated_at = NOW()
  WHERE id = p_org_vehicle_id;
  
  -- Create or update vehicle_collaborators
  INSERT INTO vehicle_collaborators (
    vehicle_id,
    user_id,
    organization_id,
    role,
    can_edit,
    can_delete,
    can_approve,
    can_sell,
    status,
    invited_by_user_id,
    invitation_accepted_at
  ) VALUES (
    v_vehicle_id,
    p_user_id,
    v_org_id,
    CASE p_responsibility_type
      WHEN 'owner' THEN 'owner'
      WHEN 'manager' THEN 'manager'
      ELSE 'contributor'
    END,
    true,  -- can_edit
    CASE WHEN p_responsibility_type = 'owner' THEN true ELSE false END,  -- can_delete
    CASE WHEN p_responsibility_type IN ('owner', 'manager') THEN true ELSE false END,  -- can_approve
    CASE WHEN p_responsibility_type IN ('owner', 'manager', 'listing_agent') THEN true ELSE false END,  -- can_sell
    'active',
    p_assigned_by_user_id,
    NOW()
  )
  ON CONFLICT (vehicle_id, user_id, organization_id)
  DO UPDATE SET
    role = EXCLUDED.role,
    can_edit = EXCLUDED.can_edit,
    can_delete = EXCLUDED.can_delete,
    can_approve = EXCLUDED.can_approve,
    can_sell = EXCLUDED.can_sell,
    status = 'active',
    updated_at = NOW();
  
  -- Send notification to assigned user
  INSERT INTO collaboration_notifications (
    notification_type,
    user_id,
    organization_id,
    vehicle_id,
    org_vehicle_id,
    title,
    message,
    action_url,
    action_label,
    priority,
    created_by_user_id
  )
  SELECT
    'responsibility_transfer',
    p_user_id,
    v_org_id,
    v_vehicle_id,
    p_org_vehicle_id,
    'Vehicle Responsibility Assigned',
    format('You have been assigned as %s for %s %s %s',
      p_responsibility_type,
      v.year, v.make, v.model
    ),
    format('/vehicles/%s', v_vehicle_id),
    'View Vehicle',
    'high',
    p_assigned_by_user_id
  FROM vehicles v
  WHERE v.id = v_vehicle_id;
  
  RETURN true;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION assign_vehicle_responsibility IS 'Assign a responsible party to a vehicle and notify them';

-- ==========================================================================
-- 6. RLS POLICIES
-- ==========================================================================

ALTER TABLE vehicle_collaborators ENABLE ROW LEVEL SECURITY;
ALTER TABLE collaboration_notifications ENABLE ROW LEVEL SECURITY;

-- Vehicle collaborators: Users can see their own collaborations
CREATE POLICY "Users can view their collaborations"
ON vehicle_collaborators FOR SELECT
USING (
  user_id = auth.uid() OR
  vehicle_id IN (
    SELECT id FROM vehicles WHERE uploaded_by = auth.uid()
  ) OR
  vehicle_id IN (
    SELECT vehicle_id FROM vehicle_collaborators WHERE user_id = auth.uid()
  )
);

CREATE POLICY "Users can manage collaborations for their vehicles"
ON vehicle_collaborators FOR ALL
USING (
  vehicle_id IN (
    SELECT id FROM vehicles WHERE uploaded_by = auth.uid()
  ) OR
  vehicle_id IN (
    SELECT vehicle_id FROM vehicle_collaborators 
    WHERE user_id = auth.uid() 
      AND can_approve = true
  )
);

-- Collaboration notifications: Users can see their own notifications
CREATE POLICY "Users can view their notifications"
ON collaboration_notifications FOR SELECT
USING (user_id = auth.uid());

CREATE POLICY "Users can update their notifications"
ON collaboration_notifications FOR UPDATE
USING (user_id = auth.uid());

-- Org members can see org notifications
CREATE POLICY "Org members can view org notifications"
ON collaboration_notifications FOR SELECT
USING (
  organization_id IN (
    SELECT organization_id FROM organization_contributors
    WHERE user_id = auth.uid() AND status = 'active'
  )
);

-- Allow service role full access
CREATE POLICY "Service role full access to collaborators"
ON vehicle_collaborators FOR ALL
TO service_role
USING (true);

CREATE POLICY "Service role full access to notifications"
ON collaboration_notifications FOR ALL
TO service_role
USING (true);

