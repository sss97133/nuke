-- Empty disposable PG17 only, run from the repository root:
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_hagerty_board -f supabase/sql/test_hagerty_live_board.sql
-- Contract for 20261022053100_hagerty_live_board.sql: Hagerty Marketplace is an enabled live_board_houses row; the
-- sync-live-auctions-houses job posts 'hagerty-marketplace' once, appended to the platforms it already carried (another
-- house's addition is kept) with the rest of its command unchanged; a second run changes nothing; a missing job fails.
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
    body := '{"action":"sync","platform":"collecting-cars","platforms":["collecting-cars","pcarmarket","bonhams","gooding"]}'::jsonb,
    timeout_milliseconds := 150000
  );
$cmd$);
CREATE TEMP TABLE before AS SELECT command FROM cron.job;
-- A lot as syncHagerty writes it (upsert_live_auction_vehicles): Hagerty's link, platform_source, USD, a live end.
INSERT INTO public.vehicles (id, year, make, model, high_bid, auction_end_date, updated_at, created_at, primary_image_url,
  origin_metadata, listing_url, title, sale_status, platform_source)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 1969, 'Porsche', '912', 22750, now() + interval '1 day', now(), now(),
  'https://hagerty-marketplace-prod.imgix.net/assets/xojOePzxSaorxMO5zGUTuA.jpg', '{"currency": "USD", "no_reserve": false, "bid_count": 9}',
  'https://hagerty.com/marketplace/auction/1969-Porsche-912/9d3f5910-57fa-4373-a272-4d946482b58f', '1969 Porsche 912 Coupe 5-Speed',
  'auction_live', 'hagerty-marketplace');
SELECT pg_temp.ok('before the migration the Hagerty lot is not on the board',
  jsonb_array_length(public.market_pulse_live_houses()->'auctions') = 0);

\ir ../migrations/20261022053100_hagerty_live_board.sql
\ir ../migrations/20261022053100_hagerty_live_board.sql

SELECT pg_temp.ok('Hagerty Marketplace is an enabled house matched by its auction links',
  (SELECT enabled AND label = 'Hagerty Marketplace'
          AND 'https://hagerty.com/marketplace/auction/1969-Porsche-912/9d3f5910-57fa-4373-a272-4d946482b58f' ~* host_pattern
          AND 'https://www.hagerty.com/marketplace/auction/1935-Ford-Custom-Hot%20Rod/0688b6cc' ~* host_pattern
          AND 'https://www.hagerty.com/insurance/' !~* host_pattern
   FROM public.live_board_houses WHERE house = 'hagerty-marketplace'));
SELECT pg_temp.ok('other houses are untouched', (SELECT NOT enabled FROM public.live_board_houses WHERE house = 'bonhams')
  AND (SELECT count(*) FROM public.live_board_houses WHERE enabled) = 4);
SELECT pg_temp.ok('the Hagerty lot is on the board under its house, label, bid and currency',
  (SELECT j->'auctions'->0->>12 = 'hagerty-marketplace' AND (j->'auctions'->0->>4)::numeric = 22750 AND j->'auctions'->0->>13 = 'USD'
          AND j->'houses' @> '[{"house": "hagerty-marketplace", "label": "Hagerty Marketplace", "lots": 1, "on_board": true}]'::jsonb
   FROM (SELECT public.market_pulse_live_houses() AS j) b));
SELECT pg_temp.ok('the job posts hagerty-marketplace once, after the platforms it carried',
  (SELECT substring(command FROM $re$body := '(\{[^']*\})'::jsonb$re$)::jsonb -> 'platforms'
          = '["collecting-cars","pcarmarket","bonhams","gooding","hagerty-marketplace"]'::jsonb FROM cron.job));
SELECT pg_temp.ok('the rest of the job command is unchanged',
  (SELECT regexp_replace(j.command, $re$body := '[^']*'$re$, '') = regexp_replace(b.command, $re$body := '[^']*'$re$, '')
          AND j.schedule = '*/5 * * * *' FROM cron.job j, before b));

-- A disabled row is switched on.
UPDATE public.live_board_houses SET enabled = false WHERE house = 'hagerty-marketplace';
\ir ../migrations/20261022053100_hagerty_live_board.sql
SELECT pg_temp.ok('a disabled Hagerty row is enabled again', (SELECT enabled FROM public.live_board_houses WHERE house = 'hagerty-marketplace'));

-- Without the job the migration refuses instead of scheduling nothing.
DELETE FROM cron.job;
DELETE FROM public.live_board_houses WHERE house = 'hagerty-marketplace';
\set ON_ERROR_STOP off
\ir ../migrations/20261022053100_hagerty_live_board.sql
\set ON_ERROR_STOP on
SELECT pg_temp.ok('a missing job fails the migration and writes nothing',
  NOT EXISTS (SELECT 1 FROM cron.job) AND NOT EXISTS (SELECT 1 FROM public.live_board_houses WHERE house = 'hagerty-marketplace'));
