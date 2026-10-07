-- Keys lane, 2026-10-07 (case C28 §12, the "key" stage): fill vehicle_events.source_listing_id on the Gooding and
-- RM Sotheby's episodes that orphan-backfill-v1 wrote without one, so the landers find them by their listing key.
--
-- WHY. vehicle_events' listing key is the partial unique index idx_vehicle_events_dedup (vehicle_id, source_platform,
-- source_listing_id) WHERE source_listing_id IS NOT NULL. extract-gooding and extract-rmsothebys read an episode by
-- that key (_shared/vehicleEventWrite.ts readByKey: vehicle_id + platform + source_listing_id), where the key is
-- normalizeListingUrlKey(url) (_shared/listingUrl.ts, the TS twin of public.normalize_listing_url_key, migration
-- 20260112000002). A row with a NULL key is invisible to that read and outside the index, so a re-land inserts a
-- second episode for the same lot (review of PR #696, 2026-10-06 21:15-21:30Z).
--
-- MEASURED (prod, read-only through scripts/data/q.sh, 2026-10-07 00:54-01:14Z):
--   Whole table: 184,993 rows on 97 platforms carry a source_url and no source_listing_id. In scope here: gooding
--   5,032 of 5,246 rows and rm-sothebys 2,452 of 2,474 rows. All 7,484 were written by orphan-backfill-v1
--   (extraction_method). Every keyed gooding row (214) and rm-sothebys row (22) carries
--   key = normalize_listing_url_key(source_url), the convention the landers write. Other platforms' landers key
--   differently (BaT: lot id or URL key), so this writer touches no other platform.
--   URL classes of the 7,484:
--     gooding: 4,678 on goodingco.com/lot/ (3,290 without www, 1,388 with); 323 conceptcarz:// pseudo-URLs (an event id,
--       a title and a chassis text, not a web page); 31 on other sites (12 bringatrailer.com, 19 barrett-jackson.com).
--     rm-sothebys: 1,145 on rmsothebys.com/auctions/; 1,307 conceptcarz://.
--   A pseudo-URL key is no lander's key (no lander computes it), and normalize_listing_url_key cuts it at the '#' of
--   "Chassis#:", dropping the chassis number. A page on another site under a gooding row is a platform question.
--   Both stay NULL and are counted.
--   Collisions: 0 rows whose key a keyed row of the same (vehicle_id, platform) already holds; 0 pairs of NULL-key
--   rows of one vehicle and platform whose URLs normalize alike.
--   1,037 gooding and 575 rm-sothebys rows carry metadata.clock_locked_by_supersession (lane V replacements, PR #696);
--   all are on the platform's own host and get the key.
--   Every key this writer sets matches ^[a-z0-9._~/-]+$, so the TS twin returns the same string for the same URL.
--   0 of the 7,484 point at a missing vehicle.
--   Expected: 5,823 keyed (gooding 4,678, rm-sothebys 1,145); 1,661 left NULL (not_a_web_url 1,630, other_host 31).
--
-- FINDINGS (not changed here):
--   * Platform spelling. RM episodes are 'rm-sothebys' (2,474 rows, the slug in live_auction_sources); extract-rmsothebys
--     writes and reads 'rmsothebys' (0 vehicle_events rows; listing_page_snapshots uses it). After this fill the 1,145
--     keyed RM rows carry the lander's key under the other spelling, so the lander's read still misses them. Renaming
--     is the platform-entity decision (C memo section 4), not this writer's.
--   * Duplicate vehicles. 636 Gooding lots are episodes on two vehicles each (the www and non-www spellings of one lot,
--     one vehicle per spelling) and 165 RM lots on two vehicles each (the same URL). The index is per vehicle, so
--     both rows get the key; the vehicles are merge candidates. One more Gooding lot is keyed on another vehicle.
--
-- RULE (key_vehicle_event_listing_ids). A row is keyed only when:
--   1. source_listing_id IS NULL and source_platform is 'gooding' (host goodingco.com) or 'rm-sothebys' (host
--      rmsothebys.com);
--   2. source_url is an http(s) URL and k = normalize_listing_url_key(source_url) is that host or starts with host/;
--   3. no row of the same (vehicle_id, source_platform) holds source_listing_id = k (keyed_twin);
--   4. no other NULL-key row of the same (vehicle_id, source_platform) has a URL that normalizes to k (unkeyed_twin;
--      both stay NULL: one lot, two episodes on one vehicle, is a supersession decision).
--   Then source_listing_id := k and nothing else changes. Counted reasons for a NULL left: no_url, not_a_web_url,
--   other_host, keyed_twin, unkeyed_twin.
--
-- WRITES. Only the backfill writes, and only source_listing_id. updated_at and the clocks are not touched, so the
-- profile and vehicle_latest_event orderings do not move. Triggers: trg_guard_vehicle_event_clock_locks (#703) fires
-- BEFORE UPDATE OF sold_at, ended_at, metadata; this UPDATE names only source_listing_id, so it does not fire, and a
-- locked row's clocks and metadata stay exactly as they are. preserve_bat_live_projection fires on every UPDATE and
-- returns NEW unchanged when metadata.live_stream and the fact columns are unchanged, which a key-only UPDATE is.
-- vehicle_events has no write-receipt trigger, so the function writes one write_receipts row per call that changed
-- rows. The key column is indexed (idx_vehicle_events_dedup), so every keyed row is a non-HOT update. About 5,800
-- rows; VACUUM (ANALYZE) public.vehicle_events after the run is optional.
--
-- SCHEMA_LAW: no table, column, kind or vocabulary value. One function, one pipeline_registry row
-- (vehicle_events.source_listing_id had none), and comments. The rule's reasons are return keys, not stored values.
-- No row of vehicle_events changes in this migration. Rows change only when the backfill function is called.
-- DEPLOY HISTORY: the first version of this migration (20261007020500, merged as #722) declared app.writer as a
-- function-level SET. Prod's deploy role is not a superuser, so CREATE FUNCTION failed with "permission denied to set
-- parameter app.writer" (Supabase Deploy run 37557001434, 2026-10-07 01:25Z); its transaction rolled back and applied
-- nothing. CI applies only the files a merge commit adds, so this file carries the whole migration again. The function
-- now sets app.writer with set_config for the call and restores the caller's value on return; lock_timeout stays a
-- function-level SET (a built-in parameter, as in #676 and #705). 20261007020500 is kept as a comment-only ledger note.
-- Contract: supabase/sql/test_vehicle_event_listing_ids.sql (PostgreSQL 17, CI job metric-fold-health-contract). It
-- applies this migration as a non-superuser that owns the fixture tables, the way prod's deploy role owns them.
-- Applied by CI, never by hand.

BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.key_vehicle_event_listing_ids(
  p_batch integer DEFAULT 20000,
  p_from_block bigint DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '5s'
AS $fn$
DECLARE
  c_max_block constant bigint := 4294967295;  -- largest block number a tid can hold
  c_writer constant text := 'key-vehicle-event-listing-ids';
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
    RAISE EXCEPTION 'key_vehicle_event_listing_ids: p_batch must be 1..100000, got %', p_batch;
  END IF;
  IF p_from_block IS NULL OR p_from_block < 0 THEN
    RAISE EXCEPTION 'key_vehicle_event_listing_ids: p_from_block must be >= 0, got %', p_from_block;
  END IF;
  IF v_timeout_ms < 1 OR v_timeout_ms > 60000 THEN
    RAISE EXCEPTION 'key_vehicle_event_listing_ids: caller must set statement_timeout between 1 ms and 60 s (now % ms)', v_timeout_ms;
  END IF;

  -- Past the end (or past the largest tid block): nothing to scan; report done before building any tid.
  IF p_from_block >= v_table_blocks OR p_from_block >= c_max_block THEN
    RETURN jsonb_build_object(
      'keyed', 0, 'left_no_url', 0, 'left_not_a_web_url', 0, 'left_other_host', 0,
      'left_keyed_twin', 0, 'left_unkeyed_twin', 0,
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

  -- One statement: the range's NULL-key rows of the two platforms; the rule's verdict for each; the UPDATE of the rows
  -- whose verdict is 'key'. The SET re-checks the key is still NULL and the URL, vehicle and platform unchanged, so a
  -- row a lander re-keyed or re-pointed meanwhile keeps what that lander left. A keyed row leaves the candidate set, so
  -- a walk never reaches it twice; a row left NULL is not moved, so each one is counted once per complete walk. The
  -- left counts come from the statement's snapshot.
  EXECUTE $q$
    WITH cand AS MATERIALIZED (
      SELECT e.id, e.vehicle_id, e.source_platform, e.source_url,
             public.normalize_listing_url_key(e.source_url) AS k,
             CASE e.source_platform WHEN 'gooding' THEN 'goodingco.com' WHEN 'rm-sothebys' THEN 'rmsothebys.com' END AS host
      FROM public.vehicle_events e
      WHERE e.ctid >= $1 AND e.ctid < $2
        AND e.source_listing_id IS NULL
        AND e.source_platform IN ('gooding', 'rm-sothebys')
    ), verdict AS MATERIALIZED (
      SELECT c.id, c.vehicle_id, c.source_platform, c.source_url, c.k,
             CASE
               WHEN c.k IS NULL THEN 'no_url'
               WHEN c.source_url !~* '^\s*https?://' THEN 'not_a_web_url'
               WHEN c.k <> c.host AND left(c.k, length(c.host) + 1) <> (c.host || '/') THEN 'other_host'
               WHEN EXISTS (SELECT 1 FROM public.vehicle_events t
                            WHERE t.vehicle_id = c.vehicle_id AND t.source_platform = c.source_platform
                              AND t.source_listing_id = c.k) THEN 'keyed_twin'
               WHEN EXISTS (SELECT 1 FROM public.vehicle_events t
                            WHERE t.vehicle_id = c.vehicle_id AND t.source_platform = c.source_platform
                              AND t.source_listing_id IS NULL AND t.source_url IS NOT NULL AND t.id <> c.id
                              AND public.normalize_listing_url_key(t.source_url) = c.k) THEN 'unkeyed_twin'
               ELSE 'key'
             END AS v
      FROM cand c
    ), upd AS (
      UPDATE public.vehicle_events e
      SET source_listing_id = verdict.k
      FROM verdict
      WHERE e.id = verdict.id
        AND verdict.v = 'key'
        AND e.source_listing_id IS NULL
        AND e.source_url = verdict.source_url
        AND e.vehicle_id = verdict.vehicle_id
        AND e.source_platform = verdict.source_platform
      RETURNING e.id
    )
    SELECT (SELECT count(*) FROM upd)::bigint AS keyed,
           count(*) FILTER (WHERE v = 'no_url')::bigint AS no_url,
           count(*) FILTER (WHERE v = 'not_a_web_url')::bigint AS not_a_web_url,
           count(*) FILTER (WHERE v = 'other_host')::bigint AS other_host,
           count(*) FILTER (WHERE v = 'keyed_twin')::bigint AS keyed_twin,
           count(*) FILTER (WHERE v = 'unkeyed_twin')::bigint AS unkeyed_twin
    FROM verdict
  $q$ INTO v_res USING v_lo, v_hi;

  -- vehicle_events has no write-receipt trigger; record this writer's statement the way record_write_receipt does.
  IF v_res.keyed > 0 THEN
    INSERT INTO public.write_receipts (tbl, op, rows, writer, db_role, app_name, txid)
    VALUES ('vehicle_events', 'UPDATE', v_res.keyed::integer, c_writer, current_user,
            current_setting('application_name', true), txid_current());
  END IF;

  -- New tuple versions may have extended the heap; the walk is done only when it has passed the current end.
  v_blocks_after := pg_catalog.pg_relation_size('public.vehicle_events') / current_setting('block_size')::bigint;

  -- Hand the caller's declared writer back for the rest of its transaction.
  PERFORM set_config('app.writer', coalesce(v_prev_writer, ''), true);

  RETURN jsonb_build_object(
    'keyed', v_res.keyed,
    'left_no_url', v_res.no_url,
    'left_not_a_web_url', v_res.not_a_web_url,
    'left_other_host', v_res.other_host,
    'left_keyed_twin', v_res.keyed_twin,
    'left_unkeyed_twin', v_res.unkeyed_twin,
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

COMMENT ON FUNCTION public.key_vehicle_event_listing_ids(integer, bigint) IS
'Sanctioned writer of vehicle_events.source_listing_id for existing gooding and rm-sothebys rows (2026-10-07). Scans about p_batch rows by physical block range starting at p_from_block. Sets a NULL key to normalize_listing_url_key(source_url), the key extract-gooding and extract-rmsothebys write and read (_shared/vehicleEventWrite.ts), when the URL is http(s) on the platform''s own host (goodingco.com, rmsothebys.com), no row of the same vehicle and platform holds that key (keyed_twin), and no other NULL-key row of the same vehicle and platform normalizes to it (unkeyed_twin). Left NULL and counted: no_url, not_a_web_url (conceptcarz:// pseudo-URLs), other_host (another site''s page under the platform), keyed_twin, unkeyed_twin. Writes only source_listing_id: no clock, no metadata, no updated_at, so trg_guard_vehicle_event_clock_locks (UPDATE OF sold_at, ended_at, metadata) does not fire. Never touches another platform, never changes a key already set. Idempotent. One write_receipts row (writer key-vehicle-event-listing-ids) per call that changed rows; app.writer is set for the call with set_config and restored to the caller''s value on return; lock_timeout (5 s) is a function-level setting. Caller sets statement_timeout (1..60 s) and passes next_block back in. Returns keyed, the left counts per reason (from the statement snapshot), next_block, remaining_blocks, blocks_scanned, done (true once next_block passes the heap end measured after the call''s own writes). Measured 2026-10-07: 5,823 of 7,484 NULL-key rows keyable; 1,630 not_a_web_url, 31 other_host, 0 twins.';

REVOKE ALL ON FUNCTION public.key_vehicle_event_listing_ids(integer, bigint) FROM PUBLIC;
DO $grants$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.key_vehicle_event_listing_ids(integer, bigint) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.key_vehicle_event_listing_ids(integer, bigint) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.key_vehicle_event_listing_ids(integer, bigint) TO service_role;
  END IF;
END $grants$;

-- The column already has a description (2026-10-06); name the backfill in it once.
DO $describe$
DECLARE cur text;
BEGIN
  cur := col_description('public.vehicle_events'::regclass,
           (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.vehicle_events'::regclass AND attname = 'source_listing_id'));
  IF cur IS NULL THEN
    COMMENT ON COLUMN public.vehicle_events.source_listing_id IS
    'Listing identity on the platform. Unique per (vehicle_id, source_platform, source_listing_id) (idx_vehicle_events_dedup). Unit: none. Source: the writing extractor. Grain: one vehicle listing. Clock: n/a. Existing NULL keys on gooding and rm-sothebys rows: key_vehicle_event_listing_ids() sets normalize_listing_url_key(source_url) when the URL is on the platform''s own host and no twin holds the key (2026-10-07).';
  ELSIF cur NOT LIKE '%key_vehicle_event_listing_ids%' THEN
    EXECUTE format('COMMENT ON COLUMN public.vehicle_events.source_listing_id IS %L', cur
      || ' Existing NULL keys on gooding and rm-sothebys rows: key_vehicle_event_listing_ids() sets normalize_listing_url_key(source_url) when the URL is on the platform''s own host and no twin holds the key (2026-10-07).');
  END IF;
END
$describe$;

-- Owner of the key (none was registered). A row that already names this writer is left as it is.
INSERT INTO public.pipeline_registry (table_name, column_name, owned_by, description, do_not_write_directly, write_via)
VALUES
('vehicle_events', 'source_listing_id', 'listing landers (extract-bat-core, extract-gooding, extract-rmsothebys, platform extractors)',
 'Listing key of the episode: with vehicle_id and source_platform, the unique key idx_vehicle_events_dedup that landers read and write by. Gooding and RM Sotheby''s: normalize_listing_url_key of the lot URL. NULL = no key: the row is outside the index and a lander''s read by key cannot find it. Derived from source_url on those platforms, never a correction.',
 false,
 'At insert: the lander passes its key (_shared/vehicleEventWrite.ts writeVehicleEventByKey; extract-gooding and extract-rmsothebys use normalizeListingUrlKey(url)). Existing NULL keys on gooding and rm-sothebys rows: key_vehicle_event_listing_ids(p_batch, p_from_block), only when the URL is on the platform''s own host and no twin on the same vehicle holds the key.')
ON CONFLICT (table_name, column_name) DO UPDATE SET
  owned_by = EXCLUDED.owned_by,
  description = EXCLUDED.description,
  do_not_write_directly = EXCLUDED.do_not_write_directly,
  write_via = EXCLUDED.write_via,
  updated_at = now()
WHERE pipeline_registry.write_via IS NULL OR pipeline_registry.write_via NOT LIKE '%key_vehicle_event_listing_ids%';

COMMIT;
