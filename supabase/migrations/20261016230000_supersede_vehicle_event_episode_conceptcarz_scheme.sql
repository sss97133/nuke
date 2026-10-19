-- supersede_vehicle_event_episode: a conceptcarz:// episode can be relabelled to the conceptcarz source (2026-10-16).
--
-- WHY: 323 vehicle_events labelled source_platform 'gooding' are Conceptcarz auction-result records (source_url
-- conceptcarz://event/NNN/<year make model>, created 2026-02-06 by a backfill with empty metadata). The source_platform rule
-- justified a label by the host of an http(s) source_url, and such a URL has no host, so no sanctioned writer could correct them.
--
-- RULE added: when the episode's source_url starts with conceptcarz://, the only accepted replacement is the 'conceptcarz' slug
-- (an observation_sources row must exist), the citation records url_scheme 'conceptcarz' in citation_match, and source.basis
-- is still required. Every other source_platform case, the clock, source_url and event_status rules are unchanged.
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '10s';

CREATE OR REPLACE FUNCTION public.supersede_vehicle_event_episode(p_event_id uuid, p_corrections jsonb, p_source jsonb, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'UTC'
AS $function$
DECLARE
  c_writer     CONSTANT text := 'supersede_vehicle_event_episode';
  c_fields     CONSTANT text[] := ARRAY['sold_at', 'ended_at', 'source_url', 'source_platform', 'event_status'];
  c_statuses   CONSTANT text[] := ARRAY['sold', 'bid-goes-on', 'unsold', 'ended', 'cancelled', 'unknown'];
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
  v_any_url    boolean := false;
  v_any_plat   boolean := false;
  v_any_status boolean := false;
  v_host_ep    text;
  v_host_src   text;
  v_live_t     text;
  v_expected_t text;
  v_new_t      text;
  v_doc_exact  text;
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
    IF v_field = 'event_status' THEN
      -- A status correction states the result the episode's own lot shows; the citation is that lot (checked below).
      IF jsonb_typeof(v_spec -> 'value') <> 'string' OR jsonb_typeof(v_spec -> 'expected') <> 'string'
         OR btrim(v_spec ->> 'expected') = '' OR NOT (v_spec ->> 'value') = ANY (c_statuses) THEN
        RAISE EXCEPTION '%: episode % field event_status: expected must be non-empty and value one of %',
          c_writer, p_event_id, array_to_string(c_statuses, ', ');
      END IF;
      v_any_status := true;
      CONTINUE;
    END IF;
    IF v_field = 'source_platform' THEN
      -- A platform correction names an observation_sources slug. Whether the episode's own URL belongs to that source
      -- is checked against the live row below; the citation is the URL host (source.basis).
      IF jsonb_typeof(v_spec -> 'value') <> 'string' OR jsonb_typeof(v_spec -> 'expected') <> 'string'
         OR btrim(v_spec ->> 'value') = '' OR btrim(v_spec ->> 'expected') = '' THEN
        RAISE EXCEPTION '%: episode % field source_platform: value and expected must be non-empty platform names',
          c_writer, p_event_id;
      END IF;
      v_any_plat := true;
      CONTINUE;
    END IF;
    IF v_field = 'source_url' THEN
      -- A URL correction restores the true spelling of the listing URL. Both sides are http(s) URLs; unless the
      -- caller flags allow_url_change, the replacement may differ from the live URL by letter case only.
      IF jsonb_typeof(v_spec -> 'value') <> 'string' OR jsonb_typeof(v_spec -> 'expected') <> 'string'
         OR (v_spec ->> 'value') !~ '^https?://[^\s?#]+$' OR (v_spec ->> 'expected') !~ '^https?://[^\s]+$' THEN
        RAISE EXCEPTION '%: episode % field source_url: value and expected must be http(s) URLs (value without query or fragment)',
          c_writer, p_event_id;
      END IF;
      IF lower(v_spec ->> 'value') <> lower(v_spec ->> 'expected') AND (v_spec -> 'allow_url_change') IS DISTINCT FROM 'true'::jsonb THEN
        RAISE EXCEPTION '%: episode % field source_url: the replacement differs from the live URL by more than letter case; flag allow_url_change to proceed',
          c_writer, p_event_id;
      END IF;
      v_any_url := true;
      CONTINUE;
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
  IF v_any_status AND coalesce(btrim(p_source ->> 'basis'), '') = '' THEN
    RAISE EXCEPTION '%: episode %: an event_status correction must name its basis (source.basis)', c_writer, p_event_id;
  END IF;
  IF v_any_plat AND coalesce(btrim(p_source ->> 'basis'), '') = '' THEN
    RAISE EXCEPTION '%: episode %: a source_platform correction must name its basis (source.basis)', c_writer, p_event_id;
  END IF;
  IF v_any_url THEN
    IF NOT (p_source ? 'snapshot_id' OR p_source ? 'lot_row_id') THEN
      RAISE EXCEPTION '%: episode %: a source_url correction must cite a captured document that carries the replacement URL (source.snapshot_id or source.lot_row_id)',
        c_writer, p_event_id;
    END IF;
    IF coalesce(btrim(p_source ->> 'basis'), '') = '' THEN
      RAISE EXCEPTION '%: episode %: a source_url correction must name its basis (source.basis)', c_writer, p_event_id;
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

  -- A status correction cites the episode's own lot: source.ref, normalized like the episode URL, is that URL.
  IF v_any_status THEN
    v_doc_key := lower(regexp_replace(regexp_replace(regexp_replace(btrim(p_source ->> 'ref'), '[?#].*$', ''),
                   '^(https?://)?(www\.)?', '', 'i'), '/+$', ''));
    IF v_ep_key = '' OR v_doc_key IS DISTINCT FROM v_ep_key THEN
      RAISE EXCEPTION '%: episode % cites % for its status, which is not this episode''s lot (%)',
        c_writer, p_event_id, p_source ->> 'ref', v_ev.source_url;
    END IF;
    v_cite := v_cite || jsonb_build_object('lot_page', jsonb_build_object('kind', 'episode_lot',
      'ref', p_source ->> 'ref', 'episode_url', v_ev.source_url, 'basis', p_source ->> 'basis'));
  END IF;

  -- A source_url replacement must be spelled exactly as the cited document's URL (query, fragment and a trailing slash aside).
  IF p_corrections ? 'source_url' THEN
    v_doc_exact := regexp_replace(regexp_replace(btrim(v_doc_url), '[?#].*$', ''), '/+$', '');
    IF v_doc_exact IS DISTINCT FROM regexp_replace(p_corrections -> 'source_url' ->> 'value', '/+$', '') THEN
      RAISE EXCEPTION '%: episode % cites a document at % which does not carry the replacement URL % exactly',
        c_writer, p_event_id, v_doc_url, p_corrections -> 'source_url' ->> 'value';
    END IF;
  END IF;

  FOR v_field IN SELECT jsonb_object_keys(p_corrections) LOOP
    v_spec := p_corrections -> v_field;
    IF v_field IN ('source_url', 'source_platform', 'event_status') THEN
      v_live_t := CASE v_field WHEN 'source_url' THEN v_ev.source_url WHEN 'source_platform' THEN v_ev.source_platform
                  ELSE v_ev.event_status END;
      v_expected_t := v_spec ->> 'expected';
      v_new_t := v_spec ->> 'value';
      IF v_live_t IS NOT DISTINCT FROM v_new_t THEN
        CONTINUE;
      ELSIF v_live_t IS DISTINCT FROM v_expected_t THEN
        v_stale := v_stale || jsonb_build_object(v_field, jsonb_build_object('live', v_live_t, 'expected', v_expected_t));
      ELSE
        IF v_field = 'source_platform' AND v_ev.source_url ~* '^conceptcarz://' THEN
          -- A Conceptcarz result record has no http host; its own URL scheme names the source. Only the 'conceptcarz' slug fits.
          IF v_new_t <> 'conceptcarz' OR NOT EXISTS (SELECT 1 FROM observation_sources o WHERE o.slug = 'conceptcarz') THEN
            RAISE EXCEPTION '%: episode % source_platform %: a conceptcarz:// episode (%) can only be labelled the conceptcarz source',
              c_writer, p_event_id, v_new_t, v_ev.source_url;
          END IF;
          v_cite := v_cite || jsonb_build_object('url_scheme', jsonb_build_object(
            'episode_url', v_ev.source_url, 'scheme', 'conceptcarz', 'source_slug', v_new_t, 'basis', 'conceptcarz scheme'));
        ELSIF v_field = 'source_platform' THEN
          -- The episode's own URL host must be the host of the named source's base_url.
          v_host_ep := lower(substring(v_ev.source_url FROM '^https?://(?:www\.)?([^/?#]+)'));
          SELECT lower(substring(o.base_url FROM '^https?://(?:www\.)?([^/?#]+)')) INTO v_host_src
            FROM observation_sources o WHERE o.slug = v_new_t;
          IF v_host_src IS NULL THEN
            RAISE EXCEPTION '%: episode % source_platform %: no observation_sources row with that slug and a base_url',
              c_writer, p_event_id, v_new_t;
          END IF;
          IF v_host_ep IS DISTINCT FROM v_host_src THEN
            RAISE EXCEPTION '%: episode % source_platform %: the episode URL host (%) is not that source''s host (%)',
              c_writer, p_event_id, v_new_t, v_host_ep, v_host_src;
          END IF;
          v_cite := v_cite || jsonb_build_object('url_host', jsonb_build_object(
            'episode_url', v_ev.source_url, 'host', v_host_ep, 'source_slug', v_new_t, 'source_host', v_host_src));
        END IF;
        v_diff := v_diff || jsonb_build_object(v_field, jsonb_build_object('original', v_live_t, 'replacement', v_new_t));
      END IF;
      CONTINUE;
    END IF;
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
    IF v_field IN ('source_url', 'source_platform', 'event_status') THEN
      v_patch := v_patch || jsonb_build_object(v_field, v_diff -> v_field -> 'replacement');
      CONTINUE;
    END IF;
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

CREATE OR REPLACE FUNCTION public.guard_vehicle_event_clock_locks()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_old_meta jsonb := coalesce(OLD.metadata, '{}'::jsonb);
  v_new_meta jsonb := coalesce(NEW.metadata, '{}'::jsonb);
  v_lock     jsonb := v_old_meta -> 'clock_locked_by_supersession';
  v_fields   text[] := '{}';
  v_blocked  text[] := '{}';
  v_hits     jsonb;
  v_key      text;
BEGIN
  -- 1. The supersession bookkeeping survives a wholesale metadata replacement.
  FOREACH v_key IN ARRAY ARRAY['episode_supersessions', 'clock_locked_by_supersession', 'clock_lock_hits'] LOOP
    IF (v_old_meta ? v_key) AND NOT (v_new_meta ? v_key) THEN
      v_new_meta := v_new_meta || jsonb_build_object(v_key, v_old_meta -> v_key);
    END IF;
  END LOOP;

  -- 2. A locked field keeps its superseded value; the write is recorded, not refused.
  IF v_lock IS NOT NULL THEN
    IF jsonb_typeof(v_lock -> 'fields') = 'array' THEN
      SELECT coalesce(array_agg(f), '{}') INTO v_fields FROM jsonb_array_elements_text(v_lock -> 'fields') AS t(f);
    END IF;
    IF 'sold_at' = ANY (v_fields) AND NEW.sold_at IS DISTINCT FROM OLD.sold_at THEN
      NEW.sold_at := OLD.sold_at;
      v_blocked := array_append(v_blocked, 'sold_at');
    END IF;
    IF 'ended_at' = ANY (v_fields) AND NEW.ended_at IS DISTINCT FROM OLD.ended_at THEN
      NEW.ended_at := OLD.ended_at;
      v_blocked := array_append(v_blocked, 'ended_at');
    END IF;
    IF 'source_url' = ANY (v_fields) AND NEW.source_url IS DISTINCT FROM OLD.source_url THEN
      NEW.source_url := OLD.source_url;
      v_blocked := array_append(v_blocked, 'source_url');
    END IF;
    IF 'source_platform' = ANY (v_fields) AND NEW.source_platform IS DISTINCT FROM OLD.source_platform THEN
      NEW.source_platform := OLD.source_platform;
      v_blocked := array_append(v_blocked, 'source_platform');
    END IF;
    IF 'event_status' = ANY (v_fields) AND NEW.event_status IS DISTINCT FROM OLD.event_status THEN
      NEW.event_status := OLD.event_status;
      v_blocked := array_append(v_blocked, 'event_status');
    END IF;
    IF cardinality(v_blocked) > 0 THEN
      v_hits := CASE WHEN jsonb_typeof(v_new_meta -> 'clock_lock_hits') = 'array'
                     THEN v_new_meta -> 'clock_lock_hits' ELSE '[]'::jsonb END;
      IF jsonb_array_length(v_hits) >= 20 THEN v_hits := v_hits - 0; END IF;
      v_new_meta := v_new_meta || jsonb_build_object('clock_lock_hits', v_hits || jsonb_build_object(
        'at', now(),
        'fields', to_jsonb(v_blocked),
        'app_writer', nullif(current_setting('app.writer', true), ''),
        'db_role', current_user::text));
    END IF;
  END IF;

  NEW.metadata := v_new_meta;
  RETURN NEW;
END
$function$;

COMMENT ON FUNCTION public.supersede_vehicle_event_episode(uuid, jsonb, jsonb, text) IS
  'Sanctioned correction of a vehicle_events episode by supersession, never in place: fields sold_at, ended_at (instants), source_url (letter-case restoration of the listing URL unless allow_url_change) and source_platform (a slug whose base_url host is the host of the episode''s source_url, or the conceptcarz slug for a conceptcarz:// episode; basis required) and event_status (a result status: sold, bid-goes-on, unsold, ended, cancelled, unknown; source.ref must be the episode''s own lot URL; basis required). Retires the original row whole into superseded_rows (citation and how it matched, reason, asserted_by, replacement id, original and replacement per field) and inserts the corrected episode with a new id, the same listing key and created_at, metadata.episode_supersessions[] pointing back, and metadata.clock_locked_by_supersession {fields, ...}: landers must not write those fields on that row (guard_vehicle_event_clock_locks keeps them). p_corrections = {field: {value, expected, precision?, allow_url_change?}}; expected must equal the live value (else stale, no write). Clocks: value and expected are null or an instant with an explicit offset; a NULL needs source.finding, a date needs source.basis and a captured document. source_url: http(s) URLs; a captured document (source.snapshot_id or source.lot_row_id) whose URL equals the replacement exactly, plus source.basis. p_source needs type and ref; p_reason >= 10 characters. The citation must belong to the episode: source.snapshot_id (HTTP 200 listing_page_snapshots row whose normalized listing_url is the episode URL, or its auction page) or source.lot_row_id (auction_events row, same vehicle_id and normalized URL). Refuses (status referenced, listing which) while any row points at the episode id: vehicle_observations.source_vehicle_event_id (FK), bat_bids.bat_listing_id, hammer_predictions.external_listing_id. Caller sets statement_timeout 1..60 s; sets lock_timeout 3 s. Idempotent (already | noop). Declares app.writer only when it writes. Service role only.';

COMMIT;
