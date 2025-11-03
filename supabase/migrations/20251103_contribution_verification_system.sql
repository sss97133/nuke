-- CONTRIBUTION VERIFICATION SYSTEM
-- For retroactive work documentation with proper attribution

-- Main table for contribution submissions
CREATE TABLE IF NOT EXISTS contribution_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Who contributed
  contributor_id UUID NOT NULL REFERENCES auth.users(id),
  
  -- What vehicle
  vehicle_id UUID NOT NULL REFERENCES vehicles(id),
  
  -- What was contributed
  contribution_type TEXT NOT NULL CHECK (contribution_type IN (
    'work_images',
    'timeline_event',
    'repair_documentation',
    'parts_receipt',
    'before_after_photos',
    'diagnostic_data'
  )),
  
  -- Link to actual contributions (pending approval)
  image_ids UUID[] DEFAULT '{}', -- Array of vehicle_images.id
  timeline_event_id UUID REFERENCES vehicle_timeline_events(id),
  document_url TEXT,
  
  -- Context about the work
  work_date DATE NOT NULL, -- When the work was done (from EXIF or user input)
  work_date_source TEXT, -- 'exif', 'user_input', 'estimated'
  
  -- Responsible party (who can verify this work)
  responsible_party_type TEXT NOT NULL CHECK (responsible_party_type IN (
    'organization', -- Worked for a shop/dealer
    'vehicle_owner', -- Worked directly for vehicle owner
    'self', -- Own vehicle, self-documentation
    'contractor_to_org', -- Contractor hired by organization
    'contractor_to_owner' -- Contractor hired directly by owner
  )),
  responsible_party_org_id UUID REFERENCES businesses(id), -- If worked for organization
  responsible_party_user_id UUID REFERENCES auth.users(id), -- If worked for individual
  
  -- Work details
  work_category TEXT CHECK (work_category IN (
    'fabrication', 'welding', 'paint', 'bodywork', 'upholstery',
    'mechanical', 'electrical', 'suspension', 'engine_work',
    'transmission', 'brake_system', 'restoration', 'detailing',
    'diagnostic', 'inspection', 'maintenance', 'repair', 'modification'
  )),
  work_description TEXT,
  labor_hours NUMERIC,
  estimated_value NUMERIC,
  
  -- Verification workflow
  status TEXT DEFAULT 'pending' CHECK (status IN (
    'pending', -- Awaiting verification
    'approved', -- Verified by responsible party
    'rejected', -- Responsible party says this didn't happen
    'auto_approved', -- Auto-approved after timeout
    'disputed' -- Contributor disputes rejection
  )),
  
  -- Who needs to approve (can be multiple people)
  requires_approval_from UUID[] NOT NULL, -- Array of user IDs who can approve
  notification_sent_to UUID[], -- Track who was notified
  notified_at TIMESTAMPTZ,
  
  -- Review results
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT,
  
  -- Auto-approve after 30 days (responsible party had chance to object)
  auto_approve_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 days'),
  auto_approved BOOLEAN DEFAULT FALSE,
  
  -- Metadata
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for queries
CREATE INDEX IF NOT EXISTS idx_contribution_submissions_contributor ON contribution_submissions(contributor_id);
CREATE INDEX IF NOT EXISTS idx_contribution_submissions_vehicle ON contribution_submissions(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_contribution_submissions_status ON contribution_submissions(status);
CREATE INDEX IF NOT EXISTS idx_contribution_submissions_responsible_org ON contribution_submissions(responsible_party_org_id);
CREATE INDEX IF NOT EXISTS idx_contribution_submissions_auto_approve ON contribution_submissions(auto_approve_at) WHERE status = 'pending';

-- Track image verification status
ALTER TABLE vehicle_images
ADD COLUMN IF NOT EXISTS verification_status TEXT DEFAULT 'approved' CHECK (verification_status IN ('pending', 'approved', 'rejected'));

ALTER TABLE vehicle_images
ADD COLUMN IF NOT EXISTS pending_submission_id UUID REFERENCES contribution_submissions(id);

-- Add comment
COMMENT ON TABLE contribution_submissions IS 'Tracks work contributions that need verification from responsible party (employer, shop owner, vehicle owner)';
COMMENT ON COLUMN contribution_submissions.responsible_party_type IS 'Who is responsible for verifying this work occurred';
COMMENT ON COLUMN contribution_submissions.requires_approval_from IS 'Array of user IDs who have authority to verify';
COMMENT ON COLUMN contribution_submissions.auto_approve_at IS 'Auto-approve after 30 days if no objection (responsible party had opportunity to reject)';

-- Function: Get responsible party approvers
CREATE OR REPLACE FUNCTION get_responsible_party_approvers(
  p_vehicle_id UUID,
  p_work_date DATE,
  p_responsible_party_type TEXT,
  p_responsible_party_org_id UUID,
  p_responsible_party_user_id UUID
) RETURNS UUID[] AS $$
DECLARE
  v_approvers UUID[];
BEGIN
  -- Case 1: Work done for organization
  IF p_responsible_party_type IN ('organization', 'contractor_to_org') AND p_responsible_party_org_id IS NOT NULL THEN
    -- Get org admins (owner, co_founder, manager)
    SELECT ARRAY_AGG(DISTINCT user_id)
    INTO v_approvers
    FROM organization_contributors
    WHERE organization_id = p_responsible_party_org_id
      AND role IN ('owner', 'co_founder', 'manager')
      AND status = 'active';
  
  -- Case 2: Work done directly for vehicle owner
  ELSIF p_responsible_party_type IN ('vehicle_owner', 'contractor_to_owner') THEN
    -- Find who owned the vehicle at that time
    -- For now, use current owner (TODO: implement historical ownership tracking)
    SELECT ARRAY_AGG(DISTINCT user_id)
    INTO v_approvers
    FROM vehicles
    WHERE id = p_vehicle_id
      AND user_id IS NOT NULL;
    
    -- If no individual owner, check org ownership
    IF v_approvers IS NULL OR array_length(v_approvers, 1) = 0 THEN
      SELECT ARRAY_AGG(DISTINCT oc.user_id)
      INTO v_approvers
      FROM organization_vehicles ov
      JOIN organization_contributors oc ON ov.organization_id = oc.organization_id
      WHERE ov.vehicle_id = p_vehicle_id
        AND oc.role IN ('owner', 'co_founder', 'manager')
        AND oc.status = 'active';
    END IF;
  
  -- Case 3: Self-documentation (own vehicle)
  ELSIF p_responsible_party_type = 'self' THEN
    -- Self-approve (contributor is also owner)
    v_approvers := ARRAY[p_responsible_party_user_id];
  
  -- Case 4: Direct user specified
  ELSIF p_responsible_party_user_id IS NOT NULL THEN
    v_approvers := ARRAY[p_responsible_party_user_id];
  END IF;
  
  -- Remove nulls and return
  RETURN COALESCE(v_approvers, ARRAY[]::UUID[]);
END;
$$ LANGUAGE plpgsql;

-- Function: Auto-approve expired pending submissions
CREATE OR REPLACE FUNCTION auto_approve_expired_submissions()
RETURNS INTEGER AS $$
DECLARE
  v_count INTEGER;
BEGIN
  -- Auto-approve submissions where responsible party didn't object within 30 days
  UPDATE contribution_submissions
  SET 
    status = 'auto_approved',
    auto_approved = TRUE,
    reviewed_at = NOW(),
    review_notes = 'Auto-approved: No objection from responsible party within 30 days'
  WHERE status = 'pending'
    AND auto_approve_at <= NOW()
    AND auto_approved = FALSE;
  
  GET DIAGNOSTICS v_count = ROW_COUNT;
  
  -- Update associated images to approved
  UPDATE vehicle_images vi
  SET verification_status = 'approved'
  FROM contribution_submissions cs
  WHERE cs.status = 'auto_approved'
    AND vi.id = ANY(cs.image_ids)
    AND vi.verification_status = 'pending';
  
  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- Trigger: Update timestamp
CREATE OR REPLACE FUNCTION update_contribution_submission_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_contribution_submission_timestamp ON contribution_submissions;
CREATE TRIGGER trg_update_contribution_submission_timestamp
  BEFORE UPDATE ON contribution_submissions
  FOR EACH ROW EXECUTE FUNCTION update_contribution_submission_timestamp();

-- Trigger: When submission approved, update images
CREATE OR REPLACE FUNCTION approve_submission_images()
RETURNS TRIGGER AS $$
BEGIN
  -- If submission approved, approve all linked images
  IF NEW.status IN ('approved', 'auto_approved') AND OLD.status = 'pending' THEN
    UPDATE vehicle_images
    SET verification_status = 'approved'
    WHERE id = ANY(NEW.image_ids);
  END IF;
  
  -- If submission rejected, reject all linked images
  IF NEW.status = 'rejected' AND OLD.status = 'pending' THEN
    UPDATE vehicle_images
    SET verification_status = 'rejected'
    WHERE id = ANY(NEW.image_ids);
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_approve_submission_images ON contribution_submissions;
CREATE TRIGGER trg_approve_submission_images
  AFTER UPDATE ON contribution_submissions
  FOR EACH ROW
  WHEN (NEW.status <> OLD.status)
  EXECUTE FUNCTION approve_submission_images();

-- RLS Policies
ALTER TABLE contribution_submissions ENABLE ROW LEVEL SECURITY;

-- Anyone can insert (create submission)
CREATE POLICY "Anyone can submit contributions"
  ON contribution_submissions FOR INSERT
  WITH CHECK (contributor_id = auth.uid());

-- Contributors can view their own submissions
CREATE POLICY "Contributors can view own submissions"
  ON contribution_submissions FOR SELECT
  USING (contributor_id = auth.uid());

-- Responsible parties can view and approve submissions
CREATE POLICY "Responsible parties can view submissions"
  ON contribution_submissions FOR SELECT
  USING (
    auth.uid() = ANY(requires_approval_from)
    OR auth.uid() = responsible_party_user_id
  );

CREATE POLICY "Responsible parties can approve/reject"
  ON contribution_submissions FOR UPDATE
  USING (
    auth.uid() = ANY(requires_approval_from)
    OR auth.uid() = responsible_party_user_id
  )
  WITH CHECK (
    auth.uid() = ANY(requires_approval_from)
    OR auth.uid() = responsible_party_user_id
  );

-- View for pending approvals (for responsible parties)
CREATE OR REPLACE VIEW pending_contribution_approvals AS
SELECT
  cs.id,
  cs.contributor_id,
  cs.vehicle_id,
  cs.contribution_type,
  cs.work_date,
  cs.work_category,
  cs.work_description,
  cs.responsible_party_type,
  cs.responsible_party_org_id,
  cs.status,
  cs.created_at,
  cs.auto_approve_at,
  -- Contributor info
  p.full_name as contributor_name,
  p.email as contributor_email,
  p.avatar_url as contributor_avatar,
  -- Vehicle info
  v.year,
  v.make,
  v.model,
  v.title as vehicle_title,
  -- Organization info (if applicable)
  b.business_name as organization_name,
  -- Image count
  array_length(cs.image_ids, 1) as image_count
FROM contribution_submissions cs
JOIN profiles p ON cs.contributor_id = p.id
JOIN vehicles v ON cs.vehicle_id = v.id
LEFT JOIN businesses b ON cs.responsible_party_org_id = b.id
WHERE cs.status = 'pending'
ORDER BY cs.created_at DESC;

COMMENT ON VIEW pending_contribution_approvals IS 'Pending contributions awaiting verification from responsible parties';

