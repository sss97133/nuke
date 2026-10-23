-- correct_vehicle_event_attribution: the sanctioned correction of a BaT vehicle_events row's seller attribution
-- (source_organization_id, seller_external_identity_id) and of its metadata, by merge.
--
-- WHY (2026-10-20): before the per-lot fix in extract-bat-core (PR #2366), reading a monitored dealer's lot stamped
-- the dealer on EVERY BaT lot of the vehicle (850 rows across 153 organizations carry a page seller that is not a
-- handle monitored for the organization stamped on them), and the ownership-classification write replaced the whole
-- metadata jsonb (2,379 rows lost seller_username, buyer_username, lot_number and images). No writer covered these
-- columns: supersede_vehicle_event_episode(s) accepts only sold_at, ended_at, source_url, source_platform and
-- event_status; correct_vehicle_event_link moves or retires the row.
--
-- SHAPE (as correct_auction_event_dates): the row is corrected in place (observations, bids and predictions reference
-- it), never replaced. The before-image of every change lives on the row, in metadata.attribution_corrections[]:
-- the original value of each changed column, the metadata keys added or overwritten (with their old values), source,
-- reason, asserted_by, asserted_at, writer.
--
-- correct_vehicle_event_attribution(rows, asserted_by), per row {event_id, source{type, ref, ...}, reason,
-- corrections{ source_organization_id{value, expected}, seller_external_identity_id{value, expected},
--             metadata{merge{key: value, ...}, restore (default true)} }} (at least one of the three):
--   * a cited source (type and ref) and a reason of 10+ characters on every row, else the call raises (nothing written);
--   * BaT rows only (source_platform 'bat'), else the row is refused;
--   * value and expected are an organization / external identity id or null; a non-null value must exist (else refused);
--     the live value must equal expected, else 'stale' (no write for the row); a live value equal to value is 'noop';
--   * metadata is MERGED: the writer adds keys and never removes one. A key the row already holds with a different
--     non-null value makes the row stale (restore=true, the default: the writer restores what is missing, it does not
--     overrule); with restore=false the keys named are overwritten and the old values go to the before-image.
--     The writer's own bookkeeping keys (attribution_corrections, link_corrections, episode_supersessions,
--     clock_locked_by_supersession, clock_lock_hits, live_stream) can never be merged;
--   * a row missing is reported; a row a trigger kept unchanged is reported under 'refused' (counted only if it stuck);
--   * at most 200 rows per call; caller statement_timeout 1..60 s; lock_timeout 3 s; app.writer declared while writing;
--   * SECURITY DEFINER, search_path public, pg_temp; EXECUTE for service_role only. No row changes in this migration.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '3s';

