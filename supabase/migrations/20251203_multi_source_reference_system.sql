-- ============================================
-- MULTI-SOURCE VEHICLE REFERENCE SYSTEM
-- ============================================
-- Supports NHTSA, GM Heritage, JDM, European specs
-- Each vehicle can reference multiple authoritative sources

-- ============================================
-- 1. REFERENCE SOURCE LINKS
-- ============================================

CREATE TABLE IF NOT EXISTS vehicle_reference_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  
  -- Which reference source
  source_type TEXT NOT NULL CHECK (source_type IN ('nhtsa', 'gm_heritage', 'jdm', 'euro', 'manufacturer')),
  source_identifier TEXT NOT NULL, -- VIN, chassis code, type approval number
  
  -- Match confidence
  match_confidence INTEGER DEFAULT 100 CHECK (match_confidence >= 0 AND match_confidence <= 100),
  match_method TEXT, -- 'vin_exact', 'ymm_fuzzy', 'chassis_code', 'manual'
  
  -- What this source provides
  provides_fields TEXT[], -- ['make', 'model', 'year', 'series', 'drivetrain']
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  verified_by UUID,
  
  UNIQUE(vehicle_id, source_type, source_identifier)
);

CREATE INDEX idx_ref_links_vehicle ON vehicle_reference_links(vehicle_id);
CREATE INDEX idx_ref_links_source ON vehicle_reference_links(source_type);

-- ============================================
-- 2. COMPARISON VIEW - NHTSA vs OURS
-- ============================================

CREATE OR REPLACE VIEW vehicle_nhtsa_comparison AS
SELECT 
  v.id as vehicle_id,
  v.year || ' ' || v.make || ' ' || v.model as user_identity,
  n.year || ' ' || n.make || ' ' || n.model as nhtsa_identity,
  
  -- Field-by-field comparison
  jsonb_build_object(
    'make', jsonb_build_object(
      'ours', v.make,
      'nhtsa', n.make,
      'match', UPPER(v.make) = UPPER(n.make),
      'action', CASE WHEN UPPER(v.make) != UPPER(n.make) THEN 'conflict' ELSE 'ok' END
    ),
    'model', jsonb_build_object(
      'ours', v.model,
      'nhtsa', n.model,
      'match', UPPER(v.model) = UPPER(n.model),
      'extractable', v.model LIKE n.model || '%',
      'action', CASE 
        WHEN UPPER(v.model) = UPPER(n.model) THEN 'ok'
        WHEN v.model LIKE n.model || '%' THEN 'extract_extra_to_trim_series'
        ELSE 'conflict'
      END
    ),
    'year', jsonb_build_object(
      'ours', v.year,
      'nhtsa', n.year,
      'match', v.year = n.year,
      'action', CASE WHEN v.year != n.year THEN 'conflict' ELSE 'ok' END
    ),
    'drivetrain', jsonb_build_object(
      'ours', v.drivetrain,
      'nhtsa', n.drivetrain,
      'match', v.drivetrain = n.drivetrain,
      'action', CASE 
        WHEN v.drivetrain IS NULL THEN 'populate_from_nhtsa'
        WHEN v.drivetrain != n.drivetrain THEN 'possible_modification'
        ELSE 'ok'
      END
    ),
    'engine', jsonb_build_object(
      'ours_liters', v.engine_liters,
      'nhtsa_liters', n.engine_displacement_liters,
      'nhtsa_cylinders', n.engine_cylinders,
      'match', v.engine_liters::TEXT = n.engine_displacement_liters,
      'action', CASE 
        WHEN v.engine_liters IS NULL THEN 'populate_from_nhtsa'
        WHEN v.engine_liters::TEXT != n.engine_displacement_liters THEN 'engine_swap_or_error'
        ELSE 'ok'
      END
    )
  ) as field_comparison,
  
  -- Summary
  CASE 
    WHEN v.year = n.year AND UPPER(v.make) = UPPER(n.make) AND UPPER(v.model) = UPPER(n.model) THEN 'perfect_match'
    WHEN v.year = n.year AND UPPER(v.make) = UPPER(n.make) AND v.model LIKE n.model || '%' THEN 'extractable'
    ELSE 'conflict'
  END as match_status,
  
  -- Enrichment opportunities
  ARRAY_REMOVE(ARRAY[
    CASE WHEN v.series IS NULL AND v.model ~ '^(K5|K10|C10)' THEN 'extract_series' END,
    CASE WHEN v.trim IS NULL AND v.model ~ '(Silverado|Cheyenne)' THEN 'extract_trim' END,
    CASE WHEN v.drivetrain IS NULL AND n.drivetrain IS NOT NULL THEN 'add_drivetrain' END,
    CASE WHEN v.engine_liters IS NULL AND n.engine_displacement_liters IS NOT NULL THEN 'add_engine' END
  ], NULL) as enrichment_actions
  
