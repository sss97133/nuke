-- Admin Notification System for Ownership and Vehicle Verifications
-- Provides centralized admin dashboard for approving/rejecting verifications

-- Admin notification types and statuses
CREATE TABLE IF NOT EXISTS admin_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Notification metadata
  notification_type TEXT NOT NULL CHECK (notification_type IN (
    'ownership_verification_pending',
    'vehicle_verification_pending', 
    'user_verification_pending',
    'fraud_alert',
    'system_alert'
  )),
  
  -- Related records
  ownership_verification_id UUID REFERENCES ownership_verifications(id) ON DELETE CASCADE,
  vehicle_verification_id UUID REFERENCES vehicle_verifications(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
  
  -- Notification content
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  priority INTEGER DEFAULT 1 CHECK (priority BETWEEN 1 AND 5), -- 1=low, 5=critical
  
  -- Admin action data
  action_required TEXT NOT NULL CHECK (action_required IN (
    'approve_ownership',
    'reject_ownership', 
    'approve_vehicle',
    'reject_vehicle',
    'review_fraud',
    'system_action'
  )),
  
  -- Status tracking
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'in_review', 'approved', 'rejected', 'dismissed'
  )),
  
  -- Admin response
  reviewed_by_admin_id UUID REFERENCES auth.users(id),
  admin_notes TEXT,
  admin_decision TEXT,
  reviewed_at TIMESTAMP,
  
  -- Metadata
  metadata JSONB DEFAULT '{}',
  
  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP DEFAULT (NOW() + INTERVAL '7 days')
);

-- Admin users table (for now, just you as the admin)
CREATE TABLE IF NOT EXISTS admin_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) UNIQUE NOT NULL,
  admin_level TEXT NOT NULL DEFAULT 'admin' CHECK (admin_level IN ('admin', 'super_admin', 'moderator')),
  permissions TEXT[] DEFAULT ARRAY['approve_ownership', 'approve_vehicle', 'review_fraud'],
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Insert you as the super admin (replace with your actual user ID when known)
-- This will need to be updated with your actual user_id from auth.users
-- INSERT INTO admin_users (user_id, admin_level, permissions) 
-- VALUES ('your-user-id-here', 'super_admin', ARRAY['approve_ownership', 'approve_vehicle', 'review_fraud', 'system_admin']);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_admin_notifications_type ON admin_notifications(notification_type);
CREATE INDEX IF NOT EXISTS idx_admin_notifications_status ON admin_notifications(status);
CREATE INDEX IF NOT EXISTS idx_admin_notifications_priority ON admin_notifications(priority DESC);
CREATE INDEX IF NOT EXISTS idx_admin_notifications_created_at ON admin_notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_notifications_ownership_verification ON admin_notifications(ownership_verification_id);
CREATE INDEX IF NOT EXISTS idx_admin_notifications_vehicle_verification ON admin_notifications(vehicle_verification_id);

CREATE INDEX IF NOT EXISTS idx_admin_users_user_id ON admin_users(user_id);
CREATE INDEX IF NOT EXISTS idx_admin_users_active ON admin_users(is_active);

-- Row Level Security
ALTER TABLE admin_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;

-- Only admins can see admin notifications
DROP POLICY IF EXISTS "Admins can view all notifications" ON admin_notifications;
CREATE POLICY "Admins can view all notifications" ON admin_notifications
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM admin_users au
      WHERE au.user_id = auth.uid() AND au.is_active = true
    )
  );

-- Only admins can update notifications
DROP POLICY IF EXISTS "Admins can update notifications" ON admin_notifications;
CREATE POLICY "Admins can update notifications" ON admin_notifications
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM admin_users au
      WHERE au.user_id = auth.uid() AND au.is_active = true
    )
  );

-- Admin users table policies
DROP POLICY IF EXISTS "Admins can view admin users" ON admin_users;
CREATE POLICY "Admins can view admin users" ON admin_users
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM admin_users au
      WHERE au.user_id = auth.uid() AND au.is_active = true
    )
  );

-- Function to create admin notification for ownership verification
DROP FUNCTION IF EXISTS create_ownership_verification_notification(UUID);

CREATE OR REPLACE FUNCTION create_ownership_verification_notification(
  p_ownership_verification_id UUID
) RETURNS UUID AS $$
DECLARE
  notification_id UUID;
  verification_record ownership_verifications%ROWTYPE;
  user_email TEXT;
  vehicle_info TEXT;
