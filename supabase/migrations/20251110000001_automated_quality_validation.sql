-- Automated Quality Validation & Self-Repair System
-- Detects incomplete/bad data and triggers automated fixes
-- Goal: Self-healing database that maintains factual accuracy

-- ==========================
-- 1) QUALITY SCORE TRACKING
-- ==========================

CREATE TABLE IF NOT EXISTS vehicle_quality_scores (
  vehicle_id UUID PRIMARY KEY REFERENCES vehicles(id) ON DELETE CASCADE,
  
  -- Completeness checks (YES/NO)
  has_vin BOOLEAN DEFAULT false,
  has_price BOOLEAN DEFAULT false,
  has_images BOOLEAN DEFAULT false,
  has_events BOOLEAN DEFAULT false,
  has_mileage BOOLEAN DEFAULT false,
  
  -- Data counts
  image_count INTEGER DEFAULT 0,
  event_count INTEGER DEFAULT 0,
  bat_image_count INTEGER DEFAULT 0,  -- Original BaT photos
  dropbox_image_count INTEGER DEFAULT 0,  -- Dropbox dumps
  
  -- Quality score (0-100)
  overall_score INTEGER DEFAULT 0 CHECK (overall_score >= 0 AND overall_score <= 100),
  
  -- Issues detected
  issues TEXT[] DEFAULT ARRAY[]::TEXT[],
  
  -- Repair status
  needs_bat_images BOOLEAN DEFAULT false,
  needs_price_backfill BOOLEAN DEFAULT false,
  needs_vin_lookup BOOLEAN DEFAULT false,
  needs_deletion BOOLEAN DEFAULT false,  -- Garbage, should be removed
  
  -- Timestamps
  last_checked_at TIMESTAMPTZ DEFAULT NOW(),
  last_repaired_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quality_scores_needs_repair ON vehicle_quality_scores(overall_score) WHERE overall_score < 60;
CREATE INDEX IF NOT EXISTS idx_quality_scores_needs_images ON vehicle_quality_scores(vehicle_id) WHERE needs_bat_images = true;

COMMENT ON TABLE vehicle_quality_scores IS 'Automated quality tracking - identifies incomplete listings and triggers repairs';

-- ==========================
-- 2) AUTO-CALCULATE QUALITY SCORE
-- ==========================

DROP FUNCTION IF EXISTS calculate_vehicle_quality_score(UUID) CASCADE;
CREATE OR REPLACE FUNCTION calculate_vehicle_quality_score(p_vehicle_id UUID)
RETURNS INTEGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_score INTEGER := 0;
  v_issues TEXT[] := ARRAY[]::TEXT[];
  v_vehicle RECORD;
  v_image_count INTEGER;
  v_event_count INTEGER;
  v_bat_images INTEGER;
  v_dropbox_images INTEGER;
BEGIN
  -- Get vehicle data
  SELECT * INTO v_vehicle FROM vehicles WHERE id = p_vehicle_id;
  
  IF v_vehicle IS NULL THEN
    RETURN 0;
  END IF;
  
  -- Count images
  SELECT COUNT(*) INTO v_image_count 
  FROM vehicle_images WHERE vehicle_id = p_vehicle_id;
  
  SELECT COUNT(*) INTO v_bat_images
  FROM vehicle_images WHERE vehicle_id = p_vehicle_id AND image_url LIKE '%bringatrailer%';
  
  SELECT COUNT(*) INTO v_dropbox_images
  FROM vehicle_images WHERE vehicle_id = p_vehicle_id AND image_url LIKE '%dropbox%';
  
  -- Count events
  SELECT COUNT(*) INTO v_event_count
  FROM timeline_events WHERE vehicle_id = p_vehicle_id;
  
  -- Score based on completeness
  
  -- VIN (20 points)
  IF v_vehicle.vin IS NOT NULL AND LENGTH(v_vehicle.vin) >= 10 AND v_vehicle.vin NOT LIKE 'VIVA-%' THEN
    v_score := v_score + 20;
  ELSE
    v_issues := array_append(v_issues, 'NO_VIN');
  END IF;
  
  -- Price (20 points)
  IF v_vehicle.current_value > 0 OR v_vehicle.sale_price > 0 THEN
    v_score := v_score + 20;
  ELSE
    v_issues := array_append(v_issues, 'NO_PRICE');
  END IF;
  
  -- Images (30 points total)
  IF v_image_count > 0 THEN
    v_score := v_score + 15;
    IF v_image_count >= 5 THEN v_score := v_score + 10; END IF;
    IF v_image_count >= 20 THEN v_score := v_score + 5; END IF;
  ELSE
    v_issues := array_append(v_issues, 'NO_IMAGES');
  END IF;
  
  -- Timeline events (15 points)
  IF v_event_count > 0 THEN
    v_score := v_score + 10;
    IF v_event_count >= 5 THEN v_score := v_score + 5; END IF;
  ELSE
    v_issues := array_append(v_issues, 'NO_EVENTS');
  END IF;
  
  -- Mileage (5 points)
  IF v_vehicle.mileage IS NOT NULL THEN
    v_score := v_score + 5;
  ELSE
    v_issues := array_append(v_issues, 'NO_MILEAGE');
  END IF;
  
  -- Upsert quality record
  INSERT INTO vehicle_quality_scores (
    vehicle_id,
    has_vin,
    has_price,
    has_images,
    has_events,
    has_mileage,
    image_count,
    event_count,
    bat_image_count,
    dropbox_image_count,
    overall_score,
    issues,
    needs_bat_images,
    needs_price_backfill,
    needs_vin_lookup,
    needs_deletion,
    last_checked_at
  ) VALUES (
    p_vehicle_id,
    v_vehicle.vin IS NOT NULL AND LENGTH(v_vehicle.vin) >= 10,
    v_vehicle.current_value > 0 OR v_vehicle.sale_price > 0,
    v_image_count > 0,
    v_event_count > 0,
    v_vehicle.mileage IS NOT NULL,
    v_image_count,
    v_event_count,
    v_bat_images,
    v_dropbox_images,
    v_score,
    v_issues,
    (v_vehicle.vin LIKE 'VIVA-%' AND v_bat_images = 0),  -- BaT import missing original photos
    (v_vehicle.current_value IS NULL OR v_vehicle.current_value = 0) AND v_vehicle.vin LIKE 'VIVA-%',  -- BaT import missing price
    v_vehicle.vin IS NULL OR v_vehicle.vin LIKE 'VIVA-%',  -- Needs real VIN
    v_image_count = 0 AND v_event_count = 0 AND (v_vehicle.current_value IS NULL OR v_vehicle.current_value = 0)  -- Garbage
  )
  ON CONFLICT (vehicle_id) DO UPDATE SET
    has_vin = EXCLUDED.has_vin,
    has_price = EXCLUDED.has_price,
    has_images = EXCLUDED.has_images,
    has_events = EXCLUDED.has_events,
    has_mileage = EXCLUDED.has_mileage,
    image_count = EXCLUDED.image_count,
    event_count = EXCLUDED.event_count,
    bat_image_count = EXCLUDED.bat_image_count,
    dropbox_image_count = EXCLUDED.dropbox_image_count,
    overall_score = EXCLUDED.overall_score,
    issues = EXCLUDED.issues,
    needs_bat_images = EXCLUDED.needs_bat_images,
    needs_price_backfill = EXCLUDED.needs_price_backfill,
    needs_vin_lookup = EXCLUDED.needs_vin_lookup,
    needs_deletion = EXCLUDED.needs_deletion,
    last_checked_at = NOW(),
    updated_at = NOW();
  
  RETURN v_score;
