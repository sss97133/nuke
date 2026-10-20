-- Empty disposable PG17 only, run from the repository root:
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_uwa_houses -f supabase/sql/test_live_board_uwa_houses.sql
-- Contract for 20261022050500_live_board_uwa_houses.sql: the sync-live-auctions-houses job gains both plugin houses
-- and keeps every platform it already posted, in order, with the rest of its command unchanged; a re-run adds nothing;
-- Iconic declares its source species; each house has an active live_auction_sources row and an enabled live_board_houses
-- row whose host pattern names its lot pages and no other house's.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.live_board_houses') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;

CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid bigint GENERATED ALWAYS AS IDENTITY, jobname text, schedule text, command text, active boolean DEFAULT true);
CREATE FUNCTION cron.alter_job(job_id bigint, schedule text DEFAULT NULL, command text DEFAULT NULL, database text DEFAULT NULL,
                               username text DEFAULT NULL, active boolean DEFAULT NULL) RETURNS void LANGUAGE sql AS $$
  UPDATE cron.job SET schedule = coalesce(alter_job.schedule, job.schedule), command = coalesce(alter_job.command, job.command),
                      active = coalesce(alter_job.active, job.active)
  WHERE jobid = job_id $$;
CREATE TABLE public.live_auction_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text UNIQUE NOT NULL, display_name text NOT NULL, base_url text NOT NULL,
  sync_method text NOT NULL DEFAULT 'polling_scrape', default_poll_interval_ms integer, auction_duration_typical text,
  has_soft_close boolean, is_active boolean DEFAULT true, health_status text DEFAULT 'unknown', notes text,
  CHECK (health_status = ANY (ARRAY['healthy', 'degraded', 'unhealthy', 'unknown'])));
CREATE TABLE public.live_board_houses (house text PRIMARY KEY, label text NOT NULL, host_pattern text, enabled boolean NOT NULL DEFAULT false, note text);
-- observation_sources as live: the species enum and the evidence check (20261019050000_source_species.sql)
CREATE TYPE public.source_species AS ENUM ('timed_auction', 'block_house', 'dealer', 'classifieds', 'auth_walled_marketplace',
  'aggregator', 'media_forum_video', 'private_seller', 'owner_private');
CREATE TABLE public.observation_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text UNIQUE NOT NULL, display_name text NOT NULL, category text NOT NULL,
  base_url text, notes text, species public.source_species, species_set public.source_species[], species_evidence jsonb,
  CONSTRAINT observation_sources_species_evidenced CHECK (((species IS NULL) OR COALESCE(((species = ANY (species_set))
    AND (jsonb_typeof(species_evidence) = 'object'::text) AND (jsonb_typeof((species_evidence -> 'examined'::text)) = 'array'::text)
    AND (jsonb_array_length((species_evidence -> 'examined'::text)) > 0) AND (length(COALESCE((species_evidence ->> 'seen'::text), ''::text)) > 0)
    AND (COALESCE((species_evidence ->> 'examined_at'::text), ''::text) ~ '^\d{4}-\d{2}-\d{2}'::text)), false))));
INSERT INTO public.live_board_houses VALUES
  ('collecting-cars', 'Collecting Cars', '^https?://([a-z0-9-]+\.)*collectingcars\.com/', true, NULL),
  ('pcarmarket', 'PCarMarket', '^https?://([a-z0-9-]+\.)*pcarmarket\.com/', true, NULL);
CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;
CREATE FUNCTION pg_temp.job_body() RETURNS jsonb LANGUAGE sql AS $$
  SELECT substring(command FROM $re$body := '(\{[^']*\})'::jsonb$re$)::jsonb FROM cron.job WHERE jobname = 'sync-live-auctions-houses' $$;

-- the job as 20261019021000 scheduled it (live on 2026-10-20), plus a platform another reader's migration added
INSERT INTO cron.job (jobname, schedule, command) VALUES ('sync-live-auctions-houses', '*/5 * * * *', $job$
  SELECT net.http_post(
    url := get_service_url() || '/functions/v1/sync-live-auctions',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || get_service_role_key_for_cron()),
    body := '{"action":"sync","platform":"collecting-cars","platforms":["collecting-cars","pcarmarket","bonhams","the-market"]}'::jsonb,
    timeout_milliseconds := 150000
  );
