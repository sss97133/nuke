-- User Override System for Organization-Vehicle Links
-- 
-- Key principle: USER DATA ALWAYS WINS
-- - Automation data is preserved (auto_matched_*) for auditing/learning
-- - User overrides (user_confirmed, user_rejected) take priority
-- - System never overwrites user decisions

-- Enhanced organization matching with AI context
CREATE OR REPLACE FUNCTION find_organizations_near_location_v2(
  p_latitude DECIMAL,
  p_longitude DECIMAL,
  p_ai_detected_context TEXT[] DEFAULT NULL,
  p_max_distance_meters INTEGER DEFAULT 500
)
RETURNS TABLE (
  id UUID,
  business_name TEXT,
  distance_meters NUMERIC,
  business_type TEXT,
  base_confidence REAL,
  context_boost REAL,
  final_confidence REAL,
  confidence_reasons TEXT[]
) AS $$
DECLARE
  v_context_keywords TEXT[];
BEGIN
  v_context_keywords := COALESCE(p_ai_detected_context, ARRAY[]::TEXT[]);
  
  RETURN QUERY
  SELECT 
    b.id,
    b.business_name,
    ROUND(
      ST_Distance(
        ST_MakePoint(b.longitude, b.latitude)::geography,
        ST_MakePoint(p_longitude, p_latitude)::geography
      )::NUMERIC,
      2
    ) AS distance_meters,
    b.business_type,
    -- Base confidence from GPS distance
    CASE 
      WHEN ST_Distance(ST_MakePoint(b.longitude, b.latitude)::geography,
                      ST_MakePoint(p_longitude, p_latitude)::geography) <= 50 THEN 0.9
      WHEN ST_Distance(ST_MakePoint(b.longitude, b.latitude)::geography,
                      ST_MakePoint(p_longitude, p_latitude)::geography) <= 100 THEN 0.7
      WHEN ST_Distance(ST_MakePoint(b.longitude, b.latitude)::geography,
                      ST_MakePoint(p_longitude, p_latitude)::geography) <= 200 THEN 0.5
      ELSE 0.3
    END::REAL AS base_confidence,
    -- Context boost
    CASE
      WHEN b.business_type = 'body_shop' AND (
        'paint_booth' = ANY(v_context_keywords) OR 'body_work' = ANY(v_context_keywords) OR
        'paint_work' = ANY(v_context_keywords) OR 'painting' = ANY(v_context_keywords)
      ) THEN 0.4
      WHEN b.business_type = 'restoration_shop' AND (
        'restoration' = ANY(v_context_keywords) OR 'fabrication' = ANY(v_context_keywords)
      ) THEN 0.4
      WHEN b.business_type IN ('garage', 'mechanic') AND (
        'engine_work' = ANY(v_context_keywords) OR 'mechanical' = ANY(v_context_keywords)
      ) THEN 0.4
      WHEN b.business_type = 'performance_shop' AND (
        'performance' = ANY(v_context_keywords) OR 'tuning' = ANY(v_context_keywords)
      ) THEN 0.4
      WHEN array_length(v_context_keywords, 1) > 0 THEN 0.1
      ELSE 0.0
    END::REAL AS context_boost,
    -- Final confidence (capped at 0.95)
    LEAST(0.95, 
      CASE 
        WHEN ST_Distance(ST_MakePoint(b.longitude, b.latitude)::geography,
                        ST_MakePoint(p_longitude, p_latitude)::geography) <= 50 THEN 0.9
        WHEN ST_Distance(ST_MakePoint(b.longitude, b.latitude)::geography,
                        ST_MakePoint(p_longitude, p_latitude)::geography) <= 100 THEN 0.7
        WHEN ST_Distance(ST_MakePoint(b.longitude, b.latitude)::geography,
                        ST_MakePoint(p_longitude, p_latitude)::geography) <= 200 THEN 0.5
        ELSE 0.3
      END +
      CASE
        WHEN b.business_type = 'body_shop' AND (
          'paint_booth' = ANY(v_context_keywords) OR 'body_work' = ANY(v_context_keywords)
        ) THEN 0.4
        WHEN b.business_type = 'restoration_shop' AND (
          'restoration' = ANY(v_context_keywords)
        ) THEN 0.4
        WHEN b.business_type IN ('garage', 'mechanic') AND (
          'engine_work' = ANY(v_context_keywords)
        ) THEN 0.4
        WHEN array_length(v_context_keywords, 1) > 0 THEN 0.1
        ELSE 0.0
      END
    )::REAL AS final_confidence,
    ARRAY_REMOVE(ARRAY[
      'GPS: ' || ROUND(ST_Distance(ST_MakePoint(b.longitude, b.latitude)::geography,
                                   ST_MakePoint(p_longitude, p_latitude)::geography)::NUMERIC, 0)::TEXT || 'm away',
      CASE WHEN b.business_type = 'body_shop' AND 'paint_booth' = ANY(v_context_keywords)
        THEN 'AI detected paint booth' END,
      CASE WHEN b.business_type = 'body_shop' AND 'body_work' = ANY(v_context_keywords)
        THEN 'AI detected body work' END
    ], NULL)::TEXT[] AS confidence_reasons
  FROM businesses b
  WHERE b.latitude IS NOT NULL AND b.longitude IS NOT NULL
    AND ST_DWithin(ST_MakePoint(b.longitude, b.latitude)::geography,
                   ST_MakePoint(p_longitude, p_latitude)::geography, p_max_distance_meters)
  ORDER BY final_confidence DESC, distance_meters ASC;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION find_organizations_near_location_v2(DECIMAL, DECIMAL, TEXT[], INTEGER) TO authenticated;

