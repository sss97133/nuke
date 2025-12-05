-- Auto-trigger VIN decode when a VIN is set on a vehicle
-- This queues the decode job without blocking the update

CREATE OR REPLACE FUNCTION trigger_vin_decode()
RETURNS TRIGGER AS $$
DECLARE
  v_supabase_url TEXT;
  v_service_role_key TEXT;
BEGIN
  -- Only trigger if VIN was just set (null -> value) or changed
  IF (OLD.vin IS NULL AND NEW.vin IS NOT NULL) OR 
     (OLD.vin IS DISTINCT FROM NEW.vin AND NEW.vin IS NOT NULL) THEN
    
    -- Get configuration settings with error handling
    BEGIN
      v_supabase_url := current_setting('app.settings.supabase_url', true);
      v_service_role_key := current_setting('app.settings.service_role_key', true);
      
      -- Validate settings exist
      IF v_supabase_url IS NULL OR v_supabase_url = '' THEN
        RAISE WARNING 'VIN decode skipped for vehicle %: app.settings.supabase_url is not configured. Run: ALTER DATABASE postgres SET app.settings.supabase_url = ''https://YOUR_PROJECT_REF.supabase.co'';', NEW.id;
        RETURN NEW;
      END IF;
      
      IF v_service_role_key IS NULL OR v_service_role_key = '' THEN
        RAISE WARNING 'VIN decode skipped for vehicle %: app.settings.service_role_key is not configured. Run: ALTER DATABASE postgres SET app.settings.service_role_key = ''YOUR_SERVICE_ROLE_KEY'';', NEW.id;
        RETURN NEW;
      END IF;
      
      -- Queue async decode job via pg_net (non-blocking HTTP call)
      -- This calls an Edge Function to perform NHTSA decode
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
      
    EXCEPTION WHEN OTHERS THEN
      -- Log error but don't block the vehicle update
      RAISE WARNING 'Failed to queue VIN decode for vehicle % (VIN: %): %', NEW.id, NEW.vin, SQLERRM;
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