-- Isolated PostgreSQL 17 regression for bat_live_pull_run's slot allocation: synthetic rows only, never production.
-- Loads the actual migration 20261006060000 and proves: slot count from config (default 6, p_lots override), closing-window
-- lots capped at one slot and not leaking through the first-read reserve or the rest queue, and the unchanged pacing guards.
-- Execute in an empty dm_bat_live_pull_slots_ci database with no auth schema.
\set ON_ERROR_STOP on
DO $$ BEGIN
 IF current_database() <> 'dm_bat_live_pull_slots_ci'
   OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='auth')
   OR EXISTS(SELECT 1 FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind IN ('r','p','v','m')) THEN
 RAISE EXCEPTION 'Refusing fixtures outside isolated DB'; END IF;
END $$;
SET statement_timeout='30s';
SET lock_timeout='3s';
CREATE SCHEMA net;
CREATE SCHEMA cron;
CREATE TABLE public.live_auction_sources(id uuid PRIMARY KEY,slug text UNIQUE,scraping_config jsonb DEFAULT '{}',
 last_successful_sync timestamptz,consecutive_failures integer DEFAULT 0,health_status text,last_sync_error text);
CREATE TABLE public.monitored_auctions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),source_id uuid,external_auction_id text,
 external_auction_url text,vehicle_id uuid,auction_end_time timestamptz,is_live boolean,current_bid_cents bigint,priority integer,
 last_synced_at timestamptz,next_poll_at timestamptz,poll_interval_ms integer,last_comment_count integer,
 last_comment_synced_at timestamptz,sync_latency_ms integer,stream_state jsonb DEFAULT '{}',UNIQUE(source_id,external_auction_id));
CREATE TABLE public.auction_events(vehicle_id uuid,source_url text,updated_at timestamptz,auction_end_date timestamptz,outcome text);
CREATE TABLE public.auction_comments(vehicle_id uuid);
CREATE TABLE public.vehicles(id uuid PRIMARY KEY,high_bid numeric,auction_end_date text,listing_url text,sale_status text,
 platform_source text,deleted_at timestamptz,origin_metadata jsonb);
CREATE TABLE public.vehicle_events(vehicle_id uuid,source_platform text,event_type text,ended_at timestamptz,source_url text,
 current_price numeric,updated_at timestamptz);
CREATE TABLE net.calls(id bigint GENERATED ALWAYS AS IDENTITY,body jsonb);
CREATE TABLE net._http_response(id bigint,timed_out boolean,status_code integer,created timestamptz);
CREATE FUNCTION net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE i bigint; BEGIN INSERT INTO net.calls(body) VALUES(body) RETURNING id INTO i; RETURN i; END $$;
CREATE FUNCTION net.http_get(url text,headers jsonb,timeout_milliseconds integer) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE i bigint; BEGIN INSERT INTO net.calls(body) VALUES('{"probe":true}') RETURNING id INTO i; RETURN i; END $$;
CREATE FUNCTION public.get_service_role_key_for_cron() RETURNS text LANGUAGE sql AS $$ SELECT 'fixture-key' $$;
CREATE FUNCTION public.get_service_url() RETURNS text LANGUAGE sql AS $$ SELECT 'https://fixture.invalid' $$;
CREATE TABLE cron.job(jobid bigint,jobname text,schedule text,active boolean,command text);
CREATE FUNCTION cron.alter_job(job_id bigint,schedule text DEFAULT NULL,command text DEFAULT NULL,database text DEFAULT NULL,
 username text DEFAULT NULL,active boolean DEFAULT NULL) RETURNS void LANGUAGE sql AS $$
 UPDATE cron.job SET schedule=coalesce(alter_job.schedule,job.schedule),command=coalesce(alter_job.command,job.command),
  active=coalesce(alter_job.active,job.active) WHERE jobid=job_id $$;
