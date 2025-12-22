-- Fix get_admin_dashboard_stats() to require admin access
-- This prevents unauthorized users from accessing admin dashboard statistics

CREATE OR REPLACE FUNCTION get_admin_dashboard_stats()
RETURNS JSONB AS $$
DECLARE
  stats JSONB;
  v_is_admin BOOLEAN;
BEGIN
  -- Check if current user is admin via admin_users table
  SELECT EXISTS (
    SELECT 1 FROM admin_users
    WHERE user_id = auth.uid() 
      AND is_active = true
  ) INTO v_is_admin;
  
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Access denied: Admin privileges required';
  END IF;
  
  -- Return admin dashboard statistics
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION get_admin_dashboard_stats() IS 'Returns admin dashboard statistics. Requires admin privileges via admin_users table.';

