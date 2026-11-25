-- Revert 20261126054500_cover_class_no_view_scan.sql: get_first_image_batch reads the class over the view's
-- ai_scan_metadata again (its 2026-11-25 body, prosrc md5 checked) and the helper is dropped.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $edit$
DECLARE
  d text := pg_get_functiondef('public.get_first_image_batch(uuid[])'::regprocedure);
  a text := $b$THEN public.vehicle_image_cover_class(vi.id)$b$;
  b text := $a$THEN public.garage_cover_class(vi.vehicle_zone, coalesce(vi.ai_detected_angle, vi.angle), vi.image_category,
               vi.ai_scan_metadata->'byok_deep_analysis')$a$;
BEGIN
  IF (length(d) - length(replace(d, a, ''))) / length(a) = 1 THEN
    EXECUTE replace(d, a, b);
  END IF;
END
$edit$;

DROP FUNCTION IF EXISTS public.vehicle_image_cover_class(uuid);

DO $verify$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.get_first_image_batch(uuid[])'::regprocedure)
     <> '85270c6febe8ba121a7e4f3d5dac4298' THEN
    RAISE EXCEPTION 'revert did not restore the 2026-11-25 get_first_image_batch body';
  END IF;
END
$verify$;
COMMIT;
