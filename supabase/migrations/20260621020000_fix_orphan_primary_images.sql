-- Stop flagging orphan (vehicle_id IS NULL) images as is_primary
-- ============================================================================
-- auto_set_primary_image() (BEFORE INSERT on vehicle_images) decides "first image
-- for the vehicle → primary" with NOT EXISTS (... WHERE vehicle_id = NEW.vehicle_id).
-- When NEW.vehicle_id IS NULL, "vehicle_id = NULL" matches no rows, so the guard is
-- always true and EVERY orphan upload is flagged is_primary=true. Measured 2026-06-21:
-- user 0 had 7,374 orphan images flagged primary (vs 124 correct per-vehicle primaries
-- across 131 vehicles).
--
-- These are wrong (an unattached image is primary of nothing) AND landmines: the
-- unique index vehicle_images_one_primary_per_vehicle_idx only covers
-- vehicle_id IS NOT NULL, so assigning such an image to a vehicle that already has a
-- primary violates the index and the assignment fails.
--
-- Fix: short-circuit the trigger when there is no vehicle. (The AFTER INSERT
-- primary-setters set_first_image_as_primary_if_none / set_vehicle_primary_image are
-- already null-safe — their subqueries no-op on vehicle_id = NULL.)

CREATE OR REPLACE FUNCTION public.auto_set_primary_image()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  -- Orphans cannot be a vehicle's primary; leave is_primary as-is (default false).
  IF NEW.vehicle_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- If this is the first image for the vehicle, make it primary
  IF NOT EXISTS (
    SELECT 1 FROM vehicle_images
    WHERE vehicle_id = NEW.vehicle_id
    AND id != NEW.id
  ) THEN
    NEW.is_primary = true;
  END IF;

  -- If no primary exists and this isn't already set as primary, make it primary
  IF NEW.is_primary IS NOT true AND NOT EXISTS (
    SELECT 1 FROM vehicle_images
    WHERE vehicle_id = NEW.vehicle_id
    AND is_primary = true
    AND id != NEW.id
  ) THEN
    NEW.is_primary = true;
  END IF;

  RETURN NEW;
END;
$function$;

-- Data cleanup: clear the bogus orphan primaries. is_primary on a vehicle_id-NULL row
-- affects no vehicle value or hero selection, so this is non-destructive. Done in a
-- DO loop in capped batches to stay gentle on the per-row image triggers.
DO $$
DECLARE
  touched int;
BEGIN
  LOOP
    UPDATE vehicle_images
    SET is_primary = false
    WHERE id IN (
      SELECT id FROM vehicle_images
      WHERE vehicle_id IS NULL AND is_primary = true
      LIMIT 2000
    );
    GET DIAGNOSTICS touched = ROW_COUNT;
    EXIT WHEN touched = 0;
  END LOOP;
END $$;
