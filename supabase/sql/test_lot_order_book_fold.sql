-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_lot_order_book -f this-file.sql
-- Contract for 20261114130000_lot_order_book_fold.sql. Synthetic rows only; never production.
--   * the fold follows orderBookReader.ts: order by posted time, BaT comment id, row id; a keyed identity is one
--     entrant however often it bids; an unkeyed bid is its own entrant, never unified by handle; price is the running
--     maximum; depth counts entrants by their own highest bid; rows posted more than 14 days before the close are
--     counted as outside and never folded; undated, amountless and non-bid rows are not bids;
--   * a refold replaces the lot's rows and adds a late bid; a non-BaT lot is refused;
--   * the driver folds new and rewritten lots inside its window, skips an unchanged lot, respects max_lots and
--     writes one receipt; is_final is set once the lot has been closed 6 hours;
--   * the reader returns rows and coverage for a public vehicle and NULL for a private, deleted or non-vehicle one;
--   * anon executes only the reader; neither table is readable by anon or authenticated.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
     OR current_setting('server_version_num')::int / 10000 <> 17
     OR to_regclass('public.auction_events') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 dm_refinement_* database';
  END IF;
END $$;
SET statement_timeout = '60s';
SET lock_timeout = '3s';
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;

-- Stand-ins with the live column names the migration reads.
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, is_public boolean, deleted_at timestamptz, listing_kind text);
CREATE TABLE public.auction_events (id uuid PRIMARY KEY, vehicle_id uuid, source text, auction_end_date timestamptz,
  updated_at timestamptz, total_bids integer);
CREATE TABLE public.auction_comments (id uuid PRIMARY KEY, auction_event_id uuid, comment_type text,
  posted_at timestamptz, created_at timestamptz, bid_amount numeric, external_identity_id uuid, bat_comment_id integer);
CREATE TABLE public.pipeline_registry (table_name text, column_name text, owned_by text, description text,
  do_not_write_directly boolean, write_via text);
CREATE TABLE public.write_receipts (id bigserial PRIMARY KEY, tbl text, op text, rows integer, writer text,
  db_role text, app_name text, txid bigint, at timestamptz DEFAULT now());
CREATE VIEW public.auction_events_canonical AS SELECT * FROM public.auction_events WHERE total_bids IS DISTINCT FROM -1;

\ir ../migrations/20261114130000_lot_order_book_fold.sql

-- Lot A closes in 2 hours. Identities X and Y; one unkeyed bid; one row 20 days early; rows that are not bids.
INSERT INTO public.vehicles VALUES
  ('00000000-0000-0000-0000-0000000000a1', true, NULL, NULL),
  ('00000000-0000-0000-0000-0000000000a2', false, NULL, NULL),
  ('00000000-0000-0000-0000-0000000000a3', true, now(), NULL),
  ('00000000-0000-0000-0000-0000000000a4', true, NULL, 'non_vehicle_item');
INSERT INTO public.auction_events VALUES
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a1', 'bat', now() + interval '2 hours', now() - interval '1 minute', 6),
  ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000a2', 'bat', now() + interval '1 hour',  now() - interval '1 minute', 1),
  ('10000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-0000000000a3', 'bat', now() - interval '7 hours', now() - interval '1 minute', 1),
  ('10000000-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-0000000000a4', 'bat', now() - interval '5 days',  now() - interval '1 minute', 1),
  ('10000000-0000-0000-0000-00000000000e', '00000000-0000-0000-0000-0000000000a1', 'mecum', now() + interval '1 hour', now(), 1),
-- Outside the driver's 3-day window, folded by id: the page's own fixtures (orderBookReader.test.ts) on ...0f and ...10,
-- a closed lot short of its bid count (...11), one whose row was last written before its close (...12), and one that
-- is not canonical (...13).
  ('20000000-0000-0000-0000-00000000000f', '00000000-0000-0000-0000-0000000000a1', 'bat', now() - interval '28800 minutes', now(), 3),
  ('20000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000a1', 'bat', now() - interval '28800 minutes', now(), 3),
  ('20000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-0000000000a1', 'bat', now() - interval '28800 minutes', now(), 5),
  ('20000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-0000000000a1', 'bat', now() - interval '28800 minutes', now() - interval '21 days', 1),
  ('20000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-0000000000a1', 'bat', now() - interval '28800 minutes', now(), -1);

INSERT INTO public.auction_comments (id, auction_event_id, comment_type, posted_at, created_at, bid_amount, external_identity_id, bat_comment_id)
SELECT r.id::uuid, (CASE WHEN length(r.lot) = 1 THEN '10000000-0000-0000-0000-00000000000' ELSE '20000000-0000-0000-0000-0000000000' END || r.lot)::uuid, r.kind,
       CASE WHEN r.mins IS NULL THEN NULL ELSE now() + interval '2 hours' - make_interval(mins => r.mins) END,
       now(), r.amount, r.ident::uuid, r.bat_no