END;
$$;

-- ==========================
-- 3) AUTO-REPAIR TRIGGER
-- ==========================

DROP FUNCTION IF EXISTS trigger_quality_check() CASCADE;
CREATE OR REPLACE FUNCTION trigger_quality_check()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  -- Calculate quality score whenever vehicle data changes
  PERFORM calculate_vehicle_quality_score(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_vehicle_quality_check ON vehicles;
CREATE TRIGGER trg_vehicle_quality_check
  AFTER INSERT OR UPDATE ON vehicles
  FOR EACH ROW
  EXECUTE FUNCTION trigger_quality_check();

-- Also trigger on image/event changes
DROP TRIGGER IF EXISTS trg_image_quality_check ON vehicle_images;
CREATE TRIGGER trg_image_quality_check
  AFTER INSERT OR DELETE ON vehicle_images
  FOR EACH ROW
  EXECUTE FUNCTION trigger_quality_check();

DROP TRIGGER IF EXISTS trg_event_quality_check ON timeline_events;
CREATE TRIGGER trg_event_quality_check
  AFTER INSERT OR DELETE ON timeline_events
  FOR EACH ROW
  EXECUTE FUNCTION trigger_quality_check();

-- ==========================
-- 4) REPAIR QUEUE VIEW
-- ==========================

CREATE OR REPLACE VIEW repair_queue AS
SELECT 
  v.id,
  v.year,
  v.make,
  v.model,
  q.overall_score,
  q.issues,
  q.needs_bat_images,
  q.needs_price_backfill,
  q.needs_vin_lookup,
  q.needs_deletion,
  q.image_count,
  q.bat_image_count,
  q.dropbox_image_count,
  CASE 
    WHEN q.needs_deletion THEN 'DELETE'
    WHEN q.needs_bat_images THEN 'DOWNLOAD_BAT_IMAGES'
    WHEN q.needs_price_backfill THEN 'SYNC_PRICE_FROM_ORG'
    WHEN q.needs_vin_lookup THEN 'LOOKUP_VIN'
    ELSE 'MANUAL_REVIEW'
  END as repair_action,
  CASE
    WHEN q.overall_score < 20 THEN 'CRITICAL'
    WHEN q.overall_score < 40 THEN 'HIGH'
    WHEN q.overall_score < 60 THEN 'MEDIUM'
    ELSE 'LOW'
  END as priority
FROM vehicles v
INNER JOIN vehicle_quality_scores q ON q.vehicle_id = v.id
WHERE q.overall_score < 80
ORDER BY q.overall_score ASC, v.created_at DESC;

COMMENT ON VIEW repair_queue IS 'Automated repair queue - shows what needs fixing and what action to take';

-- ==========================
-- 5) BACKFILL SCORES FOR EXISTING VEHICLES
-- ==========================

-- Calculate quality scores for all existing vehicles
DO $$
DECLARE
  v_id UUID;
BEGIN
  FOR v_id IN SELECT id FROM vehicles LOOP
    PERFORM calculate_vehicle_quality_score(v_id);
  END LOOP;
END $$;

