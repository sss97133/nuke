-- supersede_vehicle_event_episode: re-pointing mode for referenced episodes.
-- source.repoint_references = true moves vehicle_observations.source_vehicle_event_id, bat_bids.bat_listing_id and
-- hammer_predictions.external_listing_id from the retired id to the replacement id, one log row per moved row.
-- Default behaviour (no flag) is unchanged: status 'referenced'. Rollback: supabase/rollbacks/20261025141000_supersede_repoint_down.sql

create table if not exists public.vehicle_event_repoint_log (
  id bigserial primary key,
  superseded_row_id uuid not null,
  old_event_id uuid not null,
  new_event_id uuid not null,
  ref_table text not null check (ref_table in ('vehicle_observations','bat_bids','hammer_predictions')),
  ref_column text not null,
  ref_row_id uuid not null,
  repointed_at timestamptz not null default now(),
  reverted_at timestamptz,
  revert_note text
);
create index if not exists vehicle_event_repoint_log_sr on public.vehicle_event_repoint_log(superseded_row_id);
alter table public.vehicle_event_repoint_log enable row level security;

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
  v_cc_no      text;
  v_sib_ids    uuid[];
  v_sib_n      integer;
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
  v_repoint    boolean := false;
  v_moved      jsonb := '{}'::jsonb;
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
          IF v_new_t = 'conceptcarz' THEN
            IF NOT EXISTS (SELECT 1 FROM observation_sources o WHERE o.slug = 'conceptcarz') THEN
              RAISE EXCEPTION '%: episode % source_platform conceptcarz: no observation_sources row for it', c_writer, p_event_id;
            END IF;
            v_cite := v_cite || jsonb_build_object('url_scheme', jsonb_build_object(
              'episode_url', v_ev.source_url, 'scheme', 'conceptcarz', 'source_slug', v_new_t, 'basis', 'conceptcarz scheme'));
          ELSE
            -- The auction house the Conceptcarz event maps to: at least 2 OTHER episodes of the same conceptcarz event, named in
            -- source.sibling_event_ids, each already labelled with this house. The caller states that no labelled sibling of the
            -- event carries a different house (checked by the caller over the whole event; the function verifies the ones named).
            v_cc_no := substring(v_ev.source_url FROM '^conceptcarz://event/(\d+)/');
            IF v_cc_no IS NULL OR jsonb_typeof(p_source -> 'sibling_event_ids') IS DISTINCT FROM 'array' THEN
              RAISE EXCEPTION '%: episode % source_platform %: a house label for a conceptcarz:// episode needs the event number in its URL and source.sibling_event_ids',
                c_writer, p_event_id, v_new_t;
            END IF;
            SELECT coalesce(array_agg(DISTINCT x::uuid), '{}') INTO v_sib_ids
              FROM jsonb_array_elements_text(p_source -> 'sibling_event_ids') AS t(x) WHERE pg_input_is_valid(x, 'uuid');
            SELECT count(*) INTO v_sib_n FROM vehicle_events e
             WHERE e.id = ANY (v_sib_ids) AND e.id <> v_ev.id AND e.source_platform = v_new_t
               AND e.source_url LIKE 'conceptcarz://event/' || v_cc_no || '/%';
            IF v_sib_n < 2 OR v_sib_n <> cardinality(v_sib_ids) THEN
              RAISE EXCEPTION '%: episode % source_platform %: conceptcarz event % needs at least 2 named sibling episodes all labelled that house (verified % of % named)',
                c_writer, p_event_id, v_new_t, v_cc_no, v_sib_n, cardinality(v_sib_ids);
            END IF;
            v_cite := v_cite || jsonb_build_object('conceptcarz_event_house', jsonb_build_object(
              'episode_url', v_ev.source_url, 'event', v_cc_no, 'house_slug', v_new_t, 'siblings_verified', v_sib_n,
              'basis', 'sibling conceptcarz episodes of event ' || v_cc_no || ' are labelled ' || v_new_t));
          END IF;
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
    -- Re-pointing mode: source.repoint_references = true moves every referencing row to the replacement id, logged per row
    -- in vehicle_event_repoint_log (revert: revert_vehicle_event_repoint). Without it the episode is refused as before.
    IF (p_source -> 'repoint_references') IS DISTINCT FROM 'true'::jsonb THEN
      RETURN jsonb_build_object('status', 'referenced', 'event_id', p_event_id, 'referenced_by', v_refs,
        'hint', 'set source.repoint_references=true to move the referencing rows to the replacement id');
    END IF;
    SELECT coalesce(sum((r ->> 'rows')::bigint), 0) INTO v_n FROM jsonb_array_elements(v_refs) r;
    IF v_n > 5000 THEN
      RAISE EXCEPTION '%: episode % has % referencing rows; re-pointing is capped at 5000 per episode', c_writer, p_event_id, v_n;
    END IF;
    v_repoint := true;
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

  IF v_repoint THEN
    INSERT INTO vehicle_event_repoint_log (superseded_row_id, old_event_id, new_event_id, ref_table, ref_column, ref_row_id)
    SELECT v_row_id, v_ev.id, v_new_id, 'vehicle_observations', 'source_vehicle_event_id', o.id FROM vehicle_observations o WHERE o.source_vehicle_event_id = v_ev.id
    UNION ALL SELECT v_row_id, v_ev.id, v_new_id, 'bat_bids', 'bat_listing_id', b.id FROM bat_bids b WHERE b.bat_listing_id = v_ev.id
    UNION ALL SELECT v_row_id, v_ev.id, v_new_id, 'hammer_predictions', 'external_listing_id', h.id FROM hammer_predictions h WHERE h.external_listing_id = v_ev.id;
    -- vehicle_observations has a RESTRICT FK: detach for the delete, re-attach to the replacement right after (same transaction)
    UPDATE vehicle_observations SET source_vehicle_event_id = NULL WHERE source_vehicle_event_id = v_ev.id;
  END IF;

  DELETE FROM vehicle_events WHERE id = v_ev.id;
  INSERT INTO vehicle_events SELECT * FROM jsonb_populate_record(NULL::vehicle_events, to_jsonb(v_ev) || v_patch);

  IF v_repoint THEN
    UPDATE vehicle_observations o SET source_vehicle_event_id = v_new_id FROM vehicle_event_repoint_log l
     WHERE l.superseded_row_id = v_row_id AND l.ref_table = 'vehicle_observations' AND o.id = l.ref_row_id;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('vehicle_observations', v_n);
    UPDATE bat_bids b SET bat_listing_id = v_new_id FROM vehicle_event_repoint_log l
     WHERE l.superseded_row_id = v_row_id AND l.ref_table = 'bat_bids' AND b.id = l.ref_row_id;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('bat_bids', v_n);
    UPDATE hammer_predictions h SET external_listing_id = v_new_id FROM vehicle_event_repoint_log l
     WHERE l.superseded_row_id = v_row_id AND l.ref_table = 'hammer_predictions' AND h.id = l.ref_row_id;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('hammer_predictions', v_n);
  END IF;

  RETURN jsonb_build_object('status', 'superseded', 'event_id', v_ev.id, 'replacement_event_id', v_new_id,
    'superseded_row_id', v_row_id, 'corrections', v_diff, 'citation_match', v_cite, 'asserted_by', v_asserted,
    'repointed', CASE WHEN v_repoint THEN v_moved END);
