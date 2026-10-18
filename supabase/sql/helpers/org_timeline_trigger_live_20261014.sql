-- Live on production 2026-10-14 (pg_get_functiondef): the SECURITY INVOKER trigger that copies an organization's vehicle
-- timeline events into its business timeline, with its trigger.
CREATE OR REPLACE FUNCTION public.create_org_timeline_from_vehicle_event()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  vehicle_name TEXT;
  v_event_category TEXT;
  v_created_by UUID;
BEGIN
  IF NEW.organization_id IS NOT NULL AND (OLD.organization_id IS NULL OR OLD.organization_id != NEW.organization_id) THEN
    
    SELECT CONCAT(year, ' ', make, ' ', model) INTO vehicle_name
    FROM vehicles
    WHERE id = NEW.vehicle_id;
    
    -- Map vehicle event_type to valid business event_category
    v_event_category := CASE 
      WHEN NEW.event_type IN ('maintenance', 'repair', 'modification', 'paint', 'body', 'mechanical', 'electrical', 'work_completed') THEN 'operational'
      WHEN NEW.event_type IN ('inspection', 'purchase', 'sale') THEN 'legal'
      WHEN NEW.event_type IN ('photo_added', 'documentation') THEN 'other'
      ELSE 'other'
    END;
    
    -- Use user_id if available, otherwise use the vehicle owner
    v_created_by := COALESCE(
      NEW.user_id,
      (SELECT user_id FROM vehicles WHERE id = NEW.vehicle_id LIMIT 1)
    );
    
    INSERT INTO business_timeline_events (
      business_id,
      event_type,
      event_category,
      title,
      description,
      event_date,
      cost_amount,
      labor_hours,
      image_urls,
      metadata,
      created_by
    ) VALUES (
      NEW.organization_id,
      CASE 
        WHEN NEW.event_type IN ('maintenance', 'repair', 'modification', 'work_completed') THEN 'other'
        ELSE 'other'
      END,
      v_event_category,
      COALESCE(NEW.title, 'Service for ' || vehicle_name),
      NEW.description,
      NEW.event_date,
      NEW.cost_amount,
      COALESCE(NEW.duration_hours, NEW.labor_hours),
      NEW.image_urls,
      jsonb_build_object(
        'vehicle_id', NEW.vehicle_id,
        'vehicle_name', vehicle_name,
        'timeline_event_id', NEW.id,
        'event_type', NEW.event_type
      ),
      v_created_by
    )
    ON CONFLICT DO NOTHING;
    
  END IF;
  
  RETURN NEW;
END;
$function$

;
CREATE TRIGGER trg_create_org_timeline_from_vehicle AFTER INSERT OR UPDATE OF organization_id ON public.timeline_events FOR EACH ROW EXECUTE FUNCTION create_org_timeline_from_vehicle_event();