$job$);
-- an unrelated job is untouched
INSERT INTO cron.job (jobname, schedule, command) VALUES ('other-job', '0 * * * *', 'SELECT 1');

\ir ../migrations/20261022050500_live_board_uwa_houses.sql

SELECT pg_temp.ok('job posts the plugin houses after every platform it already posted',
  pg_temp.job_body() -> 'platforms' = '["collecting-cars","pcarmarket","bonhams","the-market","allcollectorcars","iconic-motorbike-auctions"]'::jsonb);
SELECT pg_temp.ok('job keeps its action and single-platform fallback',
  pg_temp.job_body() - 'platforms' = '{"action":"sync","platform":"collecting-cars"}'::jsonb);
SELECT pg_temp.ok('job keeps its url, auth header, timeout and schedule',
  (SELECT command LIKE '%get_service_url() || ''/functions/v1/sync-live-auctions''%'
      AND command LIKE '%get_service_role_key_for_cron()%' AND command LIKE '%timeout_milliseconds := 150000%'
      AND schedule = '*/5 * * * *' AND active
   FROM cron.job WHERE jobname = 'sync-live-auctions-houses'));
SELECT pg_temp.ok('other jobs untouched', (SELECT command FROM cron.job WHERE jobname = 'other-job') = 'SELECT 1');
SELECT pg_temp.ok('live_auction_sources rows active, five-minute poll',
  (SELECT count(*) FROM public.live_auction_sources
   WHERE slug IN ('allcollectorcars', 'iconic-motorbike-auctions') AND is_active AND default_poll_interval_ms = 300000) = 2);
SELECT pg_temp.ok('Iconic declares its species with evidence before its rows land',
  (SELECT species = 'timed_auction' AND species_evidence ->> 'examined_at' = '2026-10-20' FROM public.observation_sources
   WHERE slug = 'iconic-motorbike-auctions'));
SELECT pg_temp.ok('houses enabled on the board',
  (SELECT count(*) FROM public.live_board_houses WHERE house IN ('allcollectorcars', 'iconic-motorbike-auctions') AND enabled) = 2);
SELECT pg_temp.ok('host patterns name each house''s lot pages',
  'https://www.allcollectorcars.com/classic-car-auctions/vehicles/1969-plymouth-road-runner'
    ~* (SELECT host_pattern FROM public.live_board_houses WHERE house = 'allcollectorcars')
  AND 'https://iconicmotorbikeauctions.com/auction/1991-bimota-yb10-dieci-4'
    ~* (SELECT host_pattern FROM public.live_board_houses WHERE house = 'iconic-motorbike-auctions'));
SELECT pg_temp.ok('host patterns claim no other site',
  NOT 'https://www.allcollectorcars.com/' ~* (SELECT host_pattern FROM public.live_board_houses WHERE house = 'allcollectorcars')
  AND NOT 'https://www.iconicauctioneers.com/1976-yamaha-tt500c-rec17761-1-nec-1126'
    ~* (SELECT host_pattern FROM public.live_board_houses WHERE house = 'iconic-motorbike-auctions')
  AND NOT 'https://collectingcars.com/for-sale/x'
    ~* (SELECT host_pattern FROM public.live_board_houses WHERE house = 'iconic-motorbike-auctions'));

-- a re-run (CI replay) adds nothing and re-enables a house switched off
UPDATE public.live_board_houses SET enabled = false WHERE house = 'allcollectorcars';
\ir ../migrations/20261022050500_live_board_uwa_houses.sql
SELECT pg_temp.ok('re-run keeps one entry per platform',
  pg_temp.job_body() -> 'platforms' = '["collecting-cars","pcarmarket","bonhams","the-market","allcollectorcars","iconic-motorbike-auctions"]'::jsonb);
SELECT pg_temp.ok('re-run re-enables the house', (SELECT enabled FROM public.live_board_houses WHERE house = 'allcollectorcars'));
SELECT pg_temp.ok('re-run keeps one source row per house',
  (SELECT count(*) FROM public.live_auction_sources WHERE slug IN ('allcollectorcars', 'iconic-motorbike-auctions')) = 2);
