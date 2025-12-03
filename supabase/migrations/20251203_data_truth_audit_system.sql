-- ============================================
-- DATA TRUTH AUDIT SYSTEM
-- ============================================
-- Complete provenance tracking for all existing data

-- ============================================
-- 1. BACKFILL EVIDENCE FUNCTION
-- ============================================
-- Reconstructs evidence trail from existing data

CREATE OR REPLACE FUNCTION backfill_evidence_for_vehicle(p_vehicle_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v RECORD;
  n RECORD;
  em RECORD;
  evidence_count INTEGER := 0;
  conflicts_found INTEGER := 0;
  v_source_type TEXT;
  v_source_trust INTEGER;
BEGIN
  -- Get vehicle
  SELECT * INTO v FROM vehicles WHERE id = p_vehicle_id;
  IF v IS NULL THEN
    RETURN jsonb_build_object('error', 'Vehicle not found');
  END IF;
  
  -- Get VIN data
  SELECT * INTO n FROM vin_decoded_data WHERE vin = UPPER(v.vin);
  
  -- Get extraction metadata (most recent)
  SELECT * INTO em FROM extraction_metadata 
  WHERE vehicle_id = p_vehicle_id 
  ORDER BY extracted_at DESC LIMIT 1;
  
  -- Determine source type and trust level based on URLs
  v_source_type := CASE
    WHEN v.bat_auction_url IS NOT NULL THEN 'auction_result_bat'
    WHEN v.discovery_url LIKE '%ksl.com%' THEN 'scraped_listing'
    WHEN v.discovery_url LIKE '%craigslist.org%' THEN 'scraped_listing'
    WHEN em.source_url IS NOT NULL THEN 'scraped_listing'
    ELSE 'user_input_unverified'
  END;
  
  v_source_trust := CASE v_source_type
    WHEN 'auction_result_bat' THEN 85
    WHEN 'scraped_listing' THEN 70
    ELSE 50
  END;
  
  -- ============================================
  -- CREATE EVIDENCE FROM VIN (Highest Authority)
  -- ============================================
  
  IF n.vin IS NOT NULL THEN
    -- Year from VIN
    IF n.year IS NOT NULL THEN
      INSERT INTO field_evidence (
        vehicle_id, field_name, proposed_value,
        source_type, source_confidence,
        status, assigned_by,
        extraction_context
      ) VALUES (
        p_vehicle_id, 'year', n.year::TEXT,
        'nhtsa_vin_decode', 100,
        'accepted', 'backfill_audit',
        'VIN: ' || v.vin
      ) ON CONFLICT (vehicle_id, field_name, source_type, proposed_value) DO NOTHING;
      evidence_count := evidence_count + 1;
      
      -- Check for conflict
      IF v.year IS NOT NULL AND v.year != n.year THEN
        conflicts_found := conflicts_found + 1;
      END IF;
    END IF;
    
    -- Make from VIN
    IF n.make IS NOT NULL THEN
      INSERT INTO field_evidence (
        vehicle_id, field_name, proposed_value,
        source_type, source_confidence,
        status, assigned_by,
        extraction_context
      ) VALUES (
        p_vehicle_id, 'make', n.make,
        'nhtsa_vin_decode', 100,
        'accepted', 'backfill_audit',
        'VIN: ' || v.vin
      ) ON CONFLICT (vehicle_id, field_name, source_type, proposed_value) DO NOTHING;
      evidence_count := evidence_count + 1;
      
      IF v.make IS NOT NULL AND UPPER(v.make) != UPPER(n.make) THEN
        conflicts_found := conflicts_found + 1;
      END IF;
    END IF;
    
    -- Model from VIN
    IF n.model IS NOT NULL THEN
      INSERT INTO field_evidence (
        vehicle_id, field_name, proposed_value,
        source_type, source_confidence,
        status, assigned_by,
        extraction_context
      ) VALUES (
        p_vehicle_id, 'model', n.model,
        'nhtsa_vin_decode', 100,
        'accepted', 'backfill_audit',
        'VIN: ' || v.vin
      ) ON CONFLICT (vehicle_id, field_name, source_type, proposed_value) DO NOTHING;
      evidence_count := evidence_count + 1;
    END IF;
    
    -- Drivetrain from VIN
    IF n.drivetrain IS NOT NULL THEN
      INSERT INTO field_evidence (
        vehicle_id, field_name, proposed_value,
        source_type, source_confidence,
        status, assigned_by,
        extraction_context
      ) VALUES (
        p_vehicle_id, 'drivetrain', n.drivetrain,
        'nhtsa_vin_decode', 100,
        'accepted', 'backfill_audit',
        'VIN: ' || v.vin
      ) ON CONFLICT (vehicle_id, field_name, source_type, proposed_value) DO NOTHING;
      evidence_count := evidence_count + 1;
      
      IF v.drivetrain IS NOT NULL AND UPPER(v.drivetrain) != UPPER(n.drivetrain) THEN
        conflicts_found := conflicts_found + 1;
      END IF;
    END IF;
    
    -- Transmission from VIN
    IF n.transmission IS NOT NULL THEN
      INSERT INTO field_evidence (
        vehicle_id, field_name, proposed_value,
        source_type, source_confidence,
        status, assigned_by,
        extraction_context
      ) VALUES (
        p_vehicle_id, 'transmission', n.transmission,
        'nhtsa_vin_decode', 100,
        'accepted', 'backfill_audit',
        'VIN: ' || v.vin
      ) ON CONFLICT (vehicle_id, field_name, source_type, proposed_value) DO NOTHING;
      evidence_count := evidence_count + 1;
    END IF;
    
    -- Engine from VIN
    IF n.engine_displacement_liters IS NOT NULL THEN
      INSERT INTO field_evidence (
        vehicle_id, field_name, proposed_value,
        source_type, source_confidence,
        status, assigned_by,
        extraction_context
      ) VALUES (
        p_vehicle_id, 'engine_liters', n.engine_displacement_liters,
        'nhtsa_vin_decode', 100,
        'accepted', 'backfill_audit',
        'VIN: ' || v.vin
      ) ON CONFLICT (vehicle_id, field_name, source_type, proposed_value) DO NOTHING;
      evidence_count := evidence_count + 1;
    END IF;
  END IF;
  
  -- ============================================
  -- CREATE EVIDENCE FROM SCRAPED DATA
  -- ============================================
  
  DECLARE
    v_source_url TEXT := COALESCE(v.bat_auction_url, v.discovery_url, em.source_url);
  BEGIN
    IF v_source_url IS NOT NULL THEN
      -- Year from scraper
      IF v.year IS NOT NULL THEN
        INSERT INTO field_evidence (
          vehicle_id, field_name, proposed_value,
          source_type, source_confidence,
          status, assigned_by,
          extraction_context
        ) VALUES (
          p_vehicle_id, 'year', v.year::TEXT,
          v_source_type, v_source_trust,
          'accepted', 'backfill_audit',
          v_source_url
        ) ON CONFLICT (vehicle_id, field_name, source_type, proposed_value) DO NOTHING;
        evidence_count := evidence_count + 1;
      END IF;
      
      -- Make from scraper
      IF v.make IS NOT NULL THEN
        INSERT INTO field_evidence (
          vehicle_id, field_name, proposed_value,
          source_type, source_confidence,
          status, assigned_by,
          extraction_context
        ) VALUES (
          p_vehicle_id, 'make', v.make,
          v_source_type, v_source_trust,
          'accepted', 'backfill_audit',
          v_source_url
        ) ON CONFLICT (vehicle_id, field_name, source_type, proposed_value) DO NOTHING;
        evidence_count := evidence_count + 1;
      END IF;
      
      -- Model from scraper
      IF v.model IS NOT NULL THEN
        INSERT INTO field_evidence (
          vehicle_id, field_name, proposed_value,
          source_type, source_confidence,
          status, assigned_by,
          extraction_context
        ) VALUES (
          p_vehicle_id, 'model', v.model,
          v_source_type, v_source_trust,
          'accepted', 'backfill_audit',
          v_source_url
        ) ON CONFLICT (vehicle_id, field_name, source_type, proposed_value) DO NOTHING;
        evidence_count := evidence_count + 1;
      END IF;
      
      -- Drivetrain from scraper
      IF v.drivetrain IS NOT NULL THEN
        INSERT INTO field_evidence (
          vehicle_id, field_name, proposed_value,
          source_type, source_confidence,
          status, assigned_by,
          extraction_context
        ) VALUES (
          p_vehicle_id, 'drivetrain', v.drivetrain,
          v_source_type, v_source_trust,
          'accepted', 'backfill_audit',
          v_source_url
        ) ON CONFLICT (vehicle_id, field_name, source_type, proposed_value) DO NOTHING;
        evidence_count := evidence_count + 1;
      END IF;
      
      -- Series from scraper
      IF v.series IS NOT NULL THEN
        INSERT INTO field_evidence (
          vehicle_id, field_name, proposed_value,
          source_type, source_confidence,
          status, assigned_by,
          extraction_context
        ) VALUES (
          p_vehicle_id, 'series', v.series,
          v_source_type, v_source_trust,
          'accepted', 'backfill_audit',
          v_source_url
        ) ON CONFLICT (vehicle_id, field_name, source_type, proposed_value) DO NOTHING;
        evidence_count := evidence_count + 1;
      END IF;
      
      -- Trim from scraper
      IF v.trim IS NOT NULL THEN
        INSERT INTO field_evidence (
          vehicle_id, field_name, proposed_value,
          source_type, source_confidence,
          status, assigned_by,
          extraction_context
        ) VALUES (
          p_vehicle_id, 'trim', v.trim,
          v_source_type, v_source_trust,
          'accepted', 'backfill_audit',
          v_source_url
        ) ON CONFLICT (vehicle_id, field_name, source_type, proposed_value) DO NOTHING;
        evidence_count := evidence_count + 1;
      END IF;
    END IF;
  END;
  
  -- ============================================
  -- UPDATE PROVENANCE TABLE
  -- ============================================
  
  -- Update provenance for fields with VIN authority
  IF n.vin IS NOT NULL THEN
    -- Year
    IF n.year IS NOT NULL THEN
      INSERT INTO vehicle_field_provenance (
        vehicle_id, field_name, current_value,
        total_confidence, primary_source,
        factory_original_value, modified_value,
        last_verified_at
      ) VALUES (
        p_vehicle_id, 'year', v.year::TEXT,
        100, 'nhtsa_vin_decode',
        n.year::TEXT,
        CASE WHEN v.year != n.year THEN v.year::TEXT END,
        NOW()
      )
      ON CONFLICT (vehicle_id, field_name) 
      DO UPDATE SET
        factory_original_value = EXCLUDED.factory_original_value,
        modified_value = EXCLUDED.modified_value,
        total_confidence = EXCLUDED.total_confidence,
        primary_source = EXCLUDED.primary_source,
        last_verified_at = NOW();
    END IF;
    
    -- Drivetrain (critical for modifications)
    IF n.drivetrain IS NOT NULL THEN
      INSERT INTO vehicle_field_provenance (
        vehicle_id, field_name, current_value,
        total_confidence, primary_source,
        factory_original_value, modified_value,
        last_verified_at
      ) VALUES (
        p_vehicle_id, 'drivetrain', v.drivetrain,
        CASE WHEN v.drivetrain = n.drivetrain THEN 100 ELSE 85 END,
        CASE WHEN v.drivetrain = n.drivetrain THEN 'nhtsa_vin_decode' ELSE 'modification_detected' END,
        n.drivetrain,
        CASE WHEN UPPER(v.drivetrain) != UPPER(n.drivetrain) THEN v.drivetrain END,
        NOW()
      )
      ON CONFLICT (vehicle_id, field_name) 
      DO UPDATE SET
        factory_original_value = EXCLUDED.factory_original_value,
        modified_value = EXCLUDED.modified_value,
        total_confidence = EXCLUDED.total_confidence,
        primary_source = EXCLUDED.primary_source,
        last_verified_at = NOW();
    END IF;
  END IF;
  
  RETURN jsonb_build_object(
    'vehicle_id', p_vehicle_id,
    'evidence_records_created', evidence_count,
    'conflicts_found', conflicts_found,
    'has_vin_authority', n.vin IS NOT NULL,
    'source_type', v_source_type,
    'source_url', COALESCE(v.bat_auction_url, v.discovery_url, em.source_url)
  );
END;
$$;

-- ============================================
-- 2. DATA TRUTH AUDIT REPORT VIEW
-- ============================================

CREATE OR REPLACE VIEW data_truth_audit_report AS
SELECT 
  v.id as vehicle_id,
  v.year || ' ' || v.make || ' ' || v.model as vehicle_identity,
  v.vin,
  
  -- VIN Authority Status
  CASE WHEN n.vin IS NOT NULL THEN 'YES' ELSE 'NO' END as has_vin_decode,
  n.confidence as vin_decode_confidence,
  
  -- Field Analysis
  jsonb_build_object(
    'year', jsonb_build_object(
      'current', v.year,
      'vin_says', n.year,
      'conflict', v.year IS NOT NULL AND n.year IS NOT NULL AND v.year != n.year,
      'confidence', COALESCE(
        (SELECT MAX(source_confidence) FROM field_evidence 
         WHERE vehicle_id = v.id AND field_name = 'year'), 
        50
      )
    ),
    'make', jsonb_build_object(
      'current', v.make,
      'vin_says', n.make,
      'conflict', v.make IS NOT NULL AND n.make IS NOT NULL AND UPPER(v.make) != UPPER(n.make),
      'confidence', COALESCE(
        (SELECT MAX(source_confidence) FROM field_evidence 
         WHERE vehicle_id = v.id AND field_name = 'make'), 
        50
      )
    ),
    'model', jsonb_build_object(
      'current', v.model,
      'vin_says', n.model,
      'extractable', v.model LIKE n.model || '%',
      'confidence', COALESCE(
        (SELECT MAX(source_confidence) FROM field_evidence 
         WHERE vehicle_id = v.id AND field_name = 'model'), 
        50
      )
    ),
    'drivetrain', jsonb_build_object(
      'current', v.drivetrain,
      'vin_says', n.drivetrain,
      'conflict', v.drivetrain IS NOT NULL AND n.drivetrain IS NOT NULL 
                  AND UPPER(v.drivetrain) != UPPER(n.drivetrain),
      'modification_likely', v.drivetrain IS NOT NULL AND n.drivetrain IS NOT NULL 
                             AND UPPER(v.drivetrain) != UPPER(n.drivetrain),
      'confidence', COALESCE(
        (SELECT MAX(source_confidence) FROM field_evidence 
         WHERE vehicle_id = v.id AND field_name = 'drivetrain'), 
        50
      )
    ),
    'series', jsonb_build_object(
      'current', v.series,
      'missing', v.series IS NULL,
      'confidence', COALESCE(
        (SELECT MAX(source_confidence) FROM field_evidence 
         WHERE vehicle_id = v.id AND field_name = 'series'), 
        30
      )
    ),
    'trim', jsonb_build_object(
      'current', v.trim,
      'missing', v.trim IS NULL,
      'confidence', COALESCE(
        (SELECT MAX(source_confidence) FROM field_evidence 
         WHERE vehicle_id = v.id AND field_name = 'trim'), 
        30
      )
    )
  ) as field_analysis,
  
  -- Data Completeness
  v.completion_percentage as completeness_pct,
  
  -- Source Trail
  jsonb_build_object(
    'discovery_url', v.discovery_url,
    'bat_auction_url', v.bat_auction_url,
    'has_extraction_metadata', EXISTS(SELECT 1 FROM extraction_metadata WHERE vehicle_id = v.id),
    'scraper_version', (SELECT scraper_version FROM extraction_metadata 
                        WHERE vehicle_id = v.id ORDER BY extracted_at DESC LIMIT 1),
    'last_extracted', (SELECT extracted_at FROM extraction_metadata 
                       WHERE vehicle_id = v.id ORDER BY extracted_at DESC LIMIT 1)
  ) as source_trail,
  
  -- Anomalies
  (SELECT jsonb_agg(
    jsonb_build_object(
      'field', field,
      'issue', anomaly,
      'severity', severity,
      'recommendation', recommendation
    )
  ) FROM detect_data_anomalies(v.id)) as anomalies,
  
  -- Evidence Summary
  (SELECT COUNT(*) FROM field_evidence WHERE vehicle_id = v.id) as evidence_count,
  (SELECT COUNT(DISTINCT field_name) FROM field_evidence WHERE vehicle_id = v.id) as fields_with_evidence,
  
  -- Conflict Count
  (SELECT COUNT(*) FROM field_evidence fe1
   WHERE fe1.vehicle_id = v.id
     AND EXISTS (
       SELECT 1 FROM field_evidence fe2
       WHERE fe2.vehicle_id = v.id
         AND fe2.field_name = fe1.field_name
         AND fe2.proposed_value != fe1.proposed_value
         AND fe2.id != fe1.id
     )
  ) as conflicts_detected

FROM vehicles v
LEFT JOIN vin_decoded_data n ON UPPER(v.vin) = n.vin;

-- ============================================
-- 3. VEHICLE FIELD SOURCE MAP
-- ============================================

CREATE OR REPLACE VIEW vehicle_field_source_map AS
SELECT 
  v.id as vehicle_id,
  v.year || ' ' || v.make || ' ' || v.model as vehicle_identity,
  vfp.field_name,
  vfp.current_value,
  
  -- Confidence
  vfp.total_confidence,
  CASE 
    WHEN total_confidence >= 90 THEN 'HIGH'
    WHEN total_confidence >= 70 THEN 'MEDIUM'
    WHEN total_confidence >= 50 THEN 'LOW'
    ELSE 'VERY_LOW'
  END as confidence_rating,
  
  -- Primary source
  primary_source,
  dst.trust_level as primary_trust_level,
  dst.description as source_description,
  
  -- Supporting sources
  supporting_sources,
  
  -- Factory vs Current
  vfp.factory_original_value,
  CASE 
    WHEN vfp.modified_value IS NOT NULL THEN 'MODIFIED'
    WHEN vfp.factory_original_value IS NOT NULL AND vfp.current_value = vfp.factory_original_value THEN 'FACTORY_ORIGINAL'
    WHEN vfp.factory_original_value IS NULL THEN 'NO_VIN_DATA'
    ELSE 'UNKNOWN'
  END as modification_status,
  vfp.modification_date,
  
  -- Evidence trail
  (SELECT jsonb_agg(
    jsonb_build_object(
      'source', source_type,
      'value', proposed_value,
      'confidence', source_confidence,
      'status', status,
      'context', SUBSTRING(extraction_context, 1, 100)
    ) ORDER BY source_confidence DESC
  ) FROM field_evidence 
   WHERE vehicle_id = vfp.vehicle_id 
     AND field_name = vfp.field_name) as evidence_trail,
  
  -- Last verification
  vfp.last_verified_at,
  vfp.last_verified_by

FROM vehicle_field_provenance vfp
JOIN vehicles v ON vfp.vehicle_id = v.id
LEFT JOIN data_source_trust_hierarchy dst ON vfp.primary_source = dst.source_type;

-- ============================================
-- 4. PRIORITY FIXES VIEW
-- ============================================

CREATE OR REPLACE VIEW data_truth_priority_fixes AS
SELECT 
  dar.vehicle_id,
  dar.vehicle_identity,
  dar.vin,
  
  -- Priority level
  CASE 
    WHEN jsonb_array_length(dar.anomalies) > 0 THEN 1
    WHEN (dar.field_analysis->'year'->>'conflict')::BOOLEAN THEN 2
    WHEN (dar.field_analysis->'make'->>'conflict')::BOOLEAN THEN 2
    WHEN (dar.field_analysis->'drivetrain'->>'modification_likely')::BOOLEAN THEN 3
    WHEN dar.completeness_pct < 50 THEN 4
    ELSE 5
  END as priority,
  
  -- Issue type
  CASE 
    WHEN jsonb_array_length(dar.anomalies) > 0 THEN 'CRITICAL_ANOMALY'
    WHEN (dar.field_analysis->'year'->>'conflict')::BOOLEAN THEN 'VIN_YEAR_CONFLICT'
    WHEN (dar.field_analysis->'make'->>'conflict')::BOOLEAN THEN 'VIN_MAKE_CONFLICT'
    WHEN (dar.field_analysis->'drivetrain'->>'modification_likely')::BOOLEAN THEN 'DRIVETRAIN_MODIFICATION'
    WHEN dar.completeness_pct < 50 THEN 'LOW_COMPLETENESS'
    ELSE 'REVIEW'
  END as issue_type,
  
  -- Details
  dar.field_analysis,
  dar.anomalies,
  
  -- Recommended action
  CASE 
    WHEN jsonb_array_length(dar.anomalies) > 0
      THEN 'Manual review required - data inconsistency'
    WHEN (dar.field_analysis->'year'->>'conflict')::BOOLEAN 
      THEN 'Use VIN year (' || (dar.field_analysis->'year'->>'vin_says') || ') - 100% confidence'
    WHEN (dar.field_analysis->'make'->>'conflict')::BOOLEAN 
      THEN 'Use VIN make (' || (dar.field_analysis->'make'->>'vin_says') || ') - 100% confidence'
    WHEN (dar.field_analysis->'drivetrain'->>'modification_likely')::BOOLEAN 
      THEN 'Create timeline event for drivetrain modification'
    WHEN dar.completeness_pct < 50 
      THEN 'Re-scrape from source or decode VIN'
    ELSE 'Low priority - monitor'
  END as recommended_action,
  
  -- Can auto-fix?
  (dar.field_analysis->'year'->>'conflict')::BOOLEAN OR 
  (dar.field_analysis->'make'->>'conflict')::BOOLEAN as auto_fixable

FROM data_truth_audit_report dar
WHERE CASE 
    WHEN jsonb_array_length(dar.anomalies) > 0 THEN 1
    WHEN (dar.field_analysis->'year'->>'conflict')::BOOLEAN THEN 2
    WHEN (dar.field_analysis->'make'->>'conflict')::BOOLEAN THEN 2
    WHEN (dar.field_analysis->'drivetrain'->>'modification_likely')::BOOLEAN THEN 3
    WHEN dar.completeness_pct < 50 THEN 4
    ELSE 5
  END <= 4
ORDER BY priority ASC, dar.completeness_pct ASC;

-- ============================================
-- 5. COMMENTS
-- ============================================

COMMENT ON FUNCTION backfill_evidence_for_vehicle IS 'Retroactively builds evidence trail from existing vehicle data';
COMMENT ON VIEW data_truth_audit_report IS 'Complete data provenance and conflict report for all vehicles';
COMMENT ON VIEW vehicle_field_source_map IS 'Field-level source attribution with evidence trail';
COMMENT ON VIEW data_truth_priority_fixes IS 'Prioritized list of data quality issues with recommended actions';

