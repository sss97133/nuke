-- Lane L (lot keys), 2026-10-06: key every auction comment whose lot is known to its auction_events row.
--
-- The lander's rule (the one every live comment writer applies at insert):
--   extract-bat-core upserts the lot on (vehicle_id, source_url = canonicalUrl(url), no trailing slash) and
--   passes that row's id into every comment it builds (index.ts ~2629, batAuctionRecord.ts buildAuctionCommentRows);
--   the comment's own source_url is the same URL with a trailing slash. ingest_bat_live_events looks the lot up on
--   vehicle_id and rtrim(source_url,'/') (20261005004554). extract-auction-comments and
--   extract-cars-and-bids-comments match on source + URL alone, a looser rule than this one.
--   So: a comment's lot is the auction_events row with the comment's vehicle_id and the comment's source_url,
--   ignoring one trailing slash. Exact case, as the writers do.
--
-- Population (prod, 2026-10-06 08:26-08:30Z, read-only exact pass by block range, +-0.2% for rows moving under a
-- concurrent backfill): auction_event_id IS NULL on 2,355,074 of 19,986,304 comments (11.8%). Intake since
-- 2026-10-01 sets the key on every row (0 NULL of 65,157), so the gap is historical (2026-01 and the 2026-09
-- archive load) and no insert trigger is added. Of the NULL rows:
--   905,733 (38.5%, 13,062 lots) have exactly one lot by the rule above: keyed here.
--   2,339 (0.10%, 52 lots) have two (both slash spellings of the URL on one vehicle): left NULL, never guessed.
--   1,446,550 (61.4%, 20,256 lots) have no auction_events row for their (vehicle, URL), including 94,397 whose
--   vehicle has exactly one other lot: left NULL. The lot row does not exist yet (81% of those lots are in
--   vehicle_events for the same vehicle, 90% in bat_listings), and this function never creates one.
--   452 have no vehicle: left NULL.
--
-- This migration:
--   1. key_auction_comment_lots(p_batch, p_from_block): the bounded backfill. Walks the heap by physical block range
--      (TID range scan) like key_auction_comment_authors (20261006090000): 170-320 ms cold for the read side of a
--      20K-row range on prod (EXPLAIN ANALYZE of the same predicates, 2026-10-06). Per range it groups the NULL rows
--      by (vehicle_id, URL), counts the candidate lots for each key, and keys only keys with exactly one candidate.
--      The caller passes the returned next_block back in and must set statement_timeout (1..60 s).
--   2. COMMENT ON the column and the function; pipeline_registry row for auction_comments.auction_event_id (upsert).
-- No row is changed by this migration. Rows change only when the backfill function is called.

BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.key_auction_comment_lots(
  p_batch integer DEFAULT 20000,
  p_from_block bigint DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET lock_timeout = '5s'
AS $fn$
DECLARE
  c_max_block constant bigint := 4294967295;  -- largest block number a tid can hold
  v_timeout_ms bigint := (SELECT setting::bigint FROM pg_settings WHERE name = 'statement_timeout');
  v_rows_per_page numeric;
  v_table_blocks bigint := pg_relation_size('public.auction_comments') / current_setting('block_size')::bigint;
  v_blocks bigint;
  v_next bigint;
  v_lo tid;
  v_hi tid;
  v_res record;
BEGIN
  IF p_batch IS NULL OR p_batch < 1 OR p_batch > 100000 THEN
    RAISE EXCEPTION 'key_auction_comment_lots: p_batch must be 1..100000, got %', p_batch;
  END IF;
  IF p_from_block IS NULL OR p_from_block < 0 THEN
    RAISE EXCEPTION 'key_auction_comment_lots: p_from_block must be >= 0, got %', p_from_block;
  END IF;
  IF v_timeout_ms < 1 OR v_timeout_ms > 60000 THEN
    RAISE EXCEPTION 'key_auction_comment_lots: caller must set statement_timeout between 1 ms and 60 s (now % ms)', v_timeout_ms;
  END IF;

  -- Past the end (or past the largest tid block): nothing to scan; report done before building any tid.
  IF p_from_block >= v_table_blocks OR p_from_block >= c_max_block THEN
    RETURN jsonb_build_object(
      'keyed', 0, 'left_several_lots', 0, 'left_no_lot', 0,
      'from_block', p_from_block, 'next_block', p_from_block, 'blocks_scanned', 0,
      'table_blocks', v_table_blocks, 'remaining_blocks', 0, 'est_rows_remaining_to_scan', 0,
      'done', true);
  END IF;

  PERFORM set_config('app.writer', 'key-comment-lots', true);

  SELECT CASE WHEN relpages > 0 AND reltuples > 0 THEN reltuples::numeric / relpages ELSE 15 END
    INTO v_rows_per_page FROM pg_class WHERE oid = 'public.auction_comments'::regclass;
  v_blocks := greatest(1, ceil(p_batch / greatest(v_rows_per_page, 1)))::bigint;
  v_next := least(p_from_block + v_blocks, c_max_block);
  v_lo := format('(%s,0)', p_from_block)::tid;
  v_hi := format('(%s,0)', v_next)::tid;

  -- One statement: the unkeyed rows of the range grouped by (vehicle, URL); the candidate lots of each key by the
  -- lander's rule; the UPDATE of keys with exactly one candidate. A row with no vehicle or no URL has no candidate.
  EXECUTE $q$
    WITH keys AS MATERIALIZED (
      SELECT c.vehicle_id, rtrim(c.source_url, '/') AS u, count(*) AS n_rows
      FROM auction_comments c
      WHERE c.ctid >= $1 AND c.ctid < $2
        AND c.auction_event_id IS NULL
      GROUP BY 1, 2
    ), cand AS MATERIALIZED (
      SELECT k.vehicle_id, k.u, k.n_rows, l.n_lots, l.lot_id
      FROM keys k
      CROSS JOIN LATERAL (
        SELECT count(*) AS n_lots, (array_agg(a.id))[1] AS lot_id
        FROM auction_events a
        WHERE a.vehicle_id = k.vehicle_id
          AND a.source_url IN (k.u, k.u || '/')
      ) l
    ), upd AS (
      UPDATE auction_comments c
      SET auction_event_id = cand.lot_id
      FROM cand
      WHERE c.ctid >= $1 AND c.ctid < $2
        AND c.auction_event_id IS NULL
        AND cand.n_lots = 1
        AND c.vehicle_id = cand.vehicle_id
        AND rtrim(c.source_url, '/') = cand.u
      RETURNING 1
    )
    SELECT (SELECT count(*) FROM upd)::bigint AS keyed,
           coalesce(sum(n_rows) FILTER (WHERE n_lots >= 2), 0)::bigint AS left_several,
           coalesce(sum(n_rows) FILTER (WHERE n_lots = 0), 0)::bigint AS left_none
    FROM cand
  $q$ INTO v_res USING v_lo, v_hi;

  RETURN jsonb_build_object(
    'keyed', v_res.keyed,
    'left_several_lots', v_res.left_several,
    'left_no_lot', v_res.left_none,
    'from_block', p_from_block,
    'next_block', v_next,
    'blocks_scanned', greatest(0, least(v_next, v_table_blocks) - p_from_block),
    'table_blocks', v_table_blocks,
    'remaining_blocks', greatest(0, v_table_blocks - v_next),
    'est_rows_remaining_to_scan', round(greatest(0, v_table_blocks - v_next) * v_rows_per_page),
    'done', v_next >= v_table_blocks OR v_next >= c_max_block
  );
END
$fn$;

COMMENT ON FUNCTION public.key_auction_comment_lots(integer, bigint) IS
'Sanctioned writer of auction_comments.auction_event_id for existing rows. Scans about p_batch rows by physical block range starting at p_from_block. Keys a comment whose auction_event_id is NULL to the auction_events row with the same vehicle_id and the same source_url ignoring one trailing slash (the rule extract-bat-core and ingest_bat_live_events apply at insert), only when exactly one such row exists. Two or more candidates, no candidate, no vehicle or no URL: left NULL. Never creates an auction_events row, never changes a key already set. Idempotent. Caller sets statement_timeout (1..60 s) and passes next_block back in. Declares app.writer key-comment-lots. Returns keyed, left_several_lots, left_no_lot, next_block, remaining_blocks, done.';

REVOKE ALL ON FUNCTION public.key_auction_comment_lots(integer, bigint) FROM PUBLIC;
DO $grants$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.key_auction_comment_lots(integer, bigint) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.key_auction_comment_lots(integer, bigint) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.key_auction_comment_lots(integer, bigint) TO service_role;
  END IF;
END $grants$;

COMMENT ON COLUMN public.auction_comments.auction_event_id IS
'Lot the comment was posted on, FK to auction_events.id (ON DELETE CASCADE). Rule: the auction_events row with this comment''s vehicle_id and source_url, ignoring one trailing slash. At insert: extract-bat-core passes the lot row it wrote in the same read; ingest_bat_live_events looks it up by that rule. Existing rows: key_auction_comment_lots(), only where exactly one lot matches. NULL means unresolved: no auction_events row for this vehicle and URL yet, two rows (both slash spellings), or no vehicle or URL on the comment. Owner: pipeline_registry. Unit: none. Grain: one comment. Clock: n/a.';

INSERT INTO public.pipeline_registry (table_name, column_name, owned_by, description, do_not_write_directly, write_via)
VALUES
('auction_comments', 'auction_event_id', 'key_auction_comment_lots',
 'Lot key: auction_events.id for (vehicle_id, source_url ignoring one trailing slash), exact case. NULL = unresolved (no lot row yet, two candidate rows, or no vehicle/URL). Derived from vehicle_id + source_url, never testimony.',
 false,
 'At insert: extract-bat-core passes the lot row id it upserted in the same read (buildAuctionCommentRows); ingest_bat_live_events looks it up by vehicle_id + rtrim(source_url). Existing rows: key_auction_comment_lots(p_batch, p_from_block), only where exactly one lot matches.')
ON CONFLICT (table_name, column_name) DO UPDATE SET
  owned_by = EXCLUDED.owned_by,
  description = EXCLUDED.description,
  do_not_write_directly = EXCLUDED.do_not_write_directly,
  write_via = EXCLUDED.write_via,
  updated_at = now();

COMMIT;
