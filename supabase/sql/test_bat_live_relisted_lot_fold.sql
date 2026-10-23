\set ON_ERROR_STOP on
\if :{?bat_fixture_path}
\else
\set bat_fixture_path /private/tmp/nuke-bat-prepared-fixture.json
\endif
-- OFFLINE ONLY (database nuke_soft_close_test). Contract test for 20261014060000_bat_live_fold_relisted_lot.sql.
-- ALLOW_RAW_TESTIMONY_WRITE: the fixture rows below go to a disposable offline database, never to production.
-- Incident (2026-10-14): a relisted car's lot has its events on the car's original vehicle, while the monitor binds the stub
-- vehicle made for the new URL. ingest_bat_live_events rejected every batch for such a lot ('canonical vehicle auction event
-- missing': 36,411 console lines a day) and the monitor could never retire. The captured frames are the same prepared
-- fixture test_bat_public_live_events.sql uses:
--   deno run --allow-write=/private/tmp/nuke-bat-prepared-fixture.json supabase/sql/prepare_bat_public_live_fixture.ts
--   psql -X -v ON_ERROR_STOP=1 -d nuke_soft_close_test -f supabase/sql/test_bat_live_relisted_lot_fold.sql
DO $$ BEGIN IF current_database()<>'nuke_soft_close_test' THEN RAISE EXCEPTION 'offline database required'; END IF; END $$;
DO $$ DECLARE role_name text; BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format('CREATE ROLE %I',role_name);
    END IF;
  END LOOP;
END $$;
DROP SCHEMA public CASCADE;
DROP SCHEMA IF EXISTS net CASCADE;
DROP SCHEMA IF EXISTS cron CASCADE;
DROP PUBLICATION IF EXISTS supabase_realtime;
CREATE PUBLICATION supabase_realtime;
CREATE SCHEMA public;
CREATE SCHEMA net;
CREATE SCHEMA cron;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE TYPE public.observation_kind AS ENUM ('listing','comment','bid','sale_result');
CREATE TABLE public.live_auction_sources(id uuid PRIMARY KEY,slug text UNIQUE,scraping_config jsonb DEFAULT '{}',
  last_successful_sync timestamptz,consecutive_failures integer DEFAULT 0,health_status text,last_sync_error text,is_active boolean DEFAULT true);
CREATE TABLE public.monitored_auctions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),source_id uuid,external_auction_id text,
  external_auction_url text,vehicle_id uuid,auction_end_time timestamptz,is_live boolean,current_bid_cents bigint,bid_count integer,
  high_bidder_username text,extension_count integer DEFAULT 0,last_extension_at timestamptz,is_in_soft_close boolean DEFAULT false,
  last_synced_at timestamptz,last_comment_count bigint,last_comment_synced_at timestamptz,sync_latency_ms integer,next_poll_at timestamptz,
  poll_interval_ms integer,priority integer,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),UNIQUE(source_id,external_auction_id));
CREATE TABLE public.vehicles(id uuid PRIMARY KEY,listing_url text,origin_metadata jsonb,deleted_at timestamptz,
  sale_status text,platform_source text,high_bid numeric,auction_end_date text);
CREATE TABLE public.auction_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),vehicle_id uuid,source text,source_url text,
  outcome text,auction_end_date timestamptz,high_bid numeric,winning_bid numeric,winning_bidder text,total_bids integer,
  page_views integer,watchers integer,comments_count integer,raw_data jsonb DEFAULT '{}',updated_at timestamptz DEFAULT now(),UNIQUE(vehicle_id,source_url));
CREATE TABLE public.vehicle_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),vehicle_id uuid,source_platform text,source_url text,
  ended_at timestamptz,current_price numeric,bid_count integer,view_count integer,watcher_count integer,event_status text,final_price numeric,sold_at timestamptz,
  metadata jsonb DEFAULT '{}',updated_at timestamptz DEFAULT now());
CREATE TABLE public.vehicle_observations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),vehicle_id uuid,vehicle_match_confidence numeric,vehicle_match_signals jsonb,source_id uuid,
  source_url text,source_identifier text,kind observation_kind,observed_at timestamptz,ingested_at timestamptz DEFAULT clock_timestamp(),
  content_text text,content_hash text,structured_data jsonb,extraction_method text,raw_source_ref text,extraction_metadata jsonb,
  confidence text,confidence_score numeric,UNIQUE(source_id,source_identifier,kind,content_hash));
