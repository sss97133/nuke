-- 1983 GMC K2500 (BaT 1983-gmc-k2500-2) — final result vs Nuke estimates and comps
-- Vehicle ID: a90c008a-3379-41d8-9eb2-b4eda365d74c
-- BaT result: Sold for $31,000 on 2/22/26

-- 1) Nuke hammer predictions for this vehicle (if any were run while auction was live)
SELECT
  hp.predicted_at,
  hp.current_bid AS bid_at_prediction,
  hp.hours_remaining,
  hp.time_window,
  hp.comp_median,
  hp.comp_count,
  hp.predicted_hammer,
  hp.predicted_low,
  hp.predicted_high,
  hp.confidence_score,
  hp.bid_velocity,
  hp.buy_recommendation,
  hp.actual_hammer,
  hp.prediction_error_pct,
  hp.prediction_error_usd
FROM hammer_predictions hp
WHERE hp.vehicle_id = 'a90c008a-3379-41d8-9eb2-b4eda365d74c'
ORDER BY hp.predicted_at DESC
LIMIT 10;

-- 2) Vehicle row: nuke_estimate, sale_price, current_value (what the profile uses)
SELECT
  id,
  year,
  make,
  model,
  sale_price,
  winning_bid,
  high_bid,
  asking_price,
  current_value,
  nuke_estimate,
  nuke_estimate_confidence,
  deal_score
FROM vehicles
WHERE id = 'a90c008a-3379-41d8-9eb2-b4eda365d74c';

-- 3) Comps: recent GMC C/K (1973–1991) BaT sold — same logic as predict-hammer-price
-- (make + model first 2 words + year ±5, sold last 12 months)
SELECT
  COUNT(*) AS comp_count,
  ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY el.final_price)::numeric, 0) AS comp_median,
  ROUND(AVG(el.final_price)::numeric, 0) AS comp_avg,
  ROUND(MIN(el.final_price)::numeric, 0) AS comp_min,
  ROUND(MAX(el.final_price)::numeric, 0) AS comp_max
FROM external_listings el
JOIN vehicles v ON v.id = el.vehicle_id
WHERE UPPER(v.make) = 'GMC'
  AND (v.model ILIKE '%C2500%' OR v.model ILIKE '%C/K%' OR v.model ILIKE '%K2500%' OR v.model ILIKE '%Sierra%' OR v.model ILIKE '%K10%' OR v.model ILIKE '%K20%')
  AND v.year BETWEEN 1978 AND 1988
  AND v.is_public = true
  AND el.platform = 'bat'
  AND el.listing_status = 'sold'
  AND el.final_price > 0
  AND el.end_date >= NOW() - INTERVAL '12 months'
  AND LOWER(COALESCE(v.model, '')) NOT SIMILAR TO '%(parts|engine|seats|wheels|door|hood|trunk|bumper|fender|transmission)%';

-- 4) List recent GMC truck comp sales (for context)
SELECT
  v.year,
  v.make,
  v.model,
  el.final_price,
  el.end_date::date
FROM external_listings el
JOIN vehicles v ON v.id = el.vehicle_id
WHERE UPPER(v.make) = 'GMC'
  AND (v.model ILIKE '%C2500%' OR v.model ILIKE '%C/K%' OR v.model ILIKE '%K2500%' OR v.model ILIKE '%Sierra%' OR v.model ILIKE '%K10%' OR v.model ILIKE '%K20%')
  AND v.year BETWEEN 1978 AND 1988
  AND v.is_public = true
  AND el.platform = 'bat'
  AND el.listing_status = 'sold'
  AND el.final_price > 0
  AND el.end_date >= NOW() - INTERVAL '12 months'
ORDER BY el.end_date DESC
LIMIT 20;
