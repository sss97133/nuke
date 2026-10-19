-- Live on production 2026-10-14 (pg_get_functiondef): the AFTER INSERT trigger on vehicle_relationship_verifications that
-- notifies an organization's other active contributors. SECURITY INVOKER, so its insert runs as the requester.
CREATE OR REPLACE FUNCTION public.notify_org_members_of_verification()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    org_id UUID;
    org_vehicle RECORD;
BEGIN
    -- Get organization ID from the vehicle link
    SELECT ov.organization_id, ov.vehicle_id, ov.relationship_type
    INTO org_vehicle
    FROM organization_vehicles ov
    WHERE ov.id = NEW.organization_vehicle_id;
    
    org_id := org_vehicle.organization_id;
    
    -- Create notifications for all active org members (owners, managers, board members get priority)
    INSERT INTO organization_vehicle_notifications (
        organization_id,
        organization_vehicle_id,
        verification_id,
        notification_type,
        message,
        priority,
        assigned_to_user_id,
        created_by_user_id
    )
    SELECT 
        org_id,
        NEW.organization_vehicle_id,
        NEW.id,
        CASE 
            WHEN NEW.verification_type = 'sale' THEN 'sale_verification'
            WHEN NEW.verification_type = 'relationship' THEN 'relationship_verification'
            ELSE 'status_change_request'
        END,
        CASE 
            WHEN NEW.verification_type = 'sale' THEN 
                'Vehicle sale verification requested. Proof required: ' || COALESCE(NEW.proof_type, 'none')
            WHEN NEW.verification_type = 'relationship' THEN
                'Vehicle relationship verification requested: ' || COALESCE(NEW.current_relationship_type, 'unknown') || ' → ' || COALESCE(NEW.proposed_relationship_type, 'unknown')
            ELSE
                'Vehicle status change requested'
        END,
        CASE 
            WHEN oc.role IN ('owner', 'co_founder', 'manager', 'board_member') THEN 'high'
            ELSE 'normal'
        END,
        oc.user_id,
        NEW.requested_by_user_id
    FROM organization_contributors oc
    WHERE oc.organization_id = org_id
        AND oc.status = 'active'
        AND oc.user_id != NEW.requested_by_user_id; -- Don't notify the requester
    
    RETURN NEW;
END;
$function$

;
