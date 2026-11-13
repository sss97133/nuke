-- Admit a file EXIF DateTimeOriginal even when Make is absent, when provenance is file_exif (TIFF/EXIF IFD).
-- XMP / guessed clocks are still rejected. Does not invent a clock. Does not change admission rules.
-- Revert: supabase/sql/revert_20261115121000_capture_clock_backfill_exif_dto_without_make.sql
-- Live apply of the 4 eligible image_intake rows is a separate signed capture_clock_backfill_apply run after CI.

DO $$
BEGIN
  IF md5(pg_get_functiondef('public.capture_clock_backfill_apply(uuid,uuid,timestamptz,jsonb,boolean)'::regprocedure))
     NOT IN (
       '2da16a0cec11a1731c93fd8a24fb8aa7'
     ) THEN
    -- The CloudAgent must fill the md5 of the live 20261113121000 body before shipping.
    RAISE EXCEPTION 'capture_clock_backfill_apply drifted from 20261113121000; refusing';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.capture_clock_backfill_apply(
  p_run uuid, p_image uuid, p_clock timestamptz, p_keys jsonb, p_set_taken_at boolean)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $function$
DECLARE r record; v_src text := p_keys -> 'capture_clock' ->> 'source';
BEGIN
  -- camera originals: a DateTimeOriginal from the file's EXIF IFD (file_exif). Make is optional.
  -- screenshots and edited graphics that only have XMP dates, and any guessed clock, are not written.
  IF p_run IS NULL OR p_clock IS NULL OR v_src IS DISTINCT FROM 'file_exif'
     OR NOT (p_keys ? 'DateTimeOriginal')
     OR (p_keys -> 'capture_clock' ->> 'run_id') IS DISTINCT FROM p_run::text THEN
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

REVOKE ALL ON FUNCTION public.capture_clock_backfill_apply(uuid, uuid, timestamptz, jsonb, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.capture_clock_backfill_apply(uuid, uuid, timestamptz, jsonb, boolean) TO service_role;
