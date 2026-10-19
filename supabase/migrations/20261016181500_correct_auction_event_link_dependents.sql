-- correct_auction_event_link holds an auction that has dependents (2026-10-15).
-- Break: auction_comments.auction_event_id and both auction_event_links columns are ON DELETE CASCADE, and
-- hammer_predictions.auction_event_id is ON DELETE SET NULL. So retiring a duplicate auction would delete its comments
-- (testimony) and links, and null its predictions' link; moving it would leave its comments on the old vehicle_id.
-- The first runs retired 18 Barrett-Jackson duplicates with none (their kept copies have 0 comments; 0 comments, links
-- or predictions on the 5,987 planned moves, read 14:44Z). The writer must not depend on that. Now an auction with
-- any comment, link or prediction is reported under 'held' and not written. Every other path is the live body
-- unchanged (fingerprint pinned by the guard below, read 14:48Z). Forward-only, no row changes, grants unchanged.
-- Contract: supabase/sql/test_correct_auction_event_link.sql (db contracts).
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '3s';
DO $guard$
DECLARE f text;
BEGIN
  f := md5(pg_get_functiondef('public.correct_auction_event_link(jsonb,text)'::regprocedure));
  IF f = 'b61e84bf6d7e28f698823d52959a794a' THEN -- gitleaks:allow (function-definition fingerprint after this migration, not a secret)
    RAISE NOTICE 'correct_auction_event_link already holds auctions with dependents';
  ELSIF f <> '5b9ad1c47adf60eb3770a5b276cc4be1' THEN -- gitleaks:allow (live fingerprint read 2026-10-15 14:48Z, not a secret)
    RAISE EXCEPTION 'correct_auction_event_link body drifted since 2026-10-15 14:48Z (md5 %); review before replacement', f;
  END IF;
END;
$guard$;

