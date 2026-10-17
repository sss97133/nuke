-- Empty disposable PG17 only, run from the repository root:
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_pulse_snapshot -f supabase/sql/test_market_pulse_live_snapshot.sql
-- Contract for 20261016171000_market_pulse_live_snapshot.sql, on test_market_pulse_live_heat.sql's fixture (two live
-- lots, the v3 board). Requires: market_pulse_live_build is the previous definition byte for byte; with no snapshot
-- the board is built now as before; the refresh stores the build with its time and duration; a fresh snapshot is
-- served instead of a rebuild, minus lots that ended since it was built; a snapshot five minutes old falls back to a
-- live build; a visitor reads the board and the snapshot but cannot write it or run the refresh; the cron job is
-- registered once; a second apply is a no-op and a drifted market_pulse_live stops the migration unchanged.
\set ON_ERROR_STOP on
\ir test_market_pulse_live_heat.sql

CREATE SCHEMA IF NOT EXISTS cron;
CREATE TABLE IF NOT EXISTS cron.job (jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text, command text,
  active boolean DEFAULT true);
CREATE OR REPLACE FUNCTION cron.schedule(p_name text, p_schedule text, p_command text) RETURNS bigint LANGUAGE sql AS
$$ INSERT INTO cron.job (jobname, schedule, command) VALUES (p_name, p_schedule, p_command) RETURNING jobid $$;
CREATE OR REPLACE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;

\ir ../migrations/20261016171000_market_pulse_live_snapshot.sql
\ir ../migrations/20261016171000_market_pulse_live_snapshot.sql

SELECT pg_temp.ok('the build is the previous market_pulse_live, byte for byte',
  (SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'base64') FROM pg_proc
    WHERE oid = 'public.market_pulse_live_build()'::regprocedure) = 'ImO7ZyF0Hg93xU45isnTnx3V+FlIRlqfYhX4Q+Rx4F8=');
BEGIN;
SELECT pg_temp.ok('with no snapshot the board is built now, as before',
  NOT EXISTS (SELECT 1 FROM public.market_pulse_live_snapshot)
  AND public.market_pulse_live() = public.market_pulse_live_build()
  AND jsonb_array_length(public.market_pulse_live()->'auctions') = 2);
COMMIT;

BEGIN;
SELECT public.refresh_market_pulse_live_snapshot()::text AS refreshed \gset
SELECT pg_temp.ok('the refresh stores the build with its time and duration',
  (SELECT count(*) FROM public.market_pulse_live_snapshot) = 1
  AND (SELECT payload = public.market_pulse_live_build() AND built_at = now() AND build_ms >= 0
       FROM public.market_pulse_live_snapshot)
  AND (:'refreshed')::jsonb->'auctions' = '2'::jsonb);
COMMIT;

-- A third lot goes live after the build: the fresh snapshot is served, not rebuilt.
INSERT INTO public.vehicles (id, year, make, model, high_bid, auction_end_date, updated_at, created_at, listing_url,
  title, sale_status, platform_source)
VALUES ('aaaaaaaa-0000-0000-0000-000000000003', 1967, 'Ford', 'Mustang', 30000, now() + interval '3 hours', now(),
  now() - interval '1 day', 'https://bringatrailer.com/listing/three/', '1967 Ford Mustang', 'auction_live', 'bringatrailer');
SELECT pg_temp.ok('a fresh snapshot is served instead of a rebuild',
  jsonb_array_length(public.market_pulse_live()->'auctions') = 2
  AND jsonb_array_length(public.market_pulse_live_build()->'auctions') = 3
  AND (public.market_pulse_live() - 'auctions') = ((SELECT payload FROM public.market_pulse_live_snapshot) - 'auctions'));

-- A lot in the snapshot that has ended since the build is dropped from what the snapshot serves.
UPDATE public.market_pulse_live_snapshot
   SET payload = jsonb_set(payload, '{auctions,0,5}', to_jsonb(now() - interval '1 minute'));
SELECT pg_temp.ok('lots that ended since the build are dropped, the rest keep their order and slots',
  jsonb_array_length(public.market_pulse_live()->'auctions') = 1
  AND public.market_pulse_live()->'auctions'->0->>0 = 'aaaaaaaa-0000-0000-0000-000000000002'
  AND jsonb_array_length(public.market_pulse_live()->'auctions'->0) = 18);

-- Five minutes old: the board is built now again.
UPDATE public.market_pulse_live_snapshot SET built_at = now() - interval '5 minutes 1 second';
BEGIN;
SELECT pg_temp.ok('a snapshot five minutes old falls back to a build now (the third lot shows)',
  public.market_pulse_live() = public.market_pulse_live_build()
  AND jsonb_array_length(public.market_pulse_live()->'auctions') = 3);
COMMIT;

-- A visitor.
SELECT public.refresh_market_pulse_live_snapshot() IS NOT NULL AS refreshed_again \gset
SET ROLE anon;
SELECT jsonb_array_length(public.market_pulse_live()->'auctions') AS anon_lots,
       (SELECT count(*) FROM public.market_pulse_live_snapshot) AS anon_rows \gset
RESET ROLE;
SELECT pg_temp.ok('a visitor reads the board from the snapshot',
  :'anon_lots'::int = 3 AND :'anon_rows'::int = 1);
SELECT pg_temp.ok('a visitor cannot write the snapshot or run the refresh; service_role can refresh',
  NOT has_table_privilege('anon', 'public.market_pulse_live_snapshot', 'INSERT')
  AND NOT has_table_privilege('anon', 'public.market_pulse_live_snapshot', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.market_pulse_live_snapshot', 'DELETE')
  AND NOT has_function_privilege('anon', 'public.refresh_market_pulse_live_snapshot()', 'execute')
  AND NOT has_function_privilege('authenticated', 'public.refresh_market_pulse_live_snapshot()', 'execute')
  AND has_function_privilege('service_role', 'public.refresh_market_pulse_live_snapshot()', 'execute')
  AND has_function_privilege('anon', 'public.market_pulse_live()', 'execute')
  AND has_function_privilege('anon', 'public.market_pulse_live_build()', 'execute'));
SELECT pg_temp.ok('the refresh job is registered once, every two minutes, bounded at 90 s',
  (SELECT count(*) FROM cron.job WHERE jobname = 'refresh-market-pulse-live') = 1
  AND (SELECT schedule = '*/2 * * * *' AND command LIKE '%statement_timeout = ''90s''%refresh_market_pulse_live_snapshot()%'
       FROM cron.job WHERE jobname = 'refresh-market-pulse-live'));

-- A drifted market_pulse_live stops the migration and stays as it was.
CREATE OR REPLACE FUNCTION public.market_pulse_live() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{"drifted": true}'::jsonb $$;
\set ON_ERROR_STOP off
\ir ../migrations/20261016171000_market_pulse_live_snapshot.sql
\set ON_ERROR_STOP on
SELECT pg_temp.ok('a drifted market_pulse_live stops the migration unchanged',
  public.market_pulse_live() = '{"drifted": true}'::jsonb);
