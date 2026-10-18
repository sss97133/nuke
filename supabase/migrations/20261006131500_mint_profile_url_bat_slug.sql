-- Lane K, 2026-10-06: the backfill's identity mint writes profile_url in the form existing BaT identities use.
--
-- Measured (read-only, 2026-10-06 ~11:50Z):
--   Existing form: BaT's own member slug, no trailing slash, lower case. Latest pre-10-06 rows: Cheeter08 ->
--   .../member/cheeter08, rememberwhen -> .../member/rememberwhen, afeurer3 -> .../member/afeurer3. For plain handles
--   ([A-Za-z0-9_-]) created before 2026-10-01 (tablesample 10%, n=61,795): 59,582 are member/<lower(handle)>, 276 carry a
--   trailing slash, 1,937 have no URL, 0 use the exact-case handle. Handles with other characters use BaT's slug
--   (spaces become hyphens: "Mike Barron" -> mike-barron), which cannot be derived from the handle without guessing.
--   key_auction_comment_authors minted 78,943 identities with member/<encode_uri_component(handle)> (exact case, no slash);
--   78,500 of them are plain handles. Those rows are not rewritten here.
-- Change: one expression in the mint. Plain handle -> https://bringatrailer.com/member/<lower(handle)>; any other handle
-- -> NULL (unknown, so no profile fetch is queued for a guessed URL). Everything else in the function is byte-identical
-- to 20261006090000 (deployed body md5 5254c77a528e453d03e3cb86336c22a3 verified before this change).
-- Not changed here: the profile-queue twins. trigger_queue_profile_from_auction_comment queues
-- member/<encoded handle>/ (exact case, slash) and trigger_queue_profile_from_identity queues the identity's URL, so the
-- two writers disagree whatever form the mint uses; see the proposal in the PR body.

BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

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
             CASE WHEN h.handle ~ '^[A-Za-z0-9_-]+$' THEN 'https://bringatrailer.com/member/' || lower(h.handle) END,
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

COMMIT;
