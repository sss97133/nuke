-- set_vehicle_visibility: a sanctioned, cited change of vehicles.is_public, by supersession (2026-10-15).
--
-- WHY: 16,045 sold Barrett-Jackson vehicles are hidden (is_public false). scripts/bj-url-parser.ts inserted them public
-- from URL slugs alone (2026-02) and a later pass hid them without an audit row. 15,874 now have the house's lot page
-- captured (job 418). No sanctioned writer could publish or hide a vehicle: visibility changed by raw UPDATE, with no
-- source, no prior value and nothing to stop the next pass from flipping it back.
--
-- RULES, per row {vehicle_id, value, expected, source}:
--   * value and expected are booleans; expected must equal the live is_public (else stale, no write);
--   * source.type, source.ref and source.basis are required, and p_reason must be 10+ characters;
--   * publishing (value true) must cite the evidence: source.snapshot_id, an HTTP-200 listing_page_snapshots row whose
--     normalized listing_url is the normalized source_url of one of this vehicle's vehicle_events (citation_match);
--   * a deleted or merged vehicle is not changed (status 'deleted');
--   * the prior value is kept in vehicles.provenance_metadata.visibility_corrections[] with source, citation, reason,
--     asserted_by and time, and provenance_metadata.visibility_locked_by_correction marks the field;
--   * guard_vehicle_visibility_lock keeps a locked is_public unless this writer changes it (the write is kept and the
--     attempt recorded in visibility_lock_hits, capped at 20).
-- Nothing runs from this migration. The caller bounds the statement (1 ms .. 60 s); the function bounds its lock waits.
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '10s';

CREATE OR REPLACE FUNCTION public.set_vehicle_visibility(p_rows jsonb, p_asserted_by text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  c_writer     CONSTANT text := 'set_vehicle_visibility';
  v_timeout_ms bigint := (SELECT setting::bigint FROM pg_settings WHERE name = 'statement_timeout');
  v_row        jsonb;
  v_id         uuid;
  v_value      boolean;
  v_expected   boolean;
  v_source     jsonb;
  v_veh        vehicles%ROWTYPE;
  v_doc_url    text;
  v_doc_status integer;
  v_doc_key    text;
  v_cite       jsonb;
  v_entry      jsonb;
  v_meta       jsonb;
  v_hits       jsonb;
  v_changed    integer := 0;
  v_noop       integer := 0;
  v_stale      jsonb := '[]'::jsonb;
  v_missing    jsonb := '[]'::jsonb;
  v_deleted    jsonb := '[]'::jsonb;
BEGIN
  IF v_timeout_ms < 1 OR v_timeout_ms > 60000 THEN
    RAISE EXCEPTION '%: caller must set statement_timeout between 1 ms and 60 s (now % ms)', c_writer, v_timeout_ms;
  END IF;
  PERFORM set_config('lock_timeout', '3s', true);
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 OR jsonb_array_length(p_rows) > 200 THEN
    RAISE EXCEPTION '%: p_rows must be a JSON array of 1 to 200 rows', c_writer;
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 10 THEN
    RAISE EXCEPTION '%: a reason of at least 10 characters is required', c_writer;
  END IF;
  IF coalesce(btrim(p_asserted_by), '') = '' THEN
    RAISE EXCEPTION '%: p_asserted_by is required', c_writer;
  END IF;

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    IF NOT coalesce(pg_input_is_valid(v_row ->> 'vehicle_id', 'uuid'), false)
       OR jsonb_typeof(v_row -> 'value') <> 'boolean' OR jsonb_typeof(v_row -> 'expected') <> 'boolean' THEN
      RAISE EXCEPTION '%: each row needs vehicle_id (uuid), value and expected (booleans): %', c_writer, v_row;
    END IF;
    v_id := (v_row ->> 'vehicle_id')::uuid;
    v_value := (v_row ->> 'value')::boolean;
    v_expected := (v_row ->> 'expected')::boolean;
    v_source := v_row -> 'source';
    IF v_source IS NULL OR jsonb_typeof(v_source) <> 'object' OR coalesce(btrim(v_source ->> 'type'), '') = ''
       OR coalesce(btrim(v_source ->> 'ref'), '') = '' OR coalesce(btrim(v_source ->> 'basis'), '') = '' THEN
      RAISE EXCEPTION '%: vehicle % has no cited source (source.type, source.ref and source.basis)', c_writer, v_id;
    END IF;
    -- pg_input_is_valid(NULL, ...) is NULL, not false: a missing snapshot_id must refuse too.
    IF v_value AND NOT coalesce(pg_input_is_valid(v_source ->> 'snapshot_id', 'uuid'), false) THEN
      RAISE EXCEPTION '%: vehicle %: publishing must cite a captured lot page (source.snapshot_id)', c_writer, v_id;
    END IF;

    SELECT * INTO v_veh FROM vehicles WHERE id = v_id FOR UPDATE;
    IF NOT FOUND THEN v_missing := v_missing || to_jsonb(v_id); CONTINUE; END IF;
    IF v_veh.deleted_at IS NOT NULL OR v_veh.merged_into_vehicle_id IS NOT NULL OR v_veh.status = 'merged' THEN
      v_deleted := v_deleted || to_jsonb(v_id); CONTINUE;
    END IF;
    IF v_veh.is_public IS NOT DISTINCT FROM v_value THEN v_noop := v_noop + 1; CONTINUE; END IF;
    IF v_veh.is_public IS DISTINCT FROM v_expected THEN
      v_stale := v_stale || jsonb_build_object('vehicle_id', v_id, 'live', v_veh.is_public, 'expected', v_expected);
      CONTINUE;
    END IF;

    v_cite := NULL;
    IF coalesce(pg_input_is_valid(v_source ->> 'snapshot_id', 'uuid'), false) THEN
      SELECT s.listing_url, s.http_status INTO v_doc_url, v_doc_status
        FROM listing_page_snapshots s WHERE s.id = (v_source ->> 'snapshot_id')::uuid;
      IF NOT FOUND OR v_doc_status IS DISTINCT FROM 200 THEN
        RAISE EXCEPTION '%: vehicle % cites snapshot % which is not an HTTP-200 listing_page_snapshots row',
          c_writer, v_id, v_source ->> 'snapshot_id';
      END IF;
      v_doc_key := lower(regexp_replace(regexp_replace(regexp_replace(btrim(v_doc_url), '[?#].*$', ''),
                     '^(https?://)?(www\.)?', '', 'i'), '/+$', ''));
      SELECT jsonb_build_object('snapshot_id', v_source ->> 'snapshot_id', 'snapshot_url', v_doc_url,
                                'event_id', e.id, 'episode_url', e.source_url) INTO v_cite
        FROM vehicle_events e
       WHERE e.vehicle_id = v_id
         AND lower(regexp_replace(regexp_replace(regexp_replace(btrim(e.source_url), '[?#].*$', ''),
               '^(https?://)?(www\.)?', '', 'i'), '/+$', '')) = v_doc_key
       LIMIT 1;
      IF v_cite IS NULL THEN
        RAISE EXCEPTION '%: vehicle % cites snapshot % (%), which is not the page of any of its lots',
          c_writer, v_id, v_source ->> 'snapshot_id', v_doc_url;
      END IF;
    END IF;

    v_entry := jsonb_build_object('field', 'is_public', 'original', v_veh.is_public, 'corrected', v_value,
      'source', v_source, 'citation_match', v_cite, 'reason', btrim(p_reason), 'asserted_by', btrim(p_asserted_by),
      'writer', c_writer, 'at', now());
    v_meta := coalesce(v_veh.provenance_metadata, '{}'::jsonb);
    v_meta := v_meta
      || jsonb_build_object('visibility_corrections',
           CASE WHEN jsonb_typeof(v_meta -> 'visibility_corrections') = 'array' THEN v_meta -> 'visibility_corrections'
                ELSE '[]'::jsonb END || jsonb_build_array(v_entry))
      || jsonb_build_object('visibility_locked_by_correction', jsonb_build_object('value', v_value, 'writer', c_writer,
           'at', now(), 'rule', 'is_public changes only through set_vehicle_visibility on this row'));

    PERFORM set_config('app.writer', c_writer, true);
    UPDATE vehicles SET is_public = v_value, provenance_metadata = v_meta WHERE id = v_id;
    v_changed := v_changed + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'changed', v_changed, 'noop', v_noop, 'stale', v_stale,
    'missing', v_missing, 'deleted', v_deleted);