CREATE OR REPLACE FUNCTION public.correct_auction_event_link(p_rows jsonb, p_asserted_by text DEFAULT 'agent'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  c_writer   CONSTANT text := 'correct_auction_event_link';
  v_timeout  bigint := (SELECT setting::bigint FROM pg_settings WHERE name = 'statement_timeout');
  r          jsonb;
  v_ev       auction_events%ROWTYPE;
  v_action   text;
  v_to       uuid;
  v_dup      uuid;
  v_moved    int := 0;
  v_dups     int := 0;
  v_stale    jsonb := '[]'::jsonb;
  v_missing  jsonb := '[]'::jsonb;
  v_held     jsonb := '[]'::jsonb;
BEGIN
  IF v_timeout < 1 OR v_timeout > 60000 THEN
    RAISE EXCEPTION '%: caller must set statement_timeout between 1 ms and 60 s (now % ms)', c_writer, v_timeout;
  END IF;
  PERFORM set_config('lock_timeout', '3s', true);
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION '%: p_rows must be a JSON array', c_writer;
  END IF;
  IF jsonb_array_length(p_rows) > 500 THEN
    RAISE EXCEPTION '%: at most 500 rows per call (got %)', c_writer, jsonb_array_length(p_rows);
  END IF;

  FOR r IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    IF jsonb_typeof(r -> 'source') IS DISTINCT FROM 'object' OR coalesce(btrim(r -> 'source' ->> 'ref'), '') = '' THEN
      RAISE EXCEPTION '%: auction event % has no cited source (source.ref)', c_writer, r ->> 'event_id';
    END IF;
    IF coalesce(length(btrim(r ->> 'reason')), 0) < 10 THEN
      RAISE EXCEPTION '%: auction event % needs a reason (at least 10 characters)', c_writer, r ->> 'event_id';
    END IF;
    v_action := r ->> 'action';
    IF v_action IS DISTINCT FROM 'move' THEN
      RAISE EXCEPTION '%: action % not allowed (move only; an auction whose lot has no vehicle waits for it)',
        c_writer, v_action;
    END IF;

    SELECT * INTO v_ev FROM auction_events WHERE id = (r ->> 'event_id')::uuid FOR UPDATE;
    IF NOT FOUND THEN
      v_missing := v_missing || jsonb_build_array(r ->> 'event_id');
      CONTINUE;
    END IF;
    IF v_ev.vehicle_id IS DISTINCT FROM (r ->> 'expected_vehicle_id')::uuid THEN
      v_stale := v_stale || jsonb_build_array(jsonb_build_object('event_id', v_ev.id, 'live_vehicle_id', v_ev.vehicle_id,
                                                                 'expected_vehicle_id', r ->> 'expected_vehicle_id'));
      CONTINUE;
    END IF;
    -- comments and links cascade on delete and predictions lose their link: such an auction is held, not written
    IF EXISTS (SELECT 1 FROM auction_comments c WHERE c.auction_event_id = v_ev.id)
       OR EXISTS (SELECT 1 FROM auction_event_links l WHERE l.from_auction_event_id = v_ev.id)
       OR EXISTS (SELECT 1 FROM auction_event_links l WHERE l.to_auction_event_id = v_ev.id)
       OR EXISTS (SELECT 1 FROM hammer_predictions h WHERE h.auction_event_id = v_ev.id) THEN
      v_held := v_held || jsonb_build_array(jsonb_build_object('event_id', v_ev.id,
                                                               'reason', 'has comments, event links or predictions'));
      CONTINUE;
    END IF;

    v_to := (r ->> 'to_vehicle_id')::uuid;
    IF v_to IS NULL OR NOT EXISTS (SELECT 1 FROM vehicles WHERE id = v_to AND deleted_at IS NULL) THEN
      RAISE EXCEPTION '%: target vehicle % is missing or deleted', c_writer, v_to;
    END IF;
    IF v_to = v_ev.vehicle_id THEN
      RAISE EXCEPTION '%: auction event % already belongs to vehicle %', c_writer, v_ev.id, v_to;
    END IF;
    -- the lot's own vehicle may already hold this auction (the same lot under www. or a trailing slash counts)
    v_dup := NULL;
    SELECT t.id INTO v_dup FROM auction_events t
    WHERE t.vehicle_id = v_to AND t.id <> v_ev.id
      AND t.source IS NOT DISTINCT FROM v_ev.source
      AND regexp_replace(lower(t.source_url), '^https?://(www\.)?|/+$', '', 'g')
        = regexp_replace(lower(v_ev.source_url), '^https?://(www\.)?|/+$', '', 'g')
    LIMIT 1;
    IF v_dup IS NULL THEN
      INSERT INTO superseded_rows (source_table, row_id, row_data, asserted_by, source, reason)
      VALUES ('auction_events', v_ev.id, to_jsonb(v_ev), p_asserted_by,
              (r -> 'source') || jsonb_build_object('relinked_to_vehicle', v_to),
              (r ->> 'reason') || ' (relinked; this is the row before the move)');
      UPDATE auction_events SET
        vehicle_id = v_to,
        merged_from_vehicle_id = v_ev.vehicle_id,
        updated_at = now()
      WHERE id = v_ev.id;
      v_moved := v_moved + 1;
      CONTINUE;
    END IF;
    INSERT INTO superseded_rows (source_table, row_id, row_data, asserted_by, source, reason)
    VALUES ('auction_events', v_ev.id, to_jsonb(v_ev), p_asserted_by,
            (r -> 'source') || jsonb_build_object('duplicate_of_event', v_dup, 'lot_vehicle_id', v_to),
            (r ->> 'reason') || ' (the lot''s own vehicle already holds this auction: duplicate)');
    DELETE FROM auction_events WHERE id = v_ev.id;
    v_dups := v_dups + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'moved', v_moved, 'retired_duplicates', v_dups,
    'stale', v_stale, 'missing', v_missing, 'held', v_held, 'asserted_by', p_asserted_by);
END;
$function$;

COMMENT ON FUNCTION public.correct_auction_event_link(jsonb, text) IS
  'Sanctioned auction_events link correction (auction_events arm of correct_vehicle_event_link). Moves an auction to '
  'the vehicle its lot belongs to (merged_from_vehicle_id keeps the origin; the row before the move is kept in '
  'superseded_rows), or retires it into superseded_rows when that vehicle already holds the same lot (duplicate). An '
  'auction with comments, event links or predictions is reported under held and not written (they cascade on delete). '
  'No archive: an auction whose lot has no vehicle waits for that vehicle. p_rows = [{event_id, expected_vehicle_id, '
  'action: move, to_vehicle_id, source: {type, ref, ...}, reason}] (1..500); a stale expected_vehicle_id is reported, '
  'not written. Caller sets statement_timeout 1..60 s; lock_timeout 3 s. Service role only.';

COMMIT;
