-- Restore DTO-only admits and drop session-admit objects.
-- Refuses if unreverted log rows remain.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.capture_session_admit_log WHERE reverted_at IS NULL) THEN
    RAISE EXCEPTION 'capture_import_session_admit: revert each run with capture_import_session_admit_revert_v1 first';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.capture_set_photo_admits(p_source text, p_vehicle_id uuid, p_exif jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$
  SELECT p_source = ANY (public.capture_set_photo_sources())
      OR (p_vehicle_id IS NULL
          AND (p_source = ANY (ARRAY['user_upload', 'owner_upload', 'drop-folder', 'image_intake']) OR p_source LIKE 'direct\_pull\_%')
          AND coalesce(p_exif ? 'DateTimeOriginal', false))
$function$;

DROP FUNCTION IF EXISTS public.capture_import_session_admit_revert_v1(uuid, uuid);
DROP FUNCTION IF EXISTS public.capture_import_session_admit_v1(uuid, uuid, uuid, boolean, integer);
DROP TABLE IF EXISTS public.capture_session_admit_log;
