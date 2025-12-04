-- ============================================
-- FORENSIC SYSTEM INTEGRATION FUNCTIONS
-- ============================================
-- Functions to integrate forensic system with scrapers and edge functions

-- ============================================
-- 1. PROCESS SCRAPED DATA THROUGH FORENSIC SYSTEM
-- ============================================
-- Takes scraped data and processes each field through forensic analysis

CREATE OR REPLACE FUNCTION process_scraped_data_forensically(
  p_vehicle_id UUID,
  p_scraped_data JSONB,
  p_source_url TEXT,
  p_scraper_name TEXT DEFAULT 'scrape-vehicle',
  p_context JSONB DEFAULT '{}'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_field TEXT;
  v_value TEXT;
  v_field_mapping JSONB := '{
    "vin": "vin",
    "year": "year",
    "make": "make",
    "model": "model",
    "drivetrain": "drivetrain",
    "transmission": "transmission",
    "engine_type": "engine_type",
    "engine_size": "engine_size",
    "engine_liters": "engine_liters",
    "series": "series",
    "trim": "trim",
    "exterior_color": "exterior_color",
    "color": "color",
    "mileage": "mileage",
    "body_style": "body_style"
  }'::JSONB;
  
  v_evidence_results JSONB := '[]'::JSONB;
  v_evidence_result JSONB;
  v_source_trust TEXT;
  v_vehicle_data JSONB;
BEGIN
  -- Get vehicle data for cross-validation
  SELECT to_jsonb(v.*) INTO v_vehicle_data FROM vehicles v WHERE id = p_vehicle_id;
  
  -- Determine source trust level based on scraper
  v_source_trust := CASE p_scraper_name
    WHEN 'scrape-bat' THEN 'auction_result_bat'
    WHEN 'scrape-ksl' THEN 'scraped_listing'
    WHEN 'scrape-craigslist' THEN 'scraped_listing'
    WHEN 'scrape-gm-heritage' THEN 'gm_heritage_center'
    ELSE 'scraped_listing'
  END;
  
  -- Process each field in scraped data
  FOR v_field, v_value IN SELECT * FROM jsonb_each_text(p_scraped_data)
  LOOP
    -- Skip if not in our field mapping
    IF NOT (v_field_mapping ? v_field) THEN
      CONTINUE;
    END IF;
    
    -- Skip null/empty values
    IF v_value IS NULL OR v_value = '' THEN
      CONTINUE;
    END IF;
    
    -- Get context for this field (if provided)
    DECLARE
      v_field_context TEXT := COALESCE((p_context->>v_field)::TEXT, NULL);
    BEGIN
      -- Process through forensic system
      v_evidence_result := assign_field_forensically(
        p_vehicle_id,
        v_field_mapping->>v_field,
        v_value,
        v_field_context,
        v_source_trust,
        v_vehicle_data
      );
      
      v_evidence_results := v_evidence_results || v_evidence_result;
    END;
  END LOOP;
  
  -- Build consensus for all fields
  DECLARE
    v_consensus_results JSONB := '[]'::JSONB;
    v_consensus JSONB;
  BEGIN
    FOR v_field IN SELECT jsonb_array_elements(v_field_mapping)::TEXT
    LOOP
      v_consensus := build_field_consensus(
        p_vehicle_id,
        v_field,
        true -- auto-assign if high confidence
      );
      
      v_consensus_results := v_consensus_results || v_consensus;
    END LOOP;
  END;
  
  -- Check for anomalies
  DECLARE
    v_anomalies JSONB := '[]'::JSONB;
    v_anomaly RECORD;
  BEGIN
    FOR v_anomaly IN SELECT * FROM detect_data_anomalies(p_vehicle_id)
    LOOP
      v_anomalies := v_anomalies || jsonb_build_object(
        'field', v_anomaly.field,
        'anomaly', v_anomaly.anomaly,
        'severity', v_anomaly.severity,
        'recommendation', v_anomaly.recommendation
      );
    END LOOP;
  END;
  
  RETURN jsonb_build_object(
    'vehicle_id', p_vehicle_id,
    'evidence_collected', jsonb_array_length(v_evidence_results),
    'evidence', v_evidence_results,
    'consensus_built', true,
    'anomalies_detected', jsonb_array_length(v_anomalies),
    'anomalies', v_anomalies,
    'source_url', p_source_url,
    'scraper', p_scraper_name
  );