CREATE TABLE public.observation_sources(id uuid PRIMARY KEY,slug text UNIQUE);
CREATE TABLE public.external_identities(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),platform text,handle text,profile_url text,UNIQUE(platform,handle));
CREATE TABLE public.auction_comments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),auction_event_id uuid,vehicle_id uuid,platform text,
  source_url text,content_hash text,sequence_number integer,posted_at timestamptz,hours_until_close numeric,author_username text,
  is_seller boolean,comment_type text,comment_text text,word_count integer,has_question boolean,has_media boolean,media_urls text[],bid_amount numeric,
  comment_likes integer,bat_author_id bigint,bat_comment_id bigint,bat_author_likes integer,author_total_likes integer,likers_count integer,
  external_identity_id uuid,UNIQUE(vehicle_id,content_hash));
CREATE TABLE public.pipeline_registry(table_name text,column_name text,owned_by text,description text,do_not_write_directly boolean,
  write_via text,UNIQUE(table_name,column_name));
CREATE TABLE public.fixture_frames(doc jsonb);
\if :{?bat_fixture_json}
INSERT INTO public.fixture_frames VALUES(:'bat_fixture_json'::jsonb);
\else
INSERT INTO public.fixture_frames VALUES(pg_read_file(:'bat_fixture_path')::jsonb);
\endif
CREATE TABLE net.calls(id bigint GENERATED ALWAYS AS IDENTITY,body jsonb);
CREATE TABLE net._http_response(id bigint,timed_out boolean,status_code integer,created timestamptz);
CREATE FUNCTION net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE i bigint;BEGIN INSERT INTO net.calls(body) VALUES(body) RETURNING id INTO i;RETURN i;END $$;
CREATE FUNCTION net.http_get(url text,headers jsonb,timeout_milliseconds integer) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE i bigint;BEGIN INSERT INTO net.calls(body) VALUES('{}') RETURNING id INTO i;RETURN i;END $$;
CREATE FUNCTION public.get_service_role_key_for_cron() RETURNS text LANGUAGE sql AS $$SELECT 'offline-fixture'::text$$;
CREATE FUNCTION public.get_service_url() RETURNS text LANGUAGE sql AS $$SELECT 'http://offline.invalid'::text$$;
CREATE FUNCTION public.assay_vehicle_metric_fold() RETURNS jsonb LANGUAGE sql AS $$SELECT '{"status":"passed"}'::jsonb$$;
CREATE TABLE cron.job(jobid bigint,jobname text,schedule text,active boolean,command text);
CREATE TABLE cron.job_run_details(jobid bigint,status text,start_time timestamptz,return_message text);
INSERT INTO cron.job VALUES(510,'bat-live-pull','* * * * *',true,'SELECT bat_live_pull_run(3)');
INSERT INTO cron.job_run_details VALUES(510,'succeeded',now(),'ok');

\ir ../migrations/20261004182500_bat_public_live_event_intake.sql
\ir ../migrations/20261004205500_bat_clock_retired_recovery.sql
\ir ../migrations/20261014060000_bat_live_fold_relisted_lot.sql
GRANT USAGE ON SCHEMA public,net,cron TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public,net,cron TO service_role;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public,net TO service_role;

INSERT INTO public.live_auction_sources(id,slug,health_status) VALUES('00000000-0000-0000-0000-000000000003','bat','healthy');
INSERT INTO public.observation_sources VALUES('00000000-0000-0000-0000-000000000004','bat');
-- ...02 is the stub the monitor binds: made for the relisted car's NEW url, no VIN, native post id in origin_metadata.
INSERT INTO public.vehicles VALUES('00000000-0000-0000-0000-000000000002','https://bringatrailer.com/listing/2000-toyota-land-cruiser-155',
  '{"source":"bat_auctions_page","external_id":"122706961"}',NULL,'auction_live','bringatrailer',30500,'2026-10-04T18:01:00Z');
-- ...05 is the car's original vehicle: its first listing's url, no stream locator.
INSERT INTO public.vehicles VALUES('00000000-0000-0000-0000-000000000005','https://bringatrailer.com/listing/2000-toyota-land-cruiser-103/',
  NULL,NULL,'sold','bringatrailer',28000,NULL);
INSERT INTO public.monitored_auctions(id,source_id,vehicle_id,external_auction_url,external_auction_id,auction_end_time,is_live)
  VALUES('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000002',
    'https://bringatrailer.com/listing/2000-toyota-land-cruiser-155','2000-toyota-land-cruiser-155','2026-10-04T18:01:00Z',true);

-- 1. The incident: the reader filed the lot under the original vehicle. All six captured frames are admitted, filed there,
--    the sourced result retires the monitor, and nothing is made for the stub.
BEGIN;
INSERT INTO public.vehicle_events(vehicle_id,source_platform,source_url,current_price,event_status,ended_at)
  VALUES('00000000-0000-0000-0000-000000000005','bat','https://bringatrailer.com/listing/2000-toyota-land-cruiser-155',100,'active','2026-10-04T18:01:00Z');