CREATE OR REPLACE FUNCTION public.correct_vehicle_event_attribution(p_rows jsonb, p_asserted_by text DEFAULT 'agent')
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  c_writer     CONSTANT text := 'correct_vehicle_event_attribution';
  c_reserved   CONSTANT text[] := ARRAY['attribution_corrections', 'link_corrections', 'episode_supersessions',
                                        'clock_locked_by_supersession', 'clock_lock_hits', 'live_stream'];
  v_timeout_ms bigint := (SELECT setting::bigint FROM pg_settings WHERE name = 'statement_timeout');
  r            jsonb;
  v_id         uuid;
  v_ev         vehicle_events%ROWTYPE;
  v_after      vehicle_events%ROWTYPE;
  v_corr       jsonb;
  v_spec       jsonb;
  v_merge      jsonb;
  v_restore    boolean;
  v_key        text;
  v_val        jsonb;
  v_live_meta  jsonb;
  v_new_org    uuid;
  v_new_ident  uuid;
  v_do_org     boolean;
  v_do_ident   boolean;
  v_change_org boolean;
  v_change_ident boolean;
  v_added      jsonb;
  v_overwritten jsonb;
  v_conflicts  jsonb;
  v_entry      jsonb;
  v_changes    jsonb;
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

  -- The plan must be well formed and cited before anything is read or written.
  FOR r IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    IF jsonb_typeof(r) <> 'object' OR coalesce(r ->> 'event_id', '') = '' OR NOT pg_input_is_valid(r ->> 'event_id', 'uuid') THEN
      RAISE EXCEPTION '%: each row needs a uuid event_id (got %)', c_writer, left(r::text, 200);
    END IF;
    IF coalesce(r -> 'source' ->> 'type', '') = '' OR coalesce(r -> 'source' ->> 'ref', '') = '' THEN
      RAISE EXCEPTION '%: event % has no cited source (source.type, source.ref)', c_writer, r ->> 'event_id';
    END IF;
    IF length(btrim(coalesce(r ->> 'reason', ''))) < 10 THEN
      RAISE EXCEPTION '%: event % needs a reason of 10+ characters', c_writer, r ->> 'event_id';
    END IF;
    v_corr := r -> 'corrections';
    IF v_corr IS NULL OR jsonb_typeof(v_corr) <> 'object' OR v_corr = '{}'::jsonb THEN
      RAISE EXCEPTION '%: event % has no corrections object', c_writer, r ->> 'event_id';
    END IF;
    FOR v_key IN SELECT jsonb_object_keys(v_corr) LOOP
      IF v_key NOT IN ('source_organization_id', 'seller_external_identity_id', 'metadata') THEN
        RAISE EXCEPTION '%: event % field % is not correctable here (source_organization_id, seller_external_identity_id, metadata)',
          c_writer, r ->> 'event_id', v_key;
      END IF;
      v_spec := v_corr -> v_key;
      IF jsonb_typeof(v_spec) <> 'object' THEN
        RAISE EXCEPTION '%: event % field % must be an object', c_writer, r ->> 'event_id', v_key;
      END IF;
      IF v_key = 'metadata' THEN
        v_merge := v_spec -> 'merge';
        IF v_merge IS NULL OR jsonb_typeof(v_merge) <> 'object' OR v_merge = '{}'::jsonb THEN
          RAISE EXCEPTION '%: event % metadata needs a non-empty merge object', c_writer, r ->> 'event_id';
        END IF;
        IF v_spec ? 'restore' AND jsonb_typeof(v_spec -> 'restore') <> 'boolean' THEN
          RAISE EXCEPTION '%: event % metadata.restore must be true or false', c_writer, r ->> 'event_id';
        END IF;
        IF EXISTS (SELECT 1 FROM jsonb_object_keys(v_merge) k WHERE k = ANY (c_reserved)) THEN
          RAISE EXCEPTION '%: event % metadata.merge names a bookkeeping key (%)', c_writer, r ->> 'event_id',
            array_to_string(c_reserved, ', ');
        END IF;
        IF EXISTS (SELECT 1 FROM jsonb_each(v_merge) e WHERE e.value = 'null'::jsonb) THEN
          RAISE EXCEPTION '%: event % metadata.merge adds or restores keys; a null value would remove one', c_writer, r ->> 'event_id';
        END IF;
      ELSE
        IF NOT (v_spec ? 'value') OR NOT (v_spec ? 'expected')
           OR jsonb_typeof(v_spec -> 'value') NOT IN ('null', 'string') OR jsonb_typeof(v_spec -> 'expected') NOT IN ('null', 'string')
           OR (jsonb_typeof(v_spec -> 'value') = 'string' AND NOT pg_input_is_valid(v_spec ->> 'value', 'uuid'))
           OR (jsonb_typeof(v_spec -> 'expected') = 'string' AND NOT pg_input_is_valid(v_spec ->> 'expected', 'uuid')) THEN
          RAISE EXCEPTION '%: event % field % needs {value, expected}, each a uuid or null', c_writer, r ->> 'event_id', v_key;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  PERFORM set_config('app.writer', c_writer, true);
  FOR r IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    v_id   := (r ->> 'event_id')::uuid;
    v_corr := r -> 'corrections';
    SELECT * INTO v_ev FROM vehicle_events WHERE id = v_id FOR UPDATE;
    IF NOT FOUND THEN v_missing := v_missing || to_jsonb(v_id); CONTINUE; END IF;
    IF v_ev.source_platform IS DISTINCT FROM 'bat' THEN
      v_refused := v_refused || jsonb_build_object('event_id', v_id,
        'why', 'not a BaT row (source_platform ' || coalesce(v_ev.source_platform, 'null') || ')');
      CONTINUE;
    END IF;

    v_do_org := v_corr ? 'source_organization_id';
    v_do_ident := v_corr ? 'seller_external_identity_id';
    v_change_org := false; v_change_ident := false;
    v_new_org := nullif(v_corr -> 'source_organization_id' ->> 'value', '')::uuid;
    v_new_ident := nullif(v_corr -> 'seller_external_identity_id' ->> 'value', '')::uuid;
    v_live_meta := coalesce(v_ev.metadata, '{}'::jsonb);
    v_added := '{}'::jsonb; v_overwritten := '{}'::jsonb; v_conflicts := '{}'::jsonb;
    v_changes := '{}'::jsonb;

    BEGIN
      -- 1. source_organization_id
      IF v_do_org AND v_ev.source_organization_id IS DISTINCT FROM v_new_org THEN
        IF v_ev.source_organization_id IS DISTINCT FROM nullif(v_corr -> 'source_organization_id' ->> 'expected', '')::uuid THEN
          v_stale := v_stale || jsonb_build_object('event_id', v_id, 'why', 'source_organization_id',
            'live', v_ev.source_organization_id, 'expected', v_corr -> 'source_organization_id' -> 'expected');
          CONTINUE;
        END IF;
        IF v_new_org IS NOT NULL AND NOT EXISTS (SELECT 1 FROM organizations WHERE id = v_new_org) THEN
          v_refused := v_refused || jsonb_build_object('event_id', v_id, 'why', 'organization ' || v_new_org || ' does not exist');
          CONTINUE;
        END IF;
        v_change_org := true;
      END IF;
      -- 2. seller_external_identity_id
      IF v_do_ident AND v_ev.seller_external_identity_id IS DISTINCT FROM v_new_ident THEN
        IF v_ev.seller_external_identity_id IS DISTINCT FROM nullif(v_corr -> 'seller_external_identity_id' ->> 'expected', '')::uuid THEN
          v_stale := v_stale || jsonb_build_object('event_id', v_id, 'why', 'seller_external_identity_id',
            'live', v_ev.seller_external_identity_id, 'expected', v_corr -> 'seller_external_identity_id' -> 'expected');
          CONTINUE;
        END IF;
        IF v_new_ident IS NOT NULL AND NOT EXISTS (SELECT 1 FROM external_identities WHERE id = v_new_ident) THEN
          v_refused := v_refused || jsonb_build_object('event_id', v_id, 'why', 'external identity ' || v_new_ident || ' does not exist');
          CONTINUE;
        END IF;
        v_change_ident := true;
      END IF;
      -- 3. metadata: add or restore keys, never remove one
      IF v_corr ? 'metadata' THEN
        v_merge := v_corr -> 'metadata' -> 'merge';
        v_restore := coalesce((v_corr -> 'metadata' ->> 'restore')::boolean, true);
        FOR v_key, v_val IN SELECT e.key, e.value FROM jsonb_each(v_merge) e LOOP
          IF NOT (v_live_meta ? v_key) OR v_live_meta -> v_key = 'null'::jsonb THEN
            v_added := v_added || jsonb_build_object(v_key, v_val);
          ELSIF v_live_meta -> v_key IS DISTINCT FROM v_val THEN
            IF v_restore THEN
              v_conflicts := v_conflicts || jsonb_build_object(v_key, jsonb_build_object('live', v_live_meta -> v_key, 'merge', v_val));
            ELSE
              v_overwritten := v_overwritten || jsonb_build_object(v_key, v_live_meta -> v_key);
              v_added := v_added || jsonb_build_object(v_key, v_val);
            END IF;
          END IF;
        END LOOP;
        IF v_conflicts <> '{}'::jsonb THEN
          v_stale := v_stale || jsonb_build_object('event_id', v_id, 'why', 'metadata', 'conflicts', v_conflicts);
          CONTINUE;
        END IF;
      END IF;

      IF NOT v_change_org AND NOT v_change_ident AND v_added = '{}'::jsonb THEN
        v_noop := v_noop || to_jsonb(v_id);
        CONTINUE;
      END IF;

      -- The before-image of exactly what this call changes.
      IF v_change_org THEN
        v_changes := v_changes || jsonb_build_object('source_organization_id',
          jsonb_build_object('original', v_ev.source_organization_id, 'corrected', v_new_org));
      END IF;
      IF v_change_ident THEN
        v_changes := v_changes || jsonb_build_object('seller_external_identity_id',
          jsonb_build_object('original', v_ev.seller_external_identity_id, 'corrected', v_new_ident));
      END IF;
      IF v_added <> '{}'::jsonb THEN
        v_changes := v_changes || jsonb_build_object('metadata', jsonb_build_object(
          'added_keys', (SELECT jsonb_agg(k ORDER BY k) FROM jsonb_object_keys(v_added) k),
          'overwritten_originals', v_overwritten));
      END IF;
      v_entry := jsonb_build_object('changes', v_changes, 'source', r -> 'source', 'reason', btrim(r ->> 'reason'),
        'asserted_by', p_asserted_by, 'asserted_at', now(), 'writer', c_writer);

      UPDATE vehicle_events SET
        source_organization_id = CASE WHEN v_change_org THEN v_new_org ELSE source_organization_id END,
        seller_external_identity_id = CASE WHEN v_change_ident THEN v_new_ident ELSE seller_external_identity_id END,
        updated_at = now(),
        metadata = v_live_meta || v_added || jsonb_build_object('attribution_corrections',
          CASE WHEN jsonb_typeof(v_live_meta -> 'attribution_corrections') = 'array'
               THEN v_live_meta -> 'attribution_corrections' ELSE '[]'::jsonb END || jsonb_build_array(v_entry))
      WHERE id = v_id;

      -- a BEFORE UPDATE trigger (preserve_bat_live_projection) can keep the live row silently: count only what stuck
      SELECT * INTO v_after FROM vehicle_events WHERE id = v_id;
      IF (v_change_org AND v_after.source_organization_id IS DISTINCT FROM v_new_org)
         OR (v_change_ident AND v_after.seller_external_identity_id IS DISTINCT FROM v_new_ident)
         OR (v_added <> '{}'::jsonb AND (v_after.metadata @> v_added) IS NOT TRUE) THEN
        RAISE EXCEPTION 'a trigger kept the live row';
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

