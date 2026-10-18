-- Keys lane, 2026-10-07 (case C28 §12, the "key" stage): resolve the vehicle_events episodes whose vehicle_id names no
-- vehicles row. Re-point an episode to the one vehicle that holds its lot; retire it whole into superseded_rows when
-- its lot already has an episode elsewhere or no vehicle holds the lot; hold anything ambiguous.
--
-- WHY. vehicle_events_vehicle_id_fkey is NOT VALID (20260927170100: ON DELETE RESTRICT, re-added without validation
-- because 16,026 rows already pointed at no vehicle; they arrived while RI triggers were off). Since then the key checks
-- every new or changed row and blocks every delete of a vehicle that has episodes, so the population is closed: no new
-- dangling row can appear. Every vehicle-joined reader already skips these rows; readers that do not join (counts by
-- platform, vehicle_event_summary) still count them, and the constraint cannot be validated while they exist.
--
-- MEASURED (prod, read-only through scripts/data/q.sh, 2026-10-07 00:59-01:35Z, every dangling row read, no sample):
--   16,017 rows (15,682 distinct vehicle ids): bat 10,558, barrettjackson 5,234, mecum 83, pcarmarket 83, bonhams 39,
--   collecting_cars 7, cars_and_bids 5, sbx 3, broad_arrow 3, classic-com 1, gooding 1. Created 2025-12 to 2026-03
--   (bat: extract-auction-comments 10,298; barrettjackson: no writer marker).
--   Merged: 0. No merge record names any of the 15,682 ids as the duplicate: vehicle_merge_proposals (1,245 merged),
--     merge_proposals (17 executed, 4 approved), timeline_events profile_merged (62), merge_deleted_rows (0 rows),
--     reattribution_audit (0 rows naming one). A soft merge keeps the duplicate's vehicles row, so a merged vehicle is
--     never dangling.
--   Deleted with a record: 0. There is no vehicles row to carry deleted_at, and no deletion log names any id.
--   Never existed: not provable. Every one of the 15,682 ids is still referenced by other tables (auction_comments,
--     vehicle_observations, auction_events, bat_listings, external_listings, timeline_events): the vehicle row is gone
--     and its testimony family is orphaned with it. 15 ids are named as the primary of a December 2025 merge
--     (timeline_events profile_merged), so those vehicles existed then and were removed later without a record.
--   With merge and deletion records empty, the evidence that decides is the lot (dry run of this rule, 01:33Z):
--     retire_duplicate   2,674  the lot is already an episode, on one existing vehicle, holding every fact this copy has
--     held_duplicate_adds_fact 1,143  same, but this copy carries a final_price, sold_at or ended_at the kept episode
--                                      lacks (price 327, sold_at 892, ended_at 783): a field merge decides, not a retire
--     repoint              781  exactly one vehicle holds the lot (its lot row, listing or vehicle URL) and no vehicle
--                                has an episode for it (barrettjackson 723, bat 38, mecum 20)
--     retire_missing    10,820  no vehicle holds the lot
--     held_ambiguous       470  two or more vehicles hold the lot
--     held_other_platform  129  the lot is an episode on a vehicle under another platform label (127 barrettjackson
--                                lots on 'unknown', 'bat' or 'mecum' rows)
--     held_referenced, held_locked, held_target_not_live, held_target_key_taken, held_metadata_not_object: 0
--   Spot check of 13 repoint targets (6 barrettjackson, 4 bat, 3 mecum): each target's year, make and model match the
--   lot URL; most targets were created 2026-03-25/26 with the lot URL and have no episode.
--
-- RULE (resolve_dangling_vehicle_events). A row is a candidate when no vehicles row has its vehicle_id. Its lot is the
-- BaT listing slug (lower-cased, from bringatrailer.com/listing/<slug>) on bat rows, else the URL key
-- normalize_listing_url_key(source_url), matched against stored URLs in its 8 scheme, www and trailing-slash spellings
-- and the raw URL. A vehicle holds the lot when its vehicles row exists and it has
--   * an episode of the lot: another vehicle_events row with the same slug (bat) or URL, of any platform label; or
--   * a lot record: auction_events or bat_listings with the slug (bat), external_listings with the URL key, or
--     vehicles.discovery_url, listing_url or bat_auction_url equal to the URL.
-- Checked in this order, the first match decides:
--   held_locked        metadata carries clock_locked_by_supersession or episode_supersessions (supersession's rows);
--   held_referenced    vehicle_observations.source_vehicle_event_id (restrict FK), bat_bids.bat_listing_id or
--                      hammer_predictions.external_listing_id names the episode;
--   held_ambiguous     two or more vehicles hold the lot;
--   held_other_platform the one holder has an episode of the lot under another platform label;
--   held_duplicate_adds_fact / retire_duplicate  the one holder has an episode of the lot on the same platform: held
--                      when this copy has a final_price, sold_at or ended_at that none of those episodes has, else
--                      retired as a duplicate of the earliest one;
--   held_target_not_live / held_target_key_taken / held_metadata_not_object / held_dangling_twin / repoint  the one
--                      holder has only a lot record: re-pointed when that vehicle is not deleted or merged, holds no
--                      episode with this row's (platform, key) or (platform, URL), this row's metadata is a JSON object
--                      (the audit entry is merged into it), and no earlier candidate of the same call re-points the
--                      same lot to the same vehicle (that one waits for the next pass, then reads as a duplicate);
--   retire_missing     no vehicle holds the lot.
--
-- WRITES (only these; p_actions chooses which of the three actions apply, the rest are counted as planned):
--   retire_duplicate, retire_missing: the 2026-09-28 retire pattern (retire_rows, correct_vehicle_event_link). One
--     statement deletes the row and inserts it whole into superseded_rows: row_data = to_jsonb(row), source = {type
--     rule, ref, writer, class, missing_vehicle_id, lot, duplicate_of_event, lot_vehicle_id, operator}, reason in words.
--     Restore = re-insert row_data (the id is kept); for retire_missing, once a vehicles row with that id exists.
--   repoint: vehicle_id := the holder; metadata.link_corrections[] += {from_vehicle_id, to_vehicle_id, source (rule,
--     lot, held_by: which records hold the lot), reason, asserted_by, asserted_at}, the shape correct_vehicle_event_link
--     writes; updated_at := now() (the column is the write clock). The clocks are untouched; locked rows are held, so
--     trg_guard_vehicle_event_clock_locks never fires; preserve_bat_live_projection passes (no fact column changes).
--   write_receipts: one row per table and operation that changed rows (vehicle_events DELETE and UPDATE, superseded_rows
--     INSERT); neither table has a write-receipt trigger. app.writer is set with set_config for the call and restored to
--     the caller's value on return (a function-level SET of a custom parameter is refused for prod's deploy role: #722).
--   Each retire runs the restrict-FK check on vehicle_observations, so retire actions refuse to run unless
--   idx_vehicle_observations_source_vehicle_event is valid (as in supersede_vehicle_event_episode).
--
-- SCHEMA_LAW: no table, column, kind or vocabulary value. One function, one pipeline_registry row
-- (vehicle_events.vehicle_id had none), and comments. The class names are return keys and superseded_rows.source.class
-- values written by this function only (superseded_rows.source is free-form jsonb by design).
-- No row changes in this migration. Rows change only when the function is called with retire or repoint actions.
-- Contract: supabase/sql/test_dangling_vehicle_events.sql (PostgreSQL 17, CI job metric-fold-health-contract), applied
-- as a non-superuser that owns the fixture tables, as prod's deploy role does. Applied by CI, never by hand.

BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.resolve_dangling_vehicle_events(
  p_batch integer DEFAULT 1000,
  p_from_block bigint DEFAULT 0,
  p_actions text[] DEFAULT ARRAY['retire_duplicate', 'repoint', 'retire_missing']
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '5s'
AS $fn$
DECLARE
  c_max_block constant bigint := 4294967295;  -- largest block number a tid can hold
  c_writer constant text := 'resolve-dangling-vehicle-events';
  c_actions constant text[] := ARRAY['retire_duplicate', 'repoint', 'retire_missing'];
  v_prev_writer text := current_setting('app.writer', true);
  v_timeout_ms bigint := (SELECT setting::bigint FROM pg_catalog.pg_settings WHERE name = 'statement_timeout');
  v_rows_per_page numeric;
  v_table_blocks bigint := pg_catalog.pg_relation_size('public.vehicle_events') / current_setting('block_size')::bigint;
  v_blocks_after bigint;
  v_blocks bigint;
  v_next bigint;
  v_lo tid;
  v_hi tid;
  v_res record;
BEGIN
  IF p_batch IS NULL OR p_batch < 1 OR p_batch > 100000 THEN
    RAISE EXCEPTION 'resolve_dangling_vehicle_events: p_batch must be 1..100000, got %', p_batch;
  END IF;
  IF p_from_block IS NULL OR p_from_block < 0 THEN
    RAISE EXCEPTION 'resolve_dangling_vehicle_events: p_from_block must be >= 0, got %', p_from_block;
  END IF;
  IF p_actions IS NULL OR NOT (p_actions <@ c_actions) OR array_position(p_actions, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'resolve_dangling_vehicle_events: p_actions must be a subset of % (an empty array counts only), got %',
      c_actions, p_actions;
  END IF;
  IF v_timeout_ms < 1 OR v_timeout_ms > 60000 THEN
    RAISE EXCEPTION 'resolve_dangling_vehicle_events: caller must set statement_timeout between 1 ms and 60 s (now % ms)', v_timeout_ms;
  END IF;
  -- Each retire runs the restrict-FK check on vehicle_observations; without the index that is a heap scan per row.
  IF p_actions && ARRAY['retire_duplicate', 'retire_missing']
     AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_index i
                     WHERE i.indexrelid = to_regclass('public.idx_vehicle_observations_source_vehicle_event') AND i.indisvalid) THEN
    RAISE EXCEPTION 'resolve_dangling_vehicle_events: index idx_vehicle_observations_source_vehicle_event is missing or invalid; refusing to retire rows';
  END IF;

  -- Past the end (or past the largest tid block): nothing to scan; report done before building any tid.
  IF p_from_block >= v_table_blocks OR p_from_block >= c_max_block THEN
    RETURN jsonb_build_object(
      'retired_duplicate', 0, 'retired_missing', 0, 'repointed', 0, 'dangling_seen', 0,
      'planned_retire_duplicate', 0, 'planned_retire_missing', 0, 'planned_repoint', 0,
      'held_ambiguous', 0, 'held_other_platform', 0, 'held_duplicate_adds_fact', 0, 'held_referenced', 0,
      'held_locked', 0, 'held_target_not_live', 0, 'held_target_key_taken', 0, 'held_metadata_not_object', 0,
      'held_dangling_twin', 0,
      'from_block', p_from_block, 'next_block', p_from_block, 'blocks_scanned', 0,
      'table_blocks', v_table_blocks, 'remaining_blocks', 0, 'est_rows_remaining_to_scan', 0,
      'done', true);
  END IF;

  SELECT CASE WHEN relpages > 0 AND reltuples > 0 THEN reltuples::numeric / relpages ELSE 18 END
    INTO v_rows_per_page FROM pg_catalog.pg_class WHERE oid = 'public.vehicle_events'::regclass;
  v_blocks := greatest(1, ceil(p_batch / greatest(v_rows_per_page, 1)))::bigint;
  v_next := least(p_from_block + v_blocks, c_max_block);
  v_lo := format('(%s,0)', p_from_block)::tid;
  v_hi := format('(%s,0)', v_next)::tid;

  -- Declare the writer for this call only; the caller's value is restored before returning.
  PERFORM set_config('app.writer', c_writer, true);

  -- One statement: the range's dangling rows; the holders of each row's lot; the rule's action; the retire (DELETE +
  -- INSERT into superseded_rows) and the re-point (UPDATE), each limited to the actions in $3 and re-checking that the
  -- row still points at no vehicle and at the vehicle the plan read. A retired row leaves the heap; a re-pointed row is
  -- no longer dangling; a held row is not moved: each dangling row is counted once per complete walk. The planned and
  -- held counts come from the statement's snapshot.
  EXECUTE $q$
    WITH cand AS MATERIALIZED (
      SELECT e.id, e.vehicle_id, e.source_platform, e.source_url, e.source_listing_id, e.sold_at, e.ended_at,
             e.final_price, e.created_at, e.metadata,
             (coalesce(e.metadata ? 'clock_locked_by_supersession', false)
              OR coalesce(e.metadata ? 'episode_supersessions', false)) AS locked,
             CASE WHEN e.source_platform = 'bat'
                  THEN lower(substring(e.source_url FROM 'bringatrailer\.com/listing/([^/?#]+)')) END AS slug,
             public.normalize_listing_url_key(e.source_url) AS uk
      FROM public.vehicle_events e
      WHERE e.ctid >= $1 AND e.ctid < $2
        AND NOT EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = e.vehicle_id)
    ), ev AS MATERIALIZED (
      SELECT c.*,
             CASE WHEN c.uk IS NULL THEN '{}'::text[] ELSE
               ARRAY(SELECT s || w || c.uk || t
                     FROM unnest(ARRAY['http://', 'https://']) s, unnest(ARRAY['', 'www.']) w, unnest(ARRAY['', '/']) t)
               || c.source_url END AS variants
      FROM cand c
    ), held AS MATERIALIZED (
      SELECT ev.*, eps.ep_vehicles, eps.ep_other_vehicles, eps.dup_of, eps.kept_price, eps.kept_sold, eps.kept_ended,
             lots.lot_vehicles, lots.lot_sources,
             (EXISTS (SELECT 1 FROM public.vehicle_observations o WHERE o.source_vehicle_event_id = ev.id)
              OR EXISTS (SELECT 1 FROM public.bat_bids b WHERE b.bat_listing_id = ev.id)
              OR ev.id IN (SELECT hp.external_listing_id FROM public.hammer_predictions hp
                           WHERE hp.external_listing_id IS NOT NULL)) AS referenced
      FROM ev
      CROSS JOIN LATERAL (
        SELECT coalesce(array_agg(DISTINCT t.vehicle_id) FILTER (WHERE t.source_platform = ev.source_platform), '{}'::uuid[]) AS ep_vehicles,
               coalesce(array_agg(DISTINCT t.vehicle_id) FILTER (WHERE t.source_platform <> ev.source_platform), '{}'::uuid[]) AS ep_other_vehicles,
               (array_agg(t.id ORDER BY t.created_at, t.id) FILTER (WHERE t.source_platform = ev.source_platform))[1] AS dup_of,
               coalesce(bool_or(t.final_price IS NOT NULL) FILTER (WHERE t.source_platform = ev.source_platform), false) AS kept_price,
               coalesce(bool_or(t.sold_at IS NOT NULL) FILTER (WHERE t.source_platform = ev.source_platform), false) AS kept_sold,
               coalesce(bool_or(t.ended_at IS NOT NULL) FILTER (WHERE t.source_platform = ev.source_platform), false) AS kept_ended
        FROM public.vehicle_events t
        WHERE t.id <> ev.id
          AND EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = t.vehicle_id)
          AND ((ev.slug IS NOT NULL AND t.source_platform = 'bat'
                AND lower(substring(t.source_url FROM 'bringatrailer\.com/listing/([^/?#]+)')) = ev.slug)
            OR t.source_url = ANY (ev.variants))
      ) eps
      CROSS JOIN LATERAL (
        SELECT coalesce(array_agg(DISTINCT h.vid), '{}'::uuid[]) AS lot_vehicles,
               coalesce(jsonb_agg(DISTINCT jsonb_build_object('source', h.src, 'vehicle_id', h.vid)), '[]'::jsonb) AS lot_sources
        FROM (
          SELECT 'auction_events' AS src, a.vehicle_id AS vid FROM public.auction_events a
            WHERE ev.slug IS NOT NULL
              AND lower(substring(a.source_url FROM 'bringatrailer\.com/listing/([^/?#]+)')) = ev.slug
          UNION ALL
          SELECT 'bat_listings', b.vehicle_id FROM public.bat_listings b
            WHERE ev.slug IS NOT NULL
              AND lower(substring(b.bat_listing_url FROM 'bringatrailer\.com/listing/([^/?#]+)')) = ev.slug
          UNION ALL
          SELECT 'external_listings', l.vehicle_id FROM public.external_listings l
            WHERE ev.uk IS NOT NULL AND l.listing_url_key = ev.uk
              AND l.platform = ANY (ARRAY['bat', 'barrettjackson', 'mecum', 'pcarmarket', 'bonhams', 'cars_and_bids',
                                          'collecting_cars', 'sbx', 'broad_arrow', 'classic_com', 'gooding', 'rmsothebys'])
          UNION ALL
          SELECT 'vehicles.discovery_url', v.id FROM public.vehicles v WHERE v.discovery_url = ANY (ev.variants)
          UNION ALL
          SELECT 'vehicles.listing_url', v.id FROM public.vehicles v WHERE v.listing_url = ANY (ev.variants)
          UNION ALL
          SELECT 'vehicles.bat_auction_url', v.id FROM public.vehicles v WHERE v.bat_auction_url = ANY (ev.variants)
        ) h
        WHERE h.vid IS NOT NULL AND EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = h.vid)
      ) lots
    ), judged AS MATERIALIZED (
      SELECT x.*,
             CASE
               WHEN x.locked THEN 'held_locked'
               WHEN x.referenced THEN 'held_referenced'
               WHEN cardinality(x.holders) >= 2 THEN 'held_ambiguous'
               WHEN cardinality(x.ep_other_vehicles) > 0 THEN 'held_other_platform'
               WHEN cardinality(x.ep_vehicles) = 1 AND x.adds_fact THEN 'held_duplicate_adds_fact'
               WHEN cardinality(x.ep_vehicles) = 1 THEN 'retire_duplicate'
               WHEN cardinality(x.lot_vehicles) = 1 AND NOT x.target_live THEN 'held_target_not_live'
               WHEN cardinality(x.lot_vehicles) = 1 AND x.target_key_taken THEN 'held_target_key_taken'
               WHEN cardinality(x.lot_vehicles) = 1 AND x.metadata_not_object THEN 'held_metadata_not_object'
               WHEN cardinality(x.lot_vehicles) = 1 THEN 'repoint'
               ELSE 'retire_missing'
             END AS verdict
      FROM (
        SELECT held.*,
               ARRAY(SELECT DISTINCT u FROM unnest(held.ep_vehicles || held.ep_other_vehicles || held.lot_vehicles) u) AS holders,
               ((held.final_price IS NOT NULL AND NOT held.kept_price) OR (held.sold_at IS NOT NULL AND NOT held.kept_sold)
                OR (held.ended_at IS NOT NULL AND NOT held.kept_ended)) AS adds_fact,
               EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = held.lot_vehicles[1]
                         AND v.deleted_at IS NULL AND v.merged_into_vehicle_id IS NULL) AS target_live,
               EXISTS (SELECT 1 FROM public.vehicle_events t
                       WHERE t.vehicle_id = held.lot_vehicles[1] AND t.source_platform = held.source_platform
                         AND ((held.source_listing_id IS NOT NULL AND t.source_listing_id = held.source_listing_id)
                           OR (held.source_listing_id IS NULL AND t.source_listing_id IS NULL
                               AND t.source_url = held.source_url))) AS target_key_taken,
               (held.metadata IS NOT NULL AND jsonb_typeof(held.metadata) <> 'object') AS metadata_not_object
        FROM held
      ) x
    ), plan AS MATERIALIZED (
      -- Two candidates of one call re-pointing the same lot to the same vehicle: the earliest goes, the others wait for
      -- the next pass, where the moved one is an episode of the lot and they read as duplicates.
      SELECT j.*,
             CASE WHEN j.verdict = 'repoint'
                   AND row_number() OVER (PARTITION BY j.verdict, j.lot_vehicles[1], coalesce(j.slug, j.uk)
                                          ORDER BY j.created_at, j.id) > 1
                  THEN 'held_dangling_twin' ELSE j.verdict END AS action
      FROM judged j
    ), gone AS (
      DELETE FROM public.vehicle_events e
      USING plan p
      WHERE e.id = p.id
        AND p.action IN ('retire_duplicate', 'retire_missing')
        AND p.action = ANY ($3)
        AND e.vehicle_id = p.vehicle_id
        AND NOT EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = e.vehicle_id)
      RETURNING e.*
    ), archived AS (
      INSERT INTO public.superseded_rows (source_table, row_id, row_data, asserted_by, source, reason)
      SELECT 'vehicle_events', g.id, to_jsonb(g), $4,
             jsonb_build_object(
               'type', 'rule', 'ref', 'resolve_dangling_vehicle_events', 'writer', $4, 'class', p.action,
               'missing_vehicle_id', g.vehicle_id,
               'lot', jsonb_build_object('platform', g.source_platform, 'bat_slug', p.slug, 'url_key', p.uk),
               'duplicate_of_event', p.dup_of,
               'lot_vehicle_id', CASE WHEN p.action = 'retire_duplicate' THEN p.holders[1] END,
               'operator', $5),
             CASE p.action
               WHEN 'retire_duplicate' THEN format(
                 'Dangling vehicle_id: no vehicles row has id %s. The same lot is already an episode on vehicle %s (event %s), which holds every fact this copy carries; retired as a duplicate of that episode.',
                 g.vehicle_id, p.holders[1], p.dup_of)
               ELSE format(
                 'Dangling vehicle_id: no vehicles row has id %s, no merge or deletion record names a surviving vehicle, and no vehicle holds this lot (no other episode, lot row, listing or vehicle URL). Retired whole; restore by re-inserting row_data once a vehicles row with that id exists.',
                 g.vehicle_id)
             END
      FROM gone g JOIN plan p ON p.id = g.id
      RETURNING (source ->> 'class') AS cls
    ), moved AS (
      UPDATE public.vehicle_events e
      SET vehicle_id = p.lot_vehicles[1],
          updated_at = now(),
          metadata = coalesce(e.metadata, '{}'::jsonb) || jsonb_build_object('link_corrections',
            (CASE WHEN jsonb_typeof(e.metadata -> 'link_corrections') = 'array'
                  THEN e.metadata -> 'link_corrections' ELSE '[]'::jsonb END)
            || jsonb_build_array(jsonb_build_object(
                 'from_vehicle_id', e.vehicle_id,
                 'to_vehicle_id', p.lot_vehicles[1],
                 'source', jsonb_build_object('type', 'rule', 'ref', 'resolve_dangling_vehicle_events', 'writer', $4,
                             'class', 'repoint',
                             'lot', jsonb_build_object('platform', e.source_platform, 'bat_slug', p.slug, 'url_key', p.uk),
                             'held_by', p.lot_sources, 'operator', $5),
                 'reason', 'Dangling vehicle_id: no vehicles row had this id. Exactly one vehicle holds the lot (its lot row, listing or vehicle URL) and no vehicle had an episode for it, so the episode moved to that vehicle.',
                 'asserted_by', $4,
                 'asserted_at', now())))
      FROM plan p
      WHERE e.id = p.id
        AND p.action = 'repoint'
        AND 'repoint' = ANY ($3)
        AND e.vehicle_id = p.vehicle_id
        AND NOT EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = e.vehicle_id)
        AND EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = p.lot_vehicles[1]
                      AND v.deleted_at IS NULL AND v.merged_into_vehicle_id IS NULL)
      RETURNING e.id
    )
    SELECT (SELECT count(*) FROM archived WHERE cls = 'retire_duplicate')::bigint AS retired_duplicate,
           (SELECT count(*) FROM archived WHERE cls = 'retire_missing')::bigint AS retired_missing,
           (SELECT count(*) FROM moved)::bigint AS repointed,
           count(*)::bigint AS dangling_seen,
           count(*) FILTER (WHERE action = 'retire_duplicate')::bigint AS planned_retire_duplicate,
           count(*) FILTER (WHERE action = 'retire_missing')::bigint AS planned_retire_missing,
           count(*) FILTER (WHERE action = 'repoint')::bigint AS planned_repoint,
           count(*) FILTER (WHERE action = 'held_ambiguous')::bigint AS held_ambiguous,
           count(*) FILTER (WHERE action = 'held_other_platform')::bigint AS held_other_platform,
           count(*) FILTER (WHERE action = 'held_duplicate_adds_fact')::bigint AS held_duplicate_adds_fact,
           count(*) FILTER (WHERE action = 'held_referenced')::bigint AS held_referenced,
           count(*) FILTER (WHERE action = 'held_locked')::bigint AS held_locked,
           count(*) FILTER (WHERE action = 'held_target_not_live')::bigint AS held_target_not_live,
           count(*) FILTER (WHERE action = 'held_target_key_taken')::bigint AS held_target_key_taken,
           count(*) FILTER (WHERE action = 'held_metadata_not_object')::bigint AS held_metadata_not_object,
           count(*) FILTER (WHERE action = 'held_dangling_twin')::bigint AS held_dangling_twin
    FROM plan
  $q$ INTO v_res USING v_lo, v_hi, p_actions, c_writer, nullif(v_prev_writer, '');

  -- Neither table has a write-receipt trigger; record this writer's statements the way record_write_receipt does.
  IF v_res.retired_duplicate + v_res.retired_missing > 0 THEN
    INSERT INTO public.write_receipts (tbl, op, rows, writer, db_role, app_name, txid)
    VALUES ('vehicle_events', 'DELETE', (v_res.retired_duplicate + v_res.retired_missing)::integer, c_writer, current_user,
            current_setting('application_name', true), txid_current()),
           ('superseded_rows', 'INSERT', (v_res.retired_duplicate + v_res.retired_missing)::integer, c_writer, current_user,
            current_setting('application_name', true), txid_current());
  END IF;
  IF v_res.repointed > 0 THEN
    INSERT INTO public.write_receipts (tbl, op, rows, writer, db_role, app_name, txid)
    VALUES ('vehicle_events', 'UPDATE', v_res.repointed::integer, c_writer, current_user,
            current_setting('application_name', true), txid_current());
  END IF;

  -- New tuple versions may have extended the heap; the walk is done only when it has passed the current end.
  v_blocks_after := pg_catalog.pg_relation_size('public.vehicle_events') / current_setting('block_size')::bigint;

  -- Hand the caller's declared writer back for the rest of its transaction.
  PERFORM set_config('app.writer', coalesce(v_prev_writer, ''), true);

  RETURN jsonb_build_object(
    'retired_duplicate', v_res.retired_duplicate,
    'retired_missing', v_res.retired_missing,
    'repointed', v_res.repointed,
    'dangling_seen', v_res.dangling_seen,
    'planned_retire_duplicate', v_res.planned_retire_duplicate,
    'planned_retire_missing', v_res.planned_retire_missing,
    'planned_repoint', v_res.planned_repoint,
    'held_ambiguous', v_res.held_ambiguous,
    'held_other_platform', v_res.held_other_platform,
    'held_duplicate_adds_fact', v_res.held_duplicate_adds_fact,
    'held_referenced', v_res.held_referenced,
    'held_locked', v_res.held_locked,
    'held_target_not_live', v_res.held_target_not_live,
    'held_target_key_taken', v_res.held_target_key_taken,
    'held_metadata_not_object', v_res.held_metadata_not_object,
    'held_dangling_twin', v_res.held_dangling_twin,
    'from_block', p_from_block,
    'next_block', v_next,
    'blocks_scanned', greatest(0, least(v_next, v_table_blocks) - p_from_block),
    'table_blocks', v_blocks_after,
    'remaining_blocks', greatest(0, v_blocks_after - v_next),
    'est_rows_remaining_to_scan', round(greatest(0, v_blocks_after - v_next) * v_rows_per_page),
    'done', v_next >= v_blocks_after OR v_next >= c_max_block
  );
