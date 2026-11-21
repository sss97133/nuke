-- Exact existing INSERT owners from 2026-11-09/10 live source reads.

CREATE OR REPLACE FUNCTION public.capture_relay_default_vehicle_fn()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_vehicle uuid;
  v_marker text;
begin
  if NEW.vehicle_id is not null or NEW.user_id is null then
    return NEW;
  end if;
  select c.vehicle_id, c.path_marker into v_vehicle, v_marker
    from public.capture_relay_default_vehicle c
   where c.user_id = NEW.user_id and c.enabled;
  if v_vehicle is null then
    return NEW;
  end if;
  if position(v_marker in coalesce(NEW.storage_path, NEW.image_url, '')) = 0 then
    return NEW;
  end if;
  -- never break an upload: only attach if the target vehicle still exists and is live
  if exists (select 1 from public.vehicles v where v.id = v_vehicle and v.deleted_at is null and v.merged_into_vehicle_id is null) then
    NEW.vehicle_id := v_vehicle;
  end if;
  return NEW;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.apply_auto_approval_for_image()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor UUID;
  v_status public.content_approval_status;
BEGIN
  v_actor := COALESCE(NEW.submitted_by, NEW.user_id, auth.uid());
  NEW.submitted_by := v_actor;
  
  IF NEW.vehicle_id IS NOT NULL THEN
    v_status := auto_approve_vehicle_content(NEW.vehicle_id, v_actor);
    IF v_status = 'auto_approved' THEN
      NEW.approval_status := 'auto_approved'::public.content_approval_status;
      NEW.approved_by := v_actor;
      NEW.approved_at := NOW();
    ELSE
      NEW.approval_status := COALESCE(NEW.approval_status, 'pending'::public.content_approval_status);
    END IF;
  ELSE
    NEW.approval_status := COALESCE(NEW.approval_status, 'pending'::public.content_approval_status);
  END IF;
  
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.set_vehicle_image_approval()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
  uploader uuid := NEW.user_id;
  is_collab boolean := false;
begin
  if NEW.is_approved is not null then
    return NEW;
  end if;

  if NEW.vehicle_id is null then
    NEW.is_approved := true;
    return NEW;
  end if;

  is_collab := exists (
                 select 1 from public.vehicles v
                 where v.id = NEW.vehicle_id and v.user_id = uploader
               )
               or exists (
                 select 1 from public.vehicle_user_permissions vup
                 where vup.vehicle_id = NEW.vehicle_id
                   and vup.user_id = uploader
                   and coalesce(vup.is_active, true)
               )
               or exists (
                 select 1 from public.vehicle_contributor_roles vcr
                 where vcr.vehicle_id = NEW.vehicle_id
                   and vcr.user_id = uploader
                   and coalesce(vcr.is_active, true)
               );

  if is_collab then
    NEW.is_approved := true;
  else
    NEW.is_approved := false;
  end if;

  return NEW;
end $function$
;

CREATE OR REPLACE FUNCTION public.flag_duplicate_image()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE existing uuid;
BEGIN
  IF NEW.file_hash IS NOT NULL AND NEW.is_duplicate IS NOT TRUE THEN
    -- A row held for pointing at another photo's bytes is never the original (hold_wrong_byte_images).
    SELECT id INTO existing
      FROM vehicle_images
      WHERE user_id = NEW.user_id AND file_hash = NEW.file_hash
        AND NOT public.vehicle_image_holds_wrong_bytes(id)
      LIMIT 1;
    IF existing IS NOT NULL THEN
      NEW.is_duplicate := true;
      NEW.duplicate_of := existing;
    END IF;
  END IF;
  RETURN NEW;
END; $function$
;

CREATE OR REPLACE FUNCTION public.mark_image_for_exif_extraction()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.auto_attribute_image_to_device()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
$function$
;
