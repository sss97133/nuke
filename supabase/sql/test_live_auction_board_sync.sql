-- Isolated PostgreSQL regression for live_auction_board_sync: synthetic rows only, never production.
-- Loads the actual migrations 20261019020000 and 20261019021000 (which completes it) and proves: refuses bat; one row per open lot linked to its vehicle by
-- listing_url; bid in cents with the house currency; bid-count moves returned (and not on an unchanged re-read);
-- absent lots leave the schedule only on a complete board; past-end lots leave it; a failed read counts failures;
-- SBX retired; the 5-minute job posts the three houses.
-- Execute in an empty dm_live_board_sync_ci database with no auth schema.
\set ON_ERROR_STOP on
DO $$ BEGIN
 IF current_database() <> 'dm_live_board_sync_ci'
   OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='auth')
   OR EXISTS(SELECT 1 FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind IN ('r','p','v','m')) THEN
 RAISE EXCEPTION 'Refusing fixtures outside isolated DB'; END IF;
END $$;
SET statement_timeout='30s';
SET lock_timeout='3s';
CREATE SCHEMA net;
CREATE SCHEMA cron;
DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE TABLE public.live_auction_sources(id uuid PRIMARY KEY,slug text UNIQUE,scraping_config jsonb DEFAULT '{}',
 default_poll_interval_ms integer,last_successful_sync timestamptz,consecutive_failures integer DEFAULT 0,health_status text,
 last_sync_error text,is_active boolean DEFAULT true,notes text,updated_at timestamptz,
 CHECK (health_status = ANY (ARRAY['healthy','degraded','unhealthy','unknown'])));
CREATE TABLE public.monitored_auctions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),source_id uuid,external_auction_id text,
 external_auction_url text,vehicle_id uuid,auction_end_time timestamptz,is_live boolean,current_bid_cents bigint,bid_count integer,
 priority integer,last_synced_at timestamptz,next_poll_at timestamptz,poll_interval_ms integer,stream_state jsonb DEFAULT '{}',
 UNIQUE(source_id,external_auction_id));
