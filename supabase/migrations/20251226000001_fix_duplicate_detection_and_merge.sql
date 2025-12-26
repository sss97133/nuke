-- ==========================================================================
-- FIX DUPLICATE DETECTION AND MERGE SYSTEM
-- ==========================================================================
-- Purpose: Fix issues with duplicate detection and merge system:
--   1. Handle NULL VINs in duplicate detection
--   2. Fix search_path issues
--   3. Prevent recursive trigger calls
--   4. Handle unique constraint violations on organization_vehicles
--   5. Include required fields (title, source) in timeline_events
-- ==========================================================================

-- Drop and recreate detect_vehicle_duplicates to fix NULL VIN handling
DROP FUNCTION IF EXISTS detect_vehicle_duplicates(UUID) CASCADE;

CREATE OR REPLACE FUNCTION detect_vehicle_duplicates(
  p_vehicle_id UUID
)
RETURNS TABLE (
  duplicate_id UUID,
  match_type TEXT,
  confidence INTEGER,
  reasoning TEXT
)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_vehicle RECORD;
  v_candidate RECORD;
  v_match_type TEXT;
  v_confidence INTEGER;
  v_reasoning TEXT;
BEGIN
  -- Get the vehicle we're checking
  SELECT * INTO v_vehicle FROM vehicles WHERE id = p_vehicle_id;
  
  IF NOT FOUND THEN
    RETURN;
  END IF;
  
  -- Find potential duplicates
  FOR v_candidate IN
    SELECT v.*
    FROM vehicles v
    WHERE v.id != p_vehicle_id
      AND v.year = v_vehicle.year
      AND (
        -- Same make (case-insensitive, handle variations)
        LOWER(TRIM(v.make)) = LOWER(TRIM(v_vehicle.make))
        OR LOWER(TRIM(v.make)) LIKE LOWER(TRIM(v_vehicle.make)) || '%'
        OR LOWER(TRIM(v_vehicle.make)) LIKE LOWER(TRIM(v.make)) || '%'
      )
      AND (
        -- Same model or similar
        LOWER(TRIM(v.model)) = LOWER(TRIM(v_vehicle.model))
        OR LOWER(TRIM(v.model)) LIKE '%' || LOWER(TRIM(v_vehicle.model)) || '%'
        OR LOWER(TRIM(v_vehicle.model)) LIKE '%' || LOWER(TRIM(v.model)) || '%'
      )
      AND (
        -- VIN match (highest confidence)
        (v.vin = v_vehicle.vin AND v.vin IS NOT NULL AND v.vin != '' AND v.vin NOT LIKE 'VIVA-%')
        OR
        -- Same VIN but one is fake (high confidence)
        (v.vin = v_vehicle.vin AND (v.vin LIKE 'VIVA-%' OR v_vehicle.vin LIKE 'VIVA-%'))
        OR
        -- One has real VIN, other has fake VIN, same year/make/model (high confidence)
        (
          (v.vin LIKE 'VIVA-%' AND v_vehicle.vin IS NOT NULL AND v_vehicle.vin != '' AND v_vehicle.vin NOT LIKE 'VIVA-%')
          OR
          (v_vehicle.vin LIKE 'VIVA-%' AND v.vin IS NOT NULL AND v.vin != '' AND v.vin NOT LIKE 'VIVA-%')
        )
        OR
        -- One has real VIN, other has NULL, same year/make/model (high confidence)
        (
          (v.vin IS NULL AND v_vehicle.vin IS NOT NULL AND v_vehicle.vin != '' AND v_vehicle.vin NOT LIKE 'VIVA-%')
          OR
          (v_vehicle.vin IS NULL AND v.vin IS NOT NULL AND v.vin != '' AND v.vin NOT LIKE 'VIVA-%')
        )
        OR
        -- Both have NULL VINs, same year/make/model (medium-high confidence)
        (v.vin IS NULL AND v_vehicle.vin IS NULL)
        OR
        -- One has NULL, other has empty string or fake VIN, same year/make/model
        (
          (v.vin IS NULL AND (v_vehicle.vin IS NULL OR v_vehicle.vin = '' OR v_vehicle.vin LIKE 'VIVA-%'))
          OR
          (v_vehicle.vin IS NULL AND (v.vin IS NULL OR v.vin = '' OR v.vin LIKE 'VIVA-%'))
        )
      )
  LOOP
    -- Determine match type and confidence
    IF v_candidate.vin = v_vehicle.vin AND v_candidate.vin IS NOT NULL AND v_candidate.vin != '' AND v_candidate.vin NOT LIKE 'VIVA-%' THEN
      v_match_type := 'vin_exact';
      v_confidence := 100;
      v_reasoning := 'Exact VIN match';
    ELSIF (v_candidate.vin LIKE 'VIVA-%' AND v_vehicle.vin IS NOT NULL AND v_vehicle.vin != '' AND v_vehicle.vin NOT LIKE 'VIVA-%')
       OR (v_vehicle.vin LIKE 'VIVA-%' AND v_candidate.vin IS NOT NULL AND v_candidate.vin != '' AND v_candidate.vin NOT LIKE 'VIVA-%') THEN
      v_match_type := 'year_make_model_one_has_vin';
      v_confidence := 95;
      v_reasoning := 'Same year/make/model, one has real VIN and other has placeholder VIN';
    ELSIF (v_candidate.vin IS NULL AND v_vehicle.vin IS NOT NULL AND v_vehicle.vin != '' AND v_vehicle.vin NOT LIKE 'VIVA-%')
       OR (v_vehicle.vin IS NULL AND v_candidate.vin IS NOT NULL AND v_candidate.vin != '' AND v_candidate.vin NOT LIKE 'VIVA-%') THEN
      v_match_type := 'year_make_model_one_has_vin';
      v_confidence := 92;
      v_reasoning := 'Same year/make/model, one has real VIN and other has NULL VIN';
    ELSIF v_candidate.vin = v_vehicle.vin AND (v_candidate.vin LIKE 'VIVA-%' OR v_vehicle.vin LIKE 'VIVA-%') THEN
      v_match_type := 'year_make_model_same_fake_vin';
      v_confidence := 90;
      v_reasoning := 'Same year/make/model and same placeholder VIN';
    ELSIF v_candidate.vin IS NULL AND v_vehicle.vin IS NULL THEN
      v_match_type := 'year_make_model_no_vin';
      v_confidence := 88;
      v_reasoning := 'Same year/make/model, both have NULL VINs';
    ELSE
      v_match_type := 'year_make_model';
      v_confidence := 85;
      v_reasoning := 'Same year/make/model match';
    END IF;
    
    RETURN QUERY SELECT v_candidate.id, v_match_type, v_confidence, v_reasoning;
  END LOOP;
