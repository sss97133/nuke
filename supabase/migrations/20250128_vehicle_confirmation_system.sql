-- Vehicle Confirmation System
-- Purpose: System asks user yes/no questions about vehicles that need clarification
-- Example: "This vehicle is linked to Viva Las Vegas Autos via GPS. Move to organization view?"

-- Table to store confirmation questions and responses
CREATE TABLE IF NOT EXISTS vehicle_confirmation_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  
  -- Question details
  question_type TEXT NOT NULL CHECK (question_type IN (
    'org_link_move',           -- "Vehicle linked to org via GPS - move to org view?"
    'title_ownership_override', -- "Someone else has title - remove from personal view?"
    'inactive_hide',           -- "No activity in 90+ days - hide from personal view?"
    'weak_claim_remove',       -- "You're just first uploader with no other claim - remove?"
    'org_responsibility_assign' -- "You're org member but not responsible party - assign?"
  )),
  question_text TEXT NOT NULL,
  evidence_details JSONB, -- Stores evidence (org_id, confidence, etc.)
  
  -- Response
  user_response BOOLEAN, -- true = yes, false = no, NULL = not answered
  responded_at TIMESTAMPTZ,
  
  -- Status
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'dismissed', 'expired')),
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(user_id, vehicle_id, question_type, status) WHERE status = 'pending'
);

CREATE INDEX IF NOT EXISTS idx_vehicle_confirmation_user ON vehicle_confirmation_questions(user_id, status);
CREATE INDEX IF NOT EXISTS idx_vehicle_confirmation_vehicle ON vehicle_confirmation_questions(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_confirmation_pending ON vehicle_confirmation_questions(user_id) WHERE status = 'pending';

-- Function to generate confirmation questions for a user
CREATE OR REPLACE FUNCTION generate_vehicle_confirmation_questions(p_user_id UUID)
RETURNS TABLE (
  question_id UUID,
  vehicle_id UUID,
  vehicle_name TEXT,
  question_type TEXT,
  question_text TEXT,
  evidence_details JSONB
) AS $$
BEGIN
  -- 1. Vehicles linked to orgs but user is just uploader
  RETURN QUERY
  SELECT
    gen_random_uuid() as question_id,
    v.id as vehicle_id,
    (v.year || ' ' || v.make || ' ' || v.model)::TEXT as vehicle_name,
    'org_link_move'::TEXT as question_type,
    format('This vehicle is linked to %s via GPS/receipt. Move to organization view?', 
      b.business_name)::TEXT as question_text,
    jsonb_build_object(
      'organization_id', b.id,
      'organization_name', b.business_name,
      'gps_confidence', ov.gps_match_confidence,
      'auto_tagged', ov.auto_tagged
    ) as evidence_details
  FROM vehicles v
  JOIN organization_vehicles ov ON ov.vehicle_id = v.id
  JOIN businesses b ON b.id = ov.organization_id
  WHERE v.uploaded_by = p_user_id
    AND (v.user_id IS NULL OR v.user_id != p_user_id)
    AND ov.status = 'active'
    AND ov.auto_tagged = true
    AND ov.responsible_party_user_id IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM vehicle_confirmation_questions vcq
      WHERE vcq.user_id = p_user_id
        AND vcq.vehicle_id = v.id
        AND vcq.question_type = 'org_link_move'
        AND vcq.status = 'pending'
    )
    AND NOT EXISTS (
      SELECT 1 FROM ownership_verifications ov2
      WHERE ov2.vehicle_id = v.id
        AND ov2.user_id = p_user_id
        AND ov2.status = 'approved'
    );
  
  -- 2. Vehicles where someone else has title ownership
  RETURN QUERY
  SELECT
    gen_random_uuid() as question_id,
    v.id as vehicle_id,
    (v.year || ' ' || v.make || ' ' || v.model)::TEXT as vehicle_name,
    'title_ownership_override'::TEXT as question_type,
    format('Another user has verified title ownership. Remove from your personal view?', 
      p.full_name)::TEXT as question_text,
    jsonb_build_object(
      'title_owner_id', ov.user_id,
      'title_owner_name', p.full_name,
      'verification_date', ov.approved_at
    ) as evidence_details
  FROM vehicles v
  JOIN ownership_verifications ov ON ov.vehicle_id = v.id
  JOIN profiles p ON p.id = ov.user_id
  WHERE (v.user_id = p_user_id OR v.uploaded_by = p_user_id)
    AND ov.user_id != p_user_id
    AND ov.status = 'approved'
    AND NOT EXISTS (
      SELECT 1 FROM ownership_verifications ov2
      WHERE ov2.vehicle_id = v.id
        AND ov2.user_id = p_user_id
        AND ov2.status = 'approved'
    )
    AND NOT EXISTS (
      SELECT 1 FROM vehicle_confirmation_questions vcq
      WHERE vcq.user_id = p_user_id
        AND vcq.vehicle_id = v.id
        AND vcq.question_type = 'title_ownership_override'
        AND vcq.status = 'pending'
    );
  
  -- 3. Inactive vehicles (no activity in 90+ days)
  RETURN QUERY
  SELECT
    gen_random_uuid() as question_id,
    v.id as vehicle_id,
    (v.year || ' ' || v.make || ' ' || v.model)::TEXT as vehicle_name,
    'inactive_hide'::TEXT as question_type,
    'No activity on this vehicle in 90+ days. Hide from personal view?'::TEXT as question_text,
    jsonb_build_object(
      'last_activity', GREATEST(
        (SELECT MAX(created_at) FROM vehicle_images WHERE vehicle_id = v.id AND user_id = p_user_id),
        (SELECT MAX(created_at) FROM timeline_events WHERE vehicle_id = v.id AND user_id = p_user_id)
      )
    ) as evidence_details
  FROM vehicles v
  WHERE (v.user_id = p_user_id OR v.uploaded_by = p_user_id)
    AND NOT EXISTS (
      SELECT 1 FROM vehicle_images vi
      WHERE vi.vehicle_id = v.id
        AND vi.user_id = p_user_id
        AND vi.created_at > NOW() - INTERVAL '90 days'
    )
    AND NOT EXISTS (
      SELECT 1 FROM timeline_events te
      WHERE te.vehicle_id = v.id
        AND te.user_id = p_user_id
        AND te.created_at > NOW() - INTERVAL '90 days'
    )
    AND NOT EXISTS (
      SELECT 1 FROM ownership_verifications ov
      WHERE ov.vehicle_id = v.id
        AND ov.user_id = p_user_id
        AND ov.status = 'approved'
    )
    AND NOT EXISTS (
      SELECT 1 FROM vehicle_confirmation_questions vcq
      WHERE vcq.user_id = p_user_id
        AND vcq.vehicle_id = v.id
        AND vcq.question_type = 'inactive_hide'
        AND vcq.status = 'pending'
    );
  
  RETURN;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

