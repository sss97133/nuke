-- Empty disposable PG17 only, run from the repository root:
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_classic_trader_board -f supabase/sql/test_classic_trader_live_board.sql
-- Contract for 20261022044600_classic_trader_live_board.sql: Classic Trader gets a live_auction_sources row (the slug
-- live_auction_board_sync needs) once, never overwriting one that exists; it is an enabled live_board_houses row whose
-- lots reach the board in the auction's own currency (EUR, CHF); the sync-live-auctions-houses job posts
-- 'classic-trader' once, appended to the platforms it already carried with the rest of its command unchanged; a second
-- run changes nothing; a disabled row is enabled again; a missing job fails the migration and writes nothing.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.live_board_houses') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;

-- The tables market_pulse_live_houses reads, then live_board_houses from its own migration; live_auction_sources with
-- the columns and enums this migration writes (as live on 2026-10-20); cron as pg_cron 1.6 has it.
CREATE TABLE public.canonical_makes (id uuid PRIMARY KEY, canonical_name text);
CREATE TABLE public.vehicles (
  id uuid PRIMARY KEY, year integer, make text, model text, canonical_make_id uuid,
  high_bid numeric, sale_price numeric, auction_end_date timestamptz,
  updated_at timestamptz, created_at timestamptz, primary_image_url text,
  origin_metadata jsonb, listing_url text, title text,
  is_public boolean NOT NULL DEFAULT true, deleted_at timestamptz,
  listing_kind text, sale_status text, platform_source text);
CREATE TYPE public.auction_sync_method AS ENUM ('websocket', 'sse', 'polling_api', 'polling_scrape', 'hybrid');
CREATE TYPE public.auction_format_type AS ENUM ('timed_online', 'live_event_online', 'hybrid', 'continuous_24_7');
CREATE TABLE public.live_auction_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text NOT NULL UNIQUE, display_name text NOT NULL, base_url text NOT NULL,
  sync_method public.auction_sync_method NOT NULL DEFAULT 'polling_scrape', auction_format public.auction_format_type,
  default_poll_interval_ms integer DEFAULT 60000, has_soft_close boolean DEFAULT true, soft_close_window_seconds integer DEFAULT 120,
  auction_duration_typical text, is_active boolean DEFAULT true, health_status text DEFAULT 'unknown', notes text,
  scraping_config jsonb DEFAULT '{}'::jsonb);
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
\ir ../migrations/20261022020000_live_board_houses.sql
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid bigint GENERATED ALWAYS AS IDENTITY, jobname text, schedule text, command text, active boolean DEFAULT true);
CREATE FUNCTION cron.alter_job(job_id bigint, schedule text DEFAULT NULL, command text DEFAULT NULL, database text DEFAULT NULL,
  username text DEFAULT NULL, active boolean DEFAULT NULL) RETURNS void LANGUAGE sql AS $$
  UPDATE cron.job SET command = coalesce(alter_job.command, job.command), schedule = coalesce(alter_job.schedule, job.schedule)
  WHERE jobid = job_id $$;
CREATE OR REPLACE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;

-- The job as live on 2026-10-20 (jobid 628), plus a house another reader's migration appended.
INSERT INTO cron.job (jobname, schedule, command) VALUES ('sync-live-auctions-houses', '*/5 * * * *', $cmd$
  SELECT net.http_post(
    url := get_service_url() || '/functions/v1/sync-live-auctions',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || get_service_role_key_for_cron()),
    body := '{"action":"sync","platform":"collecting-cars","platforms":["collecting-cars","pcarmarket","bonhams","the-market"]}'::jsonb,
    timeout_milliseconds := 150000
  );
$cmd$);
CREATE TEMP TABLE before AS SELECT command FROM cron.job;
-- Two lots as syncClassicTrader writes them (upsert_live_auction_vehicles), values from the auctions page on 2026-10-20
-- 19:58Z: the ad's canonical link, platform_source, the bid in the auction's own currency, a live end.
INSERT INTO public.vehicles (id, year, make, model, high_bid, auction_end_date, updated_at, created_at, primary_image_url,
  origin_metadata, listing_url, title, sale_status, platform_source)
VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 1967, 'Alfa Romeo', 'Giulia 1300 TI', 3500, now() + interval '1 day', now(), now(),
   'https://cdn.classic-trader.com/I/images/960_720/vehicle_ad_standard_image_8c44c8ca35783c082fc2ab34b0ee0e53.jpg',
   '{"currency": "EUR", "no_reserve": false, "reserve_met": false, "bid_count": 11}',
   'https://www.classic-trader.com/uk/cars/listing/alfa-romeo/giulia/giulia-1300-ti/1967/466313', '1967 Alfa Romeo Giulia 1300 TI',
   'auction_live', 'classic-trader'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 1964, 'Cadillac', 'Ambulance Carrosserie Köng', 16000, now() + interval '5 days', now(), now(),
   'https://cdn.classic-trader.com/I/images/960_720/vehicle_ad_standard_image_1b4e00498b0358b499e9bf372f003e6d.jpg',
   '{"currency": "CHF", "no_reserve": false, "reserve_met": true, "bid_count": 4}',
   'https://www.classic-trader.com/uk/cars/listing/cadillac/fleetwood/ambulance-carrosserie-koeng/1964/466304',
   '1964 Cadillac Ambulance Carrosserie Köng', 'auction_live', 'classic-trader');
