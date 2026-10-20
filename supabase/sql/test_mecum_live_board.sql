-- Empty disposable PG17 only, run from the repository root:
--   scripts/ci/run-db-contracts.sh test_mecum_live_board.sql
-- Contract for 20261022050000_mecum_live_board.sql:
--   * end_live_auction_lots ends only auction_live rows of the URLs it is given (with or without a trailing slash): the
--     closing bid goes to high_bid when stated and is kept when not; auction_end_date takes the stated close, else the
--     earlier of the scheduled close and now; sale_price is untouched; rows in other states, deleted rows and unknown URLs
--     are untouched and nothing is inserted; only the service role may call it;
--   * Mecum is an enabled live_board_houses row: a live Mecum lot written without platform_source reaches the board by its link;
--   * the sync-live-auctions-houses job posts 'mecum' once, appended to the platforms it carried (another house's addition
--     kept), the rest of its command unchanged; a second run changes nothing.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.live_board_houses') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;

-- The vehicles columns market_pulse_live_houses and end_live_auction_lots read, typed as production has them
-- (auction_end_date text, high_bid and sale_price integer); live_board_houses from its own migration; cron as pg_cron 1.6.
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

-- Mecum lots as the reader leaves them. 01: live on its run day, landed earlier without platform_source (as the Dallas/Fort
-- Worth lots are), the link with its trailing slash. 02: live, written by the reader (platform_source mecum), a stated bid.
-- 03: already settled (sold). 04: deleted. 05: another house's live lot. 06: upcoming, not live.
INSERT INTO public.vehicles (id, year, make, model, high_bid, sale_price, auction_end_date, auction_status, updated_at, created_at,
  origin_metadata, listing_url, title, sale_status, platform_source, deleted_at)
VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 1955, 'Ford', 'Thunderbird', NULL, NULL, to_char((now() + interval '10 hours') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
   'active', now() - interval '3 minutes', now() - interval '5 days', '{"currency": "USD"}',
   'https://www.mecum.com/lots/1182658/1955-ford-thunderbird-convertible/', '1955 Ford Thunderbird Convertible', 'auction_live', NULL, NULL),
  ('aaaaaaaa-0000-0000-0000-000000000002', 2014, 'Volkswagen', 'Jetta', 100, NULL, to_char((now() + interval '10 hours') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
   'active', now() - interval '3 minutes', now() - interval '1 day', '{"currency": "USD", "no_reserve": true}',
   'https://www.mecum.com/lots/1180508/2014-volkswagen-jetta-sportwagen-tdi/', '2014 Volkswagen Jetta SportWagen TDI', 'auction_live', 'mecum', NULL),
  ('aaaaaaaa-0000-0000-0000-000000000003', 1969, 'Plymouth', 'Barracuda', 31000, 34100, '2026-09-25T05:00:00.000Z',
   'ended', now() - interval '20 days', now() - interval '40 days', '{}',
   'https://www.mecum.com/lots/1177898/1969-plymouth-barracuda-formula-s-fastback/', NULL, 'sold', NULL, NULL),
  ('aaaaaaaa-0000-0000-0000-000000000004', 1950, 'Ford', 'Custom Deluxe', NULL, NULL, '2026-10-22T05:00:00.000Z',
   'active', now(), now(), '{}', 'https://www.mecum.com/lots/1175178/1950-ford-custom-deluxe/', NULL, 'auction_live', 'mecum', now()),
  ('aaaaaaaa-0000-0000-0000-000000000005', 1994, 'Porsche', '911', 44694, NULL, to_char((now() + interval '2 days') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
   'active', now(), now(), '{"currency": "GBP"}', 'https://collectingcars.com/for-sale/a', NULL, 'auction_live', 'collecting-cars', NULL),
  ('aaaaaaaa-0000-0000-0000-000000000006', 1959, 'Chevrolet', 'El Camino', NULL, NULL, NULL,
   NULL, now(), now(), '{}', 'https://www.mecum.com/lots/1184367/1959-chevrolet-el-camino/', NULL, 'available', NULL, NULL);

SELECT pg_temp.ok('before the migration no Mecum lot is on the board',
  NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.market_pulse_live_houses()->'auctions') a WHERE a->>10 ~ 'mecum\.com'));

\ir ../migrations/20261022050000_mecum_live_board.sql

SELECT pg_temp.ok('Mecum is an enabled board house',
  (SELECT enabled AND label = 'Mecum Auctions' FROM public.live_board_houses WHERE house = 'mecum'));
SELECT pg_temp.ok('both live Mecum lots reach the board, the one without platform_source by its link, in USD',
  (SELECT count(*) = 2 AND bool_and(a->>12 = 'mecum' AND a->>13 = 'USD')
     FROM jsonb_array_elements(public.market_pulse_live_houses()->'auctions') a WHERE a->>10 ~ 'mecum\.com'));
SELECT pg_temp.ok('the upcoming lot is not on the board',
  NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.market_pulse_live_houses()->'auctions') a WHERE a->>0 = 'aaaaaaaa-0000-0000-0000-000000000006'));

