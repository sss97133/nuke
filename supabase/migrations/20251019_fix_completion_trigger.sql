-- Fix completion trigger to not block vehicle updates
-- If calculation fails, just skip it and allow the update

CREATE OR REPLACE FUNCTION update_vehicle_completion()
RETURNS TRIGGER AS $$
DECLARE
  completion_data JSONB;
BEGIN
  -- Try to calculate completion, but don't block on errors
  BEGIN
    completion_data := calculate_vehicle_completion_algorithmic(NEW.id);
    
    -- Only update if we got a valid result
    IF completion_data IS NOT NULL AND completion_data->>'completion_percentage' IS NOT NULL THEN
      NEW.completion_percentage := (completion_data->>'completion_percentage')::INTEGER;
    END IF;
    
  EXCEPTION WHEN OTHERS THEN
    -- Log the error but don't block the update
    RAISE WARNING 'Failed to calculate completion for vehicle %: %', NEW.id, SQLERRM;
    -- Leave completion_percentage as-is
  END;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION update_vehicle_completion() IS 
'Auto-updates vehicle completion percentage. Non-blocking - errors are logged but do not prevent vehicle updates.';

