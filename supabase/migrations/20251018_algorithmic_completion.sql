-- Algorithmic Vehicle Completion Calculator
-- 
-- Calculates completion percentage based on 4 dimensions:
-- 1. Timeline Depth (40%) - PRIMARY - what people are DOING
-- 2. Field Coverage (25%) - relative to similar vehicles
-- 3. Market Verification (20%) - external validation
-- 4. Trust Score (15%) - documents + consensus + virality
--
-- Score is RELATIVE and IN FLUX - changes as:
-- - More vehicles added to DB
-- - Better documentation emerges
-- - Market data updates
-- - Timeline events accumulate

CREATE OR REPLACE FUNCTION calculate_vehicle_completion_algorithmic(p_vehicle_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_data RECORD;
  
  -- Dimension scores
  timeline_score NUMERIC := 0;
  field_score NUMERIC := 0;
  market_score NUMERIC := 0;
  trust_score NUMERIC := 0;
  
  final_completion NUMERIC;
  cohort_size INTEGER := 0;
  cohort_rank INTEGER := 0;
BEGIN
  -- Get this vehicle's data
  SELECT * INTO v_data FROM vehicles WHERE id = p_vehicle_id;
  
  IF v_data IS NULL THEN
    RETURN jsonb_build_object(
      'completion_percentage', 0,
      'error', 'Vehicle not found'
    );
  END IF;
  
  ----------------------------------------
  -- DIMENSION 1: TIMELINE DEPTH (40%)
  -- Measures: Documentation quality through timeline events
  ----------------------------------------
  
  WITH this_timeline AS (
    SELECT 
      COUNT(*) as event_count,
      COUNT(DISTINCT DATE(event_date)) as unique_days,
      COUNT(*) FILTER (WHERE image_urls IS NOT NULL AND array_length(image_urls, 1) > 0) as events_with_photos,
      COUNT(*) FILTER (WHERE metadata->>'parts_cost' IS NOT NULL OR metadata->>'labor_cost' IS NOT NULL) as events_with_costs,
      COUNT(*) FILTER (WHERE source = 'professional_shop') as professional_events,
      COALESCE(EXTRACT(DAY FROM (MAX(event_date)::timestamp - MIN(event_date)::timestamp))::INTEGER, 0) as timeline_span_days
    FROM timeline_events
    WHERE vehicle_id = p_vehicle_id
  ),
  cohort_timeline AS (
    SELECT 
      COALESCE(AVG(event_count), 0) as avg_events,
      COALESCE(AVG(unique_days), 0) as avg_days,
      COALESCE(AVG(events_with_photos), 0) as avg_with_photos
    FROM (
      SELECT 
        te.vehicle_id,
        COUNT(*) as event_count,
        COUNT(DISTINCT DATE(te.event_date)) as unique_days,
        COUNT(*) FILTER (WHERE te.image_urls IS NOT NULL AND array_length(te.image_urls, 1) > 0) as events_with_photos
      FROM timeline_events te
      JOIN vehicles v ON te.vehicle_id = v.id
      WHERE v.make = v_data.make
        AND v.year BETWEEN (v_data.year - 3) AND (v_data.year + 3)
        AND te.vehicle_id != p_vehicle_id
      GROUP BY te.vehicle_id
      HAVING COUNT(*) > 0
    ) cohort
  ),
  timeline_calc AS (
    SELECT
      CASE
        WHEN (SELECT avg_events FROM cohort_timeline) > 0 THEN
          LEAST(100, (
            (
              (tt.event_count::NUMERIC / NULLIF((SELECT avg_events FROM cohort_timeline), 0)) * 30 +
              (tt.events_with_photos::NUMERIC / NULLIF((SELECT avg_with_photos FROM cohort_timeline), 0)) * 40 +
              (tt.timeline_span_days::NUMERIC / 365.0) * 30
            ) / 1.0
          ) * 100)
        ELSE
          LEAST(100, (
            tt.event_count * 3 +
            tt.events_with_photos * 5 +
            tt.professional_events * 10
          ))
      END as score
    FROM this_timeline tt
  )
  SELECT score INTO timeline_score FROM timeline_calc;
  
  ----------------------------------------
  -- DIMENSION 2: FIELD COVERAGE (25%)
  -- Relative to similar vehicles in DB
  ----------------------------------------
  
  -- Calculate field coverage
  WITH this_fields AS (
    SELECT (
      (CASE WHEN year IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN make IS NOT NULL AND make != '' THEN 1 ELSE 0 END) +
      (CASE WHEN model IS NOT NULL AND model != '' THEN 1 ELSE 0 END) +
      (CASE WHEN vin IS NOT NULL AND vin != '' THEN 1 ELSE 0 END) +
      (CASE WHEN color IS NOT NULL AND color != '' THEN 1 ELSE 0 END) +
      (CASE WHEN transmission IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN engine_size IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN fuel_type IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN mileage IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN purchase_price IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN purchase_date IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN body_style IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN horsepower IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN torque IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN drivetrain IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN current_value IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN condition_rating IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN doors IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN seats IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN weight_lbs IS NOT NULL THEN 1 ELSE 0 END)
    ) AS filled_count
    FROM vehicles
    WHERE id = p_vehicle_id
  ),
  cohort_fields AS (
    SELECT AVG(field_count) as avg_fields, COUNT(*) as cohort_count
    FROM (
      SELECT (
        (CASE WHEN year IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN make IS NOT NULL AND make != '' THEN 1 ELSE 0 END) +
        (CASE WHEN model IS NOT NULL AND model != '' THEN 1 ELSE 0 END) +
        (CASE WHEN vin IS NOT NULL AND vin != '' THEN 1 ELSE 0 END) +
        (CASE WHEN color IS NOT NULL AND color != '' THEN 1 ELSE 0 END) +
        (CASE WHEN transmission IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN engine_size IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN fuel_type IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN mileage IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN purchase_price IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN purchase_date IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN body_style IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN horsepower IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN torque IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN drivetrain IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN current_value IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN condition_rating IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN doors IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN seats IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN weight_lbs IS NOT NULL THEN 1 ELSE 0 END)
      ) AS field_count
      FROM vehicles
      WHERE make = v_data.make
        AND year BETWEEN (v_data.year - 3) AND (v_data.year + 3)
        AND id != p_vehicle_id
    ) cohort
  ),
  field_calc AS (
    SELECT 
      tf.filled_count,
      cf.avg_fields,
      cf.cohort_count,
      CASE
        WHEN cf.avg_fields > 0 THEN
          LEAST(100, (tf.filled_count::NUMERIC / NULLIF(cf.avg_fields, 0)) * 100)
        ELSE
          (tf.filled_count::NUMERIC / 20.0) * 100
      END as score
    FROM this_fields tf, cohort_fields cf
  )
  SELECT score, cohort_count INTO field_score, cohort_size FROM field_calc;
  
  ----------------------------------------
  -- DIMENSION 3: MARKET VERIFICATION (20%)
  -- Can we verify this vehicle externally?
  ----------------------------------------
  
  SELECT (
    -- Has VIN (can query NHTSA)
    (CASE WHEN v_data.vin IS NOT NULL AND v_data.vin != '' THEN 40 ELSE 0 END) +
    
    -- Has BAT auction data (market comp exists)
    (CASE WHEN v_data.bat_auction_url IS NOT NULL THEN 30 ELSE 0 END) +
    
    -- Has sale/purchase price (market anchor point)
    (CASE WHEN v_data.purchase_price IS NOT NULL OR v_data.sale_price IS NOT NULL THEN 20 ELSE 0 END) +
    
    -- Has current_value (appraised/estimated)
    (CASE WHEN v_data.current_value IS NOT NULL THEN 10 ELSE 0 END)
  ) INTO market_score;
  
  ----------------------------------------
  -- DIMENSION 4: TRUST SCORE (15%)
  -- Documents + Consensus + Virality
  ----------------------------------------
  
  WITH trust_indicators AS (
    SELECT 
      -- Title document scanned
      (CASE WHEN EXISTS (
        SELECT 1 FROM vehicle_documents 
        WHERE vehicle_id = p_vehicle_id AND document_type = 'title'
      ) THEN 30 ELSE 0 END) +
      
      -- Ownership verified
      (CASE WHEN EXISTS (
        SELECT 1 FROM ownership_verifications 
        WHERE vehicle_id = p_vehicle_id AND status = 'approved'
      ) THEN 25 ELSE 0 END) +
      
      -- Multiple contributors (consensus)
      (CASE WHEN (
        SELECT COUNT(DISTINCT user_id) 
        FROM user_contributions 
        WHERE vehicle_id = p_vehicle_id
      ) >= 3 THEN 20 ELSE 
        (SELECT COUNT(DISTINCT user_id) FROM user_contributions WHERE vehicle_id = p_vehicle_id) * 6
      END) +
      
      -- Professional shop events
      (CASE WHEN (
        SELECT COUNT(*) 
        FROM timeline_events
        WHERE vehicle_id = p_vehicle_id AND source = 'professional_shop'
      ) > 0 THEN 15 ELSE 0 END) +
      
      -- Engagement/virality (views, comments)
      (LEAST(10, (
        SELECT COALESCE(COUNT(*), 0) / 50
        FROM vehicle_views
        WHERE vehicle_id = p_vehicle_id
      ))) +
      
      -- Time in system (aged documentation)
      (LEAST(10, EXTRACT(MONTH FROM AGE(NOW(), v_data.created_at))::INTEGER))
      
    AS total_trust
  )
  SELECT total_trust INTO trust_score FROM trust_indicators;
  
  ----------------------------------------
  -- FINAL CALCULATION: WEIGHTED AVERAGE
  ----------------------------------------
  
  SELECT 
    (
      (timeline_score * 0.40) +      -- 40% weight - PRIMARY (what people DO)
      (field_score * 0.25) +          -- 25% weight
      (market_score * 0.20) +         -- 20% weight
      (trust_score * 0.15)            -- 15% weight
    ) INTO final_completion;
  
  -- Calculate cohort rank
  SELECT COUNT(*) + 1 INTO cohort_rank
  FROM vehicles v
  WHERE v.make = v_data.make
    AND v.year BETWEEN (v_data.year - 3) AND (v_data.year + 3)
    AND v.completion_percentage > final_completion;
  
  RETURN jsonb_build_object(
    'completion_percentage', ROUND(final_completion, 1),
    'timeline_score', ROUND(timeline_score, 1),
    'field_score', ROUND(field_score, 1),
    'market_score', ROUND(market_score, 1),
    'trust_score', ROUND(trust_score, 1),
    'cohort_size', cohort_size,
    'cohort_rank', cohort_rank,
    'rank_percentile', CASE 
      WHEN cohort_size > 0 THEN ROUND((1.0 - (cohort_rank::NUMERIC / cohort_size)) * 100, 1)
      ELSE NULL
    END
  );
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION calculate_vehicle_completion_algorithmic IS 
'Calculates vehicle completion using algorithmic approach: timeline-first (40%), relative to cohort, market-aware. Score is always in flux.';

-- Create trigger to auto-update completion_percentage on vehicle changes
CREATE OR REPLACE FUNCTION update_vehicle_completion()
RETURNS TRIGGER AS $$
DECLARE
  completion_data JSONB;
BEGIN
  -- Calculate new completion
  completion_data := calculate_vehicle_completion_algorithmic(NEW.id);
  
  -- Update the completion_percentage field
  NEW.completion_percentage := (completion_data->>'completion_percentage')::INTEGER;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to vehicles table
DROP TRIGGER IF EXISTS trigger_update_completion ON vehicles;
CREATE TRIGGER trigger_update_completion
  BEFORE INSERT OR UPDATE ON vehicles
  FOR EACH ROW
  EXECUTE FUNCTION update_vehicle_completion();

-- Create function to recalculate all vehicles in a cohort (batch job)
CREATE OR REPLACE FUNCTION recalculate_cohort_completion(p_make TEXT, p_year_min INTEGER, p_year_max INTEGER)
RETURNS TABLE(vehicle_id UUID, old_completion INTEGER, new_completion NUMERIC, change NUMERIC) AS $$
BEGIN
  RETURN QUERY
  WITH updates AS (
    SELECT 
      v.id,
      v.completion_percentage as old_pct,
      (calculate_vehicle_completion_algorithmic(v.id)->>'completion_percentage')::NUMERIC as new_pct
    FROM vehicles v
    WHERE v.make = p_make
      AND v.year BETWEEN p_year_min AND p_year_max
  )
  SELECT 
    u.id,
    u.old_pct,
    u.new_pct,
    (u.new_pct - u.old_pct) as change
  FROM updates u
  ORDER BY change DESC;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION recalculate_cohort_completion IS 
'Batch recalculate completion for vehicle cohort. Run when significant new data added to shift averages.';

