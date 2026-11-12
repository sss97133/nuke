\set ON_ERROR_STOP on
DO $$ BEGIN
 IF current_database() NOT LIKE 'dm_refinement_bat_monitor%' OR to_regclass('public.vehicles') IS NOT NULL THEN
   RAISE EXCEPTION 'Requires empty disposable BaT monitor database';
 END IF;
END $$;
CREATE SCHEMA net;
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
CREATE TABLE public.vehicle_events(vehicle_id uuid,source_platform text,event_type text,event_status text,ended_at timestamptz,source_url text,
 current_price numeric,updated_at timestamptz);
CREATE TABLE public.vehicle_observations(id uuid,vehicle_id uuid,kind text,source_url text,extraction_method text,is_superseded boolean,
 structured_data jsonb,vehicle_match_signals jsonb);
CREATE TABLE net.calls(id bigint GENERATED ALWAYS AS IDENTITY,body jsonb);
CREATE FUNCTION net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE i bigint; BEGIN INSERT INTO net.calls(body) VALUES(body) RETURNING id INTO i; RETURN i; END $$;
CREATE FUNCTION public.get_service_role_key_for_cron() RETURNS text LANGUAGE sql AS $$ SELECT 'fixture-key' $$;
CREATE FUNCTION public.get_service_url() RETURNS text LANGUAGE sql AS $$ SELECT 'https://fixture.invalid' $$;
CREATE FUNCTION pg_temp.ok(label text,condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %',label; END IF; RAISE NOTICE 'PASS %',label;
END $$;
\ir helpers/bat_live_pull_run_live_20261108.sql
INSERT INTO live_auction_sources(id,slug,scraping_config) VALUES('00000000-0000-0000-0000-000000000001','bat',
 '{"live_pull":{"lots_per_run":6,"closing_slots":1,"reserve_first_read":1}}');
INSERT INTO vehicles SELECT ('00000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,1000,(now()+interval '4 days')::text,
 'https://bringatrailer.com/listing/fixture-'||i,'auction_live','barrett-jackson',NULL,
 jsonb_build_object('platform','bringatrailer','source','bat_auctions_page','external_id','125706455','last_sync',(now()-interval '1 day')::text)
 FROM generate_series(1,8) i;
INSERT INTO vehicle_events SELECT id,'bat','auction','active',auction_end_date::timestamptz,listing_url||'/',1000,now() FROM vehicles;
-- Baseline exposes the source-identity bug despite a native current lot and exact episode.
SELECT public.bat_live_pull_run(0,true);
SELECT pg_temp.ok('baseline excludes native lots on shared vehicles',(SELECT count(*)=0 FROM monitored_auctions));
-- Negative cases: no witness, no native id, future identity clock, unrelated episode, terminal episode, terminal result, deleted parent.
UPDATE vehicles SET origin_metadata=origin_metadata-'source' WHERE id='00000000-0000-0000-0000-000000000002';
UPDATE vehicles SET origin_metadata=origin_metadata-'external_id' WHERE id='00000000-0000-0000-0000-000000000003';
UPDATE vehicles SET origin_metadata=origin_metadata||jsonb_build_object('last_sync',(now()+interval '1 day')::text) WHERE id='00000000-0000-0000-0000-000000000004';
UPDATE vehicle_events SET source_url='https://bringatrailer.com/listing/unrelated' WHERE vehicle_id='00000000-0000-0000-0000-000000000005';
UPDATE vehicle_events SET event_status='ended' WHERE vehicle_id='00000000-0000-0000-0000-000000000006';
INSERT INTO auction_events SELECT id,listing_url,now(),now(),'cancelled' FROM vehicles WHERE id='00000000-0000-0000-0000-000000000007';
UPDATE vehicles SET deleted_at=now() WHERE id='00000000-0000-0000-0000-000000000008';
\ir ../migrations/20261108191200_bat_monitor_episode_identity.sql
\ir ../migrations/20261108191200_bat_monitor_episode_identity.sql
SELECT public.bat_live_pull_run(0,true);
SELECT pg_temp.ok('one exact native active episode enrolled',(SELECT count(*)=1 AND bool_and(external_auction_id='fixture-1') FROM monitored_auctions));
SELECT pg_temp.ok('vehicle original platform is unchanged',(SELECT bool_and(platform_source='barrett-jackson') FROM vehicles));
SELECT pg_temp.ok('zero existing slots dispatch no HTML reads',(SELECT count(*)=0 FROM net.calls));
SELECT pg_temp.ok('source cadence and slot controls unchanged',(SELECT scraping_config#>>'{live_pull,lots_per_run}'='6'
 AND scraping_config#>>'{live_pull,closing_slots}'='1' FROM live_auction_sources));
-- Reconciliation must also admit a proven current native episode after a scalar clock retirement.
DELETE FROM monitored_auctions;
UPDATE vehicles SET sale_status='not_sold',auction_end_date=(now()-interval '5 minutes')::text WHERE id='00000000-0000-0000-0000-000000000001';
UPDATE vehicle_events SET ended_at=now()-interval '5 minutes' WHERE vehicle_id='00000000-0000-0000-0000-000000000001';
SELECT public.bat_live_pull_run(0,true);
SELECT pg_temp.ok('reconciliation enrolls exact unresolved native lot',(SELECT count(*)=1 AND bool_and(is_live) FROM monitored_auctions));
SELECT pg_temp.ok('existing continuous dispatch retained',(SELECT count(*)=1 AND bool_and(body->>'mode'='live_stream') FROM net.calls));
INSERT INTO auction_events SELECT id,listing_url,now(),now(),'sold' FROM vehicles WHERE id='00000000-0000-0000-0000-000000000001';
SELECT public.bat_live_pull_run(0,true);
SELECT pg_temp.ok('native terminal guard retires enrollment',(SELECT count(*)=1 AND bool_and(NOT is_live) FROM monitored_auctions));
