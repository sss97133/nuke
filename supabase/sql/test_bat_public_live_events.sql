\set ON_ERROR_STOP on
-- OFFLINE ONLY. Prepared fixture: actual captured BaT frames transformed by
-- the tested parser into /private/tmp/nuke-bat-prepared-fixture.json.
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
INSERT INTO public.fixture_frames VALUES(pg_read_file('/private/tmp/nuke-bat-prepared-fixture.json')::jsonb);
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
GRANT USAGE ON SCHEMA public,net,cron TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public,net,cron TO service_role;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public,net TO service_role;

INSERT INTO public.live_auction_sources(id,slug,health_status) VALUES('00000000-0000-0000-0000-000000000003','bat','healthy');
INSERT INTO public.observation_sources VALUES('00000000-0000-0000-0000-000000000004','bat');
INSERT INTO public.vehicles VALUES('00000000-0000-0000-0000-000000000002','https://bringatrailer.com/listing/2000-toyota-land-cruiser-155/',
  '{"source":"bat_auctions_page","external_id":"122706961"}',NULL,'auction_live','bringatrailer',30500,'2026-10-04T18:01:00Z');
INSERT INTO public.monitored_auctions(id,source_id,vehicle_id,external_auction_url,external_auction_id,auction_end_time,is_live)
  VALUES('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000002',
    'https://bringatrailer.com/listing/2000-toyota-land-cruiser-155','2000-toyota-land-cruiser-155','2026-10-04T18:01:00Z',true);
INSERT INTO public.vehicle_events(vehicle_id,source_platform,source_url,current_price,event_status,ended_at)
  SELECT vehicle_id,'bat',external_auction_url,30500,'active',auction_end_time FROM public.monitored_auctions;

