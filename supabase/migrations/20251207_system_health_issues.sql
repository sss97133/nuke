-- SYSTEM HEALTH ISSUES TABLE
-- Unified table for tracking all system errors/issues that need human correction
-- Acts as a notification system for system health, not user notifications

CREATE TABLE IF NOT EXISTS system_health_issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Issue classification
  issue_type TEXT NOT NULL CHECK (issue_type IN (
    'rls_violation',           -- Row Level Security policy violation
    'ai_confusion',            -- AI made wrong decision, needs correction
    'duplicate_vehicle',       -- Duplicate vehicle detected
    'duplicate_image',         -- Duplicate image detected
    'image_vehicle_mismatch',  -- Image doesn't match vehicle
    'org_vehicle_mismatch',    -- Organization/vehicle relationship issue
    'data_quality',            -- Data quality issue (missing fields, etc.)
    'validation_error',        -- Data validation failed
    'ai_error',                -- AI processing error
    'scraper_error',           -- Scraper failed
    'import_error'            -- Import/upload error
  )),
  
  -- Severity
  severity TEXT NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')) DEFAULT 'medium',
  
  -- What's affected
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
  image_id UUID REFERENCES vehicle_images(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
  
  -- Issue details
  title TEXT NOT NULL,
  description TEXT,
  error_message TEXT,
  error_code TEXT,
  
  -- Context data (JSONB for flexibility)
  context_data JSONB DEFAULT '{}',
  /*
  Examples:
  {
    "rls_policy": "vehicles_select",
    "user_id": "uuid",
    "attempted_action": "SELECT"
  }
  {
    "ai_confidence": 45,
    "ai_decision": "matched_to_vehicle",
    "correct_decision": "should_not_match"
  }
  {
    "duplicate_vehicle_id": "uuid",
    "similarity_score": 95
  }
  */
  
  -- Suggested fix
  suggested_fix TEXT,
  fix_action JSONB, /*
  {
    "action": "move_image",
    "target_vehicle_id": "uuid"
  }
  {
    "action": "merge_vehicles",
    "merge_from": "uuid",
    "merge_to": "uuid"
  }
  {
    "action": "update_rls_policy",
    "policy_name": "vehicles_select"
  }
  */
  
  -- Resolution
  status TEXT NOT NULL CHECK (status IN ('open', 'in_progress', 'resolved', 'dismissed', 'auto_fixed')) DEFAULT 'open',
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES auth.users(id),
  resolution_notes TEXT,
  
  -- Auto-fix attempts
  auto_fix_attempted BOOLEAN DEFAULT false,
  auto_fix_successful BOOLEAN DEFAULT false,
  auto_fix_error TEXT,
  
  -- Metadata
  detected_at TIMESTAMPTZ DEFAULT NOW(),
  detected_by TEXT DEFAULT 'system', -- 'system', 'user', 'ai', 'scraper', etc.
  last_updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_system_health_status ON system_health_issues(status) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_system_health_type ON system_health_issues(issue_type);
CREATE INDEX IF NOT EXISTS idx_system_health_severity ON system_health_issues(severity);
CREATE INDEX IF NOT EXISTS idx_system_health_vehicle ON system_health_issues(vehicle_id) WHERE vehicle_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_system_health_image ON system_health_issues(image_id) WHERE image_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_system_health_org ON system_health_issues(organization_id) WHERE organization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_system_health_detected ON system_health_issues(detected_at DESC);

-- RLS: Only service role can insert/update, but users can read
ALTER TABLE system_health_issues ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view system health issues" ON system_health_issues
  FOR SELECT USING (true);

CREATE POLICY "Service role can manage system health issues" ON system_health_issues
  FOR ALL USING (auth.role() = 'service_role');

-- Function to create issue from various sources
CREATE OR REPLACE FUNCTION create_system_health_issue(
  p_issue_type TEXT,
  p_severity TEXT,
  p_title TEXT,
  p_description TEXT DEFAULT NULL,
  p_vehicle_id UUID DEFAULT NULL,
  p_image_id UUID DEFAULT NULL,
  p_organization_id UUID DEFAULT NULL,
  p_context_data JSONB DEFAULT '{}',
  p_suggested_fix TEXT DEFAULT NULL,
  p_fix_action JSONB DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_issue_id UUID;
BEGIN
  INSERT INTO system_health_issues (
    issue_type,
    severity,
    title,
    description,
    vehicle_id,
    image_id,
    organization_id,
    context_data,
    suggested_fix,
    fix_action
  ) VALUES (
    p_issue_type,
    p_severity,
    p_title,
    p_description,
    p_vehicle_id,
    p_image_id,
    p_organization_id,
    p_context_data,
    p_suggested_fix,
    p_fix_action
  ) RETURNING id INTO v_issue_id;
  
  RETURN v_issue_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to auto-resolve duplicate issues
CREATE OR REPLACE FUNCTION resolve_duplicate_issue(
  p_issue_id UUID,
  p_action TEXT, -- 'merge', 'dismiss', 'mark_resolved'
  p_target_id UUID DEFAULT NULL
) RETURNS BOOLEAN AS $$
DECLARE
  v_issue system_health_issues%ROWTYPE;
BEGIN
  SELECT * INTO v_issue FROM system_health_issues WHERE id = p_issue_id;
  
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  
  IF p_action = 'merge' AND p_target_id IS NOT NULL THEN
    -- Merge logic would go here
    -- For now, just mark as resolved
    UPDATE system_health_issues
    SET status = 'resolved',
        resolved_at = NOW(),
        resolution_notes = 'Merged via system health dashboard'
    WHERE id = p_issue_id;
  ELSIF p_action = 'dismiss' THEN
    UPDATE system_health_issues
    SET status = 'dismissed',
        resolved_at = NOW()
    WHERE id = p_issue_id;
  ELSIF p_action = 'mark_resolved' THEN
    UPDATE system_health_issues
    SET status = 'resolved',
        resolved_at = NOW()
    WHERE id = p_issue_id;
  END IF;
  
  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

