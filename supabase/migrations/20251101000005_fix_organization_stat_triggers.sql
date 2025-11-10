-- Fix Organization Stat Counters
-- Problem: businesses.total_images and total_events not updating when data is inserted
-- Solution: Create triggers to auto-update stats

-- Drop existing broken triggers if any
DO $$
BEGIN
  IF to_regclass('public.organization_images') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_update_org_stats_on_image ON public.organization_images';
  END IF;
  IF to_regclass('public.business_timeline_events') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_update_org_stats_on_event ON public.business_timeline_events';
  END IF;
  IF to_regclass('public.organization_vehicles') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_update_org_stats_on_vehicle ON public.organization_vehicles';
  END IF;
  EXECUTE 'DROP FUNCTION IF EXISTS public.update_organization_stats()';
END
$$;

-- Function to update organization stats
CREATE OR REPLACE FUNCTION public.update_organization_stats()
RETURNS TRIGGER AS $$
DECLARE
  org_id UUID;
BEGIN
  -- Determine which organization_id to update based on the trigger table
  IF TG_TABLE_NAME = 'organization_images' THEN
    org_id := COALESCE(NEW.organization_id, OLD.organization_id);
  ELSIF TG_TABLE_NAME = 'business_timeline_events' THEN
    org_id := COALESCE(NEW.business_id, OLD.business_id);
  ELSIF TG_TABLE_NAME = 'organization_vehicles' THEN
    org_id := COALESCE(NEW.organization_id, OLD.organization_id);
  END IF;

  -- Update stats for the organization
  IF org_id IS NOT NULL THEN
    UPDATE businesses
    SET 
      total_images = (
        SELECT COUNT(*) 
        FROM organization_images 
        WHERE organization_id = org_id
      ),
      total_events = (
        SELECT COUNT(*) 
        FROM business_timeline_events 
        WHERE business_id = org_id
      ),
      total_vehicles = (
        SELECT COUNT(*) 
        FROM organization_vehicles 
        WHERE organization_id = org_id
      ),
      updated_at = NOW()
    WHERE id = org_id;
  END IF;
  
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path = public;

-- Create triggers on all relevant tables
DO $$
BEGIN
  IF to_regclass('public.organization_images') IS NOT NULL THEN
    EXECUTE 'CREATE TRIGGER trg_update_org_stats_on_image
      AFTER INSERT OR DELETE ON public.organization_images
      FOR EACH ROW EXECUTE FUNCTION public.update_organization_stats()';
  END IF;

  IF to_regclass('public.business_timeline_events') IS NOT NULL THEN
    EXECUTE 'CREATE TRIGGER trg_update_org_stats_on_event
      AFTER INSERT OR DELETE ON public.business_timeline_events
      FOR EACH ROW EXECUTE FUNCTION public.update_organization_stats()';
  END IF;

  IF to_regclass('public.organization_vehicles') IS NOT NULL THEN
    EXECUTE 'CREATE TRIGGER trg_update_org_stats_on_vehicle
      AFTER INSERT OR DELETE ON public.organization_vehicles
      FOR EACH ROW EXECUTE FUNCTION public.update_organization_stats()';
  END IF;
END
$$;

-- Backfill existing data for all organizations
DO $$
DECLARE
  org RECORD;
BEGIN
  IF to_regclass('public.businesses') IS NULL THEN
    RAISE NOTICE 'Skipping backfill: businesses table not found.';
    RETURN;
  END IF;

  FOR org IN SELECT id FROM public.businesses LOOP
    UPDATE public.businesses
    SET 
      total_images = (
        SELECT COUNT(*) 
        FROM public.organization_images 
        WHERE organization_id = org.id
      ),
      total_events = (
        SELECT COUNT(*)
        FROM public.business_timeline_events 
        WHERE business_id = org.id
      ),
      total_vehicles = (
        SELECT COUNT(*)
        FROM public.organization_vehicles 
        WHERE organization_id = org.id
      ),
      updated_at = NOW()
    WHERE id = org.id;
  END LOOP;
END $$;

