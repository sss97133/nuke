-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_live_upsert_closed -f this-file.sql
-- Contract for 20261018040000_live_auction_upsert_skip_closed_lots.sql. The live upsert
-- (helpers/upsert_live_auction_vehicles_live_20261016.sql) is reproduced first; after the migration:
--   * a lot whose result is on record in auction_events (sold, reserve_not_met, cancelled; same vehicle and URL, with or
--     without the trailing slash) is never re-lived: high_bid, sale_price, sale_status, auction_status and
--     auction_end_date keep the corrected close when the live list still carries the lot with an older bid;
--   * a running lot (no result, or a non-terminal 'live' / 'bid_to' row) and a new listing are written as before, and
--     the return value counts rows written;
--   * before the migration the live body does rewrite the closed lot (the defect, reproduced);
--   * re-applying the migration is a no-op (its guard accepts the live 2026-10-16 body and its own).
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;
SET statement_timeout = '30s';
SET TimeZone = 'UTC';

-- vehicles: the columns the upsert reads or writes, and the live partial unique key it conflicts on.
CREATE TABLE public.vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_url text, title text, year integer, make text, model text,
  auction_status text, sale_status text, auction_end_date text, high_bid integer, sale_price integer,
  primary_image_url text, platform_source text, origin_metadata jsonb, is_public boolean,
  updated_at timestamptz DEFAULT now(), deleted_at timestamptz);
CREATE UNIQUE INDEX idx_vehicles_listing_url_unique ON public.vehicles (listing_url)
  WHERE deleted_at IS NULL AND listing_url IS NOT NULL AND listing_url <> '';
CREATE TABLE public.auction_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, source text, source_url text, outcome text,
  high_bid numeric, winning_bid numeric);
CREATE UNIQUE INDEX idx_auction_events_vehicle_source_url ON public.auction_events (vehicle_id, source_url);
\ir helpers/upsert_live_auction_vehicles_live_20261016.sql

CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF; RAISE NOTICE 'PASS %', label;
END $$;
CREATE FUNCTION pg_temp.u(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
 SELECT ('00000000-0000-0000-0000-' || lpad(to_hex(n), 12, '0'))::uuid $$;
-- the live list's row for a lot, as sync-live-auctions sends it (BaT's current bid travels as sale_price)
CREATE FUNCTION pg_temp.row(url text, bid integer, ends text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT jsonb_build_object('listing_url', url, 'title', '1969 Chevrolet Corvette', 'year', '1969', 'make', 'Chevrolet',
   'model', 'Corvette', 'auction_status', 'active', 'sale_status', 'auction_live', 'auction_end_date', ends,
   'sale_price', bid::text, 'platform_source', 'bringatrailer', 'origin_metadata', '{"platform":"bringatrailer"}'::jsonb) $$;
CREATE FUNCTION pg_temp.state(n integer) RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT jsonb_build_object('high_bid', high_bid, 'sale_price', sale_price, 'sale_status', sale_status,
   'auction_status', auction_status, 'auction_end_date', auction_end_date) FROM public.vehicles WHERE id = pg_temp.u(n) $$;

-- Fixtures. Each lot's vehicles row carries its close as the correction writer left it.
--  1 sold (result on record), 2 reserve not met, 3 cancelled (withdrawn), 4 sold with the event URL slashless and the
--  vehicles URL slashed, 5 running (a 'live' row), 6 ended without a result ('bid_to'), 7 running with no event row.
CREATE FUNCTION pg_temp.seed() RETURNS void LANGUAGE sql AS $$
  TRUNCATE public.vehicles, public.auction_events;
  INSERT INTO public.vehicles (id, listing_url, make, model, year, auction_status, sale_status, auction_end_date, high_bid, sale_price, platform_source)
  VALUES (pg_temp.u(1), 'https://bringatrailer.com/listing/lot-1', 'Chevrolet', 'Corvette', 1969, 'ended', 'sold',     '2026-10-15T17:25:12.000Z', 26750, 26750, 'bringatrailer'),
         (pg_temp.u(2), 'https://bringatrailer.com/listing/lot-2', 'Chevrolet', 'Corvette', 1969, 'ended', 'ended',    '2026-10-15T17:25:12.000Z', 430000, NULL, 'bringatrailer'),
         (pg_temp.u(3), 'https://bringatrailer.com/listing/lot-3', 'Chevrolet', 'Corvette', 1969, 'ended', 'ended',    '2026-10-05T20:21:00.000Z', 15777, NULL, 'bringatrailer'),
         (pg_temp.u(4), 'https://bringatrailer.com/listing/lot-4/', 'Chevrolet', 'Corvette', 1969, 'ended', 'sold',    '2026-10-15T18:20:31.000Z', 16000, 16000, 'bringatrailer'),
         (pg_temp.u(5), 'https://bringatrailer.com/listing/lot-5', 'Chevrolet', 'Corvette', 1969, 'active', 'auction_live', '2026-10-16T19:00:00.000Z', 9000, NULL, 'bringatrailer'),
         (pg_temp.u(6), 'https://bringatrailer.com/listing/lot-6', 'Chevrolet', 'Corvette', 1969, 'ended', 'ended',   '2026-10-15T19:00:00.000Z', 5000, NULL, 'bringatrailer'),
         (pg_temp.u(7), 'https://bringatrailer.com/listing/lot-7', 'Chevrolet', 'Corvette', 1969, 'active', 'auction_live', '2026-10-17T19:00:00.000Z', 1200, NULL, 'bringatrailer');
  INSERT INTO public.auction_events (vehicle_id, source, source_url, outcome, high_bid, winning_bid)
  VALUES (pg_temp.u(1), 'bat', 'https://bringatrailer.com/listing/lot-1', 'sold', 26750, 26750),
         (pg_temp.u(2), 'bat', 'https://bringatrailer.com/listing/lot-2', 'reserve_not_met', 430000, NULL),
         (pg_temp.u(3), 'bat', 'https://bringatrailer.com/listing/lot-3', 'cancelled', 15777, NULL),
         (pg_temp.u(4), 'bat', 'https://bringatrailer.com/listing/lot-4', 'sold', 16000, 16000),
         (pg_temp.u(5), 'bat', 'https://bringatrailer.com/listing/lot-5', 'live', 9000, NULL),
         (pg_temp.u(6), 'bat', 'https://bringatrailer.com/listing/lot-6', 'bid_to', 5000, NULL);
$$;
-- the stale live list: every lot still "active" with an older bid and its scheduled end, plus one new listing
CREATE FUNCTION pg_temp.stale_list() RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_array(
    pg_temp.row('https://bringatrailer.com/listing/lot-1', 19000, '2026-10-15T18:04:00.000Z'),
    pg_temp.row('https://bringatrailer.com/listing/lot-2', 350000, '2026-10-15T17:20:00.000Z'),
    pg_temp.row('https://bringatrailer.com/listing/lot-3', 15000, '2026-10-12T17:00:00.000Z'),
    pg_temp.row('https://bringatrailer.com/listing/lot-4/', 12500, '2026-10-15T18:17:30.000Z'),
    pg_temp.row('https://bringatrailer.com/listing/lot-5', 9500, '2026-10-16T19:02:00.000Z'),
    pg_temp.row('https://bringatrailer.com/listing/lot-6', 4800, '2026-10-15T19:00:00.000Z'),
    pg_temp.row('https://bringatrailer.com/listing/lot-7', 1300, '2026-10-17T19:00:00.000Z'),
    pg_temp.row('https://bringatrailer.com/listing/lot-8', 500, '2026-10-20T19:00:00.000Z')) $$;

-- ── Before: the live body re-lives the closed lots (the defect) ──────────────────────────────────────────────────
-- (each upsert is its own statement: a STABLE reader in the same statement would see the rows before it)
SELECT pg_temp.seed();
CREATE TEMP TABLE written (step text, n integer);
INSERT INTO written SELECT 'before', public.upsert_live_auction_vehicles(pg_temp.stale_list());
SELECT pg_temp.ok('before: the live list rewrites the sold lot to auction_live with its older bid and scheduled end',
  (SELECT n FROM written WHERE step = 'before') = 8
  AND pg_temp.state(1) = '{"high_bid": 19000, "sale_price": 26750, "sale_status": "auction_live", "auction_status": "active", "auction_end_date": "2026-10-15T18:04:00.000Z"}'::jsonb
  AND (pg_temp.state(2) ->> 'high_bid')::int = 350000);
INSERT INTO written SELECT 'before-2', public.upsert_live_auction_vehicles(jsonb_build_array(
  pg_temp.row('https://bringatrailer.com/listing/lot-1', 19000, '2026-10-15T18:04:00.000Z')));
SELECT pg_temp.ok('before: a second pass empties the sold lot''s sale price', pg_temp.state(1) ->> 'sale_price' IS NULL);

-- ── The migration ────────────────────────────────────────────────────────────────────────────────────────────────
\ir ../migrations/20261018040000_live_auction_upsert_skip_closed_lots.sql
SELECT pg_temp.seed();
CREATE TEMP TABLE closed_before AS SELECT n, pg_temp.state(n) s FROM generate_series(1, 4) n;
INSERT INTO written SELECT 'after', public.upsert_live_auction_vehicles(pg_temp.stale_list());
SELECT pg_temp.ok('after: only the running lots, the unresolved lot and the new listing are written',
  (SELECT n FROM written WHERE step = 'after') = 4);
SELECT pg_temp.ok('after: sold, reserve-not-met, cancelled and slash-variant closed lots keep their close exactly',
  (SELECT bool_and(pg_temp.state(n) = s) FROM closed_before));
INSERT INTO written SELECT 'after-2', public.upsert_live_auction_vehicles(jsonb_build_array(
  pg_temp.row('https://bringatrailer.com/listing/lot-1', 19000, '2026-10-15T18:04:00.000Z')));
SELECT pg_temp.ok('after: a second pass leaves the sold lot''s sale price',
  (SELECT n FROM written WHERE step = 'after-2') = 0
  AND (pg_temp.state(1) ->> 'sale_price')::int = 26750 AND pg_temp.state(1) ->> 'sale_status' = 'sold');
SELECT pg_temp.ok('after: a running lot (a live row, or none) moves its bid and end as before',
  (pg_temp.state(5) ->> 'high_bid')::int = 9500 AND pg_temp.state(5) ->> 'auction_end_date' = '2026-10-16T19:02:00.000Z'
  AND (pg_temp.state(7) ->> 'high_bid')::int = 1300);
SELECT pg_temp.ok('after: a lot without a result on record (bid_to) is still the live list''s to write',
  (pg_temp.state(6) ->> 'high_bid')::int = 4800 AND pg_temp.state(6) ->> 'sale_status' = 'auction_live');
SELECT pg_temp.ok('after: a new listing is inserted live',
  (SELECT sale_status = 'auction_live' AND high_bid = 500 FROM public.vehicles WHERE listing_url = 'https://bringatrailer.com/listing/lot-8'));
INSERT INTO written SELECT 'after-3', public.upsert_live_auction_vehicles(pg_temp.stale_list());
SELECT pg_temp.ok('after: an unchanged live list writes nothing', (SELECT n FROM written WHERE step = 'after-3') = 0);

-- ── Re-apply and drift ───────────────────────────────────────────────────────────────────────────────────────────
CREATE TEMP TABLE def AS SELECT md5(pg_get_functiondef('public.upsert_live_auction_vehicles(jsonb)'::regprocedure)) m;
\ir ../migrations/20261018040000_live_auction_upsert_skip_closed_lots.sql
SELECT pg_temp.ok('re-applying the migration is a no-op',
  (SELECT m FROM def) = md5(pg_get_functiondef('public.upsert_live_auction_vehicles(jsonb)'::regprocedure)));
