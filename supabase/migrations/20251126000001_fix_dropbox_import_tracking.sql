-- Fix Dropbox Import Origin Tracking
-- Addresses the loophole that created 26 orphaned vehicles on 2025-11-03
-- See: BULK_IMPORT_LOOPHOLE_ANALYSIS.md

-- 1. Backfill the 26 orphaned vehicles with proper tracking
-- For automated bulk imports, uploaded_by should be NULL (not a user upload)
UPDATE vehicles
SET 
  uploaded_by = NULL, -- Automated imports don't have a user uploader
  discovery_source = 'dropbox_bulk_import',
  profile_origin = 'dropbox_import', -- Change from bulk_import_legacy to dropbox_import
  origin_metadata = origin_metadata || jsonb_build_object(
    'backfilled_uploaded_by', false, -- Explicitly marked as NOT a user upload
    'backfilled_discovery_source', true,
    'backfilled_at', NOW(),
    'original_profile_origin', 'bulk_import_legacy',
    'corrected_to', 'dropbox_import',
    'automated_import', true,
    'no_user_uploader', true
  ),
  origin_organization_id = 'c433d27e-2159-4f8c-b4ae-32a5e44a77cf' -- Viva organization
WHERE profile_origin = 'bulk_import_legacy'
  AND origin_metadata->>'batch_import' = 'true'
  AND origin_metadata->>'batch_size' IN ('25', '26')
  AND created_at >= '2025-11-03T06:49:00'::timestamptz
  AND created_at <= '2025-11-03T06:55:00'::timestamptz;

-- 2. Strengthen the trigger to detect automation patterns
CREATE OR REPLACE FUNCTION set_default_vehicle_origin()
RETURNS TRIGGER AS $$
BEGIN
  -- If profile_origin is not set, infer from other fields
  IF NEW.profile_origin IS NULL THEN
    -- Check for Dropbox imports (multiple indicators)
    IF NEW.discovery_source ILIKE '%dropbox%' 
       OR NEW.import_source = 'dropbox'
       OR (NEW.origin_metadata->>'import_method' = 'edge_function_bulk_import') THEN
      NEW.profile_origin = 'dropbox_import';
    -- Check for BAT imports
    ELSIF NEW.discovery_url ILIKE '%bringatrailer%' 
       OR NEW.discovery_url ILIKE '%bat%' 
       OR NEW.bat_auction_url IS NOT NULL THEN
      NEW.profile_origin = 'bat_import';
    -- Check for URL scrapers
    ELSIF NEW.discovery_url IS NOT NULL OR NEW.discovery_source IS NOT NULL THEN
      NEW.profile_origin = 'url_scraper';
    -- Warn about suspicious automation patterns
    ELSIF NEW.user_id IS NOT NULL 
       AND NEW.uploaded_by IS NULL 
       AND NEW.discovery_source IS NULL THEN
      -- Likely automated import without proper tracking
      NEW.profile_origin = 'automated_import_legacy';
      NEW.origin_metadata = COALESCE(NEW.origin_metadata, '{}'::jsonb) || jsonb_build_object(
        'inferred_automation', true,
        'warning', 'Created without explicit origin tracking',
        'user_id_only', true
      );
    ELSE
      NEW.profile_origin = 'manual_entry';
    END IF;
  END IF;

  -- Set origin_metadata if not provided or empty
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

-- 3. Add validation trigger to warn on suspicious patterns
CREATE OR REPLACE FUNCTION validate_vehicle_origin()
RETURNS TRIGGER AS $$
BEGIN
  -- Warn if vehicle created without proper tracking
  IF NEW.uploaded_by IS NULL 
     AND NEW.user_id IS NULL 
     AND NEW.profile_origin IN ('manual_entry', 'automated_import_legacy')
     AND (NEW.origin_metadata IS NULL OR NEW.origin_metadata = '{}'::jsonb) THEN
    RAISE WARNING 'Vehicle % created without origin tracking: uploaded_by=%, user_id=%, profile_origin=%', 
      NEW.id, NEW.uploaded_by, NEW.user_id, NEW.profile_origin;
  END IF;
  
  -- Warn if Dropbox import without discovery_source
  IF NEW.profile_origin = 'dropbox_import' AND NEW.discovery_source IS NULL THEN
    RAISE WARNING 'Dropbox import vehicle % missing discovery_source', NEW.id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_validate_vehicle_origin ON vehicles;
CREATE TRIGGER trigger_validate_vehicle_origin
AFTER INSERT ON vehicles
FOR EACH ROW
EXECUTE FUNCTION validate_vehicle_origin();

COMMENT ON FUNCTION validate_vehicle_origin() IS 'Warns when vehicles are created without proper origin tracking - helps catch automation loopholes';

-- 4. Add comment documenting the fix
COMMENT ON COLUMN vehicles.profile_origin IS 'Source of vehicle profile creation: bat_import, dropbox_import, manual_entry, url_scraper, api_import, automated_import_legacy. MUST be set explicitly in application code - do not rely on trigger fallback.';
COMMENT ON COLUMN vehicles.discovery_source IS 'Required for automated imports. Examples: dropbox_bulk_import, bat_extension, url_scraper. Used by trigger to infer profile_origin.';

