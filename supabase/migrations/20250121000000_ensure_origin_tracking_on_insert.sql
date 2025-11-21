-- Ensure all vehicle creation points save origin tracking data
-- This migration adds a trigger to automatically set origin fields if not provided

-- Function to set default origin tracking on insert
CREATE OR REPLACE FUNCTION set_default_vehicle_origin()
RETURNS TRIGGER AS $$
BEGIN
  -- If profile_origin is not set, infer from other fields
  IF NEW.profile_origin IS NULL THEN
    IF NEW.discovery_url ILIKE '%bringatrailer%' OR NEW.discovery_url ILIKE '%bat%' OR NEW.bat_auction_url IS NOT NULL THEN
      NEW.profile_origin = 'bat_import';
    ELSIF NEW.discovery_source ILIKE '%dropbox%' OR NEW.import_source = 'dropbox' THEN
      NEW.profile_origin = 'dropbox_import';
    ELSIF NEW.discovery_url IS NOT NULL OR NEW.discovery_source IS NOT NULL THEN
      NEW.profile_origin = 'url_scraper';
    ELSE
      NEW.profile_origin = 'manual_entry';
    END IF;
  END IF;

  -- Set origin_metadata if not provided
  IF NEW.origin_metadata IS NULL OR NEW.origin_metadata = '{}'::jsonb THEN
    NEW.origin_metadata = jsonb_build_object(
      'import_date', COALESCE(NEW.created_at::date, CURRENT_DATE),
      'import_source', COALESCE(NEW.import_source, NEW.discovery_source, 'manual_entry')
    );
    
    -- Add bat_url if present
    IF NEW.bat_auction_url IS NOT NULL THEN
      NEW.origin_metadata = NEW.origin_metadata || jsonb_build_object('bat_url', NEW.bat_auction_url);
    END IF;
    
    -- Add discovery_url if present
    IF NEW.discovery_url IS NOT NULL THEN
      NEW.origin_metadata = NEW.origin_metadata || jsonb_build_object('discovery_url', NEW.discovery_url);
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to auto-set origin on insert
DROP TRIGGER IF EXISTS trigger_set_default_vehicle_origin ON vehicles;
CREATE TRIGGER trigger_set_default_vehicle_origin
  BEFORE INSERT ON vehicles
  FOR EACH ROW
  EXECUTE FUNCTION set_default_vehicle_origin();

COMMENT ON FUNCTION set_default_vehicle_origin() IS 'Automatically sets profile_origin and origin_metadata when vehicles are created without explicit origin tracking';

