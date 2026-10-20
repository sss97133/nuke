-- Empty disposable PG17 only, run from the repository root:
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_the_market_board -f supabase/sql/test_the_market_live_board.sql
-- Contract for 20261022044500_the_market_live_board.sql: The Market is an enabled live_board_houses row whose lots reach
-- the board in GBP; the sync-live-auctions-houses job posts 'the-market' once, appended to the platforms it already
-- carried (another house's addition is kept) with the rest of its command unchanged; a second run changes nothing; a
-- disabled row is enabled again; a missing job fails the migration and writes nothing.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.live_board_houses') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;

-- The tables market_pulse_live_houses reads, then live_board_houses from its own migration; cron as pg_cron 1.6 has it.
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
    body := '{"action":"sync","platform":"collecting-cars","platforms":["collecting-cars","pcarmarket","bonhams","hagerty-marketplace"]}'::jsonb,
    timeout_milliseconds := 150000
  );
$cmd$);
CREATE TEMP TABLE before AS SELECT command FROM cron.job;
-- A lot as syncTheMarket writes it (upsert_live_auction_vehicles), values from the live page on 2026-10-20 19:59Z:
-- the lot's canonical link, platform_source, its bid in pounds, GBP, and a live end.
INSERT INTO public.vehicles (id, year, make, model, high_bid, auction_end_date, updated_at, created_at, primary_image_url,
  origin_metadata, listing_url, title, sale_status, platform_source)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 1966, 'Austin Healey', '3000 Mk III', 45000, now() + interval '1 day', now(), now(),
  'https://cdn.themarket.co.uk/e3d02f1d-99a9-4e8b-8525-d7ed7da29e0c/3b49e4f9-2016-4250-8fa7-e54eb44a0170.jpg',
  '{"currency": "GBP", "no_reserve": false, "reserve_met": false, "bid_count": 9}',
  'https://www.themarket.co.uk/listings/austin-healey/3000-mk-iii/e3d02f1d-99a9-4e8b-8525-d7ed7da29e0c', '1966 Austin Healey 3000 Mk III',
  'auction_live', 'the-market');
SELECT pg_temp.ok('before the migration The Market lot is not on the board',
  jsonb_array_length(public.market_pulse_live_houses()->'auctions') = 0);

\ir ../migrations/20261022044500_the_market_live_board.sql
\ir ../migrations/20261022044500_the_market_live_board.sql

SELECT pg_temp.ok('The Market is an enabled house matched by its lot links',
  (SELECT enabled AND label = 'The Market'
          AND 'https://www.themarket.co.uk/listings/austin-healey/3000-mk-iii/e3d02f1d-99a9-4e8b-8525-d7ed7da29e0c' ~* host_pattern
          AND 'https://themarket.co.uk/listings/norton/650ss/18a1cdd2-09c2-47de-8c93-6c19bc16c4eb' ~* host_pattern
          AND 'https://www.themarket.net/' !~* host_pattern
   FROM public.live_board_houses WHERE house = 'the-market'));
SELECT pg_temp.ok('other houses are untouched', (SELECT NOT enabled FROM public.live_board_houses WHERE house = 'bonhams')
  AND (SELECT count(*) FROM public.live_board_houses WHERE enabled) = 4);
SELECT pg_temp.ok('The Market lot is on the board under its house, label, bid and currency',
  (SELECT j->'auctions'->0->>12 = 'the-market' AND (j->'auctions'->0->>4)::numeric = 45000 AND j->'auctions'->0->>13 = 'GBP'
          AND j->'houses' @> '[{"house": "the-market", "label": "The Market", "lots": 1, "on_board": true}]'::jsonb
   FROM (SELECT public.market_pulse_live_houses() AS j) b));
SELECT pg_temp.ok('the job posts the-market once, after the platforms it carried',
  (SELECT substring(command FROM $re$body := '(\{[^']*\})'::jsonb$re$)::jsonb -> 'platforms'
          = '["collecting-cars","pcarmarket","bonhams","hagerty-marketplace","the-market"]'::jsonb FROM cron.job));
SELECT pg_temp.ok('the rest of the job command is unchanged',
  (SELECT regexp_replace(j.command, $re$body := '[^']*'$re$, '') = regexp_replace(b.command, $re$body := '[^']*'$re$, '')
          AND j.schedule = '*/5 * * * *' FROM cron.job j, before b));

-- A disabled row is switched on.
UPDATE public.live_board_houses SET enabled = false WHERE house = 'the-market';
\ir ../migrations/20261022044500_the_market_live_board.sql
SELECT pg_temp.ok('a disabled The Market row is enabled again', (SELECT enabled FROM public.live_board_houses WHERE house = 'the-market'));

-- Without the job the migration refuses instead of scheduling nothing.
DELETE FROM cron.job;
DELETE FROM public.live_board_houses WHERE house = 'the-market';
\set ON_ERROR_STOP off
\ir ../migrations/20261022044500_the_market_live_board.sql
\set ON_ERROR_STOP on
SELECT pg_temp.ok('a missing job fails the migration and writes nothing',
  NOT EXISTS (SELECT 1 FROM cron.job) AND NOT EXISTS (SELECT 1 FROM public.live_board_houses WHERE house = 'the-market'));
