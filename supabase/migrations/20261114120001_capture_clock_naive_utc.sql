-- Correct a naive camera clock that was stored as UTC (20261114120000).
-- derive-image-exif used to append Z to DateTimeOriginal and ignore OffsetTimeOriginal, so drop-folder
-- (and any row it backfilled) is 7-8h early versus America/Los_Angeles. The existing clock apply
-- (20261113121000) refuses rows that already have DateTimeOriginal, and refuses filed rows; this path
-- is the signed, logged, per-run revertible write for that correction. Producer:
--   scripts/photo-pipeline/capture_clock_from_file.py --correct-naive-utc
-- Revert a run: SELECT capture_clock_backfill_revert('<run>', false);
-- Migration revert: supabase/sql/revert_20261114120001_capture_clock_naive_utc.sql

CREATE OR REPLACE FUNCTION public.capture_clock_naive_utc_apply(
  p_run uuid, p_image uuid, p_clock timestamptz, p_keys jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $function$
DECLARE
  r record;
  v_src text := p_keys -> 'capture_clock' ->> 'source';
  v_dto text;
  v_naive_utc timestamptz;
BEGIN
  IF p_run IS NULL OR p_clock IS NULL
     OR v_src NOT IN ('file_exif', 'zone_fallback_la')
     OR NOT (p_keys ? 'DateTimeOriginal')
     OR (p_keys -> 'capture_clock' ->> 'run_id') IS DISTINCT FROM p_run::text THEN
    RAISE EXCEPTION 'capture_clock_naive_utc_apply: bad arguments';
  END IF;
  SELECT id, exif_data, taken_at, vehicle_id, coalesce(is_sensitive, false) AS sens, source,
         vision_gate_status
    INTO r FROM vehicle_images WHERE id = p_image FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'missing'); END IF;
  v_dto := coalesce(r.exif_data, '{}'::jsonb) ->> 'DateTimeOriginal';
  IF r.source IS DISTINCT FROM 'drop-folder'
     OR r.sens
     OR r.vision_gate_status IN ('rejected_personal')
     OR v_dto IS NULL THEN
    RETURN jsonb_build_object('status', 'skipped_not_eligible');
  END IF;
  -- DateTimeOriginal is a naive "YYYY:MM:DD HH:MM:SS". The bug stamped those numbers as UTC.
  -- Parse as a session-zone-independent timestamp, then treat the wall clock as UTC.
  BEGIN
    v_naive_utc := (regexp_replace(v_dto, '^([0-9]{4}):([0-9]{2}):([0-9]{2})[ T]([0-9]{2}):([0-9]{2}):([0-9]{2}).*',
                                   '\1-\2-\3 \4:\5:\6')::timestamp) AT TIME ZONE 'UTC';
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('status', 'skipped_not_eligible');
  END;
  IF r.taken_at IS NULL
     OR abs(extract(epoch FROM (r.taken_at - v_naive_utc))) > 2
     OR abs(extract(epoch FROM (p_clock - r.taken_at))) <= 2 THEN
    RETURN jsonb_build_object('status', 'skipped_not_eligible');
  END IF;
  INSERT INTO capture_clock_backfill_log (run_id, image_id, prior_exif, prior_taken_at, new_clock, clock_source, set_taken_at)
  VALUES (p_run, p_image, r.exif_data, r.taken_at, p_clock, v_src, true);
  UPDATE vehicle_images
     SET exif_data = coalesce(exif_data, '{}'::jsonb) || (p_keys - 'capture_clock')
                     || jsonb_build_object('capture_clock', (p_keys -> 'capture_clock') || jsonb_build_object('at', now())),
         taken_at = p_clock
   WHERE id = p_image;
  RETURN jsonb_build_object('status', 'written', 'set_taken_at', true);
END $function$;

CREATE OR REPLACE FUNCTION public.capture_clock_naive_utc_revert(p_run uuid, p_dry boolean DEFAULT true)
RETURNS jsonb LANGUAGE sql SET search_path = public AS $function$
  SELECT public.capture_clock_backfill_revert(p_run, p_dry)
$function$;

REVOKE ALL ON FUNCTION public.capture_clock_naive_utc_apply(uuid, uuid, timestamptz, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.capture_clock_naive_utc_revert(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.capture_clock_naive_utc_apply(uuid, uuid, timestamptz, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.capture_clock_naive_utc_revert(uuid, boolean) TO service_role;
