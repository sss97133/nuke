-- Lane K (keys), 2026-10-06: every auction comment author becomes a foreign key to external_identities.
--
-- Twin adjudication (prod, tablesample system 0.2%, n=41,232 comments, 2026-10-06 05:50Z):
--   external_identity_id is canonical. It is declared in 20251216000003 with its FK, and every current
--   writer sets it: linkAuctionCommentIdentities in _shared/batAuctionRecord.ts (extract-bat-core,
--   load_archive_comments.ts), extract-auction-comments and ingest_bat_live_events. Filled on 75%.
--   author_external_identity_id has no migration in this repo, no writer since 2026-03 (62 of 3,593
--   sampled 2026-03 rows, 0 after) and is filled on 58%. Where both are set (24,158 sampled rows) they
--   never differ. It is retired by comment only: no drop, no rewrite. Rows that carry only the twin
--   (18 in a 1% sample, all BaT, every one pointing at the identity of the same exact handle) get the
--   twin copied into the canonical column. Two frontend profile readers still filter on the twin because
--   it is the only indexed one; switching them needs an index on the canonical column, which prod lacks
--   (the 2025-12-16 index is not installed). That is a separate change.
--
-- Unkeyed population (same sample): 25% of 18.4M rows have neither key, mostly the 2026-09-27..10-01
-- archive load. Of sampled unkeyed BaT rows (0.3%, n=15,144): 94.8% match external_identities exactly on
-- (platform 'bat', handle), 5.2% have no identity row (494 distinct handles, none differing only by
-- case), 0.3% are 'Unknown' or anonymous and stay NULL.
--
-- Anonymous: an author named anonymous (any case) is never keyed, whatever its bat_author_id. Different
-- anonymous posters would otherwise share one (bat, 'anonymous') identity, which asserts that unrelated
-- people are one person. NULL means unresolved.
--
-- This migration:
--   1. key_auction_comment_authors(p_batch, p_mint, p_from_block): the bounded backfill. It walks the
--      heap by physical block range (TID range scan), because a 20K-row primary-key window over random
--      UUIDs costs 10.1 s of random heap reads against 54 ms for the same row count read in block
--      order (EXPLAIN ANALYZE of the read side on prod, 2026-10-06). Per block range it copies the twin
--      where only the twin is set, mints missing BaT identities the way linkAuctionCommentIdentities does,
--      then keys by exact handle. The caller passes the returned next_block back in, and must set
--      statement_timeout (1..60 s): a function cannot bound the statement that calls it (verified on
--      PG17), so the function refuses an unbounded call.
--   2. trg_key_auction_comment_author: BEFORE INSERT, one unique-index lookup, never mints. No exception
--      block, so no subtransaction per inserted row. Writers that already pass the key skip it.
--   3. trg_write_receipt_upd: UPDATE statements on auction_comments now leave a write receipt (INSERT
--      receipts exist since 20261002000100), so the backfill's app.writer is recorded. Measured before
--      adding it: 0 top-level UPDATE statements on the table in 6.87 days of pg_stat_statements (track=top);
--      1,341 upserts with ON CONFLICT DO UPDATE (about 195 a day), which also fire statement-level UPDATE
--      triggers; no active schedule for the single-row comment scorers (analyze-comments-fast,
--      batch-comment-discovery). Cost on PG17: +0.015 ms per single-row UPDATE statement (pgbench, 3 x 20K).
--      Revisit if a single-row scorer is scheduled again: it would write one receipt per comment.
--   4. pipeline_registry: the owner of external_identity_id, and the retired twin (upserted).
-- No row is changed by this migration. Rows change only when the backfill function is called.

BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

COMMENT ON COLUMN public.auction_comments.author_external_identity_id IS
'RETIRED 2026-10-06: superseded by external_identity_id; do not write. Author as FK to external_identities.id. Set only on rows created before 2026-03; never differs from external_identity_id where both are set (24,158 of 24,158 sampled, 2026-10-06). Two frontend profile readers still filter on it because it carries the only author index (idx_auction_comments_author_external_identity_id); they move once the canonical column is indexed. Unit: none. Grain: one comment. Clock: n/a.';

COMMENT ON COLUMN public.auction_comments.external_identity_id IS
'Canonical comment author: FK to external_identities.id (platform bat, exact handle = author_username; no case folding). Writers may pass it at insert (linkAuctionCommentIdentities in batAuctionRecord.ts, extract-auction-comments, ingest_bat_live_events); otherwise trg_key_auction_comment_author sets it before insert from an existing identity. Backfill: key_auction_comment_authors(), which also copies author_external_identity_id where only that twin is set. NULL means unresolved: no identity row yet, a non-BaT platform, or an author that is not one person (Unknown, blank, or anonymous in any case). Owner: pipeline_registry. Unit: none. Grain: one comment. Clock: n/a.';

