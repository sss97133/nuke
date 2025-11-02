-- Fix Organization Stat Counters
-- Problem: businesses.total_images and total_events not updating when data is inserted
-- Solution: Create triggers to auto-update stats

-- Drop existing broken triggers if any
DROP TRIGGER IF EXISTS trg_update_org_stats_on_image ON organization_images;
DROP TRIGGER IF EXISTS trg_update_org_stats_on_event ON business_timeline_events;
DROP TRIGGER IF EXISTS trg_update_org_stats_on_vehicle ON organization_vehicles;
DROP FUNCTION IF EXISTS update_organization_stats();

-- Function to update organization stats
CREATE OR REPLACE FUNCTION update_organization_stats()
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
$$ LANGUAGE plpgsql;

-- Create triggers on all relevant tables
CREATE TRIGGER trg_update_org_stats_on_image
AFTER INSERT OR DELETE ON organization_images
FOR EACH ROW EXECUTE FUNCTION update_organization_stats();

CREATE TRIGGER trg_update_org_stats_on_event
AFTER INSERT OR DELETE ON business_timeline_events
FOR EACH ROW EXECUTE FUNCTION update_organization_stats();

CREATE TRIGGER trg_update_org_stats_on_vehicle
AFTER INSERT OR DELETE ON organization_vehicles
FOR EACH ROW EXECUTE FUNCTION update_organization_stats();

-- Backfill existing data for all organizations
DO $$
DECLARE
  org RECORD;
BEGIN
  FOR org IN SELECT id FROM businesses LOOP
    UPDATE businesses
    SET 
      total_images = (
        SELECT COUNT(*) 
        FROM organization_images 
        WHERE organization_id = org.id
      ),
      total_events = (
        SELECT COUNT(*) 
        FROM business_timeline_events 
        WHERE business_id = org.id
      ),
      total_vehicles = (
        SELECT COUNT(*) 
        FROM organization_vehicles 
        WHERE organization_id = org.id
      ),
      updated_at = NOW()
    WHERE id = org.id;
  END LOOP;
END $$;

-- Verify the fix
SELECT 
  business_name,
  total_images,
  total_events,
  total_vehicles,
  (SELECT COUNT(*) FROM organization_images WHERE organization_id = businesses.id) as actual_images,
  (SELECT COUNT(*) FROM business_timeline_events WHERE business_id = businesses.id) as actual_events
FROM businesses
ORDER BY business_name;