SELECT pg_temp.ok('before the migration no Classic Trader lot is on the board',
  jsonb_array_length(public.market_pulse_live_houses()->'auctions') = 0);

\ir ../migrations/20261022044600_classic_trader_live_board.sql
\ir ../migrations/20261022044600_classic_trader_live_board.sql

SELECT pg_temp.ok('Classic Trader has one live_auction_sources row, a timed online polling source',
  (SELECT count(*) = 1 AND bool_and(display_name = 'Classic Trader' AND base_url = 'https://www.classic-trader.com'
          AND sync_method = 'polling_scrape' AND auction_format = 'timed_online' AND default_poll_interval_ms = 300000 AND is_active)
   FROM public.live_auction_sources WHERE slug = 'classic-trader'));
SELECT pg_temp.ok('Classic Trader is an enabled house matched by its ad links',
  (SELECT enabled AND label = 'Classic Trader'
          AND 'https://www.classic-trader.com/uk/cars/listing/alfa-romeo/giulia/giulia-1300-ti/1967/466313' ~* host_pattern
          AND 'https://www.classic-trader.com/uk/motorcycle/listing/piaggio/vespa-150/1961/468143' ~* host_pattern
          AND 'https://www.classictrader.com/' !~* host_pattern
   FROM public.live_board_houses WHERE house = 'classic-trader'));
SELECT pg_temp.ok('other houses are untouched', (SELECT NOT enabled FROM public.live_board_houses WHERE house = 'bonhams')
  AND (SELECT count(*) FROM public.live_board_houses WHERE enabled) = 4);
SELECT pg_temp.ok('both lots are on the board under the house, each in its own currency',
  (SELECT (SELECT array_agg((a->>4)::numeric || ' ' || (a->>13) ORDER BY a->>5) FROM jsonb_array_elements(j->'auctions') a
               WHERE a->>12 = 'classic-trader') = ARRAY['3500 EUR', '16000 CHF']
          AND j->'houses' @> '[{"house": "classic-trader", "label": "Classic Trader", "lots": 2, "on_board": true}]'::jsonb
   FROM (SELECT public.market_pulse_live_houses() AS j) b));
SELECT pg_temp.ok('the job posts classic-trader once, after the platforms it carried',
  (SELECT substring(command FROM $re$body := '(\{[^']*\})'::jsonb$re$)::jsonb -> 'platforms'
          = '["collecting-cars","pcarmarket","bonhams","the-market","classic-trader"]'::jsonb FROM cron.job));
SELECT pg_temp.ok('the rest of the job command is unchanged',
  (SELECT regexp_replace(j.command, $re$body := '[^']*'$re$, '') = regexp_replace(b.command, $re$body := '[^']*'$re$, '')
          AND j.schedule = '*/5 * * * *' FROM cron.job j, before b));

-- A disabled row is switched on; an existing source row is kept as it is.
UPDATE public.live_board_houses SET enabled = false WHERE house = 'classic-trader';
UPDATE public.live_auction_sources SET notes = 'kept', health_status = 'healthy' WHERE slug = 'classic-trader';
\ir ../migrations/20261022044600_classic_trader_live_board.sql
SELECT pg_temp.ok('a disabled Classic Trader row is enabled again', (SELECT enabled FROM public.live_board_houses WHERE house = 'classic-trader'));
SELECT pg_temp.ok('an existing live_auction_sources row is not overwritten',
  (SELECT notes = 'kept' AND health_status = 'healthy' FROM public.live_auction_sources WHERE slug = 'classic-trader'));

-- Without the job the migration refuses instead of scheduling nothing.
DELETE FROM cron.job;
DELETE FROM public.live_board_houses WHERE house = 'classic-trader';
DELETE FROM public.live_auction_sources WHERE slug = 'classic-trader';
\set ON_ERROR_STOP off
\ir ../migrations/20261022044600_classic_trader_live_board.sql
\set ON_ERROR_STOP on
SELECT pg_temp.ok('a missing job fails the migration and writes nothing',
  NOT EXISTS (SELECT 1 FROM cron.job) AND NOT EXISTS (SELECT 1 FROM public.live_board_houses WHERE house = 'classic-trader')
  AND NOT EXISTS (SELECT 1 FROM public.live_auction_sources WHERE slug = 'classic-trader'));