END;
$$;

-- ============================================
-- 2. SMART FIELD UPDATE WITH FORENSIC ANALYSIS
-- ============================================
-- Updates a vehicle field using forensic system instead of direct update

CREATE OR REPLACE FUNCTION update_vehicle_field_forensically(
  p_vehicle_id UUID,
  p_field_name TEXT,
  p_new_value TEXT,
  p_source TEXT DEFAULT 'user_input_unverified',
  p_context TEXT DEFAULT NULL,
  p_auto_assign BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_evidence JSONB;
  v_consensus JSONB;
  v_modification_check JSONB;
  v_current_value TEXT;
  v_updated BOOLEAN := false;
BEGIN
  -- Get current value
  EXECUTE format('SELECT %I::TEXT FROM vehicles WHERE id = $1', p_field_name)
  INTO v_current_value
  USING p_vehicle_id;
  
  -- Skip if value unchanged
  IF v_current_value = p_new_value THEN
    RETURN jsonb_build_object(
      'field', p_field_name,
      'status', 'unchanged',
      'value', p_new_value
    );
  END IF;
  
  -- Check for modification (if VIN data exists)
  v_modification_check := detect_modification(p_vehicle_id, p_field_name, p_new_value, p_source);
  
  -- Collect evidence
  v_evidence := assign_field_forensically(
    p_vehicle_id,
    p_field_name,
    p_new_value,
    p_context,
    p_source
  );
  
  -- Build consensus
  v_consensus := build_field_consensus(p_vehicle_id, p_field_name, p_auto_assign);
  
  -- If auto-assign and consensus is strong, update vehicle
  IF p_auto_assign AND (v_consensus->>'action') = 'use_consensus' 
     AND ((v_consensus->>'consensus_confidence')::INTEGER >= 70) THEN
    EXECUTE format('UPDATE vehicles SET %I = $1 WHERE id = $2', p_field_name)
    USING p_new_value, p_vehicle_id;
    v_updated := true;
  END IF;
  
  -- If modification detected, suggest timeline event
  IF (v_modification_check->>'is_modification')::BOOLEAN THEN
    -- Log modification suggestion
    INSERT INTO field_evidence (
      vehicle_id,
      field_name,
      proposed_value,
      source_type,
      source_confidence,
      supporting_signals,
      status,
      assigned_by
    ) VALUES (
      p_vehicle_id,
      p_field_name || '_modification',
      p_new_value,
      'modification_detected',
      95,
      v_modification_check,
      'pending',
      'modification_detector'
    );
  END IF;
  
  RETURN jsonb_build_object(
    'field', p_field_name,
    'value', p_new_value,
    'updated', v_updated,
    'evidence', v_evidence,
    'consensus', v_consensus,
    'modification_detected', (v_modification_check->>'is_modification')::BOOLEAN,
    'modification_info', v_modification_check
  );
END;
$$;

-- ============================================
-- 3. BATCH FORENSIC PROCESSING
-- ============================================
-- Process multiple vehicles through forensic system

CREATE OR REPLACE FUNCTION batch_forensic_analysis(
  p_vehicle_ids UUID[],
  p_auto_assign BOOLEAN DEFAULT false
)
RETURNS TABLE (
  vehicle_id UUID,
  fields_analyzed INTEGER,
  conflicts_found INTEGER,
  anomalies_found INTEGER,
  low_confidence_fields INTEGER,
  summary JSONB
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_id UUID;
  v_field TEXT;
  v_consensus JSONB;
  v_anomalies JSONB;
  v_fields_analyzed INTEGER;
  v_conflicts INTEGER;
  v_anomalies_count INTEGER;
  v_low_confidence INTEGER;
BEGIN
  FOR v_id IN SELECT unnest(p_vehicle_ids)
  LOOP
    v_fields_analyzed := 0;
    v_conflicts := 0;
    v_anomalies_count := 0;
    v_low_confidence := 0;
    
    -- Analyze each field
    FOR v_field IN SELECT unnest(ARRAY['vin', 'year', 'make', 'model', 'drivetrain', 'transmission', 'engine_type', 'series', 'trim'])
    LOOP
      v_consensus := build_field_consensus(v_id, v_field, p_auto_assign);
      v_fields_analyzed := v_fields_analyzed + 1;
      
      IF (v_consensus->>'action') = 'flag_for_review' THEN
        v_conflicts := v_conflicts + 1;
      END IF;
      
      IF ((v_consensus->>'consensus_confidence')::INTEGER < 70) THEN
        v_low_confidence := v_low_confidence + 1;
      END IF;
    END LOOP;
    
    -- Check anomalies
    SELECT jsonb_agg(
      jsonb_build_object(
        'field', field,
        'anomaly', anomaly,
        'severity', severity
      )
    ) INTO v_anomalies
    FROM detect_data_anomalies(v_id);
    
    v_anomalies_count := COALESCE(jsonb_array_length(v_anomalies), 0);
    
    RETURN QUERY SELECT
      v_id,
      v_fields_analyzed,
      v_conflicts,
      v_anomalies_count,
      v_low_confidence,
      jsonb_build_object(
        'fields_analyzed', v_fields_analyzed,
        'conflicts', v_conflicts,
        'anomalies', v_anomalies,
        'low_confidence_fields', v_low_confidence
      );
  END LOOP;
END;
$$;

-- ============================================
-- 4. FORENSIC ENRICHMENT PIPELINE
-- ============================================
-- Complete pipeline: collect evidence → build consensus → detect anomalies → assign

CREATE OR REPLACE FUNCTION forensic_enrichment_pipeline(
  p_vehicle_id UUID,
  p_data_sources JSONB DEFAULT '[]'::JSONB -- Array of {source_type, data, context}
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_source JSONB;
  v_result JSONB;
  v_all_results JSONB := '[]'::JSONB;
  v_final_consensus JSONB := '{}'::JSONB;
  v_anomalies JSONB := '[]'::JSONB;
BEGIN
  -- Step 1: Collect evidence from all sources
  FOR v_source IN SELECT * FROM jsonb_array_elements(p_data_sources)
  LOOP
    v_result := process_scraped_data_forensically(
      p_vehicle_id,
      v_source->'data',
      COALESCE((v_source->>'source_url')::TEXT, 'unknown'),
      COALESCE((v_source->>'scraper')::TEXT, 'unknown'),
      COALESCE(v_source->'context', '{}'::JSONB)
    );
    
    v_all_results := v_all_results || v_result;
  END LOOP;
  
  -- Step 2: Build consensus for all fields
  DECLARE
    v_field TEXT;
    v_consensus JSONB;
  BEGIN
    FOR v_field IN SELECT unnest(ARRAY['vin', 'year', 'make', 'model', 'drivetrain', 'transmission', 'engine_type', 'series', 'trim'])
    LOOP
      v_consensus := build_field_consensus(p_vehicle_id, v_field, true);
      v_final_consensus := v_final_consensus || jsonb_build_object(v_field, v_consensus);
    END LOOP;
  END;
  
  -- Step 3: Detect anomalies
  SELECT jsonb_agg(
    jsonb_build_object(
      'field', field,
      'anomaly', anomaly,
      'severity', severity,
      'recommendation', recommendation
    )
  ) INTO v_anomalies
  FROM detect_data_anomalies(p_vehicle_id);
  
  -- Step 4: Return comprehensive report
  RETURN jsonb_build_object(
    'vehicle_id', p_vehicle_id,
    'sources_processed', jsonb_array_length(p_data_sources),
    'evidence_collected', v_all_results,
    'consensus', v_final_consensus,
    'anomalies', COALESCE(v_anomalies, '[]'::JSONB),
    'anomalies_count', COALESCE(jsonb_array_length(v_anomalies), 0),
    'status', CASE
      WHEN COALESCE(jsonb_array_length(v_anomalies), 0) > 0 THEN 'anomalies_detected'
      ELSE 'complete'
    END
  );
END;
$$;

-- ============================================
-- 5. COMMENTS
-- ============================================

COMMENT ON FUNCTION process_scraped_data_forensically IS 'Processes scraped data through forensic system - collects evidence, builds consensus, detects anomalies';
COMMENT ON FUNCTION update_vehicle_field_forensically IS 'Updates a vehicle field using forensic analysis instead of direct update';
COMMENT ON FUNCTION batch_forensic_analysis IS 'Batch processes multiple vehicles through forensic system';
COMMENT ON FUNCTION forensic_enrichment_pipeline IS 'Complete forensic enrichment pipeline: collect → consensus → anomalies → assign';

