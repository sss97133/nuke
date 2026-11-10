-- Camera clock recovered from the stored file (scripts/photo-pipeline/capture_clock_from_file.py).
-- Unfiled uploads with no DateTimeOriginal in exif_data are outside the planner; many still carry EXIF/XMP in the
-- stored file, and some have taken_at = upload time. The producer reads the file; this migration gives it a logged,
-- signed, per-run revertible write path and admits image_intake into the upload class (same DateTimeOriginal bar).
-- Owner of photo/library/capture code: Codex. Revert: supabase/sql/revert_20261113121000_capture_clock_backfill.sql
DO $$
BEGIN
  IF md5(pg_get_functiondef('public.capture_set_photo_admits(text,uuid,jsonb)'::regprocedure))
     <> '38b290488dd2e685e2e925f79e85f296' THEN
    RAISE EXCEPTION 'capture_set_photo_admits drifted from 20261113120700; refusing';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.capture_clock_backfill_log (
  run_id uuid NOT NULL,
  image_id uuid NOT NULL REFERENCES public.vehicle_images(id) ON DELETE CASCADE,
  prior_exif jsonb,
  prior_taken_at timestamptz,
  new_clock timestamptz NOT NULL,
  clock_source text NOT NULL,
  set_taken_at boolean NOT NULL,
  written_at timestamptz NOT NULL DEFAULT now(),
  reverted_at timestamptz,
  PRIMARY KEY (run_id, image_id)
);
ALTER TABLE public.capture_clock_backfill_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.capture_clock_backfill_log FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.capture_clock_backfill_apply(
  p_run uuid, p_image uuid, p_clock timestamptz, p_keys jsonb, p_set_taken_at boolean)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $function$
DECLARE r record; v_src text := p_keys -> 'capture_clock' ->> 'source';
BEGIN
  -- camera originals only: a clock from the file's EXIF and the camera's Make (screenshots and XMP dates are not written)
  IF p_run IS NULL OR p_clock IS NULL OR v_src IS DISTINCT FROM 'file_exif'
     OR NOT (p_keys ? 'DateTimeOriginal') OR NOT (p_keys ? 'Make') OR (p_keys -> 'capture_clock' ->> 'run_id') IS DISTINCT FROM p_run::text THEN
    RAISE EXCEPTION 'capture_clock_backfill_apply: bad arguments';
  END IF;
  SELECT id, exif_data, taken_at, vehicle_id, coalesce(is_sensitive, false) AS sens, source
    INTO r FROM vehicle_images WHERE id = p_image FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'missing'); END IF;
  IF r.vehicle_id IS NOT NULL OR r.sens OR coalesce(r.exif_data ? 'DateTimeOriginal', false)
     OR r.source NOT IN ('user_upload', 'owner_upload', 'drop-folder', 'image_intake') THEN
    RETURN jsonb_build_object('status', 'skipped_not_eligible');
  END IF;
  INSERT INTO capture_clock_backfill_log (run_id, image_id, prior_exif, prior_taken_at, new_clock, clock_source, set_taken_at)
  VALUES (p_run, p_image, r.exif_data, r.taken_at, p_clock, v_src, coalesce(p_set_taken_at, false));
  UPDATE vehicle_images
     SET exif_data = coalesce(exif_data, '{}'::jsonb) || (p_keys - 'capture_clock')
                     || jsonb_build_object('capture_clock', (p_keys -> 'capture_clock') || jsonb_build_object('at', now())),
         taken_at = CASE WHEN coalesce(p_set_taken_at, false) THEN p_clock ELSE taken_at END
   WHERE id = p_image;
  RETURN jsonb_build_object('status', 'written', 'set_taken_at', coalesce(p_set_taken_at, false));
END $function$;

CREATE OR REPLACE FUNCTION public.capture_clock_backfill_revert(p_run uuid, p_dry boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $function$
DECLARE v_n int; v_untouched int;
BEGIN
  -- only rows still carrying this run's signature are restored; anything changed since is reported, not overwritten
  SELECT count(*) FILTER (WHERE v.exif_data -> 'capture_clock' ->> 'run_id' = p_run::text),
         count(*) FILTER (WHERE v.exif_data -> 'capture_clock' ->> 'run_id' IS DISTINCT FROM p_run::text)
    INTO v_n, v_untouched
    FROM capture_clock_backfill_log l JOIN vehicle_images v ON v.id = l.image_id
   WHERE l.run_id = p_run AND l.reverted_at IS NULL;
  IF NOT p_dry THEN
    UPDATE vehicle_images v SET exif_data = l.prior_exif, taken_at = l.prior_taken_at
      FROM capture_clock_backfill_log l
     WHERE l.run_id = p_run AND l.reverted_at IS NULL AND v.id = l.image_id
       AND v.exif_data -> 'capture_clock' ->> 'run_id' = p_run::text;
    UPDATE capture_clock_backfill_log l SET reverted_at = now()
      FROM vehicle_images v
     WHERE l.run_id = p_run AND l.reverted_at IS NULL AND v.id = l.image_id
       AND l.prior_exif IS NOT DISTINCT FROM v.exif_data;
  END IF;
  RETURN jsonb_build_object('run_id', p_run, 'dry', p_dry, 'restorable', v_n, 'changed_since_skipped', v_untouched);
END $function$;

REVOKE ALL ON FUNCTION public.capture_clock_backfill_apply(uuid, uuid, timestamptz, jsonb, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.capture_clock_backfill_revert(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.capture_clock_backfill_apply(uuid, uuid, timestamptz, jsonb, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.capture_clock_backfill_revert(uuid, boolean) TO service_role;

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
