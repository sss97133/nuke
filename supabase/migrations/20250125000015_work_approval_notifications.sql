-- ==========================================================================
-- WORK APPROVAL NOTIFICATION SYSTEM
-- ==========================================================================
-- Purpose: 
-- 1. Send notifications to users for work approval requests
-- 2. Link notifications to vehicles and organizations
-- 3. Track approval/rejection responses with reversal capability
-- 4. Maintain audit log of all events
-- ==========================================================================

-- ==========================================================================
-- 1. EXTEND USER_NOTIFICATIONS FOR WORK APPROVALS
-- ==========================================================================

-- Add work approval notification type to existing notification system
DO $$
BEGIN
  -- Check if work_approval_request type exists in user_notifications
  -- If not, we'll use the existing user_notifications table with new type
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'user_notifications'
  ) THEN
    -- Create user_notifications if it doesn't exist
    CREATE TABLE user_notifications (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
      organization_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
      metadata JSONB DEFAULT '{}',
      is_read BOOLEAN DEFAULT FALSE,
      is_responded BOOLEAN DEFAULT FALSE,
      response_data JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      expires_at TIMESTAMPTZ,
      priority INTEGER DEFAULT 1
    );
  ELSE
    -- Add organization_id if it doesn't exist
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_schema = 'public' 
        AND table_name = 'user_notifications'
        AND column_name = 'organization_id'
    ) THEN
      ALTER TABLE user_notifications
      ADD COLUMN organization_id UUID REFERENCES businesses(id) ON DELETE CASCADE;
    END IF;
  END IF;
END $$;