END;
$function$;

-- Keeps a corrected is_public unless set_vehicle_visibility changes it; records the attempt.
CREATE OR REPLACE FUNCTION public.guard_vehicle_visibility_lock()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_hits jsonb;
BEGIN
  IF (OLD.provenance_metadata ? 'visibility_locked_by_correction')
     AND NEW.is_public IS DISTINCT FROM OLD.is_public
     AND current_setting('app.writer', true) IS DISTINCT FROM 'set_vehicle_visibility' THEN
    NEW.is_public := OLD.is_public;
    v_hits := CASE WHEN jsonb_typeof(NEW.provenance_metadata -> 'visibility_lock_hits') = 'array'
                   THEN NEW.provenance_metadata -> 'visibility_lock_hits' ELSE '[]'::jsonb END;
    IF jsonb_array_length(v_hits) >= 20 THEN v_hits := v_hits - 0; END IF;
    NEW.provenance_metadata := coalesce(NEW.provenance_metadata, '{}'::jsonb) || jsonb_build_object('visibility_lock_hits',
      v_hits || jsonb_build_object('at', now(), 'app_writer', nullif(current_setting('app.writer', true), ''),
                                   'db_role', current_user::text));
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS trg_guard_vehicle_visibility_lock ON public.vehicles;
CREATE TRIGGER trg_guard_vehicle_visibility_lock
  BEFORE UPDATE OF is_public ON public.vehicles
  FOR EACH ROW EXECUTE FUNCTION public.guard_vehicle_visibility_lock();

COMMENT ON FUNCTION public.set_vehicle_visibility(jsonb, text, text) IS
  'Sanctioned change of vehicles.is_public by supersession. p_rows = [{vehicle_id, value, expected, source: {type, ref, basis, snapshot_id?}}] (1..200); expected must equal the live value (else stale, no write); publishing cites source.snapshot_id, an HTTP-200 listing_page_snapshots row that is the page of one of the vehicle''s own lots (vehicle_events.source_url, normalized). Deleted or merged vehicles are not changed. The prior value is kept in provenance_metadata.visibility_corrections[]; visibility_locked_by_correction makes guard_vehicle_visibility_lock keep the value against other writers. Caller sets statement_timeout 1..60 s; lock_timeout 3 s. Service role only.';
REVOKE ALL ON FUNCTION public.set_vehicle_visibility(jsonb, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_vehicle_visibility(jsonb, text, text) TO service_role;

COMMIT;
