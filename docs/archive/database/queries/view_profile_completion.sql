-- View Profile Completion Scores
-- This shows the completion percentage for all vehicles

WITH vehicle_completion_scores AS (
  SELECT 
    v.id,
    v.user_id,
    v.year,
    v.make,
    v.model,
    
    -- Core fields (high weight - 10 points each)
    CASE WHEN v.year IS NOT NULL THEN 10 ELSE 0 END +
    CASE WHEN v.make IS NOT NULL AND v.make != '' THEN 10 ELSE 0 END +
    CASE WHEN v.model IS NOT NULL AND v.model != '' THEN 10 ELSE 0 END as core_score,
    
    -- Important fields (medium weight - 5 points each)
    CASE WHEN v.vin IS NOT NULL AND v.vin != '' THEN 5 ELSE 0 END +
    CASE WHEN v.mileage IS NOT NULL THEN 5 ELSE 0 END +
    CASE WHEN v.color IS NOT NULL AND v.color != '' THEN 5 ELSE 0 END +
    CASE WHEN v.transmission IS NOT NULL AND v.transmission != '' THEN 5 ELSE 0 END +
    CASE WHEN v.fuel_type IS NOT NULL AND v.fuel_type != '' THEN 5 ELSE 0 END +
    CASE WHEN v.engine_size IS NOT NULL AND v.engine_size != '' THEN 5 ELSE 0 END as important_score,
    
    -- Nice to have fields (low weight - 2 points each)
    CASE WHEN v.body_style IS NOT NULL AND v.body_style != '' THEN 2 ELSE 0 END +
    CASE WHEN v.drivetrain IS NOT NULL AND v.drivetrain != '' THEN 2 ELSE 0 END +
    CASE WHEN v.doors IS NOT NULL THEN 2 ELSE 0 END +
    CASE WHEN v.seats IS NOT NULL THEN 2 ELSE 0 END +
    CASE WHEN v.horsepower IS NOT NULL THEN 2 ELSE 0 END +
    CASE WHEN v.torque IS NOT NULL THEN 2 ELSE 0 END as optional_score,
    
    -- Financial/ownership (bonus points - 3 each)
    CASE WHEN v.purchase_price IS NOT NULL THEN 3 ELSE 0 END +
    CASE WHEN v.purchase_date IS NOT NULL THEN 3 ELSE 0 END +
    CASE WHEN v.current_value IS NOT NULL THEN 3 ELSE 0 END as financial_score,
    
    -- Photos (critical - 20 points if has photos)
    CASE WHEN (SELECT COUNT(*) FROM vehicle_images WHERE vehicle_id = v.id) > 0 THEN 20 ELSE 0 END as photo_score,
    
    -- List missing important items
    array_remove(ARRAY[
      CASE WHEN v.vin IS NULL OR v.vin = '' THEN 'VIN' END,
      CASE WHEN v.mileage IS NULL THEN 'Mileage' END,
      CASE WHEN v.color IS NULL OR v.color = '' THEN 'Color' END,
      CASE WHEN v.transmission IS NULL OR v.transmission = '' THEN 'Transmission' END,
      CASE WHEN v.fuel_type IS NULL OR v.fuel_type = '' THEN 'Fuel Type' END,
      CASE WHEN v.engine_size IS NULL OR v.engine_size = '' THEN 'Engine' END,
      CASE WHEN (SELECT COUNT(*) FROM vehicle_images WHERE vehicle_id = v.id) = 0 THEN 'Photos' END
    ], NULL) as missing_items,
    
    (SELECT COUNT(*) FROM vehicle_images WHERE vehicle_id = v.id) as photo_count
    
  FROM vehicles v
  WHERE v.user_id IS NOT NULL  -- Only for registered users
),
scored_vehicles AS (
  SELECT 
    *,
    core_score + important_score + optional_score + financial_score + photo_score as total_score,
    -- Calculate percentage
    ROUND(
      ((core_score + important_score + optional_score + financial_score + photo_score)::numeric / 101) * 100
    ) as completion_percentage
  FROM vehicle_completion_scores
)
SELECT 
  year || ' ' || make || ' ' || model as vehicle,
  completion_percentage || '%' as completion,
  CASE 
    WHEN completion_percentage >= 90 THEN '🟢 Excellent'
    WHEN completion_percentage >= 70 THEN '🟡 Good'  
    WHEN completion_percentage >= 50 THEN '🟠 Needs Work'
    ELSE '🔴 Incomplete'
  END as status,
  array_to_string(missing_items, ', ') as missing,
  CASE WHEN photo_count = 0 THEN '❌ No photos!' ELSE photo_count || ' photos' END as photos
FROM scored_vehicles
ORDER BY completion_percentage ASC, total_score ASC;