BEGIN
  -- Get verification details
  SELECT ov.* INTO verification_record
  FROM ownership_verifications ov
  WHERE ov.id = p_ownership_verification_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ownership verification % not found', p_ownership_verification_id;
  END IF;
  
  SELECT email INTO user_email FROM auth.users WHERE id = verification_record.user_id;
  
  -- Get vehicle info
  SELECT CONCAT(make, ' ', model, ' ', year) INTO vehicle_info
  FROM vehicles 
  WHERE id = verification_record.vehicle_id;
  
  -- Create admin notification
  INSERT INTO admin_notifications (
    notification_type,
    ownership_verification_id,
    user_id,
    vehicle_id,
    title,
    message,
    priority,
    action_required,
    metadata
  ) VALUES (
    'ownership_verification_pending',
    p_ownership_verification_id,
    verification_record.user_id,
    verification_record.vehicle_id,
    'Ownership Verification Pending Review',
    format('User %s has submitted ownership verification for %s. Documents uploaded and ready for admin review.', 
           user_email, COALESCE(vehicle_info, 'Unknown Vehicle')),
    3, -- Medium-high priority
    'approve_ownership',
    jsonb_build_object(
      'user_email', user_email,
      'vehicle_info', vehicle_info,
      'ai_confidence_score', verification_record.ai_confidence_score,
      'submitted_at', verification_record.submitted_at
    )
  ) RETURNING id INTO notification_id;
  
  RETURN notification_id;
END;
$$ LANGUAGE plpgsql;

-- Function to create admin notification for vehicle verification
DROP FUNCTION IF EXISTS create_vehicle_verification_notification(UUID);

CREATE OR REPLACE FUNCTION create_vehicle_verification_notification(
  p_vehicle_verification_id UUID
) RETURNS UUID AS $$
DECLARE
  notification_id UUID;
  vehicle_info TEXT;
  user_email TEXT;
BEGIN
  -- Get vehicle and user info (this assumes vehicle_verifications table exists)
  SELECT CONCAT(v.make, ' ', v.model, ' ', v.year), u.email 
  INTO vehicle_info, user_email
  FROM vehicle_verifications vv
  JOIN vehicles v ON v.id = vv.vehicle_id
  JOIN auth.users u ON u.id = vv.user_id
  WHERE vv.id = p_vehicle_verification_id;
  
  -- Create admin notification
  INSERT INTO admin_notifications (
    notification_type,
    vehicle_verification_id,
    vehicle_id,
    title,
    message,
    priority,
    action_required,
    metadata
  ) VALUES (
    'vehicle_verification_pending',
    p_vehicle_verification_id,
    (SELECT vehicle_id FROM vehicle_verifications WHERE id = p_vehicle_verification_id),
    'Vehicle Verification Pending Review',
    format('Vehicle verification submitted for %s by %s. Ready for admin review.', 
           COALESCE(vehicle_info, 'Unknown Vehicle'), COALESCE(user_email, 'Unknown User')),
    2, -- Medium priority
    'approve_vehicle',
    jsonb_build_object(
      'vehicle_info', vehicle_info,
      'user_email', user_email
    )
  ) RETURNING id INTO notification_id;
  
  RETURN notification_id;
END;
$$ LANGUAGE plpgsql;

-- Function for admin to approve ownership verification
DROP FUNCTION IF EXISTS admin_approve_ownership_verification(UUID, UUID, TEXT);

CREATE OR REPLACE FUNCTION admin_approve_ownership_verification(
  p_notification_id UUID,
  p_admin_user_id UUID,
  p_admin_notes TEXT DEFAULT NULL
) RETURNS BOOLEAN AS $$
DECLARE
  notification_record admin_notifications%ROWTYPE;
  verification_id UUID;
BEGIN
  -- Verify admin permissions
  IF NOT EXISTS (
    SELECT 1 FROM admin_users 
    WHERE user_id = p_admin_user_id AND is_active = true 
    AND 'approve_ownership' = ANY(permissions)
  ) THEN
    RAISE EXCEPTION 'User does not have admin permissions for ownership approval';
  END IF;
  
  -- Get notification
  SELECT * INTO notification_record 
  FROM admin_notifications 
  WHERE id = p_notification_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Admin notification not found';
  END IF;
  
  verification_id := notification_record.ownership_verification_id;
  
  -- Approve the ownership verification using existing function
  PERFORM approve_ownership_verification(verification_id, p_admin_user_id, p_admin_notes);
  
  -- Update admin notification
  UPDATE admin_notifications 
  SET 
    status = 'approved',
    reviewed_by_admin_id = p_admin_user_id,
    admin_notes = p_admin_notes,
    admin_decision = 'approved',
    reviewed_at = NOW(),
    updated_at = NOW()
  WHERE id = p_notification_id;
  
  RETURN true;
END;
$$ LANGUAGE plpgsql;

-- Function for admin to reject ownership verification
DROP FUNCTION IF EXISTS admin_reject_ownership_verification(UUID, UUID, TEXT);

