-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_live_lot -f this-file.sql
-- Proves the live_lot_temperature rewrite (migration 20261014053000) answers exactly what the live function answers.
-- The live function joined every comment row of up to 300 comparable lots to their closes (rows x lots, as a nested loop)
-- and read those comments one vehicle at a time. The migration folds the comments to one row per (vehicle, listing) with the
-- bid rows as aligned arrays, joins lots to closes before counting, reads all the comments with one array scan, and turns
-- index scans off for this function so that scan is a bitmap read. The answer must not move: the same bids, distinct
-- bidders and highest bid as of h hours before each close, the same pick when one listing sits on two vehicles, the same
-- fallback to a vehicle's own end date, the same exclusions (this lot's own listing, other platforms, undated or slugless
-- rows, private, deleted, merged, live, other-model and non-BaT vehicles), for anon and for the owner role, and the
-- statuses not_live, ended, not_read. The function stays SECURITY INVOKER with its 8 s timeout and its grants.
-- A re-run is a no-op, and a drifted function is left as found.
-- The rows below are a disposable test database's rows, never production testimony.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;
SET TimeZone = 'UTC';
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated;

-- The shapes the reader touches, with the indexes production has on them.
CREATE TABLE public.vehicles (
  id uuid PRIMARY KEY, make text, model text, sale_status text, listing_url text, auction_end_date text,
  deleted_at timestamptz, merged_into_vehicle_id uuid, is_public boolean DEFAULT true);
CREATE INDEX idx_vehicles_make_model ON public.vehicles (make, model);
CREATE TABLE public.auction_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, platform text, comment_type text, posted_at timestamptz,
  source_url text, author_username text, bid_amount numeric, created_at timestamptz DEFAULT now(), content_hash text DEFAULT gen_random_uuid()::text);
CREATE UNIQUE INDEX auction_comments_vehicle_content_hash_key ON public.auction_comments (vehicle_id, content_hash);
CREATE TABLE public.auction_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, source_url text, auction_end_date timestamptz,
  updated_at timestamptz, outcome text);
CREATE INDEX idx_auction_events_vehicle_source_url ON public.auction_events (vehicle_id, source_url);
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY vehicles_public_select ON public.vehicles FOR SELECT USING (is_public);
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon, authenticated;

