-- Empty disposable PG17 only, run from the repository root:
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_pulse_houses -f supabase/sql/test_market_pulse_live_houses.sql
-- Contract for 20261022010000_market_pulse_live_houses.sql: the other houses' open lots in the board's row shape plus
-- house and currency; the house comes from the listing URL before platform_source; a house whose newest write is
-- six hours old is off the board but named in 'houses'; Bonhams, BaT, ended, private and deleted lots are not read;
-- a visitor can read it. 20261022043000_gooding_live_board: Gooding's rows (board house, live_auction_sources) and its
-- place in the houses job, appended without dropping a house another reader added.
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
-- What a reader's migration also touches: its live_auction_sources row and the houses job (pg_cron stand-in).
CREATE TABLE public.live_auction_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text NOT NULL UNIQUE, display_name text NOT NULL, base_url text NOT NULL,
  sync_method text NOT NULL DEFAULT 'polling_scrape', auction_format text, default_poll_interval_ms integer DEFAULT 60000,
  notes text, scraping_config jsonb DEFAULT '{}', last_successful_sync timestamptz);
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid bigint GENERATED ALWAYS AS IDENTITY, jobname text, schedule text, command text);
CREATE FUNCTION cron.alter_job(job_id bigint, schedule text DEFAULT NULL, command text DEFAULT NULL, database text DEFAULT NULL,
  username text DEFAULT NULL, active boolean DEFAULT NULL) RETURNS void LANGUAGE sql AS $$
  UPDATE cron.job SET schedule = coalesce(alter_job.schedule, job.schedule), command = coalesce(alter_job.command, job.command)
  WHERE jobid = job_id $$;
-- the job as 20261019021000_live_auction_board_sync_health schedules it
INSERT INTO cron.job (jobname, schedule, command) VALUES ('sync-live-auctions-houses', '*/5 * * * *', $job$
  SELECT net.http_post(
    url := get_service_url() || '/functions/v1/sync-live-auctions',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || get_service_role_key_for_cron()),
    body := '{"action":"sync","platform":"collecting-cars","platforms":["collecting-cars","pcarmarket","bonhams"]}'::jsonb,
    timeout_milliseconds := 150000
  );
$job$);
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
\ir ../migrations/20261022043000_gooding_live_board.sql
\ir ../migrations/20261022043000_gooding_live_board.sql

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

-- 20261022043000_gooding_live_board: Gooding is a house with a reader; its open lot is read, its catalog rows are not.
SELECT pg_temp.ok('Gooding is enabled with its label, and has its live_auction_sources row for the board writer',
  EXISTS (SELECT 1 FROM public.live_board_houses WHERE house = 'gooding' AND enabled AND label = 'Gooding Christie''s')
  AND (SELECT default_poll_interval_ms = 300000 AND sync_method = 'polling_api' FROM public.live_auction_sources WHERE slug = 'gooding'));
INSERT INTO public.vehicles (id, year, make, model, high_bid, auction_end_date, updated_at, created_at, origin_metadata, listing_url, sale_status, platform_source)
VALUES ('cccccccc-0000-0000-0000-000000000010', 1957, 'Porsche', '356 A Speedster', 210000, now() + interval '3 hours', now(), now(),
        '{"currency": "USD", "no_reserve": true}', 'https://goodingco.com/lot/g', 'auction_live', 'gooding'),
       -- a catalog lot extract-gooding holds (sold, discovery_url only): never on the board
       ('cccccccc-0000-0000-0000-000000000011', 1961, 'Jaguar', 'E-Type', NULL, now() + interval '3 hours', now(), now(),
        NULL, NULL, 'sold', 'gooding');
