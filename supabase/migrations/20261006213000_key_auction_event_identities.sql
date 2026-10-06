-- Keys lane, 2026-10-06 (case C28, data-machine-cases.md §12 proposal item 3, "key at insert, everywhere"): the BaT lot
-- row's two identity text columns, auction_events.winning_bidder and auction_events.seller_name, become foreign keys to
-- external_identities, at insert and, for existing rows, by a bounded backfill. auction_events is the canonical lot row.
--
-- MEASURED (prod, read-only through scripts/data/q.sh, 2026-10-06 UTC):
--   BaT lot rows at 20:59Z: 244,533 (source bat 244,393, bringatrailer 140). winning_bidder is set on 187,000, all on
--   source bat; seller_name on 241,791.
--   Exact matches on the unique index of external_identities (platform 'bat', handle = the text, case kept):
--     winning_bidder 186,962 of 187,000 (20:59Z). Of the 38 misses, 27 are English words or numbers that a buyer parser
--     lifted from listing text in 2025-12 to 2026-02 (be, an, assist, respond, take, ...), and 11 are handles with no
--     identity row.
--     seller_name 240,339 of 241,791 (21:00Z). The 1,452 misses (1,403 handles) are sellers with no identity row, because
--     identities are minted from comments. A case-insensitive match would add 1 row, so matching stays exact.
--   None of the 37 junk strings seen in winning_bidder and the sibling buyer columns (bat_listings.buyer_username, the
--   vehicle_events buyer fields) has a BaT identity in any letter case (0 rows, 21:18Z), and none has a BaT comment.
--   The lot's own comments agree with the text almost always:
--     2% block sample of matched winners (n=3,764, 21:15Z): the highest captured bid is the winner's on 3,506 of the
--     3,525 lots with keyed bids. On 17, every captured bid is below the sale (a partial capture). On 2, a different
--     handle bid the sale amount.
--     1% block sample of matched sellers (n=2,280, 21:07Z): of 2,190 lots with keyed comments, BaT's own seller flag
--     (auction_comments.is_seller) marks a comment by seller_name on 2,145, nobody on 43, and only a different handle
--     on 2. Full table: on 13 lots a first name stands as seller_name while BaT flags its own account as the seller,
--     and an unrelated member holds that first name as a handle.
--   Participation is often not yet visible when the lot row is written. Of the 1,029 BaT lots sold in the 10 days to
--   21:16Z, the winner has a comment keyed to the lot on all 1,029 now, but had one on 577 when the row was last
--   written. The seller has one on 1,016 now, and had one on 5 when the row was inserted. extract-bat-core upserts the
--   lot row before it writes that read's comments, so a rule that requires participation could not key at insert.
--   The rule below withholds a key only on contrary evidence.
--
-- RULE (resolve_auction_event_identities, shared by the triggers and the backfill). A key is set only when:
--   1. the lot is BaT (source bat or bringatrailer);
--   2. the text equals an external_identities handle exactly (platform bat, case kept);
--   3. the text is not one of the 37 observed junk strings (compared lower-cased; the list is in the function);
--   4. the lot's own comments (auction_comments.auction_event_id = the lot) do not contradict it.
--      winning_bidder: no bid by a different handle (compared case-insensitively) at or above winning_bid. A partial
--        capture, where every captured bid is below the sale, is not a contradiction.
--      seller_name: if any comment on the lot carries BaT's seller flag, one of the flagged comments is by this handle
--        (compared case-insensitively).
--   Otherwise the key stays NULL: unresolved, never guessed. Expected from the counts above: about 186,860 of the
--   187,000 winners and about 240,100 of the 241,791 sellers. The contradiction shares are sample estimates; the
--   backfill reports the exact count for every reason.
--
-- WRITES:
--   At insert, trg_key_auction_event_identities_ins fills a NULL key when its text is set. A key the writer passes is
--   kept. On UPDATE OF winning_bidder or seller_name, trg_key_auction_event_identities_upd fills a NULL key. It also
--   re-derives a key whose text changed in that statement, unless the statement set the key itself, so a key always
--   names the identity of the text beside it. A set key whose text is unchanged is never touched. Both triggers sort
--   after preserve_bat_live_projection (BEFORE UPDATE), so they see the row that trigger returns.
--   Existing rows: key_auction_event_identities(p_batch, p_from_block) walks the heap by block range like
--   key_auction_comment_lots (20261006110000). It fills NULL keys only, and writes one write_receipts row for each call
--   that changed rows. auction_events has no write-receipt trigger, and one would receipt every extract-bat-core
--   upsert (34,615 upsert statements in the 7.5 days of pg_stat_statements to 21:20Z), so the function writes its own.
--
-- LOCK COST: ALTER TABLE takes ACCESS EXCLUSIVE on auction_events until COMMIT, so reads and writes of the table wait
-- for the rest of the transaction. Everything that does not need that lock runs first. The columns are nullable with
-- no default, so adding them changes the catalog only (no rewrite). The foreign keys are NOT VALID, so they add no
-- validation scan: every existing value is NULL, and every later write is checked. They are added last, because they
-- block writes to external_identities until COMMIT. Each partial index scans the heap once and indexes nothing: a
-- full scan of the 47,030-block (367 MB) heap took 2.66 s cold and 0.70 s warm (EXPLAIN ANALYZE, 21:30Z). The lock
-- therefore lasts about 1.5 to 5.5 s. With lock_timeout 5 s, a session that holds a conflicting lock for 5 s makes the
-- migration fail before it changes anything.
--
-- SCHEMA_LAW: the key columns follow vehicle_events and bat_listings (<role>_external_identity_id, ON DELETE SET NULL).
-- schema_proposals had no proposal_type for a table column, so this migration adds 'add_column' and records the change
-- as one row. The proposal_type vocabulary is now:
--   add_property, fork_property, deprecate_property, modify_property: an observation property (observation_properties).
--   add_source, modify_trust_tier, add_source_category: a source and its trust.
--   add_observation_kind: an observation kind.  add_image_attribute: an image checklist attribute (attribute-registry.ts).
--   add_column (new): a column on an existing table. The payload names the table, the columns, their types, what they
--     reference, and their writer.
-- No row of auction_events changes in this migration. Rows change only through the triggers and the backfill function.

