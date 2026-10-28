-- Sanctioned writer for corrections to a vehicle's descriptive text fields (body_style, series, trim, notes).
-- Until now only year/make/model (correct_vehicle_identity) and the sale/purchase/VIN fields had a writer, so a
-- photo-derived guess ("Suburban", from an agent's visual read) could only be changed by a raw UPDATE.
-- Same contract as correct_vehicle_identity: cited source and reason, expected live value (stale check), the
-- replaced value kept in superseded_rows.
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '10s';

CREATE OR REPLACE FUNCTION public.correct_vehicle_text_field(p_vehicle_id uuid, p_field text, p_expected text, p_value text, p_source jsonb, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  c_writer     CONSTANT text := 'correct_vehicle_text_field';
  v_timeout_ms bigint := (SELECT setting::bigint FROM pg_settings WHERE name = 'statement_timeout');
  v_live       text;
  v_asserted   text;
BEGIN
  IF v_timeout_ms < 1 OR v_timeout_ms > 60000 THEN
    RAISE EXCEPTION '%: caller must set statement_timeout between 1 ms and 60 s (now % ms)', c_writer, v_timeout_ms;
  END IF;
  PERFORM set_config('lock_timeout', '3s', true);
  IF p_vehicle_id IS NULL THEN RAISE EXCEPTION '%: p_vehicle_id is required', c_writer; END IF;
  IF p_field NOT IN ('body_style', 'series', 'trim', 'notes') THEN
    RAISE EXCEPTION '%: field % is not correctable here', c_writer, p_field;
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 10 THEN
    RAISE EXCEPTION '%: vehicle % needs a reason (at least 10 characters)', c_writer, p_vehicle_id;
  END IF;
  IF p_source IS NULL OR jsonb_typeof(p_source) <> 'object'
     OR coalesce(btrim(p_source ->> 'type'), '') = '' OR coalesce(btrim(p_source ->> 'ref'), '') = ''
     OR coalesce(btrim(p_source ->> 'title'), '') = '' THEN
    RAISE EXCEPTION '%: vehicle % has no cited source (source.type, source.ref and source.title)', c_writer, p_vehicle_id;
  END IF;
  v_asserted := coalesce(nullif(btrim(p_source ->> 'asserted_by'), ''), nullif(current_setting('app.writer', true), ''), 'agent');

  EXECUTE format('SELECT %I FROM vehicles WHERE id = $1 FOR UPDATE', p_field) INTO v_live USING p_vehicle_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'not_found', 'vehicle_id', p_vehicle_id); END IF;
  IF v_live IS DISTINCT FROM p_expected THEN
    RETURN jsonb_build_object('status', 'stale', 'vehicle_id', p_vehicle_id, 'live', v_live);
  END IF;

  INSERT INTO superseded_rows (source_table, row_id, row_data, asserted_by, source, reason)
  VALUES ('vehicles', p_vehicle_id,
          jsonb_build_object('field', p_field, 'value', v_live, 'replacement', p_value),
          v_asserted, p_source, p_reason);

  PERFORM set_config('app.writer', c_writer, true);
  EXECUTE format('UPDATE vehicles SET %I = $1 WHERE id = $2', p_field) USING p_value, p_vehicle_id;

  RETURN jsonb_build_object('status', 'corrected', 'vehicle_id', p_vehicle_id, 'field', p_field, 'was', v_live, 'now', p_value);
END;
$function$;

REVOKE ALL ON FUNCTION public.correct_vehicle_text_field(uuid, text, text, text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.correct_vehicle_text_field(uuid, text, text, text, jsonb, text) TO service_role;
COMMENT ON FUNCTION public.correct_vehicle_text_field(uuid, text, text, text, jsonb, text) IS
  'Sanctioned correction of vehicles.body_style/series/trim/notes: cited source, stale check, prior value kept in superseded_rows.';