END;
$$;

-- Fix auto_merge_duplicates_with_notification to handle all edge cases
CREATE OR REPLACE FUNCTION auto_merge_duplicates_with_notification(
  p_primary_vehicle_id UUID,
  p_duplicate_vehicle_id UUID,
  p_match_type TEXT,
  p_confidence INTEGER,
  p_merged_by_user_id UUID DEFAULT NULL
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_primary RECORD;
  v_duplicate RECORD;
  v_merged_data JSONB;
  v_users_to_notify UUID[];
  v_notification_id UUID;
  v_user_id UUID;
  v_org_vehicle RECORD;
BEGIN
  -- Set session variable to indicate merge is in progress
  PERFORM set_config('app.is_merging_vehicles', 'TRUE', FALSE);
  
  -- Get both vehicles
  SELECT * INTO v_primary FROM vehicles WHERE id = p_primary_vehicle_id;
  SELECT * INTO v_duplicate FROM vehicles WHERE id = p_duplicate_vehicle_id;
  
  IF NOT FOUND THEN
    PERFORM set_config('app.is_merging_vehicles', 'FALSE', FALSE);
    RETURN jsonb_build_object('success', false, 'error', 'Vehicle not found');
  END IF;
  
  BEGIN
    -- Merge data: prefer real VIN, non-null values, higher values
    UPDATE vehicles
    SET
      vin = CASE 
        WHEN v_primary.vin IS NOT NULL AND v_primary.vin != '' AND v_primary.vin NOT LIKE 'VIVA-%' THEN v_primary.vin
        WHEN v_duplicate.vin IS NOT NULL AND v_duplicate.vin != '' AND v_duplicate.vin NOT LIKE 'VIVA-%' THEN v_duplicate.vin
        ELSE COALESCE(v_primary.vin, v_duplicate.vin)
      END,
      trim = COALESCE(v_primary.trim, v_duplicate.trim),
      color_primary = COALESCE(v_primary.color_primary, v_duplicate.color_primary),
      mileage = COALESCE(v_primary.mileage, v_duplicate.mileage),
      current_value = GREATEST(COALESCE(v_primary.current_value, 0), COALESCE(v_duplicate.current_value, 0)),
      sale_price = COALESCE(v_primary.sale_price, v_duplicate.sale_price),
      purchase_price = COALESCE(v_primary.purchase_price, v_duplicate.purchase_price),
      description = CASE 
        WHEN v_primary.description IS NOT NULL AND v_duplicate.description IS NOT NULL 
          THEN v_primary.description || E'\n\n--- Merged from duplicate profile ---\n\n' || v_duplicate.description
        ELSE COALESCE(v_primary.description, v_duplicate.description)
      END,
      notes = CASE 
        WHEN v_primary.notes IS NOT NULL AND v_duplicate.notes IS NOT NULL 
          THEN v_primary.notes || E'\n\n--- Merged from duplicate profile ---\n\n' || v_duplicate.notes
        ELSE COALESCE(v_primary.notes, v_duplicate.notes)
      END,
      updated_at = NOW()
    WHERE id = p_primary_vehicle_id;
    
    -- Move all related data from duplicate to primary
    UPDATE vehicle_images SET vehicle_id = p_primary_vehicle_id WHERE vehicle_id = p_duplicate_vehicle_id;
    UPDATE timeline_events SET vehicle_id = p_primary_vehicle_id WHERE vehicle_id = p_duplicate_vehicle_id;
    
    -- Handle organization_vehicles: only update if relationship doesn't already exist
    FOR v_org_vehicle IN
      SELECT * FROM organization_vehicles WHERE vehicle_id = p_duplicate_vehicle_id
    LOOP
      -- Check if this relationship already exists for the primary vehicle
      IF NOT EXISTS (
        SELECT 1 FROM organization_vehicles
        WHERE organization_id = v_org_vehicle.organization_id
          AND vehicle_id = p_primary_vehicle_id
          AND relationship_type = v_org_vehicle.relationship_type
      ) THEN
        -- Update to point to primary
        UPDATE organization_vehicles
        SET vehicle_id = p_primary_vehicle_id
        WHERE id = v_org_vehicle.id;
      ELSE
        -- Relationship already exists, just delete the duplicate
        DELETE FROM organization_vehicles WHERE id = v_org_vehicle.id;
      END IF;
    END LOOP;
    
    UPDATE vehicle_comments SET vehicle_id = p_primary_vehicle_id WHERE vehicle_id = p_duplicate_vehicle_id;
    UPDATE contractor_work_contributions SET vehicle_id = p_primary_vehicle_id WHERE vehicle_id = p_duplicate_vehicle_id;
    UPDATE vehicle_price_history SET vehicle_id = p_primary_vehicle_id WHERE vehicle_id = p_duplicate_vehicle_id;
    
    -- Collect all users who should be notified
    SELECT ARRAY_AGG(DISTINCT user_id) INTO v_users_to_notify
    FROM (
      SELECT COALESCE(owner_id, user_id) as user_id FROM vehicles WHERE id = p_primary_vehicle_id
      UNION
      SELECT COALESCE(owner_id, user_id) as user_id FROM vehicles WHERE id = p_duplicate_vehicle_id
      UNION
      SELECT user_id FROM vehicle_contributors WHERE vehicle_id IN (p_primary_vehicle_id, p_duplicate_vehicle_id)
      UNION
      SELECT oc.user_id 
      FROM organization_vehicles ov
      JOIN organization_contributors oc ON oc.organization_id = ov.organization_id
      WHERE ov.vehicle_id IN (p_primary_vehicle_id, p_duplicate_vehicle_id)
        AND oc.status = 'active'
    ) users
    WHERE user_id IS NOT NULL;
    
    -- Send notifications to all related users
    IF v_users_to_notify IS NOT NULL THEN
      FOREACH v_user_id IN ARRAY v_users_to_notify
      LOOP
        INSERT INTO user_notifications (
          user_id,
          channel_type,
          notification_title,
          notification_body,
          action_url,
          metadata
        ) VALUES (
          v_user_id,
          'in_app',
          'Vehicle Profiles Merged',
          format(
            'Your %s %s %s profile was automatically merged with a duplicate. All data has been consolidated into the main profile.',
            v_primary.year,
            v_primary.make,
            v_primary.model
          ),
          format('/vehicle/%s', p_primary_vehicle_id),
          jsonb_build_object(
            'type', 'vehicle_merged',
            'primary_vehicle_id', p_primary_vehicle_id,
            'duplicate_vehicle_id', p_duplicate_vehicle_id,
            'match_type', p_match_type,
            'confidence', p_confidence,
            'merged_at', NOW()
          )
        );
      END LOOP;
    END IF;
    
    -- Create timeline event for the merge (with required fields)
    INSERT INTO timeline_events (
      vehicle_id,
      event_type,
      event_date,
      title,
      description,
      source,
      source_type,
      metadata
    ) VALUES (
      p_primary_vehicle_id,
      'profile_merged',
      NOW(),
      'Vehicle Profile Merged',
      format('Merged duplicate profile %s (match type: %s, confidence: %s%%)', p_duplicate_vehicle_id, p_match_type, p_confidence),
      'system',
      'system',
      jsonb_build_object(
        'duplicate_vehicle_id', p_duplicate_vehicle_id,
        'match_type', p_match_type,
        'confidence', p_confidence,
        'merged_by', p_merged_by_user_id,
        'auto_merged', p_merged_by_user_id IS NULL
      )
    );
    
    -- Delete the duplicate vehicle
    DELETE FROM vehicles WHERE id = p_duplicate_vehicle_id;
    
    PERFORM set_config('app.is_merging_vehicles', 'FALSE', FALSE);
    
    RETURN jsonb_build_object(
      'success', true,
      'primary_vehicle_id', p_primary_vehicle_id,
      'duplicate_vehicle_id', p_duplicate_vehicle_id,
      'notifications_sent', COALESCE(array_length(v_users_to_notify, 1), 0)
    );
  EXCEPTION WHEN OTHERS THEN
    -- Clear session variable even if merge fails
    PERFORM set_config('app.is_merging_vehicles', 'FALSE', FALSE);
    RAISE;
  END;
END;
$$;

-- Fix trigger_check_duplicates to prevent recursion
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
  -- If we are already in a vehicle merge process, skip this trigger to prevent recursion
  IF current_setting('app.is_merging_vehicles', TRUE) = 'TRUE' THEN
    RETURN NEW;
  END IF;
  
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

-- Fix update_vehicle_completion to prevent recursion during merge
CREATE OR REPLACE FUNCTION update_vehicle_completion()
RETURNS TRIGGER AS $$
DECLARE
  completion_data JSONB;
BEGIN
  -- If we are in a vehicle merge process, skip completion calculation to prevent recursion
  IF current_setting('app.is_merging_vehicles', TRUE) = 'TRUE' THEN
    RETURN NEW;
  END IF;
  
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

COMMENT ON FUNCTION detect_vehicle_duplicates IS 'Detects potential duplicate vehicles based on VIN, year, make, and model. Handles NULL VINs correctly.';
COMMENT ON FUNCTION auto_merge_duplicates_with_notification IS 'Automatically merges duplicate vehicles and sends notifications. Prevents recursive triggers using session variables.';
COMMENT ON FUNCTION trigger_check_duplicates IS 'Automatically detects and merges duplicate vehicles when they are created or updated. Only auto-merges if confidence >= 95%. Prevents recursion.';
COMMENT ON FUNCTION update_vehicle_completion IS 'Auto-updates vehicle completion percentage. Skips during merge operations to prevent recursion.';