BEGIN;
SET LOCAL statement_timeout = '120s';
SET LOCAL lock_timeout = '5s';

-- 1. Proposal vocabulary and the proposal row -------------------------------------------------------------------------
-- Refuse a drifted CHECK rather than overwrite a value someone else added (read from prod 2026-10-06 21:20Z).
DO $guard$
BEGIN
  IF (SELECT pg_get_constraintdef(c.oid) FROM pg_catalog.pg_constraint c
      WHERE c.conrelid = 'public.schema_proposals'::regclass AND c.conname = 'schema_proposals_proposal_type_check')
     IS DISTINCT FROM
     'CHECK ((proposal_type = ANY (ARRAY[''add_property''::text, ''fork_property''::text, ''deprecate_property''::text, ''modify_property''::text, ''add_source''::text, ''modify_trust_tier''::text, ''add_observation_kind''::text, ''add_source_category''::text, ''add_image_attribute''::text])))'
  THEN
    RAISE EXCEPTION 'schema_proposals_proposal_type_check differs from the 2026-10-06 read; re-read it before extending it';
  END IF;
END
$guard$;

ALTER TABLE public.schema_proposals
  DROP CONSTRAINT schema_proposals_proposal_type_check,
  ADD CONSTRAINT schema_proposals_proposal_type_check CHECK (proposal_type = ANY (ARRAY[
    'add_property', 'fork_property', 'deprecate_property', 'modify_property', 'add_source', 'modify_trust_tier',
    'add_observation_kind', 'add_source_category', 'add_image_attribute', 'add_column']));

INSERT INTO public.schema_proposals (
  proposed_by_agent_key, proposal_type, payload, evidence, estimated_scope, backward_compatibility,
  status, resolved_at, decision_rationale)
