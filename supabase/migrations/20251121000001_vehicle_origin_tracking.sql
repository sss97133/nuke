-- Vehicle Origin Tracking System
-- Tracks where vehicle profiles came from (BAT, Dropbox, manual, etc.)
-- and links them to organizations based on origin

-- Add origin tracking columns if they don't exist
ALTER TABLE vehicles 
ADD COLUMN IF NOT EXISTS profile_origin TEXT, -- 'bat_import', 'dropbox_import', 'manual_entry', 'url_scraper', 'api_import'
ADD COLUMN IF NOT EXISTS origin_organization_id UUID REFERENCES businesses(id),
ADD COLUMN IF NOT EXISTS origin_metadata JSONB DEFAULT '{}'::jsonb;

-- Add index for origin queries
CREATE INDEX IF NOT EXISTS idx_vehicles_profile_origin ON vehicles(profile_origin);
CREATE INDEX IF NOT EXISTS idx_vehicles_origin_org ON vehicles(origin_organization_id);

-- Add comments for documentation
COMMENT ON COLUMN vehicles.profile_origin IS 'Source of vehicle profile creation: bat_import, dropbox_import, manual_entry, url_scraper, api_import';
COMMENT ON COLUMN vehicles.origin_organization_id IS 'Organization that this vehicle profile originated from (if applicable)';
COMMENT ON COLUMN vehicles.origin_metadata IS 'Additional metadata about origin: {bat_seller, dropbox_folder, import_date, etc}';

-- Function to auto-link vehicles to organizations based on origin
CREATE OR REPLACE FUNCTION auto_link_vehicle_to_origin_org()
RETURNS TRIGGER AS $$
BEGIN
  -- If vehicle has origin_organization_id but no organization_vehicles link, create one
  IF NEW.origin_organization_id IS NOT NULL THEN
    INSERT INTO organization_vehicles (
      organization_id,
      vehicle_id,
      relationship_type,
      status,
      auto_tagged,
      linked_by_user_id
    )
    SELECT 
      NEW.origin_organization_id,
      NEW.id,
      CASE 
        WHEN NEW.profile_origin = 'bat_import' THEN 'consigner'
        WHEN NEW.profile_origin = 'dropbox_import' THEN 'owner'
        ELSE 'collaborator'
      END,
      'active',
      true,
      NEW.uploaded_by
    WHERE NOT EXISTS (
      SELECT 1 FROM organization_vehicles 
      WHERE organization_id = NEW.origin_organization_id 
        AND vehicle_id = NEW.id
        AND status = 'active'
    )
    ON CONFLICT DO NOTHING;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to auto-link on insert/update
DROP TRIGGER IF EXISTS trigger_auto_link_origin_org ON vehicles;
CREATE TRIGGER trigger_auto_link_origin_org
  AFTER INSERT OR UPDATE OF origin_organization_id ON vehicles
  FOR EACH ROW
  EXECUTE FUNCTION auto_link_vehicle_to_origin_org();

-- Backfill existing vehicles with origin data
-- BAT imports
UPDATE vehicles
SET 
  profile_origin = 'bat_import',
  origin_organization_id = 'c433d27e-2159-4f8c-b4ae-32a5e44a77cf', -- Viva! Las Vegas Autos
  origin_metadata = jsonb_build_object(
    'bat_seller', bat_seller,
    'bat_listing_title', bat_listing_title,
    'bat_location', bat_location,
    'discovery_url', discovery_url
  )
WHERE (discovery_source ILIKE '%bat%' OR discovery_source ILIKE '%bringatrailer%' OR discovery_url ILIKE '%bringatrailer%')
  AND profile_origin IS NULL
  AND created_at >= '2024-01-01';

-- Dropbox imports
UPDATE vehicles
SET 
  profile_origin = 'dropbox_import',
  origin_organization_id = 'c433d27e-2159-4f8c-b4ae-32a5e44a77cf', -- Viva! Las Vegas Autos
  origin_metadata = jsonb_build_object(
    'import_source', import_source,
    'discovery_source', discovery_source
  )
WHERE (import_source = 'dropbox' OR discovery_source ILIKE '%dropbox%')
  AND profile_origin IS NULL;

-- Manual entries (no clear origin)
UPDATE vehicles
SET profile_origin = 'manual_entry'
WHERE profile_origin IS NULL
  AND discovery_source IS NULL
  AND import_source IS NULL;

