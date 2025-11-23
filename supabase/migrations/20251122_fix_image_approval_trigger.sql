-- Fix apply_auto_approval_for_image trigger
-- Bug: Was trying to SELECT vehicle_id FROM vehicles which doesn't make sense
-- Fix: Just use NEW.vehicle_id directly since it's already available

CREATE OR REPLACE FUNCTION apply_auto_approval_for_image()
RETURNS TRIGGER 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID;
  v_status content_approval_status;
BEGIN
  v_actor := COALESCE(NEW.submitted_by, NEW.user_id, auth.uid());
  NEW.submitted_by := v_actor;
  
  -- Check if vehicle exists and get approval status
  IF NEW.vehicle_id IS NOT NULL THEN
    v_status := auto_approve_vehicle_content(NEW.vehicle_id, v_actor);
    
    IF v_status = 'auto_approved' THEN
      NEW.approval_status := 'auto_approved';
      NEW.approved_by := v_actor;
      NEW.approved_at := NOW();
    ELSE
      NEW.approval_status := COALESCE(NEW.approval_status, 'pending');
    END IF;
  ELSE
    NEW.approval_status := COALESCE(NEW.approval_status, 'pending');
  END IF;
  
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION apply_auto_approval_for_image IS 
'Auto-approves images uploaded by vehicle owners. Fixed to not query vehicles.vehicle_id column.';