FROM vehicles v
JOIN vin_decoded_data n ON UPPER(v.vin) = n.vin
WHERE n.make IS NOT NULL;

-- ============================================
-- 3. ENRICHMENT FUNCTION (Non-Destructive)
-- ============================================

CREATE OR REPLACE FUNCTION enrich_vehicle_from_nhtsa(
  p_vehicle_id UUID,
  p_options JSONB DEFAULT '{}'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v RECORD;
  n RECORD;
  enriched_fields TEXT[] := ARRAY[]::TEXT[];
  conflicts TEXT[] := ARRAY[]::TEXT[];
BEGIN
  -- Get vehicle and NHTSA data
  SELECT * INTO v FROM vehicles WHERE id = p_vehicle_id;
  SELECT * INTO n FROM vin_decoded_data WHERE vin = UPPER(v.vin);
  
  IF n IS NULL THEN
    RETURN jsonb_build_object('error', 'No NHTSA data for this VIN');
  END IF;
  
  -- ENRICHMENT RULES (only fill NULLs, never overwrite)
  
  -- 1. Drivetrain
  IF v.drivetrain IS NULL AND n.drivetrain IS NOT NULL THEN
    UPDATE vehicles SET drivetrain = 
      CASE 
        WHEN n.drivetrain ~ '4WD|4x4' THEN '4WD'
        WHEN n.drivetrain ~ '2WD|4x2' THEN '2WD'
        WHEN n.drivetrain ~ 'AWD' THEN 'AWD'
        WHEN n.drivetrain ~ 'RWD' THEN 'RWD'
        WHEN n.drivetrain ~ 'FWD' THEN 'FWD'
        ELSE n.drivetrain
      END
    WHERE id = p_vehicle_id;
    enriched_fields := array_append(enriched_fields, 'drivetrain');
  END IF;
  
  -- 2. Engine liters
  IF v.engine_liters IS NULL AND n.engine_displacement_liters IS NOT NULL THEN
    UPDATE vehicles SET engine_liters = n.engine_displacement_liters::NUMERIC
    WHERE id = p_vehicle_id;
    enriched_fields := array_append(enriched_fields, 'engine_liters');
  END IF;
  
  -- 3. Engine cylinders → engine_type
  IF v.engine_type IS NULL AND n.engine_cylinders IS NOT NULL THEN
    UPDATE vehicles SET engine_type = 
      CASE 
        WHEN n.engine_cylinders = 4 THEN 'I4'
        WHEN n.engine_cylinders = 6 THEN 'I6'
        WHEN n.engine_cylinders = 8 THEN 'V8'
        ELSE n.engine_cylinders::TEXT || '-cyl'
      END
    WHERE id = p_vehicle_id;
    enriched_fields := array_append(enriched_fields, 'engine_type');
  END IF;
  
  -- 4. Body style
  IF v.body_style IS NULL AND n.body_type IS NOT NULL THEN
    UPDATE vehicles SET body_style = 
      CASE 
        WHEN n.body_type ~ 'Sport Utility' THEN 'SUV'
        WHEN n.body_type ~ 'Pickup' THEN 'Pickup'
        WHEN n.body_type ~ 'Sedan' THEN 'Sedan'
        WHEN n.body_type ~ 'Coupe' THEN 'Coupe'
        ELSE n.body_type
      END
    WHERE id = p_vehicle_id;
    enriched_fields := array_append(enriched_fields, 'body_style');
  END IF;
  
  -- 5. Series extraction (if our model contains it but series field is empty)
  IF v.series IS NULL AND v.model ~ '^(K5|K10|K20|K30|C10|C20|C30|K1500|C1500)' THEN
    UPDATE vehicles SET series = 
      substring(v.model from '^(K5|K10|K20|K30|C10|C20|C30|K1500|C1500)')
    WHERE id = p_vehicle_id;
    enriched_fields := array_append(enriched_fields, 'series (extracted)');
  END IF;
  
  -- CONFLICT DETECTION (data exists but differs from NHTSA)
  
  IF v.year IS NOT NULL AND n.year IS NOT NULL AND v.year != n.year THEN
    conflicts := array_append(conflicts, 'year: ' || v.year || ' vs NHTSA ' || n.year);
  END IF;
  
  IF v.make IS NOT NULL AND n.make IS NOT NULL AND UPPER(v.make) != UPPER(n.make) THEN
    conflicts := array_append(conflicts, 'make: ' || v.make || ' vs NHTSA ' || n.make);
  END IF;
  
  RETURN jsonb_build_object(
    'vehicle_id', p_vehicle_id,
    'enriched_fields', enriched_fields,
    'conflicts_detected', conflicts,
    'nhtsa_source', 'VIN ' || v.vin
  );
END;
$$;

-- ============================================
-- 4. BATCH ENRICHMENT
-- ============================================

CREATE OR REPLACE FUNCTION enrich_all_vehicles_from_nhtsa()
RETURNS TABLE (
  vehicle_id UUID,
  fields_enriched TEXT[],
  conflicts TEXT[]
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_id UUID;
  result JSONB;
BEGIN
  FOR v_id IN 
    SELECT v.id 
    FROM vehicles v
    JOIN vin_decoded_data n ON UPPER(v.vin) = n.vin
    WHERE n.make IS NOT NULL
  LOOP
    result := enrich_vehicle_from_nhtsa(v_id);
    
    RETURN QUERY SELECT 
      v_id,
      ARRAY(SELECT jsonb_array_elements_text(result->'enriched_fields')),
      ARRAY(SELECT jsonb_array_elements_text(result->'conflicts_detected'));
  END LOOP;
END;
$$;

-- ============================================
-- 5. DATA QUALITY DASHBOARD
-- ============================================

CREATE OR REPLACE VIEW nhtsa_integration_status AS
SELECT 
  COUNT(*) as total_vehicles,
  COUNT(*) FILTER (WHERE has_vin) as vehicles_with_vin,
  COUNT(*) FILTER (WHERE has_nhtsa) as vehicles_with_nhtsa,
  COUNT(*) FILTER (WHERE has_conflicts) as vehicles_with_conflicts,
  COUNT(*) FILTER (WHERE needs_enrichment) as vehicles_needing_enrichment,
  ROUND(100.0 * COUNT(*) FILTER (WHERE has_nhtsa) / NULLIF(COUNT(*) FILTER (WHERE has_vin), 0), 1) as nhtsa_coverage_pct
FROM (
  SELECT 
    v.id,
    v.vin IS NOT NULL AND v.vin != '' as has_vin,
    n.vin IS NOT NULL as has_nhtsa,
    (v.year != n.year OR UPPER(v.make) != UPPER(n.make)) as has_conflicts,
    (v.drivetrain IS NULL OR v.engine_liters IS NULL) AND n.vin IS NOT NULL as needs_enrichment
  FROM vehicles v
  LEFT JOIN vin_decoded_data n ON UPPER(v.vin) = n.vin
) stats;

-- ============================================
-- 6. COMMENTS
-- ============================================

COMMENT ON TABLE vehicle_reference_links IS 'Links vehicles to authoritative reference sources (NHTSA, GM Heritage, JDM, etc.)';
COMMENT ON VIEW vehicle_nhtsa_comparison IS 'Field-by-field comparison between user data and NHTSA decoded data';
COMMENT ON FUNCTION enrich_vehicle_from_nhtsa IS 'Non-destructively enriches vehicle from NHTSA data (only fills NULLs)';
COMMENT ON FUNCTION enrich_all_vehicles_from_nhtsa IS 'Batch enrichment of all vehicles with NHTSA data';
COMMENT ON VIEW nhtsa_integration_status IS 'Dashboard showing NHTSA integration coverage and quality';

