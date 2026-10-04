-- OFFLINE ONLY: the actual migration runs against a disposable PostgreSQL 17 database.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() <> 'nuke_soft_close_test' THEN
    RAISE EXCEPTION 'This fixture must only run in the disposable nuke_soft_close_test database';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA net;
CREATE TABLE net._http_response (id bigint, status_code integer, timed_out boolean, created timestamptz);
CREATE TABLE net.requests (id bigint GENERATED ALWAYS AS IDENTITY, url text, body jsonb);
CREATE FUNCTION net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds integer) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE rid bigint; BEGIN INSERT INTO net.requests(url,body) VALUES(url,body) RETURNING id INTO rid; RETURN rid; END $$;
CREATE FUNCTION net.http_get(url text, headers jsonb, timeout_milliseconds integer) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE rid bigint; BEGIN INSERT INTO net.requests(url) VALUES(url) RETURNING id INTO rid; RETURN rid; END $$;
CREATE FUNCTION get_service_role_key_for_cron() RETURNS text LANGUAGE sql AS $$ SELECT 'offline-test-value' $$;
CREATE FUNCTION get_service_url() RETURNS text LANGUAGE sql AS $$ SELECT 'https://offline.invalid' $$;
CREATE TABLE live_auction_sources (id uuid PRIMARY KEY, slug text, scraping_config jsonb, last_successful_sync timestamptz, consecutive_failures integer DEFAULT 0, health_status text, last_sync_error text);
CREATE TABLE vehicles (id uuid PRIMARY KEY, high_bid numeric, auction_end_date text, listing_url text, sale_status text, platform_source text, deleted_at timestamptz);
CREATE TABLE auction_events (vehicle_id uuid, source_url text, auction_end_date timestamptz, outcome text, updated_at timestamptz);
CREATE TABLE auction_comments (vehicle_id uuid);
CREATE TABLE monitored_auctions (id uuid DEFAULT gen_random_uuid() PRIMARY KEY, source_id uuid, external_auction_id text, external_auction_url text, vehicle_id uuid, auction_end_time timestamptz, is_live boolean, current_bid_cents bigint, priority integer, last_synced_at timestamptz, next_poll_at timestamptz, poll_interval_ms integer, last_comment_count bigint, last_comment_synced_at timestamptz, sync_latency_ms integer, UNIQUE(source_id,external_auction_id));
CREATE FUNCTION public.bat_live_pull_run(p_lots integer DEFAULT 3, p_force_sync boolean DEFAULT false) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$ SELECT '{}'::jsonb $$;
REVOKE ALL ON FUNCTION public.bat_live_pull_run(integer,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bat_live_pull_run(integer,boolean) TO service_role;
\ir ../migrations/20261004174612_bat_live_pull_closing_window.sql
SELECT count(*) AS lock_waiters FROM pg_stat_activity WHERE wait_event_type = 'Lock';
CREATE FUNCTION pg_temp.reset_fixture(end_offset interval, next_offset interval DEFAULT interval '40 minutes') RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  TRUNCATE monitored_auctions, vehicles, auction_events, auction_comments, live_auction_sources, net.requests, net._http_response;
  INSERT INTO live_auction_sources(id,slug,scraping_config) VALUES('00000000-0000-0000-0000-000000000001','bat','{}');
  INSERT INTO vehicles VALUES('00000000-0000-0000-0000-000000000002',118888,(now()+end_offset)::text,'https://bringatrailer.com/listing/synthetic-soft-close','auction_live','bringatrailer',NULL);
  INSERT INTO monitored_auctions(source_id,external_auction_id,external_auction_url,vehicle_id,auction_end_time,is_live,last_synced_at,next_poll_at,last_comment_synced_at)
    VALUES('00000000-0000-0000-0000-000000000001','synthetic-soft-close','https://bringatrailer.com/listing/synthetic-soft-close','00000000-0000-0000-0000-000000000002',now()+end_offset,true,now()-interval '45 minutes',now()+next_offset,now()-interval '44 minutes');
END $$;
BEGIN;
DO $$ DECLARE result jsonb; BEGIN
  ASSERT NOT has_function_privilege('anon','bat_live_pull_run(integer,boolean)','execute'), 'anon access stays closed';
  ASSERT NOT has_function_privilege('authenticated','bat_live_pull_run(integer,boolean)','execute'), 'authenticated access stays closed';
  ASSERT has_function_privilege('service_role','bat_live_pull_run(integer,boolean)','execute'), 'existing service access is preserved';
  PERFORM pg_temp.reset_fixture(interval '5 minutes');
  result := bat_live_pull_run(3, true);
  ASSERT (result->>'dispatched')::int = 1, 'hourly next_poll must not skip the closing window';
  ASSERT (SELECT poll_interval_ms=60000 FROM monitored_auctions), 'closing cadence is one minute';
  ASSERT (SELECT is_live FROM monitored_auctions), 'future lot stays live';
  -- A second run at the same clock must not repeat the source dispatch.
  result := bat_live_pull_run(3, true);
  ASSERT (result->>'dispatched')::int=0, 'no duplicate dispatch while a read is in flight';

  PERFORM pg_temp.reset_fixture(interval '-1 minute');
  result := bat_live_pull_run(3, true);
  ASSERT (result->>'dispatched')::int = 1, 'expired original clock still needs a source read';
  ASSERT (SELECT is_live FROM monitored_auctions), 'elapsed clock alone does not retire the lot';

  PERFORM pg_temp.reset_fixture(interval '-6 minutes');
  UPDATE monitored_auctions SET last_synced_at=now()-interval '1 minute', last_comment_synced_at=NULL;
  INSERT INTO auction_events VALUES('00000000-0000-0000-0000-000000000002','https://bringatrailer.com/listing/synthetic-soft-close/',now()+interval '2 minutes','live',now());
  result := bat_live_pull_run(3, true);
  ASSERT (SELECT auction_end_time=now()+interval '2 minutes' AND is_live FROM monitored_auctions), 'fresh extension revives the clock before retirement';
  ASSERT (result->>'dispatched')::int=1, 'the extended lot remains in the closing queue';

  PERFORM pg_temp.reset_fixture(interval '5 minutes');
  UPDATE monitored_auctions SET last_synced_at=now()-interval '1 minute', last_comment_synced_at=NULL;
  INSERT INTO auction_events VALUES('00000000-0000-0000-0000-000000000002','https://bringatrailer.com/listing/synthetic-soft-close/',now(),'sold',now());
  result := bat_live_pull_run(3, true);
  ASSERT NOT (SELECT is_live FROM monitored_auctions), 'confirmed sale survives stale live-board sync';
  ASSERT (result->>'dispatched')::int=0, 'confirmed sale stops reads';

  PERFORM pg_temp.reset_fixture(interval '-6 minutes');
  result := bat_live_pull_run(3, true);
  ASSERT NOT (SELECT is_live FROM monitored_auctions), 'grace window is bounded';
  ASSERT (result->>'dispatched')::int=0, 'no read after grace';

  PERFORM pg_temp.reset_fixture(interval '5 minutes');
  INSERT INTO monitored_auctions(source_id,external_auction_id,external_auction_url,vehicle_id,auction_end_time,is_live,last_synced_at,next_poll_at,last_comment_synced_at)
    SELECT '00000000-0000-0000-0000-000000000001', 'synthetic-'||n, 'https://bringatrailer.com/listing/synthetic-'||n,
      '00000000-0000-0000-0000-000000000002',now()+interval '5 minutes',true,now()-interval '45 minutes',now()+interval '40 minutes',now()-interval '44 minutes'
    FROM generate_series(1,3) n;
  result := bat_live_pull_run(3, false);
  ASSERT (result->>'dispatched')::int=3, 'existing dispatch cap is preserved';

  PERFORM pg_temp.reset_fixture(interval '72 hours', interval '-1 minute');
  UPDATE monitored_auctions SET last_synced_at=NULL,next_poll_at=NULL;
  result := bat_live_pull_run(3, true);
  ASSERT (result->>'first_read_dispatched')::int=1, 'first-read reserve remains usable';
  ASSERT (SELECT poll_interval_ms=86400000 FROM monitored_auctions), 'distant-lot cadence is unchanged';

  PERFORM pg_temp.reset_fixture(interval '5 minutes');
  UPDATE monitored_auctions SET last_synced_at=now()-interval '1 minute',last_comment_synced_at=NULL;
  INSERT INTO auction_events VALUES('00000000-0000-0000-0000-000000000002','https://bringatrailer.com/listing/unrelated-relist',now(),'sold',now());
  result := bat_live_pull_run(3, true);
  ASSERT (result->>'read')::int=0, 'another listing cannot count as this source read';
  ASSERT result->>'skipped'='previous pass in flight', 'another listing cannot defeat the in-flight governor';

  PERFORM pg_temp.reset_fixture(interval '5 minutes');
  INSERT INTO net._http_response SELECT n, 200, false, now() FROM generate_series(1,3) n;
  UPDATE live_auction_sources SET scraping_config=jsonb_build_object('live_pull', jsonb_build_object('rest_probes',
    jsonb_build_array(jsonb_build_array(1,extract(epoch FROM now())*1000-3000),jsonb_build_array(2,extract(epoch FROM now())*1000-3000),jsonb_build_array(3,extract(epoch FROM now())*1000-3000))));
  result := bat_live_pull_run(3, true);
  ASSERT (result->>'dispatched')::int=0 AND result->>'skipped' LIKE '%paused:%', 'REST governor remains authoritative';
END $$;
ROLLBACK;
SELECT 'closing-window fixture passed' AS result;
