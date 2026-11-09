-- Disposable PG17 only. Reuse actual external-bid writer and its collision/supersession contract.
\set ON_ERROR_STOP on
\ir test_external_auction_bids_cross_platform.sql
SET statement_timeout='3s';
SET lock_timeout='1s';
ALTER TABLE vehicles ADD COLUMN deleted_at timestamptz, ADD COLUMN merged_into_vehicle_id uuid,
 ADD COLUMN status text, ADD COLUMN vin text, ADD COLUMN listing_url text, ADD COLUMN origin_metadata jsonb;
ALTER TABLE auction_events ADD COLUMN duplicate_of uuid REFERENCES auction_events(id),
 ADD COLUMN canonical_listing_url text, ADD COLUMN raw_data jsonb, ADD COLUMN outcome text,
 ADD COLUMN high_bid numeric, ADD COLUMN total_bids integer, ADD COLUMN comments_count integer,
 ADD COLUMN unique_bidders integer, ADD COLUMN watchers integer, ADD COLUMN page_views integer,
 ADD COLUMN auction_end_date timestamptz, ADD COLUMN lot_number text, ADD COLUMN winning_bid numeric,
 ADD COLUMN merged_from_vehicle_id uuid;
ALTER TABLE auction_comments ADD COLUMN merged_from_vehicle_id uuid;
CREATE TABLE vehicle_events(id uuid PRIMARY KEY, vehicle_id uuid REFERENCES vehicles(id), source_platform text,
 source_url text, source_listing_id text, event_type text,event_status text,sold_at timestamptz,metadata jsonb,
 updated_at timestamptz DEFAULT now(),merged_from_vehicle_id uuid,current_price numeric,bid_count integer,
 currency_code text,ended_at timestamptz);
CREATE TABLE vehicle_observations(id uuid PRIMARY KEY,vehicle_id uuid REFERENCES vehicles(id),is_superseded boolean DEFAULT false,
 merged_from_vehicle_id uuid,source_url text,source_identifier text,kind text,source_id uuid,extraction_method text,observed_at timestamptz,
 ingested_at timestamptz,raw_source_ref text,vehicle_match_signals jsonb,structured_data jsonb,
 extraction_metadata jsonb,auction_event_id uuid REFERENCES auction_events(id),
 source_vehicle_event_id uuid REFERENCES vehicle_events(id),subject_type text,subject_id uuid);
CREATE TABLE listing_page_snapshots(id uuid PRIMARY KEY,platform text,success boolean,http_status integer,
 fetched_at timestamptz,listing_url text,html_sha256 text);
CREATE TABLE observation_sources(id uuid PRIMARY KEY,slug text UNIQUE);
CREATE TABLE superseded_rows(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),source_table text,row_id uuid,
 row_data jsonb,asserted_by text,source jsonb,reason text,superseded_at timestamptz DEFAULT now());
CREATE TABLE auction_event_duplicate_mark(id bigserial PRIMARY KEY,event_id uuid,duplicate_of uuid,
 vehicle_id uuid,source text,canonical_listing_url text,run_id text,marked_at timestamptz DEFAULT now(),retired_at timestamptz);
CREATE TABLE auction_event_links(id uuid PRIMARY KEY,from_auction_event_id uuid,to_auction_event_id uuid);
CREATE TABLE hammer_predictions(id uuid PRIMARY KEY,auction_event_id uuid);
CREATE TABLE reattribution_audit(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),observation_type text,
 old_observation_id uuid,old_vehicle_id uuid,new_observation_id uuid,new_vehicle_id uuid,reason text,actor_user_id uuid);