SELECT pg_temp.ok('an open Gooding lot is on the board under its house and label, in its currency',
  EXISTS (SELECT 1 FROM jsonb_array_elements(public.market_pulse_live_houses()->'auctions') a
          WHERE a->>0 = 'cccccccc-0000-0000-0000-000000000010' AND a->>12 = 'gooding' AND a->>13 = 'USD' AND (a->>4)::numeric = 210000)
  AND public.market_pulse_live_houses()->'houses' @> '[{"house": "gooding", "label": "Gooding Christie''s", "lots": 1, "on_board": true}]'::jsonb
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.market_pulse_live_houses()->'auctions') a WHERE a->>0 = 'cccccccc-0000-0000-0000-000000000011'));
SELECT pg_temp.ok('the houses job posts Gooding once, after the houses it posted, its command otherwise as it was',
  (SELECT (substring(command from $re$body := '(\{[^']*\})'::jsonb$re$)::jsonb) =
          '{"action": "sync", "platform": "collecting-cars", "platforms": ["collecting-cars", "pcarmarket", "bonhams", "gooding"]}'::jsonb
     AND command LIKE '%/functions/v1/sync-live-auctions%' AND command LIKE '%timeout_milliseconds := 150000%' AND schedule = '*/5 * * * *'
   FROM cron.job WHERE jobname = 'sync-live-auctions-houses'));
-- another reader's house appended meanwhile, Gooding not yet: the migration keeps it and appends Gooding after it
UPDATE cron.job SET command = replace(command, '"bonhams", "gooding"]', '"bonhams", "rm-sothebys"]') WHERE jobname = 'sync-live-auctions-houses';
\ir ../migrations/20261022043000_gooding_live_board.sql
SELECT pg_temp.ok('a house another reader appended stays in the job',
  (SELECT substring(command from $re$body := '(\{[^']*\})'::jsonb$re$)::jsonb -> 'platforms' FROM cron.job WHERE jobname = 'sync-live-auctions-houses')
  = '["collecting-cars", "pcarmarket", "bonhams", "rm-sothebys", "gooding"]'::jsonb);

-- 20261022071500_live_board_reader_gate: a house is on the board while its reader reads, not while its lots change.
\ir ../migrations/20261022071500_live_board_reader_gate.sql
\ir ../migrations/20261022071500_live_board_reader_gate.sql
UPDATE public.vehicles SET updated_at = now() - interval '2 days' WHERE id = 'cccccccc-0000-0000-0000-000000000010';
UPDATE public.live_auction_sources SET last_successful_sync = now() - interval '4 minutes' WHERE slug = 'gooding';
SELECT pg_temp.ok('a quiet house (lots last written two days ago) stays on the board while its reader read in the last 30 minutes',
  public.market_pulse_live_houses()->'houses' @> '[{"house": "gooding", "on_board": true}]'::jsonb
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(public.market_pulse_live_houses()->'auctions') a WHERE a->>0 = 'cccccccc-0000-0000-0000-000000000010'));
UPDATE public.live_auction_sources SET last_successful_sync = now() - interval '2 hours' WHERE slug = 'gooding';
SELECT pg_temp.ok('the same house is held off once its reader has not read for 30 minutes and its lots are old',
  public.market_pulse_live_houses()->'houses' @> '[{"house": "gooding", "on_board": false}]'::jsonb
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.market_pulse_live_houses()->'auctions') a WHERE a->>0 = 'cccccccc-0000-0000-0000-000000000010'));
UPDATE public.vehicles SET updated_at = now() WHERE id = 'cccccccc-0000-0000-0000-000000000010';
SELECT pg_temp.ok('a lot write in the last six hours still counts when the reader has no recent read',
  public.market_pulse_live_houses()->'houses' @> '[{"house": "gooding", "on_board": true}]'::jsonb);
UPDATE public.vehicles SET updated_at = now() - interval '2 days' WHERE id = 'cccccccc-0000-0000-0000-000000000003';
SELECT pg_temp.ok('a house with no live_auction_sources row keeps the lot-write gate (Cars & Bids, written two days ago, stays off)',
  public.market_pulse_live_houses()->'houses' @> '[{"house": "cars-and-bids", "on_board": false}]'::jsonb);
