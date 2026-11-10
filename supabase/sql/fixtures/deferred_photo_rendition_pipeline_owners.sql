-- Existing live pipeline/default attribution owners retained 2026-11-09.
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
$function$
;
CREATE OR REPLACE FUNCTION public.vehicle_images_default_attribution()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  resolved uuid;
BEGIN
  resolved := COALESCE(
    NEW.user_id,
    NEW.documented_by_user_id,
    NEW.submitted_by,
    NEW.imported_by,
    NEW.ghost_user_id
  );

  IF resolved IS NOT NULL THEN
    NEW.user_id := COALESCE(NEW.user_id, resolved);
    IF NEW.documented_by_user_id IS NULL AND NOT COALESCE(NEW.is_external, false) THEN
      NEW.documented_by_user_id := resolved;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$
;