CREATE SCHEMA auth;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT 'service_role'::text $$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
CREATE FUNCTION public.user_can_edit_vehicle(uuid,uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.canonical_listing_url(text) RETURNS text LANGUAGE sql IMMUTABLE
 AS $$ SELECT regexp_replace(lower($1),'/$','') $$;
\ir ../migrations/20261016163000_correct_auction_event_link.sql
\ir ../migrations/20261016181500_correct_auction_event_link_dependents.sql

-- Exact existing sanctioned helper bodies, retained from the read-only live definition audit.
CREATE OR REPLACE FUNCTION public.correct_vehicle_event_link(p_rows jsonb, p_asserted_by text DEFAULT 'agent'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$;


CREATE OR REPLACE FUNCTION public.relink_testimony(p_observation_type text, p_observation_id uuid, p_target_vehicle_id uuid, p_reason text, p_actor_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_old_vehicle_id uuid;
  v_merged_from_vehicle_id uuid;
  v_is_primary boolean;
  v_file_hash text;
  v_demoted boolean := false;
BEGIN
  -- P3.7 identity check (2026-09-27): the actor is the caller (p_actor_user_id = auth.uid()) and can edit the target vehicle; stays SECURITY INVOKER so RLS still governs the source rows. Only end-user JWTs are judged; service_role and JWT-less sessions are exempt.
  IF coalesce(auth.role(), '') IN ('authenticated', 'anon') THEN
    IF auth.uid() IS NULL OR p_actor_user_id IS DISTINCT FROM auth.uid() OR NOT public.user_can_edit_vehicle(p_target_vehicle_id, auth.uid()) THEN
      RAISE EXCEPTION 'relink_testimony: you can only relink as yourself onto a vehicle you can edit' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'relink_testimony: attribution requires a reason' USING ERRCODE = '22023';
  END IF;
  IF p_observation_type NOT IN ('image', 'observation') THEN
    RAISE EXCEPTION 'observation_type must be image or observation, got %', p_observation_type;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM vehicles WHERE id = p_target_vehicle_id AND deleted_at IS NULL AND status IS DISTINCT FROM 'merged') THEN
    RAISE EXCEPTION 'target vehicle % does not exist', p_target_vehicle_id;
  END IF;

  IF p_observation_type = 'image' THEN
    SELECT vehicle_id, COALESCE(is_primary, false), file_hash, merged_from_vehicle_id
      INTO v_old_vehicle_id, v_is_primary, v_file_hash, v_merged_from_vehicle_id
      FROM vehicle_images WHERE id = p_observation_id FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'image % not found', p_observation_id;
    END IF;

    IF v_old_vehicle_id IS NOT DISTINCT FROM p_target_vehicle_id THEN
      RETURN jsonb_build_object('success', true, 'duplicate', true, 'mode', 'already_attributed',
                                'observation_id', p_observation_id, 'vehicle_id', p_target_vehicle_id,
                                'merged_from_vehicle_id', v_merged_from_vehicle_id);
    END IF;

    -- Guard: (vehicle_id, file_hash) unique — content already on target.
    IF v_file_hash IS NOT NULL AND EXISTS (
      SELECT 1 FROM vehicle_images b
      WHERE b.vehicle_id = p_target_vehicle_id AND b.file_hash = v_file_hash
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'file_hash_exists_on_target',
                                'observation_id', p_observation_id);
    END IF;

    -- Guard: one-primary-per-vehicle unique index. Demote the MOVED row, never
    -- the target's existing primary (workflow state, not testimony content).
    IF v_is_primary AND EXISTS (
      SELECT 1 FROM vehicle_images b
      WHERE b.vehicle_id = p_target_vehicle_id
        AND b.is_primary = true
        AND COALESCE(b.is_document, false) = false
        AND COALESCE(b.is_duplicate, false) = false
    ) THEN
      v_demoted := true;
    END IF;

    UPDATE vehicle_images
       SET vehicle_id = p_target_vehicle_id,
           merged_from_vehicle_id = COALESCE(merged_from_vehicle_id, v_old_vehicle_id),
           is_primary = CASE WHEN v_demoted THEN false ELSE is_primary END,
           updated_at = NOW()
     WHERE id = p_observation_id
     RETURNING merged_from_vehicle_id INTO v_merged_from_vehicle_id;

  ELSE
    SELECT vehicle_id, merged_from_vehicle_id INTO v_old_vehicle_id, v_merged_from_vehicle_id
      FROM vehicle_observations WHERE id = p_observation_id FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'observation % not found', p_observation_id;
    END IF;

    IF v_old_vehicle_id IS NOT DISTINCT FROM p_target_vehicle_id THEN
      RETURN jsonb_build_object('success', true, 'duplicate', true, 'mode', 'already_attributed',
                                'observation_id', p_observation_id, 'vehicle_id', p_target_vehicle_id,
                                'merged_from_vehicle_id', v_merged_from_vehicle_id);
    END IF;

    IF EXISTS (
      SELECT 1 FROM vehicle_observations o JOIN auction_events e ON e.id = o.auction_event_id
      WHERE o.id = p_observation_id AND e.vehicle_id IS NOT NULL AND e.vehicle_id <> p_target_vehicle_id
    ) THEN
      RAISE EXCEPTION 'target chassis contradicts the typed market event' USING ERRCODE = '23514';
    END IF;

    UPDATE vehicle_observations
       SET vehicle_id = p_target_vehicle_id,
           merged_from_vehicle_id = COALESCE(merged_from_vehicle_id, v_old_vehicle_id),
           subject_id = CASE WHEN subject_type = 'vehicle' AND subject_id IS NOT NULL
             THEN p_target_vehicle_id ELSE subject_id END
     WHERE id = p_observation_id
     RETURNING merged_from_vehicle_id INTO v_merged_from_vehicle_id;
  END IF;

  INSERT INTO reattribution_audit (
    observation_type, old_observation_id, old_vehicle_id,
    new_observation_id, new_vehicle_id, reason, actor_user_id)
  VALUES (
    p_observation_type, p_observation_id, v_old_vehicle_id,
    p_observation_id, p_target_vehicle_id,
    p_reason || CASE WHEN v_demoted THEN ' [is_primary demoted: target already has a primary]' ELSE '' END,
    p_actor_user_id);

  RETURN jsonb_build_object(
    'success', true,
    'mode', 'relink_in_place',
    'observation_type', p_observation_type,
    'observation_id', p_observation_id,
    'old_vehicle_id', v_old_vehicle_id,
    'new_vehicle_id', p_target_vehicle_id,
    'merged_from_vehicle_id', v_merged_from_vehicle_id,
    'demoted_primary', v_demoted);
END;
$function$;


\ir ../migrations/20261109031652_preserved_native_lot_correction.sql
\ir ../migrations/20261109031652_preserved_native_lot_correction.sql
\ir test_preserved_native_lot_correction_cases.sql


