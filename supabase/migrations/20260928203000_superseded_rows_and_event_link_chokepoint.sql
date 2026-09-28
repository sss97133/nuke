-- superseded_rows + correct_vehicle_event_link: move a sale event to the car it belongs to, or retire the copy.
--
-- WHY: pcarmarket's January import attached other lots' sale events to the wrong cars. The owner's decision
-- (Skylar 2026-09-28: "we want good data, do what u need to do") is to detach them, kept not deleted. Measured:
-- a 1965 Porsche 356SC (7b88a626) carries 106 pcarmarket sale events and none is its own lot (a Lucid Air
-- $175,000, a Jaguar E-type $120,000, a Lamborghini tractor ...), so its page and the 356 market show them as
-- 356 sales; a 1964 356 SC holds a Ferrari 458's sale, the Ferrari holds a BMW M3's, a 280SL holds a 911's.
-- vehicle_events had no sanctioned writer, and no reader filters a status, so a flag in place would still show.
--
-- correct_vehicle_event_link(rows, asserted_by), per row {event_id, expected_vehicle_id, action, to_vehicle_id?,
-- source{ref,...}, reason}:
--   * action 'move': the event goes to to_vehicle_id (the lot's own car); the old link and the citation are
--     appended to metadata.link_corrections. If that car already holds the same lot (same platform + listing id,
--     or same URL when there is no id), this row is a duplicate and is retired instead.
--   * action 'archive': the lot has no car in the database; the event is retired.
-- Retiring = the whole row goes to superseded_rows (row_data, citation, reason) and leaves vehicle_events, so
-- every reader stops counting it; restore is an INSERT of row_data. Nothing is lost. A row whose vehicle is no
-- longer expected_vehicle_id is reported stale and left alone. Cited source required; service role only;
-- <= 500 rows per call. vehicle_events has no triggers and no inbound foreign keys (checked 2026-09-28).

CREATE TABLE IF NOT EXISTS public.superseded_rows (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_table  text        NOT NULL,
  row_id        uuid        NOT NULL,
  row_data      jsonb       NOT NULL,
  superseded_at timestamptz NOT NULL DEFAULT now(),
  asserted_by   text        NOT NULL,
  source        jsonb       NOT NULL,
  reason        text        NOT NULL,
  restored_at   timestamptz
);
CREATE INDEX IF NOT EXISTS superseded_rows_source_row_idx ON public.superseded_rows (source_table, row_id);
ALTER TABLE public.superseded_rows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.superseded_rows FROM PUBLIC;
REVOKE ALL ON public.superseded_rows FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.superseded_rows TO service_role;
COMMENT ON TABLE public.superseded_rows IS
  'Rows retired from a live table by a sanctioned writer (never a raw DELETE): the full row as it was (row_data), the citation (source), the reason and who asserted it. Restore = re-insert row_data into source_table and set restored_at. First writer: correct_vehicle_event_link (2026-09-28).';

CREATE OR REPLACE FUNCTION public.correct_vehicle_event_link(p_rows jsonb, p_asserted_by text DEFAULT 'agent')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  r          jsonb;
  v_ev       vehicle_events%ROWTYPE;
  v_action   text;
  v_to       uuid;
  v_dup      uuid;
  v_moved    int := 0;
  v_dups     int := 0;
  v_archived int := 0;
  v_stale    jsonb := '[]'::jsonb;
  v_missing  jsonb := '[]'::jsonb;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'correct_vehicle_event_link: p_rows must be a JSON array';
  END IF;
  IF jsonb_array_length(p_rows) > 500 THEN
    RAISE EXCEPTION 'correct_vehicle_event_link: at most 500 rows per call (got %)', jsonb_array_length(p_rows);
  END IF;

  FOR r IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    IF r -> 'source' IS NULL OR coalesce(r -> 'source' ->> 'ref', '') = '' THEN
      RAISE EXCEPTION 'correct_vehicle_event_link: event % has no cited source (source.ref)', r ->> 'event_id';
    END IF;
    v_action := r ->> 'action';
    IF v_action IS NULL OR v_action NOT IN ('move', 'archive') THEN
      RAISE EXCEPTION 'correct_vehicle_event_link: action % not allowed (move | archive)', v_action;
    END IF;

    SELECT * INTO v_ev FROM vehicle_events WHERE id = (r ->> 'event_id')::uuid FOR UPDATE;
    IF NOT FOUND THEN
      v_missing := v_missing || jsonb_build_array(r ->> 'event_id');
      CONTINUE;
    END IF;
    IF v_ev.vehicle_id IS DISTINCT FROM (r ->> 'expected_vehicle_id')::uuid THEN
      v_stale := v_stale || jsonb_build_array(jsonb_build_object('event_id', v_ev.id, 'live_vehicle_id', v_ev.vehicle_id,
                                                                 'expected_vehicle_id', r ->> 'expected_vehicle_id'));
      CONTINUE;
    END IF;

    IF v_action = 'move' THEN
      v_to := (r ->> 'to_vehicle_id')::uuid;
      IF v_to IS NULL OR NOT EXISTS (SELECT 1 FROM vehicles WHERE id = v_to AND deleted_at IS NULL) THEN
        RAISE EXCEPTION 'correct_vehicle_event_link: target vehicle % is missing or deleted', v_to;
      END IF;
      v_dup := NULL;
      SELECT t.id INTO v_dup FROM vehicle_events t
      WHERE t.vehicle_id = v_to AND t.id <> v_ev.id
        AND t.source_platform IS NOT DISTINCT FROM v_ev.source_platform
        AND ((v_ev.source_listing_id IS NOT NULL AND t.source_listing_id = v_ev.source_listing_id)
          OR (v_ev.source_listing_id IS NULL AND t.source_listing_id IS NULL AND t.source_url = v_ev.source_url))
      LIMIT 1;
      IF v_dup IS NULL THEN
        UPDATE vehicle_events SET
          vehicle_id = v_to,
          updated_at = now(),
          metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('link_corrections',
            coalesce(metadata -> 'link_corrections', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
              'from_vehicle_id', v_ev.vehicle_id, 'to_vehicle_id', v_to, 'source', r -> 'source',
              'reason', r ->> 'reason', 'asserted_by', p_asserted_by, 'asserted_at', now())))
        WHERE id = v_ev.id;
        v_moved := v_moved + 1;
        CONTINUE;
      END IF;
      INSERT INTO superseded_rows (source_table, row_id, row_data, asserted_by, source, reason)
      VALUES ('vehicle_events', v_ev.id, to_jsonb(v_ev), p_asserted_by,
              (r -> 'source') || jsonb_build_object('duplicate_of_event', v_dup, 'lot_vehicle_id', v_to),
              coalesce(r ->> 'reason', 'misattached event') || ' — the lot''s own vehicle already holds this event (duplicate)');
      DELETE FROM vehicle_events WHERE id = v_ev.id;
      v_dups := v_dups + 1;
      CONTINUE;
    END IF;

    -- 'archive': the lot has no vehicle in the database
    INSERT INTO superseded_rows (source_table, row_id, row_data, asserted_by, source, reason)
    VALUES ('vehicle_events', v_ev.id, to_jsonb(v_ev), p_asserted_by, r -> 'source',
            coalesce(r ->> 'reason', 'misattached event; its lot has no vehicle in the database'));
    DELETE FROM vehicle_events WHERE id = v_ev.id;
    v_archived := v_archived + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'moved', v_moved, 'retired_duplicates', v_dups, 'retired_no_vehicle', v_archived,
    'stale', v_stale, 'missing', v_missing, 'asserted_by', p_asserted_by);
END;
$fn$;

REVOKE ALL ON FUNCTION public.correct_vehicle_event_link(jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.correct_vehicle_event_link(jsonb, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.correct_vehicle_event_link(jsonb, text) TO service_role;

COMMENT ON FUNCTION public.correct_vehicle_event_link(jsonb, text) IS
  'Sanctioned vehicle_events link correction: move an event to the vehicle its lot belongs to (audit in metadata.link_corrections), or retire it into superseded_rows when it is a duplicate there or its lot has no vehicle. Cited source required; expected_vehicle_id guards against stale plans; service role only; <= 500 rows per call.';
