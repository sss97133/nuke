-- ==========================================================================
-- AUTOMATED DUPLICATE DETECTION TRIGGER
-- ==========================================================================
-- Purpose: Automatically detect and merge duplicates when vehicles are created/updated
-- ==========================================================================

-- Function: Check for duplicates after vehicle insert/update
CREATE OR REPLACE FUNCTION trigger_check_duplicates()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_duplicate RECORD;
  v_auto_merge_threshold INTEGER := 95;
BEGIN
  -- Only check if vehicle has year, make, and model
  IF NEW.year IS NULL OR NEW.make IS NULL OR NEW.model IS NULL THEN
    RETURN NEW;
  END IF;
  
  -- Find duplicates with high confidence (auto-merge threshold)
  FOR v_duplicate IN
    SELECT * FROM detect_vehicle_duplicates(NEW.id)
    WHERE confidence >= v_auto_merge_threshold
    ORDER BY confidence DESC
    LIMIT 1  -- Only merge one at a time to avoid cascading issues
  LOOP
    -- Auto-merge if confidence is high enough
    -- Keep the NEW vehicle if it has a real VIN, otherwise keep the existing one
    IF NEW.vin IS NOT NULL AND NEW.vin != '' AND NEW.vin NOT LIKE 'VIVA-%' THEN
      -- New vehicle has real VIN, keep it and merge the duplicate into it
      PERFORM auto_merge_duplicates_with_notification(
        NEW.id,
        v_duplicate.duplicate_id,
        v_duplicate.match_type,
        v_duplicate.confidence,
        NULL  -- Auto-merged
      );
    ELSE
      -- Existing vehicle likely has real VIN or more data, merge new into existing
      PERFORM auto_merge_duplicates_with_notification(
        v_duplicate.duplicate_id,
        NEW.id,
        v_duplicate.match_type,
        v_duplicate.confidence,
        NULL  -- Auto-merged
      );
    END IF;
    
    -- Exit after first merge to avoid cascading
    EXIT;
  END LOOP;
  
  RETURN NEW;
END;
$$;

-- Create trigger to check for duplicates after insert/update
DROP TRIGGER IF EXISTS trigger_auto_detect_duplicates ON vehicles;
CREATE TRIGGER trigger_auto_detect_duplicates
  AFTER INSERT OR UPDATE OF year, make, model, vin ON vehicles
  FOR EACH ROW
  WHEN (NEW.year IS NOT NULL AND NEW.make IS NOT NULL AND NEW.model IS NOT NULL)
  EXECUTE FUNCTION trigger_check_duplicates();

COMMENT ON FUNCTION trigger_check_duplicates IS 'Automatically detects and merges duplicate vehicles when they are created or updated. Only auto-merges if confidence >= 95%';
COMMENT ON TRIGGER trigger_auto_detect_duplicates ON vehicles IS 'Triggers duplicate detection after vehicle insert/update';

