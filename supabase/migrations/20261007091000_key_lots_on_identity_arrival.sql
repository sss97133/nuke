-- 20261007091000_key_lots_on_identity_arrival.sql
--
-- Keys lane, 2026-10-07 (case C28, data-machine-cases.md section 12 item 3, "key at insert, everywhere"; lead's direction
-- of 2026-10-07: key the waiting lots when the identity arrives, through resolve_auction_event_identities, with the fewest
-- moving parts).
--
-- THE GAP. A lot's winner or seller is keyed at insert and on every write of the text (20261006213000), but only to an
-- identity that exists at that moment. extract-bat-core upserts the lot row first and writes the comments that mint the
-- identities after it, so an identity can arrive a moment, or a day, after the lot it names. The lot is keyed on its next
-- write; a lot that is never written again stays open until a backfill is run. This migration keys it when the identity
-- arrives: an AFTER INSERT trigger on external_identities (platform bat) finds the open lots whose text equals the new
-- handle exactly, and asks the existing rule about each.
--
-- MEASURED (prod, read-only through scripts/data/q.sh, 2026-10-07 UTC):
--   The lag. extract-bat-core lots created 10-02 to 10-05, 576 with seller text: the seller's identity existed when the lot
--   row was first written for 440, was minted later for 111 (19%), and does not exist in any case for 25. Of the 86 late
--   ones on 10-02 to 10-04, 79 were written again after the identity arrived and keyed by the update trigger; 7 were not
--   (about 2 a day). One lot was written at 02:27:03.769Z and its seller's identity minted at 02:27:03.910Z.
--   Decay now (03:54Z; the same at 03:39Z). BaT lot rows created since the backfill ended (01:57:02Z): 0. Open keys 5,345 sellers and 430 winners.
--   Written since 01:57:02Z and still open: 6 sellers, of which 2 are keyable today (the identity arrived after the write)
--   and 4 truly no_identity. Created since the triggers went live (21:55:59Z): 3,731 open sellers, 3 keyable today and
--   3,727 no_identity (3,597 of those resolve through the flagged-comment fallback of 20261007090000), 1 contradicted;
--   2 open winners, 1 no_identity, 1 stop word. Created before: sellers 1,427 no_identity, 184 contradicted, 3 keyable;
--   winners 390 contradicted, 27 stop words, 11 no_identity. The keyable rows are the ones this trigger keys on arrival.
--   How many lots wait on one text: sellers 4,319 distinct open texts, at most 4 lots for any text in its exact case (the
--   one text with 98 is lower-cased); winners 366 texts, at most 17. The trigger keys at most 100 lots per arrival.
--   Identity mints. BaT identities created per day 10-01 to 10-05: 434, 730, 768, 561, 538; 79,418 on 10-06 (the comment
--   author backfill); 122 so far on 10-07. pg_stat_statements since 09-29 09:20Z: about 14.4K identity insert statements in
--   8 days, 3.5 ms mean, 34.9 ms for the rows that carry a profile_url.
--   The lookup needs an index. auction_events has none on winning_bidder or seller_name. Without one the probe is a parallel
--   sequential scan of 262K rows: 1,602 ms cold, 139 ms warm, twice per identity (EXPLAIN ANALYZE, 03:40Z to 03:50Z).
--
-- TRIGGER OR A SCHEDULED PASS (the brief asked for the choice by measured cost):
--   * Both need the same lookup to be cheap. Without an index a probe is a parallel sequential scan of 262K rows (1,602 ms
--     cold, 139 ms warm on prod), and a pass over the open sellers through the `source` index took 312 to 446 ms warm on prod
--     and several seconds cold. With the two partial indexes (160 kB and 32 kB on a prod-sized local copy: 262K lots, 700K
--     identities, shared_buffers 1 GB) a probe takes 0.02 to 0.04 ms.
--   * Trigger, measured on that copy: +10 microseconds per identity insert that nobody waits for (20,000 single-row inserts:
--     384 and 398 ms with the trigger, 187 and 193 ms without); +6.7 microseconds a row in one 100,000-row statement (1,586 ms
--     against 916 ms); +107 microseconds for an arrival that keys a lot with 40 comments (1,000 arrivals, 1,000 lots keyed:
--     119 ms against 12 ms for the bare inserts). At about 1.8K identity inserts a day that is tens of milliseconds a day. A
--     burst like 10-06's 79K mints costs about half a second, once. Lag: none. New parts: two indexes, one function, one trigger.
--   * Scheduled pass over the lots created in the last N days: with the same indexes 3.4 ms a run (300 recent open lots); every
--     10 minutes that is about 0.5 s a day locally, several times that on prod; without them 45 to 65 s a day on prod. Lag of up
--     to 10 minutes, and a pg_cron job with its ledger row and its own assay on top of the indexes.
--   Once the indexes exist the cost is a tie, both well under a second a day. The trigger wins on lag (none) and on parts (no
--   job to schedule, record or watch). Its risk is that it runs in the identity insert path, so it is built never to fail that
--   insert: it skips rows another transaction holds (FOR UPDATE SKIP LOCKED, so it never waits and cannot deadlock), caps its
--   work at 100 lots, and turns any error into a WARNING. A swallowed error leaves lots open, never keyed wrong; the assay below
--   counts them.
--
-- WHAT IT DOES. After an identity (platform bat) is inserted, for each open lot whose seller_name, or whose winning_bidder,
-- equals the new handle exactly and whose source is bat or bringatrailer: resolve_auction_event_identities decides (stop
-- words, a bid or a seller flag on the lot that contradicts the text, non-BaT lots), and only a verdict of keyed writes the
-- key, only where the key is still NULL and the text is unchanged. Only the column the handle names is passed to the rule,
-- so the other key of the lot is left to its own arrival or write. Nothing else is written: the UPDATE names only the key
-- column, so trg_key_auction_event_identities_upd does not fire, updated_at is untouched, and no identity is minted. A
-- case-different text (the lower-cased feed handles) is not matched here: that is the comment-side fallback of
-- 20261007090000, reached by the next write of the text or by the backfill.
-- Contradicting evidence is judged on what the lot holds at that moment. extract-bat-core writes its comments after the
-- identities, so the same read's bids are not there yet: the same limit the insert trigger has, and a set key is never
-- touched afterwards.
--
-- ASSAY (the thing that notices a silent failure): the number of open keys whose rule verdict is keyed. After this migration
-- and one backfill pass it stays at a handful (a lot another transaction held at the moment its identity arrived, a lot past
-- the 100 cap). The query is in the pull request and in the contract.
--
-- LOCK COST. Two transactions in this file so that no transaction holds a lock on both tables.
--   1. Two CREATE INDEX statements take SHARE on auction_events until COMMIT: reads continue, writes wait. Each scans the
--      47,030-block (367 MB) heap once: prod measured 2.66 s cold and 0.70 s warm for a full scan (20261006213000), and the
--      second build runs warm; on a prod-sized local copy the two builds took 47 ms and 36 ms. Expect up to 1.5 to 3.5 s of
--      blocked writes to auction_events (extract-bat-core upserts, the live intake). With lock_timeout 5 s the migration fails
--      before it changes anything if another session holds a conflicting lock that long.
--   2. The function, comments and registry rows take no table lock beyond SHARE UPDATE EXCLUSIVE for COMMENT ON COLUMN
--      (rows stay writable). CREATE TRIGGER takes SHARE ROW EXCLUSIVE on external_identities, held for milliseconds because
--      it is the last statement; identity inserts wait that long.
--   The indexes are built first and the trigger last, so the trigger never exists without the indexes that make it cheap.
--
-- SCHEMA_LAW pre-mint checklist (the same seven questions as 20261006213000):
--   1. Search before mint: check-capability-before-mint is CLEAR for the function, trigger and both index names, and prod
--      has no object with any of them (2026-10-07). No table or column is created.
--   2. Observations first: the keys are derived from text on the lot row; no testimony is written or changed.
--   3. One grammar: no fact-bearing row; the verdict vocabulary is the rule's, unchanged.
--   4. Could a view do this: a view could resolve at read time; the card requires the key to be a stored foreign key.
--   5. Invariants in the data layer with attack tests: the contract has the stop word, contradicted, writer-set key,
--      non-BaT, wrong-platform, case, cap, locked-row and failing-rule cases.
--   6. Disjoint writers: pipeline_registry names the arrival trigger in the write_via of both keys; the text writers are
--      unchanged.
--   7. Migration, WHY, live verification, RLS: this header; the verify SQL is in the pull request; RLS is unchanged and
--      EXECUTE on the new function is revoked from PUBLIC, anon and authenticated.
--
-- Contract: supabase/sql/test_auction_event_identity_keys_on_arrival.sql (PostgreSQL 17, CI job metric-fold-health-contract).

