-- Integrate Shops into Admin approvals and enforce membership

-- 1) Extend pending_approvals view with shop context
CREATE OR REPLACE VIEW pending_approvals AS
SELECT 
  'contributor_onboarding' as approval_type,
  co.id,
  co.vehicle_id,
  co.user_id,
  co.requested_role,
  co.role_justification,
  co.status,
  co.created_at,
  co.uploaded_document_ids,
  co.shop_id,
  s.name AS shop_name,
  v.year,
  v.make,
  v.model,
  u.email as user_email
FROM contributor_onboarding co
JOIN vehicles v ON co.vehicle_id = v.id
LEFT JOIN auth.users u ON co.user_id = u.id
LEFT JOIN shops s ON co.shop_id = s.id
WHERE co.status IN ('pending', 'under_review');

-- 2) Replace approve_contributor_request to handle shop_id
CREATE OR REPLACE FUNCTION approve_contributor_request(
  p_onboarding_id UUID,
  p_admin_user_id UUID,
  p_approve BOOLEAN,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_onboarding contributor_onboarding;
  v_new_role_id UUID;
BEGIN
  -- Check admin permissions
  IF NOT EXISTS (
    SELECT 1 FROM admin_users 
    WHERE user_id = p_admin_user_id 
      AND is_active = true 
      AND can_manage_content = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insufficient permissions');
  END IF;

  -- Get onboarding request
  SELECT * INTO v_onboarding
  FROM contributor_onboarding
  WHERE id = p_onboarding_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Onboarding request not found');
  END IF;

  -- Update onboarding status
  UPDATE contributor_onboarding
  SET 
    status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
    reviewed_by = p_admin_user_id,
    reviewed_at = NOW(),
    admin_notes = p_notes,
    updated_at = NOW()
  WHERE id = p_onboarding_id;

  -- If approved, create contributor role with shop_id
  IF p_approve THEN
    INSERT INTO vehicle_contributor_roles (
      vehicle_id,
      user_id,
      role,
      shop_id,
      is_active,
      approved_by,
      approved_at
    ) VALUES (
      v_onboarding.vehicle_id,
      v_onboarding.user_id,
      v_onboarding.requested_role,
      v_onboarding.shop_id,  -- Carry over shop_id
      true,
      p_admin_user_id,
      NOW()
    ) RETURNING id INTO v_new_role_id;
  END IF;

  -- Log action
  INSERT INTO admin_action_log (
    admin_user_id,
    action_type,
    target_type,
    target_id,
    details
  ) VALUES (
    p_admin_user_id,
    CASE WHEN p_approve THEN 'approve_contributor' ELSE 'reject_contributor' END,
    'contributor_onboarding',
    p_onboarding_id,
    jsonb_build_object(
      'vehicle_id', v_onboarding.vehicle_id,
      'user_id', v_onboarding.user_id,
      'role', v_onboarding.requested_role,
      'shop_id', v_onboarding.shop_id,
      'notes', p_notes
    )
  );

  RETURN jsonb_build_object('success', true, 'role_id', v_new_role_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3) Trigger to validate shop membership
CREATE OR REPLACE FUNCTION enforce_onboarding_shop_membership()
RETURNS TRIGGER AS $$
BEGIN
  -- If submitted by shop, verify user is active member
  IF NEW.submitted_by = 'shop' AND NEW.shop_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM shop_members
      WHERE shop_id = NEW.shop_id
        AND user_id = NEW.user_id
        AND status = 'active'
    ) THEN
      RAISE EXCEPTION 'User must be an active member of shop to submit on behalf of shop';
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER validate_shop_membership_before_insert
  BEFORE INSERT ON contributor_onboarding
  FOR EACH ROW
  EXECUTE FUNCTION enforce_onboarding_shop_membership();
