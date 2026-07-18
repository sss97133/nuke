-- Match the DB to the testimony model: extract the device signature the iOS capture
-- relay already writes, which the device-attribution system was silently ignoring.
--
-- ROOT CAUSE: generate_device_fingerprint() and auto_attribute_image_to_device() read
-- only STANDARD EXIF keys (Make/Model/LensModel/Software). The iOS capture-relay writes
-- FLAT lowercase keys (camera_make/camera_model/synced_by). So every relay photo
-- fingerprinted to 'Unknown-Unknown-Unknown-Unknown', tripped the guard, and the entire
-- ghost-user / device_attributions system no-opped on exactly the user's own photos —
-- and vehicle_images.device_fingerprint stayed null. Same EXIF-key drift that broke
-- date/taken_at matching. The signature was on every frame; nothing read it.
--
-- FIX (testimony over declaration): read both key shapes; sign each frame at insert via
-- the existing BEFORE-insert exif trigger (no new trigger -> no ACCESS EXCLUSIVE lock on
-- the 38.9M-row hot table); and let the ghost-user path populate going forward.
--
-- BACKFILL (run separately, batched ~4k/stmt to stay under statement_timeout and the
-- per-row value-recompute trigger; a single global UPDATE will time out):
--   WITH b AS (SELECT id FROM vehicle_images
--              WHERE device_fingerprint IS NULL AND exif_data IS NOT NULL
--                AND (exif_data ? 'camera_make' OR exif_data ? 'Make') LIMIT 4000)
--   UPDATE vehicle_images vi SET device_fingerprint = generate_device_fingerprint(vi.exif_data)
--   FROM b WHERE vi.id=b.id
--     AND generate_device_fingerprint(vi.exif_data) <> 'Unknown-Unknown-Unknown-Unknown';
-- Applied for the test user 2026-06-21: 14,944 frames signed, 59 distinct devices.

CREATE OR REPLACE FUNCTION public.generate_device_fingerprint(exif_data jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $function$
DECLARE make TEXT; model TEXT; lens TEXT; software TEXT;
BEGIN
  make     := COALESCE(NULLIF(exif_data->>'Make',''),       NULLIF(exif_data->>'camera_make',''),  'Unknown');
  model    := COALESCE(NULLIF(exif_data->>'Model',''),      NULLIF(exif_data->>'camera_model',''), 'Unknown');
  lens     := COALESCE(NULLIF(exif_data->>'LensModel',''),  NULLIF(exif_data->>'lens_model',''),   'Unknown');
  software := COALESCE(NULLIF(exif_data->>'Software',''),   NULLIF(exif_data->>'software',''),
                       NULLIF(exif_data->>'synced_by',''),  'Unknown');
  RETURN make || '-' || model || '-' || lens || '-' || software;
END;
$function$;

-- Sign the frame at insert (denormalized signature on vehicle_images.device_fingerprint).
CREATE OR REPLACE FUNCTION public.mark_image_for_exif_extraction()
RETURNS trigger LANGUAGE plpgsql AS $function$
DECLARE fp text;
BEGIN
  IF NEW.exif_data IS NULL AND NEW.source = 'user_upload' THEN
    NEW.ai_processing_status := COALESCE(NEW.ai_processing_status, 'pending_exif');
  END IF;
  IF NEW.device_fingerprint IS NULL AND NEW.exif_data IS NOT NULL THEN
    fp := generate_device_fingerprint(NEW.exif_data);
    IF fp <> 'Unknown-Unknown-Unknown-Unknown' THEN
      NEW.device_fingerprint := fp;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- Ghost-user / device_attributions path: read the iOS relay keys too.
CREATE OR REPLACE FUNCTION public.auto_attribute_image_to_device()
RETURNS trigger LANGUAGE plpgsql AS $function$
DECLARE
  v_device_fingerprint TEXT; v_ghost_user_id UUID;
  v_camera_make TEXT; v_camera_model TEXT; v_lens_model TEXT; v_software TEXT;
BEGIN
  IF NEW.exif_data IS NULL THEN RETURN NEW; END IF;

  v_camera_make  := COALESCE(NULLIF(NEW.exif_data->>'Make',''),      NULLIF(NEW.exif_data->>'camera_make',''));
  v_camera_model := COALESCE(NULLIF(NEW.exif_data->>'Model',''),     NULLIF(NEW.exif_data->>'camera_model',''));
  v_lens_model   := COALESCE(NULLIF(NEW.exif_data->>'LensModel',''), NULLIF(NEW.exif_data->>'lens_model',''));
  v_software     := COALESCE(NULLIF(NEW.exif_data->>'Software',''),  NULLIF(NEW.exif_data->>'software',''),
                             NULLIF(NEW.exif_data->>'synced_by',''));

  v_device_fingerprint := generate_device_fingerprint(NEW.exif_data);
  IF v_device_fingerprint = 'Unknown-Unknown-Unknown-Unknown' THEN RETURN NEW; END IF;

  v_ghost_user_id := get_or_create_ghost_user(
    v_device_fingerprint, v_camera_make, v_camera_model, v_lens_model, v_software);

  INSERT INTO device_attributions (
    image_id, device_fingerprint, ghost_user_id, uploaded_by_user_id,
    attribution_source, confidence_score
  ) VALUES (
    NEW.id, v_device_fingerprint, v_ghost_user_id, NEW.user_id, 'exif_device', 100)
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$function$;