SELECT pg_temp.ok('the job posts mecum once, after the houses it carried, with the rest of its command unchanged',
  (SELECT command LIKE '%"platforms": ["collecting-cars", "pcarmarket", "bonhams", "hagerty-marketplace", "mecum"]%'
     AND command LIKE '%"platform": "collecting-cars"%'
     AND regexp_replace(command, $re$body := '[^']*'::jsonb$re$, '') = regexp_replace((SELECT command FROM before), $re$body := '[^']*'::jsonb$re$, '')
     FROM cron.job WHERE jobname = 'sync-live-auctions-houses'));

-- end_live_auction_lots: 01 crossed with a hammer bid (given without the trailing slash), 02 crossed with none stated, 03 settled,
-- 04 deleted, 06 not live, plus a URL no row has; 05 (another house) is not named.
SELECT public.end_live_auction_lots(jsonb_build_array(
  jsonb_build_object('url', 'https://www.mecum.com/lots/1182658/1955-ford-thunderbird-convertible', 'closing_bid', 42000),
  jsonb_build_object('url', 'https://www.mecum.com/lots/1180508/2014-volkswagen-jetta-sportwagen-tdi/', 'closing_bid', NULL),
  jsonb_build_object('url', 'https://www.mecum.com/lots/1177898/1969-plymouth-barracuda-formula-s-fastback/', 'closing_bid', 1),
  jsonb_build_object('url', 'https://www.mecum.com/lots/1175178/1950-ford-custom-deluxe/', 'closing_bid', 5),
  jsonb_build_object('url', 'https://www.mecum.com/lots/1184367/1959-chevrolet-el-camino/', 'closing_bid', 7),
  jsonb_build_object('url', 'https://www.mecum.com/lots/9999999/never-landed/', 'closing_bid', 9, 'ended_at', '2026-10-21T18:00:00.000Z')
)) AS ended \gset
SELECT pg_temp.ok('two live rows ended', :ended = 2);
SELECT pg_temp.ok('a crossed lot named without its trailing slash ends with its hammer bid, and its end is no later than now',
  (SELECT sale_status = 'ended' AND auction_status = 'ended' AND high_bid = 42000 AND sale_price IS NULL
          AND auction_end_date::timestamptz <= now() FROM public.vehicles WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001'));
SELECT pg_temp.ok('a crossed lot with no closing bid stated keeps the bid it had',
  (SELECT sale_status = 'ended' AND high_bid = 100 FROM public.vehicles WHERE id = 'aaaaaaaa-0000-0000-0000-000000000002'));
SELECT pg_temp.ok('settled, deleted, upcoming and unnamed rows are untouched; nothing is inserted',
  (SELECT sale_status = 'sold' AND high_bid = 31000 AND sale_price = 34100 AND auction_end_date = '2026-09-25T05:00:00.000Z'
     FROM public.vehicles WHERE id = 'aaaaaaaa-0000-0000-0000-000000000003')
  AND (SELECT sale_status = 'auction_live' AND high_bid IS NULL FROM public.vehicles WHERE id = 'aaaaaaaa-0000-0000-0000-000000000004')
  AND (SELECT sale_status = 'available' AND high_bid IS NULL FROM public.vehicles WHERE id = 'aaaaaaaa-0000-0000-0000-000000000006')
  AND (SELECT sale_status = 'auction_live' FROM public.vehicles WHERE id = 'aaaaaaaa-0000-0000-0000-000000000005')
  AND (SELECT count(*) = 6 FROM public.vehicles));
SELECT pg_temp.ok('ended Mecum lots leave the board; the other house stays',
  NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.market_pulse_live_houses()->'auctions') a WHERE a->>10 ~ 'mecum\.com')
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(public.market_pulse_live_houses()->'auctions') a WHERE a->>12 = 'collecting-cars'));

-- A stated close time is kept as stated.
UPDATE public.vehicles SET sale_status = 'auction_live', auction_status = 'active' WHERE id = 'aaaaaaaa-0000-0000-0000-000000000002';
SELECT public.end_live_auction_lots('[{"url": "https://www.mecum.com/lots/1180508/2014-volkswagen-jetta-sportwagen-tdi/", "closing_bid": 2500, "ended_at": "2026-10-21T16:12:00.000Z"}]'::jsonb) AS ended2 \gset
SELECT pg_temp.ok('a stated close time and closing bid are written as stated',
  :ended2 = 1 AND (SELECT auction_end_date = '2026-10-21T16:12:00.000Z' AND high_bid = 2500 FROM public.vehicles WHERE id = 'aaaaaaaa-0000-0000-0000-000000000002'));
SELECT pg_temp.ok('an empty or null list ends nothing',
  public.end_live_auction_lots('[]'::jsonb) = 0 AND public.end_live_auction_lots(NULL) = 0);

SELECT pg_temp.ok('only the service role may end lots',
  has_function_privilege('service_role', 'public.end_live_auction_lots(jsonb)', 'execute')
  AND NOT has_function_privilege('anon', 'public.end_live_auction_lots(jsonb)', 'execute')
  AND NOT has_function_privilege('authenticated', 'public.end_live_auction_lots(jsonb)', 'execute'));

\ir ../migrations/20261022050000_mecum_live_board.sql
SELECT pg_temp.ok('a second run changes nothing',
  (SELECT command LIKE '%"hagerty-marketplace", "mecum"]%' AND command NOT LIKE '%"mecum", "mecum"%' FROM cron.job)
  AND (SELECT count(*) = 1 FROM public.live_board_houses WHERE house = 'mecum'));
