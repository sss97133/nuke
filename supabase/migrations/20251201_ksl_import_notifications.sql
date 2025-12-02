-- Notification system for KSL vehicle imports
-- Creates admin notifications when new vehicles are imported from KSL

-- Add new notification type for vehicle imports
ALTER TABLE admin_notifications 
  DROP CONSTRAINT IF EXISTS admin_notifications_notification_type_check;

ALTER TABLE admin_notifications
  ADD CONSTRAINT admin_notifications_notification_type_check 
  CHECK (notification_type IN (
    'ownership_verification_pending',
    'vehicle_verification_pending', 
    'user_verification_pending',
    'fraud_alert',
    'system_alert',
    'new_vehicle_import'  -- New type for KSL imports
  ));

-- Add new action type for reviewing imports
ALTER TABLE admin_notifications 
  DROP CONSTRAINT IF EXISTS admin_notifications_action_required_check;

ALTER TABLE admin_notifications
  ADD CONSTRAINT admin_notifications_action_required_check 
  CHECK (action_required IN (
    'approve_ownership',
    'reject_ownership', 
    'approve_vehicle',
    'reject_vehicle',
    'review_fraud',
    'system_action',
    'review_import'  -- New action for reviewing imports
  ));

-- Function to create notification when KSL vehicle is imported
CREATE OR REPLACE FUNCTION notify_admin_new_vehicle_import()
RETURNS TRIGGER AS $$
DECLARE
  vehicle_info TEXT;
BEGIN
  -- Only notify for KSL imports that are public
  IF NEW.discovery_source = 'ksl_automated_import' AND NEW.is_public = true THEN
    vehicle_info := CONCAT(NEW.year, ' ', NEW.make, ' ', NEW.model);
    
    -- Create admin notification
    INSERT INTO admin_notifications (
      notification_type,
      vehicle_id,
      title,
      message,
      priority,
      action_required,
      metadata,
      status
    ) VALUES (
      'new_vehicle_import',
      NEW.id,
      'New Vehicle Imported from KSL',
      format('New vehicle imported: %s. Source: %s', 
             vehicle_info, 
             COALESCE(NEW.discovery_url, 'KSL')),
      2, -- Medium priority
      'review_import',
      jsonb_build_object(
        'vehicle_id', NEW.id,
        'year', NEW.year,
        'make', NEW.make,
        'model', NEW.model,
        'discovery_url', NEW.discovery_url,
        'discovery_source', NEW.discovery_source,
        'imported_at', NEW.created_at
      ),
      'pending'
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger
DROP TRIGGER IF EXISTS trigger_notify_admin_new_vehicle_import ON vehicles;
CREATE TRIGGER trigger_notify_admin_new_vehicle_import
  AFTER INSERT ON vehicles
  FOR EACH ROW
  EXECUTE FUNCTION notify_admin_new_vehicle_import();

-- Grant permissions
GRANT SELECT, INSERT ON admin_notifications TO authenticated;
