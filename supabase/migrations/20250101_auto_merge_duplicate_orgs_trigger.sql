-- Trigger function to auto-merge duplicate organizations after insert/update
CREATE OR REPLACE FUNCTION auto_merge_duplicate_orgs_trigger()
RETURNS TRIGGER AS $$
BEGIN
  -- Call the edge function asynchronously (non-blocking)
  -- This is done via pg_net extension if available, otherwise we'll use a scheduled job
  PERFORM net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/auto-merge-duplicate-orgs',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.supabase_service_role_key')
    ),
    body := jsonb_build_object('organizationId', NEW.id)
  );
  
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- If pg_net is not available, just log and continue
  RAISE WARNING 'Could not trigger auto-merge: %', SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger on businesses table
DROP TRIGGER IF EXISTS trigger_auto_merge_duplicate_orgs ON businesses;
CREATE TRIGGER trigger_auto_merge_duplicate_orgs
  AFTER INSERT OR UPDATE ON businesses
  FOR EACH ROW
  WHEN (NEW.is_public = true)
  EXECUTE FUNCTION auto_merge_duplicate_orgs_trigger();

COMMENT ON FUNCTION auto_merge_duplicate_orgs_trigger() IS 
  'Automatically checks for and merges duplicate organizations after insert/update';

