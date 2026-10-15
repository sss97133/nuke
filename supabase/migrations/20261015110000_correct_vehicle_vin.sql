-- correct_vehicle_vin: a sanctioned, cited correction of vehicles.vin (2026-10-15).
--
-- WHY: the Bonhams Typesense lander wrote chassis text with the engine token attached ("57776ENGNE") into
-- vehicles.vin on 206 vehicles. Landers fill empty fields and do not overwrite a stated vin, so a re-land leaves them,
-- and no sanctioned writer corrects vehicles.vin. This follows the supersession pattern (supersede_vehicle_event_episode):
--   * the caller states the expected live value (stale = no write), the new value or NULL, a cited source and a reason;
--   * the prior value is kept whole in superseded_rows (source_table 'vehicles', row_data = the field and its old value),
--     with who asserted it, the source and the reason;
--   * a new value must be present in the cited text (source.chassis_text, or the source URL), so it is read, not guessed;
--     NULL (retract to unknown) must state its finding;
--   * a vin another vehicle holds is reported (status 'held_by'), never written, and never merged here.
-- Nothing runs from this migration. The caller bounds the statement (1 ms .. 60 s); the function bounds its lock wait.
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '10s';

CREATE OR REPLACE FUNCTION public.correct_vehicle_vin(p_vehicle_id uuid, p_expected text, p_value text, p_source jsonb, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  c_writer     CONSTANT text := 'correct_vehicle_vin';
  v_timeout_ms bigint := (SELECT setting::bigint FROM pg_settings WHERE name = 'statement_timeout');
  v_live       text;
  v_haystack   text;
  v_other      uuid;
  v_asserted   text;
BEGIN
  IF v_timeout_ms < 1 OR v_timeout_ms > 60000 THEN
    RAISE EXCEPTION '%: caller must set statement_timeout between 1 ms and 60 s (now % ms)', c_writer, v_timeout_ms;
  END IF;
  PERFORM set_config('lock_timeout', '3s', true);

  IF p_vehicle_id IS NULL THEN RAISE EXCEPTION '%: p_vehicle_id is required', c_writer; END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 10 THEN
    RAISE EXCEPTION '%: vehicle % needs a reason (at least 10 characters)', c_writer, p_vehicle_id;
  END IF;
  IF p_source IS NULL OR jsonb_typeof(p_source) <> 'object'
     OR coalesce(btrim(p_source ->> 'type'), '') = '' OR coalesce(btrim(p_source ->> 'ref'), '') = '' THEN
    RAISE EXCEPTION '%: vehicle % has no cited source (source.type and source.ref)', c_writer, p_vehicle_id;
  END IF;
  IF p_expected IS NULL OR btrim(p_expected) = '' THEN
    RAISE EXCEPTION '%: vehicle % needs the expected live vin', c_writer, p_vehicle_id;
  END IF;
  IF p_value IS NOT NULL AND (btrim(p_value) = '' OR p_value <> upper(btrim(p_value)) OR p_value !~ '^[A-Z0-9*][A-Z0-9*./-]{1,29}$') THEN
    RAISE EXCEPTION '%: vehicle % replacement must be upper-case chassis or VIN characters (2 to 30)', c_writer, p_vehicle_id;
  END IF;
  IF p_value IS NOT DISTINCT FROM p_expected THEN
    RAISE EXCEPTION '%: vehicle % replacement equals the expected value', c_writer, p_vehicle_id;
  END IF;
  IF p_value IS NULL AND coalesce(btrim(p_source ->> 'finding'), '') = '' THEN
    RAISE EXCEPTION '%: vehicle %: a retraction to unknown must state its finding (source.finding)', c_writer, p_vehicle_id;
  END IF;
  IF p_value IS NOT NULL THEN
    -- The new value must be readable in the cited text: alphanumerics only, case-insensitive.
    v_haystack := regexp_replace(upper(coalesce(p_source ->> 'chassis_text', '') || ' ' || coalesce(p_source ->> 'url', '')), '[^A-Z0-9]', '', 'g');
    IF v_haystack = '' OR position(regexp_replace(p_value, '[^A-Z0-9]', '', 'g') IN v_haystack) = 0 THEN
      RAISE EXCEPTION '%: vehicle %: replacement % is not present in the cited chassis_text or url', c_writer, p_vehicle_id, p_value;
    END IF;
  END IF;

  v_asserted := coalesce(nullif(btrim(p_source ->> 'asserted_by'), ''), nullif(current_setting('app.writer', true), ''), 'agent');

  SELECT vin INTO v_live FROM vehicles WHERE id = p_vehicle_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'not_found', 'vehicle_id', p_vehicle_id); END IF;
  IF v_live IS DISTINCT FROM p_expected THEN
    RETURN jsonb_build_object('status', 'stale', 'vehicle_id', p_vehicle_id, 'live', v_live, 'expected', p_expected);
  END IF;

  IF p_value IS NOT NULL THEN
    SELECT id INTO v_other FROM vehicles WHERE vin = p_value AND id <> p_vehicle_id LIMIT 1;
    IF v_other IS NOT NULL THEN
      RETURN jsonb_build_object('status', 'held_by', 'vehicle_id', p_vehicle_id, 'held_by', v_other, 'value', p_value);
    END IF;
  END IF;

  INSERT INTO superseded_rows (source_table, row_id, row_data, asserted_by, source, reason)
  VALUES ('vehicles', p_vehicle_id, jsonb_build_object('field', 'vin', 'value', v_live, 'replacement', p_value), v_asserted, p_source, p_reason);

  PERFORM set_config('app.writer', c_writer, true);
  UPDATE vehicles SET vin = p_value WHERE id = p_vehicle_id;

  RETURN jsonb_build_object('status', 'corrected', 'vehicle_id', p_vehicle_id, 'was', v_live, 'now', p_value);
END;
$function$;

COMMENT ON FUNCTION public.correct_vehicle_vin(uuid, text, text, jsonb, text) IS
  'Cited correction of vehicles.vin: expected live value, new value or NULL, source {type, ref, chassis_text|url, finding for NULL}, reason. Keeps the old value in superseded_rows. Reports (does not write) a stale expectation or a vin another vehicle holds.';

REVOKE ALL ON FUNCTION public.correct_vehicle_vin(uuid, text, text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.correct_vehicle_vin(uuid, text, text, jsonb, text) TO service_role;
COMMIT;