INSERT INTO public.auction_events(vehicle_id,source,source_url,outcome,auction_end_date,raw_data)
  VALUES('00000000-0000-0000-0000-000000000005','bat','https://bringatrailer.com/listing/2000-toyota-land-cruiser-155','live','2026-10-04T18:01:00Z',
    '{"extractor":"extract-bat-core","source_read":{"at":"2026-10-04T18:00:00Z"}}');
SET LOCAL ROLE service_role;
DO $$ DECLARE result jsonb; frames jsonb; BEGIN
  SELECT doc INTO frames FROM fixture_frames;
  result:=ingest_bat_live_events(frames->'frames','[]');
  ASSERT (result->>'recorded')::integer=6,'all six frames of a relisted lot are admitted';
  ASSERT (SELECT count(*)=6 FROM vehicle_observations WHERE vehicle_id='00000000-0000-0000-0000-000000000005'),'every raw frame is filed under the vehicle that holds the lot';
  ASSERT (SELECT count(*)=0 FROM vehicle_observations WHERE vehicle_id='00000000-0000-0000-0000-000000000002'),'nothing is filed under the stub';
  ASSERT (SELECT count(*)=6 FROM vehicle_observations WHERE vehicle_match_signals->>'monitor_vehicle_id'='00000000-0000-0000-0000-000000000002'
    AND vehicle_match_signals->>'binding_resolved_by'='lot_slug'),'a folded frame records the monitor vehicle and how it was resolved';
  ASSERT (SELECT count(*)=1 FROM auction_events),'the lot keeps its one auction row';
  ASSERT NOT EXISTS(SELECT 1 FROM auction_events WHERE vehicle_id='00000000-0000-0000-0000-000000000002')
    AND NOT EXISTS(SELECT 1 FROM vehicle_events WHERE vehicle_id='00000000-0000-0000-0000-000000000002'),'no event rows are made for the stub';
  ASSERT (SELECT outcome='sold' AND winning_bid=33000 FROM auction_events WHERE vehicle_id='00000000-0000-0000-0000-000000000005'),'native sold record reaches the lot row';
  ASSERT (SELECT event_status='sold' AND final_price=33000 AND sold_at='2026-10-04T18:08:34Z' FROM vehicle_events
    WHERE vehicle_id='00000000-0000-0000-0000-000000000005'),'result reaches the current UI event';
  ASSERT (SELECT metadata->'live_stream'->>'last_observation_id' IS NOT NULL FROM vehicle_events WHERE vehicle_id='00000000-0000-0000-0000-000000000005'),'the fold carries its receipt';
  ASSERT NOT (SELECT is_live FROM monitored_auctions WHERE id='00000000-0000-0000-0000-000000000001'),'the sourced result retires the stub monitor';
  ASSERT (SELECT count(*)=2 FROM auction_comments WHERE vehicle_id='00000000-0000-0000-0000-000000000005')
    AND NOT EXISTS(SELECT 1 FROM auction_comments WHERE vehicle_id='00000000-0000-0000-0000-000000000002'),'native comments land once, on the same vehicle';
  ASSERT (SELECT count(*)=1 FROM net.calls WHERE body->>'prefer_snapshot'='false' AND body->>'vehicle_id'='00000000-0000-0000-0000-000000000005'),
    'the final read is asked for the vehicle that holds the lot, not the stub';
  result:=ingest_bat_live_events(frames->'frames','[]');
  ASSERT (result->>'duplicates')::integer=6 AND (result->>'recorded')::integer=0,'overlapping workers replay safely';
  ASSERT (SELECT count(*)=1 FROM net.calls WHERE body->>'prefer_snapshot'='false'),'replay never repeats the final read';
  ASSERT (SELECT count(*)=2 FROM auction_comments),'replay never repeats a comment';
END $$;
RESET ROLE;
UPDATE vehicle_events SET current_price=100,event_status='active',final_price=NULL,
  metadata='{"source":"extract-bat-core","source_read":{"at":"2026-10-04T18:00:00Z"}}';
DO $$ BEGIN
  ASSERT (SELECT event_status='sold' AND final_price=33000 FROM vehicle_events),'a late old HTML read cannot regress the folded canonical event';
END $$;
ROLLBACK;

-- 2. A lot held by two vehicles is never guessed: the old refusal stands and nothing is written.
BEGIN;
INSERT INTO public.vehicles VALUES('00000000-0000-0000-0000-000000000006','https://bringatrailer.com/listing/2000-toyota-land-cruiser-103-b/',
  NULL,NULL,'sold','bringatrailer',28000,NULL);
INSERT INTO public.vehicle_events(vehicle_id,source_platform,source_url,current_price,event_status,ended_at)
  SELECT v,'bat','https://bringatrailer.com/listing/2000-toyota-land-cruiser-155',100,'active','2026-10-04T18:01:00Z'
  FROM unnest(ARRAY['00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000006']::uuid[]) v;