END
$fn$;

COMMENT ON FUNCTION public.resolve_dangling_vehicle_events(integer, bigint, text[]) IS
'Sanctioned resolution of vehicle_events rows whose vehicle_id names no vehicles row (2026-10-07; vehicle_events_vehicle_id_fkey is NOT VALID, so 16,017 such rows existed, and none can be added since). Scans about p_batch rows by physical block range starting at p_from_block. A row''s lot is its BaT slug (bat) or normalize_listing_url_key(source_url); a vehicle holds the lot when its row exists and it has an episode of the lot (any platform label) or a lot record (auction_events or bat_listings by slug, external_listings by URL key, vehicles discovery_url, listing_url or bat_auction_url). First match decides: held_locked (supersession metadata), held_referenced (vehicle_observations.source_vehicle_event_id, bat_bids.bat_listing_id, hammer_predictions.external_listing_id), held_ambiguous (2+ holders), held_other_platform, held_duplicate_adds_fact or retire_duplicate (the one holder has a same-platform episode; held when this copy has a final_price, sold_at or ended_at that episode lacks), held_target_not_live, held_target_key_taken, held_metadata_not_object, held_dangling_twin or repoint (the one holder has only a lot record), else retire_missing. Retire = DELETE + INSERT of the whole row into superseded_rows (source.class, missing_vehicle_id, lot, duplicate_of_event; restore = re-insert row_data). Repoint = vehicle_id to the holder, metadata.link_corrections[] audit entry (correct_vehicle_event_link''s shape), updated_at now(); clocks untouched. p_actions (subset of retire_duplicate, repoint, retire_missing; empty counts only) chooses what applies; the rest are counted as planned. Refuses retire actions unless idx_vehicle_observations_source_vehicle_event is valid. One write_receipts row per table and operation that changed rows (writer resolve-dangling-vehicle-events); app.writer is set with set_config for the call and restored on return; lock_timeout 5 s. Caller sets statement_timeout (1..60 s) and passes next_block back in. Returns applied counts (retired_duplicate, retired_missing, repointed), planned and held counts per class (statement snapshot), dangling_seen, next_block, remaining_blocks, blocks_scanned, done. Dry run 2026-10-07: retire_duplicate 2,674, repoint 781, retire_missing 10,820; held 1,742 (duplicate_adds_fact 1,143, ambiguous 470, other_platform 129).';