-- 1. The open keys, indexed ------------------------------------------------------------------------------------------------
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

-- Partial: a lot with no text or with a key has no entry, so each index holds only what is waiting (5,345 and 430 rows on
-- 2026-10-07). The predicates repeat the trigger function's WHERE clauses word for word, so the planner can prove them.
CREATE INDEX IF NOT EXISTS idx_auction_events_open_seller_text
  ON public.auction_events (seller_name)
  WHERE seller_name IS NOT NULL AND seller_external_identity_id IS NULL AND source IN ('bat', 'bringatrailer');
CREATE INDEX IF NOT EXISTS idx_auction_events_open_winner_text
  ON public.auction_events (winning_bidder)
  WHERE winning_bidder IS NOT NULL AND winning_bidder_external_identity_id IS NULL AND source IN ('bat', 'bringatrailer');

COMMENT ON INDEX public.idx_auction_events_open_seller_text IS
'Partial btree on seller_name for BaT lots whose seller text is set and whose seller_external_identity_id is NULL: the open seller keys (5,345 rows on 2026-10-07). Serves trg_key_auction_events_on_identity_arrival, which finds the lots waiting for a newly minted identity. Rows leave the index when the key is set.';
COMMENT ON INDEX public.idx_auction_events_open_winner_text IS
'Partial btree on winning_bidder for BaT lots whose winner text is set and whose winning_bidder_external_identity_id is NULL: the open winner keys (430 rows on 2026-10-07). Serves trg_key_auction_events_on_identity_arrival. Rows leave the index when the key is set.';
COMMIT;

