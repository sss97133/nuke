-- The live device-attribution functions as read from production on 2026-10-14 01:40Z (pg_get_functiondef, bodies
-- byte for byte; the migration's hash guard checks auto_attribute_image_to_device). For the contract test only.
CREATE OR REPLACE FUNCTION public.generate_device_fingerprint(exif_data jsonb)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
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
CREATE OR REPLACE FUNCTION public.get_or_create_ghost_user(p_device_fingerprint text, p_camera_make text, p_camera_model text, p_lens_model text, p_software_version text)
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_ghost_user_id UUID;
  v_display_name TEXT;
BEGIN
  SELECT id INTO v_ghost_user_id
  FROM ghost_users
  WHERE device_fingerprint = p_device_fingerprint;
  
  IF v_ghost_user_id IS NOT NULL THEN
    UPDATE ghost_users
    SET last_seen_at = NOW(),
        total_contributions = total_contributions + 1
    WHERE id = v_ghost_user_id;
    
    RETURN v_ghost_user_id;
  END IF;
  
  v_display_name := COALESCE(p_camera_model, p_camera_make, 'Unknown') || ' User';
  
  INSERT INTO ghost_users (
    device_fingerprint,
    camera_make,
    camera_model,
    lens_model,
    software_version,
    display_name,
    total_contributions
  ) VALUES (
    p_device_fingerprint,
    p_camera_make,
    p_camera_model,
    p_lens_model,
    p_software_version,
    v_display_name,
    1
  )
  RETURNING id INTO v_ghost_user_id;
  
  RETURN v_ghost_user_id;
END;
$function$;
CREATE OR REPLACE FUNCTION public.auto_attribute_image_to_device()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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