REVOKE ALL ON FUNCTION public.resolve_dangling_vehicle_events(integer, bigint, text[]) FROM PUBLIC;
DO $grants$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.resolve_dangling_vehicle_events(integer, bigint, text[]) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.resolve_dangling_vehicle_events(integer, bigint, text[]) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.resolve_dangling_vehicle_events(integer, bigint, text[]) TO service_role;
  END IF;
END $grants$;

-- Name the writer where the column and the archive are described (once; a newer description is extended, not replaced).
DO $describe$
DECLARE cur text;
BEGIN
  cur := col_description('public.vehicle_events'::regclass,
           (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.vehicle_events'::regclass AND attname = 'vehicle_id'));
  IF cur IS NULL THEN
    COMMENT ON COLUMN public.vehicle_events.vehicle_id IS
    'Vehicle listed, FK to vehicles.id (NOT VALID, ON DELETE RESTRICT). NOT NULL. Unit: none. Source: the extractor that resolved the vehicle. Grain: one vehicle listing. Clock: n/a. Rows whose vehicle_id names no vehicles row: resolve_dangling_vehicle_events() re-points them to the one vehicle holding their lot, retires them into superseded_rows, or holds them (2026-10-07).';
  ELSIF cur NOT LIKE '%resolve_dangling_vehicle_events%' THEN
    EXECUTE format('COMMENT ON COLUMN public.vehicle_events.vehicle_id IS %L', cur
      || ' Rows whose vehicle_id names no vehicles row: resolve_dangling_vehicle_events() re-points them to the one vehicle holding their lot, retires them into superseded_rows, or holds them (2026-10-07).');
  END IF;

  cur := obj_description('public.superseded_rows'::regclass, 'pg_class');
  IF cur IS NOT NULL AND cur NOT LIKE '%resolve_dangling_vehicle_events%' THEN
    EXECUTE format('COMMENT ON TABLE public.superseded_rows IS %L', cur
      || ' Also resolve_dangling_vehicle_events (2026-10-07): episodes whose vehicle_id names no vehicles row, retired as a duplicate of a live episode of the same lot or because no vehicle holds the lot (source.class, source.missing_vehicle_id).');
  END IF;
END
$describe$;

-- Owner of the reference (none was registered). A row that already names this writer is left as it is.
INSERT INTO public.pipeline_registry (table_name, column_name, owned_by, description, do_not_write_directly, write_via)
VALUES
('vehicle_events', 'vehicle_id', 'listing landers (the extractor that resolved the vehicle)',
 'Vehicle the episode belongs to: FK to vehicles.id (NOT VALID, ON DELETE RESTRICT; every new or changed row is checked, every delete of a vehicle with episodes is refused). Rows that predate the key and name no vehicle are resolved by resolve_dangling_vehicle_events; a misattached episode is moved by correct_vehicle_event_link.',
 false,
 'At insert: the lander that resolved the vehicle. Corrections: correct_vehicle_event_link(p_rows, p_asserted_by) (cited move or retire, expected_vehicle_id guarded); resolve_dangling_vehicle_events(p_batch, p_from_block, p_actions) for rows whose vehicle_id names no vehicles row (re-point to the one holder of the lot, retire into superseded_rows, or hold).')
ON CONFLICT (table_name, column_name) DO UPDATE SET
  owned_by = EXCLUDED.owned_by,
  description = EXCLUDED.description,
  do_not_write_directly = EXCLUDED.do_not_write_directly,
  write_via = EXCLUDED.write_via,
  updated_at = now()
WHERE pipeline_registry.write_via IS NULL OR pipeline_registry.write_via NOT LIKE '%resolve_dangling_vehicle_events%';

COMMIT;