-- 2. The arrival trigger ---------------------------------------------------------------------------------------------------
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

-- IF NOT EXISTS above would accept an index of the same name that is something else; refuse that.
DO $guard$
BEGIN
  IF (SELECT count(*) FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid = i.indexrelid
      WHERE i.indrelid = 'public.auction_events'::regclass AND i.indisvalid AND i.indpred IS NOT NULL
        AND ((c.relname = 'idx_auction_events_open_seller_text'
              AND pg_get_indexdef(c.oid) LIKE '%USING btree (seller_name)%seller_external_identity_id IS NULL%bringatrailer%')
          OR (c.relname = 'idx_auction_events_open_winner_text'
              AND pg_get_indexdef(c.oid) LIKE '%USING btree (winning_bidder)%winning_bidder_external_identity_id IS NULL%bringatrailer%'))) <> 2
  THEN
    RAISE EXCEPTION 'idx_auction_events_open_seller_text / _winner_text are missing, invalid or not the partial indexes this migration builds';
  END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION public.key_auction_events_on_identity_arrival()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  c_max_lots constant integer := 100;
  r record;
BEGIN
  -- Fast path, one statement: does any open lot name this handle? Two probes of the partial indexes.
  IF NOT (EXISTS (SELECT 1 FROM public.auction_events a
                  WHERE a.seller_name = NEW.handle AND a.seller_external_identity_id IS NULL
                    AND a.source IN ('bat', 'bringatrailer'))
       OR EXISTS (SELECT 1 FROM public.auction_events a
                  WHERE a.winning_bidder = NEW.handle AND a.winning_bidder_external_identity_id IS NULL
                    AND a.source IN ('bat', 'bringatrailer'))) THEN
    RETURN NULL;
  END IF;

  -- Never fail the identity insert: an error here leaves lots open, which the assay counts, instead of losing the identity
  -- (QUERY_CANCELED, a statement timeout, is not caught and still ends the statement).
  BEGIN
    -- A lot another transaction holds is skipped, not waited for: that writer is rewriting the row, and the update trigger
    -- keys it then. Skipping also means this trigger cannot take part in a deadlock.
    FOR r IN
      SELECT a.id, a.source, a.winning_bid, a.seller_name
      FROM public.auction_events a
      WHERE a.seller_name = NEW.handle AND a.seller_external_identity_id IS NULL AND a.source IN ('bat', 'bringatrailer')
      LIMIT c_max_lots
      FOR UPDATE OF a SKIP LOCKED
    LOOP
      UPDATE public.auction_events a
      SET seller_external_identity_id = k.seller_identity_id
      FROM public.resolve_auction_event_identities(r.id, r.source, NULL, r.winning_bid, r.seller_name) k
      WHERE a.id = r.id AND a.seller_external_identity_id IS NULL AND a.seller_name = r.seller_name
        AND k.seller_identity_id IS NOT NULL;
    END LOOP;

    FOR r IN
      SELECT a.id, a.source, a.winning_bid, a.winning_bidder
      FROM public.auction_events a
      WHERE a.winning_bidder = NEW.handle AND a.winning_bidder_external_identity_id IS NULL AND a.source IN ('bat', 'bringatrailer')
      LIMIT c_max_lots
      FOR UPDATE OF a SKIP LOCKED
    LOOP
      UPDATE public.auction_events a
      SET winning_bidder_external_identity_id = k.winning_bidder_identity_id
      FROM public.resolve_auction_event_identities(r.id, r.source, r.winning_bidder, r.winning_bid, NULL) k
      WHERE a.id = r.id AND a.winning_bidder_external_identity_id IS NULL AND a.winning_bidder = r.winning_bidder
        AND k.winning_bidder_identity_id IS NOT NULL;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'key_auction_events_on_identity_arrival: handle % left its lots open: % (%)', NEW.handle, SQLERRM, SQLSTATE;
  END;
  RETURN NULL;
