-- record_vin_trim_evidence (2026-10-18): VIN-decoded trims become field_evidence and fill an empty vehicles.trim.
-- backfill_evidence_for_vehicle turns vin_decoded_data into evidence for year, make, model and drivetrain but not trim,
-- so ~52K decoded trims never reached a vehicle whose trim is empty.
-- A decode that lists alternatives ("S (2WD), 4S (4WD)", "Turbo (4WD) / GT2 (2WD)", "Carrera (2WD + 4WD)") names no
-- single trim and is skipped; a trailing drivetrain note ("Turbo Cabriolet (4WD)") is dropped.
-- Fill-only: a vehicle whose trim already disagrees keeps it, and the decode's evidence stays pending for review.
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '10s';

CREATE OR REPLACE FUNCTION public.vin_decode_single_trim(p_trim text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN s.v IS NULL THEN NULL
    WHEN s.v ~ '[,/+]' THEN NULL
    WHEN s.stripped ~ '[()]' THEN NULL
    ELSE nullif(s.stripped, '')
  END
  FROM (
    SELECT v, btrim(regexp_replace(v, '\s*\((2WD|4WD|AWD|RWD|FWD|4x4|4x2)\)\s*$', '', 'i')) AS stripped
    FROM (SELECT nullif(btrim(p_trim), '') AS v) raw
  ) s
$function$;

CREATE OR REPLACE FUNCTION public.record_vin_trim_evidence(p_after uuid, p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  c_writer     CONSTANT text := 'record_vin_trim_evidence';
  v_timeout_ms bigint := (SELECT setting::bigint FROM pg_settings WHERE name = 'statement_timeout');
  v_last       uuid;
  v_scanned    integer;
  v_single     integer;
  v_accepted   integer;
  v_pending    integer;
  v_filled     integer;
BEGIN
  IF v_timeout_ms < 1 OR v_timeout_ms > 60000 THEN
    RAISE EXCEPTION '%: caller must set statement_timeout between 1 ms and 60 s (now % ms)', c_writer, v_timeout_ms;
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 5000 THEN
    RAISE EXCEPTION '%: p_limit must be between 1 and 5000', c_writer;
  END IF;
  PERFORM set_config('lock_timeout', '3s', true);

  CREATE TEMP TABLE IF NOT EXISTS vin_trim_batch (
    vehicle_id uuid PRIMARY KEY, vin text, live_trim text, decoded_trim text, trim_value text
  ) ON COMMIT DROP;
  TRUNCATE vin_trim_batch;

  INSERT INTO vin_trim_batch
  SELECT v.id, v.vin, nullif(btrim(v.trim), ''), d.trim, public.vin_decode_single_trim(d.trim)
  FROM public.vehicles v
  JOIN public.vin_decoded_data d ON d.vin = upper(v.vin)
  WHERE v.id > coalesce(p_after, '00000000-0000-0000-0000-000000000000'::uuid)
    AND v.deleted_at IS NULL
    AND nullif(btrim(d.trim), '') IS NOT NULL
  ORDER BY v.id
  LIMIT p_limit;

  SELECT max(vehicle_id::text)::uuid, count(*), count(*) FILTER (WHERE trim_value IS NOT NULL)
    INTO v_last, v_scanned, v_single
  FROM vin_trim_batch;

  WITH ins AS (
    INSERT INTO public.field_evidence (
      vehicle_id, field_name, proposed_value, source_type, source_confidence,
      extraction_context, status, assigned_at, assigned_by, raw_extraction_data
    )
    SELECT b.vehicle_id, 'trim', b.trim_value, 'nhtsa_vin_decode', 85,
           'VIN: ' || b.vin,
           CASE WHEN b.live_trim IS NULL OR lower(b.live_trim) = lower(b.trim_value) THEN 'accepted' ELSE 'pending' END,
           CASE WHEN b.live_trim IS NULL OR lower(b.live_trim) = lower(b.trim_value) THEN now() END,
           c_writer,
           jsonb_build_object('decoded_trim', b.decoded_trim, 'live_trim', b.live_trim)
    FROM vin_trim_batch b
    WHERE b.trim_value IS NOT NULL
    ON CONFLICT (vehicle_id, field_name, source_type, proposed_value) DO NOTHING
    RETURNING status
  )
  SELECT count(*) FILTER (WHERE status = 'accepted'), count(*) FILTER (WHERE status = 'pending')
    INTO v_accepted, v_pending
  FROM ins;

  PERFORM set_config('app.writer', c_writer, true);
  UPDATE public.vehicles v
     SET trim = b.trim_value
    FROM vin_trim_batch b
   WHERE v.id = b.vehicle_id
     AND b.trim_value IS NOT NULL
     AND b.live_trim IS NULL
     AND nullif(btrim(v.trim), '') IS NULL;
  GET DIAGNOSTICS v_filled = ROW_COUNT;

  RETURN jsonb_build_object(
    'last_vehicle_id', v_last, 'scanned', v_scanned, 'single_trim', v_single,
    'evidence_accepted', v_accepted, 'evidence_pending', v_pending, 'trim_filled', v_filled
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.vin_decode_single_trim(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vin_decode_single_trim(text) TO service_role;
REVOKE ALL ON FUNCTION public.record_vin_trim_evidence(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_vin_trim_evidence(uuid, integer) TO service_role;

COMMIT;
