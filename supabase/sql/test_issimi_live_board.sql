-- Empty disposable PG17 only, run from the repository root:
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_issimi_board -f supabase/sql/test_issimi_live_board.sql
-- Contract for 20261022053400_issimi_live_board.sql: ISSIMI is an enabled live_board_houses row whose lots
-- reach market_pulse_live_houses; the sync-live-auctions-houses job posts 'issimi' once, appended to the platforms it
-- already carried, the rest of its command unchanged; a second run changes nothing; a missing job fails it.
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

-- The job as live on 2026-10-20 (jobid 628).
INSERT INTO cron.job (jobname, schedule, command) VALUES ('sync-live-auctions-houses', '*/5 * * * *', $cmd$
  SELECT net.http_post(
    url := get_service_url() || '/functions/v1/sync-live-auctions',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || get_service_role_key_for_cron()),
    body := '{"action":"sync","platform":"collecting-cars","platforms":["collecting-cars","pcarmarket","bonhams"]}'::jsonb,
    timeout_milliseconds := 150000
  );
$cmd$);
CREATE TEMP TABLE before AS SELECT command FROM cron.job;
-- A lot as syncIssimi would write it: the house's last timed auction (closed 2026-06-18), its close moved a day ahead.
INSERT INTO public.vehicles (id, year, make, model, high_bid, auction_end_date, updated_at, created_at, origin_metadata, listing_url, title,
  sale_status, platform_source)
VALUES ('bbbbbbbb-0000-0000-0000-000000000001', 2022, 'Porsche', 'Taycan Turbo S', 94600, now() + interval '1 day', now(), now(),
  '{"currency": "USD", "no_reserve": false, "bid_count": null}', 'https://www.issimi.com/vehicles/2022-porsche-taycan-turbo-s',
  '2022 Porsche Taycan Turbo S', 'auction_live', 'issimi');
SELECT pg_temp.ok('before the migration the ISSIMI lot is not on the board', jsonb_array_length(public.market_pulse_live_houses()->'auctions') = 0);

\ir ../migrations/20261022053400_issimi_live_board.sql
\ir ../migrations/20261022053400_issimi_live_board.sql

SELECT pg_temp.ok('the ISSIMI lot is on the board under its house, label, bid and currency',
  (SELECT j->'auctions'->0->>12 = 'issimi' AND (j->'auctions'->0->>4)::numeric = 94600 AND j->'auctions'->0->>13 = 'USD'
          AND j->'houses' @> '[{"house": "issimi", "label": "ISSIMI", "lots": 1, "on_board": true}]'::jsonb
   FROM (SELECT public.market_pulse_live_houses() AS j) b));
SELECT pg_temp.ok('the job posts issimi once, after the platforms it carried, the rest unchanged',
  (SELECT substring(j.command FROM $re$body := '(\{[^']*\})'::jsonb$re$)::jsonb -> 'platforms'
          = '["collecting-cars","pcarmarket","bonhams","issimi"]'::jsonb
          AND regexp_replace(j.command, $re$body := '[^']*'$re$, '') = regexp_replace(b.command, $re$body := '[^']*'$re$, '')
   FROM cron.job j, before b));

DELETE FROM cron.job;
DELETE FROM public.live_board_houses WHERE house = 'issimi';
\set ON_ERROR_STOP off
\ir ../migrations/20261022053400_issimi_live_board.sql
\set ON_ERROR_STOP on
SELECT pg_temp.ok('a missing job fails the migration and writes nothing',
  NOT EXISTS (SELECT 1 FROM public.live_board_houses WHERE house = 'issimi'));