SET ROLE service_role;
DO $$ DECLARE result jsonb; n integer; frames jsonb; failed boolean:=false;BEGIN
  SELECT doc INTO frames FROM fixture_frames;
  result:=ingest_bat_live_events(frames->'frames','[]');
  ASSERT (result->>'recorded')::integer=6, 'all measured source frames admitted atomically';
  ASSERT (SELECT count(*)=6 FROM vehicle_observations),'every raw native frame persists';
  ASSERT (SELECT outcome='sold' AND winning_bid=33000 FROM auction_events),'native sold record qualifies 33000';
  ASSERT (SELECT event_status='sold' AND final_price=33000 AND sold_at='2026-10-04T18:08:34Z' FROM vehicle_events),'result reaches current UI event';
  ASSERT NOT (SELECT is_live FROM monitored_auctions),'source result retires monitor';
  ASSERT (SELECT count(*)=1 FROM net.calls WHERE body->>'prefer_snapshot'='false'),'native final result requests one immediate fresh canonical read';
  ASSERT (SELECT count(*)=2 FROM auction_comments),'bid and result native comments projected once';
  ASSERT (SELECT count(*)=2 FROM external_identities),'published authors link to canonical identity';
  ASSERT (SELECT observed_at='2026-10-04T18:00:16Z' AND ingested_at>observed_at FROM vehicle_observations WHERE kind='bid'), 'event and admission clocks remain separate';
  result:=ingest_bat_live_events(frames->'frames','[]');
  ASSERT (result->>'duplicates')::integer=6 AND (result->>'recorded')::integer=0,'overlapping workers replay safely';
  ASSERT (SELECT count(*)=2 FROM auction_comments),'replay never increments comment/profile inputs';
  ASSERT (SELECT count(*)=1 FROM net.calls WHERE body->>'prefer_snapshot'='false'),'replay cannot repeatedly dispatch settlement';
  ASSERT (get_live_auction_health()#>>'{closing_stream,status}')='idle','settled lot has no eligible sample';
  BEGIN
    PERFORM ingest_bat_live_events(jsonb_build_array(jsonb_set(frames#>'{frames,0}','{post_id}','9999999')),'[]');
  EXCEPTION WHEN OTHERS THEN failed:=true; END;
  ASSERT failed,'cross-post source impersonation fails';
  ASSERT (SELECT count(*)=6 FROM vehicle_observations),'failed transaction leaves no partial admission';
END $$;
RESET ROLE;
UPDATE vehicle_events SET metadata=metadata||'{"organization_id":"fixture-organization"}';
DO $$ BEGIN
  ASSERT (SELECT metadata->>'organization_id'='fixture-organization' AND final_price=33000 FROM vehicle_events),
    'organization maintenance is permitted without changing sourced auction facts';
END $$;
UPDATE vehicle_events SET current_price=100,event_status='active',final_price=NULL,
  metadata='{"source":"extract-bat-core","source_read":{"at":"2026-10-04T18:00:00Z"}}';
UPDATE auction_events SET outcome='live',winning_bid=NULL,
  raw_data='{"extractor":"extract-bat-core","source_read":{"at":"2026-10-04T18:00:00Z"}}';
DO $$ BEGIN
  ASSERT (SELECT event_status='sold' AND final_price=33000 FROM vehicle_events),'late-finishing old HTML cannot regress streamed UI result';
  ASSERT (SELECT outcome='sold' AND winning_bid=33000 FROM auction_events),'late-finishing old HTML cannot regress auction record';
END $$;
DO $$ BEGIN
  ASSERT NOT has_function_privilege('anon','ingest_bat_live_events(jsonb,jsonb)','execute'),'anonymous admission closed';
  ASSERT NOT has_function_privilege('authenticated','ingest_bat_live_events(jsonb,jsonb)','execute'),'ordinary user admission closed';
  ASSERT has_function_privilege('service_role','ingest_bat_live_events(jsonb,jsonb)','execute'),'canonical service admission available';
  ASSERT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='vehicle_events'),'current auction cache delivery is enabled';
  ASSERT NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='auction_comments'),'large comment log is not added to delivery';
END $$;

-- Prove the execution-health blind spot is removed, even on clock-retired lots.
UPDATE auction_events SET outcome='live',raw_data=jsonb_set(raw_data,'{source_read}',jsonb_build_object('at',clock_timestamp()+interval '1 second'));
UPDATE monitored_auctions SET is_live=false,auction_end_time=now()-interval '1 minute',stream_state='{}';
DO $$ BEGIN
  ASSERT (SELECT last_status='succeeded' AND health_status='failed' AND assay_status='failed' FROM v_job_health WHERE jobname='bat-live-pull'), 'green cron cannot hide missing closing coverage';
END $$;
UPDATE monitored_auctions SET is_live=true,auction_end_time=now()+interval '5 minutes';
SELECT ingest_bat_live_events('[]',jsonb_build_array(jsonb_build_object('monitored_auction_id','00000000-0000-0000-0000-000000000001',
  'session_id','00000000-0000-0000-0000-000000000005','at',now(),'connected',true,'pending',0,'oldest_received_at',NULL,'error',NULL)));
DO $$ BEGIN ASSERT (get_live_auction_health()#>>'{closing_stream,status}')='passed','fresh subscription and empty acknowledgement queue pass'; END $$;
SELECT ingest_bat_live_events('[]',jsonb_build_array(jsonb_build_object('monitored_auction_id','00000000-0000-0000-0000-000000000001',
  'session_id','00000000-0000-0000-0000-000000000005','at',now(),'connected',true,'pending',2,'oldest_received_at',now()-interval '3 seconds','error','intake unavailable')));
DO $$ BEGIN ASSERT (get_live_auction_health()#>>'{closing_stream,status}')='failed','connected socket with stalled admission fails'; END $$;

-- Every eligible closing lot goes to one multiplexed stream; HTML cap stays 3.
UPDATE monitored_auctions SET stream_state='{}',next_poll_at=now()+interval '1 hour';
-- Match the production incident: the board clock already changed sale_status
-- to not_sold and retired the monitor, without any native terminal result.
UPDATE vehicles SET sale_status='not_sold';
UPDATE monitored_auctions SET is_live=false,auction_end_time=now()-interval '1 minute',last_synced_at=now();
INSERT INTO monitored_auctions(source_id,vehicle_id,external_auction_id,external_auction_url,auction_end_time,is_live,next_poll_at)
SELECT '00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000002','synthetic-'||i,
  'https://bringatrailer.com/listing/synthetic-'||i,now()+interval '4 minutes',true,now()+interval '1 hour' FROM generate_series(1,19)i;
DO $$ DECLARE r jsonb; BEGIN
  r:=bat_live_pull_run(3,false);
  ASSERT (SELECT is_live FROM monitored_auctions WHERE id='00000000-0000-0000-0000-000000000001'),
    'clock-retired not_sold parent resumes capture until a sourced final result';
  ASSERT r->>'skipped'='previous pass in flight','HTML in-flight gate cannot block native recovery';
  ASSERT (r->>'stream_lots')::integer=20,'three HTML slots cannot truncate 20 live subscriptions';
  ASSERT (SELECT count(*)=1 FROM net.calls WHERE body->>'mode'='live_stream'),'one source connection request multiplexes every closing';
  ASSERT (r->>'dispatched')::integer<=3,'HTML fallback capacity remains bounded';
END $$;
SELECT 'bat public live intake/fold/coverage assays passed' AS result;