CREATE TABLE public.vehicles(id uuid PRIMARY KEY,listing_url text,deleted_at timestamptz);
CREATE TABLE cron.job(jobid bigint GENERATED ALWAYS AS IDENTITY,jobname text,schedule text,command text);
CREATE FUNCTION cron.unschedule(job_id bigint) RETURNS boolean LANGUAGE sql AS $$ DELETE FROM cron.job WHERE jobid=job_id RETURNING true $$;
CREATE FUNCTION cron.schedule(n text,s text,c text) RETURNS bigint LANGUAGE sql AS $$ INSERT INTO cron.job(jobname,schedule,command) VALUES(n,s,c) RETURNING jobid $$;
CREATE FUNCTION pg_temp.ok(label text,condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %',label; END IF; RAISE NOTICE 'PASS %',label;
END $$;

INSERT INTO public.live_auction_sources(id,slug,default_poll_interval_ms) VALUES
 ('00000000-0000-0000-0000-0000000000b1','bat',60000),
 ('00000000-0000-0000-0000-0000000000c1','collecting-cars',60000),
 ('00000000-0000-0000-0000-0000000000d1','sbx-cars',60000);
INSERT INTO public.vehicles VALUES
 ('00000000-0000-0000-0000-00000000aa01','https://collectingcars.com/for-sale/lot-a',NULL),
 ('00000000-0000-0000-0000-00000000aa02','https://collectingcars.com/for-sale/lot-b',NULL);
-- a February row still marked live, absent from today's board
INSERT INTO public.monitored_auctions(source_id,external_auction_id,external_auction_url,is_live,auction_end_time)
 VALUES('00000000-0000-0000-0000-0000000000c1','old-lot','https://collectingcars.com/for-sale/old-lot',true,now()+interval '1 day'),
       ('00000000-0000-0000-0000-0000000000d1','sbx-1','https://sbxcars.com/listing/1/x',true,NULL);

\ir ../migrations/20261019020000_live_auction_board_sync.sql
\ir ../migrations/20261019021000_live_auction_board_sync_health.sql

DO $$ BEGIN
  PERFORM public.live_auction_board_sync('bat','[]'::jsonb);
  RAISE EXCEPTION 'bat was accepted';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM = 'bat was accepted' THEN RAISE; END IF;
END $$;
SELECT pg_temp.ok('refuses bat', true);

SELECT public.live_auction_board_sync('collecting-cars', jsonb_build_array(
  jsonb_build_object('url','https://collectingcars.com/for-sale/lot-a','external_id','lot-a','ends',(now()+interval '2 hours')::text,
                     'current_bid',120000,'bid_count',36,'currency','eur'),
  jsonb_build_object('url','https://collectingcars.com/for-sale/lot-b','external_id','lot-b','ends',(now()+interval '3 days')::text,
                     'current_bid',null,'bid_count',0,'currency','gbp'),
  jsonb_build_object('url','https://collectingcars.com/for-sale/lot-c','external_id','lot-c','ends',(now()+interval '1 day')::text,
                     'current_bid',5000,'bid_count',2,'currency','gbp'))) AS r \gset first_

SELECT pg_temp.ok('three lots, two linked', (:'first_r'::jsonb->>'lots')::int = 3 AND (:'first_r'::jsonb->>'linked')::int = 2);
SELECT pg_temp.ok('bid in cents, currency kept, vehicle linked',
  (SELECT current_bid_cents = 12000000 AND bid_count = 36 AND stream_state->>'currency' = 'EUR'
          AND vehicle_id = '00000000-0000-0000-0000-00000000aa01' AND is_live AND priority = 1
     FROM monitored_auctions WHERE external_auction_id = 'lot-a'));
SELECT pg_temp.ok('first read returns lots with bids as moved (a and c, not b)',
  (SELECT array_agg(e->>'external_id' ORDER BY e->>'external_id') FROM jsonb_array_elements(:'first_r'::jsonb->'moved') e) = ARRAY['lot-a','lot-c']);
SELECT pg_temp.ok('absent February row leaves the schedule', NOT (SELECT is_live FROM monitored_auctions WHERE external_auction_id = 'old-lot'));
SELECT pg_temp.ok('health recorded', (SELECT health_status = 'healthy' AND consecutive_failures = 0 AND last_successful_sync IS NOT NULL
  AND (scraping_config->'live_board'->'last_run'->>'lots')::int = 3 FROM live_auction_sources WHERE slug = 'collecting-cars'));

-- unchanged re-read: nothing moved; then lot-a takes a bid and lot-c ends; partial board ends nothing absent
SELECT public.live_auction_board_sync('collecting-cars', jsonb_build_array(
  jsonb_build_object('url','https://collectingcars.com/for-sale/lot-a','external_id','lot-a','ends',(now()+interval '2 hours')::text,'current_bid',120000,'bid_count',36,'currency','eur'),
  jsonb_build_object('url','https://collectingcars.com/for-sale/lot-b','external_id','lot-b','ends',(now()+interval '3 days')::text,'current_bid',null,'bid_count',0,'currency','gbp'),
  jsonb_build_object('url','https://collectingcars.com/for-sale/lot-c','external_id','lot-c','ends',(now()+interval '1 day')::text,'current_bid',5000,'bid_count',2,'currency','gbp'))) AS r \gset same_
SELECT pg_temp.ok('unchanged re-read moves nothing', jsonb_array_length(:'same_r'::jsonb->'moved') = 0);

SELECT public.live_auction_board_sync('collecting-cars', jsonb_build_array(
  jsonb_build_object('url','https://collectingcars.com/for-sale/lot-a','external_id','lot-a','ends',(now()+interval '2 hours')::text,'current_bid',125000,'bid_count',37,'currency','eur'),
  jsonb_build_object('url','https://collectingcars.com/for-sale/lot-c','external_id','lot-c','ends',(now()-interval '1 minute')::text,'current_bid',5000,'bid_count',2,'currency','gbp')),
  false) AS r \gset next_
SELECT pg_temp.ok('the bid move is returned with its previous count',
  (SELECT (e->>'prev_bid_count')::int = 36 AND (e->>'bid_count')::int = 37 FROM jsonb_array_elements(:'next_r'::jsonb->'moved') e WHERE e->>'external_id' = 'lot-a'));
SELECT pg_temp.ok('past-end lot leaves the schedule', NOT (SELECT is_live FROM monitored_auctions WHERE external_auction_id = 'lot-c'));
SELECT pg_temp.ok('a partial board ends no absent lot', (SELECT is_live FROM monitored_auctions WHERE external_auction_id = 'lot-b'));

SELECT public.live_auction_board_sync('collecting-cars', NULL, true, 'HTTP 404 Collection not found');
SELECT public.live_auction_board_sync('collecting-cars', NULL, true, 'HTTP 404 Collection not found');
SELECT public.live_auction_board_sync('collecting-cars', NULL, true, 'HTTP 404 Collection not found');
SELECT pg_temp.ok('failed reads count and turn the source unhealthy without touching lots',
  (SELECT consecutive_failures = 3 AND health_status = 'unhealthy' AND last_sync_error LIKE 'HTTP 404%' FROM live_auction_sources WHERE slug = 'collecting-cars')
  AND (SELECT is_live FROM monitored_auctions WHERE external_auction_id = 'lot-a'));

SELECT pg_temp.ok('SBX retired and off the schedule',
  (SELECT NOT is_active AND health_status = 'unknown' FROM live_auction_sources WHERE slug = 'sbx-cars')
  AND NOT (SELECT is_live FROM monitored_auctions WHERE external_auction_id = 'sbx-1'));
SELECT pg_temp.ok('5-minute job posts the three houses',
  (SELECT schedule = '*/5 * * * *' AND command LIKE '%"platforms":["collecting-cars","pcarmarket","bonhams"]%' FROM cron.job WHERE jobname = 'sync-live-auctions-houses'));
SELECT pg_temp.ok('only service_role may execute',
  has_function_privilege('service_role','public.live_auction_board_sync(text,jsonb,boolean,text)','EXECUTE')
  AND NOT has_function_privilege('anon','public.live_auction_board_sync(text,jsonb,boolean,text)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.live_auction_board_sync(text,jsonb,boolean,text)','EXECUTE'));