SET LOCAL ROLE service_role;
DO $$ DECLARE frames jsonb; failed boolean:=false; msg text; BEGIN
  SELECT doc INTO frames FROM fixture_frames;
  BEGIN PERFORM ingest_bat_live_events(frames->'frames','[]'); EXCEPTION WHEN OTHERS THEN failed:=true; msg:=SQLERRM; END;
  ASSERT failed AND msg='canonical vehicle auction event missing','two holders: the lot is refused as before';
  ASSERT (SELECT count(*)=0 FROM vehicle_observations) AND NOT EXISTS(SELECT 1 FROM auction_events) AND (SELECT count(*)=0 FROM net.calls),'a refused batch writes nothing';
  ASSERT (SELECT is_live FROM monitored_auctions WHERE id='00000000-0000-0000-0000-000000000001'),'the monitor is untouched';
END $$;
ROLLBACK;

-- 3. No vehicle holds the lot (a stub the reader has not read yet): refused as before, nothing written.
BEGIN;
SET LOCAL ROLE service_role;
DO $$ DECLARE frames jsonb; failed boolean:=false; msg text; BEGIN
  SELECT doc INTO frames FROM fixture_frames;
  BEGIN PERFORM ingest_bat_live_events(frames->'frames','[]'); EXCEPTION WHEN OTHERS THEN failed:=true; msg:=SQLERRM; END;
  ASSERT failed AND msg='canonical vehicle auction event missing','no holder: the lot is refused as before';
  ASSERT (SELECT count(*)=0 FROM vehicle_observations) AND NOT EXISTS(SELECT 1 FROM auction_events),'a refused batch writes nothing';
END $$;
ROLLBACK;

-- 4. The only holder is a deleted vehicle: never a fold target.
BEGIN;
UPDATE public.vehicles SET deleted_at=now() WHERE id='00000000-0000-0000-0000-000000000005';
INSERT INTO public.vehicle_events(vehicle_id,source_platform,source_url,current_price,event_status,ended_at)
  VALUES('00000000-0000-0000-0000-000000000005','bat','https://bringatrailer.com/listing/2000-toyota-land-cruiser-155',100,'active','2026-10-04T18:01:00Z');
SET LOCAL ROLE service_role;
DO $$ DECLARE frames jsonb; failed boolean:=false; msg text; BEGIN
  SELECT doc INTO frames FROM fixture_frames;
  BEGIN PERFORM ingest_bat_live_events(frames->'frames','[]'); EXCEPTION WHEN OTHERS THEN failed:=true; msg:=SQLERRM; END;
  ASSERT failed AND msg='canonical vehicle auction event missing','a deleted holder is not used';
  ASSERT (SELECT count(*)=0 FROM vehicle_observations),'a refused batch writes nothing';
END $$;
ROLLBACK;

-- 5. An ordinary lot (the monitor's own vehicle holds the event) is unchanged: it folds there and never touches another
--    vehicle that carries the same slug.
BEGIN;
INSERT INTO public.vehicle_events(vehicle_id,source_platform,source_url,current_price,event_status,ended_at)
  SELECT v,'bat','https://bringatrailer.com/listing/2000-toyota-land-cruiser-155',100,'active','2026-10-04T18:01:00Z'
  FROM unnest(ARRAY['00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000005']::uuid[]) v;
SET LOCAL ROLE service_role;
DO $$ DECLARE result jsonb; frames jsonb; BEGIN
  SELECT doc INTO frames FROM fixture_frames;
  result:=ingest_bat_live_events(frames->'frames','[]');
  ASSERT (result->>'recorded')::integer=6,'an ordinary lot admits all six frames';
  ASSERT (SELECT count(*)=6 FROM vehicle_observations WHERE vehicle_id='00000000-0000-0000-0000-000000000002'),'frames stay under the monitor vehicle';
  ASSERT NOT EXISTS(SELECT 1 FROM vehicle_observations WHERE vehicle_match_signals ? 'monitor_vehicle_id'),'an ordinary frame carries no fold note';
  ASSERT (SELECT event_status='sold' AND final_price=33000 FROM vehicle_events WHERE vehicle_id='00000000-0000-0000-0000-000000000002'),'the monitor vehicle event is folded';
  ASSERT (SELECT event_status='active' AND current_price=100 FROM vehicle_events WHERE vehicle_id='00000000-0000-0000-0000-000000000005'),'another vehicle with the same slug is untouched';
  ASSERT (SELECT count(*)=1 FROM net.calls WHERE body->>'vehicle_id'='00000000-0000-0000-0000-000000000002'),'the final read is asked for the monitor vehicle';
END $$;
ROLLBACK;

SELECT 'bat live relisted-lot fold contract passed' AS result;