-- Add index for organization notifications (if column exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'user_notifications'
      AND column_name = 'organization_id'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_user_notifications_org ON user_notifications(organization_id) 
      WHERE organization_id IS NOT NULL;
  END IF;
  
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'user_notifications'
      AND column_name = 'vehicle_id'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_user_notifications_vehicle ON user_notifications(vehicle_id) 
      WHERE vehicle_id IS NOT NULL;
  END IF;
END $$;

-- ==========================================================================
-- 2. WORK APPROVAL NOTIFICATIONS TABLE
-- ==========================================================================

-- Dedicated table for work approval notifications with full tracking
CREATE TABLE IF NOT EXISTS work_approval_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Notification details
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  
  -- Related work match
  work_match_id UUID REFERENCES work_organization_matches(id) ON DELETE CASCADE,
  work_extraction_id UUID REFERENCES image_work_extractions(id) ON DELETE SET NULL,
  
  -- Notification content
  notification_type TEXT NOT NULL DEFAULT 'work_approval_request' CHECK (notification_type IN (
    'work_approval_request',  -- Initial request
    'work_approval_reminder', -- Reminder if not responded
    'work_approved',          -- Confirmation when approved
    'work_rejected'           -- Confirmation when rejected
  )),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  action_data JSONB DEFAULT '{}', -- Work details, match probability, etc.
  
  -- Response tracking
  response_status TEXT DEFAULT 'pending' CHECK (response_status IN ('pending', 'approved', 'rejected', 'expired', 'cancelled')),
  responded_by_user_id UUID REFERENCES auth.users(id),
  responded_at TIMESTAMPTZ,
  response_notes TEXT,
  
  -- Read status
  is_read BOOLEAN DEFAULT FALSE,
  read_at TIMESTAMPTZ,
  
  -- Expiry
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '7 days'),
  
  -- Priority (based on match probability)
  priority INTEGER DEFAULT 1 CHECK (priority BETWEEN 1 AND 5),
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_work_approval_notif_user ON work_approval_notifications(user_id, response_status);
CREATE INDEX IF NOT EXISTS idx_work_approval_notif_org ON work_approval_notifications(organization_id);
CREATE INDEX IF NOT EXISTS idx_work_approval_notif_vehicle ON work_approval_notifications(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_work_approval_notif_match ON work_approval_notifications(work_match_id) 
  WHERE work_match_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_work_approval_notif_pending ON work_approval_notifications(user_id, response_status, created_at DESC) 
  WHERE response_status = 'pending';

COMMENT ON TABLE work_approval_notifications IS 
  'Notifications for work approval requests. Linked to vehicles and organizations with full response tracking.';

-- ==========================================================================
-- 3. NOTIFICATION RESPONSE HISTORY (AUDIT LOG)
-- ==========================================================================

-- Track all responses, including reversals
CREATE TABLE IF NOT EXISTS notification_response_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Notification reference
  notification_id UUID NOT NULL REFERENCES work_approval_notifications(id) ON DELETE CASCADE,
  
  -- Response details
  response_action TEXT NOT NULL CHECK (response_action IN ('approve', 'reject', 'reverse_approval', 'reverse_rejection')),
  responded_by_user_id UUID NOT NULL REFERENCES auth.users(id),
  responded_by_role TEXT, -- User's role in organization at time of response
  response_notes TEXT,
  
  -- Reversal tracking
  is_reversal BOOLEAN DEFAULT FALSE,
  reversed_previous_response_id UUID REFERENCES notification_response_history(id),
  reversal_reason TEXT,
  
  -- Metadata
  response_data JSONB DEFAULT '{}',
  ip_address TEXT,
  user_agent TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_response_history_notif ON notification_response_history(notification_id);
CREATE INDEX IF NOT EXISTS idx_response_history_user ON notification_response_history(responded_by_user_id);
CREATE INDEX IF NOT EXISTS idx_response_history_reversal ON notification_response_history(is_reversal, reversed_previous_response_id) 
  WHERE is_reversal = true;

COMMENT ON TABLE notification_response_history IS 
  'Complete audit log of all notification responses, including reversals. Tracks who responded, when, and why.';

-- ==========================================================================
-- 4. USER ORGANIZATION PERMISSIONS (for response authorization)
-- ==========================================================================

-- Function to check if user can respond to notification
CREATE OR REPLACE FUNCTION can_user_respond_to_notification(
  p_user_id UUID,
  p_notification_id UUID
)
RETURNS TABLE(
  can_respond BOOLEAN,
  user_role TEXT,
  permission_level TEXT
) AS $$
DECLARE
  v_notification RECORD;
  v_user_role TEXT;
  v_permission_level TEXT;
BEGIN
  -- Get notification details
  SELECT * INTO v_notification
  FROM work_approval_notifications
  WHERE id = p_notification_id;
  
  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, 'notification_not_found'::TEXT;
    RETURN;
  END IF;
  
  -- Check if user is the notification recipient
  IF v_notification.user_id != p_user_id THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, 'not_recipient'::TEXT;
    RETURN;
  END IF;
  
  -- Check if already responded
  IF v_notification.response_status != 'pending' THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, 'already_responded'::TEXT;
    RETURN;
  END IF;
  
  -- Get user's role in organization
  SELECT oc.role INTO v_user_role
  FROM organization_contributors oc
  WHERE oc.organization_id = v_notification.organization_id
    AND oc.user_id = p_user_id
  LIMIT 1;
  
  -- Determine permission level
  IF v_user_role IN ('owner', 'co_founder', 'board_member', 'manager') THEN
    v_permission_level := 'full';
  ELSIF v_user_role IN ('employee', 'technician', 'contractor') THEN
    v_permission_level := 'limited';
  ELSIF v_user_role = 'contributor' THEN
    v_permission_level := 'view_only';
  ELSE
    v_permission_level := 'none';
  END IF;
  
  -- Can respond if permission level is full or limited
  RETURN QUERY SELECT 
    v_permission_level IN ('full', 'limited'),
    v_user_role,
    v_permission_level;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ==========================================================================
-- 5. RESPOND TO NOTIFICATION (with history tracking)
-- ==========================================================================

-- Function to respond to notification
CREATE OR REPLACE FUNCTION respond_to_work_approval(
  p_notification_id UUID,
  p_user_id UUID,
  p_response_action TEXT, -- 'approve' or 'reject'
  p_response_notes TEXT DEFAULT NULL,
  p_ip_address TEXT DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL
)
RETURNS TABLE(
  success BOOLEAN,
  message TEXT,
  response_id UUID
) AS $$
DECLARE
  v_notification RECORD;
  v_can_respond BOOLEAN;
  v_user_role TEXT;
  v_permission_level TEXT;
  v_response_id UUID;
  v_work_match_id UUID;
BEGIN
  -- Check permissions
  SELECT can_respond, user_role, permission_level 
  INTO v_can_respond, v_user_role, v_permission_level
  FROM can_user_respond_to_notification(p_user_id, p_notification_id);
  
  IF NOT v_can_respond THEN
    RETURN QUERY SELECT FALSE, 'User does not have permission to respond', NULL::UUID;
    RETURN;
  END IF;
  
  -- Get notification
  SELECT * INTO v_notification
  FROM work_approval_notifications
  WHERE id = p_notification_id;
  
  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'Notification not found', NULL::UUID;
    RETURN;
  END IF;
  
  -- Validate response action
  IF p_response_action NOT IN ('approve', 'reject') THEN
    RETURN QUERY SELECT FALSE, 'Invalid response action. Must be "approve" or "reject"', NULL::UUID;
    RETURN;
  END IF;
  
  -- Update notification
  UPDATE work_approval_notifications
  SET 
    response_status = CASE WHEN p_response_action = 'approve' THEN 'approved' ELSE 'rejected' END,
    responded_by_user_id = p_user_id,
    responded_at = NOW(),
    response_notes = p_response_notes,
    is_read = TRUE,
    read_at = NOW(),
    updated_at = NOW()
  WHERE id = p_notification_id
  RETURNING work_match_id INTO v_work_match_id;
  
  -- Create response history record
  INSERT INTO notification_response_history (
    notification_id,
    response_action,
    responded_by_user_id,
    responded_by_role,
    response_notes,
    response_data,
    ip_address,
    user_agent
  ) VALUES (
    p_notification_id,
    p_response_action,
    p_user_id,
    v_user_role,
    p_response_notes,
    jsonb_build_object(
      'permission_level', v_permission_level,
      'notification_type', v_notification.notification_type,
      'work_match_id', v_work_match_id
    ),
    p_ip_address,
    p_user_agent
  )
  RETURNING id INTO v_response_id;
  
  -- Update work match if exists
  IF v_work_match_id IS NOT NULL THEN
    UPDATE work_organization_matches
    SET 
      approval_status = CASE WHEN p_response_action = 'approve' THEN 'approved' ELSE 'rejected' END,
      approved_by_user_id = p_user_id,
      approved_at = NOW(),
      rejection_reason = CASE WHEN p_response_action = 'reject' THEN p_response_notes ELSE NULL END,
      notification_status = 'responded',
      updated_at = NOW()
    WHERE id = v_work_match_id;
  END IF;
  
  RETURN QUERY SELECT TRUE, 'Response recorded successfully', v_response_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ==========================================================================
-- 6. REVERSE RESPONSE
-- ==========================================================================

-- Function to reverse a previous response
CREATE OR REPLACE FUNCTION reverse_work_approval_response(
  p_notification_id UUID,
  p_user_id UUID,
  p_reversal_reason TEXT,
  p_new_response_action TEXT DEFAULT NULL, -- Optional: new response if reversing
  p_ip_address TEXT DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL
)
RETURNS TABLE(
  success BOOLEAN,
  message TEXT,
  reversal_id UUID
) AS $$
DECLARE
  v_notification RECORD;
  v_previous_response RECORD;
  v_user_role TEXT;
  v_permission_level TEXT;
  v_reversal_id UUID;
  v_can_respond BOOLEAN;
BEGIN
  -- Get notification
  SELECT * INTO v_notification
  FROM work_approval_notifications
  WHERE id = p_notification_id;
  
  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'Notification not found', NULL::UUID;
    RETURN;
  END IF;
  
  -- Check if user has permission (must be owner/manager for reversals)
  SELECT oc.role INTO v_user_role
  FROM organization_contributors oc
  WHERE oc.organization_id = v_notification.organization_id
    AND oc.user_id = p_user_id
    AND oc.role IN ('owner', 'co_founder', 'board_member', 'manager')
  LIMIT 1;
  
  IF v_user_role IS NULL THEN
    RETURN QUERY SELECT FALSE, 'Only owners/managers can reverse responses', NULL::UUID;
    RETURN;
  END IF;
  
  -- Get previous response
  SELECT * INTO v_previous_response
  FROM notification_response_history
  WHERE notification_id = p_notification_id
    AND is_reversal = FALSE
  ORDER BY created_at DESC
  LIMIT 1;
  
  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'No previous response found to reverse', NULL::UUID;
    RETURN;
  END IF;
  
  -- Create reversal record
  INSERT INTO notification_response_history (
    notification_id,
    response_action,
    responded_by_user_id,
    responded_by_role,
    response_notes,
    is_reversal,
    reversed_previous_response_id,
    reversal_reason,
    response_data,
    ip_address,
    user_agent
  ) VALUES (
    p_notification_id,
    CASE 
      WHEN p_new_response_action IS NOT NULL THEN p_new_response_action
      WHEN v_previous_response.response_action = 'approve' THEN 'reverse_approval'
      ELSE 'reverse_rejection'
    END,
    p_user_id,
    v_user_role,
    p_reversal_reason,
    TRUE,
    v_previous_response.id,
    p_reversal_reason,
    jsonb_build_object(
      'previous_response', v_previous_response.response_action,
      'previous_responder', v_previous_response.responded_by_user_id,
      'new_response', p_new_response_action
    ),
    p_ip_address,
    p_user_agent
  )
  RETURNING id INTO v_reversal_id;
  
  -- Update notification
  UPDATE work_approval_notifications
  SET 
    response_status = CASE 
      WHEN p_new_response_action = 'approve' THEN 'approved'
      WHEN p_new_response_action = 'reject' THEN 'rejected'
      ELSE 'pending' -- Reset to pending if no new response
    END,
    responded_by_user_id = CASE WHEN p_new_response_action IS NOT NULL THEN p_user_id ELSE NULL END,
    responded_at = CASE WHEN p_new_response_action IS NOT NULL THEN NOW() ELSE NULL END,
    response_notes = p_reversal_reason,
    updated_at = NOW()
  WHERE id = p_notification_id;
  
  -- Update work match if exists
  IF v_notification.work_match_id IS NOT NULL THEN
    UPDATE work_organization_matches
    SET 
      approval_status = CASE 
        WHEN p_new_response_action = 'approve' THEN 'approved'
        WHEN p_new_response_action = 'reject' THEN 'rejected'
        ELSE 'pending'
      END,
      approved_by_user_id = CASE WHEN p_new_response_action IS NOT NULL THEN p_user_id ELSE NULL END,
      approved_at = CASE WHEN p_new_response_action IS NOT NULL THEN NOW() ELSE NULL END,
      rejection_reason = CASE WHEN p_new_response_action = 'reject' THEN p_reversal_reason ELSE NULL END,
      updated_at = NOW()
    WHERE id = v_notification.work_match_id;
  END IF;
  
  RETURN QUERY SELECT TRUE, 'Response reversed successfully', v_reversal_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ==========================================================================
-- 7. CREATE NOTIFICATION FROM WORK MATCH
-- ==========================================================================

-- Function to create notification when work match is found
CREATE OR REPLACE FUNCTION create_work_approval_notification(
  p_work_match_id UUID
)
RETURNS UUID AS $$
DECLARE
  v_match RECORD;
  v_org_users RECORD;
  v_notification_id UUID;
  v_title TEXT;
  v_message TEXT;
BEGIN
  -- Get work match details
  SELECT 
    wom.*,
    iwe.detected_work_type,
    iwe.detected_work_description,
    iwe.detected_date,
    v.year as vehicle_year,
    v.make as vehicle_make,
    v.model as vehicle_model,
    b.business_name as org_name
  INTO v_match
  FROM work_organization_matches wom
  JOIN image_work_extractions iwe ON iwe.id = wom.image_work_extraction_id
  JOIN vehicles v ON v.id = wom.vehicle_id
  JOIN businesses b ON b.id = wom.matched_organization_id
  WHERE wom.id = p_work_match_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Work match not found';
  END IF;
  
  -- Create notification for each user in organization (owners/managers first)
  FOR v_org_users IN
    SELECT DISTINCT oc.user_id, oc.role, p.email
    FROM organization_contributors oc
    JOIN auth.users u ON u.id = oc.user_id
    LEFT JOIN auth.users p ON p.id = oc.user_id
    WHERE oc.organization_id = v_match.matched_organization_id
      AND oc.role IN ('owner', 'co_founder', 'board_member', 'manager', 'employee')
    ORDER BY 
      CASE oc.role
        WHEN 'owner' THEN 1
        WHEN 'co_founder' THEN 2
        WHEN 'board_member' THEN 3
        WHEN 'manager' THEN 4
        ELSE 5
      END
    LIMIT 5 -- Limit to top 5 users to avoid spam
  LOOP
    -- Build notification content
    v_title := format('Work Approval Request: %s on %s %s %s', 
      v_match.detected_work_type,
      v_match.vehicle_year,
      v_match.vehicle_make,
      v_match.vehicle_model
    );
    
    v_message := format(
      'Did you perform %s work on this %s %s %s around %s? Match confidence: %s%%',
      v_match.detected_work_type,
      v_match.vehicle_year,
      v_match.vehicle_make,
      v_match.vehicle_model,
      COALESCE(v_match.detected_date::TEXT, 'recently'),
      v_match.match_probability
    );
    
    -- Create notification
    INSERT INTO work_approval_notifications (
      user_id,
      organization_id,
      vehicle_id,
      work_match_id,
      work_extraction_id,
      title,
      message,
      action_data,
      priority,
      expires_at
    ) VALUES (
      v_org_users.user_id,
      v_match.matched_organization_id,
      v_match.vehicle_id,
      p_work_match_id,
      v_match.image_work_extraction_id,
      v_title,
      v_message,
      jsonb_build_object(
        'work_type', v_match.detected_work_type,
        'work_description', v_match.detected_work_description,
        'work_date', v_match.detected_date,
        'match_probability', v_match.match_probability,
        'match_reasons', v_match.match_reasons,
        'vehicle_year', v_match.vehicle_year,
        'vehicle_make', v_match.vehicle_make,
        'vehicle_model', v_match.vehicle_model
      ),
      CASE 
        WHEN v_match.match_probability >= 95 THEN 5
        WHEN v_match.match_probability >= 90 THEN 4
        WHEN v_match.match_probability >= 80 THEN 3
        ELSE 2
      END,
      NOW() + INTERVAL '7 days'
    )
    RETURNING id INTO v_notification_id;
    
    -- Also create entry in user_notifications for inbox
    -- Use metadata to store vehicle_id if column doesn't exist
    BEGIN
      INSERT INTO user_notifications (
        user_id,
        type,
        title,
        message,
        organization_id,
        metadata
      ) VALUES (
        v_org_users.user_id,
        'work_approval_request',
        v_title,
        v_message,
        v_match.matched_organization_id,
        jsonb_build_object(
          'work_approval_notification_id', v_notification_id,
          'vehicle_id', v_match.vehicle_id
        )
      )
      ON CONFLICT DO NOTHING;
    EXCEPTION WHEN OTHERS THEN
      -- If insert fails, continue (notification still created in work_approval_notifications)
      NULL;
    END;
  END LOOP;
  
  -- Update work match notification status
  UPDATE work_organization_matches
  SET 
    notification_status = 'sent',
    notification_sent_at = NOW()
  WHERE id = p_work_match_id;
  
  RETURN v_notification_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ==========================================================================
-- 8. RLS POLICIES
-- ==========================================================================

ALTER TABLE work_approval_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_response_history ENABLE ROW LEVEL SECURITY;

-- Users can view their own notifications
DROP POLICY IF EXISTS "Users view own notifications" ON work_approval_notifications;
CREATE POLICY "Users view own notifications" ON work_approval_notifications
  FOR SELECT USING (auth.uid() = user_id);

-- Users can update their own notifications (read status)
DROP POLICY IF EXISTS "Users update own notifications" ON work_approval_notifications;
CREATE POLICY "Users update own notifications" ON work_approval_notifications
  FOR UPDATE USING (auth.uid() = user_id);

-- Users can view response history for their notifications
DROP POLICY IF EXISTS "Users view response history" ON notification_response_history;
CREATE POLICY "Users view response history" ON notification_response_history
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM work_approval_notifications wan
      WHERE wan.id = notification_response_history.notification_id
        AND wan.user_id = auth.uid()
    )
  );

