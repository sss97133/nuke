-- AI-Powered Vehicle Valuation Function
-- Uses all available data: AI tags, labor hours, parts, documentation quality

CREATE OR REPLACE FUNCTION calculate_ai_vehicle_valuation(p_vehicle_id UUID)
RETURNS TABLE (
  estimated_value NUMERIC,
  confidence_score NUMERIC,
  base_value NUMERIC,
  parts_value NUMERIC,
  labor_value NUMERIC,
  documentation_bonus NUMERIC,
  condition_adjustment NUMERIC,
  data_sources TEXT[],
  breakdown JSONB
) AS $$
DECLARE
  v_make TEXT;
  v_model TEXT;
  v_year INTEGER;
  v_purchase_price NUMERIC;
  v_current_value NUMERIC;
  v_base_value NUMERIC := 0;
  v_parts_value NUMERIC := 0;
  v_labor_value NUMERIC := 0;
  v_labor_hours NUMERIC := 0;
  v_doc_bonus NUMERIC := 0;
  v_condition_adj NUMERIC := 0;
  v_confidence NUMERIC := 0;
  v_data_sources TEXT[] := ARRAY[]::TEXT[];
  v_image_count INTEGER := 0;
  v_ai_tag_count INTEGER := 0;
  v_part_count INTEGER := 0;
  v_receipt_total NUMERIC := 0;
  v_avg_hourly_rate NUMERIC := 75; -- Standard shop rate
