-- P3.8 — re-pin the functions an earlier search_path='' pass broke (2026-09-27)
--
-- A previous hardening pass set `SET search_path TO ''` on functions whose bodies never schema-qualified their
-- tables. Every such function raises 42P01 "relation … does not exist" the moment it runs. On prod right now:
-- 73 signatures (70 names) in public are in that state (scan: pg_proc proconfig + unqualified FROM/INTO/UPDATE/JOIN of a
-- public relation). This migration changes ONLY the search_path line — bodies, security, grants untouched —
-- to `public, pg_temp` on the ones something live depends on, and lists the rest.
--
-- (a) ENABLED trigger functions re-pinned (4) — a DML on the table failed inside the trigger:
--   update_labor_rates_on_org_change(): trigger on organizations (AFTER UPDATE OF labor_rate) — needed: timeline_events, work_order_labor
--   verify_vehicle_from_spid_enhanced(): trigger on vehicle_spid_data (BEFORE INSERT OR UPDATE — every SPID label write) — needed: vehicle_options, vehicles
--   update_contractor_contribution_count(): trigger on contractor_work_contributions (AFTER INSERT) — needed: organization_contributors
--   auto_link_approved_work(): trigger on work_organization_matches (AFTER UPDATE OF approval_status → approved) — needed: image_work_extractions, organization_vehicles
--   NOT re-pinned: notify_payment_received on cash_transactions (money — see (c)).
--
-- (b) RPCs with a live web caller re-pinned (15) — the page's call failed with 42P01:
--   accept_vehicle_suggestion(p_suggestion_id uuid, p_year integer, p_make: web personalPhotoLibraryService.ts — needed: vehicle_images, vehicles
--   bulk_add_to_image_set(set_id uuid, image_ids uuid[]): web imageSetService.ts — needed: image_set_members, image_sets, user_vehicle_roles, vehicles
--   bulk_link_photos_to_vehicle(p_image_ids uuid[], p_vehicle_id uuid): web personalPhotoLibraryService.ts — needed: vehicle_images, vehicles
--   convert_personal_album_to_vehicle(p_image_set_id uuid, p_year integer,: web imageSetService.ts — needed: image_set_members, image_sets, vehicle_images, vehicles
--   extract_work_order_data(image_id uuid): web ContractorWorkInput.tsx — needed: organization_images
--   find_vehicles_near_gps(p_lat double precision, p_lng double precision,: web UniversalImageUpload.tsx — needed: vehicle_timeline_events, vehicles
--   get_connected_profiles_summary(p_user_id uuid): web dashboardService.ts — needed: organization_contributors, timeline_events, vehicles
--   get_dashboard_pending_counts(p_user_id uuid): web dashboardService.ts — needed: document_extractions, organization_contributors, ownership_verifications, pending_vehicle_assignments, user_notifications, vehicles
--   get_pending_vehicle_assignments(p_user_id uuid): web dashboardService.ts — needed: businesses, organization_contributors, pending_vehicle_assignments, vehicles
--   get_recent_notifications(p_user_id uuid, p_limit integer): web dashboardService.ts — needed: user_notifications
--   log_pii_access(p_user_id uuid, p_action text, p_resource_type text, p_: web secureDocumentService.ts — needed: pii_audit_log
--   log_pii_access(p_user_id uuid, p_action text, p_resource_type text, p_: web secureDocumentService.ts — needed: pii_audit_log
--   reject_vehicle_suggestion(p_suggestion_id uuid): web personalPhotoLibraryService.ts — needed: vehicle_images
--   reorder_image_set(set_id uuid, image_ids uuid[]): web imageSetService.ts — needed: image_set_members, image_sets, vehicles
--   set_image_priority(img_id uuid, new_priority integer): web imageSetService.ts — needed: user_vehicle_roles, vehicle_images, vehicles
--
-- (c) left dark on purpose — money / trading / deleted features (platform-hygiene.md "Deleted Features"):
--   notify_payment_received: ENABLED trigger on cash_transactions — money; stays dark
--   add_cash_to_user: cash ledger; only caller is distribute_sale_proceeds (trading)
--   reserve_cash: cash ledger (buy_bond / stake paths)
--   stake_on_vehicle: betting / funding rounds
--   create_funding_round: investor portal / funding rounds
--   distribute_sale_proceeds: trading proceeds; calls add_cash_to_user
--   deduct_cash_from_user: already revoked from authenticated in P3.7; definition untouched
--
-- (d) no live caller (web/iOS/edge/enabled trigger) — listed only, still broken (45 names):
--   add_image_tag, approve_contributor_request, approve_shop_verification, approve_work_match, backfill_sold_vehicles_comprehensive, backfill_timeline_event_for_image, calculate_vehicle_org_assignment_confidence, check_ownership_verification_status, cleanup_expired_documents, cleanup_old_notifications, create_citation_from_ai_component, create_citation_from_receipt, create_notification, create_ownership_verification, create_vehicle_event, create_work_approval_notification, detect_smart_duplicates, get_collaborative_vehicles, get_field_audit_trail, get_location_collaborators, get_photo_library_stats, get_receipt_processing_stats, get_shop_org_chart, get_unorganized_photo_count, get_unorganized_photos_optimized, get_user_api_key_info, get_vehicle_ai_stats, get_vehicle_images_with_source, get_vehicle_work_contributions, match_work_to_organizations, notify_offer_received, process_pending_work_extractions, reverse_work_approval_response, search_businesses_fulltext, search_images_by_component, search_profiles_fulltext, search_timeline_events_fulltext, suggest_vehicle_organization_assignments, update_part_price_stats, update_user_verification_level, update_vehicle_relationship, update_vehicle_vin, update_vehicle_vin_safe, vehicle_can_view, verify_vehicle_from_spid
--
-- STILL BROKEN AFTER THE RE-PIN (second, unrelated failure measured in the rehearsal — schema drift or a body bug;
-- not fixed here, each is a body change for a separate decision):
--   accept_vehicle_suggestion, reject_vehicle_suggestion: relation vehicle_suggestions no longer exists (dead)
--   get_dashboard_pending_counts: relation work_approval_notifications no longer exists (Dashboard counts stay broken)
--   get_recent_notifications: user_notifications lost is_responded / priority / related_user_id
--   set_image_priority: references a column created_by that no longer exists
--   log_pii_access(p_user_id, p_action, p_resource_type, p_resource_id): inserts a text into pii_audit_log.resource_id uuid
--     (the 3-argument overload works)
--   verify_vehicle_from_spid_enhanced: vehicles lost color_confidence, engine, engine_confidence, transmission_confidence —
--     a SPID row carrying only a VIN now writes through (vin, vin_confidence, vin_source exist); a row with a paint,
--     engine or transmission code still fails at the first missing column. One-line fixes; needs the owner's nod.
--   update_labor_rates_on_org_change: `RAISE NOTICE … ROW_COUNT` — plpgsql has no bare ROW_COUNT (needs GET DIAGNOSTICS);
--     the UPDATE of work_order_labor runs, the NOTICE after it throws. One-line fix; needs the owner's nod.
--   Of the 19 re-pinned, 12 reach their body cleanly; these 7 hit the next defect.
--
-- Already resolved by P3.7 (re-pinned or revoked there): add_dynamic_vehicle_field, approve_pending_assignment, reject_pending_assignment, user_can_edit_vehicle, get_user_cash_balance, create_notification, update_vehicle_relationship.
--
-- Rehearsed on prod in a rolled-back transaction: every re-pinned RPC reaches its body (no 42P01); the four
-- triggers fire on scratch rows — a scratch vehicle + vehicle_spid_data insert (the trigger wrote the paint code
-- back onto the vehicle), organizations.labor_rate update, contractor_work_contributions insert,
-- work_organization_matches approval — all rolled back.
-- Reversal: put `SET search_path TO ''` back on any of these with ALTER FUNCTION … SET search_path = ''.

BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';
SET LOCAL search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.update_labor_rates_on_org_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- When organization labor_rate changes, update all related work_order_labor records
  -- that don't have a reported_rate yet (use calculated rates)
  IF TG_OP = 'UPDATE' AND (OLD.labor_rate IS NULL OR NEW.labor_rate IS NULL OR OLD.labor_rate IS DISTINCT FROM NEW.labor_rate) THEN
    UPDATE work_order_labor wol
    SET 
      hourly_rate = NEW.labor_rate,
      calculated_rate = NEW.labor_rate * 
        COALESCE(wol.difficulty_multiplier, 1.0) * 
        COALESCE(wol.location_multiplier, 1.0) * 
        COALESCE(wol.time_multiplier, 1.0) * 
        COALESCE(wol.skill_multiplier, 1.0),
      rate_source = 'organization',
      calculation_metadata = jsonb_build_object(
        'updated_at', NOW(),
        'previous_rate', OLD.labor_rate,
        'new_rate', NEW.labor_rate,
        'reason', 'organization_rate_updated'
      )
    FROM timeline_events te
    WHERE wol.timeline_event_id = te.id
      AND te.organization_id = NEW.id
      AND wol.reported_rate IS NULL; -- Only update if no user-reported rate
    
    RAISE NOTICE 'Updated labor rates for organization %: % records affected', NEW.id, ROW_COUNT;
  END IF;
  
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.verify_vehicle_from_spid_enhanced()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  vehicle_record RECORD;
  verification_results JSONB;
  v_discrepancies JSONB := '[]'::JSONB;
  v_vin_verified BOOLEAN := NULL;
  v_year_verified BOOLEAN := NULL;
  v_make_verified BOOLEAN := NULL;
  v_model_verified BOOLEAN := NULL;
  v_engine_verified BOOLEAN := NULL;
  v_transmission_verified BOOLEAN := NULL;
  v_color_verified BOOLEAN := NULL;
BEGIN
  -- Get vehicle data
  SELECT * INTO vehicle_record 
  FROM vehicles 
  WHERE id = NEW.vehicle_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vehicle not found: %', NEW.vehicle_id;
  END IF;
  
  verification_results := '{}'::JSONB;
  
  -- 1. VIN VERIFICATION & DECODING
  IF NEW.vin IS NOT NULL AND NEW.vin != '' THEN
    -- Trigger VIN decoding (async)
    PERFORM trigger_vin_decode(NEW.vin, NEW.vehicle_id, 'spid');
    
    IF vehicle_record.vin IS NULL OR vehicle_record.vin = '' THEN
      -- Auto-fill VIN if empty
      UPDATE vehicles 
      SET vin = NEW.vin,
          vin_source = 'spid',
          vin_confidence = NEW.extraction_confidence
      WHERE id = NEW.vehicle_id;
      
      v_vin_verified := TRUE;
      verification_results := verification_results || 
        jsonb_build_object('vin', 'auto_filled', 'value', NEW.vin);
    ELSE
      -- Check if VINs match
      v_vin_verified := (vehicle_record.vin = NEW.vin);
      
      IF NOT v_vin_verified THEN
        v_discrepancies := v_discrepancies || jsonb_build_array(
          jsonb_build_object(
            'field', 'vin',
            'spid_value', NEW.vin,
            'vehicle_value', vehicle_record.vin,
            'severity', 'high'
          )
        );
      END IF;
      
      verification_results := verification_results || 
        jsonb_build_object(
          'vin', 
          CASE WHEN v_vin_verified THEN 'verified' ELSE 'mismatch' END,
          'spid_vin', NEW.vin,
          'vehicle_vin', vehicle_record.vin
        );
    END IF;
    
    NEW.vin_matches_vehicle := v_vin_verified;
  END IF;
  
  -- 2. PAINT CODE VERIFICATION
  IF NEW.paint_code_exterior IS NOT NULL AND NEW.paint_code_exterior != '' THEN
    IF vehicle_record.color IS NULL OR vehicle_record.color = '' THEN
      UPDATE vehicles 
      SET color = NEW.paint_code_exterior,
          color_source = 'spid',
          color_confidence = NEW.extraction_confidence
      WHERE id = NEW.vehicle_id;
      
      v_color_verified := TRUE;
      verification_results := verification_results || 
        jsonb_build_object('paint_code', 'auto_filled', 'value', NEW.paint_code_exterior);
    ELSE
      v_color_verified := (
        vehicle_record.color = NEW.paint_code_exterior OR 
        vehicle_record.color LIKE '%' || NEW.paint_code_exterior || '%'
      );
      
      IF NOT v_color_verified THEN
        v_discrepancies := v_discrepancies || jsonb_build_array(
          jsonb_build_object(
            'field', 'color',
            'spid_value', NEW.paint_code_exterior,
            'vehicle_value', vehicle_record.color,
            'severity', 'low'
          )
        );
      END IF;
    END IF;
    
    NEW.paint_verified := v_color_verified;
  END IF;
  
  -- 3. ENGINE CODE VERIFICATION
  IF NEW.engine_code IS NOT NULL AND NEW.engine_code != '' THEN
    IF vehicle_record.engine IS NULL OR vehicle_record.engine = '' THEN
      UPDATE vehicles 
      SET engine = NEW.engine_code,
          engine_source = 'spid',
          engine_confidence = NEW.extraction_confidence
      WHERE id = NEW.vehicle_id;
      
      v_engine_verified := TRUE;
    ELSE
      v_engine_verified := (vehicle_record.engine = NEW.engine_code OR
                           vehicle_record.engine LIKE '%' || NEW.engine_code || '%');
      
      IF NOT v_engine_verified THEN
        v_discrepancies := v_discrepancies || jsonb_build_array(
          jsonb_build_object(
            'field', 'engine',
            'spid_value', NEW.engine_code,
            'vehicle_value', vehicle_record.engine,
            'severity', 'medium'
          )
        );
      END IF;
    END IF;
  END IF;
  
  -- 4. TRANSMISSION CODE VERIFICATION
  IF NEW.transmission_code IS NOT NULL AND NEW.transmission_code != '' THEN
    IF vehicle_record.transmission IS NULL OR vehicle_record.transmission = '' THEN
      UPDATE vehicles 
      SET transmission = NEW.transmission_code,
          transmission_source = 'spid',
          transmission_confidence = NEW.extraction_confidence
      WHERE id = NEW.vehicle_id;
      
      v_transmission_verified := TRUE;
    ELSE
      v_transmission_verified := (vehicle_record.transmission = NEW.transmission_code OR
                                 vehicle_record.transmission LIKE '%' || NEW.transmission_code || '%');
      
      IF NOT v_transmission_verified THEN
        v_discrepancies := v_discrepancies || jsonb_build_array(
          jsonb_build_object(
            'field', 'transmission',
            'spid_value', NEW.transmission_code,
            'vehicle_value', vehicle_record.transmission,
            'severity', 'medium'
          )
        );
      END IF;
    END IF;
  END IF;
  
  -- 5. RPO CODES - ADD TO VEHICLE OPTIONS
  IF NEW.rpo_codes IS NOT NULL AND array_length(NEW.rpo_codes, 1) > 0 THEN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'vehicle_options') THEN
      INSERT INTO vehicle_options (vehicle_id, option_code, source, verified_by_spid)
      SELECT 
        NEW.vehicle_id,
        unnest(NEW.rpo_codes),
        'spid',
        TRUE
      ON CONFLICT (vehicle_id, option_code) DO UPDATE
      SET verified_by_spid = TRUE, source = 'spid';
      
      NEW.options_added := TRUE;
      verification_results := verification_results || 
        jsonb_build_object('rpo_codes_added', array_length(NEW.rpo_codes, 1), 'codes', NEW.rpo_codes);
    END IF;
  END IF;
  
  -- 6. MODEL CODE VERIFICATION
  IF NEW.model_code IS NOT NULL AND NEW.model_code != '' THEN
    verification_results := verification_results || 
      jsonb_build_object('model_code', 'extracted', 'value', NEW.model_code);
  END IF;
  
  -- 7. Create/Update Comprehensive Verification Record
  INSERT INTO vehicle_comprehensive_verification (
    vehicle_id,
    has_spid,
    vin_verified,
    year_verified,
    make_verified,
    model_verified,
    engine_verified,
    transmission_verified,
    color_verified,
    discrepancies,
    overall_confidence,
    verified_at
  ) VALUES (
    NEW.vehicle_id,
    true,
    v_vin_verified,
    v_year_verified,
    v_make_verified,
    v_model_verified,
    v_engine_verified,
    v_transmission_verified,
    v_color_verified,
    v_discrepancies,
    NEW.extraction_confidence,
    NOW()
  )
  ON CONFLICT (vehicle_id) DO UPDATE SET
    has_spid = true,
    vin_verified = COALESCE(EXCLUDED.vin_verified, vehicle_comprehensive_verification.vin_verified),
    engine_verified = COALESCE(EXCLUDED.engine_verified, vehicle_comprehensive_verification.engine_verified),
    transmission_verified = COALESCE(EXCLUDED.transmission_verified, vehicle_comprehensive_verification.transmission_verified),
    color_verified = COALESCE(EXCLUDED.color_verified, vehicle_comprehensive_verification.color_verified),
    discrepancies = EXCLUDED.discrepancies,
    overall_confidence = GREATEST(EXCLUDED.overall_confidence, vehicle_comprehensive_verification.overall_confidence),
    verified_at = NOW(),
    updated_at = NOW();
  
  -- 8. Log verification results
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'vehicle_verification_log') THEN
    INSERT INTO vehicle_verification_log (
      vehicle_id,
      verification_type,
      source,
      results
    ) VALUES (
      NEW.vehicle_id,
      'spid_comprehensive_verification',
      'spid_sheet',
      verification_results || jsonb_build_object('discrepancies', v_discrepancies)
    );
  END IF;
  
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_contractor_contribution_count()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Increment contribution count for the contractor
  INSERT INTO organization_contributors (
    organization_id,
    user_id,
    role,
    contribution_count,
    start_date
  )
  VALUES (
    NEW.organization_id,
    NEW.contractor_user_id,
    'technician', -- Default role for contractors
    1,
    NEW.work_date
  )
  ON CONFLICT (organization_id, user_id) 
  DO UPDATE SET
    contribution_count = organization_contributors.contribution_count + 1,
    updated_at = NOW();
  
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.auto_link_approved_work()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_work_extraction RECORD;
  v_vehicle_owner_org UUID;
BEGIN
  -- Only process when approval_status changes to 'approved'
  IF NEW.approval_status = 'approved' AND (OLD.approval_status IS NULL OR OLD.approval_status != 'approved') THEN
    
    -- Get work extraction data
    SELECT * INTO v_work_extraction
    FROM image_work_extractions
    WHERE id = NEW.image_work_extraction_id;
    
    IF NOT FOUND THEN
      RETURN NEW;
    END IF;
    
    -- Find vehicle owner organization
    SELECT organization_id INTO v_vehicle_owner_org
    FROM organization_vehicles
    WHERE vehicle_id = NEW.vehicle_id
      AND relationship_type = 'owner'
      AND status = 'active'
    LIMIT 1;
    
    -- Create work contribution
    INSERT INTO vehicle_work_contributions (
      vehicle_id,
      contributing_organization_id,
      vehicle_owner_organization_id,
      work_type,
      work_description,
      work_date,
      status,
      performed_by_user_id
    ) VALUES (
      NEW.vehicle_id,
      NEW.matched_organization_id,
      COALESCE(v_vehicle_owner_org, NEW.matched_organization_id),
      v_work_extraction.detected_work_type,
      COALESCE(v_work_extraction.detected_work_description, 'Work detected from images'),
      COALESCE(v_work_extraction.detected_date, CURRENT_DATE),
      'completed',
      NEW.approved_by_user_id
    )
    RETURNING id INTO NEW.auto_linked_work_contribution_id;
    
    -- Update work extraction status
    UPDATE image_work_extractions
    SET status = 'approved', processed_at = NOW()
    WHERE id = NEW.image_work_extraction_id;
    
  END IF;
  
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.accept_vehicle_suggestion(p_suggestion_id uuid, p_year integer, p_make text, p_model text, p_trim text DEFAULT NULL::text, p_vin text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id UUID;
  v_new_vehicle_id UUID;
  v_image_ids UUID[];
BEGIN
  -- Get suggestion details
  SELECT user_id INTO v_user_id
  FROM vehicle_suggestions
  WHERE id = p_suggestion_id
  AND user_id = auth.uid();
  
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Suggestion not found or permission denied';
  END IF;
  
  -- Create vehicle
  INSERT INTO vehicles (
    user_id,
    year,
    make,
    model,
    trim,
    vin,
    is_draft,
    is_private,
    created_by
  )
  VALUES (
    v_user_id,
    p_year,
    p_make,
    p_model,
    p_trim,
    p_vin,
    false,
    true,
    v_user_id
  )
  RETURNING id INTO v_new_vehicle_id;
  
  -- Get all images suggested for this vehicle
  SELECT ARRAY_AGG(id) INTO v_image_ids
  FROM vehicle_images
  WHERE suggested_vehicle_id = p_suggestion_id
  OR id = ANY((SELECT sample_image_ids FROM vehicle_suggestions WHERE id = p_suggestion_id));
  
  -- Link images to new vehicle
  IF v_image_ids IS NOT NULL THEN
    UPDATE vehicle_images
    SET 
      vehicle_id = v_new_vehicle_id,
      organization_status = 'organized',
      organized_at = NOW()
    WHERE id = ANY(v_image_ids);
  END IF;
  
  -- Mark suggestion as accepted
  UPDATE vehicle_suggestions
  SET 
    status = 'accepted',
    accepted_vehicle_id = v_new_vehicle_id,
    reviewed_at = NOW()
  WHERE id = p_suggestion_id;
  
  RETURN v_new_vehicle_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.bulk_add_to_image_set(set_id uuid, image_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  img_id UUID;
  added_count INTEGER := 0;
  next_order INTEGER;
BEGIN
  -- Validate user has permission
  IF NOT EXISTS (
    SELECT 1 FROM image_sets 
    WHERE id = set_id 
    AND (
      created_by = auth.uid()
      OR vehicle_id IN (
        SELECT id FROM vehicles WHERE created_by = auth.uid()
      )
      OR vehicle_id IN (
        SELECT vehicle_id FROM user_vehicle_roles 
        WHERE user_id = auth.uid() AND role IN ('owner', 'editor', 'contributor')
      )
    )
  ) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  
  -- Get next display order
  SELECT COALESCE(MAX(display_order), -1) + 1 
  INTO next_order
  FROM image_set_members
  WHERE image_set_id = set_id;
  
  -- Add each image
  FOREACH img_id IN ARRAY image_ids
  LOOP
    INSERT INTO image_set_members (
      image_set_id,
      image_id,
      display_order,
      added_by
    )
    VALUES (
      set_id,
      img_id,
      next_order,
      auth.uid()
    )
    ON CONFLICT (image_set_id, image_id) DO NOTHING;
    
    IF FOUND THEN
      added_count := added_count + 1;
      next_order := next_order + 1;
    END IF;
  END LOOP;
  
  RETURN added_count;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.bulk_link_photos_to_vehicle(p_image_ids uuid[], p_vehicle_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  updated_count INTEGER := 0;
BEGIN
  -- Verify user owns the vehicle
  IF NOT EXISTS (
    SELECT 1 FROM vehicles 
    WHERE id = p_vehicle_id 
    AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Permission denied: user does not own vehicle';
  END IF;

  -- Update images
  UPDATE vehicle_images
  SET 
    vehicle_id = p_vehicle_id,
    organization_status = 'organized',
    organized_at = NOW(),
    updated_at = NOW()
  WHERE 
    id = ANY(p_image_ids)
    AND user_id = auth.uid();
  
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  
  RETURN updated_count;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.convert_personal_album_to_vehicle(p_image_set_id uuid, p_year integer, p_make text, p_model text, p_trim text DEFAULT NULL::text, p_vin text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET row_security TO 'off'
AS $function$
DECLARE
  v_user_id UUID;
  v_new_vehicle_id UUID;
  v_image_ids UUID[];
  v_current_user_id UUID;
BEGIN
  -- Get current user ID
  v_current_user_id := auth.uid();
  
  IF v_current_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Verify album exists, is personal, and belongs to current user
  SELECT user_id INTO v_user_id
  FROM image_sets
  WHERE id = p_image_set_id
    AND is_personal = true
    AND vehicle_id IS NULL
    AND user_id = v_current_user_id;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Album not found or permission denied. Album ID: %, User ID: %', p_image_set_id, v_current_user_id;
  END IF;

  -- Create vehicle profile
  -- user_id is a GENERATED column (always = uploaded_by), so we set uploaded_by instead
  INSERT INTO vehicles (
    uploaded_by,
    year,
    make,
    model,
    trim,
    vin,
    is_draft,
    status,
    is_public
  )
  VALUES (
    v_user_id,
    p_year,
    p_make,
    p_model,
    p_trim,
    p_vin,
    false,
    'active',
    false
  )
  RETURNING id INTO v_new_vehicle_id;

  -- Collect all image ids that belong to this album
  SELECT ARRAY_AGG(image_id) INTO v_image_ids
  FROM image_set_members
  WHERE image_set_id = p_image_set_id;

  -- Link images to the new vehicle and mark as organized
  IF v_image_ids IS NOT NULL THEN
    UPDATE vehicle_images
    SET
      vehicle_id = v_new_vehicle_id,
      organization_status = 'organized',
      organized_at = NOW(),
      updated_at = NOW()
    WHERE id = ANY(v_image_ids)
      AND user_id = v_user_id;
  END IF;

  -- Flip album from personal to vehicle-linked set
  UPDATE image_sets
  SET
    vehicle_id = v_new_vehicle_id,
    is_personal = false,
    updated_at = NOW()
  WHERE id = p_image_set_id;

  RETURN v_new_vehicle_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.extract_work_order_data(image_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  result JSONB := '{}'::jsonb;
  img RECORD;
BEGIN
  SELECT * INTO img FROM organization_images WHERE id = image_id;
  
  IF NOT FOUND THEN
    RETURN '{"error": "Image not found"}'::jsonb;
  END IF;
  
  -- TODO: Integrate with OCR Edge Function
  -- For now, return placeholder data
  result := jsonb_build_object(
    'status', 'pending_ocr',
    'image_url', img.image_url,
    'requires_manual_entry', TRUE
  );
  
  RETURN result;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.find_vehicles_near_gps(p_lat double precision, p_lng double precision, p_radius_meters integer DEFAULT 100, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, year integer, make text, model text, distance_meters double precision)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    v.id,
    v.year,
    v.make,
    v.model,
    -- Calculate distance using Haversine formula
    (
      6371000 * acos(
        cos(radians(p_lat)) * 
        cos(radians(CAST(vte.metadata->>'gps_lat' AS DOUBLE PRECISION))) * 
        cos(radians(CAST(vte.metadata->>'gps_lng' AS DOUBLE PRECISION)) - radians(p_lng)) + 
        sin(radians(p_lat)) * 
        sin(radians(CAST(vte.metadata->>'gps_lat' AS DOUBLE PRECISION)))
      )
    ) as distance_meters
  FROM vehicles v
  INNER JOIN vehicle_timeline_events vte ON vte.vehicle_id = v.id
  WHERE 
    vte.metadata->>'gps_lat' IS NOT NULL
    AND vte.metadata->>'gps_lng' IS NOT NULL
    AND (p_user_id IS NULL OR v.owner_id = p_user_id)
    -- Pre-filter using bounding box for performance
    AND CAST(vte.metadata->>'gps_lat' AS DOUBLE PRECISION) BETWEEN p_lat - 0.001 AND p_lat + 0.001
    AND CAST(vte.metadata->>'gps_lng' AS DOUBLE PRECISION) BETWEEN p_lng - 0.001 AND p_lng + 0.001
  GROUP BY v.id, v.year, v.make, v.model, vte.metadata
  HAVING (
    6371000 * acos(
      cos(radians(p_lat)) * 
      cos(radians(CAST(vte.metadata->>'gps_lat' AS DOUBLE PRECISION))) * 
      cos(radians(CAST(vte.metadata->>'gps_lng' AS DOUBLE PRECISION)) - radians(p_lng)) + 
      sin(radians(p_lat)) * 
      sin(radians(CAST(vte.metadata->>'gps_lat' AS DOUBLE PRECISION)))
    )
  ) <= p_radius_meters
  ORDER BY distance_meters
  LIMIT 10;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_connected_profiles_summary(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_summary JSONB;
BEGIN
  SELECT jsonb_build_object(
    'vehicles', (
      SELECT COUNT(*)::INTEGER
      FROM vehicles
      WHERE uploaded_by = p_user_id OR user_id = p_user_id
    ),
    'organizations', (
      SELECT COUNT(*)::INTEGER
      FROM organization_contributors
      WHERE user_id = p_user_id
        AND status = 'active'
    ),
    'recent_activity', (
      SELECT COUNT(*)::INTEGER
      FROM timeline_events te
      WHERE te.vehicle_id IN (
        SELECT id FROM vehicles
        WHERE uploaded_by = p_user_id OR user_id = p_user_id
      )
        AND te.created_at > NOW() - INTERVAL '7 days'
    )
  ) INTO v_summary;
  
  RETURN v_summary;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_dashboard_pending_counts(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_counts JSONB;
BEGIN
  SELECT jsonb_build_object(
    'work_approvals', (
      SELECT COUNT(*)::INTEGER
      FROM work_approval_notifications
      WHERE user_id = p_user_id
        AND response_status = 'pending'
    ),
    'vehicle_assignments', (
      SELECT COUNT(*)::INTEGER
      FROM pending_vehicle_assignments pva
      WHERE pva.status = 'pending'
        AND (
          EXISTS (
            SELECT 1 FROM vehicles v
            WHERE v.id = pva.vehicle_id
              AND (v.uploaded_by = p_user_id OR v.user_id = p_user_id)
          )
          OR EXISTS (
            SELECT 1 FROM organization_contributors oc
            WHERE oc.organization_id = pva.organization_id
              AND oc.user_id = p_user_id
              AND oc.status = 'active'
          )
        )
    ),
    'photo_reviews', (
      SELECT COUNT(*)::INTEGER
      FROM photo_review_queue
      WHERE user_id = p_user_id
        AND status = 'pending'
    ),
    'document_reviews', (
      SELECT COUNT(*)::INTEGER
      FROM document_extractions
      WHERE status = 'pending_review'
        AND reviewed_by = p_user_id
    ),
    'user_requests', (
      SELECT COUNT(*)::INTEGER
      FROM user_requests
      WHERE target_user_id = p_user_id
        AND status = 'pending'
    ),
    'interaction_requests', (
      SELECT COUNT(*)::INTEGER
      FROM vehicle_interaction_requests vir
      WHERE vir.status = 'pending'
        AND EXISTS (
          SELECT 1 FROM vehicles v
          WHERE v.id = vir.vehicle_id
            AND (v.uploaded_by = p_user_id OR v.user_id = p_user_id)
        )
    ),
    'ownership_verifications', (
      SELECT COUNT(*)::INTEGER
      FROM ownership_verifications
      WHERE vehicle_id IN (
        SELECT id FROM vehicles
        WHERE uploaded_by = p_user_id OR user_id = p_user_id
      )
        AND status = 'pending'
    ),
    'unread_notifications', (
      SELECT COUNT(*)::INTEGER
      FROM user_notifications
      WHERE user_id = p_user_id
        AND is_read = false
    )
  ) INTO v_counts;
  
  RETURN v_counts;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_pending_vehicle_assignments(p_user_id uuid)
 RETURNS TABLE(id uuid, vehicle_name text, organization_name text, relationship_type text, confidence numeric, evidence_sources text[], created_at timestamp with time zone, vehicle_id uuid, organization_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    pva.id,
    v.year || ' ' || v.make || ' ' || v.model,
    b.business_name,
    pva.suggested_relationship_type,
    pva.overall_confidence,
    pva.evidence_sources,
    pva.created_at,
    pva.vehicle_id,
    pva.organization_id
  FROM pending_vehicle_assignments pva
  JOIN vehicles v ON v.id = pva.vehicle_id
  JOIN businesses b ON b.id = pva.organization_id
  WHERE pva.status = 'pending'
    AND (
      EXISTS (
        SELECT 1 FROM vehicles v2
        WHERE v2.id = pva.vehicle_id
          AND (v2.uploaded_by = p_user_id OR v2.user_id = p_user_id)
      )
      OR EXISTS (
        SELECT 1 FROM organization_contributors oc
        WHERE oc.organization_id = pva.organization_id
          AND oc.user_id = p_user_id
          AND oc.status = 'active'
      )
    )
  ORDER BY pva.overall_confidence DESC, pva.created_at DESC;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_recent_notifications(p_user_id uuid, p_limit integer DEFAULT 20)
 RETURNS TABLE(id uuid, type text, title text, message text, vehicle_id uuid, organization_id uuid, related_user_id uuid, is_read boolean, is_responded boolean, priority integer, created_at timestamp with time zone, metadata jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    un.id,
    un.type,
    un.title,
    un.message,
    un.vehicle_id,
    un.organization_id,
    un.related_user_id,
    un.is_read,
    un.is_responded,
    un.priority,
    un.created_at,
    un.metadata
  FROM user_notifications un
  WHERE un.user_id = p_user_id
  ORDER BY
    un.is_read ASC,
    un.priority ASC,
    un.created_at DESC
  LIMIT p_limit;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.log_pii_access(p_user_id uuid, p_action text, p_resource_type text, p_resource_id text, p_access_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid;
BEGIN
  -- The actor is the current auth uid if available
  BEGIN
    v_actor := auth.uid();
  EXCEPTION WHEN OTHERS THEN
    v_actor := NULL;
  END;

  INSERT INTO public.pii_audit_log (user_id, accessed_by, action, resource_type, resource_id, ip_address, user_agent, access_reason)
  VALUES (
    p_user_id,
    COALESCE(v_actor, p_user_id),
    p_action,
    p_resource_type,
    p_resource_id,
    NULL,
    NULL,
    p_access_reason
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.log_pii_access(p_user_id uuid, p_action text, p_resource_type text, p_resource_id uuid DEFAULT NULL::uuid, p_access_reason text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    audit_id UUID;
BEGIN
    INSERT INTO pii_audit_log (
        user_id,
        accessed_by,
        action,
        resource_type,
        resource_id,
        ip_address,
        user_agent,
        access_reason
    ) VALUES (
        p_user_id,
        auth.uid(),
        p_action,
        p_resource_type,
        p_resource_id,
        inet_client_addr(),
        current_setting('request.headers', true)::json->>'user-agent',
        p_access_reason
    ) RETURNING id INTO audit_id;
    
    RETURN audit_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.reject_vehicle_suggestion(p_suggestion_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Verify ownership
  IF NOT EXISTS (
    SELECT 1 FROM vehicle_suggestions 
    WHERE id = p_suggestion_id 
    AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  
  -- Clear suggested_vehicle_id from images
  UPDATE vehicle_images
  SET suggested_vehicle_id = NULL
  WHERE suggested_vehicle_id = p_suggestion_id;
  
  -- Mark as rejected
  UPDATE vehicle_suggestions
  SET 
    status = 'rejected',
    reviewed_at = NOW()
  WHERE id = p_suggestion_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.reorder_image_set(set_id uuid, image_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  img_id UUID;
  idx INTEGER := 0;
BEGIN
  -- Validate user has permission
  IF NOT EXISTS (
    SELECT 1 FROM image_sets 
    WHERE id = set_id 
    AND (
      created_by = auth.uid()
      OR vehicle_id IN (
        SELECT id FROM vehicles WHERE created_by = auth.uid()
      )
    )
  ) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  
  -- Update display order for each image
  FOREACH img_id IN ARRAY image_ids
  LOOP
    UPDATE image_set_members
    SET display_order = idx,
        updated_at = NOW()
    WHERE image_set_id = set_id
    AND image_id = img_id;
    
    idx := idx + 1;
  END LOOP;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.set_image_priority(img_id uuid, new_priority integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Validate user has permission
  IF NOT EXISTS (
    SELECT 1 FROM vehicle_images vi
    WHERE vi.id = img_id
    AND (
      vi.user_id = auth.uid()
      OR vi.vehicle_id IN (
        SELECT id FROM vehicles WHERE created_by = auth.uid()
      )
      OR vi.vehicle_id IN (
        SELECT vehicle_id FROM user_vehicle_roles 
        WHERE user_id = auth.uid() AND role IN ('owner', 'editor')
      )
    )
  ) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  
  UPDATE vehicle_images
  SET manual_priority = new_priority
  WHERE id = img_id;
END;
$function$
;

COMMIT;
