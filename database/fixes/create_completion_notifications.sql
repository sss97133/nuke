-- Create notifications for incomplete vehicle profiles
-- Only notifies for vehicles below 60% completion threshold

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
INSERT INTO notifications (
  user_id,
  type,
  title,
  message,
  metadata,
  action_url,
  created_at
)
SELECT DISTINCT
  sv.user_id,
  'incomplete_profile' as type,
  CASE 
    WHEN sv.completion_percentage < 30 THEN '🔴 Critical: Complete Your Vehicle Profile'
    WHEN sv.completion_percentage < 50 THEN '🟠 Action Needed: Vehicle Profile Incomplete'
    ELSE '🟡 Improve Your Vehicle Profile'
  END as title,
  'Your ' || sv.year || ' ' || sv.make || ' ' || sv.model || 
  ' is only ' || sv.completion_percentage || '% complete.' ||
  CASE 
    WHEN sv.photo_count = 0 AND array_length(sv.missing_items, 1) > 1 THEN
      ' Add photos and fill in: ' || array_to_string(sv.missing_items[1:3], ', ')
    WHEN sv.photo_count = 0 THEN
      ' Add photos to showcase your vehicle!'
    WHEN array_length(sv.missing_items, 1) > 0 THEN
      ' Missing: ' || array_to_string(sv.missing_items[1:3], ', ')
    ELSE ''
  END ||
  CASE 
    WHEN sv.completion_percentage < 30 THEN ' Complete it to unlock all features and improve visibility.'
    WHEN sv.completion_percentage < 50 THEN ' A complete profile helps preserve your vehicle''s history.'
    ELSE ' Add more details to create a comprehensive record.'
  END as message,
  jsonb_build_object(
    'vehicle_id', sv.id,
    'completion_percentage', sv.completion_percentage,
    'total_score', sv.total_score,
    'missing_items', sv.missing_items,
    'photo_count', sv.photo_count,
    'priority', CASE 
      WHEN sv.completion_percentage < 30 THEN 'critical'
      WHEN sv.completion_percentage < 50 THEN 'high'
      ELSE 'medium'
    END
  ) as metadata,
  '/vehicles/' || sv.id as action_url,
  now() as created_at
FROM scored_vehicles sv
WHERE sv.completion_percentage < 60  -- Only notify if below 60% threshold
  AND NOT EXISTS (  -- Don't create duplicate notifications
    SELECT 1 FROM notifications n 
    WHERE n.user_id = sv.user_id 
      AND n.type = 'incomplete_profile'
      AND n.metadata->>'vehicle_id' = sv.id::text
      AND n.created_at > now() - interval '7 days'  -- Don't spam
  );

-- Show summary of notifications created
WITH summary AS (
  SELECT COUNT(*) as notifications_created
  FROM notifications 
  WHERE type = 'incomplete_profile' 
    AND created_at > now() - interval '1 minute'
)
SELECT 
  notifications_created,
  'Notifications created for vehicles below 60% completion' as description
FROM summary;