VALUES (
  'claude-opus-5-5-keys-lane',
  'add_column',
  jsonb_build_object(
    'table', 'auction_events',
    'columns', jsonb_build_array(
      jsonb_build_object('column', 'winning_bidder_external_identity_id', 'type', 'uuid', 'keys_text_column', 'winning_bidder',
        'references', 'external_identities(id) ON DELETE SET NULL, NOT VALID at creation',
        'index', 'idx_auction_events_winning_bidder_external_identity (partial, IS NOT NULL)'),
      jsonb_build_object('column', 'seller_external_identity_id', 'type', 'uuid', 'keys_text_column', 'seller_name',
        'references', 'external_identities(id) ON DELETE SET NULL, NOT VALID at creation',
        'index', 'idx_auction_events_seller_external_identity (partial, IS NOT NULL)')),
    'why', 'Every reference is a foreign key (data-machine.md). Case C28 §12 item 3 names auction_events.winning_bidder and seller_name: handles with no key column.',
    'rule', 'resolve_auction_event_identities: BaT lot; exact (platform bat, handle); not one of 37 observed parser junk strings; not contradicted by the lot''s own comments (a bid by another handle at or above winning_bid; a seller flag on other handles only).',
    'writers', jsonb_build_array('trg_key_auction_event_identities_ins', 'trg_key_auction_event_identities_upd',
      'key_auction_event_identities(p_batch, p_from_block)'),
    'naming', 'Follows vehicle_events and bat_listings: <role>_external_identity_id.',
    'migration', '20261006213000_key_auction_event_identities.sql'),
  jsonb_build_array(
    jsonb_build_object('measure', 'BaT lot rows', 'value', 244533, 'at', '2026-10-06T20:59Z'),
    jsonb_build_object('measure', 'winning_bidder exact identity match', 'value', 186962, 'denominator', 187000, 'at', '2026-10-06T20:59Z'),
    jsonb_build_object('measure', 'seller_name exact identity match', 'value', 240339, 'denominator', 241791, 'at', '2026-10-06T21:00Z'),
    jsonb_build_object('measure', 'seller_name misses matched case-insensitively', 'value', 1, 'denominator', 1452, 'at', '2026-10-06T21:00Z'),
    jsonb_build_object('measure', 'observed junk strings with a BaT identity in any case', 'value', 0, 'denominator', 37, 'at', '2026-10-06T21:18Z'),
    jsonb_build_object('measure', 'lots whose highest captured bid is the winner''s (2% block sample)', 'value', 3506, 'denominator', 3525, 'at', '2026-10-06T21:15Z'),
    jsonb_build_object('measure', 'lots where another handle bid the sale amount (same sample)', 'value', 2, 'denominator', 3525, 'at', '2026-10-06T21:15Z'),
    jsonb_build_object('measure', 'lots whose seller flag marks seller_name (1% block sample)', 'value', 2145, 'denominator', 2190, 'at', '2026-10-06T21:07Z'),
    jsonb_build_object('measure', 'lots whose seller flag marks only another handle (same sample)', 'value', 2, 'denominator', 2190, 'at', '2026-10-06T21:07Z'),
    jsonb_build_object('measure', 'winner commented on the lot before the row''s last write (sold in 10 days)', 'value', 577, 'denominator', 1029, 'at', '2026-10-06T21:16Z'),
    jsonb_build_object('measure', 'seller commented on the lot before the row''s insert (sold in 10 days)', 'value', 5, 'denominator', 1029, 'at', '2026-10-06T21:16Z')),
  jsonb_build_object('bat_lot_rows', 244533, 'winning_bidder_set', 187000, 'seller_name_set', 241791,
    'expected_keyed_winning_bidder', 186860, 'expected_keyed_seller', 240100, 'method', 'exact matches less sampled contradiction shares'),
  jsonb_build_object('additive', true, 'nullable', true, 'table_rewrite', false, 'existing_writers_changed', false,
    'existing_readers_changed', false, 'fk_validated_at_creation', false,
    'note', 'Every existing value is NULL when the columns are added; NOT VALID foreign keys still check every later write.'),
  'approved',
  now(),
  'Approved for build by the owner through the lead session (skylar-64) on 2026-10-06 under C28 §12 item 3, key at insert, everywhere. The building agent wrote this row; the owner did not sign it. Supersede or reject it to retire the columns.');

-- 2. Owners of the two computed columns (upsert: a skipped registration would leave an older owner named) --------------
INSERT INTO public.pipeline_registry (table_name, column_name, owned_by, description, do_not_write_directly, write_via)
VALUES
('auction_events', 'winning_bidder_external_identity_id', 'key_auction_event_identities',
 'Winning bidder key: external_identities.id for (platform bat, handle = winning_bidder) on a BaT lot, exact case, when the text is not one of 37 observed parser junk strings and no bid on the lot by a different handle is at or above winning_bid. NULL = unresolved. Derived from winning_bidder, never testimony.',
 false,
 'At insert and on UPDATE OF winning_bidder: triggers trg_key_auction_event_identities_ins and _upd through resolve_auction_event_identities. Existing rows: key_auction_event_identities(p_batch, p_from_block), NULL keys only.'),
('auction_events', 'seller_external_identity_id', 'key_auction_event_identities',
 'Seller key: external_identities.id for (platform bat, handle = seller_name) on a BaT lot, exact case, when the text is not one of 37 observed parser junk strings and, if the lot has comments flagged as the seller''s, one of them is by this handle. NULL = unresolved. Derived from seller_name, never testimony.',
 false,
 'At insert and on UPDATE OF seller_name: triggers trg_key_auction_event_identities_ins and _upd through resolve_auction_event_identities. Existing rows: key_auction_event_identities(p_batch, p_from_block), NULL keys only.')
ON CONFLICT (table_name, column_name) DO UPDATE SET
  owned_by = EXCLUDED.owned_by,
  description = EXCLUDED.description,
  do_not_write_directly = EXCLUDED.do_not_write_directly,
  write_via = EXCLUDED.write_via,
  updated_at = now();

