-- Auto-Discover Reference Documents Trigger
-- Automatically searches for and links reference documentation when vehicles are created
-- Uses pg_net to call Edge Function asynchronously

-- Function to trigger auto-discovery Edge Function
CREATE OR REPLACE FUNCTION trigger_auto_discover_reference_docs()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  supabase_url TEXT := 'https://qkgaybvrernstplzjaam.supabase.co';
  service_key TEXT;
BEGIN
  -- Only run for new vehicles with complete YMM data
  IF TG_OP = 'INSERT' AND NEW.year IS NOT NULL AND NEW.make IS NOT NULL AND NEW.model IS NOT NULL THEN
    
    -- Get service role key from secrets (fallback to env var name if not available)
    BEGIN
      service_key := current_setting('app.settings.service_role_key', true);
    EXCEPTION WHEN OTHERS THEN
      -- Will use service role key from Edge Function env vars
      service_key := NULL;
    END;
    
    -- Call Edge Function asynchronously via pg_net (non-blocking)
    BEGIN
      PERFORM net.http_post(
        url := supabase_url || '/functions/v1/auto-discover-reference-docs',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || COALESCE(
            service_key,
            current_setting('app.supabase_service_role_key', true),
            'PLACEHOLDER' -- Edge Function will use its own env var
          )
        ),
        body := jsonb_build_object(
          'vehicle_id', NEW.id,
          'year', NEW.year,
          'make', NEW.make,
          'model', NEW.model,
          'series', NEW.series,
          'body_style', NEW.body_style
        )
      );
    EXCEPTION WHEN OTHERS THEN
      -- pg_net might not be available, silently fail (non-critical)
      -- Could log to a queue table here if needed
      RAISE NOTICE 'Auto-discovery trigger: pg_net not available or failed: %', SQLERRM;
    END;
    
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create trigger on vehicles table
DROP TRIGGER IF EXISTS auto_discover_reference_docs_trigger ON vehicles;

CREATE TRIGGER auto_discover_reference_docs_trigger
  AFTER INSERT ON vehicles
  FOR EACH ROW
  WHEN (NEW.year IS NOT NULL AND NEW.make IS NOT NULL AND NEW.model IS NOT NULL)
  EXECUTE FUNCTION trigger_auto_discover_reference_docs();

COMMENT ON FUNCTION trigger_auto_discover_reference_docs() IS 'Automatically searches for and links reference documentation when new vehicles are created';
COMMENT ON TRIGGER auto_discover_reference_docs_trigger ON vehicles IS 'Triggers auto-discovery of reference docs on vehicle creation';

