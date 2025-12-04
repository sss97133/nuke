-- Auto-trigger VIN decode when a VIN is set on a vehicle
-- This queues the decode job without blocking the update

CREATE OR REPLACE FUNCTION trigger_vin_decode()
RETURNS TRIGGER AS $$
BEGIN
  -- Only trigger if VIN was just set (null -> value) or changed
  IF (OLD.vin IS NULL AND NEW.vin IS NOT NULL) OR 
     (OLD.vin IS DISTINCT FROM NEW.vin AND NEW.vin IS NOT NULL) THEN
    
    -- Queue async decode job via pg_net (non-blocking HTTP call)
    -- This calls an Edge Function to perform NHTSA decode
    PERFORM net.http_post(
      url := current_setting('app.settings.supabase_url', true) || '/functions/v1/decode-vin-and-update',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
      ),
      body := jsonb_build_object(
        'vehicle_id', NEW.id,
        'vin', NEW.vin
      )
    );
    
    RAISE NOTICE 'Queued VIN decode for vehicle % (VIN: %)', NEW.id, NEW.vin;
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

COMMENT ON FUNCTION trigger_vin_decode() IS 'Automatically queues VIN decode via NHTSA when VIN is set on a vehicle';

