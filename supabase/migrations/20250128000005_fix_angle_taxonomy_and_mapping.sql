-- Fix Angle Taxonomy: Populate proper angles and map weak labels to precise taxonomy
-- This should have been done from the start

BEGIN;

-- Step 1: Populate angle_taxonomy with precise angles (from documented system)
INSERT INTO angle_taxonomy (canonical_key, domain, display_label, side_applicability)
VALUES
  -- EXTERIOR (17 angles)
  ('exterior.front.straight', 'exterior', 'Front straight', 'both'),
  ('exterior.front_quarter.driver', 'exterior', 'Front quarter driver', 'driver'),
  ('exterior.front_quarter.passenger', 'exterior', 'Front quarter passenger', 'passenger'),
  ('exterior.front_three_quarter.driver', 'exterior', 'Front three-quarter driver', 'driver'),
  ('exterior.front_three_quarter.passenger', 'exterior', 'Front three-quarter passenger', 'passenger'),
  ('exterior.rear.straight', 'exterior', 'Rear straight', 'both'),
  ('exterior.rear_quarter.driver', 'exterior', 'Rear quarter driver', 'driver'),
  ('exterior.rear_quarter.passenger', 'exterior', 'Rear quarter passenger', 'passenger'),
  ('exterior.rear_three_quarter.driver', 'exterior', 'Rear three-quarter driver', 'driver'),
  ('exterior.rear_three_quarter.passenger', 'exterior', 'Rear three-quarter passenger', 'passenger'),
  ('exterior.side.driver', 'exterior', 'Side driver', 'driver'),
  ('exterior.side.passenger', 'exterior', 'Side passenger', 'passenger'),
  ('exterior.profile.driver', 'exterior', 'Profile driver', 'driver'),
  ('exterior.profile.passenger', 'exterior', 'Profile passenger', 'passenger'),
  ('exterior.top.overhead', 'exterior', 'Top overhead', 'none'),
  ('exterior.corner.front', 'exterior', 'Front corner', 'both'),
  ('exterior.corner.rear', 'exterior', 'Rear corner', 'both'),
  
  -- ENGINE BAY (10 angles)
  ('engine.bay.full', 'engine', 'Engine bay full', 'both'),
  ('engine.bay.driver_side', 'engine', 'Engine bay driver side', 'driver'),
  ('engine.bay.passenger_side', 'engine', 'Engine bay passenger side', 'passenger'),
  ('engine.bay.front', 'engine', 'Engine bay front', 'both'),
  ('engine.bay.top_down', 'engine', 'Engine bay top down', 'none'),
  ('engine.component.battery', 'engine', 'Battery', 'both'),
  ('engine.component.alternator', 'engine', 'Alternator', 'driver'),
  ('engine.component.radiator', 'engine', 'Radiator', 'front'),
  ('engine.component.air_intake', 'engine', 'Air intake', 'both'),
  ('engine.component.exhaust_manifold', 'engine', 'Exhaust manifold', 'both'),
  ('engine.component.firewall', 'engine', 'Firewall', 'rear'),
  
  -- INTERIOR (14 angles)
  ('interior.dash.full', 'interior', 'Dashboard full', 'both'),
  ('interior.dash.driver', 'interior', 'Dashboard driver', 'driver'),
  ('interior.dash.passenger', 'interior', 'Dashboard passenger', 'passenger'),
  ('interior.console.center', 'interior', 'Center console', 'both'),
  ('interior.steering.wheel', 'interior', 'Steering wheel', 'driver'),
  ('interior.seat.driver', 'interior', 'Driver seat', 'driver'),
  ('interior.seat.passenger', 'interior', 'Passenger seat', 'passenger'),
  ('interior.seat.rear', 'interior', 'Rear seats', 'both'),
  ('interior.ceiling.headliner', 'interior', 'Headliner', 'none'),
  ('interior.floor.carpet', 'interior', 'Floor carpet', 'none'),
  ('interior.door.driver', 'interior', 'Driver door', 'driver'),
  ('interior.door.passenger', 'interior', 'Passenger door', 'passenger'),
  ('interior.door.rear', 'interior', 'Rear door', 'both'),
  ('interior.cargo.area', 'interior', 'Cargo area', 'both'),
  
  -- UNDERCARRIAGE (12 angles)
  ('undercarriage.full.center', 'undercarriage', 'Undercarriage full center', 'none'),
  ('undercarriage.front.center', 'undercarriage', 'Undercarriage front center', 'none'),
  ('undercarriage.rear.center', 'undercarriage', 'Undercarriage rear center', 'none'),
  ('undercarriage.side.driver', 'undercarriage', 'Undercarriage driver side', 'driver'),
  ('undercarriage.side.passenger', 'undercarriage', 'Undercarriage passenger side', 'passenger'),
  ('undercarriage.frame.driver_front', 'undercarriage', 'Frame driver front', 'driver'),
  ('undercarriage.frame.driver_rear', 'undercarriage', 'Frame driver rear', 'driver'),
  ('undercarriage.frame.passenger_front', 'undercarriage', 'Frame passenger front', 'passenger'),
  ('undercarriage.frame.passenger_rear', 'undercarriage', 'Frame passenger rear', 'passenger'),
  ('undercarriage.suspension.front', 'undercarriage', 'Front suspension', 'both'),
  ('undercarriage.suspension.rear', 'undercarriage', 'Rear suspension', 'both'),
  ('undercarriage.exhaust.system', 'undercarriage', 'Exhaust system', 'both'),
  
  -- WHEELS (8 angles)
  ('wheel.well.driver_front', 'wheels', 'Wheel well driver front', 'driver'),
  ('wheel.well.driver_rear', 'wheels', 'Wheel well driver rear', 'driver'),
  ('wheel.well.passenger_front', 'wheels', 'Wheel well passenger front', 'passenger'),
  ('wheel.well.passenger_rear', 'wheels', 'Wheel well passenger rear', 'passenger'),
  ('wheel.tire.closeup', 'wheels', 'Tire closeup', 'both'),
  ('wheel.brake.caliper', 'wheels', 'Brake caliper', 'both'),
  ('wheel.brake.rotor', 'wheels', 'Brake rotor', 'both'),
  ('wheel.assembly.full', 'wheels', 'Wheel assembly full', 'both'),
  
  -- DETAIL (2 angles)
  ('detail.general', 'detail', 'Detail / close-up', 'none'),
  ('work.progress', 'detail', 'Work in progress / repair', 'none')