-- The function as production has it on 2026-10-14.
\ir helpers/live_lot_temperature_live_20261014.sql
GRANT EXECUTE ON FUNCTION public.live_lot_temperature(uuid) TO anon, authenticated;
CREATE FUNCTION public.t_assert(p_ok boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(p_ok, false) THEN RAISE EXCEPTION 'FAIL: %', p_what; END IF; END $$;
GRANT EXECUTE ON FUNCTION public.t_assert(boolean, text) TO anon, authenticated;
SELECT public.t_assert(md5(pg_get_functiondef('public.live_lot_temperature(uuid)'::regprocedure)) = '3cb206dc2585f7ccfda94a099088b70b',  -- gitleaks:allow (md5 checksum of a function definition, not a secret)
  'the fixture is the live source');

-- The clock the data hangs on: whole seconds, so the hours to close are exactly 49.
SELECT date_trunc('second', now()) AS t0 \gset

-- The live lot L: ends in 48 hours, last read an hour ago, three bids of its own and two comments.
-- ALLOW_RAW_TESTIMONY_WRITE (disposable test database)
INSERT INTO public.vehicles (id, make, model, sale_status, listing_url, auction_end_date) VALUES
 ('a0000000-0000-0000-0000-000000000001', 'Porsche', '911 Test Coupe', 'auction_live', 'https://bringatrailer.com/listing/live-lot-1/',
  to_char(:'t0'::timestamptz + interval '48 hours', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'));
INSERT INTO public.auction_comments (vehicle_id, platform, comment_type, posted_at, source_url, author_username, bid_amount, created_at) VALUES
 ('a0000000-0000-0000-0000-000000000001', 'bat', 'bid',     :'t0'::timestamptz - interval '30 hours', 'https://bringatrailer.com/listing/live-lot-1/', 'alice', 10000, :'t0'::timestamptz - interval '1 hour'),
 ('a0000000-0000-0000-0000-000000000001', 'bat', 'bid',     :'t0'::timestamptz - interval '20 hours', 'https://bringatrailer.com/listing/live-lot-1/', 'bob',   11000, :'t0'::timestamptz - interval '1 hour'),
 ('a0000000-0000-0000-0000-000000000001', 'bat', 'bid',     :'t0'::timestamptz - interval '10 hours', 'https://bringatrailer.com/listing/live-lot-1/', 'carol', 12500, :'t0'::timestamptz - interval '1 hour'),
 ('a0000000-0000-0000-0000-000000000001', 'bat', 'comment', :'t0'::timestamptz - interval '9 hours',  'https://bringatrailer.com/listing/live-lot-1/', 'dave',  NULL,  :'t0'::timestamptz - interval '1 hour'),
 ('a0000000-0000-0000-0000-000000000001', 'bat', 'comment', :'t0'::timestamptz - interval '8 hours',  'https://bringatrailer.com/listing/live-lot-1/', 'erin',  NULL,  :'t0'::timestamptz - interval '1 hour');

-- Comparables C1..C8 (same make and model, BaT listings, not live). Their closes are fixed past times; bids sit at hours before.
INSERT INTO public.vehicles (id, make, model, sale_status, listing_url, auction_end_date) VALUES
 ('c0000000-0000-0000-0000-000000000001', 'Porsche', '911 Test Coupe', 'sold',     'https://bringatrailer.com/listing/comp-1/', NULL),
 ('c0000000-0000-0000-0000-000000000002', 'Porsche', '911 Test Coupe', 'sold',     'https://bringatrailer.com/listing/comp-2/', NULL),
 ('c0000000-0000-0000-0000-000000000003', 'Porsche', '911 Test Coupe', 'sold',     'https://bringatrailer.com/listing/comp-3/', NULL),
 ('c0000000-0000-0000-0000-000000000004', 'Porsche', '911 Test Coupe', 'available','https://bringatrailer.com/listing/comp-4/', NULL),
 -- C5 has no event: its close is the vehicle's own end date, because its listing is the one its comments belong to
 ('c0000000-0000-0000-0000-000000000005', 'Porsche', '911 Test Coupe', 'sold',     'https://bringatrailer.com/listing/comp-5/', '2025-06-01T18:00:00Z'),
 -- C6: no event and no end date, so no close and no h: counted as a lot without close
 ('c0000000-0000-0000-0000-000000000006', 'Porsche', '911 Test Coupe', 'sold',     'https://bringatrailer.com/listing/comp-6/', NULL),
 -- C7 carries the same listing as C1 (comp-1) with fewer rows: one listing, counted once, on the vehicle with the most rows
 ('c0000000-0000-0000-0000-000000000007', 'Porsche', '911 Test Coupe', 'sold',     'https://bringatrailer.com/listing/comp-7/', NULL),
 -- C8 carries this live lot's own listing: never a comparable for it
 ('c0000000-0000-0000-0000-000000000008', 'Porsche', '911 Test Coupe', 'sold',     'https://bringatrailer.com/listing/comp-8/', NULL);
-- Vehicles that are not comparables: private (visible to the owner role only), deleted, merged, live, other model, other make, non-BaT url.
INSERT INTO public.vehicles (id, make, model, sale_status, listing_url, deleted_at, merged_into_vehicle_id, is_public) VALUES
 ('d0000000-0000-0000-0000-000000000001', 'Porsche', '911 Test Coupe', 'sold', 'https://bringatrailer.com/listing/priv-1/', NULL, NULL, false),
 ('d0000000-0000-0000-0000-000000000002', 'Porsche', '911 Test Coupe', 'sold', 'https://bringatrailer.com/listing/del-1/', now(), NULL, true),
 ('d0000000-0000-0000-0000-000000000003', 'Porsche', '911 Test Coupe', 'sold', 'https://bringatrailer.com/listing/merged-1/', NULL, 'c0000000-0000-0000-0000-000000000001', true),
 ('d0000000-0000-0000-0000-000000000004', 'Porsche', '911 Test Coupe', 'auction_live', 'https://bringatrailer.com/listing/live-2/', NULL, NULL, true),
 ('d0000000-0000-0000-0000-000000000005', 'Porsche', '911 Other Coupe', 'sold', 'https://bringatrailer.com/listing/other-model/', NULL, NULL, true),
 ('d0000000-0000-0000-0000-000000000006', 'Ferrari', '911 Test Coupe', 'sold', 'https://bringatrailer.com/listing/other-make/', NULL, NULL, true),
 ('d0000000-0000-0000-0000-000000000007', 'Porsche', '911 Test Coupe', 'sold', 'https://example.test/listing/not-bat/', NULL, NULL, true);

-- Closes: C1..C4, C7 and C8 by event, outcome as noted.
INSERT INTO public.auction_events (vehicle_id, source_url, auction_end_date, updated_at, outcome) VALUES
 ('c0000000-0000-0000-0000-000000000001', 'https://bringatrailer.com/listing/comp-1/', '2025-03-01 18:00+00', '2025-03-02', 'sold'),
 ('c0000000-0000-0000-0000-000000000002', 'https://bringatrailer.com/listing/comp-2/', '2025-03-02 18:00+00', '2025-03-03', 'sold'),
 ('c0000000-0000-0000-0000-000000000003', 'https://bringatrailer.com/listing/comp-3/', '2025-03-03 18:00+00', '2025-03-04', 'sold'),
 ('c0000000-0000-0000-0000-000000000004', 'https://bringatrailer.com/listing/comp-4/', '2025-03-04 18:00+00', '2025-03-05', 'reserve_not_met'),
 ('c0000000-0000-0000-0000-000000000007', 'https://bringatrailer.com/listing/comp-1/', '2025-03-01 18:00+00', '2025-03-02', 'sold'),
 -- C8's rows are this live lot's own listing: it has a close, and is still never a comparable for it
 ('c0000000-0000-0000-0000-000000000008', 'https://bringatrailer.com/listing/live-lot-1/', '2025-04-01 18:00+00', '2025-04-02', 'sold'),
 -- an older, superseded event for C1 with another close: the latest updated_at wins
 ('c0000000-0000-0000-0000-000000000001', 'https://bringatrailer.com/listing/comp-1/', '2025-02-20 18:00+00', '2025-02-21', 'sold');

-- Bids as hours before each close (h = 49: a bid at 50 h or more before close counts, one at 30 h does not).
-- C1 closes 2025-03-01 18:00: 5 bids (alice, dave, alice at -100, -60, -50; dave, alice at -30, -1) and 2 comments = 7 rows.
CREATE FUNCTION public.t_row(p_vehicle uuid, p_slug text, p_type text, p_close timestamptz, p_hours numeric, p_author text, p_amount numeric,
  p_platform text DEFAULT 'bat', p_url text DEFAULT NULL) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.auction_comments (vehicle_id, platform, comment_type, posted_at, source_url, author_username, bid_amount, created_at)
  VALUES (p_vehicle, p_platform, p_type, p_close - (p_hours * interval '1 hour'), coalesce(p_url, 'https://bringatrailer.com/listing/' || p_slug || '/'), p_author, p_amount, '2025-01-01');
$$;
SELECT public.t_row('c0000000-0000-0000-0000-000000000001', 'comp-1', 'bid', '2025-03-01 18:00+00', h, a, amt)
  FROM (VALUES (100, 'alice', 5000), (60, 'dave', 6000), (50, 'alice', 7000), (30, 'dave', 9000), (1, 'alice', 12000)) v(h, a, amt);
SELECT public.t_row('c0000000-0000-0000-0000-000000000001', 'comp-1', 'comment', '2025-03-01 18:00+00', h, 'x', NULL) FROM (VALUES (90), (10)) v(h);
-- C7 (same listing): one early bid and two comments = 3 rows
SELECT public.t_row('c0000000-0000-0000-0000-000000000007', 'comp-1', 'bid', '2025-03-01 18:00+00', 100, 'zed', 1000);
SELECT public.t_row('c0000000-0000-0000-0000-000000000007', 'comp-1', 'comment', '2025-03-01 18:00+00', h, 'x', NULL) FROM (VALUES (90), (10)) v(h);
-- C2 closes 03-02 18:00: bids at -90 and -55 by bob (counted), -20 carol, -2 bob (not): as of 49 h 2 bids, 1 bidder, 4500
SELECT public.t_row('c0000000-0000-0000-0000-000000000002', 'comp-2', 'bid', '2025-03-02 18:00+00', h, a, amt)
  FROM (VALUES (90, 'bob', 4000), (55, 'bob', 4500), (20, 'carol', 8000), (2, 'bob', 9000)) v(h, a, amt);
-- C3 closes 03-03 18:00: bids only inside the last 49 h: none counted
SELECT public.t_row('c0000000-0000-0000-0000-000000000003', 'comp-3', 'bid', '2025-03-03 18:00+00', h, a, amt)
  FROM (VALUES (40, 'x', 6000), (10, 'y', 7000)) v(h, a, amt);
-- C4 (reserve not met) closes 03-04 18:00: four bids before the cut, by x, y, x, z
SELECT public.t_row('c0000000-0000-0000-0000-000000000004', 'comp-4', 'bid', '2025-03-04 18:00+00', h, a, amt)
  FROM (VALUES (100, 'x', 2000), (80, 'y', 2500), (70, 'x', 2800), (52, 'z', 3000), (5, 'z', 3200)) v(h, a, amt);
-- C5 closes 2025-06-01 18:00 by the vehicle's own date: bids at -80 (p) and -51 (q) counted
SELECT public.t_row('c0000000-0000-0000-0000-000000000005', 'comp-5', 'bid', '2025-06-01 18:00+00', h, a, amt)
  FROM (VALUES (80, 'p', 3000), (51, 'q', 3500), (3, 'p', 4100)) v(h, a, amt);
-- C6: rows but no close at all
SELECT public.t_row('c0000000-0000-0000-0000-000000000006', 'comp-6', 'bid', '2025-04-01 18:00+00', 100, 'm', 100);
-- C8: rows of this live lot's own listing, on another vehicle
SELECT public.t_row('c0000000-0000-0000-0000-000000000008', 'live-lot-1', 'bid', '2025-04-01 18:00+00', 100, 'n', 200);
-- Rows that must be ignored: another platform, no posted_at, no listing slug, a bid with no author, a tie on time and author
SELECT public.t_row('c0000000-0000-0000-0000-000000000001', 'comp-1', 'bid', '2025-03-01 18:00+00', 70, 'rival', 9999, 'cars_and_bids');
INSERT INTO public.auction_comments (vehicle_id, platform, comment_type, posted_at, source_url, author_username, bid_amount, created_at) VALUES
 ('c0000000-0000-0000-0000-000000000001', 'bat', 'bid', NULL, 'https://bringatrailer.com/listing/comp-1/', 'ghost', 9998, '2025-01-01'),
 ('c0000000-0000-0000-0000-000000000001', 'bat', 'bid', '2025-02-01', 'https://bringatrailer.com/news/not-a-listing/', 'ghost', 9997, '2025-01-01'),
 ('c0000000-0000-0000-0000-000000000002', 'bat', 'bid', '2025-03-02 18:00+00'::timestamptz - interval '80 hours', 'https://bringatrailer.com/listing/comp-2/', NULL, 4400, '2025-01-01'),
 ('c0000000-0000-0000-0000-000000000002', 'bat', 'bid', '2025-03-02 18:00+00'::timestamptz - interval '80 hours', 'https://bringatrailer.com/listing/comp-2/', 'bob', 4400, '2025-01-01'),
 ('c0000000-0000-0000-0000-000000000002', 'bat', 'bid', '2025-03-02 18:00+00'::timestamptz - interval '80 hours', 'https://bringatrailer.com/listing/comp-2/', 'bob', 4400, '2025-01-01');
-- The private, deleted, merged, live, other-model, other-make and non-BaT vehicles each have a bid before the cut, closed and sold.
INSERT INTO public.auction_events (vehicle_id, source_url, auction_end_date, updated_at, outcome)
  SELECT id, listing_url, '2025-03-05 18:00+00', '2025-03-06', 'sold' FROM public.vehicles WHERE id::text LIKE 'd0000000%';
SELECT public.t_row(id, regexp_replace(listing_url, '^.*/listing/([^/]+)/$', '\1'), 'bid', '2025-03-05 18:00+00', 100, 'q', 77777, 'bat', listing_url)
  FROM public.vehicles WHERE id::text LIKE 'd0000000%';
-- Other statuses: an ended lot, a lot nobody has read yet, a lot with no comparables.
INSERT INTO public.vehicles (id, make, model, sale_status, listing_url, auction_end_date) VALUES
 ('e0000000-0000-0000-0000-000000000001', 'Porsche', '911 Test Coupe', 'auction_live', 'https://bringatrailer.com/listing/ended-1/', '2025-02-01T12:00:00Z'),
 ('e0000000-0000-0000-0000-000000000002', 'Porsche', '911 Test Coupe', 'auction_live', 'https://bringatrailer.com/listing/unread-1/', to_char(:'t0'::timestamptz + interval '30 hours', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
 ('e0000000-0000-0000-0000-000000000003', 'Lotus', 'Test Elise', 'auction_live', 'https://bringatrailer.com/listing/lonely-1/', to_char(:'t0'::timestamptz + interval '30 hours', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'));
SELECT public.t_row('e0000000-0000-0000-0000-000000000001', 'ended-1', 'bid', '2025-02-01 12:00+00', 5, 'a', 100);
INSERT INTO public.auction_comments (vehicle_id, platform, comment_type, posted_at, source_url, author_username, bid_amount, created_at) VALUES
 ('e0000000-0000-0000-0000-000000000003', 'bat', 'bid', :'t0'::timestamptz - interval '5 hours', 'https://bringatrailer.com/listing/lonely-1/', 'l', 500, :'t0'::timestamptz - interval '1 hour');

-- 1. Before: what the live function answers, for every id, as the owner role and as anon.
CREATE TABLE public.t_docs (phase text, who text, vid uuid, doc jsonb);
GRANT INSERT, SELECT ON public.t_docs TO anon;
CREATE TABLE public.t_vids (vid uuid PRIMARY KEY);
INSERT INTO public.t_vids SELECT id FROM public.vehicles;
GRANT SELECT ON public.t_vids TO anon;
CREATE PROCEDURE public.t_capture(p_phase text) LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.t_docs SELECT p_phase, 'owner', vid, public.live_lot_temperature(vid) FROM public.t_vids;
  SET LOCAL ROLE anon;
  INSERT INTO public.t_docs SELECT p_phase, 'anon', vid, public.live_lot_temperature(vid) FROM public.t_vids;
  RESET ROLE;
END $$;
BEGIN; CALL public.t_capture('before'); COMMIT;
SELECT public.t_assert(
  (SELECT doc->>'status' FROM public.t_docs WHERE phase = 'before' AND who = 'anon' AND vid = 'a0000000-0000-0000-0000-000000000001') = 'ok'
  AND (SELECT doc->>'status' FROM public.t_docs WHERE phase = 'before' AND who = 'anon' AND vid = 'c0000000-0000-0000-0000-000000000001') = 'not_live'
  AND (SELECT doc->>'status' FROM public.t_docs WHERE phase = 'before' AND who = 'anon' AND vid = 'e0000000-0000-0000-0000-000000000001') = 'ended'
  AND (SELECT doc->>'status' FROM public.t_docs WHERE phase = 'before' AND who = 'anon' AND vid = 'e0000000-0000-0000-0000-000000000002') = 'not_read'
  AND (SELECT doc->>'status' FROM public.t_docs WHERE phase = 'before' AND who = 'anon' AND vid = 'e0000000-0000-0000-0000-000000000003') = 'ok',
  'before: ok, not_live, ended, not_read and a lot with no comparables');

-- 2. The migration.
\ir ../migrations/20261014053000_live_lot_temperature_folded.sql

-- 3. After: identical documents for every id and both roles.
BEGIN; CALL public.t_capture('after'); COMMIT;
SELECT public.t_assert(NOT EXISTS (SELECT who, vid, doc FROM public.t_docs WHERE phase = 'before' EXCEPT SELECT who, vid, doc FROM public.t_docs WHERE phase = 'after')
  AND NOT EXISTS (SELECT who, vid, doc FROM public.t_docs WHERE phase = 'after' EXCEPT SELECT who, vid, doc FROM public.t_docs WHERE phase = 'before')
  AND (SELECT count(*) FROM public.t_docs WHERE phase = 'after') = 2 * (SELECT count(*) FROM public.t_vids),
  'after: identical documents for every vehicle, owner role and anon');

-- ...and the live lot's document is the one worked out by hand (so old == new is not two wrongs). h = 49.
--   own: bids 3 (alice, bob, carol), bidders 3, highest 12500.
--   comp-1 (C1, 7 rows beats C7's 3): as of 49 h bids -100 alice 5000, -60 dave 6000, -50 alice 7000 -> 3 bids, 2 bidders, 7000, sold
--   comp-2: -90 and -55 by bob (the three 4400 rows at -80 add: NULL author bid, bob, bob) -> bids 2+3 = 5, bidders 1, highest 4500
--   comp-3: nothing before the cut -> 0 bids, 0 bidders, no price; comp-4: reserve not met, 4 bids x,y,x,z -> bidders 3
--   comp-5: close from the vehicle's own date: -80 p 3000, -51 q 3500 -> 2 bids, 2 bidders, 3500, sold
--   C6 has no close, and C8 carries this lot's own listing (it has a close and is dropped by its slug): neither is a comparable. The
--   live lot, merged, deleted, private (for anon), other-model, other-make and non-BaT vehicles are not even candidates.
SELECT public.t_assert(
  (SELECT doc->'price'->'comps' FROM public.t_docs WHERE phase = 'after' AND who = 'anon' AND vid = 'a0000000-0000-0000-0000-000000000001') = '[3500, 4500, 7000]'::jsonb
  AND (SELECT (doc->'price'->>'n')::int FROM public.t_docs WHERE phase = 'after' AND who = 'anon' AND vid = 'a0000000-0000-0000-0000-000000000001') = 3
  AND (SELECT (doc->'price'->>'below')::int FROM public.t_docs WHERE phase = 'after' AND who = 'anon' AND vid = 'a0000000-0000-0000-0000-000000000001') = 3
  AND (SELECT (doc->'price'->>'bid')::numeric FROM public.t_docs WHERE phase = 'after' AND who = 'anon' AND vid = 'a0000000-0000-0000-0000-000000000001') = 12500,
  'after: the price comparison is 3500, 4500 and 7000 against 12500');
SELECT public.t_assert(
  (SELECT doc->'activity'->'comps' FROM public.t_docs WHERE phase = 'after' AND who = 'anon' AND vid = 'a0000000-0000-0000-0000-000000000001') = '[0, 2, 3, 4, 5]'::jsonb
  AND (SELECT doc->'activity'->'comps_bidders' FROM public.t_docs WHERE phase = 'after' AND who = 'anon' AND vid = 'a0000000-0000-0000-0000-000000000001') = '[0, 1, 2, 2, 3]'::jsonb
  AND (SELECT (doc->'activity'->>'n')::int FROM public.t_docs WHERE phase = 'after' AND who = 'anon' AND vid = 'a0000000-0000-0000-0000-000000000001') = 5
  AND (SELECT (doc->'activity'->>'bids')::int FROM public.t_docs WHERE phase = 'after' AND who = 'anon' AND vid = 'a0000000-0000-0000-0000-000000000001') = 3,
  'after: the activity comparison is the bids and bidders by hand: bids 0,2,3,4,5 and bidders 0,1,2,2,3');
SELECT public.t_assert(
  (SELECT (doc->>'vehicles_considered')::int FROM public.t_docs WHERE phase = 'after' AND who = 'anon' AND vid = 'a0000000-0000-0000-0000-000000000001') = 8
  AND (SELECT (doc->>'vehicles_considered')::int FROM public.t_docs WHERE phase = 'after' AND who = 'owner' AND vid = 'a0000000-0000-0000-0000-000000000001') = 9
  AND (SELECT (doc->>'lots_without_close')::int FROM public.t_docs WHERE phase = 'after' AND who = 'anon' AND vid = 'a0000000-0000-0000-0000-000000000001') = 1,
  'after: 8 candidates for anon (the private one is a ninth for the owner role), 1 lot without a close (C6)');
SELECT public.t_assert(
  (SELECT doc->>'status' FROM public.t_docs WHERE phase = 'after' AND who = 'anon' AND vid = 'e0000000-0000-0000-0000-000000000003') = 'ok'
  AND (SELECT (doc->'price'->>'n')::int FROM public.t_docs WHERE phase = 'after' AND who = 'anon' AND vid = 'e0000000-0000-0000-0000-000000000003') = 0
  AND (SELECT doc->'activity'->'comps' FROM public.t_docs WHERE phase = 'after' AND who = 'anon' AND vid = 'e0000000-0000-0000-0000-000000000003') = '[]'::jsonb,
  'after: a lot with no comparables is ok with empty comparisons');

-- 4. Shape, attributes and rights are as they were, plus the one planner setting.
SELECT public.t_assert((SELECT NOT prosecdef AND provolatile = 's' AND proconfig::text LIKE '%search_path=public%'
    AND proconfig::text LIKE '%statement_timeout=8s%' AND proconfig::text LIKE '%lock_timeout=2s%' AND proconfig::text LIKE '%enable_indexscan=off%'
    FROM pg_proc WHERE oid = 'public.live_lot_temperature(uuid)'::regprocedure),
  'after: SECURITY INVOKER, stable, search_path, 8 s and 2 s timeouts, and enable_indexscan off');
SELECT public.t_assert(has_function_privilege('anon', 'public.live_lot_temperature(uuid)', 'execute')
  AND has_function_privilege('authenticated', 'public.live_lot_temperature(uuid)', 'execute'), 'after: anon and authenticated still execute it');
SELECT public.t_assert(pg_get_function_result('public.live_lot_temperature(uuid)'::regprocedure) = 'jsonb', 'after: returns jsonb');
-- The setting is local to the function: this session still plans with index scans.
SELECT public.t_assert(current_setting('enable_indexscan') = 'on', 'enable_indexscan is only off inside the function');

-- 5. A second run is a no-op that passes the guard.
\ir ../migrations/20261014053000_live_lot_temperature_folded.sql
SELECT public.t_assert(public.live_lot_temperature('a0000000-0000-0000-0000-000000000001') =
  (SELECT doc FROM public.t_docs WHERE phase = 'after' AND who = 'owner' AND vid = 'a0000000-0000-0000-0000-000000000001'), 'a re-run leaves the answer alone');

-- 6. A drifted source stops the migration and is left as found.
CREATE OR REPLACE FUNCTION public.live_lot_temperature(p_vehicle_id uuid) RETURNS jsonb LANGUAGE sql STABLE
  AS $f$ SELECT '{"drifted": true}'::jsonb WHERE p_vehicle_id IS NOT NULL $f$;
\echo 'Expected: the source guard ERROR below, then the aborted transaction ignoring the rest of the file.'
\set ON_ERROR_STOP off
\ir ../migrations/20261014053000_live_lot_temperature_folded.sql
\set ON_ERROR_STOP on
SELECT public.t_assert(public.live_lot_temperature('a0000000-0000-0000-0000-000000000001') = '{"drifted": true}'::jsonb, 'a drifted function is not replaced');
SELECT 'live_lot_temperature folded contract: PASS' AS result;