END
$fn$;

COMMENT ON FUNCTION public.key_auction_events_on_identity_arrival() IS
'AFTER INSERT ROW trigger function on external_identities, platform bat (trg_key_auction_events_on_identity_arrival). Keys the lots that were waiting for the identity: BaT auction_events rows whose seller_name, or winning_bidder, equals the new handle exactly and whose key column is NULL. Asks resolve_auction_event_identities (stop words, contradicting bids or seller flags, non-BaT lots), passes only the text the handle names, and sets the key only on a keyed verdict, only where it is still NULL and the text unchanged. At most 100 lots per column per arrival; a lot another transaction holds is skipped (FOR UPDATE SKIP LOCKED), never waited for. Any error becomes a WARNING and leaves the lots open: it never fails the identity insert. Writes only the key column, so the update trigger does not fire and updated_at is untouched; mints nothing. Two probes of idx_auction_events_open_seller_text and _winner_text when nothing waits. Measured basis (prod, 2026-10-07): the seller identity arrived after the lot row for 111 of 576 lots; about 2 lots a day were never written again. Assay: open keys whose rule verdict is keyed.';

REVOKE ALL ON FUNCTION public.key_auction_events_on_identity_arrival() FROM PUBLIC;
DO $grants$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.key_auction_events_on_identity_arrival() FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.key_auction_events_on_identity_arrival() FROM authenticated;
  END IF;
END $grants$;

-- Name the mechanism where the rule and its writers are stated: both keys' registry rows and column comments (append once).
UPDATE public.pipeline_registry
SET write_via = write_via || ' When the identity arrives: trg_key_auction_events_on_identity_arrival (AFTER INSERT on external_identities, platform bat; 20261007091000) keys the open lots whose text equals the new handle, through the same rule.',
    updated_at = now()
WHERE table_name = 'auction_events'
  AND column_name IN ('winning_bidder_external_identity_id', 'seller_external_identity_id')
  AND write_via NOT LIKE '%identity_arrival%';

DO $comments$
DECLARE col text; cur text;
BEGIN
  FOREACH col IN ARRAY ARRAY['winning_bidder_external_identity_id', 'seller_external_identity_id'] LOOP
    SELECT col_description(a.attrelid, a.attnum) INTO cur
    FROM pg_attribute a
    WHERE a.attrelid = 'public.auction_events'::regclass AND a.attname = col AND NOT a.attisdropped;
    IF cur IS NOT NULL AND cur NOT LIKE '%identity_arrival%' THEN
      EXECUTE format('COMMENT ON COLUMN public.auction_events.%I IS %L', col,
        cur || ' Also keyed when the identity arrives: trg_key_auction_events_on_identity_arrival (AFTER INSERT on external_identities) keys the open lots whose text equals the new handle exactly, at most 100 per arrival, skipping rows another transaction holds.');
    END IF;
  END LOOP;
END
$comments$;

-- Last: the trigger, so external_identities is locked only for the commit, and never exists without its indexes.
CREATE OR REPLACE TRIGGER trg_key_auction_events_on_identity_arrival
AFTER INSERT ON public.external_identities
FOR EACH ROW
WHEN (NEW.platform = 'bat')
EXECUTE FUNCTION public.key_auction_events_on_identity_arrival();

COMMENT ON TRIGGER trg_key_auction_events_on_identity_arrival ON public.external_identities IS
'Keys BaT lots that were waiting for a new identity (key_auction_events_on_identity_arrival): AFTER INSERT, FOR EACH ROW, only platform bat. Fires once per identity row actually inserted (an ON CONFLICT DO NOTHING that inserts nothing does not fire it). Never fails the insert; see the function.';
COMMIT;
