-- Fix bug in process_scraped_data_forensically: consensus loop incorrectly used jsonb_array_elements()
-- on an object (v_field_mapping), causing runtime error:
-- "cannot extract elements from an object"

CREATE OR REPLACE FUNCTION public.process_scraped_data_forensically(
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
  SELECT to_jsonb(v.*) INTO v_vehicle_data FROM public.vehicles v WHERE id = p_vehicle_id;
  
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
      v_evidence_result := public.assign_field_forensically(
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
  
  -- Build consensus for all mapped destination fields
  DECLARE
    v_consensus_results JSONB := '[]'::JSONB;
    v_consensus JSONB;
  BEGIN
    -- FIX: v_field_mapping is a JSON object; iterate its values (destination field names).
    FOR v_field IN SELECT value FROM jsonb_each_text(v_field_mapping)
    LOOP
      v_consensus := public.build_field_consensus(
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
    FOR v_anomaly IN SELECT * FROM public.detect_data_anomalies(p_vehicle_id)
    LOOP
      v_anomalies := v_anomalies || jsonb_build_object(
        'field', v_anomaly.field,
        'anomaly', v_anomaly.anomaly,
        'severity', v_anomaly.severity,
        'recommendation', v_anomaly.recommendation
      );
    END LOOP;
    
    RETURN jsonb_build_object(
      'success', true,
      'vehicle_id', p_vehicle_id,
      'evidence_collected', jsonb_array_length(v_evidence_results),
      'evidence_results', v_evidence_results,
      'consensus_results', v_consensus_results,
      'anomalies', v_anomalies,
      'source_trust', v_source_trust,
      'processed_at', NOW()
    );
  END;
END;
$$;