-- 3. The rule ----------------------------------------------------------------------------------------------------------
CREATE FUNCTION public.resolve_auction_event_identities(
  p_lot_id uuid,
  p_source text,
  p_winning_bidder text,
  p_winning_bid numeric,
  p_seller_name text,
  OUT winning_bidder_identity_id uuid,
  OUT winning_bidder_verdict text,
  OUT seller_identity_id uuid,
  OUT seller_verdict text
)
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $fn$
DECLARE
  -- Parser junk: words a buyer parser lifted from listing text. Seen in auction_events.winning_bidder (prod, 2026-10-06
  -- 21:00Z) and in bat_listings.buyer_username and the vehicle_events buyer fields (Keys lane memo, 2026-10-06). None has
  -- a BaT identity in any case (21:18Z). The list keeps it so if one is ever minted.
  c_junk constant text[] := ARRAY['20', '21', 'agree', 'an', 'assist', 'bank', 'be', 'comparing', 'coordinate',
    'discourage', 'do', 'encourage', 'engaging', 'find', 'flip', 'greedy', 'grow', 'guess', 'have', 'help', 'interject',
    'introduce', 'match', 'meadows', 'mi', 'my', 'our', 'respond', 'say', 'silver', 'skyrocket', 'store', 'take',
    'transfer', 'understand', 'wet', 'write'];
  v_is_bat boolean := p_source IN ('bat', 'bringatrailer');
  v_other_bid boolean;
  v_any_flag boolean;
  v_flag_is_seller boolean;
BEGIN
  IF p_winning_bidder IS NOT NULL THEN
    winning_bidder_verdict := CASE
      WHEN v_is_bat IS NOT TRUE THEN 'not_bat'
      WHEN btrim(p_winning_bidder) = '' THEN 'blank'
      WHEN lower(p_winning_bidder) = ANY (c_junk) THEN 'stop_word'
    END;
    IF winning_bidder_verdict IS NULL THEN
      SELECT e.id INTO winning_bidder_identity_id
      FROM public.external_identities e
      WHERE e.platform = 'bat' AND e.handle = p_winning_bidder;
      winning_bidder_verdict := CASE WHEN winning_bidder_identity_id IS NULL THEN 'no_identity' ELSE 'keyed' END;
    END IF;
  END IF;

  IF p_seller_name IS NOT NULL THEN
    seller_verdict := CASE
      WHEN v_is_bat IS NOT TRUE THEN 'not_bat'
      WHEN btrim(p_seller_name) = '' THEN 'blank'
      WHEN lower(p_seller_name) = ANY (c_junk) THEN 'stop_word'
    END;
    IF seller_verdict IS NULL THEN
      SELECT e.id INTO seller_identity_id
      FROM public.external_identities e
      WHERE e.platform = 'bat' AND e.handle = p_seller_name;
      seller_verdict := CASE WHEN seller_identity_id IS NULL THEN 'no_identity' ELSE 'keyed' END;
    END IF;
  END IF;

  -- One pass over the lot's comments, only when there is a key to check.
  IF winning_bidder_identity_id IS NOT NULL OR seller_identity_id IS NOT NULL THEN
    SELECT coalesce(bool_or(c.bid_amount >= p_winning_bid AND lower(c.author_username) <> lower(p_winning_bidder)), false),
           coalesce(bool_or(c.is_seller), false),
           coalesce(bool_or(c.is_seller AND lower(c.author_username) = lower(p_seller_name)), false)
      INTO v_other_bid, v_any_flag, v_flag_is_seller
    FROM public.auction_comments c
    WHERE c.auction_event_id = p_lot_id;

    IF winning_bidder_identity_id IS NOT NULL AND v_other_bid THEN
      winning_bidder_identity_id := NULL;
      winning_bidder_verdict := 'contradicted';
    END IF;
    IF seller_identity_id IS NOT NULL AND v_any_flag AND NOT v_flag_is_seller THEN
      seller_identity_id := NULL;
      seller_verdict := 'contradicted';
    END IF;
  END IF;
END
$fn$;

COMMENT ON FUNCTION public.resolve_auction_event_identities(uuid, text, text, numeric, text) IS
'The rule for auction_events.winning_bidder_external_identity_id and seller_external_identity_id (2026-10-06). For one lot, returns the identity each text names and a verdict: keyed, not_bat (source not bat or bringatrailer), blank, stop_word (one of 37 observed parser junk strings, compared lower-cased), no_identity (no external_identities row with platform bat and exactly this handle), or contradicted. Contradicted: for the winner, a bid on the lot by a different handle (case-insensitive) at or above p_winning_bid; for the seller, comments on the lot carry the seller flag and none of them is by this handle. A NULL text returns a NULL verdict. Measured basis: winning_bidder 186,962 of 187,000 exact, seller_name 240,339 of 241,791 exact; the highest captured bid is the winner''s on 3,506 of 3,525 sampled lots; the seller flag marks seller_name on 2,145 of 2,190 sampled lots (prod, 2026-10-06). Reads only; writes nothing.';

