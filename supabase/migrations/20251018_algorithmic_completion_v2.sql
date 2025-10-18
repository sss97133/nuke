-- Algorithmic Vehicle Completion Calculator V2
-- Simplified working version - we'll enhance iteratively

CREATE OR REPLACE FUNCTION calculate_vehicle_completion_algorithmic(p_vehicle_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_record RECORD;
  timeline_score NUMERIC := 0;
  field_score NUMERIC := 0;
  market_score NUMERIC := 0;
  trust_score NUMERIC := 0;
  final_completion NUMERIC;
  event_count INTEGER;
  field_count INTEGER;
  cohort_size INTEGER;
BEGIN
  -- Get vehicle data
  SELECT * INTO v_record FROM vehicles WHERE id = p_vehicle_id;
  
  IF v_record IS NULL THEN
    RETURN jsonb_build_object('completion_percentage', 0, 'error', 'Vehicle not found');
  END IF;
  
  ----------------------------------------
  -- DIMENSION 1: TIMELINE DEPTH (40%)
  ----------------------------------------
  
  -- Count timeline events for this vehicle
  SELECT COUNT(*) INTO event_count
  FROM timeline_events
  WHERE timeline_events.vehicle_id = p_vehicle_id;
  
  -- Simple scoring: 10 events = 100%
  timeline_score := LEAST(100, (event_count::NUMERIC / 10.0) * 100);
  
  ----------------------------------------
  -- DIMENSION 2: FIELD COVERAGE (25%)
  ----------------------------------------
  
  -- Count filled fields
  SELECT (
    (CASE WHEN v_record.year IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN v_record.make IS NOT NULL AND v_record.make != '' THEN 1 ELSE 0 END) +
    (CASE WHEN v_record.model IS NOT NULL AND v_record.model != '' THEN 1 ELSE 0 END) +
    (CASE WHEN v_record.vin IS NOT NULL AND v_record.vin != '' THEN 1 ELSE 0 END) +
    (CASE WHEN v_record.color IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN v_record.transmission IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN v_record.engine_size IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN v_record.mileage IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN v_record.purchase_price IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN v_record.current_value IS NOT NULL THEN 1 ELSE 0 END)
  ) INTO field_count;
  
  -- 10 fields tracked, 10 fields = 100%
  field_score := (field_count::NUMERIC / 10.0) * 100;
  
  ----------------------------------------
  -- DIMENSION 3: MARKET VERIFICATION (20%)
  ----------------------------------------
  
  market_score := (
    (CASE WHEN v_record.vin IS NOT NULL AND v_record.vin != '' THEN 40 ELSE 0 END) +
    (CASE WHEN v_record.bat_auction_url IS NOT NULL THEN 30 ELSE 0 END) +
    (CASE WHEN v_record.purchase_price IS NOT NULL OR v_record.sale_price IS NOT NULL THEN 20 ELSE 0 END) +
    (CASE WHEN v_record.current_value IS NOT NULL THEN 10 ELSE 0 END)
  );
  
  ----------------------------------------
  -- DIMENSION 4: TRUST SCORE (15%)
  ----------------------------------------
  
  -- Start with base trust
  trust_score := 0;
  
  -- Add points for verifications (simplified - no subqueries that might fail)
  IF v_record.vin IS NOT NULL THEN
    trust_score := trust_score + 30;
  END IF;
  
  IF event_count > 5 THEN
    trust_score := trust_score + 40;
  END IF;
  
  IF v_record.created_at < NOW() - INTERVAL '30 days' THEN
    trust_score := trust_score + 30;
  END IF;
  
  trust_score := LEAST(100, trust_score);
  
  ----------------------------------------
  -- FINAL CALCULATION
  ----------------------------------------
  
  final_completion := (
    (timeline_score * 0.40) +
    (field_score * 0.25) +
    (market_score * 0.20) +
    (trust_score * 0.15)
  );
  
  -- Get cohort size
  SELECT COUNT(*) INTO cohort_size
  FROM vehicles
  WHERE make = v_record.make
    AND year BETWEEN (v_record.year - 3) AND (v_record.year + 3);
  
  RETURN jsonb_build_object(
    'completion_percentage', ROUND(final_completion, 1),
    'timeline_score', ROUND(timeline_score, 1),
    'field_score', ROUND(field_score, 1),
    'market_score', ROUND(market_score, 1),
    'trust_score', ROUND(trust_score, 1),
    'cohort_size', cohort_size,
    'event_count', event_count,
    'field_count', field_count
  );
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION calculate_vehicle_completion_algorithmic IS 
'V2: Simplified working version. Timeline (40%), Fields (25%), Market (20%), Trust (15%). Will enhance with cohort comparison next.';

