-- Diagnostic query to understand WHY a vehicle is valued at $10,988 instead of $149,000
-- Run this with the specific vehicle_id to see all the data feeding into valuation

-- Replace YOUR_VEHICLE_ID with the actual ID
\set vehicle_id 'YOUR_VEHICLE_ID_HERE'

-- 1. Base vehicle pricing data
SELECT 
  id,
  year, make, model, series, trim,
  vin,
  purchase_price,
  current_value,
  sale_price,
  asking_price,
  msrp,
  is_for_sale,
  condition_rating,
  mileage
FROM vehicles 
WHERE id = :'vehicle_id';

-- 2. Receipts (most trusted source)
SELECT 
  COUNT(*) as receipt_count,
  COALESCE(SUM(total), 0) as total_from_receipts
FROM receipts
WHERE scope_type = 'vehicle' 
  AND scope_id = :'vehicle_id';

-- 3. Build investment data
SELECT 
  b.id as build_id,
  b.total_spent,
  b.total_budget,
  COUNT(bli.id) as line_item_count,
  COALESCE(SUM(bli.total_price), 0) as parts_total
FROM vehicle_builds b
LEFT JOIN build_line_items bli ON bli.build_id = b.id
WHERE b.vehicle_id = :'vehicle_id'
GROUP BY b.id, b.total_spent, b.total_budget;

-- 4. Market comparables being used
SELECT 
  'build_benchmarks' as source,
  COUNT(*) as comparable_count,
  AVG(sale_price) as avg_comp_price,
  MIN(sale_price) as min_comp,
  MAX(sale_price) as max_comp
FROM build_benchmarks bb
INNER JOIN vehicles v ON v.id = :'vehicle_id'
WHERE bb.make = v.make 
  AND bb.year = v.year;

-- 5. MarketCheck data (if available)
SELECT 
  source,
  price_value,
  confidence_score,
  created_at
FROM market_data
WHERE vehicle_id = :'vehicle_id'
  AND source IN ('marketcheck', 'marketcheck_history', 'marketcheck_trends')
ORDER BY created_at DESC
LIMIT 5;

-- 6. Vehicle documents with amounts
SELECT 
  document_type,
  title,
  amount,
  vendor_name,
  created_at
FROM vehicle_documents
WHERE vehicle_id = :'vehicle_id'
  AND document_type IN ('receipt', 'invoice', 'estimate', 'appraisal')
  AND amount IS NOT NULL
ORDER BY amount DESC
LIMIT 10;

-- 7. AI condition assessment (can cap valuation)
SELECT 
  confidence,
  condition_score,
  condition_label,
  checklist,
  summary_date,
  -- Check for penalties
  (checklist->>'rolling_state') as rolling_state,
  (checklist->>'engine_present')::boolean as engine_present,
  (checklist->>'frame_visible_damage')::boolean as frame_damage,
  (checklist->>'rust_severity') as rust_severity
FROM profile_image_insights
WHERE vehicle_id = :'vehicle_id'
ORDER BY summary_date DESC
LIMIT 1;

-- 8. AI-extracted part values from images
SELECT 
  COUNT(*) as value_tag_count,
  SUM((it.metadata->>'estimated_value')::numeric) as ai_extracted_value
FROM image_tags it
INNER JOIN vehicle_images vi ON vi.id = it.image_id
WHERE vi.vehicle_id = :'vehicle_id'
  AND it.tag_type IN ('part', 'modification', 'component')
  AND it.metadata->>'estimated_value' IS NOT NULL;

-- 9. Image documentation quality
SELECT 
  COUNT(*) as total_images,
  COUNT(DISTINCT angle) as unique_angles
FROM vehicle_images
WHERE vehicle_id = :'vehicle_id';

-- 10. Price history (what's been recorded before)
SELECT 
  price_type,
  value,
  source,
  confidence,
  as_of
FROM vehicle_price_history
WHERE vehicle_id = :'vehicle_id'
ORDER BY as_of DESC
LIMIT 10;

-- SUMMARY ANALYSIS
-- This will show you exactly which data sources exist and what they're contributing
SELECT 
  CASE 
    WHEN v.purchase_price IS NOT NULL THEN 'HAS purchase_price: $' || v.purchase_price
    WHEN v.current_value IS NOT NULL THEN 'HAS current_value: $' || v.current_value
    WHEN v.msrp IS NOT NULL THEN 'HAS msrp: $' || v.msrp
    ELSE 'NO BASE PRICING DATA - This is likely the problem!'
  END as base_price_status,
  
  CASE 
    WHEN EXISTS(SELECT 1 FROM receipts WHERE scope_type='vehicle' AND scope_id=v.id) 
    THEN 'HAS RECEIPTS (' || (SELECT COUNT(*) FROM receipts WHERE scope_type='vehicle' AND scope_id=v.id) || ')'
    ELSE 'NO RECEIPTS'
  END as receipts_status,
  
  CASE 
    WHEN EXISTS(SELECT 1 FROM vehicle_builds WHERE vehicle_id=v.id AND total_spent > 0)
    THEN 'HAS BUILD DATA ($' || (SELECT total_spent FROM vehicle_builds WHERE vehicle_id=v.id LIMIT 1) || ')'
    ELSE 'NO BUILD DATA'
  END as build_status,
  
  CASE
    WHEN EXISTS(SELECT 1 FROM market_data WHERE vehicle_id=v.id AND source LIKE 'marketcheck%')
    THEN 'HAS MARKETCHECK DATA'
    ELSE 'NO MARKETCHECK DATA'
  END as market_data_status
  
FROM vehicles v
WHERE v.id = :'vehicle_id';

