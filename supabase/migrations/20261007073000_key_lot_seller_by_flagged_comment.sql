-- 20261007073000_key_lot_seller_by_flagged_comment.sql
--
-- Keys lane, 2026-10-07 (case C28, data-machine-cases.md section 12 item 3, "key at insert, everywhere").
--
-- THE ASK WAS A TRIGGER; THE TRIGGER EXISTS. 20261006213000 (PR #705, merged 2026-10-06 21:55:33Z, applied 21:55:59Z by the
-- pipeline_registry rows it wrote) installed trg_key_auction_event_identities_ins (BEFORE INSERT) and
-- trg_key_auction_event_identities_upd (BEFORE UPDATE OF winning_bidder, seller_name) on auction_events. Both are enabled on
-- prod (pg_trigger, 2026-10-07 02:38Z) and contract-tested (test_auction_event_identity_keys.sql). No lander sets the keys
-- in code because the database does it for every lander at once. This migration adds no trigger, column, index or function.
-- It changes the rule those triggers call, for the seller only, to resolve the one block of open keys that evidence the
-- rule already reads can settle.
--
-- MEASURED (prod, read-only through scripts/data/q.sh, 2026-10-07 UTC):
--   Fill at 03:04Z, BaT lot rows (source bat or bringatrailer) 261,916: winning_bidder text 187,755, keyed 187,325 (99.77%);
--   seller_name text 256,899, keyed 251,554 (97.92%). Open: 430 winners, 5,345 sellers.
--   No decay since the backfill's last call (01:57:02Z): no lot row was created after it (newest 00:31:08Z). The triggers
--   keyed at least 11,983 rows themselves: 252,551 rows held a key at about 02:50Z, and the backfill updated at most 240,568
--   (write_receipts, 3,670 calls with changes, 22:04:39Z to 01:57:02Z).
--   Rule cost per call (EXPLAIN ANALYZE on prod rows, 02:40Z to 03:00Z): a seller text with no identity and no comments 0.83 ms,
--   scan included (500 calls); both texts keyed, with the lot's comment pass, 15.9 ms cold and 0.32 ms warm (300 recent lots);
--   the heaviest recent lot (1,104 comments) 21 ms cold and 7 ms warm. All under the 50 ms line, so a row trigger is
--   reasonable, and it is the one that runs.
--   Calls per day: inserts with seller text were 189, 149, 58 and 180 rows on 10-02 to 10-05, and 15,040 rows in the 3 hours of
--   the missing-lot load (17,315 rows created). An update calls the rule only for a row with text and an open key, or a
--   changed text; the rows still open that a lander rewrote are 22 on 10-06 and 22 on 10-07 to 03:00Z.
--
--   The 5,345 open seller keys, by what the database knows (03:04Z to 03:12Z):
--     191  an identity with exactly that handle exists: 185 contradicted by the lot's own flagged comments, 6 waiting for
--          their next write (below).
--   3,618  no identity holds that exact text, one holds it in another letter case. 3,617 were created 2026-10-06 22:00Z to
--          2026-10-07 00:59Z by create_missing_bat_auction_events, which copied bat_listings.seller_username from rows
--          extract-auction-comments wrote in January and February 2026: the feed's lower-cased slug (examplecars for the
--          member shown as ExampleCars). One row is older.
--      3  several identities differ from the text only in letter case (983 such groups exist among 690,533 BaT identities).
--   1,533  no identity in any letter case: sellers whose comments we never captured. Left NULL; this rule never mints.
--   Of the 3,621 rows in the two case groups, 3,597 have a comment on the lot that BaT flags as the seller's, by an identity
--   whose handle equals the text in any letter case, and all such comments name one identity.
--   Where identities arrive late (extract-bat-core lots created 2026-10-02 to 10-05, 576 with seller text): the identity
--   existed when the lot row was first written for 440, did not exist then and was minted later for 111 (19%), and does not
--   exist in any case for 25. Of the 86 late ones on 10-02 to 10-04, 79 were written again after the identity arrived
--   (trg_key_auction_event_identities_upd keys them on that write) and 7 were not: about 2 a day stay open until a backfill
--   pass. extract-bat-core upserts the lot row before it writes the comments that mint the identity (a lot written at
--   02:27:03.769Z, its seller's identity minted at 02:27:03.910Z).
--
-- THE RULE CHANGE (seller only; the winner is unchanged: none of the 12 winners with no identity has a comment author that
-- matches in any letter case). resolve_auction_event_identities keeps its signature, OUT columns, verdicts and every path it
-- had. After the exact lookup (platform bat, handle = text, case kept) finds no identity, it looks at the lot's own comments:
-- those flagged is_seller whose canonical author key (auction_comments.external_identity_id) is a BaT identity whose handle
-- equals the text in any letter case. Exactly one such identity: the seller key, verdict keyed. None, or several: unchanged,
-- no_identity. The contradiction check then runs as before, so a flag on other handles still blocks. An exact identity always
-- wins over the fallback, and a key already set is never touched.
-- Simulated on prod (the same joins, read-only, 03:12Z): of the 5,154 rows with no exact identity, 3,597 would key and none
-- would be ambiguous; the 185 contradicted rows would not change; the 6 waiting rows key today. Fill after the backfill is
-- run again: 255,157 of 256,899 sellers (99.32%), up from 251,554 (97.92%). This migration changes no row; the 5,154 stay
-- as they are until the backfill, or the lot's next write of its text, reaches them.
--
-- WHAT THIS DOES NOT DO, AND WHY (the trade-offs the brief asked for):
--   * At INSERT the fallback finds nothing: a lot's comments cannot reference a lot that is not inserted yet (the foreign
--     key), so a lower-cased handle is keyed on the lot's next write of its text, or by the backfill. Resolving lower-cased
--     text at insert needs a case-insensitive lookup on external_identities. Without an index it scans 696K rows, 1,344 ms
--     per call on prod (EXPLAIN ANALYZE, 2026-10-07), so it would need lower(handle) indexed on a table every comment batch
--     writes. Measured need: 1 of the 3,618 rows came from an ordinary lander. Not built.
--   * Identities that arrive after the lot row (about 2 lots a day stay open) are healed by the next write or by the
--     backfill. A trigger on auction_comments or external_identities would heal them at the event, on the two hottest tables,
--     for 2 rows a day. Not built; the pull request lists the cheaper lander-side and scheduled options.
--
-- LOCK COST: CREATE OR REPLACE FUNCTION takes no table lock. COMMENT ON COLUMN takes SHARE UPDATE EXCLUSIVE on
-- auction_events, which does not block reads or writes of rows; lock_timeout 5 s makes it fail rather than queue behind a
-- vacuum. UPDATE pipeline_registry touches 1 row. No scan, no index, no rewrite.
--
-- GUARD: the function body on prod was read 2026-10-07 (md5 starting ff6aeb85191dbfdc, 2,902 characters, equal to the body
-- 20261006213000 installs). The migration refuses to replace any other body, so it cannot overwrite a change made since.
-- It also accepts its own body (md5 starting 0938e28889802dfc), so a second run is a no-op. Sixteen hex digits name a body
-- as surely as thirty-two for this purpose, and a full digest is what the repo's secret scanner reads as a token.
--
-- Contract: supabase/sql/test_auction_event_identity_keys_at_insert.sql (PostgreSQL 17, CI job metric-fold-health-contract).

BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

DO $guard$
BEGIN
  IF (SELECT left(md5(p.prosrc), 16) FROM pg_catalog.pg_proc p
      WHERE p.oid = 'public.resolve_auction_event_identities(uuid, text, text, numeric, text)'::regprocedure)
     NOT IN ('ff6aeb85191dbfdc', '0938e28889802dfc')
  THEN
    RAISE EXCEPTION 'resolve_auction_event_identities differs from the 20261006213000 body read on prod 2026-10-07; re-read it before replacing it';
  END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION public.resolve_auction_event_identities(
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
  v_flag_identities uuid[];
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
      IF seller_identity_id IS NULL THEN
        -- No identity holds exactly this text. A lander that copied a lower-cased feed slug (bat_listings.seller_username)
        -- wrote 'examplecars' for the member BaT shows as 'ExampleCars'. The lot's own comments settle it: BaT flags the
        -- seller's comments, and each carries its author's canonical key. Key only when every flagged comment whose
        -- author's handle equals the text in any letter case names one identity.
        SELECT array_agg(DISTINCT e.id) INTO v_flag_identities
        FROM public.auction_comments c
        JOIN public.external_identities e ON e.id = c.external_identity_id AND e.platform = 'bat'
        WHERE c.auction_event_id = p_lot_id AND c.is_seller AND lower(e.handle) = lower(p_seller_name);
        IF cardinality(v_flag_identities) = 1 THEN
          seller_identity_id := v_flag_identities[1];
        END IF;
      END IF;
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
'The rule for auction_events.winning_bidder_external_identity_id and seller_external_identity_id (2026-10-06; seller fallback 2026-10-07). For one lot, returns the identity each text names and a verdict: keyed, not_bat (source not bat or bringatrailer), blank, stop_word (one of 37 observed parser junk strings, compared lower-cased), no_identity (no external_identities row with platform bat and exactly this handle, and for the seller no flagged comment that names one), or contradicted. Seller fallback: when no identity has exactly the text, the lot''s comments flagged is_seller whose canonical author key is a BaT identity with a handle equal to the text in any letter case name the key if they name exactly one identity (the missing-lot writer copied lower-cased feed handles: examplecars for ExampleCars); none or several: no_identity. An exact identity always wins. Contradicted: for the winner, a bid on the lot by a different handle (case-insensitive) at or above p_winning_bid; for the seller, comments on the lot carry the seller flag and none of them is by this handle. A NULL text returns a NULL verdict. Measured basis (prod, 2026-10-07 03:12Z): 3,597 of 5,154 seller texts with no exact identity resolve through the fallback and 0 are ambiguous; winner and exact paths unchanged. Reads only; writes nothing.';

-- Name the mechanism where the rule is stated: the seller key's registry row and column comment (append once).
UPDATE public.pipeline_registry
SET description = description || ' When no identity has exactly the text, a comment on the lot that BaT flags as the seller''s, by a BaT identity whose handle equals the text in any letter case, names the key if all such comments name one identity (20261007073000; the missing-lot writer copied lower-cased feed handles).',
    updated_at = now()
WHERE table_name = 'auction_events'
  AND column_name = 'seller_external_identity_id'
  AND description NOT LIKE '%flags as the seller%';

DO $comments$
DECLARE cur text;
BEGIN
  SELECT col_description(a.attrelid, a.attnum) INTO cur
  FROM pg_attribute a
  WHERE a.attrelid = 'public.auction_events'::regclass AND a.attname = 'seller_external_identity_id' AND NOT a.attisdropped;
  IF cur IS NOT NULL AND cur NOT LIKE '%flags as the seller%' THEN
    EXECUTE format('COMMENT ON COLUMN public.auction_events.seller_external_identity_id IS %L',
      cur || ' Fallback (20261007073000): when no identity has exactly the text, a comment on the lot that BaT flags as the seller''s, by a BaT identity whose handle equals the text in any letter case, names the key if all such comments name one identity.');
  END IF;
END
$comments$;

COMMIT;
