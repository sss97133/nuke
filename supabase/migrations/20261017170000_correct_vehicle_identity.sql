-- correct_vehicle_identity (2026-10-16): the sanctioned writer for a vehicle's year, make and model when the live values are wrong.
-- Cause: Bonhams titles carry a headline before the car line ("The ex-Peter Thornton ... campaigned,1960 Aston Martin DB4 GT"), and the first
-- title parser read the headline as the make ("The-Ex-Peter") and missed the year. The identity guard (fill-only) then refuses a re-land that
-- carries the right values, so the wrong ones need a writer of their own: compare-and-set against the expected live values, the new values
-- must be readable in the cited title, and the prior values are kept in superseded_rows.
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '10s';

CREATE OR REPLACE FUNCTION public.correct_vehicle_identity(p_vehicle_id uuid, p_expected jsonb, p_value jsonb, p_source jsonb, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  c_writer     CONSTANT text := 'correct_vehicle_identity';
  v_timeout_ms bigint := (SELECT setting::bigint FROM pg_settings WHERE name = 'statement_timeout');
  v_year       integer;
  v_make       text;
  v_model      text;
  v_new_year   integer := nullif(p_value ->> 'year', '')::integer;
  v_new_make   text := nullif(btrim(p_value ->> 'make'), '');
  v_new_model  text := nullif(btrim(p_value ->> 'model'), '');
  v_title      text;
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
     OR coalesce(btrim(p_source ->> 'type'), '') = '' OR coalesce(btrim(p_source ->> 'ref'), '') = ''
     OR coalesce(btrim(p_source ->> 'title'), '') = '' THEN
    RAISE EXCEPTION '%: vehicle % has no cited source (source.type, source.ref and source.title)', c_writer, p_vehicle_id;
  END IF;
  IF p_expected IS NULL OR jsonb_typeof(p_expected) <> 'object' OR NOT (p_expected ? 'year' AND p_expected ? 'make' AND p_expected ? 'model') THEN
    RAISE EXCEPTION '%: vehicle % needs the expected live year, make and model (null where empty)', c_writer, p_vehicle_id;
  END IF;
  IF p_value IS NULL OR jsonb_typeof(p_value) <> 'object' OR (v_new_year IS NULL AND v_new_make IS NULL AND v_new_model IS NULL) THEN
    RAISE EXCEPTION '%: vehicle % has no new value', c_writer, p_vehicle_id;
  END IF;
  IF v_new_year IS NOT NULL AND (v_new_year < 1885 OR v_new_year > 2026) THEN
    RAISE EXCEPTION '%: vehicle % year % is outside 1885-2026', c_writer, p_vehicle_id, v_new_year;
  END IF;

  -- Each new value must be readable in the cited title: the year as digits, the make by its first word, the model by its first word.
  v_title := lower(regexp_replace(p_source ->> 'title', '[^A-Za-z0-9]+', ' ', 'g'));
  IF v_new_year IS NOT NULL AND position(v_new_year::text IN v_title) = 0 THEN
    RAISE EXCEPTION '%: vehicle %: year % is not in the cited title', c_writer, p_vehicle_id, v_new_year;
  END IF;
  IF v_new_make IS NOT NULL AND position(split_part(lower(regexp_replace(v_new_make, '[^A-Za-z0-9]+', ' ', 'g')), ' ', 1) IN v_title) = 0 THEN
    RAISE EXCEPTION '%: vehicle %: make % is not in the cited title', c_writer, p_vehicle_id, v_new_make;
  END IF;
  IF v_new_model IS NOT NULL AND position(split_part(lower(regexp_replace(v_new_model, '[^A-Za-z0-9]+', ' ', 'g')), ' ', 1) IN v_title) = 0 THEN
    RAISE EXCEPTION '%: vehicle %: model % is not in the cited title', c_writer, p_vehicle_id, v_new_model;
  END IF;

  v_asserted := coalesce(nullif(btrim(p_source ->> 'asserted_by'), ''), nullif(current_setting('app.writer', true), ''), 'agent');

  SELECT year, make, model INTO v_year, v_make, v_model FROM vehicles WHERE id = p_vehicle_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'not_found', 'vehicle_id', p_vehicle_id); END IF;
  IF v_year IS DISTINCT FROM nullif(p_expected ->> 'year', '')::integer
     OR v_make IS DISTINCT FROM nullif(p_expected ->> 'make', '')
     OR v_model IS DISTINCT FROM nullif(p_expected ->> 'model', '') THEN
    RETURN jsonb_build_object('status', 'stale', 'vehicle_id', p_vehicle_id, 'live', jsonb_build_object('year', v_year, 'make', v_make, 'model', v_model));
  END IF;

  INSERT INTO superseded_rows (source_table, row_id, row_data, asserted_by, source, reason)
  VALUES ('vehicles', p_vehicle_id,
          jsonb_build_object('field', 'identity', 'value', jsonb_build_object('year', v_year, 'make', v_make, 'model', v_model), 'replacement', p_value),
          v_asserted, p_source, p_reason);

  PERFORM set_config('app.writer', c_writer, true);
  UPDATE vehicles
     SET year = coalesce(v_new_year, year), make = coalesce(v_new_make, make), model = coalesce(v_new_model, model)
   WHERE id = p_vehicle_id;

  RETURN jsonb_build_object('status', 'corrected', 'vehicle_id', p_vehicle_id,
                            'was', jsonb_build_object('year', v_year, 'make', v_make, 'model', v_model), 'now', p_value);
END;
$function$;

REVOKE ALL ON FUNCTION public.correct_vehicle_identity(uuid, jsonb, jsonb, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.correct_vehicle_identity(uuid, jsonb, jsonb, jsonb, text) TO service_role;

COMMIT;