CREATE OR REPLACE FUNCTION admin_reject_ownership_verification(
  p_notification_id UUID,
  p_admin_user_id UUID,
  p_rejection_reason TEXT
) RETURNS BOOLEAN AS $$
DECLARE
  notification_record admin_notifications%ROWTYPE;
  verification_id UUID;
BEGIN
  -- Verify admin permissions
  IF NOT EXISTS (
    SELECT 1 FROM admin_users 
    WHERE user_id = p_admin_user_id AND is_active = true 
    AND 'approve_ownership' = ANY(permissions)
  ) THEN
    RAISE EXCEPTION 'User does not have admin permissions for ownership approval';
  END IF;
  
  -- Get notification
  SELECT * INTO notification_record 
  FROM admin_notifications 
  WHERE id = p_notification_id;
  
  verification_id := notification_record.ownership_verification_id;
  
  -- Reject the ownership verification
  UPDATE ownership_verifications 
  SET 
    status = 'rejected',
    human_reviewer_id = p_admin_user_id,
    rejection_reason = p_rejection_reason,
    human_reviewed_at = NOW(),
    rejected_at = NOW(),
    updated_at = NOW()
  WHERE id = verification_id;
  
  -- Log the rejection
  INSERT INTO verification_audit_log (
    verification_id, action, actor_id, actor_type, details
  ) VALUES (
    verification_id, 'rejected', p_admin_user_id, 'admin',
    jsonb_build_object('rejection_reason', p_rejection_reason)
  );
  
  -- Update admin notification
  UPDATE admin_notifications 
  SET 
    status = 'rejected',
    reviewed_by_admin_id = p_admin_user_id,
    admin_notes = p_rejection_reason,
    admin_decision = 'rejected',
    reviewed_at = NOW(),
    updated_at = NOW()
  WHERE id = p_notification_id;
  
  RETURN true;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-create admin notifications when ownership verifications are submitted
DROP TRIGGER IF EXISTS create_admin_notification_trigger ON ownership_verifications;

DROP FUNCTION IF EXISTS trigger_create_admin_notification();

CREATE OR REPLACE FUNCTION trigger_create_admin_notification()
RETURNS TRIGGER AS $$
BEGIN
  -- Create admin notification when ownership verification moves to human_review
  IF NEW.status = 'human_review' AND (OLD.status IS NULL OR OLD.status != 'human_review') THEN
    PERFORM create_ownership_verification_notification(NEW.id);
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER create_admin_notification_trigger
  AFTER INSERT OR UPDATE ON ownership_verifications
  FOR EACH ROW
  EXECUTE FUNCTION trigger_create_admin_notification();

-- Function to get admin dashboard stats
DROP FUNCTION IF EXISTS get_admin_dashboard_stats();

CREATE OR REPLACE FUNCTION get_admin_dashboard_stats()
RETURNS JSONB AS $$
DECLARE
  stats JSONB;
BEGIN
  SELECT jsonb_build_object(
    'pending_ownership_verifications', (
      SELECT COUNT(*) FROM admin_notifications 
      WHERE notification_type = 'ownership_verification_pending' 
      AND status = 'pending'
    ),
    'pending_vehicle_verifications', (
      SELECT COUNT(*) FROM admin_notifications 
      WHERE notification_type = 'vehicle_verification_pending' 
      AND status = 'pending'
    ),
    'total_pending_notifications', (
      SELECT COUNT(*) FROM admin_notifications 
      WHERE status = 'pending'
    ),
    'high_priority_notifications', (
      SELECT COUNT(*) FROM admin_notifications 
      WHERE status = 'pending' AND priority >= 4
    ),
    'total_verifications_today', (
      SELECT COUNT(*) FROM ownership_verifications 
      WHERE DATE(created_at) = CURRENT_DATE
    ),
    'approved_today', (
      SELECT COUNT(*) FROM admin_notifications 
      WHERE status = 'approved' AND DATE(reviewed_at) = CURRENT_DATE
    )
  ) INTO stats;
  
  RETURN stats;
END;
$$ LANGUAGE plpgsql;

-- Comments
COMMENT ON TABLE admin_notifications IS 'Centralized admin notification system for ownership and vehicle verifications requiring admin approval';
COMMENT ON TABLE admin_users IS 'Admin users with permissions to approve/reject verifications';
COMMENT ON FUNCTION create_ownership_verification_notification IS 'Creates admin notification when ownership verification needs review';
COMMENT ON FUNCTION admin_approve_ownership_verification IS 'Admin function to approve ownership verification through notification system';
COMMENT ON FUNCTION admin_reject_ownership_verification IS 'Admin function to reject ownership verification through notification system';