REVOKE ALL ON FUNCTION public.correct_vehicle_event_attribution(jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.correct_vehicle_event_attribution(jsonb, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.correct_vehicle_event_attribution(jsonb, text) TO service_role;
COMMENT ON FUNCTION public.correct_vehicle_event_attribution(jsonb, text) IS
  'Sanctioned correction of a BaT vehicle_events row''s source_organization_id, seller_external_identity_id and metadata (merge: adds or restores keys, never removes one), in place: cited source and reason required, expected values must equal the live ones (else stale), before-image kept on the row in metadata.attribution_corrections[]. BaT rows only, <= 200 rows per call, caller statement_timeout 1..60 s, service role only (2026-10-20).';

-- Name the owner of the corrected columns and the path for corrections.
INSERT INTO public.pipeline_registry (table_name, column_name, owned_by, description, do_not_write_directly, write_via)
VALUES
 ('vehicle_events', 'source_organization_id',
  'listing landers (extract-bat-core stamps the organization of a monitored dealer on the lot it reads)',
  'The organization whose bat_seller_monitors handle is the seller of THIS lot. Attribution is per lot, never per vehicle: a resale of the same vehicle by another seller stays unattributed.',
  false,
  'Landers write it for the lot they read. Corrections: correct_vehicle_event_attribution(p_rows, p_asserted_by) (BaT rows, cited, expected-value guarded, before-image in metadata.attribution_corrections[]).'),
 ('vehicle_events', 'seller_external_identity_id',
  'listing landers (extract-bat-core for monitored dealers; the lot''s own seller identity is auction_events.seller_external_identity_id)',
  'The BaT member who sold THIS lot. Per lot, never per vehicle.',
  false,
  'Landers write it for the lot they read. Corrections: correct_vehicle_event_attribution(p_rows, p_asserted_by) (BaT rows, cited, expected-value guarded, before-image in metadata.attribution_corrections[]).')
ON CONFLICT (table_name, column_name) DO UPDATE SET
  owned_by = EXCLUDED.owned_by,
  description = EXCLUDED.description,
  do_not_write_directly = EXCLUDED.do_not_write_directly,
  write_via = EXCLUDED.write_via,
  updated_at = now();
COMMIT;
