-- Empty disposable PG17 only, run from the repository root:
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_broad_arrow_board -f supabase/sql/test_broad_arrow_live_board.sql
-- Contract for 20261022045200_broad_arrow_live_board.sql: Broad Arrow is an enabled live_board_houses row whose pattern
-- matches its bidding-site and catalog links; a lot as syncBroadArrow writes it reaches the board in its own currency;
-- the sync-live-auctions-houses job posts 'broad-arrow' once, appended to the platforms it already carried (another
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
GRANT SELECT ON public.vehicles, public.canonical_makes TO anon, authenticated;
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

-- The job as live on 2026-10-20, plus a house another reader's migration appended.
INSERT INTO cron.job (jobname, schedule, command) VALUES ('sync-live-auctions-houses', '*/5 * * * *', $cmd$
  SELECT net.http_post(
    url := get_service_url() || '/functions/v1/sync-live-auctions',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || get_service_role_key_for_cron()),
    body := '{"action":"sync","platform":"collecting-cars","platforms":["collecting-cars","pcarmarket","bonhams","hagerty-marketplace"]}'::jsonb,
    timeout_milliseconds := 150000
  );
$cmd$);
CREATE TEMP TABLE before AS SELECT command FROM cron.job;
-- A lot as syncBroadArrow writes it (upsert_live_auction_vehicles): its bidding-page link, platform_source, EUR, a live
-- end. Values from lot 107 of Global Icons: Zoute Online 2026 as its lot list read on 2026-10-20 (top bid 125,000 EUR);
-- the end is moved into the future so the lot reads as open. A Broad Arrow catalog row of an in-room sale ('upcoming')
-- stays off the board.
INSERT INTO public.vehicles (id, year, make, model, high_bid, sale_price, auction_end_date, updated_at, created_at, primary_image_url,
  origin_metadata, listing_url, title, sale_status, platform_source)
VALUES
  ('baaaaaaa-0000-0000-0000-000000000107', 2005, 'Ferrari', '575M Maranello', NULL, 125000, now() + interval '1 day', now(), now(),
   'https://images-cdn.auctionmobility.com/is3/auctionmobility-static/dL9y-1-5M3B07/1-DHWN7F/ee017a95-034c-4123-9b92-26b31d8e6585',
   '{"currency": "EUR", "no_reserve": false, "reserve_met": true, "bid_count": null}',
   'https://bid.broadarrowauctions.com/lots/view/1-DH4AXO/2005-ferrari-575m-maranello', '2005 Ferrari 575M Maranello',
   'auction_live', 'broad-arrow'),
  ('baaaaaaa-0000-0000-0000-000000000006', 2003, 'Ferrari', 'Enzo', NULL, NULL, now() + interval '11 days', now(), now(), NULL,
   NULL, 'https://www.broadarrowauctions.com/vehicles/lv26_r0006/2003-ferrari-enzo', NULL, 'upcoming', NULL);
SELECT pg_temp.ok('before the migration the Broad Arrow lot is not on the board',
  jsonb_array_length(public.market_pulse_live_houses()->'auctions') = 0);

\ir ../migrations/20261022045200_broad_arrow_live_board.sql
\ir ../migrations/20261022045200_broad_arrow_live_board.sql

SELECT pg_temp.ok('Broad Arrow is an enabled house matched by its bidding-site and catalog links only',
  (SELECT enabled AND label = 'Broad Arrow'
          AND 'https://bid.broadarrowauctions.com/lots/view/1-DH4AXO/2005-ferrari-575m-maranello' ~* host_pattern
          AND 'https://www.broadarrowauctions.com/vehicles/lv26_r0006/2003-ferrari-enzo' ~* host_pattern
          AND 'https://www.broadarrowprivatesales.com/vehicles' !~* host_pattern
   FROM public.live_board_houses WHERE house = 'broad-arrow'));
SELECT pg_temp.ok('other houses are untouched', (SELECT NOT enabled FROM public.live_board_houses WHERE house = 'bonhams')
  AND (SELECT count(*) FROM public.live_board_houses WHERE enabled) = 4);
SELECT pg_temp.ok('the open lot is on the board under its house, label, bid and currency; the catalog row is not',
  (SELECT jsonb_array_length(j->'auctions') = 1 AND j->'auctions'->0->>12 = 'broad-arrow'
          AND (j->'auctions'->0->>4)::numeric = 125000 AND j->'auctions'->0->>13 = 'EUR'
          AND j->'houses' @> '[{"house": "broad-arrow", "label": "Broad Arrow", "lots": 1, "on_board": true}]'::jsonb
   FROM (SELECT public.market_pulse_live_houses() AS j) b));
SELECT pg_temp.ok('the job posts broad-arrow once, after the platforms it carried',
  (SELECT substring(command FROM $re$body := '(\{[^']*\})'::jsonb$re$)::jsonb -> 'platforms'
          = '["collecting-cars","pcarmarket","bonhams","hagerty-marketplace","broad-arrow"]'::jsonb FROM cron.job));
SELECT pg_temp.ok('the rest of the job command is unchanged',
  (SELECT regexp_replace(j.command, $re$body := '[^']*'$re$, '') = regexp_replace(b.command, $re$body := '[^']*'$re$, '')
          AND j.schedule = '*/5 * * * *' FROM cron.job j, before b));

-- A disabled row is switched on.
UPDATE public.live_board_houses SET enabled = false WHERE house = 'broad-arrow';
\ir ../migrations/20261022045200_broad_arrow_live_board.sql
SELECT pg_temp.ok('a disabled Broad Arrow row is enabled again', (SELECT enabled FROM public.live_board_houses WHERE house = 'broad-arrow'));

SET ROLE anon;
SELECT jsonb_array_length(public.market_pulse_live_houses()->'auctions') AS anon_lots \gset
RESET ROLE;
SELECT pg_temp.ok('a visitor reads the Broad Arrow lot', :'anon_lots'::int = 1);

-- Without the job the migration refuses instead of scheduling nothing.
DELETE FROM cron.job;
DELETE FROM public.live_board_houses WHERE house = 'broad-arrow';
\set ON_ERROR_STOP off
\ir ../migrations/20261022045200_broad_arrow_live_board.sql
\set ON_ERROR_STOP on
SELECT pg_temp.ok('a missing job fails the migration and writes nothing',
  NOT EXISTS (SELECT 1 FROM cron.job) AND NOT EXISTS (SELECT 1 FROM public.live_board_houses WHERE house = 'broad-arrow'));