FROM (VALUES
  ('c0000000-0000-0000-0000-000000000001', 'a', 'bid',     6000,  1000::numeric, 'e0000000-0000-0000-0000-00000000000a', 1),  -- X 1,000
  ('c0000000-0000-0000-0000-000000000002', 'a', 'bid',     5000,  2000,          'e0000000-0000-0000-0000-00000000000b', 2),  -- Y 2,000
  ('c0000000-0000-0000-0000-000000000003', 'a', 'bid',     4000,  2500,          'e0000000-0000-0000-0000-00000000000a', 3),  -- X 2,500
  ('c0000000-0000-0000-0000-000000000005', 'a', 'bid',     3000,  2600,          NULL,                                   5),  -- unkeyed, same minute, later BaT id
  ('c0000000-0000-0000-0000-000000000004', 'a', 'bid',     3000,  2550,          NULL,                                   4),  -- unkeyed, same minute, earlier BaT id
  ('c0000000-0000-0000-0000-000000000006', 'a', 'bid',     100,   10000,         'e0000000-0000-0000-0000-00000000000b', 6),  -- Y 10,000
  ('c0000000-0000-0000-0000-000000000007', 'a', 'bid',     28800, 500,           'e0000000-0000-0000-0000-00000000000c', 0),  -- 20 days early: outside
  ('c0000000-0000-0000-0000-000000000008', 'a', 'comment', 2000,  NULL,          'e0000000-0000-0000-0000-00000000000a', 7),
  ('c0000000-0000-0000-0000-000000000009', 'a', 'bid',     NULL,  9000,          'e0000000-0000-0000-0000-00000000000a', 8),  -- undated
  ('c0000000-0000-0000-0000-00000000000a', 'a', 'bid',     1500,  NULL,          'e0000000-0000-0000-0000-00000000000a', 9),  -- no amount
  ('c0000000-0000-0000-0000-0000000000b1', 'b', 'bid',     120,   100,           'e0000000-0000-0000-0000-00000000000a', 1),
  ('c0000000-0000-0000-0000-0000000000c1', 'c', 'bid',     600,   100,           'e0000000-0000-0000-0000-00000000000a', 1),
  ('c0000000-0000-0000-0000-0000000000d1', 'd', 'bid',     9000,  100,           'e0000000-0000-0000-0000-00000000000a', 1),
  -- minutes are before now() + 2 h, so 28,950 is 30 minutes before a close 28,800 minutes ago (minutes, not days:
  -- a day interval crosses daylight-saving changes in the session's time zone)
  ('d0000000-0000-0000-0000-000000000001', '0f', 'bid',    28950, 100,           'e0000000-0000-0000-0000-00000000000a', 1),
  ('d0000000-0000-0000-0000-000000000002', '0f', 'bid',    28940, 200,           'e0000000-0000-0000-0000-00000000000b', 2),
  ('d0000000-0000-0000-0000-000000000003', '0f', 'bid',    28930, 300,           'e0000000-0000-0000-0000-00000000000a', 3),
  ('d0000000-0000-0000-0000-000000000004', '10', 'bid',    28950, 100,           NULL,                                   1),
  ('d0000000-0000-0000-0000-000000000005', '10', 'bid',    28940, 200,           NULL,                                   2),
  ('d0000000-0000-0000-0000-000000000006', '10', 'bid',    28930, 300,           'e0000000-0000-0000-0000-00000000000a', 3),
  ('d0000000-0000-0000-0000-000000000007', '11', 'bid',    28930, 300,           'e0000000-0000-0000-0000-00000000000a', 1),
  ('d0000000-0000-0000-0000-000000000008', '12', 'bid',    28930, 300,           'e0000000-0000-0000-0000-00000000000a', 1),
  ('d0000000-0000-0000-0000-000000000009', '13', 'bid',    28930, 300,           'e0000000-0000-0000-0000-00000000000a', 1)
) AS r(id, lot, kind, mins, amount, ident, bat_no);

SELECT pg_temp.ok('a non-BaT lot is refused',
  (public.fold_lot_order_book('10000000-0000-0000-0000-00000000000e') ->> 'folded')::boolean IS FALSE);

SELECT public.fold_lot_order_book('10000000-0000-0000-0000-00000000000a');
SELECT pg_temp.ok('six bids folded, one outside the window, seven held', (
  SELECT bids_held = 7 AND bids_folded = 6 AND bids_outside = 1 AND bids_unkeyed = 2 AND lot_total_bids = 6 AND NOT is_final
  FROM public.lot_order_book_state WHERE auction_event_id = '10000000-0000-0000-0000-00000000000a'));
SELECT pg_temp.ok('order: posted time, then BaT comment id', (
  SELECT array_agg(right(bid_comment_id::text, 1) ORDER BY bid_seq) = ARRAY['1','2','3','4','5','6']
  FROM public.lot_order_book WHERE auction_event_id = '10000000-0000-0000-0000-00000000000a'));
SELECT pg_temp.ok('price is the running maximum', (
  SELECT array_agg(price ORDER BY bid_seq) = ARRAY[1000, 2000, 2500, 2550, 2600, 10000]::numeric[]
  FROM public.lot_order_book WHERE auction_event_id = '10000000-0000-0000-0000-00000000000a'));
SELECT pg_temp.ok('entrants: an identity once, each unkeyed bid on its own', (
  SELECT array_agg(entrants ORDER BY bid_seq) = ARRAY[1, 2, 2, 3, 4, 4]
     AND array_agg(identities ORDER BY bid_seq) = ARRAY[1, 2, 2, 2, 2, 2]
     AND array_agg(unresolved ORDER BY bid_seq) = ARRAY[0, 0, 0, 1, 2, 2]
  FROM public.lot_order_book WHERE auction_event_id = '10000000-0000-0000-0000-00000000000a'));
SELECT pg_temp.ok('second best is the second entrant''s own highest bid', (
  SELECT array_agg(second_best ORDER BY bid_seq) IS NOT DISTINCT FROM ARRAY[NULL, 1000, 2000, 2500, 2550, 2600]::numeric[]
  FROM public.lot_order_book WHERE auction_event_id = '10000000-0000-0000-0000-00000000000a'));
SELECT pg_temp.ok('depth within 10% and 25% of the price', (
  SELECT array_agg(depth_90 ORDER BY bid_seq) = ARRAY[1, 1, 1, 2, 3, 1]
     AND array_agg(depth_75 ORDER BY bid_seq) = ARRAY[1, 1, 2, 3, 4, 1]
  FROM public.lot_order_book WHERE auction_event_id = '10000000-0000-0000-0000-00000000000a'));
SELECT pg_temp.ok('seconds to close from the lot close', (
  SELECT min(seconds_to_close) BETWEEN 5990 AND 6000 AND max(seconds_to_close) BETWEEN 359990 AND 360000
  FROM public.lot_order_book WHERE auction_event_id = '10000000-0000-0000-0000-00000000000a'));

-- The page's fixtures: "is point-in-time" and "never unifies unkeyed bids by handle".
SELECT public.fold_lot_order_book(id) FROM public.auction_events WHERE id::text LIKE '20000000-%';
SELECT pg_temp.ok('page fixture: point-in-time book (A 100, B 200, A 300)', (
  SELECT array_agg(price ORDER BY bid_seq) = ARRAY[100, 200, 300]::numeric[]
     AND array_agg(entrants ORDER BY bid_seq) = ARRAY[1, 2, 2]
     AND array_agg(second_best ORDER BY bid_seq) IS NOT DISTINCT FROM ARRAY[NULL, 100, 200]::numeric[]
     AND min(seconds_to_close) BETWEEN 595 AND 600 AND max(seconds_to_close) BETWEEN 1795 AND 1800
  FROM public.lot_order_book WHERE auction_event_id = '20000000-0000-0000-0000-00000000000f'));
SELECT pg_temp.ok('page fixture: unkeyed bids are never unified', (
  SELECT identities = 1 AND unresolved = 2 AND entrants = 3
  FROM public.lot_order_book WHERE auction_event_id = '20000000-0000-0000-0000-000000000010' AND bid_seq = 3));
SELECT pg_temp.ok('final only when complete: bid count met and the lot row written after the close', (
  SELECT bool_and(is_final) FILTER (WHERE auction_event_id IN ('20000000-0000-0000-0000-00000000000f', '20000000-0000-0000-0000-000000000010'))
     AND NOT bool_or(is_final) FILTER (WHERE auction_event_id = '20000000-0000-0000-0000-000000000011')
     AND NOT bool_or(is_final) FILTER (WHERE auction_event_id = '20000000-0000-0000-0000-000000000012')
  FROM public.lot_order_book_state));
SELECT pg_temp.ok('a lot that is not canonical is not served',
  public.lot_order_book_read('20000000-0000-0000-0000-000000000013') IS NULL
  AND public.lot_order_book_read('20000000-0000-0000-0000-00000000000f') IS NOT NULL);

-- A late bid, then a refold: replaced, not appended.
INSERT INTO public.auction_comments VALUES ('c0000000-0000-0000-0000-00000000000f', '10000000-0000-0000-0000-00000000000a',
  'bid', now() + interval '2 hours' - interval '30 minutes', now(), 11000, 'e0000000-0000-0000-0000-00000000000a', 10);
SELECT public.fold_lot_order_book('10000000-0000-0000-0000-00000000000a');
SELECT pg_temp.ok('a refold replaces the lot''s rows', (
  SELECT count(*) = 7 AND max(price) = 11000 AND max(bid_seq) = 7
  FROM public.lot_order_book WHERE auction_event_id = '10000000-0000-0000-0000-00000000000a'));

-- The driver. Lot A is folded and unchanged; B and C are new and in the window; D closed 5 days ago (outside 3 days).
SELECT pg_temp.ok('the driver respects max_lots and reports more waiting', (
  SELECT (r ->> 'lots_folded')::int = 1 AND (r ->> 'more_waiting')::boolean
  FROM public.fold_lot_order_books(5000, 3, 1) AS r));
SELECT pg_temp.ok('the driver folds the rest and skips the unchanged lot', (
  SELECT (r ->> 'lots_folded')::int = 1 AND NOT (r ->> 'more_waiting')::boolean
  FROM public.fold_lot_order_books(5000, 3, 400) AS r));
SELECT pg_temp.ok('nothing left to fold', (
  SELECT (r ->> 'lots_folded')::int = 0 FROM public.fold_lot_order_books(5000, 3, 400) AS r));
SELECT pg_temp.ok('lots outside the window are not folded',
  NOT EXISTS (SELECT FROM public.lot_order_book_state WHERE auction_event_id = '10000000-0000-0000-0000-00000000000d'));
SELECT pg_temp.ok('a complete lot closed 6 hours is final', (
  SELECT is_final FROM public.lot_order_book_state WHERE auction_event_id = '10000000-0000-0000-0000-00000000000c'));
SELECT pg_temp.ok('the budget is bounded under the default statement timeout', (
  SELECT (r ->> 'budget_ms')::int = 8000 FROM public.fold_lot_order_books(999999, 0, 1) AS r));
SELECT pg_temp.ok('one receipt per run that wrote', (
  SELECT count(*) = 2 AND sum(rows) = 2 FROM public.write_receipts WHERE writer = 'fold-lot-order-books'));
UPDATE public.auction_events SET updated_at = now() WHERE id = '10000000-0000-0000-0000-00000000000a';
SELECT pg_temp.ok('a rewritten lot is folded again', (
  SELECT (r ->> 'lots_folded')::int = 1 FROM public.fold_lot_order_books(5000, 3, 400) AS r));
SELECT pg_temp.ok('a wider window reaches the older lot', (
  SELECT (r ->> 'lots_folded')::int = 1 FROM public.fold_lot_order_books(5000, 10, 400) AS r));

-- The reader and its gate.
SELECT pg_temp.ok('the reader returns rows and coverage for a public vehicle', (
  SELECT jsonb_array_length(r -> 'rows') = 7 AND (r -> 'coverage' ->> 'bids_folded')::int = 7
     AND (r -> 'coverage' ->> 'bids_outside_window')::int = 1 AND jsonb_array_length(r -> 'columns') = 13
  FROM public.lot_order_book_read('10000000-0000-0000-0000-00000000000a') AS r));
SELECT pg_temp.ok('private, deleted and non-vehicle lots read as NULL',
  public.lot_order_book_read('10000000-0000-0000-0000-00000000000b') IS NULL
  AND public.lot_order_book_read('10000000-0000-0000-0000-00000000000c') IS NULL
  AND public.lot_order_book_read('10000000-0000-0000-0000-00000000000d') IS NULL);

-- Grants.
SELECT pg_temp.ok('anon and authenticated execute only the reader',
  has_function_privilege('anon', 'public.lot_order_book_read(uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.lot_order_book_read(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.fold_lot_order_book(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.fold_lot_order_books(integer, integer, integer)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.fold_lot_order_books(integer, integer, integer)', 'EXECUTE'));
SELECT pg_temp.ok('the fold tables are not readable by anon or authenticated',
  NOT has_table_privilege('anon', 'public.lot_order_book', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.lot_order_book_state', 'SELECT')
  AND has_table_privilege('service_role', 'public.lot_order_book', 'SELECT'));
SELECT pg_temp.ok('both tables have a declared owner', (
  SELECT count(*) = 2 FROM public.pipeline_registry WHERE owned_by = 'fold_lot_order_book'));
