-- Empty disposable PG17 only, run from the repository root:
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_pulse_houses -f supabase/sql/test_market_pulse_live_houses.sql
-- Contract for 20261022010000_market_pulse_live_houses.sql: the other houses' open lots in the board's row shape plus
-- house and currency; the house comes from the listing URL before platform_source; a house whose newest write is
-- six hours old is off the board but named in 'houses'; Bonhams, BaT, ended, private and deleted lots are not read;
-- a visitor can read it.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;

CREATE TABLE public.canonical_makes (id uuid PRIMARY KEY, canonical_name text);
CREATE TABLE public.vehicles (
  id uuid PRIMARY KEY, year integer, make text, model text, canonical_make_id uuid,
  high_bid numeric, sale_price numeric, auction_end_date timestamptz,
  updated_at timestamptz, created_at timestamptz, primary_image_url text,
  origin_metadata jsonb, listing_url text, title text,
  is_public boolean NOT NULL DEFAULT true, deleted_at timestamptz,
  listing_kind text, sale_status text, platform_source text);
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
GRANT SELECT ON public.vehicles, public.canonical_makes TO anon, authenticated;
CREATE OR REPLACE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;

INSERT INTO public.canonical_makes VALUES ('11111111-1111-1111-1111-111111111111', 'Porsche');
INSERT INTO public.vehicles (id, year, make, model, canonical_make_id, high_bid, auction_end_date, updated_at, created_at,
  primary_image_url, origin_metadata, listing_url, title, sale_status, platform_source, is_public, deleted_at)
VALUES
  -- Collecting Cars, GBP, with platform_source.
  ('cccccccc-0000-0000-0000-000000000001', 1994, 'PORSCHE', '911', '11111111-1111-1111-1111-111111111111', 44694,
   now() + interval '2 days', now() - interval '10 minutes', now() - interval '3 days', 'https://img.example/c1.jpg',
   '{"currency": "gbp", "no_reserve": true}', 'https://collectingcars.com/for-sale/a', '1994 Porsche 911', 'auction_live', 'collecting-cars', true, NULL),
  -- PCarMarket written without platform_source: its link names the house; no currency recorded reads USD.
  ('cccccccc-0000-0000-0000-000000000002', 2014, 'Porsche', 'Cayenne', NULL, 47000,
   now() + interval '1 day', now() - interval '20 minutes', now() - interval '2 days', NULL,
   NULL, 'https://pcarmarket.com/auction/b', NULL, 'auction_live', NULL, true, NULL),
  -- Cars & Bids with a two-day-old write: the house is off the board.
  ('cccccccc-0000-0000-0000-000000000003', 2018, 'Mercedes-Benz', 'GLE350', NULL, 9000,
   now() + interval '3 days', now() - interval '2 days', now() - interval '4 days', NULL,
   NULL, 'https://carsandbids.com/auctions/c', '2018 Mercedes-Benz GLE350', 'auction_live', 'cars-and-bids', true, NULL),
  -- Not read: Bonhams (no live bid), BaT (its own board), an ended lot, a private lot, a deleted lot.
  ('cccccccc-0000-0000-0000-000000000004', 1903, 'Swift', '6hp', NULL, NULL, now() + interval '9 days', now(), now(), NULL,
   '{"currency": "GBP"}', 'https://www.bonhams.com/auction/1/lot/2', NULL, 'auction_live', NULL, true, NULL),
  ('cccccccc-0000-0000-0000-000000000005', 1973, 'Porsche', '911', NULL, 650000, now() + interval '2 hours', now(), now(), NULL,
   NULL, 'https://bringatrailer.com/listing/d/', NULL, 'auction_live', 'bringatrailer', true, NULL),
  ('cccccccc-0000-0000-0000-000000000006', 1990, 'BMW', 'M3', NULL, 100, now() - interval '1 hour', now(), now(), NULL,
   NULL, 'https://collectingcars.com/for-sale/e', NULL, 'auction_live', 'collecting-cars', true, NULL),
  ('cccccccc-0000-0000-0000-000000000007', 1990, 'BMW', 'M3', NULL, 100, now() + interval '1 hour', now(), now(), NULL,
   NULL, 'https://collectingcars.com/for-sale/f', NULL, 'auction_live', 'collecting-cars', false, NULL),
  ('cccccccc-0000-0000-0000-000000000008', 1990, 'BMW', 'M3', NULL, 100, now() + interval '1 hour', now(), now(), NULL,
   NULL, 'https://collectingcars.com/for-sale/g', NULL, 'auction_live', 'collecting-cars', true, now());

