-- Exact live clone-affecting trigger functions read 2026-10-18; dependency stubs are synthetic.
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
END; $function$;
CREATE OR REPLACE FUNCTION public.trigger_photo_pipeline_orchestrator()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF NEW.ai_processing_status = 'pending' AND NEW.image_url IS NOT NULL THEN
    PERFORM net.http_post(
      url := get_service_url() || '/functions/v1/photo-pipeline-orchestrator',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || get_service_role_key_for_cron()
      ),
      body := jsonb_build_object(
        'image_id', NEW.id,
        'image_url', NEW.image_url,
        'vehicle_id', NEW.vehicle_id,
        'user_id', NEW.user_id
      )
    );
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Non-blocking by design: the drain cron picks up anything this misses.
  RAISE WARNING 'photo-pipeline trigger failed (pg_net?): %', SQLERRM;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER trg_flag_duplicate_image BEFORE INSERT ON public.vehicle_images
FOR EACH ROW EXECUTE FUNCTION public.flag_duplicate_image();
CREATE TRIGGER trigger_photo_pipeline_on_image_insert AFTER INSERT ON public.vehicle_images
FOR EACH ROW WHEN (new.ai_processing_status = 'pending' AND new.is_duplicate IS NOT TRUE AND new.is_external IS NOT TRUE)
EXECUTE FUNCTION public.trigger_photo_pipeline_orchestrator();
