-- Update bulk estimate function with 7-tier deal score spectrum
-- Matches new labels: plus_3, plus_2, plus_1, fair, minus_1, minus_2, minus_3

CREATE OR REPLACE FUNCTION compute_nuke_estimates_bulk(
  p_batch_size INT DEFAULT 10000,
  p_offset INT DEFAULT 0
) RETURNS TABLE(computed INT, errors INT, batch_offset INT) AS $$
DECLARE
  v_computed INT := 0;
  v_errors INT := 0;
BEGIN
  -- Compute estimates using comps-based valuation in pure SQL
  WITH target_vehicles AS (
    -- Vehicles with prices but no estimate yet
    SELECT cvp.vehicle_id, cvp.year, cvp.make, cvp.model, cvp.best_price, cvp.is_sold,
           v.asking_price, v.current_value, v.sale_status, v.sale_date, v.created_at
    FROM clean_vehicle_prices cvp
    JOIN vehicles v ON v.id = cvp.vehicle_id
    LEFT JOIN nuke_estimates ne ON ne.vehicle_id = cvp.vehicle_id
    WHERE cvp.best_price > 0
      AND ne.id IS NULL
    ORDER BY cvp.vehicle_id
    LIMIT p_batch_size OFFSET p_offset
  ),
  -- Compute recency-weighted median from comps for each vehicle
  comp_prices AS (
    SELECT
      tv.vehicle_id,
      tv.year AS v_year,
      tv.make AS v_make,
      tv.model AS v_model,
      tv.best_price AS own_price,
      tv.asking_price,
      tv.current_value,
      tv.sale_status,
      tv.sale_date,
      tv.created_at,
      -- Recency-weighted percentile price from comps
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY comp.best_price) AS median_price,
      COUNT(comp.vehicle_id) AS comp_count,
      -- Count how many signals we have
      (CASE WHEN EXISTS(SELECT 1 FROM comment_discoveries cd WHERE cd.vehicle_id = tv.vehicle_id) THEN 1 ELSE 0 END +
       CASE WHEN EXISTS(SELECT 1 FROM condition_assessments ca WHERE ca.vehicle_id = tv.vehicle_id) THEN 1 ELSE 0 END +
       CASE WHEN EXISTS(SELECT 1 FROM vehicle_production_data vpd
                        WHERE LOWER(vpd.make) = LOWER(tv.make) AND LOWER(vpd.model) = LOWER(tv.model) AND vpd.year = tv.year)
            THEN 1 ELSE 0 END
      ) AS extra_signal_count
    FROM target_vehicles tv
    JOIN clean_vehicle_prices comp
      ON LOWER(comp.make) = LOWER(tv.make)
      AND LOWER(comp.model) LIKE '%' || LOWER(tv.model) || '%'
      AND comp.year BETWEEN tv.year - 3 AND tv.year + 3
      AND comp.best_price > 0
      AND comp.vehicle_id != tv.vehicle_id
    GROUP BY tv.vehicle_id, tv.year, tv.make, tv.model, tv.best_price,
             tv.asking_price, tv.current_value, tv.sale_status, tv.sale_date, tv.created_at
    HAVING COUNT(comp.vehicle_id) >= 1
  ),
  -- Compute the final estimates
  estimates AS (
    SELECT
      cp.vehicle_id,
      cp.median_price AS estimated_value,
      -- Confidence interval based on price tier
      cp.median_price * (1 - CASE
        WHEN cp.median_price < 15000 THEN 0.08
        WHEN cp.median_price < 50000 THEN 0.12
        WHEN cp.median_price < 150000 THEN 0.18
        WHEN cp.median_price < 500000 THEN 0.25
        ELSE 0.35
      END) AS value_low,
      cp.median_price * (1 + CASE
        WHEN cp.median_price < 15000 THEN 0.08
        WHEN cp.median_price < 50000 THEN 0.12
        WHEN cp.median_price < 150000 THEN 0.18
        WHEN cp.median_price < 500000 THEN 0.25
        ELSE 0.35
      END) AS value_high,
      -- Confidence score
      LEAST(100, 30 + cp.extra_signal_count * 8 + LEAST(cp.comp_count, 20) * 1.5 + 10)::INT AS confidence_score,
      -- Price tier
      CASE
        WHEN cp.median_price < 15000 THEN 'budget'
        WHEN cp.median_price < 50000 THEN 'mainstream'
        WHEN cp.median_price < 150000 THEN 'enthusiast'
        WHEN cp.median_price < 500000 THEN 'collector'
        ELSE 'trophy'
      END AS price_tier,
      -- Confidence interval pct
      CASE
        WHEN cp.median_price < 15000 THEN 8.0
        WHEN cp.median_price < 50000 THEN 12.0
        WHEN cp.median_price < 150000 THEN 18.0
        WHEN cp.median_price < 500000 THEN 25.0
        ELSE 35.0
      END AS confidence_interval_pct,
      -- Signal weights (comps only for bulk, rest default)
      jsonb_build_object(
        'comps', jsonb_build_object('weight', 0.40, 'multiplier', 1.0, 'sourceCount', cp.comp_count),
        'condition', jsonb_build_object('weight', 0.15, 'multiplier', 1.0, 'sourceCount', 0),
        'rarity', jsonb_build_object('weight', 0.05, 'multiplier', 1.0, 'sourceCount', 0),
        'sentiment', jsonb_build_object('weight', 0.08, 'multiplier', 1.0, 'sourceCount', 0),
        'bid_curve', jsonb_build_object('weight', 0.10, 'multiplier', 1.0, 'sourceCount', 0),
        'market_trend', jsonb_build_object('weight', 0.10, 'multiplier', 1.0, 'sourceCount', 0),
        'survival', jsonb_build_object('weight', 0.04, 'multiplier', 1.0, 'sourceCount', 0),
        'originality', jsonb_build_object('weight', 0.08, 'multiplier', 1.0, 'sourceCount', 0)
      ) AS signal_weights,
      -- Deal score
      CASE WHEN COALESCE(cp.asking_price, cp.current_value) > 0 THEN
        ROUND(((cp.median_price - COALESCE(cp.asking_price, cp.current_value)) / cp.median_price * 100 *
          CASE
            WHEN cp.created_at > NOW() - INTERVAL '24 hours' THEN 1.0
            WHEN cp.created_at > NOW() - INTERVAL '3 days' THEN 0.95
            WHEN cp.created_at > NOW() - INTERVAL '7 days' THEN 0.85
            WHEN cp.created_at > NOW() - INTERVAL '30 days' THEN 0.50
            ELSE 0.30
          END)::NUMERIC, 2)
      END AS deal_score,
      -- Deal score label (7-tier spectrum)
      CASE
        WHEN COALESCE(cp.asking_price, cp.current_value) IS NULL OR COALESCE(cp.asking_price, cp.current_value) <= 0 THEN NULL
        WHEN ((cp.median_price - COALESCE(cp.asking_price, cp.current_value)) / cp.median_price * 100) >= 25 THEN 'plus_3'
        WHEN ((cp.median_price - COALESCE(cp.asking_price, cp.current_value)) / cp.median_price * 100) >= 15 THEN 'plus_2'
        WHEN ((cp.median_price - COALESCE(cp.asking_price, cp.current_value)) / cp.median_price * 100) >= 5 THEN 'plus_1'
        WHEN ((cp.median_price - COALESCE(cp.asking_price, cp.current_value)) / cp.median_price * 100) >= -5 THEN 'fair'
        WHEN ((cp.median_price - COALESCE(cp.asking_price, cp.current_value)) / cp.median_price * 100) >= -15 THEN 'minus_1'
        WHEN ((cp.median_price - COALESCE(cp.asking_price, cp.current_value)) / cp.median_price * 100) >= -25 THEN 'minus_2'
        ELSE 'minus_3'
      END AS deal_score_label,
      -- Basic heat score
      (CASE WHEN cp.sale_status IN ('live', 'active') THEN 30 ELSE 0 END +
       CASE WHEN cp.sale_date IS NOT NULL AND cp.sale_date > NOW() - INTERVAL '7 days' THEN 25 ELSE 0 END +
       CASE WHEN cp.created_at > NOW() - INTERVAL '48 hours' THEN 5 ELSE 0 END
      )::NUMERIC(5,2) AS heat_score,
      CASE
        WHEN (CASE WHEN cp.sale_status IN ('live', 'active') THEN 30 ELSE 0 END +
              CASE WHEN cp.sale_date IS NOT NULL AND cp.sale_date > NOW() - INTERVAL '7 days' THEN 25 ELSE 0 END +
              CASE WHEN cp.created_at > NOW() - INTERVAL '48 hours' THEN 5 ELSE 0 END) >= 80 THEN 'volcanic'
        WHEN (CASE WHEN cp.sale_status IN ('live', 'active') THEN 30 ELSE 0 END +
              CASE WHEN cp.sale_date IS NOT NULL AND cp.sale_date > NOW() - INTERVAL '7 days' THEN 25 ELSE 0 END +
              CASE WHEN cp.created_at > NOW() - INTERVAL '48 hours' THEN 5 ELSE 0 END) >= 60 THEN 'fire'
        WHEN (CASE WHEN cp.sale_status IN ('live', 'active') THEN 30 ELSE 0 END +
              CASE WHEN cp.sale_date IS NOT NULL AND cp.sale_date > NOW() - INTERVAL '7 days' THEN 25 ELSE 0 END +
              CASE WHEN cp.created_at > NOW() - INTERVAL '48 hours' THEN 5 ELSE 0 END) >= 40 THEN 'hot'
        WHEN (CASE WHEN cp.sale_status IN ('live', 'active') THEN 30 ELSE 0 END +
              CASE WHEN cp.sale_date IS NOT NULL AND cp.sale_date > NOW() - INTERVAL '7 days' THEN 25 ELSE 0 END +
              CASE WHEN cp.created_at > NOW() - INTERVAL '48 hours' THEN 5 ELSE 0 END) >= 20 THEN 'warm'
        ELSE 'cold'
      END AS heat_score_label,
      cp.comp_count AS input_count
    FROM comp_prices cp
  ),
  -- Insert the estimates
  inserted AS (
    INSERT INTO nuke_estimates (
      vehicle_id, estimated_value, value_low, value_high, confidence_score,
      price_tier, confidence_interval_pct, signal_weights,
      deal_score, deal_score_label, heat_score, heat_score_label,
      model_version, input_count, calculated_at, is_stale
    )
    SELECT
      vehicle_id, estimated_value, value_low, value_high, confidence_score,
      price_tier, confidence_interval_pct, signal_weights,
      deal_score, deal_score_label, heat_score, heat_score_label,
      'v1-bulk', input_count, NOW(), false
    FROM estimates
    ON CONFLICT (vehicle_id) DO NOTHING
    RETURNING vehicle_id
  ),
  -- Denormalize to vehicles
  denorm AS (
    UPDATE vehicles v SET
      nuke_estimate = e.estimated_value,
      nuke_estimate_confidence = e.confidence_score,
      deal_score = e.deal_score,
      heat_score = e.heat_score,
      valuation_calculated_at = NOW()
    FROM estimates e
    WHERE v.id = e.vehicle_id
      AND e.vehicle_id IN (SELECT vehicle_id FROM inserted)
  )
  SELECT COUNT(*) INTO v_computed FROM inserted;

  RETURN QUERY SELECT v_computed, v_errors, p_offset;
END;
$$ LANGUAGE plpgsql;

-- Grant execute to service role
GRANT EXECUTE ON FUNCTION compute_nuke_estimates_bulk TO service_role;