ON CONFLICT (canonical_key) DO NOTHING;

-- Step 2: Create alias mappings for weak labels → precise taxonomy
INSERT INTO angle_aliases (alias_key, angle_id, taxonomy_version)
SELECT 
  alias,
  at.angle_id,
  'v1_2025_12'
FROM angle_taxonomy at
CROSS JOIN (VALUES
  -- Map weak labels to precise angles
  ('exterior_three_quarter', 'exterior.front_three_quarter.unknown'),
  ('exterior_front_three_quarter', 'exterior.front_three_quarter.unknown'),
  ('front_3quarter', 'exterior.front_three_quarter.unknown'),
  ('front_three_quarter', 'exterior.front_three_quarter.unknown'),
  
  ('exterior', 'exterior.front.straight'), -- Default fallback
  ('exterior_front', 'exterior.front.straight'),
  ('exterior_rear', 'exterior.rear.straight'),
  ('exterior_side', 'exterior.side.driver'), -- Default to driver
  
  ('engine_bay', 'engine.bay.full'),
  ('engine', 'engine.bay.full'),
  
  ('interior_dashboard', 'interior.dash.full'),
  ('interior_front', 'interior.dash.full'),
  ('interior_front_seats', 'interior.seat.driver'),
  
  ('undercarriage', 'undercarriage.full.center'),
  
  ('detail_shot', 'detail.general'),
  ('detail', 'detail.general')
) AS mappings(alias, canonical_key)
WHERE at.canonical_key = mappings.canonical_key
ON CONFLICT (alias_key) DO NOTHING;

-- Step 3: Function to map weak angle to precise taxonomy
CREATE OR REPLACE FUNCTION map_weak_angle_to_taxonomy(weak_angle TEXT)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  precise_angle TEXT;
BEGIN
  -- First try alias mapping
  SELECT at.canonical_key INTO precise_angle
  FROM angle_aliases aa
  JOIN angle_taxonomy at ON aa.angle_id = at.angle_id
  WHERE aa.alias_key = weak_angle
  LIMIT 1;
  
  -- If no alias, check if it's already precise
  IF precise_angle IS NULL THEN
    SELECT canonical_key INTO precise_angle
    FROM angle_taxonomy
    WHERE canonical_key = weak_angle
    LIMIT 1;
  END IF;
  
  -- If still null, return unknown
  RETURN COALESCE(precise_angle, 'unknown');
END;
$$;

-- Step 4: Update vehicle_images with mapped angles (where we can map confidently)
UPDATE vehicle_images
SET 
  ai_detected_angle = map_weak_angle_to_taxonomy(ai_detected_angle),
  angle = map_weak_angle_to_taxonomy(COALESCE(angle, ai_detected_angle))
WHERE ai_detected_angle IS NOT NULL
  AND ai_detected_angle NOT LIKE '%.%'  -- Not already in dot notation
  AND map_weak_angle_to_taxonomy(ai_detected_angle) != 'unknown';

COMMENT ON FUNCTION map_weak_angle_to_taxonomy IS 
  'Maps weak angle labels (exterior_three_quarter) to precise taxonomy (exterior.front_three_quarter.driver)';

COMMIT;