-- 4. Key at insert and on update of the text ------------------------------------------------------------------------
CREATE FUNCTION public.key_auction_event_identities_on_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_wb text;
  v_sn text;
  r record;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- A key follows its text: when the text changed and this statement did not set the key, derive it again.
    IF NEW.winning_bidder IS DISTINCT FROM OLD.winning_bidder
       AND NEW.winning_bidder_external_identity_id IS NOT DISTINCT FROM OLD.winning_bidder_external_identity_id THEN
      NEW.winning_bidder_external_identity_id := NULL;
    END IF;
    IF NEW.seller_name IS DISTINCT FROM OLD.seller_name
       AND NEW.seller_external_identity_id IS NOT DISTINCT FROM OLD.seller_external_identity_id THEN
      NEW.seller_external_identity_id := NULL;
    END IF;
  END IF;

  -- Only a NULL key is filled; a key the writer passed, or one already set for an unchanged text, is kept.
  IF NEW.winning_bidder_external_identity_id IS NULL THEN v_wb := NEW.winning_bidder; END IF;
  IF NEW.seller_external_identity_id IS NULL THEN v_sn := NEW.seller_name; END IF;
  IF v_wb IS NOT NULL OR v_sn IS NOT NULL THEN
    SELECT * INTO r FROM public.resolve_auction_event_identities(NEW.id, NEW.source, v_wb, NEW.winning_bid, v_sn);
    IF v_wb IS NOT NULL THEN NEW.winning_bidder_external_identity_id := r.winning_bidder_identity_id; END IF;
    IF v_sn IS NOT NULL THEN NEW.seller_external_identity_id := r.seller_identity_id; END IF;
  END IF;
  RETURN NEW;
END
$fn$;

COMMENT ON FUNCTION public.key_auction_event_identities_on_write() IS
'BEFORE INSERT and BEFORE UPDATE OF winning_bidder, seller_name on auction_events (triggers trg_key_auction_event_identities_ins and _upd). Fills a NULL winner or seller key by resolve_auction_event_identities. On update, a key whose text changed is derived again unless the same statement set the key; a set key with an unchanged text and a key passed by the writer are kept. Never mints an identity. Two unique-index lookups and, when either text matches, one pass over the lot''s comments.';

