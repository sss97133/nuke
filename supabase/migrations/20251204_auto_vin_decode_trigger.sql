-- Auto-trigger VIN decode when a VIN is set on a vehicle
-- This queues the decode job without blocking the update

CREATE OR REPLACE FUNCTION trigger_vin_decode()
RETURNS TRIGGER AS $$
DECLARE
  v_supabase_url TEXT;
  v_service_role_key TEXT;
  v_config_error TEXT;
BEGIN
  -- Only trigger if VIN was just set (null -> value) or changed
  IF (OLD.vin IS NULL AND NEW.vin IS NOT NULL) OR 
     (OLD.vin IS DISTINCT FROM NEW.vin AND NEW.vin IS NOT NULL) THEN
    
    -- Get configuration settings with comprehensive error handling
    BEGIN
      -- Retrieve settings with explicit exception handling
      BEGIN
        v_supabase_url := current_setting('app.settings.supabase_url', true);
      EXCEPTION
        WHEN OTHERS THEN
          v_config_error := 'Failed to retrieve app.settings.supabase_url: ' || SQLERRM;
          RAISE WARNING 'VIN decode skipped for vehicle % (VIN: %): %. Run: ALTER DATABASE postgres SET app.settings.supabase_url = ''https://YOUR_PROJECT_REF.supabase.co'';', NEW.id, NEW.vin, v_config_error;
          RETURN NEW;
      END;
      
      BEGIN
        v_service_role_key := current_setting('app.settings.service_role_key', true);
      EXCEPTION
        WHEN OTHERS THEN
          v_config_error := 'Failed to retrieve app.settings.service_role_key: ' || SQLERRM;
          RAISE WARNING 'VIN decode skipped for vehicle % (VIN: %): %. Run: ALTER DATABASE postgres SET app.settings.service_role_key = ''YOUR_SERVICE_ROLE_KEY'';', NEW.id, NEW.vin, v_config_error;
          RETURN NEW;
      END;
      
      -- Validate settings exist and are not empty
      IF v_supabase_url IS NULL OR v_supabase_url = '' THEN
        RAISE WARNING 'VIN decode skipped for vehicle % (VIN: %): app.settings.supabase_url is NULL or empty. Run: ALTER DATABASE postgres SET app.settings.supabase_url = ''https://YOUR_PROJECT_REF.supabase.co'';', NEW.id, NEW.vin;
        RETURN NEW;
      END IF;
      
      IF v_service_role_key IS NULL OR v_service_role_key = '' THEN
        RAISE WARNING 'VIN decode skipped for vehicle % (VIN: %): app.settings.service_role_key is NULL or empty. Run: ALTER DATABASE postgres SET app.settings.service_role_key = ''YOUR_SERVICE_ROLE_KEY'';', NEW.id, NEW.vin;
        RETURN NEW;
      END IF;
      
      -- Validate URL format (basic check)
      IF NOT (v_supabase_url LIKE 'https://%' OR v_supabase_url LIKE 'http://%') THEN
        RAISE WARNING 'VIN decode skipped for vehicle % (VIN: %): app.settings.supabase_url has invalid format: %. Expected format: https://YOUR_PROJECT_REF.supabase.co', NEW.id, NEW.vin, v_supabase_url;
        RETURN NEW;
      END IF;
      
      -- Queue async decode job via pg_net (non-blocking HTTP call)
      -- This calls an Edge Function to perform NHTSA decode
      BEGIN
        PERFORM net.http_post(
          url := v_supabase_url || '/functions/v1/decode-vin-and-update',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || v_service_role_key
          ),
          body := jsonb_build_object(
            'vehicle_id', NEW.id,
            'vin', NEW.vin
          )
        );
        
        RAISE NOTICE 'Queued VIN decode for vehicle % (VIN: %)', NEW.id, NEW.vin;
      EXCEPTION
        WHEN OTHERS THEN
          -- Log detailed error but don't block the vehicle update
          RAISE WARNING 'Failed to queue VIN decode HTTP call for vehicle % (VIN: %): % (URL: %, Key configured: %)', 
            NEW.id, NEW.vin, SQLERRM, v_supabase_url, (v_service_role_key IS NOT NULL AND length(v_service_role_key) > 0);
      END;
      
    EXCEPTION WHEN OTHERS THEN
      -- Catch-all for any unexpected errors in the configuration retrieval
      RAISE WARNING 'Unexpected error in VIN decode trigger for vehicle % (VIN: %): %', NEW.id, NEW.vin, SQLERRM;
    END;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger on vehicles table
DROP TRIGGER IF EXISTS auto_vin_decode_trigger ON vehicles;
CREATE TRIGGER auto_vin_decode_trigger
  AFTER INSERT OR UPDATE OF vin ON vehicles
  FOR EACH ROW
  WHEN (NEW.vin IS NOT NULL)
  EXECUTE FUNCTION trigger_vin_decode();

COMMENT ON FUNCTION trigger_vin_decode() IS 'Automatically queues VIN decode via NHTSA when VIN is set on a vehicle. Requires app.settings.supabase_url and app.settings.service_role_key to be configured.';

-- Setup instructions:
-- Run these commands to configure the trigger:
-- ALTER DATABASE postgres SET app.settings.supabase_url = 'https://YOUR_PROJECT_REF.supabase.co';
-- ALTER DATABASE postgres SET app.settings.service_role_key = 'YOUR_SERVICE_ROLE_KEY';
--
-- To verify settings are configured:
-- SELECT current_setting('app.settings.supabase_url', true) as supabase_url;
-- SELECT current_setting('app.settings.service_role_key', true) IS NOT NULL as has_service_key;