END;
$function$;

revoke all on function public.supersede_vehicle_event_episode(uuid, jsonb, jsonb, text) from public, anon, authenticated;

-- Move the rows of one re-pointing back to the original event id. The original row must exist again (restore the
-- superseded_rows entry first); rows whose original event is missing are skipped with a note.
create or replace function public.revert_vehicle_event_repoint(p_superseded_row_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare n_obs int := 0; n_bb int := 0; n_hp int := 0; v_old uuid;
begin
  select old_event_id into v_old from vehicle_event_repoint_log where superseded_row_id = p_superseded_row_id and reverted_at is null limit 1;
  if v_old is null then return jsonb_build_object('status','nothing_to_revert'); end if;
  if not exists (select 1 from vehicle_events where id = v_old) then
    update vehicle_event_repoint_log set revert_note = 'original event ' || v_old || ' does not exist; restore it from superseded_rows first'
     where superseded_row_id = p_superseded_row_id and reverted_at is null;
    return jsonb_build_object('status','original_missing','old_event_id',v_old);
  end if;
  update vehicle_observations o set source_vehicle_event_id = l.old_event_id from vehicle_event_repoint_log l
   where l.superseded_row_id = p_superseded_row_id and l.reverted_at is null and l.ref_table = 'vehicle_observations' and o.id = l.ref_row_id;
  get diagnostics n_obs = row_count;
  update bat_bids b set bat_listing_id = l.old_event_id from vehicle_event_repoint_log l
   where l.superseded_row_id = p_superseded_row_id and l.reverted_at is null and l.ref_table = 'bat_bids' and b.id = l.ref_row_id;
  get diagnostics n_bb = row_count;
  update hammer_predictions h set external_listing_id = l.old_event_id from vehicle_event_repoint_log l
   where l.superseded_row_id = p_superseded_row_id and l.reverted_at is null and l.ref_table = 'hammer_predictions' and h.id = l.ref_row_id;
  get diagnostics n_hp = row_count;
  update vehicle_event_repoint_log set reverted_at = now() where superseded_row_id = p_superseded_row_id and reverted_at is null;
  return jsonb_build_object('status','reverted','vehicle_observations',n_obs,'bat_bids',n_bb,'hammer_predictions',n_hp);
end $$;
revoke all on function public.revert_vehicle_event_repoint(uuid) from public, anon, authenticated;
