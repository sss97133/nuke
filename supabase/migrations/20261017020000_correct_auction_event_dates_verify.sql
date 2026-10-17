-- correct_auction_event_dates: report a row as refused when a BEFORE UPDATE trigger kept the live value (13 rows on
-- 2026-10-15 were counted 'corrected' though preserve_bat_live_projection left them unchanged). Same body as
-- 20261017010000 plus the post-update check. No row changes.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '3s';

CREATE OR REPLACE FUNCTION public.correct_auction_event_dates(p_rows jsonb, p_asserted_by text DEFAULT 'agent')
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'UTC'
AS $function$
DECLARE
  c_writer     CONSTANT text := 'correct_auction_event_dates';
  v_timeout_ms bigint := (SELECT setting::bigint FROM pg_settings WHERE name = 'statement_timeout');
  r            jsonb;
  v_id         uuid;
  v_ev         auction_events%ROWTYPE;
  v_spec       jsonb;
  v_new        timestamptz;
  v_exp        timestamptz;
  v_prev_writer text := current_setting('app.writer', true);
  v_corrected  jsonb := '[]'::jsonb;
  v_noop       jsonb := '[]'::jsonb;
  v_missing    jsonb := '[]'::jsonb;
  v_stale      jsonb := '[]'::jsonb;
  v_refused    jsonb := '[]'::jsonb;
BEGIN
  IF v_timeout_ms < 1 OR v_timeout_ms > 60000 THEN
    RAISE EXCEPTION '%: caller must set statement_timeout between 1 ms and 60 s (now % ms)', c_writer, v_timeout_ms;
  END IF;
  PERFORM set_config('lock_timeout', '3s', true);
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION '%: p_rows must be a JSON array', c_writer;
  END IF;
  IF jsonb_array_length(p_rows) > 200 THEN
    RAISE EXCEPTION '%: at most 200 rows per call (got %)', c_writer, jsonb_array_length(p_rows);
  END IF;
  IF coalesce(btrim(p_asserted_by), '') = '' THEN
    RAISE EXCEPTION '%: asserted_by is required', c_writer;
  END IF;
  FOR r IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    IF coalesce(r -> 'source' ->> 'type', '') = '' OR coalesce(r -> 'source' ->> 'ref', '') = '' THEN
      RAISE EXCEPTION '%: event % has no cited source (source.type, source.ref)', c_writer, r ->> 'event_id';
    END IF;
    IF length(btrim(coalesce(r ->> 'reason', ''))) < 10 THEN
      RAISE EXCEPTION '%: event % needs a reason of 10+ characters', c_writer, r ->> 'event_id';
    END IF;
    v_spec := r -> 'corrections' -> 'auction_end_date';
    IF v_spec IS NULL OR jsonb_typeof(v_spec) <> 'object' OR NOT (v_spec ? 'value') OR NOT (v_spec ? 'expected')
       OR (SELECT count(*) FROM jsonb_object_keys(r -> 'corrections')) <> 1 THEN
      RAISE EXCEPTION '%: event % needs corrections {auction_end_date: {value, expected}} and no other field', c_writer, r ->> 'event_id';
    END IF;
    IF EXISTS (SELECT 1 FROM unnest(ARRAY[v_spec ->> 'value', v_spec ->> 'expected']) x
               WHERE x IS NOT NULL AND x !~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}.*(Z|[+-]\d{2}(:?\d{2})?)$') THEN
      RAISE EXCEPTION '%: event % value/expected need a time and an explicit offset', c_writer, r ->> 'event_id';
    END IF;
  END LOOP;

  PERFORM set_config('app.writer', c_writer, true);
  FOR r IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    v_id   := (r ->> 'event_id')::uuid;
    v_spec := r -> 'corrections' -> 'auction_end_date';
    v_new  := nullif(v_spec ->> 'value', '')::timestamptz;
    v_exp  := nullif(v_spec ->> 'expected', '')::timestamptz;
    SELECT * INTO v_ev FROM auction_events WHERE id = v_id FOR UPDATE;
    IF NOT FOUND THEN v_missing := v_missing || to_jsonb(v_id); CONTINUE; END IF;
    IF v_ev.vehicle_id IS DISTINCT FROM nullif(r ->> 'expected_vehicle_id', '')::uuid THEN
      v_stale := v_stale || jsonb_build_object('event_id', v_id, 'why', 'vehicle', 'live_vehicle_id', v_ev.vehicle_id);
      CONTINUE;
    END IF;
    IF v_ev.source NOT IN ('bat', 'bringatrailer') THEN
      v_refused := v_refused || jsonb_build_object('event_id', v_id, 'why', 'not a BaT row (source ' || coalesce(v_ev.source, 'null') || ')');
      CONTINUE;
    END IF;
    IF v_ev.auction_end_date IS NOT DISTINCT FROM v_new THEN v_noop := v_noop || to_jsonb(v_id); CONTINUE; END IF;
    IF v_ev.auction_end_date IS DISTINCT FROM v_exp THEN
      v_stale := v_stale || jsonb_build_object('event_id', v_id, 'why', 'value', 'live', v_ev.auction_end_date, 'expected', v_exp);
      CONTINUE;
    END IF;
    BEGIN
      UPDATE auction_events SET
        auction_end_date = v_new,
        raw_data = jsonb_set(coalesce(raw_data, '{}'::jsonb), '{date_corrections}',
          coalesce(raw_data -> 'date_corrections', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
            'field', 'auction_end_date', 'original', v_ev.auction_end_date, 'corrected', v_new,
            'source', r -> 'source', 'reason', btrim(r ->> 'reason'),
            'asserted_by', p_asserted_by, 'asserted_at', now(), 'writer', c_writer)))
      WHERE id = v_id;
      -- a BEFORE UPDATE trigger (preserve_bat_live_projection) can keep the live value silently: count only what stuck
      IF (SELECT a.auction_end_date FROM auction_events a WHERE a.id = v_id) IS DISTINCT FROM v_new THEN
        RAISE EXCEPTION 'a trigger kept the live auction_end_date';
      END IF;
      v_corrected := v_corrected || to_jsonb(v_id);
    EXCEPTION WHEN OTHERS THEN
      v_refused := v_refused || jsonb_build_object('event_id', v_id, 'why', SQLERRM);
    END;
  END LOOP;
  PERFORM set_config('app.writer', coalesce(v_prev_writer, ''), true);

  RETURN jsonb_build_object('ok', true, 'requested', jsonb_array_length(p_rows),
    'corrected', jsonb_array_length(v_corrected), 'noop', jsonb_array_length(v_noop),
    'missing', v_missing, 'stale', v_stale, 'refused', v_refused, 'asserted_by', p_asserted_by);
END;
$function$;

REVOKE ALL ON FUNCTION public.correct_auction_event_dates(jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.correct_auction_event_dates(jsonb, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.correct_auction_event_dates(jsonb, text) TO service_role;
COMMENT ON FUNCTION public.correct_auction_event_dates(jsonb, text) IS
  'Sanctioned correction of a BaT auction_events row''s auction_end_date, in place (the row carries cascading links): cited source and reason required, expected value must equal the live one (else stale), before-image kept on the row in raw_data.date_corrections[]. BaT rows only, <= 200 rows per call, caller statement_timeout 1..60 s, service role only (2026-10-15).';
COMMIT;
