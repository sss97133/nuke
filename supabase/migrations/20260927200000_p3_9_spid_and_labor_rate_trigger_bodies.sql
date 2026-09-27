-- P3.9 — two trigger bodies that P3.8's re-pin exposed as still broken (2026-09-27)
--
-- 1. update_labor_rates_on_org_change (organizations AFTER UPDATE OF labor_rate): the NOTICE after the UPDATE used a bare
--    ROW_COUNT, which plpgsql does not have, so every shop labor-rate change threw 42703 and rolled back.
--    Fix: GET DIAGNOSTICS v_rows = ROW_COUNT. Nothing else changes.
--
-- 2. verify_vehicle_from_spid_enhanced (vehicle_spid_data BEFORE INSERT OR UPDATE — the GM SPID build label): it wrote
--    four vehicles columns that no longer exist, three vehicle_spid_data columns that no longer exist, and one table
--    that no longer exists, and read rpo_codes as text[] when it is jsonb. Every SPID insert failed (prod holds one row,
--    2025-11-22). Mapping table:
--
--    SPID fact            | wrote before                                         | writes now
--    ---------------------+------------------------------------------------------+-----------------------------------------------
--    vin                  | vehicles.vin, vin_source, vin_confidence             | unchanged (all three columns exist)
--    paint_code_exterior  | vehicles.color (a CODE into the colour-name column), | vehicles.paint_code — same meaning, empty-fill only;
--                         |   color_source, color_confidence (gone)              |   color/color_source untouched; no paint_code source column
--    engine_code          | vehicles.engine (gone), engine_source,               | vehicles.engine_code — same meaning, empty-fill only,
--                         |   engine_confidence (gone)                           |   + engine_source = 'spid'; confidence has no column
--    transmission_code    | vehicles.transmission, transmission_source,          | vehicles.transmission + transmission_source (alive, unchanged);
--                         |   transmission_confidence (gone)                     |   transmission_code exists as a code column — NOT switched
--    rpo_codes            | vehicle_options via array_length()/unnest() on text[] | same rows via jsonb_array_elements_text(): the column is jsonb
--                         |                                                      |   now, and the old call failed at plan time for EVERY row
--    model_code           | verification_results only                            | unchanged
--    verdict flags        | vehicle_spid_data.vin_matches_vehicle / paint_verified / options_added (all gone) | dropped; verdicts stay in verification_results
--    verification record  | vehicle_comprehensive_verification (table gone)      | guarded with to_regclass like the log table (also gone) — skipped
--    Not recorded anywhere by this trigger (unchanged): paint_code_interior, engine displacement/type/description, transmission
--    type/model/speeds, axle ratio, GVW, tires, build date/plant. A SPID label is GM's build record; the right home for those is
--    vehicle_observations through ingest-observation (source 'spid'), not more vehicles columns — not built here.
--    Compare paths follow the mapping (paint against paint_code, then the legacy colour name; engine against engine_code, then engine_type).
--
-- 3. Two more ENABLED triggers fire on every vehicle_spid_data row and were broken by the same drift (found by the rehearsal —
--    the insert still died after fix 2): track_spid_form_completion (array_length() on the jsonb rpo_codes; NEW.extraction_model,
--    a column the row does not have — it has extraction_method) and populate_rpo_from_spid (same extraction_model subselect;
--    fires when rpo_codes_with_descriptions is present). Minimal fixes: jsonb test, extraction_method for extraction_model.
--    Both also get search_path pinned to public, pg_temp (they had none).
--
-- Rehearsed on prod in a rolled-back transaction: a scratch vehicle + a vehicle_spid_data insert with VIN, paint, engine,
-- transmission, RPO codes and RPO descriptions writes through all three triggers (vehicles.vin/paint_code/engine_code/
-- transmission filled with source tags, two vehicle_options rows, a vehicle_form_completions row, two vehicle_field_evidence
-- rows, two rpo_code_sources rows), an UPDATE with a mismatching paint code takes the discrepancy path without error,
-- and a labor_rate change on NUKE LTD commits with the trigger's "0 records affected" NOTICE.
-- Note for P2: the SPID trigger's async VIN decode (trigger_vin_decode) reads app.settings.service_role_key from the database
-- settings — one more copy of the service key to clear when keys rotate.

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
DECLARE
  v_rows integer := 0;
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
    
    -- P3.9: plpgsql has no bare ROW_COUNT; the old NOTICE threw 42703 after the UPDATE and rolled the rate change back.
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RAISE NOTICE 'Updated labor rates for organization %: % records affected', NEW.id, v_rows;
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
    
    -- P3.9: vehicle_spid_data.vin_matches_vehicle no longer exists; the verdict stays in verification_results.
  END IF;
  
  -- 2. PAINT CODE VERIFICATION
  IF NEW.paint_code_exterior IS NOT NULL AND NEW.paint_code_exterior != '' THEN
    -- P3.9: a paint CODE lands in vehicles.paint_code (same meaning, empty-fill only). It no longer overwrites the
    -- colour NAME in vehicles.color; color_confidence no longer exists; paint_code has no source column.
    IF vehicle_record.paint_code IS NULL OR vehicle_record.paint_code = '' THEN
      UPDATE vehicles 
      SET paint_code = NEW.paint_code_exterior
      WHERE id = NEW.vehicle_id;
      
      v_color_verified := TRUE;
      verification_results := verification_results || 
        jsonb_build_object('paint_code', 'auto_filled', 'value', NEW.paint_code_exterior);
    ELSE
      v_color_verified := (
        vehicle_record.paint_code = NEW.paint_code_exterior OR
        COALESCE(vehicle_record.color, '') LIKE '%' || NEW.paint_code_exterior || '%'
      );
      
      IF NOT v_color_verified THEN
        v_discrepancies := v_discrepancies || jsonb_build_array(
          jsonb_build_object(
            'field', 'paint_code',
            'spid_value', NEW.paint_code_exterior,
            'vehicle_value', vehicle_record.paint_code,
            'severity', 'low'
          )
        );
      END IF;
    END IF;
    
    -- P3.9: vehicle_spid_data.paint_verified no longer exists; the verdict stays in verification_results.
  END IF;
  
  -- 3. ENGINE CODE VERIFICATION
  IF NEW.engine_code IS NOT NULL AND NEW.engine_code != '' THEN
    -- P3.9: vehicles.engine is gone; the engine RPO code lands in vehicles.engine_code (same meaning, empty-fill
    -- only) with engine_source = 'spid'; engine_confidence no longer exists.
    IF vehicle_record.engine_code IS NULL OR vehicle_record.engine_code = '' THEN
      UPDATE vehicles 
      SET engine_code = NEW.engine_code,
          engine_source = 'spid'
      WHERE id = NEW.vehicle_id;
      
      v_engine_verified := TRUE;
    ELSE
      v_engine_verified := (vehicle_record.engine_code = NEW.engine_code OR
                           COALESCE(vehicle_record.engine_type, '') LIKE '%' || NEW.engine_code || '%');
      
      IF NOT v_engine_verified THEN
        v_discrepancies := v_discrepancies || jsonb_build_array(
          jsonb_build_object(
            'field', 'engine_code',
            'spid_value', NEW.engine_code,
            'vehicle_value', vehicle_record.engine_code,
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
          transmission_source = 'spid'
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
  -- P3.9: vehicle_spid_data.rpo_codes is jsonb now (it was text[]); the old array_length() call failed at plan time
  -- for every row, even rows without codes. options_added no longer exists; the count stays in verification_results.
  IF NEW.rpo_codes IS NOT NULL AND jsonb_typeof(NEW.rpo_codes) = 'array' AND jsonb_array_length(NEW.rpo_codes) > 0 THEN
    IF to_regclass('public.vehicle_options') IS NOT NULL THEN
      INSERT INTO vehicle_options (vehicle_id, option_code, source, verified_by_spid)
      SELECT 
        NEW.vehicle_id,
        code,
        'spid',
        TRUE
      FROM jsonb_array_elements_text(NEW.rpo_codes) AS code
      WHERE code IS NOT NULL AND code <> ''
      ON CONFLICT (vehicle_id, option_code) DO UPDATE
      SET verified_by_spid = TRUE, source = 'spid';
      
      verification_results := verification_results || 
        jsonb_build_object('rpo_codes_added', jsonb_array_length(NEW.rpo_codes), 'codes', NEW.rpo_codes);
    END IF;
  END IF;
  
  -- 6. MODEL CODE VERIFICATION
  IF NEW.model_code IS NOT NULL AND NEW.model_code != '' THEN
    verification_results := verification_results || 
      jsonb_build_object('model_code', 'extracted', 'value', NEW.model_code);
  END IF;
  
  -- 7. Create/Update Comprehensive Verification Record
  -- P3.9: the table no longer exists on prod; guarded so the trigger keeps working. The verdicts' proper home is
  -- vehicle_observations (source 'spid'), not built here.
  IF to_regclass('public.vehicle_comprehensive_verification') IS NOT NULL THEN
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
  END IF;
  
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

CREATE OR REPLACE FUNCTION public.track_spid_form_completion()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- P3.9: vehicle_spid_data.rpo_codes is jsonb (was text[]) and the row has extraction_method, not extraction_model;
  -- both references failed at plan time, so this AFTER trigger killed every SPID insert.
  INSERT INTO vehicle_form_completions (
    vehicle_id,
    form_type,
    status,
    completeness_pct,
    fields_extracted,
    source_id,
    source_type,
    provider,
    extracted_at
  ) VALUES (
    NEW.vehicle_id,
    'spid',
    'complete',
    100,  -- SPID is always 100% if extracted
    jsonb_build_object(
      'vin', (NEW.vin IS NOT NULL),
      'build_date', (NEW.build_date IS NOT NULL),
      'paint_code_exterior', (NEW.paint_code_exterior IS NOT NULL),
      'paint_code_interior', (NEW.paint_code_interior IS NOT NULL),
      'engine_code', (NEW.engine_code IS NOT NULL),
      'transmission_code', (NEW.transmission_code IS NOT NULL),
      'axle_ratio', (NEW.axle_ratio IS NOT NULL),
      'rpo_codes', (NEW.rpo_codes IS NOT NULL AND jsonb_typeof(NEW.rpo_codes) = 'array' AND jsonb_array_length(NEW.rpo_codes) > 0)
    ),
    NEW.image_id,
    'spid_image',
    'GM Factory',
    NEW.extracted_at
  )
  ON CONFLICT (vehicle_id, form_type) 
  DO UPDATE SET
    status = 'complete',
    completeness_pct = 100,
    fields_extracted = EXCLUDED.fields_extracted,
    updated_at = NOW();
    
  -- Also store as field evidence
  IF NEW.vin IS NOT NULL THEN
    INSERT INTO vehicle_field_evidence (
      vehicle_id, field_name, value_text, source_type, source_id,
      confidence_score, extraction_model
    ) VALUES (
      NEW.vehicle_id, 'vin', NEW.vin, 'spid_sheet', NEW.image_id,
      NEW.extraction_confidence, NEW.extraction_method
    ) ON CONFLICT (vehicle_id, field_name, source_type, source_id) DO NOTHING;
  END IF;
  
  IF NEW.paint_code_exterior IS NOT NULL THEN
    INSERT INTO vehicle_field_evidence (
      vehicle_id, field_name, value_text, source_type, source_id,
      confidence_score, extraction_model
    ) VALUES (
      NEW.vehicle_id, 'paint_code_exterior', NEW.paint_code_exterior, 'spid_sheet', NEW.image_id,
      NEW.extraction_confidence, NEW.extraction_method
    ) ON CONFLICT (vehicle_id, field_name, source_type, source_id) DO NOTHING;
  END IF;
  
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.populate_rpo_from_spid()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  vehicle_year INTEGER;
  vehicle_model TEXT;
  extraction_model_val TEXT;
BEGIN
  -- Get vehicle year and model
  SELECT year, model INTO vehicle_year, vehicle_model
  FROM vehicles WHERE id = NEW.vehicle_id;
  
  -- Get extraction model from new record
  -- P3.9: vehicle_spid_data has no extraction_model column (the row carries extraction_method); the old subselect
  -- failed whenever rpo_codes_with_descriptions was present.
  extraction_model_val := COALESCE(NEW.extraction_method, 'unknown');
  
  -- Extract each code + description pair from SPID
  IF NEW.rpo_codes_with_descriptions IS NOT NULL THEN
    INSERT INTO rpo_code_sources (
      code, 
      description, 
      source_vehicle_id, 
      source_spid_image_id,
      vehicle_year,
      vehicle_model,
      extraction_model
    )
    SELECT 
      (codes->>'code')::TEXT,
      (codes->>'description')::TEXT,
      NEW.vehicle_id,
      NEW.image_id,
      vehicle_year,
      vehicle_model,
      extraction_model_val
    FROM jsonb_array_elements(NEW.rpo_codes_with_descriptions) AS codes
    WHERE (codes->>'code')::TEXT IS NOT NULL
      AND (codes->>'description')::TEXT IS NOT NULL
    ON CONFLICT (code, source_vehicle_id) DO NOTHING;
    
    -- Update consensus definitions
    INSERT INTO rpo_code_definitions (code, name, category, years_applicable, make)
    SELECT 
      code,
      consensus_description,
      'uncategorized',
      years_seen,
      'GM'
    FROM rpo_consensus_definitions
    WHERE code IN (
      SELECT (codes->>'code')::TEXT 
      FROM jsonb_array_elements(NEW.rpo_codes_with_descriptions) AS codes
      WHERE (codes->>'code')::TEXT IS NOT NULL
    )
    ON CONFLICT (code) DO UPDATE SET
      name = EXCLUDED.name,
      years_applicable = EXCLUDED.years_applicable;
  END IF;
  
  RETURN NEW;
END;
$function$
;

COMMIT;
