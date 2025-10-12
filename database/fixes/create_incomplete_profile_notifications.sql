-- Identify incomplete vehicle profiles and create notifications
-- A profile is incomplete if it's missing key fields

-- First, identify what makes a profile incomplete
WITH incomplete_vehicles AS (
  SELECT 
    v.id,
    v.user_id,
    v.year,
    v.make,
    v.model,
    -- Count missing critical fields
    CASE WHEN v.vin IS NULL OR v.vin = '' THEN 1 ELSE 0 END +
    CASE WHEN v.mileage IS NULL THEN 1 ELSE 0 END +
    CASE WHEN v.color IS NULL OR v.color = '' THEN 1 ELSE 0 END +
    CASE WHEN v.engine_size IS NULL OR v.engine_size = '' THEN 1 ELSE 0 END +
    CASE WHEN v.transmission IS NULL OR v.transmission = '' THEN 1 ELSE 0 END +
    CASE WHEN v.fuel_type IS NULL OR v.fuel_type = '' THEN 1 ELSE 0 END +
    CASE WHEN v.body_style IS NULL OR v.body_style = '' THEN 1 ELSE 0 END +
    CASE WHEN v.drivetrain IS NULL OR v.drivetrain = '' THEN 1 ELSE 0 END as missing_count,
    -- List what's missing
    array_remove(ARRAY[
      CASE WHEN v.vin IS NULL OR v.vin = '' THEN 'VIN' END,
      CASE WHEN v.mileage IS NULL THEN 'Mileage' END,
      CASE WHEN v.color IS NULL OR v.color = '' THEN 'Color' END,
      CASE WHEN v.engine_size IS NULL OR v.engine_size = '' THEN 'Engine Size' END,
      CASE WHEN v.transmission IS NULL OR v.transmission = '' THEN 'Transmission' END,
      CASE WHEN v.fuel_type IS NULL OR v.fuel_type = '' THEN 'Fuel Type' END,
      CASE WHEN v.body_style IS NULL OR v.body_style = '' THEN 'Body Style' END,
      CASE WHEN v.drivetrain IS NULL OR v.drivetrain = '' THEN 'Drivetrain' END,
      CASE WHEN v.purchase_price IS NULL THEN 'Purchase Price' END,
      CASE WHEN v.purchase_date IS NULL THEN 'Purchase Date' END
    ], NULL) as missing_fields,
    -- Check image status
    (SELECT COUNT(*) FROM vehicle_images WHERE vehicle_id = v.id) as image_count
  FROM vehicles v
  WHERE v.user_id IS NOT NULL  -- Only for registered users
)
SELECT * FROM incomplete_vehicles 
WHERE missing_count > 0 OR image_count = 0
ORDER BY missing_count DESC;

-- Create notifications for incomplete profiles
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
  iv.user_id,
  'incomplete_profile' as type,
  'Complete Your Vehicle Profile' as title,
  'Your ' || iv.year || ' ' || iv.make || ' ' || iv.model || 
  CASE 
    WHEN iv.image_count = 0 AND array_length(iv.missing_fields, 1) > 0 THEN
      ' needs photos and is missing ' || array_length(iv.missing_fields, 1) || ' important details: ' || 
      array_to_string(iv.missing_fields[1:3], ', ') ||
      CASE WHEN array_length(iv.missing_fields, 1) > 3 THEN ' and more' ELSE '' END
    WHEN iv.image_count = 0 THEN
      ' needs photos to complete its profile'
    ELSE
      ' is missing ' || array_length(iv.missing_fields, 1) || ' important details: ' || 
      array_to_string(iv.missing_fields[1:3], ', ') ||
      CASE WHEN array_length(iv.missing_fields, 1) > 3 THEN ' and more' ELSE '' END
  END || '. Complete it to unlock all features.' as message,
  jsonb_build_object(
    'vehicle_id', iv.id,
    'missing_fields', iv.missing_fields,
    'missing_count', iv.missing_count,
    'has_images', iv.image_count > 0,
    'image_count', iv.image_count,
    'completion_percentage', GREATEST(0, 100 - (iv.missing_count * 10))
  ) as metadata,
  '/vehicle/' || iv.id || '/edit' as action_url,
  now() as created_at
FROM incomplete_vehicles iv
WHERE (iv.missing_count > 2 OR iv.image_count = 0)  -- Only notify if significantly incomplete
  AND NOT EXISTS (  -- Don't create duplicate notifications
    SELECT 1 FROM notifications n 
    WHERE n.user_id = iv.user_id 
      AND n.type = 'incomplete_profile'
      AND n.metadata->>'vehicle_id' = iv.id::text
      AND n.created_at > now() - interval '7 days'  -- Don't spam, only once per week
  );

-- Check what notifications would be created
SELECT 
  v.year || ' ' || v.make || ' ' || v.model as vehicle,
  u.email,
  CASE 
    WHEN COUNT(DISTINCT vi.id) = 0 THEN 'No images'
    ELSE COUNT(DISTINCT vi.id)::text || ' images'
  END as image_status,
  array_remove(ARRAY[
    CASE WHEN v.vin IS NULL OR v.vin = '' THEN 'VIN' END,
    CASE WHEN v.mileage IS NULL THEN 'Mileage' END,
    CASE WHEN v.color IS NULL OR v.color = '' THEN 'Color' END,
    CASE WHEN v.engine_size IS NULL OR v.engine_size = '' THEN 'Engine Size' END,
    CASE WHEN v.transmission IS NULL OR v.transmission = '' THEN 'Transmission' END,
    CASE WHEN v.fuel_type IS NULL OR v.fuel_type = '' THEN 'Fuel Type' END,
    CASE WHEN v.body_style IS NULL OR v.body_style = '' THEN 'Body Style' END,
    CASE WHEN v.drivetrain IS NULL OR v.drivetrain = '' THEN 'Drivetrain' END
  ], NULL) as missing_fields
FROM vehicles v
LEFT JOIN vehicle_images vi ON vi.vehicle_id = v.id
LEFT JOIN auth.users u ON u.id = v.user_id
WHERE v.user_id IS NOT NULL
GROUP BY v.id, v.year, v.make, v.model, v.vin, v.mileage, v.color, 
         v.engine_size, v.transmission, v.fuel_type, v.body_style, v.drivetrain, u.email
HAVING (
  -- Missing critical fields
  (v.vin IS NULL OR v.vin = '') OR
  v.mileage IS NULL OR
  (v.transmission IS NULL OR v.transmission = '') OR
  (v.fuel_type IS NULL OR v.fuel_type = '') OR
  COUNT(DISTINCT vi.id) = 0  -- Or no images
)
ORDER BY COUNT(DISTINCT vi.id), array_length(array_remove(ARRAY[
    CASE WHEN v.vin IS NULL OR v.vin = '' THEN 'VIN' END,
    CASE WHEN v.mileage IS NULL THEN 'Mileage' END,
    CASE WHEN v.transmission IS NULL OR v.transmission = '' THEN 'Transmission' END,
    CASE WHEN v.fuel_type IS NULL OR v.fuel_type = '' THEN 'Fuel Type' END
  ], NULL), 1) DESC NULLS LAST;