-- 5. Existing rows: the bounded backfill ------------------------------------------------------------------------------
CREATE FUNCTION public.key_auction_event_identities(
  p_batch integer DEFAULT 2000,
  p_from_block bigint DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '5s'
AS $fn$
DECLARE
  c_max_block constant bigint := 4294967295;  -- largest block number a tid can hold
  c_writer constant text := 'key-auction-event-identities';
  v_timeout_ms bigint := (SELECT setting::bigint FROM pg_catalog.pg_settings WHERE name = 'statement_timeout');
  v_rows_per_page numeric;
  v_table_blocks bigint := pg_catalog.pg_relation_size('public.auction_events') / current_setting('block_size')::bigint;
  v_blocks_after bigint;
  v_blocks bigint;
  v_next bigint;
  v_lo tid;
  v_hi tid;
  v_res record;
BEGIN
  IF p_batch IS NULL OR p_batch < 1 OR p_batch > 100000 THEN
    RAISE EXCEPTION 'key_auction_event_identities: p_batch must be 1..100000, got %', p_batch;
  END IF;
  IF p_from_block IS NULL OR p_from_block < 0 THEN
    RAISE EXCEPTION 'key_auction_event_identities: p_from_block must be >= 0, got %', p_from_block;
  END IF;
  IF v_timeout_ms < 1 OR v_timeout_ms > 60000 THEN
    RAISE EXCEPTION 'key_auction_event_identities: caller must set statement_timeout between 1 ms and 60 s (now % ms)', v_timeout_ms;
  END IF;

  -- Past the end (or past the largest tid block): nothing to scan; report done before building any tid.
  IF p_from_block >= v_table_blocks OR p_from_block >= c_max_block THEN
    RETURN jsonb_build_object(
      'keyed', 0, 'keyed_winning_bidder', 0, 'keyed_seller', 0,
      'winning_bidder_no_identity', 0, 'winning_bidder_stop_word', 0, 'winning_bidder_contradicted', 0, 'winning_bidder_blank', 0,
      'seller_no_identity', 0, 'seller_stop_word', 0, 'seller_contradicted', 0, 'seller_blank', 0,
      'from_block', p_from_block, 'next_block', p_from_block, 'blocks_scanned', 0,
      'table_blocks', v_table_blocks, 'remaining_blocks', 0, 'est_rows_remaining_to_scan', 0,
      'done', true);
  END IF;

  PERFORM set_config('app.writer', c_writer, true);

  SELECT CASE WHEN relpages > 0 AND reltuples > 0 THEN reltuples::numeric / relpages ELSE 8 END
    INTO v_rows_per_page FROM pg_catalog.pg_class WHERE oid = 'public.auction_events'::regclass;
  v_blocks := greatest(1, ceil(p_batch / greatest(v_rows_per_page, 1)))::bigint;
  v_next := least(p_from_block + v_blocks, c_max_block);
  v_lo := format('(%s,0)', p_from_block)::tid;
  v_hi := format('(%s,0)', v_next)::tid;

  -- One statement: the range's BaT rows with a NULL key beside a set text; the rule for each; one UPDATE per row that
  -- gains a key. The SET re-checks each key is still NULL and its text unchanged (a row a concurrent writer re-keyed or
  -- re-texted keeps what that writer left). An updated row gets a new tuple version. When that version lands at or
  -- beyond the range end, the walk reaches the row again, so a key it left open is counted then, not now: every open
  -- (row, column) is counted once per complete walk. The left counts come from the statement's snapshot.
  EXECUTE $q$
    WITH cand AS MATERIALIZED (
      SELECT a.id, a.source, a.winning_bid,
             CASE WHEN a.winning_bidder_external_identity_id IS NULL THEN a.winning_bidder END AS wb,
             CASE WHEN a.seller_external_identity_id IS NULL THEN a.seller_name END AS sn
      FROM public.auction_events a
      WHERE a.ctid >= $1 AND a.ctid < $2
        AND a.source IN ('bat', 'bringatrailer')
        AND ((a.winning_bidder IS NOT NULL AND a.winning_bidder_external_identity_id IS NULL)
          OR (a.seller_name IS NOT NULL AND a.seller_external_identity_id IS NULL))
    ), res AS MATERIALIZED (
      SELECT c.id, c.wb, c.sn,
             r.winning_bidder_identity_id AS wb_id, r.winning_bidder_verdict AS wb_v,
             r.seller_identity_id AS sn_id, r.seller_verdict AS sn_v
      FROM cand c
      CROSS JOIN LATERAL public.resolve_auction_event_identities(c.id, c.source, c.wb, c.winning_bid, c.sn) r
    ), upd AS (
      UPDATE public.auction_events a
      SET winning_bidder_external_identity_id = CASE
            WHEN a.winning_bidder_external_identity_id IS NULL AND res.wb_id IS NOT NULL AND a.winning_bidder = res.wb
            THEN res.wb_id ELSE a.winning_bidder_external_identity_id END,
          seller_external_identity_id = CASE
            WHEN a.seller_external_identity_id IS NULL AND res.sn_id IS NOT NULL AND a.seller_name = res.sn
            THEN res.sn_id ELSE a.seller_external_identity_id END
      FROM res
      WHERE a.ctid >= $1 AND a.ctid < $2
        AND a.id = res.id
        AND ((a.winning_bidder_external_identity_id IS NULL AND res.wb_id IS NOT NULL AND a.winning_bidder = res.wb)
          OR (a.seller_external_identity_id IS NULL AND res.sn_id IS NOT NULL AND a.seller_name = res.sn))
      RETURNING a.id,
                a.ctid >= $2 AS ahead,
                a.winning_bidder_external_identity_id = res.wb_id AS wb_set,
                a.seller_external_identity_id = res.sn_id AS sn_set
    )
    SELECT (SELECT count(*) FROM upd)::bigint AS rows_updated,
           (SELECT count(*) FROM upd WHERE wb_set)::bigint AS keyed_wb,
           (SELECT count(*) FROM upd WHERE sn_set)::bigint AS keyed_sn,
           count(*) FILTER (WHERE res.wb_v = 'no_identity')::bigint AS wb_no_identity,
           count(*) FILTER (WHERE res.wb_v = 'stop_word')::bigint AS wb_stop_word,
           count(*) FILTER (WHERE res.wb_v = 'contradicted')::bigint AS wb_contradicted,
           count(*) FILTER (WHERE res.wb_v = 'blank')::bigint AS wb_blank,
           count(*) FILTER (WHERE res.sn_v = 'no_identity')::bigint AS sn_no_identity,
           count(*) FILTER (WHERE res.sn_v = 'stop_word')::bigint AS sn_stop_word,
           count(*) FILTER (WHERE res.sn_v = 'contradicted')::bigint AS sn_contradicted,
           count(*) FILTER (WHERE res.sn_v = 'blank')::bigint AS sn_blank
    FROM res
    WHERE NOT EXISTS (SELECT 1 FROM upd WHERE upd.id = res.id AND upd.ahead)
  $q$ INTO v_res USING v_lo, v_hi;

  -- auction_events has no write-receipt trigger; record this writer's statement the way record_write_receipt does.
  IF v_res.rows_updated > 0 THEN
    INSERT INTO public.write_receipts (tbl, op, rows, writer, db_role, app_name, txid)
    VALUES ('auction_events', 'UPDATE', v_res.rows_updated, c_writer, current_user,
            current_setting('application_name', true), txid_current());
  END IF;

  -- New tuple versions may have extended the heap; the walk is done only when it has passed the current end.
  v_blocks_after := pg_catalog.pg_relation_size('public.auction_events') / current_setting('block_size')::bigint;

  RETURN jsonb_build_object(
    'keyed', v_res.rows_updated,
    'keyed_winning_bidder', v_res.keyed_wb,
    'keyed_seller', v_res.keyed_sn,
    'winning_bidder_no_identity', v_res.wb_no_identity,
    'winning_bidder_stop_word', v_res.wb_stop_word,
    'winning_bidder_contradicted', v_res.wb_contradicted,
    'winning_bidder_blank', v_res.wb_blank,
    'seller_no_identity', v_res.sn_no_identity,
    'seller_stop_word', v_res.sn_stop_word,
    'seller_contradicted', v_res.sn_contradicted,
    'seller_blank', v_res.sn_blank,
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

COMMENT ON FUNCTION public.key_auction_event_identities(integer, bigint) IS
'Sanctioned writer of auction_events.winning_bidder_external_identity_id and seller_external_identity_id for existing rows (2026-10-06). Scans about p_batch rows by physical block range starting at p_from_block and fills NULL keys of BaT lots (source bat or bringatrailer) by resolve_auction_event_identities: exact (platform bat, handle), not one of 37 observed parser junk strings, not contradicted by the lot''s own comments. Never changes a key already set, never writes another column, never mints an identity. Idempotent. One write_receipts row (writer key-auction-event-identities) per call that changed rows. Caller sets statement_timeout (1..60 s) and passes next_block back in. Returns keyed (rows updated), keyed_winning_bidder, keyed_seller, the left-NULL counts per column and reason (no_identity, stop_word, contradicted, blank; from the statement snapshot; a row that gains one key and lands ahead of the cursor is counted when the walk reaches it, so each open key is counted once per complete walk), next_block, remaining_blocks, blocks_scanned, done (true once next_block passes the heap end measured after the call''s own writes).';

REVOKE ALL ON FUNCTION public.resolve_auction_event_identities(uuid, text, text, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.key_auction_event_identities_on_write() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.key_auction_event_identities(integer, bigint) FROM PUBLIC;
DO $grants$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.resolve_auction_event_identities(uuid, text, text, numeric, text) FROM anon;
    REVOKE ALL ON FUNCTION public.key_auction_event_identities_on_write() FROM anon;
    REVOKE ALL ON FUNCTION public.key_auction_event_identities(integer, bigint) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.resolve_auction_event_identities(uuid, text, text, numeric, text) FROM authenticated;
    REVOKE ALL ON FUNCTION public.key_auction_event_identities_on_write() FROM authenticated;
    REVOKE ALL ON FUNCTION public.key_auction_event_identities(integer, bigint) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.resolve_auction_event_identities(uuid, text, text, numeric, text) TO service_role;
    GRANT EXECUTE ON FUNCTION public.key_auction_event_identities(integer, bigint) TO service_role;
  END IF;
END $grants$;

-- 6. Shape: from here the transaction holds ACCESS EXCLUSIVE on auction_events --------------------------------------
ALTER TABLE public.auction_events
  ADD COLUMN winning_bidder_external_identity_id uuid,
  ADD COLUMN seller_external_identity_id uuid;

-- Partial: a lot without a key has no entry. Serves the foreign keys' delete checks and readers of one member's lots.
CREATE INDEX idx_auction_events_winning_bidder_external_identity
  ON public.auction_events (winning_bidder_external_identity_id)
  WHERE winning_bidder_external_identity_id IS NOT NULL;
CREATE INDEX idx_auction_events_seller_external_identity
  ON public.auction_events (seller_external_identity_id)
  WHERE seller_external_identity_id IS NOT NULL;

COMMENT ON INDEX public.idx_auction_events_winning_bidder_external_identity IS
'Partial btree on the winning bidder key (rows with a key). Serves the foreign key''s delete check and readers of the lots one member won. 2026-10-06.';
COMMENT ON INDEX public.idx_auction_events_seller_external_identity IS
'Partial btree on the seller key (rows with a key). Serves the foreign key''s delete check and readers of the lots one member sold. 2026-10-06.';

-- Names sort after preserve_bat_live_projection, so on UPDATE these see the row that trigger returns.
CREATE TRIGGER trg_key_auction_event_identities_ins
BEFORE INSERT ON public.auction_events
FOR EACH ROW
WHEN (NEW.source IN ('bat', 'bringatrailer')
      AND ((NEW.winning_bidder IS NOT NULL AND NEW.winning_bidder_external_identity_id IS NULL)
        OR (NEW.seller_name IS NOT NULL AND NEW.seller_external_identity_id IS NULL)))
EXECUTE FUNCTION public.key_auction_event_identities_on_write();

CREATE TRIGGER trg_key_auction_event_identities_upd
BEFORE UPDATE OF winning_bidder, seller_name ON public.auction_events
FOR EACH ROW
WHEN (NEW.source IN ('bat', 'bringatrailer')
      AND (NEW.winning_bidder IS DISTINCT FROM OLD.winning_bidder
        OR NEW.seller_name IS DISTINCT FROM OLD.seller_name
        OR (NEW.winning_bidder IS NOT NULL AND NEW.winning_bidder_external_identity_id IS NULL)
        OR (NEW.seller_name IS NOT NULL AND NEW.seller_external_identity_id IS NULL)))
EXECUTE FUNCTION public.key_auction_event_identities_on_write();

COMMENT ON TRIGGER trg_key_auction_event_identities_ins ON public.auction_events IS
'Keys lane 2026-10-06: key the winner and seller of a new BaT lot row to external_identities at insert (resolve_auction_event_identities). Skipped when the writer passed both keys or neither text is set.';
COMMENT ON TRIGGER trg_key_auction_event_identities_upd ON public.auction_events IS
'Keys lane 2026-10-06: on UPDATE OF winning_bidder or seller_name of a BaT lot row, fill a NULL key, and derive again a key whose text changed unless the statement set it. Fires on every extract-bat-core upsert (both columns are in its payload) and on the live intake''s close; skipped when both keys are set and both texts are unchanged.';

COMMENT ON COLUMN public.auction_events.winning_bidder_external_identity_id IS
'Winning bidder of the lot as a key: FK to external_identities.id (ON DELETE SET NULL). Set when winning_bidder equals a BaT identity handle exactly (platform bat, case kept), is not one of 37 observed parser junk strings, and no bid on the lot by a different handle is at or above winning_bid. Writers: trg_key_auction_event_identities_ins and _upd at insert and when winning_bidder changes; key_auction_event_identities() for existing rows. NULL means unresolved: no text, no identity row yet, junk text, a non-BaT lot, or text the lot''s bids contradict. Owner: pipeline_registry. Unit: none. Grain: one lot. Clock: n/a.';
COMMENT ON COLUMN public.auction_events.seller_external_identity_id IS
'Seller of the lot as a key: FK to external_identities.id (ON DELETE SET NULL). Set when seller_name equals a BaT identity handle exactly (platform bat, case kept), is not one of 37 observed parser junk strings, and, if comments on the lot carry BaT''s seller flag (auction_comments.is_seller), one of them is by this handle. Writers: trg_key_auction_event_identities_ins and _upd at insert and when seller_name changes; key_auction_event_identities() for existing rows. NULL means unresolved: no text, no identity row yet (sellers who never commented), junk text, a non-BaT lot, or a seller flag on another handle. Owner: pipeline_registry. Unit: none. Grain: one lot. Clock: n/a.';
COMMENT ON COLUMN public.auction_events.winning_bidder IS
'Buyer handle as text when the lot sold (BaT username). Keyed to external_identities by winning_bidder_external_identity_id where the rule resolves it (2026-10-06). Unit: none. Source: extract-bat-core (page buyer, sold lots only); ingest_bat_live_events (frame buyer). Grain: one lot. Clock: n/a.';
COMMENT ON COLUMN public.auction_events.seller_name IS
'Seller handle or name as text (BaT: seller username). Keyed to external_identities by seller_external_identity_id where the rule resolves it (2026-10-06). Unit: none. Source: extract-bat-core (page seller); other extractors. Grain: one lot. Clock: n/a.';

-- 7. Foreign keys last: adding one locks external_identities against writes until COMMIT ------------------------------
ALTER TABLE public.auction_events
  ADD CONSTRAINT auction_events_winning_bidder_external_identity_id_fkey
    FOREIGN KEY (winning_bidder_external_identity_id) REFERENCES public.external_identities(id) ON DELETE SET NULL NOT VALID,
  ADD CONSTRAINT auction_events_seller_external_identity_id_fkey
    FOREIGN KEY (seller_external_identity_id) REFERENCES public.external_identities(id) ON DELETE SET NULL NOT VALID;

COMMIT;
