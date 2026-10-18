-- correct_auction_event_dates: the sanctioned correction of a BaT auction_events row's auction_end_date.
--
-- WHY (2026-10-15): extract-bat-core before #1574/#1592 took a sidebar live lot's countdown as a closed lot's end
-- (closed pages carry no data-ends). 881 BaT auction_events rows of lots read since 10-08 disagree with the lot page's
-- own closing record (856 of them stamped 00:00 UTC of the sidebar lot's day). No writer covered the column:
-- correct_auction_event_link moves a lot between vehicles, create_missing_bat_auction_events inserts. The vehicles
-- (correct_vehicle_sale_provenance_batch), vehicle_events (supersede_vehicle_event_episodes) and timeline_events
-- (supersede_timeline_events) corrections of the same lots are done.
--
-- SHAPE: auction_events carries comments, event links and predictions that cascade on delete, so the row is corrected in
-- place, never replaced. Only auction_end_date changes; the audit lives on the row (raw_data.date_corrections[]:
-- original, corrected, source, reason, asserted_by, asserted_at).
--
-- correct_auction_event_dates(rows, asserted_by), per row {event_id, expected_vehicle_id, source{type, ref, ...}, reason,
-- corrections{auction_end_date{value, expected}}}:
--   * a cited source (type and ref) and a reason of 10+ characters on every row, else the call raises (nothing written);
--   * BaT rows only (source bat / bringatrailer); value and expected are instants with an explicit offset (or null);
--     the live value must equal expected, else 'stale' (no write); an equal value is 'noop'; a row missing or of another
--     vehicle is reported; a row the live-projection trigger refuses is reported under 'refused', the rest still run;
--   * at most 200 rows per call; caller statement_timeout 1..60 s; lock_timeout 3 s;
--   * SECURITY DEFINER, search_path public, pg_temp; EXECUTE for service_role only. No row changes in this migration.
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
