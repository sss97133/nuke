-- supersede_vehicle_event_episode(s): correct a vehicle_events sale episode's clocks by supersession, never in place.
--
-- WHY (lanes S, S2, V; 2026-10-06): 1,710 episodes carry a wrong sale clock and no sanctioned writer could correct them.
-- All three populations were written by orphan-backfill-v1, which set sold_at and left ended_at NULL:
--   * Gooding, 1,037: sold_at is the retained page's CMS placeholder session (998) or an online sale's opening time
--     (39). The page states no real sale day, so the replacement is NULL (unknown).
--   * RM Sotheby's, 575: sold_at is the day from extract-rmsothebys' hand-typed auction-code map; the RM auction page
--     contradicts it on pa24, pa25, mi25, mo24 and mo25 (PR #671). The replacement is the page's first stated day,
--     cited to the listing_page_snapshots row of that auction's page.
--   * PCARMARKET, 98: sold_at is the import write clock (millisecond precision, seconds from created_at). The
--     replacement is NULL (unknown).
-- vehicles.sale_date for these vehicles was already corrected or retracted by correct_vehicle_sale_provenance_batch
-- (the public fold vehicle_price_facts reads that column, not this table). The wrong days remain in
-- vehicle_events.sold_at, which valuation_by_ymm, get_make_model_terminal, the vehicle-profile readers and the views
-- vehicle_latest_event / vehicle_event_summary / v_user_daily_activity read directly.
--
-- SHAPE (V-DESIGN.md): vehicle_events is a state table (one row per listing, updated in place by its landers) with no
-- supersession columns, and no reader filters a status. The existing archive superseded_rows (owner-sanctioned
-- 2026-09-28, first writer correct_vehicle_event_link) holds retired rows whole. A supersession:
--   1. retires the original row into superseded_rows (row_data = to_jsonb(row), the citation and how it matched the
--      episode, the reason, who asserted it, the replacement id and {field: {original, replacement}});
--   2. removes it from vehicle_events;
--   3. inserts the corrected episode: every column copied (created_at keeps the first-landing ingest clock), a new id,
--      the corrected clocks, updated_at now(), metadata.<field>_method/_precision rewritten for the new value (removed
--      when NULL), metadata.episode_supersessions[] += {supersedes_event_id, superseded_row_id, corrections, source,
--      citation_match, reason, asserted_by, writer, asserted_at}, and metadata.clock_locked_by_supersession = {fields,
--      superseded_row_id, writer, at, rule}. Landers must not write the listed fields on a row that carries that key
--      (lane G's Gooding/RM lander fix respects it), and must merge metadata rather than replace it.
-- Nothing is UPDATEd. Every reader of vehicle_events sees the corrected row with no reader change, because it is the
-- only live row for that listing key. Restore = retire the replacement, re-insert row_data.
--
-- RULES (single function; the batch applies them per row):
--   * Fields sold_at and ended_at only. Each correction {value, expected, precision?} carries the expected live value
--     (mismatch = stale, no write). value and expected are null or an instant with an explicit offset (Z or +hh[:mm]);
--     a naive timestamp is refused, so the session TimeZone cannot move a day. The function runs with TimeZone UTC.
--   * source.type, source.ref and a reason of 10+ characters are required. Per field: a NULL replacement needs
--     source.finding; a dated replacement needs a captured document and source.basis.
--   * The citation must belong to the episode, not merely exist. source.snapshot_id: a listing_page_snapshots row
--     fetched with HTTP 200 whose listing_url, normalized (lower case; scheme, www., query, fragment and trailing
--     slashes removed), equals the episode's source_url normalized the same way (kind listing_page), or is the
--     auction page host/auctions/<code> of the auction whose lot the episode is, host/auctions/<code>/lots/...
--     (kind auction_page; the RM case: the code is recorded). source.lot_row_id: an auction_events row with the same
--     vehicle_id and the same normalized URL. How it matched is stored as citation_match.
--   * References to the retired id: refuses (status referenced, listing which, no write) while any row points at the
--     episode id. Enumeration (prod 2026-10-06: information_schema FKs, the uuid columns lane C's comments name, and
--     a scan of every one of the 324 FK-less uuid columns in public): vehicle_observations.source_vehicle_event_id
--     (the only FK; ON DELETE RESTRICT; idx_vehicle_observations_source_vehicle_event), bat_bids.bat_listing_id
--     (no FK; points at vehicle_events for about 8.5% of bids; bat_bids_unique_bid leads with it),
--     hammer_predictions.external_listing_id (no FK; 16,256 of 50,613 rows are vehicle_events ids; 17 MB, no index on
--     the column, scanned per call because 76 rows carry another vehicle_id than their episode). No queue or link
--     column holds vehicle_events ids (user_profile_queue.source_listing_id, vehicle_images.event_id and
--     ai_scan_sessions.event_id are NULL on every row; auction_event_links and the timeline/external-listing columns
--     are keyed elsewhere). Citations inside jsonb ('vehicle_events/<id>' in audit entries) stay resolvable through
--     superseded_rows.row_id.
--   * Row copy: vehicle_events has no generated or identity column, and every column is uuid, text, timestamptz,
--     numeric, integer or jsonb, all of which round-trip through jsonb exactly (information_schema.columns on prod,
--     2026-10-06: 31 columns). The function refuses if a generated or identity column appears.
--   * Bounds: the caller must set statement_timeout 1..60 s (a function cannot bound the statement that calls it);
--     the function sets lock_timeout 3 s (set_config, transaction-local). Batch: at most 100 rows (runner default 25).
--   * Refuses to run until idx_vehicle_observations_source_vehicle_event (previous migration) is valid: each retire
--     runs the restrict-FK check on vehicle_observations.
--   * Idempotent: a retired episode returns 'already' (with the replacement id); one already holding the values
--     returns 'noop'. Declares app.writer only when it writes, after every check; asserted_by = source.asserted_by,
--     else the caller's app.writer, else 'agent'. The batch restores the caller's app.writer at the end.
--   * SECURITY DEFINER, search_path public, pg_temp; EXECUTE for service_role only.
--
-- Verified live 2026-10-06 12:20-13:18Z: vehicle_events has one trigger (preserve_bat_live_projection, BEFORE UPDATE:
-- not fired by this writer), one inbound FK, no pipeline_registry rows; neither function name exists. All 1,042
-- snapshots the 1,710 payloads cite are HTTP 200 and belong to their episode (1,037 Gooding by listing URL, 575 RM by
-- auction code); no bid or prediction row references the 1,710. No row changes in this migration.
-- Contract: supabase/sql/test_vehicle_event_episode_supersession.sql (PostgreSQL 17). Applied by CI, never by hand.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '3s';

DO $guard$
DECLARE f text;
BEGIN
  IF to_regprocedure('public.supersede_vehicle_event_episode(uuid,jsonb,jsonb,text)') IS NOT NULL THEN
    f := md5(pg_get_functiondef('public.supersede_vehicle_event_episode(uuid,jsonb,jsonb,text)'::regprocedure));
    IF f <> '07e73e557da45011df519ba4375e701f' THEN -- gitleaks:allow (function-definition fingerprint after this migration, not a secret)
      RAISE EXCEPTION 'supersede_vehicle_event_episode exists with another body (md5 %); review before replacement', f;
    END IF;
  END IF;
  IF to_regprocedure('public.supersede_vehicle_event_episodes(jsonb,text)') IS NOT NULL THEN
    f := md5(pg_get_functiondef('public.supersede_vehicle_event_episodes(jsonb,text)'::regprocedure));
    IF f <> 'c7432cffe18117b7de1cb401273d922f' THEN -- gitleaks:allow (function-definition fingerprint after this migration, not a secret)
      RAISE EXCEPTION 'supersede_vehicle_event_episodes exists with another body (md5 %); review before replacement', f;
    END IF;
  END IF;
END;
$guard$;

CREATE OR REPLACE FUNCTION public.supersede_vehicle_event_episode(
  p_event_id uuid, p_corrections jsonb, p_source jsonb, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'UTC'
AS $function$
DECLARE
  c_writer     CONSTANT text := 'supersede_vehicle_event_episode';
  c_fields     CONSTANT text[] := ARRAY['sold_at', 'ended_at'];
  c_instant    CONSTANT text := '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}(:?\d{2})?)$';
  v_timeout_ms bigint := (SELECT setting::bigint FROM pg_settings WHERE name = 'statement_timeout');
  v_caller     text;
  v_asserted   text;
  v_ev         vehicle_events%ROWTYPE;
  v_retired    superseded_rows%ROWTYPE;
  v_field      text;
  v_spec       jsonb;
  v_live       timestamptz;
  v_expected   timestamptz;
  v_new        timestamptz;
  v_any_dated  boolean := false;
  v_any_null   boolean := false;
  v_ep_key     text;
  v_doc_key    text;
  v_doc_url    text;
  v_doc_status integer;
  v_lot_vehicle uuid;
  v_cite       jsonb := '{}'::jsonb;
  v_refs       jsonb := '[]'::jsonb;
  v_n          bigint;
  v_stale      jsonb := '{}'::jsonb;
  v_diff       jsonb := '{}'::jsonb;
  v_meta       jsonb;
  v_patch      jsonb;
  v_entry      jsonb;
  v_new_id     uuid;
  v_row_id     uuid;
BEGIN
  -- Bounds: the caller bounds the statement; this function bounds its lock waits.
  IF v_timeout_ms < 1 OR v_timeout_ms > 60000 THEN
    RAISE EXCEPTION '%: caller must set statement_timeout between 1 ms and 60 s (now % ms)', c_writer, v_timeout_ms;
  END IF;
  PERFORM set_config('lock_timeout', '3s', true);

  -- Who asserted it: the source's asserted_by, else the caller's declared writer, else 'agent'.
  v_caller := nullif(current_setting('app.writer', true), '');
  IF v_caller = c_writer THEN
    v_caller := nullif(current_setting('nuke.supersede_caller_writer', true), '');
  END IF;
  v_asserted := coalesce(nullif(btrim(p_source ->> 'asserted_by'), ''), v_caller, 'agent');

  -- The plan must be well formed and cited before anything is read.
  IF p_event_id IS NULL THEN
    RAISE EXCEPTION '%: p_event_id is required', c_writer;
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 10 THEN
    RAISE EXCEPTION '%: episode % needs a reason (p_reason, at least 10 characters)', c_writer, p_event_id;
  END IF;
  IF p_source IS NULL OR jsonb_typeof(p_source) <> 'object'
     OR coalesce(btrim(p_source ->> 'type'), '') = '' OR coalesce(btrim(p_source ->> 'ref'), '') = '' THEN
    RAISE EXCEPTION '%: episode % has no cited source (source.type and source.ref) -- corrections must be cited, never guessed',
      c_writer, p_event_id;
  END IF;
  IF p_corrections IS NULL OR jsonb_typeof(p_corrections) <> 'object' OR p_corrections = '{}'::jsonb THEN
    RAISE EXCEPTION '%: episode % has no corrections object', c_writer, p_event_id;
  END IF;
  FOR v_field IN SELECT jsonb_object_keys(p_corrections) LOOP
    IF NOT v_field = ANY (c_fields) THEN
      RAISE EXCEPTION '%: unsupported field % (supported: %)', c_writer, v_field, array_to_string(c_fields, ', ');
    END IF;
    v_spec := p_corrections -> v_field;
    IF jsonb_typeof(v_spec) <> 'object' OR NOT (v_spec ? 'value') OR NOT (v_spec ? 'expected')
       OR (v_spec ? 'precision' AND jsonb_typeof(v_spec -> 'precision') NOT IN ('null', 'string')) THEN
      RAISE EXCEPTION '%: episode % field % must be {value, expected[, precision]}', c_writer, p_event_id, v_field;
    END IF;
    IF jsonb_typeof(v_spec -> 'value') NOT IN ('null', 'string') OR jsonb_typeof(v_spec -> 'expected') NOT IN ('null', 'string')
       OR (jsonb_typeof(v_spec -> 'value') = 'string'
           AND ((v_spec ->> 'value') !~ c_instant OR NOT pg_input_is_valid(v_spec ->> 'value', 'timestamptz')))
       OR (jsonb_typeof(v_spec -> 'expected') = 'string'
           AND ((v_spec ->> 'expected') !~ c_instant OR NOT pg_input_is_valid(v_spec ->> 'expected', 'timestamptz'))) THEN
      RAISE EXCEPTION '%: episode % field %: value and expected must be null or an instant with an explicit offset (Z or +hh:mm)',
        c_writer, p_event_id, v_field;
    END IF;
    IF jsonb_typeof(v_spec -> 'value') = 'string' THEN
      v_new := (v_spec ->> 'value')::timestamptz;
      IF NOT isfinite(v_new) OR v_new > now() THEN
        RAISE EXCEPTION '%: episode % field %: replacement % must be a finite instant, not in the future',
          c_writer, p_event_id, v_field, v_new;
      END IF;
      v_any_dated := true;
    ELSE
      v_any_null := true;
    END IF;
  END LOOP;
  -- Per field: a NULL needs a finding; a date needs a captured document and a basis.
  IF v_any_null AND coalesce(btrim(p_source ->> 'finding'), '') = '' THEN
    RAISE EXCEPTION '%: episode %: a retraction to unknown must state its finding (source.finding)', c_writer, p_event_id;
  END IF;
  IF v_any_dated THEN
    IF NOT (p_source ? 'snapshot_id' OR p_source ? 'lot_row_id') THEN
      RAISE EXCEPTION '%: episode %: a dated replacement must cite a captured document (source.snapshot_id or source.lot_row_id)',
        c_writer, p_event_id;
    END IF;
    IF coalesce(btrim(p_source ->> 'basis'), '') = '' THEN
      RAISE EXCEPTION '%: episode %: a dated replacement must name its basis (source.basis)', c_writer, p_event_id;
    END IF;
  END IF;
  IF (p_source ? 'snapshot_id' AND NOT pg_input_is_valid(p_source ->> 'snapshot_id', 'uuid'))
     OR (p_source ? 'lot_row_id' AND NOT pg_input_is_valid(p_source ->> 'lot_row_id', 'uuid')) THEN
    RAISE EXCEPTION '%: episode %: source.snapshot_id and source.lot_row_id must be uuids', c_writer, p_event_id;
  END IF;

  -- Each retire runs the restrict-FK check on vehicle_observations; without the index that is a heap scan per row.
  IF NOT EXISTS (SELECT 1 FROM pg_index i
                 WHERE i.indexrelid = to_regclass('public.idx_vehicle_observations_source_vehicle_event') AND i.indisvalid) THEN
    RAISE EXCEPTION '%: index idx_vehicle_observations_source_vehicle_event is missing or invalid; refusing to retire rows', c_writer;
  END IF;
  -- The row copy below goes through jsonb; it would be wrong for a generated or identity column.
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.vehicle_events'::regclass AND attnum > 0
               AND NOT attisdropped AND (attgenerated <> '' OR attidentity <> '')) THEN
    RAISE EXCEPTION '%: vehicle_events has a generated or identity column; the row copy needs an explicit column list', c_writer;
  END IF;

  SELECT * INTO v_ev FROM vehicle_events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    SELECT * INTO v_retired FROM superseded_rows
     WHERE source_table = 'vehicle_events' AND row_id = p_event_id AND restored_at IS NULL
     ORDER BY superseded_at DESC LIMIT 1;
    IF FOUND AND v_retired.source ->> 'writer' = c_writer THEN
      RETURN jsonb_build_object('status', 'already', 'event_id', p_event_id,
        'replacement_event_id', v_retired.source ->> 'replacement_event_id', 'superseded_row_id', v_retired.id);
    ELSIF FOUND THEN
      RETURN jsonb_build_object('status', 'retired_elsewhere', 'event_id', p_event_id,
        'superseded_row_id', v_retired.id, 'retired_by', v_retired.asserted_by);
    END IF;
    RETURN jsonb_build_object('status', 'missing', 'event_id', p_event_id);
  END IF;

  -- The citation must belong to this episode.
  v_ep_key := lower(regexp_replace(regexp_replace(regexp_replace(btrim(v_ev.source_url), '[?#].*$', ''),
                '^(https?://)?(www\.)?', '', 'i'), '/+$', ''));
  IF p_source ? 'snapshot_id' THEN
    SELECT s.listing_url, s.http_status INTO v_doc_url, v_doc_status
      FROM listing_page_snapshots s WHERE s.id = (p_source ->> 'snapshot_id')::uuid;
    IF NOT FOUND THEN
      RAISE EXCEPTION '%: episode % cites snapshot % which is not a listing_page_snapshots row',
        c_writer, p_event_id, p_source ->> 'snapshot_id';
    END IF;
    IF v_doc_status IS DISTINCT FROM 200 THEN
      RAISE EXCEPTION '%: episode % cites snapshot % which was not fetched with HTTP 200 (%)',
        c_writer, p_event_id, p_source ->> 'snapshot_id', v_doc_status;
    END IF;
    v_doc_key := lower(regexp_replace(regexp_replace(regexp_replace(btrim(v_doc_url), '[?#].*$', ''),
                   '^(https?://)?(www\.)?', '', 'i'), '/+$', ''));
    IF v_ep_key <> '' AND v_doc_key = v_ep_key THEN
      v_cite := v_cite || jsonb_build_object('snapshot', jsonb_build_object('kind', 'listing_page',
        'snapshot_id', p_source ->> 'snapshot_id', 'snapshot_url', v_doc_url, 'episode_url', v_ev.source_url));
    ELSIF v_doc_key ~ '^[^/]+/auctions/[a-z0-9-]+$' AND left(v_ep_key, length(v_doc_key) + 6) = v_doc_key || '/lots/' THEN
      v_cite := v_cite || jsonb_build_object('snapshot', jsonb_build_object('kind', 'auction_page',
        'auction_code', substring(v_doc_key FROM '/auctions/([a-z0-9-]+)$'),
        'snapshot_id', p_source ->> 'snapshot_id', 'snapshot_url', v_doc_url, 'episode_url', v_ev.source_url));
    ELSE
      RAISE EXCEPTION '%: episode % cites snapshot % (%), which is neither this episode''s page nor its auction''s page (%)',
        c_writer, p_event_id, p_source ->> 'snapshot_id', v_doc_url, v_ev.source_url;
    END IF;
  END IF;
  IF p_source ? 'lot_row_id' THEN
    SELECT a.vehicle_id, a.source_url INTO v_lot_vehicle, v_doc_url
      FROM auction_events a WHERE a.id = (p_source ->> 'lot_row_id')::uuid;
    IF NOT FOUND THEN
      RAISE EXCEPTION '%: episode % cites lot row % which is not an auction_events row',
        c_writer, p_event_id, p_source ->> 'lot_row_id';
    END IF;
    v_doc_key := lower(regexp_replace(regexp_replace(regexp_replace(btrim(v_doc_url), '[?#].*$', ''),
                   '^(https?://)?(www\.)?', '', 'i'), '/+$', ''));
    IF v_lot_vehicle IS DISTINCT FROM v_ev.vehicle_id OR v_ep_key = '' OR v_doc_key IS DISTINCT FROM v_ep_key THEN
      RAISE EXCEPTION '%: episode % cites lot row % (vehicle %, %), which is not this episode''s lot (vehicle %, %)',
        c_writer, p_event_id, p_source ->> 'lot_row_id', v_lot_vehicle, v_doc_url, v_ev.vehicle_id, v_ev.source_url;
    END IF;
    v_cite := v_cite || jsonb_build_object('lot_row', jsonb_build_object('kind', 'lot_row',
      'lot_row_id', p_source ->> 'lot_row_id', 'lot_url', v_doc_url, 'episode_url', v_ev.source_url));
  END IF;

  FOR v_field IN SELECT jsonb_object_keys(p_corrections) LOOP
    v_spec := p_corrections -> v_field;
    v_live := CASE v_field WHEN 'sold_at' THEN v_ev.sold_at WHEN 'ended_at' THEN v_ev.ended_at END;
    v_expected := CASE WHEN jsonb_typeof(v_spec -> 'expected') = 'string' THEN (v_spec ->> 'expected')::timestamptz END;
    v_new := CASE WHEN jsonb_typeof(v_spec -> 'value') = 'string' THEN (v_spec ->> 'value')::timestamptz END;
    IF v_live IS NOT DISTINCT FROM v_new THEN
      CONTINUE;
    ELSIF v_live IS DISTINCT FROM v_expected THEN
      v_stale := v_stale || jsonb_build_object(v_field, jsonb_build_object('live', v_live, 'expected', v_expected));
    ELSE
      v_diff := v_diff || jsonb_build_object(v_field, jsonb_build_object(
        'original', v_live, 'replacement', v_new, 'precision', v_spec -> 'precision'));
    END IF;
  END LOOP;
  IF v_stale <> '{}'::jsonb THEN
    RETURN jsonb_build_object('status', 'stale', 'event_id', p_event_id, 'fields', v_stale);
  END IF;
  IF v_diff = '{}'::jsonb THEN
    RETURN jsonb_build_object('status', 'noop', 'event_id', p_event_id);
  END IF;

  -- Every column known to hold vehicle_events ids (enumeration in the function comment).
  SELECT count(*) INTO v_n FROM vehicle_observations o WHERE o.source_vehicle_event_id = v_ev.id;
  IF v_n > 0 THEN
    v_refs := v_refs || jsonb_build_array(jsonb_build_object('table', 'vehicle_observations', 'column', 'source_vehicle_event_id', 'rows', v_n));
  END IF;
  SELECT count(*) INTO v_n FROM bat_bids b WHERE b.bat_listing_id = v_ev.id;
  IF v_n > 0 THEN
    v_refs := v_refs || jsonb_build_array(jsonb_build_object('table', 'bat_bids', 'column', 'bat_listing_id', 'rows', v_n));
  END IF;
  SELECT count(*) INTO v_n FROM hammer_predictions h WHERE h.external_listing_id = v_ev.id;
  IF v_n > 0 THEN
    v_refs := v_refs || jsonb_build_array(jsonb_build_object('table', 'hammer_predictions', 'column', 'external_listing_id', 'rows', v_n));
  END IF;
  IF jsonb_array_length(v_refs) > 0 THEN
    RETURN jsonb_build_object('status', 'referenced', 'event_id', p_event_id, 'referenced_by', v_refs);
  END IF;

  -- Every check passed: declare the writer, keeping the caller's for asserted_by on later calls.
  IF current_setting('app.writer', true) IS DISTINCT FROM c_writer THEN
    PERFORM set_config('nuke.supersede_caller_writer', coalesce(current_setting('app.writer', true), ''), true);
  END IF;
  PERFORM set_config('app.writer', c_writer, true);

  v_new_id := gen_random_uuid();
  INSERT INTO superseded_rows (source_table, row_id, row_data, asserted_by, source, reason)
  VALUES ('vehicle_events', v_ev.id, to_jsonb(v_ev), v_asserted,
          p_source || jsonb_build_object('writer', c_writer, 'replacement_event_id', v_new_id, 'corrections', v_diff,
                                         'citation_match', v_cite),
          btrim(p_reason))
  RETURNING id INTO v_row_id;

  v_entry := jsonb_build_object('supersedes_event_id', v_ev.id, 'superseded_row_id', v_row_id, 'corrections', v_diff,
    'source', p_source, 'citation_match', v_cite, 'reason', btrim(p_reason), 'asserted_by', v_asserted,
    'writer', c_writer, 'asserted_at', now());
  v_meta := coalesce(v_ev.metadata, '{}'::jsonb);
  v_patch := jsonb_build_object('id', v_new_id, 'updated_at', now());
  FOR v_field IN SELECT jsonb_object_keys(v_diff) LOOP
    v_meta := v_meta - (v_field || '_method') - (v_field || '_precision');
    IF jsonb_typeof(v_diff -> v_field -> 'replacement') = 'string' THEN
      v_meta := v_meta || jsonb_build_object(v_field || '_method', p_source ->> 'basis');
      IF jsonb_typeof(v_diff -> v_field -> 'precision') = 'string' THEN
        v_meta := v_meta || jsonb_build_object(v_field || '_precision', v_diff -> v_field ->> 'precision');
      END IF;
    END IF;
    v_patch := v_patch || jsonb_build_object(v_field, v_diff -> v_field -> 'replacement');
  END LOOP;
  v_meta := v_meta
    || jsonb_build_object('episode_supersessions',
         coalesce(v_meta -> 'episode_supersessions', '[]'::jsonb) || jsonb_build_array(v_entry))
    || jsonb_build_object('clock_locked_by_supersession', jsonb_build_object(
         'fields', (SELECT jsonb_agg(DISTINCT f ORDER BY f) FROM (
                      SELECT jsonb_array_elements_text(coalesce(v_meta -> 'clock_locked_by_supersession' -> 'fields', '[]'::jsonb)) f
                      UNION SELECT jsonb_object_keys(v_diff)) x),
         'superseded_row_id', v_row_id, 'writer', c_writer, 'at', now(),
         'rule', 'landers must not write these fields on this row; correct them only through supersede_vehicle_event_episode'));
  v_patch := v_patch || jsonb_build_object('metadata', v_meta);

  DELETE FROM vehicle_events WHERE id = v_ev.id;
  INSERT INTO vehicle_events SELECT * FROM jsonb_populate_record(NULL::vehicle_events, to_jsonb(v_ev) || v_patch);

  RETURN jsonb_build_object('status', 'superseded', 'event_id', v_ev.id, 'replacement_event_id', v_new_id,
    'superseded_row_id', v_row_id, 'corrections', v_diff, 'citation_match', v_cite, 'asserted_by', v_asserted);
END;
$function$;

CREATE OR REPLACE FUNCTION public.supersede_vehicle_event_episodes(p_rows jsonb, p_asserted_by text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_timeout_ms bigint := (SELECT setting::bigint FROM pg_settings WHERE name = 'statement_timeout');
  v_prev_writer text := current_setting('app.writer', true);
  v_asserted text;
  r          jsonb;
  v_source   jsonb;
  v_res      jsonb;
  v_status   text;
  v_counts   jsonb := jsonb_build_object('superseded', 0, 'already', 0, 'noop', 0, 'stale', 0, 'missing', 0,
                                         'referenced', 0, 'retired_elsewhere', 0);
  v_held     jsonb := '[]'::jsonb;
  v_replaced jsonb := '[]'::jsonb;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'supersede_vehicle_event_episodes: p_rows must be a JSON array';
  END IF;
  IF jsonb_array_length(p_rows) > 100 THEN
    RAISE EXCEPTION 'supersede_vehicle_event_episodes: at most 100 rows per call (got %)', jsonb_array_length(p_rows);
  END IF;
  IF v_timeout_ms < 1 OR v_timeout_ms > 60000 THEN
    RAISE EXCEPTION 'supersede_vehicle_event_episodes: caller must set statement_timeout between 1 ms and 60 s (now % ms)', v_timeout_ms;
  END IF;
  PERFORM set_config('lock_timeout', '3s', true);
  v_asserted := coalesce(nullif(btrim(p_asserted_by), ''), nullif(v_prev_writer, ''), 'agent');

  FOR r IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    IF jsonb_typeof(r) <> 'object' OR NOT pg_input_is_valid(r ->> 'event_id', 'uuid') THEN
      RAISE EXCEPTION 'supersede_vehicle_event_episodes: each row needs a uuid event_id (got %)', left(r::text, 200);
    END IF;
    v_source := r -> 'source';
    IF jsonb_typeof(v_source) = 'object' AND NOT (v_source ? 'asserted_by') THEN
      v_source := v_source || jsonb_build_object('asserted_by', v_asserted);
    END IF;
    v_res := public.supersede_vehicle_event_episode((r ->> 'event_id')::uuid, r -> 'corrections', v_source, r ->> 'reason');
    v_status := v_res ->> 'status';
    v_counts := jsonb_set(v_counts, ARRAY[v_status], to_jsonb(coalesce((v_counts ->> v_status)::int, 0) + 1));
    IF v_status = 'superseded' THEN
      v_replaced := v_replaced || jsonb_build_array(jsonb_build_object(
        'event_id', v_res -> 'event_id', 'replacement_event_id', v_res -> 'replacement_event_id'));
    ELSIF v_status NOT IN ('already', 'noop') THEN
      v_held := v_held || jsonb_build_array(v_res);
    END IF;
  END LOOP;

  -- Hand the caller's declared writer back for the rest of its transaction.
  PERFORM set_config('app.writer', coalesce(v_prev_writer, ''), true);
  RETURN jsonb_build_object('ok', true, 'counts', v_counts, 'replaced', v_replaced, 'held', v_held,
    'asserted_by', v_asserted);
END;
$function$;

REVOKE ALL ON FUNCTION public.supersede_vehicle_event_episode(uuid, jsonb, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.supersede_vehicle_event_episode(uuid, jsonb, jsonb, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.supersede_vehicle_event_episode(uuid, jsonb, jsonb, text) TO service_role;
REVOKE ALL ON FUNCTION public.supersede_vehicle_event_episodes(jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.supersede_vehicle_event_episodes(jsonb, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.supersede_vehicle_event_episodes(jsonb, text) TO service_role;

COMMENT ON FUNCTION public.supersede_vehicle_event_episode(uuid, jsonb, jsonb, text) IS
'Sanctioned correction of a vehicle_events episode''s clocks (sold_at, ended_at) by supersession, never in place: retires the original row whole into superseded_rows (citation and how it matched, reason, asserted_by, replacement id, original and replacement per field) and inserts the corrected episode with a new id, the same listing key and created_at, metadata.episode_supersessions[] pointing back, and metadata.clock_locked_by_supersession {fields, ...}: landers must not write those fields on that row. p_corrections = {field: {value, expected, precision?}}: value and expected are null or an instant with an explicit offset; expected must equal the live value (else stale, no write). p_source needs type and ref; per field, a NULL needs source.finding and a date needs source.basis and a captured document that belongs to the episode: source.snapshot_id (HTTP 200 listing_page_snapshots row whose normalized listing_url is the episode''s URL, or the auction page host/auctions/<code> of the episode''s lot) or source.lot_row_id (auction_events row with the same vehicle_id and normalized URL). p_reason >= 10 characters. Refuses (status referenced, listing which) while any row points at the episode id; columns that hold vehicle_events ids (prod scan 2026-10-06): vehicle_observations.source_vehicle_event_id (FK), bat_bids.bat_listing_id, hammer_predictions.external_listing_id. Caller sets statement_timeout 1..60 s; sets lock_timeout 3 s. Refuses until idx_vehicle_observations_source_vehicle_event is valid, or if vehicle_events gains a generated or identity column. Idempotent (already | noop). Declares app.writer only when it writes. Service role only.';

COMMENT ON FUNCTION public.supersede_vehicle_event_episodes(jsonb, text) IS
'Batch form of supersede_vehicle_event_episode: p_rows is an array of {event_id, corrections, source, reason}, at most 100 per call (runner default 25), in one transaction; a malformed or uncited row aborts the batch. Caller sets statement_timeout 1..60 s; sets lock_timeout 3 s. p_asserted_by (else the caller''s app.writer) is recorded on every row whose source does not name asserted_by; the caller''s app.writer is restored at the end. Returns counts by status (superseded, already, noop, stale, missing, referenced, retired_elsewhere), the replaced ids and the held rows with their reasons (referenced rows list referenced_by). Service role only.';

-- Describe the change in the database. Each comment is replaced only while the live text is the one read on
-- 2026-10-06 (md5 below), so a newer description written by another lane is left alone (NOTICE instead).
DO $describe$
DECLARE
  c_sr text := 'Rows retired from a live table by a sanctioned writer (never a raw DELETE): the full row as it was (row_data), the citation (source), the reason and who asserted it. Restore = re-insert row_data into source_table and set restored_at. Writers: correct_vehicle_event_link (2026-09-28: misattached events, duplicates) and supersede_vehicle_event_episode (2026-10-06: an episode superseded by a corrected row; source.replacement_event_id names it).';
  c_sold text := 'When the vehicle sold through this listing; NULL if not sold. Unit: timestamptz (UTC). Source: extract-bat-core sets it to ended_at when a sale price exists; ingest_bat_live_events sets the frame sale time. Grain: one vehicle listing. Clock: event (source sale). Corrections: supersede_vehicle_event_episode retires the row into superseded_rows and inserts a corrected row (metadata.episode_supersessions); never updated in place by a correction. A row whose metadata carries clock_locked_by_supersession with this field must not be rewritten by a lander. metadata.sold_at_method names how the value was dated.';
  c_ended text := 'When the listing closed or is scheduled to close. Unit: timestamptz (UTC). Source: extract-bat-core writes the BaT end time, or midnight UTC of the end date when only the date is known; ingest_bat_live_events moves it with live extensions. Grain: one vehicle listing. Clock: event (source close). Corrections: supersede_vehicle_event_episode retires the row into superseded_rows and inserts a corrected row (metadata.episode_supersessions); never updated in place by a correction. A row whose metadata carries clock_locked_by_supersession with this field must not be rewritten by a lander.';
  cur text;
BEGIN
  cur := obj_description('public.superseded_rows'::regclass, 'pg_class');
  IF cur IS NOT DISTINCT FROM c_sr THEN NULL;
  ELSIF md5(coalesce(cur, '')) = '23527bb3721327eed44c02e86dc850dd' THEN -- gitleaks:allow (comment fingerprint, not a secret)
    EXECUTE format('COMMENT ON TABLE public.superseded_rows IS %L', c_sr);
  ELSE RAISE NOTICE 'superseded_rows comment changed since 2026-10-06; left as is';
  END IF;

  cur := col_description('public.vehicle_events'::regclass,
           (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.vehicle_events'::regclass AND attname = 'sold_at'));
  IF cur IS NOT DISTINCT FROM c_sold THEN NULL;
  ELSIF md5(coalesce(cur, '')) = '36e90470845b305d023a0f545a4607ef' THEN -- gitleaks:allow (comment fingerprint, not a secret)
    EXECUTE format('COMMENT ON COLUMN public.vehicle_events.sold_at IS %L', c_sold);
  ELSE RAISE NOTICE 'vehicle_events.sold_at comment changed since 2026-10-06; left as is';
  END IF;

  cur := col_description('public.vehicle_events'::regclass,
           (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.vehicle_events'::regclass AND attname = 'ended_at'));
  IF cur IS NOT DISTINCT FROM c_ended THEN NULL;
  ELSIF md5(coalesce(cur, '')) = 'c3def0f2a8d75e485fba6464b9ad1b73' THEN -- gitleaks:allow (comment fingerprint, not a secret)
    EXECUTE format('COMMENT ON COLUMN public.vehicle_events.ended_at IS %L', c_ended);
  ELSE RAISE NOTICE 'vehicle_events.ended_at comment changed since 2026-10-06; left as is';
  END IF;
END;
$describe$;

INSERT INTO public.pipeline_registry (table_name, column_name, owned_by, description, do_not_write_directly, write_via)
VALUES
('vehicle_events', 'sold_at', 'listing landers (extract-bat-core, ingest_bat_live_events, platform extractors)',
 'Sale instant of the listing as the lander read it (event clock, UTC); metadata.sold_at_method names the dating method. A wrong value is corrected by supersession: the row is retired whole into superseded_rows and a corrected row replaces it. Never corrected by UPDATE.',
 false,
 'Landers write it when they land or re-read the listing, except on a row whose metadata.clock_locked_by_supersession lists sold_at (and they merge metadata, never replace it). Corrections: supersede_vehicle_event_episode(s) only, cited by a document that belongs to the episode, expected-value guarded.'),
('vehicle_events', 'ended_at', 'listing landers (extract-bat-core, ingest_bat_live_events, platform extractors)',
 'Close (or scheduled close) instant of the listing as the lander read it (event clock, UTC). A wrong value is corrected by supersession: the row is retired whole into superseded_rows and a corrected row replaces it. Never corrected by UPDATE.',
 false,
 'Landers write it when they land or re-read the listing, except on a row whose metadata.clock_locked_by_supersession lists ended_at (and they merge metadata, never replace it). Corrections: supersede_vehicle_event_episode(s) only, cited by a document that belongs to the episode, expected-value guarded.')
ON CONFLICT (table_name, column_name) DO UPDATE SET
  owned_by = EXCLUDED.owned_by,
  description = EXCLUDED.description,
  do_not_write_directly = EXCLUDED.do_not_write_directly,
  write_via = EXCLUDED.write_via,
  updated_at = now();

COMMIT;