-- 1. Bounded backfill ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.key_auction_comment_authors(
  p_batch integer DEFAULT 20000,
  p_mint boolean DEFAULT true,
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
  v_copied integer := 0;
  v_minted integer := 0;
  v_keyed integer := 0;
BEGIN
  IF p_batch IS NULL OR p_batch < 1 OR p_batch > 100000 THEN
    RAISE EXCEPTION 'key_auction_comment_authors: p_batch must be 1..100000, got %', p_batch;
  END IF;
  IF p_from_block IS NULL OR p_from_block < 0 THEN
    RAISE EXCEPTION 'key_auction_comment_authors: p_from_block must be >= 0, got %', p_from_block;
  END IF;
  IF v_timeout_ms < 1 OR v_timeout_ms > 60000 THEN
    RAISE EXCEPTION 'key_auction_comment_authors: caller must set statement_timeout between 1 ms and 60 s (now % ms)', v_timeout_ms;
  END IF;

  -- Past the end (or past the largest tid block): nothing to scan; report done before building any tid.
  IF p_from_block >= v_table_blocks OR p_from_block >= c_max_block THEN
    RETURN jsonb_build_object(
      'keyed', 0, 'copied_from_twin', 0, 'minted', 0,
      'from_block', p_from_block, 'next_block', p_from_block, 'blocks_scanned', 0,
      'table_blocks', v_table_blocks, 'remaining_blocks', 0, 'est_rows_remaining_to_scan', 0,
      'done', true);
  END IF;

  PERFORM set_config('app.writer', 'key-comment-authors', true);

  SELECT CASE WHEN relpages > 0 AND reltuples > 0 THEN reltuples::numeric / relpages ELSE 15 END
    INTO v_rows_per_page FROM pg_class WHERE oid = 'public.auction_comments'::regclass;
  v_blocks := greatest(1, ceil(p_batch / greatest(v_rows_per_page, 1)))::bigint;
  v_next := least(p_from_block + v_blocks, c_max_block);
  v_lo := format('(%s,0)', p_from_block)::tid;
  v_hi := format('(%s,0)', v_next)::tid;

  -- a) Rows that carry only the retired twin: copy it (the twins never differ where both are set).
  EXECUTE $q$
    UPDATE auction_comments c
    SET external_identity_id = c.author_external_identity_id
    WHERE c.ctid >= $1 AND c.ctid < $2
      AND c.external_identity_id IS NULL
      AND c.author_external_identity_id IS NOT NULL
      AND c.platform = 'bat'
      AND c.author_username IS NOT NULL
      AND c.author_username <> 'Unknown'
      AND btrim(c.author_username) <> ''
      AND lower(c.author_username) <> 'anonymous'
  $q$ USING v_lo, v_hi;
  GET DIAGNOSTICS v_copied = ROW_COUNT;

  -- b) Missing identities, same shape as linkAuctionCommentIdentities: platform bat, exact handle,
  --    member URL. first_seen_at keeps its default (ingest clock); the comment clock goes in metadata.
  IF p_mint THEN
    EXECUTE $q$
      INSERT INTO external_identities (platform, handle, profile_url, metadata)
      SELECT 'bat', h.handle,
             'https://bringatrailer.com/member/' || encode_uri_component(h.handle),
             jsonb_build_object('source', 'auction_comments author',
                                'writer', 'key_auction_comment_authors',
                                'earliest_posted_at_in_minting_batch', h.first_posted_at)
      FROM (
        SELECT c.author_username AS handle, min(c.posted_at) AS first_posted_at
        FROM auction_comments c
        WHERE c.ctid >= $1 AND c.ctid < $2
          AND c.external_identity_id IS NULL
          AND c.platform = 'bat'
          AND c.author_username IS NOT NULL
          AND c.author_username <> 'Unknown'
          AND btrim(c.author_username) <> ''
          AND lower(c.author_username) <> 'anonymous'
        GROUP BY c.author_username
      ) h
      WHERE NOT EXISTS (SELECT 1 FROM external_identities e WHERE e.platform = 'bat' AND e.handle = h.handle)
      ORDER BY h.handle
      ON CONFLICT (platform, handle) DO NOTHING
    $q$ USING v_lo, v_hi;
    GET DIAGNOSTICS v_minted = ROW_COUNT;
  END IF;

  -- c) Exact handle lookup for the rest.
  EXECUTE $q$
    UPDATE auction_comments c
    SET external_identity_id = e.id
    FROM external_identities e
    WHERE c.ctid >= $1 AND c.ctid < $2
      AND c.external_identity_id IS NULL
      AND c.platform = 'bat'
      AND c.author_username IS NOT NULL
      AND c.author_username <> 'Unknown'
      AND btrim(c.author_username) <> ''
      AND lower(c.author_username) <> 'anonymous'
      AND e.platform = 'bat'
      AND e.handle = c.author_username
  $q$ USING v_lo, v_hi;
  GET DIAGNOSTICS v_keyed = ROW_COUNT;

  RETURN jsonb_build_object(
    'keyed', v_keyed,
    'copied_from_twin', v_copied,
    'minted', v_minted,
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

COMMENT ON FUNCTION public.key_auction_comment_authors(integer, boolean, bigint) IS
'Sanctioned writer of auction_comments.external_identity_id for existing rows. Scans about p_batch rows by physical block range starting at p_from_block. Per range: copies author_external_identity_id where only that twin is set; when p_mint, inserts missing external_identities (platform bat, exact handle, ON CONFLICT DO NOTHING; never rewrites an identity); then keys rows whose key is NULL by exact (bat, handle). Never keys Unknown, blank or anonymous authors, or non-BaT rows. Never writes author_external_identity_id. Idempotent. Caller sets statement_timeout (1..60 s) and passes next_block back in. Declares app.writer key-comment-authors. Returns keyed, copied_from_twin, minted, next_block, remaining_blocks, done.';

REVOKE ALL ON FUNCTION public.key_auction_comment_authors(integer, boolean, bigint) FROM PUBLIC;
DO $grants$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.key_auction_comment_authors(integer, boolean, bigint) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.key_auction_comment_authors(integer, boolean, bigint) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.key_auction_comment_authors(integer, boolean, bigint) TO service_role;
  END IF;
END $grants$;

-- 2. Key on insert ---------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.key_auction_comment_author_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NEW.platform = 'bat'
     AND NEW.author_username <> 'Unknown'
     AND btrim(NEW.author_username) <> ''
     AND lower(NEW.author_username) <> 'anonymous' THEN
    -- Unique (platform, handle): at most one row; no row leaves the key NULL.
    NEW.external_identity_id := (
      SELECT e.id FROM external_identities e
      WHERE e.platform = 'bat' AND e.handle = NEW.author_username);
  END IF;
  RETURN NEW;
END
$fn$;

COMMENT ON FUNCTION public.key_auction_comment_author_on_insert() IS
'BEFORE INSERT on auction_comments: sets external_identity_id from an existing external_identities row (platform bat, exact handle) with one unique-index lookup. No row leaves the key NULL for key_auction_comment_authors(). Never mints an identity (no insert into another table at comment insert time). Skips Unknown, blank and anonymous authors and non-BaT rows.';

REVOKE ALL ON FUNCTION public.key_auction_comment_author_on_insert() FROM PUBLIC;

-- CREATE OR REPLACE takes SHARE ROW EXCLUSIVE (readers keep reading); DROP TRIGGER would take ACCESS EXCLUSIVE.
CREATE OR REPLACE TRIGGER trg_key_auction_comment_author
BEFORE INSERT ON public.auction_comments
FOR EACH ROW
WHEN (NEW.external_identity_id IS NULL AND NEW.author_username IS NOT NULL)
EXECUTE FUNCTION public.key_auction_comment_author_on_insert();

COMMENT ON TRIGGER trg_key_auction_comment_author ON public.auction_comments IS
'Lane K 2026-10-06: key every new comment author to external_identities at insert (exact bat handle). Skipped when the writer already passed external_identity_id.';

-- 3. Update receipts -------------------------------------------------------------------------------
CREATE OR REPLACE TRIGGER trg_write_receipt_upd
AFTER UPDATE ON public.auction_comments
REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT EXECUTE FUNCTION public.record_write_receipt();

COMMENT ON TRIGGER trg_write_receipt_upd ON public.auction_comments IS
'One write receipt per nonempty UPDATE statement on the comment log (INSERT receipts: trg_write_receipt_ins); also fires for INSERT ... ON CONFLICT DO UPDATE. Writer is caller-declared (app.writer / X-Nuke-Writer); the key backfill declares key-comment-authors. Measured 2026-10-06: no top-level UPDATE statements in 6.87 days, about 195 upserts a day, +0.015 ms per single-row statement on PG17. Revisit if a single-row comment scorer is scheduled again.';

-- 4. Ownership (upsert: a skipped registration would leave an old owner named) -----------------------
INSERT INTO public.pipeline_registry (table_name, column_name, owned_by, description, do_not_write_directly, write_via)
VALUES
('auction_comments', 'external_identity_id', 'key_auction_comment_authors',
 'Canonical comment author key: external_identities.id for (platform bat, handle = author_username), exact match, no case folding. NULL = unresolved (no identity, non-BaT platform, or Unknown/blank/anonymous author). Derived from author_username, never testimony.',
 false,
 'At insert: the writer passes it (linkAuctionCommentIdentities in batAuctionRecord.ts) or trigger trg_key_auction_comment_author sets it from an existing identity. Existing rows: key_auction_comment_authors(p_batch, p_mint, p_from_block), which copies the retired twin where only it is set, mints missing bat identities, then keys by exact handle.'),
('auction_comments', 'author_external_identity_id', 'retired',
 'RETIRED 2026-10-06: superseded by external_identity_id; do not write. Kept for rows created before 2026-03 and for readers not yet moved.',
 true,
 'none')
ON CONFLICT (table_name, column_name) DO UPDATE SET
  owned_by = EXCLUDED.owned_by,
  description = EXCLUDED.description,
  do_not_write_directly = EXCLUDED.do_not_write_directly,
  write_via = EXCLUDED.write_via,
  updated_at = now();

COMMIT;
