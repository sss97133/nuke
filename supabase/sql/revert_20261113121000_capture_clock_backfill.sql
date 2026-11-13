-- Revert 20261113121000. First undo every write run: SELECT capture_clock_backfill_revert('<run>', false);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.capture_clock_backfill_log WHERE reverted_at IS NULL) THEN
    RAISE EXCEPTION 'unreverted capture_clock_backfill runs remain; run capture_clock_backfill_revert(run, false) first';
  END IF;
END $$;
CREATE OR REPLACE FUNCTION public.capture_set_photo_admits(p_source text, p_vehicle_id uuid, p_exif jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$
  SELECT p_source = ANY (public.capture_set_photo_sources())
      OR (p_vehicle_id IS NULL
          AND (p_source = ANY (ARRAY['user_upload', 'owner_upload', 'drop-folder']) OR p_source LIKE 'direct\_pull\_%')
          AND coalesce(p_exif ? 'DateTimeOriginal', false))
$function$;
DO $$
BEGIN
  IF md5(pg_get_functiondef('public.capture_set_photo_admits(text,uuid,jsonb)'::regprocedure)) <> '38b290488dd2e685e2e925f79e85f296' THEN
    RAISE EXCEPTION 'revert did not restore capture_set_photo_admits';
  END IF;
END $$;
DROP FUNCTION IF EXISTS public.capture_clock_backfill_apply(uuid, uuid, timestamptz, jsonb, boolean);
DROP FUNCTION IF EXISTS public.capture_clock_backfill_revert(uuid, boolean);
DROP TABLE IF EXISTS public.capture_clock_backfill_log;