BEGIN
  -- Get vehicle basics
  SELECT make, model, year, purchase_price, current_value
  INTO v_make, v_model, v_year, v_purchase_price, v_current_value
  FROM vehicles
  WHERE id = p_vehicle_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vehicle not found: %', p_vehicle_id;
  END IF;
  
  -- Start with base value (purchase price or current value or market avg)
  v_base_value := COALESCE(v_purchase_price, v_current_value, 0);
  
  IF v_base_value > 0 THEN
    v_data_sources := array_append(v_data_sources, 'Purchase Records');
    v_confidence := 30;
  ELSE
    -- Estimate base value from year/make/model
    -- Simple heuristic: classic trucks appreciate over time
    IF v_year BETWEEN 1960 AND 1990 AND v_make IN ('Chevrolet', 'GMC', 'Ford', 'Dodge') THEN
      v_base_value := 15000 + (1990 - v_year) * 200; -- Older = more valuable for classics
    ELSE
      v_base_value := 10000; -- Default estimate
    END IF;
    v_data_sources := array_append(v_data_sources, 'Market Estimate');
    v_confidence := 20;
  END IF;
  
  -- Calculate labor value from timeline events
  SELECT COALESCE(SUM(labor_hours), 0)
  INTO v_labor_hours
  FROM timeline_events
  WHERE vehicle_id = p_vehicle_id
    AND labor_hours IS NOT NULL
    AND labor_hours > 0;
  
  IF v_labor_hours > 0 THEN
    -- Labor adds value but with depreciation (shop pays $75/hr, but only adds $40/hr to value)
    v_labor_value := v_labor_hours * 40;
    v_data_sources := array_append(v_data_sources, 'Documented Labor');
    v_confidence := v_confidence + 20;
  END IF;
  
  -- Calculate parts value using SYSTEM-BASED approach (not per-part)
  -- This is more accurate for restorations where you're seeing multiple images of the same systems
  WITH system_coverage AS (
    SELECT 
      -- Detect which SYSTEMS have documented work (not individual parts)
      MAX(CASE WHEN metadata->>'category' IN ('engine', 'crate_engine') THEN 1 ELSE 0 END) as has_engine_work,
      MAX(CASE WHEN metadata->>'category' IN ('transmission', 'drivetrain', 'transfer_case') THEN 1 ELSE 0 END) as has_drivetrain_work,
      MAX(CASE WHEN metadata->>'category' IN ('body_panel', 'body', 'paint') THEN 1 ELSE 0 END) as has_body_work,
      MAX(CASE WHEN metadata->>'category' IN ('suspension', 'axle') THEN 1 ELSE 0 END) as has_suspension_work,
      MAX(CASE WHEN metadata->>'category' IN ('brake_system', 'brakes') THEN 1 ELSE 0 END) as has_brake_work,
      MAX(CASE WHEN metadata->>'category' IN ('interior', 'seat') THEN 1 ELSE 0 END) as has_interior_work,
      MAX(CASE WHEN metadata->>'category' IN ('electrical', 'lighting', 'wiring') THEN 1 ELSE 0 END) as has_electrical_work,
      MAX(CASE WHEN metadata->>'category' = 'cooling' THEN 1 ELSE 0 END) as has_cooling_work,
      MAX(CASE WHEN metadata->>'category' = 'fuel_system' THEN 1 ELSE 0 END) as has_fuel_work,
      MAX(CASE WHEN metadata->>'category' = 'exhaust' THEN 1 ELSE 0 END) as has_exhaust_work,
      COUNT(DISTINCT metadata->>'part_number') as unique_part_count,
      AVG(confidence) as avg_confidence
    FROM image_tags
    WHERE vehicle_id = p_vehicle_id
      AND metadata->>'ai_supervised' = 'true'
      AND confidence > 0.7
  )
  SELECT 
    unique_part_count,
    -- Estimate based on DOCUMENTED WORK per system
    -- Most vehicles get REPAIRS not full rebuilds, so values are conservative
    LEAST(  -- Cap total parts value at $25k (realistic for most builds)
      (
        has_engine_work * 2000 +           -- Engine work: $2,000
        has_drivetrain_work * 1500 +       -- Drivetrain work: $1,500
        has_body_work * 3000 +             -- Body/paint work: $3,000
        has_suspension_work * 800 +        -- Suspension: $800
        has_brake_work * 400 +             -- Brakes: $400
        has_interior_work * 1000 +         -- Interior: $1,000
        has_electrical_work * 400 +        -- Electrical: $400
        has_cooling_work * 300 +           -- Cooling: $300
        has_fuel_work * 250 +              -- Fuel: $250
        has_exhaust_work * 500             -- Exhaust: $500
      ) * LEAST(avg_confidence, 0.9),  -- Cap confidence multiplier at 0.9
      25000  -- Absolute cap: $25k parts for most restorations
    )
  INTO v_part_count, v_parts_value
  FROM system_coverage;
  
  IF v_part_count > 0 THEN
    v_data_sources := array_append(v_data_sources, 'AI Part Detection');
    v_confidence := v_confidence + 30;
  END IF;
  
  -- Check for receipts (most accurate)
  SELECT COALESCE(SUM(total_amount), 0)
  INTO v_receipt_total
  FROM receipts
  WHERE scope_type = 'vehicle' 
    AND scope_id::uuid = p_vehicle_id
    AND is_active = true;
  
  IF v_receipt_total > 0 THEN
    -- Receipts are hard evidence, override part estimates with actual spending
    v_parts_value := GREATEST(v_parts_value, v_receipt_total);
    v_data_sources := array_append(v_data_sources, 'Verified Receipts');
    v_confidence := v_confidence + 30;
  END IF;
  
  -- Documentation quality bonus
  SELECT COUNT(*)
  INTO v_image_count
  FROM vehicle_images
  WHERE vehicle_id = p_vehicle_id;
  
  SELECT COUNT(*)
  INTO v_ai_tag_count
  FROM image_tags
  WHERE vehicle_id = p_vehicle_id
    AND metadata->>'ai_supervised' = 'true';
  
  -- High documentation = higher confidence and small value bonus
  IF v_image_count > 50 AND v_ai_tag_count > 100 THEN
    v_doc_bonus := v_base_value * 0.05; -- 5% premium for excellent documentation
    v_data_sources := array_append(v_data_sources, 'Comprehensive Documentation');
    v_confidence := LEAST(v_confidence + 10, 95);
  ELSIF v_image_count > 20 THEN
    v_doc_bonus := v_base_value * 0.02; -- 2% premium for good documentation
    v_confidence := LEAST(v_confidence + 5, 95);
  END IF;
  
  -- Condition assessment from AI tags
  -- Look for rust, damage, restoration indicators
  WITH condition_tags AS (
    SELECT 
      COUNT(*) FILTER (WHERE tag_name ILIKE '%rust%' OR tag_name ILIKE '%corrosion%') as rust_count,
      COUNT(*) FILTER (WHERE tag_name ILIKE '%damage%' OR tag_name ILIKE '%broken%') as damage_count,
      COUNT(*) FILTER (WHERE tag_name ILIKE '%paint%' OR tag_name ILIKE '%restored%' OR tag_name ILIKE '%new%') as restoration_count
    FROM image_tags
    WHERE vehicle_id = p_vehicle_id
  )
  SELECT 
    CASE 
      WHEN rust_count > 10 THEN -v_base_value * 0.15  -- Significant rust = -15%
      WHEN rust_count > 5 THEN -v_base_value * 0.08   -- Some rust = -8%
      WHEN restoration_count > 20 THEN v_base_value * 0.10  -- Fresh restoration = +10%
      ELSE 0
    END
  INTO v_condition_adj
  FROM condition_tags;
  
  -- Cap confidence at 95% (never 100%)
  v_confidence := LEAST(v_confidence, 95);
  
  -- Return results
  RETURN QUERY SELECT 
    (v_base_value + v_parts_value + v_labor_value + v_doc_bonus + v_condition_adj)::NUMERIC as estimated_value,
    v_confidence::NUMERIC as confidence_score,
    v_base_value::NUMERIC as base_value,
    v_parts_value::NUMERIC as parts_value,
    v_labor_value::NUMERIC as labor_value,
    v_doc_bonus::NUMERIC as documentation_bonus,
    v_condition_adj::NUMERIC as condition_adjustment,
    v_data_sources as data_sources,
    jsonb_build_object(
      'base_value', v_base_value,
      'parts_detected', v_part_count,
      'parts_value', v_parts_value,
      'labor_hours', v_labor_hours,
      'labor_value', v_labor_value,
      'labor_rate', v_avg_hourly_rate,
      'receipt_total', v_receipt_total,
      'image_count', v_image_count,
      'ai_tag_count', v_ai_tag_count,
      'documentation_bonus', v_doc_bonus,
      'condition_adjustment', v_condition_adj,
      'confidence', v_confidence,
      'data_sources', v_data_sources
    ) as breakdown;
END;
$$ LANGUAGE plpgsql STABLE;

-- Test the function on the 1977 K5 Blazer
SELECT * FROM calculate_ai_vehicle_valuation('e08bf694-970f-4cbe-8a74-8715158a0f2e');