-- Add user override columns to organization_vehicles
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'organization_vehicles' AND column_name = 'auto_matched_confidence') THEN
    ALTER TABLE organization_vehicles ADD COLUMN auto_matched_confidence REAL;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'organization_vehicles' AND column_name = 'auto_matched_reasons') THEN
    ALTER TABLE organization_vehicles ADD COLUMN auto_matched_reasons TEXT[];
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'organization_vehicles' AND column_name = 'auto_matched_at') THEN
    ALTER TABLE organization_vehicles ADD COLUMN auto_matched_at TIMESTAMPTZ;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'organization_vehicles' AND column_name = 'user_confirmed') THEN
    ALTER TABLE organization_vehicles ADD COLUMN user_confirmed BOOLEAN DEFAULT FALSE;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'organization_vehicles' AND column_name = 'user_confirmed_by') THEN
    ALTER TABLE organization_vehicles ADD COLUMN user_confirmed_by UUID;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'organization_vehicles' AND column_name = 'user_confirmed_at') THEN
    ALTER TABLE organization_vehicles ADD COLUMN user_confirmed_at TIMESTAMPTZ;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'organization_vehicles' AND column_name = 'user_rejected') THEN
    ALTER TABLE organization_vehicles ADD COLUMN user_rejected BOOLEAN DEFAULT FALSE;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'organization_vehicles' AND column_name = 'user_rejected_by') THEN
    ALTER TABLE organization_vehicles ADD COLUMN user_rejected_by UUID;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'organization_vehicles' AND column_name = 'user_rejected_at') THEN
    ALTER TABLE organization_vehicles ADD COLUMN user_rejected_at TIMESTAMPTZ;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'organization_vehicles' AND column_name = 'override_notes') THEN
    ALTER TABLE organization_vehicles ADD COLUMN override_notes TEXT;
  END IF;
END $$;

-- Add user override columns to vehicle_images
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'vehicle_images' AND column_name = 'user_confirmed_vehicle') THEN
    ALTER TABLE vehicle_images ADD COLUMN user_confirmed_vehicle BOOLEAN DEFAULT FALSE;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'vehicle_images' AND column_name = 'user_confirmed_vehicle_by') THEN
    ALTER TABLE vehicle_images ADD COLUMN user_confirmed_vehicle_by UUID;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'vehicle_images' AND column_name = 'user_confirmed_vehicle_at') THEN
    ALTER TABLE vehicle_images ADD COLUMN user_confirmed_vehicle_at TIMESTAMPTZ;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'vehicle_images' AND column_name = 'auto_suggested_vehicle_id') THEN
    ALTER TABLE vehicle_images ADD COLUMN auto_suggested_vehicle_id UUID;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'vehicle_images' AND column_name = 'auto_suggestion_confidence') THEN
    ALTER TABLE vehicle_images ADD COLUMN auto_suggestion_confidence REAL;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'vehicle_images' AND column_name = 'auto_suggestion_reasons') THEN
    ALTER TABLE vehicle_images ADD COLUMN auto_suggestion_reasons TEXT[];
  END IF;
END $$;

