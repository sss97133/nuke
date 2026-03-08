-- Denormalize image_count and observation_count onto vehicles table
-- These columns are kept in sync by triggers on vehicle_images and vehicle_observations.
-- This eliminates the need for runtime count queries during search (which were unreliable).

-- ============================================================
-- 1. Add denormalized count columns
-- ============================================================
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS image_count integer NOT NULL DEFAULT 0;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS observation_count integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN vehicles.image_count IS 'Denormalized count of non-duplicate images from vehicle_images. Updated by trigger trg_vehicle_images_count.';
COMMENT ON COLUMN vehicles.observation_count IS 'Denormalized count from vehicle_observations. Updated by trigger trg_vehicle_observations_count.';

-- ============================================================
-- 2. Trigger function: update image_count on vehicle_images changes
-- ============================================================
CREATE OR REPLACE FUNCTION update_vehicle_image_count()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
  v_id := COALESCE(NEW.vehicle_id, OLD.vehicle_id);
  UPDATE vehicles SET image_count = (
    SELECT count(*) FROM vehicle_images
    WHERE vehicle_id = v_id AND is_duplicate IS NOT TRUE
  ) WHERE id = v_id;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_vehicle_images_count ON vehicle_images;
CREATE TRIGGER trg_vehicle_images_count
  AFTER INSERT OR DELETE OR UPDATE OF vehicle_id, is_duplicate
  ON vehicle_images
  FOR EACH ROW EXECUTE FUNCTION update_vehicle_image_count();

-- ============================================================
-- 3. Trigger function: update observation_count on vehicle_observations changes
-- ============================================================
CREATE OR REPLACE FUNCTION update_vehicle_observation_count()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
  v_id := COALESCE(NEW.vehicle_id, OLD.vehicle_id);
  UPDATE vehicles SET observation_count = (
    SELECT count(*) FROM vehicle_observations
    WHERE vehicle_id = v_id
  ) WHERE id = v_id;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_vehicle_observations_count ON vehicle_observations;
CREATE TRIGGER trg_vehicle_observations_count
  AFTER INSERT OR DELETE OR UPDATE OF vehicle_id
  ON vehicle_observations
  FOR EACH ROW EXECUTE FUNCTION update_vehicle_observation_count();
