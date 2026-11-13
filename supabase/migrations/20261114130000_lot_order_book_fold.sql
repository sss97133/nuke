-- 20261114130000_lot_order_book_fold.sql
--
-- Stack A, "The auction as an order book" (case ledger §13.2): the fold layer, stored.
--
-- WHY. The registry (public.stacks SA v3, read 2026-11-11 18:37Z) says: fold "real, computed per read ... Nothing
-- stored"; baseline curve, residual and feature missing because each needs the stored fold. v_stacks: coverage 0.50,
-- 9 of 18 needs present, 6 missing, two of them "order book fold per lot per minute". Until the fold is rows, no
-- cohort curve can be computed over lots, no residual against it, and the /stacks page keeps reading a frozen file.
--
-- WHAT. One row per lot per bid: the book's state after that bid, point-in-time (only bids posted at or before it).
-- State changes only on a bid, so the state at any minute is the lot's last row at or before that minute; a per-minute
-- grid (10,080 rows per lot per week) would store the same states repeated.
--   lot_order_book        the fold. PRIMARY KEY (auction_event_id, bid_seq).
--   lot_order_book_state  one row per folded lot: what the fold read and its coverage (bids held, folded, outside the
--                         window, without an identity key), the lot clocks it used, and whether the lot is final.
--   fold_lot_order_book(lot)        refolds one lot from its log (replace, the fold is replayable; no testimony written).
--   fold_lot_order_books(budget, closed_days, max_lots)   the scheduled driver, bounded by a time budget.
--   lot_order_book_read(lot)        the public reader: rows + coverage, behind the public-vehicle gate.
--
-- ONE FOLD DEFINITION. Same rules as nuke_frontend/src/pages/stacks/orderBookReader.ts (bidEvents, foldOrderBook):
--   * a bid is an auction_comments row keyed to the lot with comment_type 'bid', a posted time and an amount >= 0;
--   * order: posted_at, then BaT comment id (missing = 0), then row id as text;
--   * a row posted more than 14 days before the lot's close as last read is a key conflict: counted, never folded;
--   * a book entry is an identity (external_identity_id) or, without one, the single bid row: unkeyed bids are never
--     unified by handle;
--   * price = highest bid so far; an entry's level = its highest bid so far; depth at P = entries with level >= P.
-- Stored features of the state: entrants, identities, unresolved, second_best (the second entry's level),
-- depth_90 and depth_75 (entries within 10% and 25% of the price). A bid is a lower bound on willingness to pay.
--
-- CLOCKS. posted_at = event clock (BaT, to the second). landed_at = ingest clock (the comment row's created_at).
-- close_at = the lot's close as read when folded (moves with soft-close extensions while live). folded_at = fold clock.
-- A row whose landed_at is long after posted_at is source reconstruction, not live knowledge; both clocks are kept.
--
-- MEASURED on prod, read-only, 2026-11-11 18:45Z to 19:00Z. BaT lots closing within -3 d .. +10 d: 2,010; the most
-- bids on one of them: 116; that lot's fold statement, cold: 244 ms (125 buffers, 59 read), through
-- idx_auction_comments_auction; the book self-join was 6,786 rows. On the 300 lots nearest their close: 4,957 bid rows
-- held, 0 keyed to another vehicle than their lot's, 0 outside the 14-day window; bid rows held equal the lot row's
-- own count on 293 lots and are short on 7 (4 of the 86 already closed). 1 of the 2,010 lots is not in
-- auction_events_canonical; the reader refuses it, as the page does.
-- LOAD. The driver stops at its time budget and at max_lots, nearest close first, and skips lots whose row has not
-- been written since their last fold. The budget stays under the role's default statement timeout, which is not raised.
-- FINAL means complete, not old: closed 6 hours, the lot row written after its close, and at least as many bid rows
-- held as the lot row counts. A closed lot that is short stays open and is refolded while it is inside the window.
-- No backfill here: lots closed more than p_closed_days ago are a separate bounded run. The registry substrate
-- "order book fold per lot per minute" is NOT declared here, because the feature need that shares it says "replayed over
-- past lots", which is not true until that backfill has run.
-- Contract: supabase/sql/test_lot_order_book_fold.sql.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.lot_order_book (
  auction_event_id     uuid        NOT NULL REFERENCES public.auction_events(id) ON DELETE CASCADE,
  bid_seq              integer     NOT NULL CHECK (bid_seq >= 1),
  bid_comment_id       uuid        NOT NULL,
  posted_at            timestamptz NOT NULL,
  landed_at            timestamptz,
  close_at             timestamptz,
  seconds_to_close     integer,
  amount               numeric     NOT NULL,
  price                numeric     NOT NULL,
  external_identity_id uuid,
  entrants             integer     NOT NULL,
  identities           integer     NOT NULL,
  unresolved           integer     NOT NULL,
  second_best          numeric,
  depth_90             integer     NOT NULL,
  depth_75             integer     NOT NULL,
  fold_version         text        NOT NULL,
  folded_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (auction_event_id, bid_seq)
);
CREATE INDEX IF NOT EXISTS idx_lot_order_book_seconds_to_close
  ON public.lot_order_book (seconds_to_close) WHERE seconds_to_close IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.lot_order_book_state (
  auction_event_id uuid        PRIMARY KEY REFERENCES public.auction_events(id) ON DELETE CASCADE,
  vehicle_id       uuid,
  close_at         timestamptz,
  lot_updated_at   timestamptz,
  lot_total_bids   integer,
  bids_held        integer     NOT NULL,
  bids_folded      integer     NOT NULL,
  bids_outside     integer     NOT NULL,
  bids_unkeyed     integer     NOT NULL,
  is_final         boolean     NOT NULL DEFAULT false,
  fold_version     text        NOT NULL,
  folded_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lot_order_book_state_open
  ON public.lot_order_book_state (close_at) WHERE NOT is_final;

COMMENT ON TABLE public.lot_order_book IS
'Stack A fold (case ledger 13.2): one row per lot per bid, the order book''s state after that bid, point-in-time. Grain: (auction_event_id, bid_seq). Event clock posted_at, ingest clock landed_at, close as read close_at, fold clock folded_at. Written only by fold_lot_order_book (replace per lot, replayable from auction_comments). Rules shared with orderBookReader.ts: 14-day window, unkeyed bids never unified by handle. Read through lot_order_book_read.';
COMMENT ON TABLE public.lot_order_book_state IS
'One row per lot folded into lot_order_book: the lot clocks the fold used and its coverage (bid rows held on the lot key, folded, outside the 14-day window, without an identity key), and is_final once the lot is complete: closed 6 hours, its row written after the close, and at least as many bid rows held as the lot row counts. Written only by fold_lot_order_book.';
COMMENT ON COLUMN public.lot_order_book.second_best IS 'The second book entry''s level (its highest bid so far) as of this bid; NULL with one entrant.';
COMMENT ON COLUMN public.lot_order_book.depth_90 IS 'Book entries whose level is at least 90% of the price as of this bid, the leader included.';
COMMENT ON COLUMN public.lot_order_book.depth_75 IS 'Book entries whose level is at least 75% of the price as of this bid, the leader included.';
COMMENT ON COLUMN public.lot_order_book.unresolved IS 'Book entries that are single bid rows without an identity key; each counts as its own entrant.';

ALTER TABLE public.lot_order_book ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lot_order_book_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lot_order_book, public.lot_order_book_state FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.lot_order_book, public.lot_order_book_state TO service_role;

-- One lot ---------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fold_lot_order_book(p_auction_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  c_version constant text := 'order-book-v1';
  c_window  constant interval := interval '14 days';
  v_lot record;
  v_held integer; v_outside integer; v_folded integer; v_unkeyed integer;
  v_final boolean;
BEGIN
  SELECT ae.id, ae.vehicle_id, ae.auction_end_date AS close_at, ae.updated_at, ae.total_bids
    INTO v_lot
  FROM public.auction_events ae
  WHERE ae.id = p_auction_event_id AND ae.source IN ('bat', 'bringatrailer');
  IF NOT FOUND THEN
    RETURN jsonb_build_object('lot', p_auction_event_id, 'folded', false, 'why', 'no BaT lot with this id');
  END IF;

  DELETE FROM public.lot_order_book WHERE auction_event_id = v_lot.id;

  WITH held AS (
    SELECT c.id, c.posted_at, c.created_at, c.bid_amount AS amount, c.external_identity_id,
           coalesce(c.bat_comment_id, 0) AS bat_no,
           (v_lot.close_at IS NOT NULL AND c.posted_at < v_lot.close_at - c_window) AS outside
    FROM public.auction_comments c
    WHERE c.auction_event_id = v_lot.id AND c.comment_type = 'bid'
      AND c.posted_at IS NOT NULL AND c.bid_amount IS NOT NULL AND c.bid_amount >= 0
  ),
  b AS (
    SELECT row_number() OVER (ORDER BY h.posted_at, h.bat_no, (h.id::text) COLLATE "C")::integer AS seq, h.*,
           coalesce('id:' || h.external_identity_id::text, 'bid:' || h.id::text) AS k
    FROM held h WHERE NOT h.outside
  ),
  p AS (SELECT b.*, max(b.amount) OVER (ORDER BY b.seq) AS price FROM b),
  book AS (
    SELECT i.seq, j.k, bool_or(j.external_identity_id IS NOT NULL) AS keyed, max(j.amount) AS lvl
    FROM p i JOIN p j ON j.seq <= i.seq
    GROUP BY i.seq, j.k
  ),
  agg AS (
    SELECT bk.seq,
           count(*)::integer AS entrants,
           (count(*) FILTER (WHERE bk.keyed))::integer AS identities,
           (array_agg(bk.lvl ORDER BY bk.lvl DESC))[2] AS second_best,
           (count(*) FILTER (WHERE bk.lvl >= 0.9 * p.price))::integer AS depth_90,
           (count(*) FILTER (WHERE bk.lvl >= 0.75 * p.price))::integer AS depth_75
    FROM book bk JOIN p ON p.seq = bk.seq
    GROUP BY bk.seq
  ),
  ins AS (
    INSERT INTO public.lot_order_book
      (auction_event_id, bid_seq, bid_comment_id, posted_at, landed_at, close_at, seconds_to_close, amount, price,
       external_identity_id, entrants, identities, unresolved, second_best, depth_90, depth_75, fold_version)
    SELECT v_lot.id, p.seq, p.id, p.posted_at, p.created_at, v_lot.close_at,
           CASE WHEN v_lot.close_at IS NULL THEN NULL
                ELSE floor(extract(epoch FROM (v_lot.close_at - p.posted_at)))::integer END,
           p.amount, p.price, p.external_identity_id, a.entrants, a.identities, a.entrants - a.identities,
           a.second_best, a.depth_90, a.depth_75, c_version
    FROM p JOIN agg a ON a.seq = p.seq
    RETURNING external_identity_id
  )
  SELECT (SELECT count(*) FROM held)::integer,
         (SELECT count(*) FROM held WHERE outside)::integer,
         (SELECT count(*) FROM ins)::integer,
         (SELECT count(*) FROM ins WHERE external_identity_id IS NULL)::integer
    INTO v_held, v_outside, v_folded, v_unkeyed;

  v_final := v_lot.close_at IS NOT NULL AND v_lot.close_at < now() - interval '6 hours'
             AND v_lot.updated_at IS NOT NULL AND v_lot.updated_at >= v_lot.close_at
             AND v_lot.total_bids IS NOT NULL AND v_held >= v_lot.total_bids;

  INSERT INTO public.lot_order_book_state AS s
    (auction_event_id, vehicle_id, close_at, lot_updated_at, lot_total_bids, bids_held, bids_folded, bids_outside,
     bids_unkeyed, is_final, fold_version, folded_at)
  VALUES (v_lot.id, v_lot.vehicle_id, v_lot.close_at, v_lot.updated_at, v_lot.total_bids, v_held, v_folded, v_outside,
          v_unkeyed, v_final, c_version, now())
  ON CONFLICT (auction_event_id) DO UPDATE SET
    vehicle_id = EXCLUDED.vehicle_id, close_at = EXCLUDED.close_at, lot_updated_at = EXCLUDED.lot_updated_at,
    lot_total_bids = EXCLUDED.lot_total_bids, bids_held = EXCLUDED.bids_held, bids_folded = EXCLUDED.bids_folded,
    bids_outside = EXCLUDED.bids_outside, bids_unkeyed = EXCLUDED.bids_unkeyed, is_final = EXCLUDED.is_final,
    fold_version = EXCLUDED.fold_version, folded_at = EXCLUDED.folded_at;

  RETURN jsonb_build_object('lot', v_lot.id, 'folded', true, 'bids_held', v_held, 'bids_folded', v_folded,
                            'bids_outside', v_outside, 'bids_unkeyed', v_unkeyed, 'is_final', v_final);
END
$fn$;

-- The driver --------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fold_lot_order_books(
  p_budget_ms integer DEFAULT 7000, p_closed_days integer DEFAULT 3, p_max_lots integer DEFAULT 400)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  c_writer constant text := 'fold-lot-order-books';
  v_start timestamptz := clock_timestamp();
  -- The job runs under the role's default statement_timeout (postgres 10 s), which is never raised: the budget stays under it.
  v_budget integer := least(greatest(coalesce(p_budget_ms, 7000), 500), 8000);
  v_days integer := least(greatest(coalesce(p_closed_days, 3), 0), 30);
  v_max integer := least(greatest(coalesce(p_max_lots, 400), 1), 2000);
  r record;
  v_res jsonb;
  v_lots integer := 0;
  v_rows bigint := 0;
  v_left integer := 0;
BEGIN
  FOR r IN
    SELECT ae.id
    FROM public.auction_events ae
    LEFT JOIN public.lot_order_book_state s ON s.auction_event_id = ae.id
    WHERE ae.source IN ('bat', 'bringatrailer')
      AND ae.auction_end_date > now() - make_interval(days => v_days)
      AND ae.auction_end_date < now() + interval '10 days'
      AND (s.auction_event_id IS NULL
           OR (NOT s.is_final AND (ae.updated_at IS DISTINCT FROM s.lot_updated_at
                                   OR s.folded_at < now() - interval '6 hours')))
    ORDER BY abs(extract(epoch FROM (ae.auction_end_date - now())))
    LIMIT v_max + 1
  LOOP
    IF v_lots >= v_max
       OR extract(epoch FROM (clock_timestamp() - v_start)) * 1000 >= v_budget THEN
      v_left := v_left + 1;
      CONTINUE;
    END IF;
    v_res := public.fold_lot_order_book(r.id);
    v_lots := v_lots + 1;
    v_rows := v_rows + coalesce((v_res->>'bids_folded')::bigint, 0);
  END LOOP;

  IF v_rows > 0 THEN
    INSERT INTO public.write_receipts (tbl, op, rows, writer, db_role, app_name, txid)
    VALUES ('lot_order_book', 'INSERT', v_rows::integer, c_writer, current_user,
            current_setting('application_name', true), txid_current());
  END IF;

  RETURN jsonb_build_object('lots_folded', v_lots, 'rows_written', v_rows, 'more_waiting', v_left > 0,
    'ms', round(extract(epoch FROM (clock_timestamp() - v_start)) * 1000), 'budget_ms', v_budget,
    'closed_days', v_days, 'max_lots', v_max);
END
$fn$;

-- The public reader ---------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lot_order_book_read(p_auction_event_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT jsonb_build_object(
    'lot', s.auction_event_id,
    'vehicle', s.vehicle_id,
    'rule', 'One row per bid: the book after that bid, from bids posted at or before it. An entrant is an identity, or a single bid without one. Depth counts entrants whose highest bid is within 10% / 25% of the price. A bid is a lower bound on what a bidder would pay.',
    'coverage', jsonb_build_object(
      'lot_total_bids', s.lot_total_bids, 'bids_held', s.bids_held, 'bids_folded', s.bids_folded,
      'bids_outside_window', s.bids_outside, 'bids_without_identity', s.bids_unkeyed,
      'close_at', s.close_at, 'lot_read_at', s.lot_updated_at, 'folded_at', s.folded_at, 'is_final', s.is_final,
      'fold_version', s.fold_version),
    'columns', jsonb_build_array('bid_seq', 'posted_at', 'landed_at', 'seconds_to_close', 'amount', 'price',
      'external_identity_id', 'entrants', 'identities', 'unresolved', 'second_best', 'depth_90', 'depth_75'),
    'rows', coalesce((
      SELECT jsonb_agg(jsonb_build_array(b.bid_seq, b.posted_at, b.landed_at, b.seconds_to_close, b.amount, b.price,
               b.external_identity_id, b.entrants, b.identities, b.unresolved, b.second_best, b.depth_90, b.depth_75)
             ORDER BY b.bid_seq)
      FROM public.lot_order_book b WHERE b.auction_event_id = s.auction_event_id), '[]'::jsonb))
  FROM public.lot_order_book_state s
  JOIN public.vehicles v ON v.id = s.vehicle_id
  WHERE s.auction_event_id = p_auction_event_id
    AND EXISTS (SELECT 1 FROM public.auction_events_canonical c WHERE c.id = s.auction_event_id)
    AND v.is_public IS TRUE AND v.deleted_at IS NULL
    AND (v.listing_kind IS NULL OR v.listing_kind <> 'non_vehicle_item')
$fn$;

COMMENT ON FUNCTION public.fold_lot_order_book(uuid) IS
'Sanctioned writer of lot_order_book and lot_order_book_state: refolds one BaT lot from auction_comments (replace per lot; the fold is replayable and writes no testimony). Returns the lot''s coverage counts.';
COMMENT ON FUNCTION public.fold_lot_order_books(integer, integer, integer) IS
'Scheduled driver (cron fold-lot-order-books): folds BaT lots closing from p_closed_days ago to 10 days ahead that are new, rewritten since their last fold, or not folded for 6 hours while not final; nearest close first; stops at the time budget (0.5-8 s, under the default statement timeout) or p_max_lots and reports more_waiting. One write_receipts row per run that wrote.';
COMMENT ON FUNCTION public.lot_order_book_read(uuid) IS
'Public reader of the stored Stack A fold for one lot: coverage (bids on the lot row, held, folded, outside the window, without identity, clocks) and one row per bid. Returns NULL when the lot is not folded, is not a canonical lot, or its vehicle is not public.';

REVOKE ALL ON FUNCTION public.fold_lot_order_book(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fold_lot_order_books(integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fold_lot_order_book(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fold_lot_order_books(integer, integer, integer) TO service_role;
REVOKE ALL ON FUNCTION public.lot_order_book_read(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lot_order_book_read(uuid) TO anon, authenticated, service_role;

-- Owners ------------------------------------------------------------------------------------------------------------
INSERT INTO public.pipeline_registry (table_name, column_name, owned_by, description, do_not_write_directly, write_via)
SELECT x.t, NULL, 'fold_lot_order_book', x.d, true,
       'fold_lot_order_book(uuid) only (SECURITY DEFINER, service_role), driven by fold_lot_order_books; cron job fold-lot-order-books every 5 minutes. Migration 20261114130000.'
FROM (VALUES
  ('lot_order_book', 'Stack A fold: one row per lot per bid, the order book''s state after that bid, point-in-time; replace per lot, replayable from auction_comments.'),
  ('lot_order_book_state', 'Per folded lot: the clocks the fold used and its coverage counts; is_final once closed 6 hours with the lot row written after the close and the bid count met.')) AS x(t, d)
WHERE NOT EXISTS (SELECT 1 FROM public.pipeline_registry p WHERE p.table_name = x.t AND p.column_name IS NULL);

-- Schedule ------------------------------------------------------------------------------------------------------------
DO $$ BEGIN
  IF to_regnamespace('cron') IS NOT NULL THEN
    PERFORM cron.schedule('fold-lot-order-books', '2-57/5 * * * *',
      $cmd$SELECT public.fold_lot_order_books(7000, 3, 400);$cmd$);
  END IF;
END $$;

COMMIT;