-- Function to handle user response
CREATE OR REPLACE FUNCTION respond_to_vehicle_question(
  p_question_id UUID,
  p_user_id UUID,
  p_response BOOLEAN
)
RETURNS JSONB AS $$
DECLARE
  v_question RECORD;
  v_result JSONB;
BEGIN
  -- Get question details
  SELECT * INTO v_question
  FROM vehicle_confirmation_questions
  WHERE id = p_question_id
    AND user_id = p_user_id
    AND status = 'pending';
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Question not found or already answered');
  END IF;
  
  -- Update question with response
  UPDATE vehicle_confirmation_questions
  SET 
    user_response = p_response,
    responded_at = NOW(),
    status = CASE WHEN p_response THEN 'confirmed' ELSE 'dismissed' END,
    updated_at = NOW()
  WHERE id = p_question_id;
  
  -- Handle actions based on question type and response
  IF p_response = true THEN
    CASE v_question.question_type
      WHEN 'org_link_move' THEN
        -- Mark as hidden in user preferences (will show in org context)
        INSERT INTO user_vehicle_preferences (user_id, vehicle_id, is_hidden)
        VALUES (p_user_id, v_question.vehicle_id, true)
        ON CONFLICT (user_id, vehicle_id) 
        DO UPDATE SET is_hidden = true;
        
      WHEN 'title_ownership_override' THEN
        -- Remove from user's direct ownership
        UPDATE vehicles
        SET user_id = NULL
        WHERE id = v_question.vehicle_id
          AND user_id = p_user_id;
        
        -- Mark as hidden
        INSERT INTO user_vehicle_preferences (user_id, vehicle_id, is_hidden)
        VALUES (p_user_id, v_question.vehicle_id, true)
        ON CONFLICT (user_id, vehicle_id) 
        DO UPDATE SET is_hidden = true;
        
      WHEN 'inactive_hide' THEN
        -- Mark as hidden
        INSERT INTO user_vehicle_preferences (user_id, vehicle_id, is_hidden)
        VALUES (p_user_id, v_question.vehicle_id, true)
        ON CONFLICT (user_id, vehicle_id) 
        DO UPDATE SET is_hidden = true;
        
      WHEN 'weak_claim_remove' THEN
        -- Remove from user's direct ownership
        UPDATE vehicles
        SET user_id = NULL
        WHERE id = v_question.vehicle_id
          AND user_id = p_user_id;
        
        -- Mark as hidden
        INSERT INTO user_vehicle_preferences (user_id, vehicle_id, is_hidden)
        VALUES (p_user_id, v_question.vehicle_id, true)
        ON CONFLICT (user_id, vehicle_id) 
        DO UPDATE SET is_hidden = true;
    END CASE;
  END IF;
  
  RETURN jsonb_build_object(
    'success', true,
    'question_id', p_question_id,
    'response', p_response,
    'action_taken', CASE WHEN p_response THEN v_question.question_type ELSE 'none' END
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

-- RLS Policies
ALTER TABLE vehicle_confirmation_questions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own questions"
  ON vehicle_confirmation_questions
  FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can respond to their own questions"
  ON vehicle_confirmation_questions
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION generate_vehicle_confirmation_questions(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION respond_to_vehicle_question(UUID, UUID, BOOLEAN) TO authenticated;

COMMENT ON TABLE vehicle_confirmation_questions IS 'Stores yes/no questions the system asks users about vehicles that need clarification';
COMMENT ON FUNCTION generate_vehicle_confirmation_questions IS 'Generates confirmation questions for a user based on evidence (org links, title ownership, inactivity, etc.)';
COMMENT ON FUNCTION respond_to_vehicle_question IS 'Handles user response to confirmation question and takes appropriate action';

