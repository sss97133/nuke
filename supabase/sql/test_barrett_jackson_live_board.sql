-- Empty disposable PG17 only, run from the repository root:
--   scripts/ci/run-db-contracts.sh test_barrett_jackson_live_board.sql
-- Contract for 20261022051000_barrett_jackson_live_board.sql: Barrett-Jackson is an enabled live_board_houses row; a live
-- lot written under its docket page reaches market_pulse_live_houses by its link (with or without platform_source) and
-- leaves it once end_live_auction_lots ends it with its closing bid and close time; the sync-live-auctions-houses job posts
-- 'barrett-jackson' once, appended to the platforms it carried, the rest of its command unchanged; a second run changes
-- nothing.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.live_board_houses') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;

-- The vehicles columns the board and end_live_auction_lots read, typed as production has them; live_board_houses and
-- end_live_auction_lots from their own migrations; cron as pg_cron 1.6.
CREATE TABLE public.canonical_makes (id uuid PRIMARY KEY, canonical_name text);
CREATE TABLE public.vehicles (
  id uuid PRIMARY KEY, year integer, make text, model text, canonical_make_id uuid,
  high_bid integer, sale_price integer, auction_end_date text, auction_status text,
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

-- The job as live on 2026-10-20 (jobid 628), the platforms list as the Mecum migration leaves it.
INSERT INTO cron.job (jobname, schedule, command) VALUES ('sync-live-auctions-houses', '*/5 * * * *', $cmd$
  SELECT net.http_post(
    url := get_service_url() || '/functions/v1/sync-live-auctions',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || get_service_role_key_for_cron()),
    body := '{"action":"sync","platform":"collecting-cars","platforms":["collecting-cars","pcarmarket","bonhams"]}'::jsonb,
    timeout_milliseconds := 150000
  );
$cmd$);
\ir ../migrations/20261022050000_mecum_live_board.sql
CREATE TEMP TABLE before AS SELECT command FROM cron.job;

-- Lots as syncBarrettJackson writes them: 01 a live lot already in vehicles without platform_source (the docket spelling
-- vehicles hold), 02 a live lot the reader inserted (platform_source barrett-jackson), 03 a lot of an event not yet open.
INSERT INTO public.vehicles (id, year, make, model, high_bid, auction_end_date, auction_status, updated_at, created_at,
  origin_metadata, listing_url, title, sale_status, platform_source)
VALUES
  ('bbbbbbbb-0000-0000-0000-000000000001', 1981, 'Honda', 'ATC200', 2500, to_char((now() + interval '2 days') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
   'active', now() - interval '4 minutes', now() - interval '30 days', '{"currency": "USD"}',
   'https://barrett-jackson.com/2026-las-vegas/docket/vehicle/1981-honda-atc200-three-wheeler-302207', '1981 HONDA ATC200 THREE-WHEELER', 'auction_live', NULL),
  ('bbbbbbbb-0000-0000-0000-000000000002', 1979, 'Honda', 'ATC110', 1000, to_char((now() + interval '2 days') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
   'active', now() - interval '4 minutes', now() - interval '1 hour', '{"currency": "USD"}',
   'https://barrett-jackson.com/2026-las-vegas/docket/vehicle/1979-honda-atc110-three-wheeler-302193', '1979 HONDA ATC110 THREE-WHEELER', 'auction_live', 'barrett-jackson'),
  ('bbbbbbbb-0000-0000-0000-000000000003', 1965, 'Ford', 'Mustang', NULL, NULL, NULL, now(), now(), '{}',
   'https://barrett-jackson.com/2027-scottsdale/docket/vehicle/1965-ford-mustang-1', '1965 FORD MUSTANG', 'available', NULL);

SELECT pg_temp.ok('before the migration no Barrett-Jackson lot is on the board',
  NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.market_pulse_live_houses()->'auctions') a WHERE a->>10 ~ 'barrett-jackson\.com'));

\ir ../migrations/20261022051000_barrett_jackson_live_board.sql

SELECT pg_temp.ok('Barrett-Jackson is an enabled board house',
  (SELECT enabled AND label = 'Barrett-Jackson' FROM public.live_board_houses WHERE house = 'barrett-jackson'));
SELECT pg_temp.ok('both live lots reach the board by their docket link, in USD; the not-yet-open lot does not',
  (SELECT count(*) = 2 AND bool_and(a->>12 = 'barrett-jackson' AND a->>13 = 'USD')
     FROM jsonb_array_elements(public.market_pulse_live_houses()->'auctions') a WHERE a->>10 ~ 'barrett-jackson\.com')
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.market_pulse_live_houses()->'auctions') a WHERE a->>0 = 'bbbbbbbb-0000-0000-0000-000000000003'));
SELECT pg_temp.ok('the job posts barrett-jackson once, after the houses it carried, with the rest of its command unchanged',
  (SELECT command LIKE '%"platforms": ["collecting-cars", "pcarmarket", "bonhams", "mecum", "barrett-jackson"]%'
     AND regexp_replace(command, $re$body := '[^']*'::jsonb$re$, '') = regexp_replace((SELECT command FROM before), $re$body := '[^']*'::jsonb$re$, '')
     FROM cron.job WHERE jobname = 'sync-live-auctions-houses'));

-- Lot 1 sells on the block: the reader hands its hammer and close time to end_live_auction_lots.
SELECT public.end_live_auction_lots('[{"url": "https://barrett-jackson.com/2026-las-vegas/docket/vehicle/1981-honda-atc200-three-wheeler-302207", "closing_bid": 2500, "ended_at": "2026-09-10T17:55:25+00:00"}]'::jsonb) AS ended \gset
SELECT pg_temp.ok('a sold lot ends with its hammer and the platform''s close time, and leaves the board',
  :ended = 1
  AND (SELECT sale_status = 'ended' AND high_bid = 2500 AND auction_end_date = '2026-09-10T17:55:25+00:00'
         FROM public.vehicles WHERE id = 'bbbbbbbb-0000-0000-0000-000000000001')
  AND (SELECT count(*) = 1 FROM jsonb_array_elements(public.market_pulse_live_houses()->'auctions') a WHERE a->>12 = 'barrett-jackson'));

\ir ../migrations/20261022051000_barrett_jackson_live_board.sql
SELECT pg_temp.ok('a second run changes nothing',
  (SELECT command LIKE '%"mecum", "barrett-jackson"]%' AND command NOT LIKE '%"barrett-jackson", "barrett-jackson"%' FROM cron.job)
  AND (SELECT count(*) = 1 FROM public.live_board_houses WHERE house = 'barrett-jackson'));