-- Organization members can view response history for org notifications
DROP POLICY IF EXISTS "Org members view org response history" ON notification_response_history;
CREATE POLICY "Org members view org response history" ON notification_response_history
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM work_approval_notifications wan
      JOIN organization_contributors oc ON oc.organization_id = wan.organization_id
      WHERE wan.id = notification_response_history.notification_id
        AND oc.user_id = auth.uid()
    )
  );

-- ==========================================================================
-- 9. GRANTS
-- ==========================================================================

GRANT SELECT, INSERT, UPDATE ON work_approval_notifications TO authenticated;
GRANT SELECT ON notification_response_history TO authenticated;
GRANT EXECUTE ON FUNCTION can_user_respond_to_notification(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION respond_to_work_approval(UUID, UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION reverse_work_approval_response(UUID, UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION create_work_approval_notification(UUID) TO authenticated, service_role;

-- ==========================================================================
-- 10. TRIGGER: Auto-create notification when high-probability match found
-- ==========================================================================

-- Function to auto-create notification
CREATE OR REPLACE FUNCTION auto_create_work_approval_notification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only create notification for high-probability matches (>=90%)
  IF NEW.match_probability >= 90 AND NEW.notification_status = 'pending' THEN
    PERFORM create_work_approval_notification(NEW.id);
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create trigger
DROP TRIGGER IF EXISTS trg_auto_create_work_notification ON work_organization_matches;
CREATE TRIGGER trg_auto_create_work_notification
  AFTER INSERT ON work_organization_matches
  FOR EACH ROW
  WHEN (NEW.match_probability >= 90)
  EXECUTE FUNCTION auto_create_work_approval_notification();