CREATE FUNCTION pg_temp.ok(label text,condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %',label; END IF; RAISE NOTICE 'PASS %',label;
END $$;

-- Production shape before the migration (2026-10-06): lots_per_run 3 present but unread, cron passes 3.
INSERT INTO public.live_auction_sources(id,slug,scraping_config) VALUES('00000000-0000-0000-0000-0000000000b1','bat',
 '{"live_pull":{"reader":"extract-bat-core","lots_per_run":3,"cadence_minutes":{"under_12h":60,"h12_to_48":360,"over_48h":1440},
   "pause_rest_p50_ms":2000,"reserve_first_read":1,"priority_window_hours":48,"rest_probes":[],"last_run":{}}}');
INSERT INTO cron.job VALUES(510,'bat-live-pull','* * * * *',true,
 $c$SELECT set_config('app.writer', 'bat-live-pull', true); SET statement_timeout = '50s'; SELECT public.bat_live_pull_run(3);$c$);

\ir ../migrations/20261006060000_bat_live_pull_closing_slot_cap.sql

SELECT pg_temp.ok('config carries lots_per_run 6 and closing_slots 1',
 (SELECT scraping_config#>>'{live_pull,lots_per_run}'='6' AND scraping_config#>>'{live_pull,closing_slots}'='1'
  AND scraping_config#>>'{live_pull,cadence_minutes,h12_to_48}'='360' FROM public.live_auction_sources WHERE slug='bat'));
SELECT pg_temp.ok('cron stops hardcoding the slot count and keeps writer and timeout',
 (SELECT command LIKE '%bat_live_pull_run();' AND command LIKE '%app.writer%bat-live-pull%' AND command LIKE '%statement_timeout%'
  FROM cron.job WHERE jobname='bat-live-pull'));
SELECT pg_temp.ok('p_lots defaults to NULL so config governs',
 pg_get_function_arguments('public.bat_live_pull_run(integer,boolean)'::regprocedure) LIKE 'p_lots integer DEFAULT NULL%');

-- Fixture board: 5 lots closing in 5 min (never read, so NULLS FIRST would favour them), 8 in-window lots 3 h overdue,
-- 1 never-dispatched lot closing in 5 days.
CREATE FUNCTION pg_temp.seed() RETURNS void LANGUAGE sql AS $$
 INSERT INTO public.monitored_auctions(source_id,external_auction_id,external_auction_url,vehicle_id,auction_end_time,is_live,priority,
   last_synced_at,next_poll_at)
 SELECT '00000000-0000-0000-0000-0000000000b1'::uuid,'closing-'||g,'https://bringatrailer.com/listing/closing-'||g,gen_random_uuid(),
   now()+interval '5 minutes',true,1,NULL,NULL FROM generate_series(1,5) g
 UNION ALL
 SELECT '00000000-0000-0000-0000-0000000000b1'::uuid,'window-'||g,'https://bringatrailer.com/listing/window-'||g,gen_random_uuid(),
   now()+interval '24 hours',true,1,now()-interval '9 hours',now()-interval '3 hours' FROM generate_series(1,8) g
 UNION ALL
 SELECT '00000000-0000-0000-0000-0000000000b1'::uuid,'far-1','https://bringatrailer.com/listing/far-1',gen_random_uuid(),
   now()+interval '5 days',true,2,NULL,NULL;
$$;

BEGIN;
SELECT pg_temp.seed();
CREATE TEMP TABLE r1 AS SELECT public.bat_live_pull_run() AS r;
SELECT pg_temp.ok('six HTML reads dispatched from config',
 (SELECT (r->>'dispatched')::int=6 FROM r1) AND (SELECT count(*)=6 FROM net.calls WHERE body ? 'url'));
SELECT pg_temp.ok('closing-window lots take exactly one slot although 4 more slots were free',
 (SELECT count(*)=1 FROM public.monitored_auctions WHERE last_synced_at=now() AND auction_end_time<=now()+interval '10 minutes'));
SELECT pg_temp.ok('first-read reserve goes to the never-dispatched lot beyond the window (2 = it + the never-read closing lot)',
 (SELECT (r->>'first_read_dispatched')::int=2 FROM r1)
 AND (SELECT last_synced_at=now() FROM public.monitored_auctions WHERE external_auction_id='far-1'));
SELECT pg_temp.ok('the remaining four slots go to the overdue in-window lots',
 (SELECT count(*)=4 FROM public.monitored_auctions WHERE last_synced_at=now() AND external_auction_id LIKE 'window-%'));
SELECT pg_temp.ok('closing lots still reach the native stream, outside the HTML slots',
 (SELECT count(*)=1 FROM net.calls WHERE body->>'mode'='live_stream') AND (SELECT (r->>'stream_lots')::int=5 FROM r1));
SELECT pg_temp.ok('the run records its slot use without touching config keys',
 (SELECT scraping_config#>>'{live_pull,last_run,dispatched}'='6' AND scraping_config#>>'{live_pull,lots_per_run}'='6'
   AND scraping_config#>>'{live_pull,closing_slots}'='1' FROM public.live_auction_sources WHERE slug='bat'));
CREATE TEMP TABLE r2 AS SELECT public.bat_live_pull_run() AS r;
SELECT pg_temp.ok('one pass in flight: an unread dispatch under 150 s blocks the next run',
 (SELECT (r->>'dispatched')::int=0 AND r->>'skipped' LIKE '%previous pass in flight%' FROM r2));
ROLLBACK;

BEGIN;
SELECT pg_temp.seed();
CREATE TEMP TABLE r3 AS SELECT public.bat_live_pull_run(2) AS r;
SELECT pg_temp.ok('an explicit p_lots still overrides config',
 (SELECT (r->>'dispatched')::int=2 FROM r3) AND (SELECT count(*)=2 FROM net.calls WHERE body ? 'url'));
ROLLBACK;

BEGIN;
SELECT pg_temp.seed();
UPDATE public.live_auction_sources SET scraping_config=jsonb_set(scraping_config,'{live_pull,lots_per_run}','4') WHERE slug='bat';
CREATE TEMP TABLE r4 AS SELECT public.bat_live_pull_run() AS r;
SELECT pg_temp.ok('a config edit changes the slot count with no redeploy',
 (SELECT (r->>'dispatched')::int=4 FROM r4));
ROLLBACK;

BEGIN;
SELECT pg_temp.seed();
UPDATE public.live_auction_sources SET scraping_config=scraping_config #- '{live_pull,lots_per_run}' #- '{live_pull,closing_slots}'
 WHERE slug='bat';
CREATE TEMP TABLE r5 AS SELECT public.bat_live_pull_run() AS r;
SELECT pg_temp.ok('absent keys default to 6 slots and 1 closing slot',
 (SELECT (r->>'dispatched')::int=6 FROM r5)
 AND (SELECT count(*)=1 FROM public.monitored_auctions WHERE last_synced_at=now() AND auction_end_time<=now()+interval '10 minutes'));
ROLLBACK;

BEGIN;
SELECT pg_temp.seed();
INSERT INTO net._http_response VALUES(9001,true,NULL,now()),(9002,true,NULL,now()),(9003,true,NULL,now());
UPDATE public.live_auction_sources SET scraping_config=jsonb_set(scraping_config,'{live_pull,rest_probes}',
 '[[9001,0],[9002,0],[9003,0]]') WHERE slug='bat';
CREATE TEMP TABLE r6 AS SELECT public.bat_live_pull_run() AS r;
SELECT pg_temp.ok('the REST p50 pause still stops all HTML dispatch',
 (SELECT (r->>'dispatched')::int=0 AND r->>'skipped' LIKE '%paused: REST p50%' FROM r6)
 AND (SELECT count(*)=0 FROM net.calls WHERE body ? 'url'));
ROLLBACK;