\ir ../migrations/20261022010000_market_pulse_live_houses.sql
\ir ../migrations/20261022020000_live_board_houses.sql
\ir ../migrations/20261022020000_live_board_houses.sql

CREATE TEMP TABLE board AS SELECT public.market_pulse_live_houses() AS j;

SELECT pg_temp.ok('the row names its slots and carries house and currency last',
  (SELECT j->'columns' FROM board) = '["id","year","make","model","current_bid","ends_at","updated_at","listed_at","image_url","no_reserve","listing_url","title","house","currency"]'::jsonb);
SELECT pg_temp.ok('two lots are on the board, in close order, each with 14 slots',
  (SELECT jsonb_array_length(j->'auctions') = 2 AND j->'auctions'->0->>0 = 'cccccccc-0000-0000-0000-000000000002'
     AND j->'auctions'->1->>0 = 'cccccccc-0000-0000-0000-000000000001'
     AND jsonb_array_length(j->'auctions'->0) = 14 FROM board));
SELECT pg_temp.ok('a lot keeps its recorded currency (upper case) and its make from canonical_makes',
  (SELECT j->'auctions'->1->>13 = 'GBP' AND j->'auctions'->1->>2 = 'Porsche' AND (j->'auctions'->1->>9)::boolean FROM board));
SELECT pg_temp.ok('a lot written without platform_source takes its house from the link; no currency recorded reads USD',
  (SELECT j->'auctions'->0->>12 = 'pcarmarket' AND j->'auctions'->0->>13 = 'USD' FROM board));
SELECT pg_temp.ok('a house whose newest write is two days old is off the board and named with that write',
  (SELECT j->'houses' @> '[{"house": "cars-and-bids", "lots": 1, "on_board": false}]'::jsonb
     AND j->'houses' @> '[{"house": "collecting-cars", "lots": 1, "on_board": true}]'::jsonb
     AND j->'houses' @> '[{"house": "pcarmarket", "on_board": true}]'::jsonb
     AND jsonb_array_length(j->'houses') = 3 FROM board));
SELECT pg_temp.ok('Bonhams, BaT, ended, private and deleted lots are not read',
  NOT EXISTS (SELECT 1 FROM board, jsonb_array_elements(j->'auctions') a
              WHERE a->>0 IN ('cccccccc-0000-0000-0000-000000000004','cccccccc-0000-0000-0000-000000000005',
                              'cccccccc-0000-0000-0000-000000000006','cccccccc-0000-0000-0000-000000000007',
                              'cccccccc-0000-0000-0000-000000000008')));

-- The same house a few hours later with a fresh write comes back on the board.
UPDATE public.vehicles SET updated_at = now() WHERE id = 'cccccccc-0000-0000-0000-000000000003';
SELECT pg_temp.ok('a house whose reader writes again returns to the board',
  jsonb_array_length(public.market_pulse_live_houses()->'auctions') = 3);

-- A house is a row: enabling Bonhams brings its lot in with its label; an unlisted house is never read.
SELECT pg_temp.ok('houses carry the label of their row', public.market_pulse_live_houses()->'houses' @> '[{"house": "collecting-cars", "label": "Collecting Cars"}]'::jsonb);
UPDATE public.live_board_houses SET enabled = true WHERE house = 'bonhams';
SELECT pg_temp.ok('enabling a house reads its lots (Bonhams, matched by link host)',
  jsonb_array_length(public.market_pulse_live_houses()->'auctions') = 4
  AND public.market_pulse_live_houses()->'houses' @> '[{"house": "bonhams", "label": "Bonhams", "lots": 1}]'::jsonb);
INSERT INTO public.vehicles (id, year, make, model, high_bid, auction_end_date, updated_at, created_at, listing_url, sale_status, platform_source)
VALUES ('cccccccc-0000-0000-0000-000000000009', 1970, 'X', 'Y', 5, now() + interval '1 day', now(), now(), 'https://unlisted.example/lot/1', 'auction_live', 'unlisted-house');
SELECT pg_temp.ok('a house with no row is not read', jsonb_array_length(public.market_pulse_live_houses()->'auctions') = 4);
UPDATE public.live_board_houses SET enabled = false WHERE house = 'bonhams';
UPDATE public.vehicles SET updated_at = now() WHERE id = 'cccccccc-0000-0000-0000-000000000003';

SET ROLE anon;
SELECT jsonb_array_length(public.market_pulse_live_houses()->'auctions') AS anon_lots \gset
RESET ROLE;
SELECT pg_temp.ok('a visitor reads it', :'anon_lots'::int = 3
  AND has_function_privilege('anon', 'public.market_pulse_live_houses()', 'execute'));
