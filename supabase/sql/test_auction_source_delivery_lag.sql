-- Disposable PG17 only, inherits actual receipt/privacy contract.
\set ON_ERROR_STOP on
\ir test_auction_source_status_catalog.sql
CREATE TABLE system_state(key text PRIMARY KEY,value jsonb,updated_at timestamptz);
ALTER TABLE listing_feeds ADD COLUMN poll_interval_minutes integer;
INSERT INTO listing_feeds(source_slug,enabled,poll_interval_minutes,search_criteria) VALUES
 ('purplewave',true,120,'{"fetch_strategy":"purplewave_public_json","secret":"SECRET_FEED_CONFIG"}');
INSERT INTO cron.job VALUES ('ebay-motors-auctions',true);
INSERT INTO live_board_houses VALUES ('ebay-motors',true,'eBay'),('purplewave',true,'PW');
CREATE FUNCTION pg_temp.entry() RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object(
 'key','123456789012','vehicleId','00000000-0000-4000-8000-000000000001',
 'snapshotId','00000000-0000-4000-8000-000000000002','sha256',repeat('a',64),
 'readAt',now()-interval '2 hours','endAt',now()+interval '1 day','method','search',
 'url','https://ebay.com/itm/123456789012','pageUrl','https://api.ebay.com/buy/browse/v1/SECRET_QUEUE_URL',
 'already_projected',true) $$;
INSERT INTO system_state VALUES ('ebay_auction_snapshot_replay_v1',jsonb_build_object('version',1,'entries',jsonb_build_array(pg_temp.entry())),now()-interval '1 minute');
\ir ../migrations/20261109020911_auction_source_delivery_lag.sql
\ir ../migrations/20261109020911_auction_source_delivery_lag.sql
CREATE FUNCTION pg_temp.queue() RETURNS jsonb LANGUAGE sql AS $$ SELECT s->'delivery_queue' FROM jsonb_array_elements(public.live_bid_tape(5)->'source_status') s WHERE s->>'house'='ebay-motors' LIMIT 1 $$;
DO $$ DECLARE r jsonb:=live_bid_tape(5); q jsonb:=pg_temp.queue(); BEGIN
 IF q->>'queued_receipts'<>'1' OR q->>'state'<>'recorded' OR (q->>'oldest_source_read_at')::timestamptz NOT BETWEEN now()-interval '121 minutes' AND now()-interval '119 minutes' THEN RAISE EXCEPTION 'Queue receipt measurement lost: %',q; END IF;
 IF q->>'measured_at'=q->>'state_updated_at' THEN RAISE EXCEPTION 'Measurement and state clocks conflated'; END IF;
 IF r::text LIKE '%SECRET%' OR r::text LIKE '%123456789012%' OR r::text LIKE '%snapshotId%' THEN RAISE EXCEPTION 'Raw queue/config leaked'; END IF;
 IF NOT EXISTS(SELECT FROM jsonb_array_elements(r->'source_status') s WHERE s->>'house'='purplewave' AND s->>'native_poll_minutes'='120') THEN RAISE EXCEPTION 'Native feed cadence missing'; END IF;
 IF NOT EXISTS(SELECT FROM jsonb_array_elements(r->'source_status') s WHERE s->>'house'='ebay-motors' AND s->>'collection_state'='scheduled') THEN RAISE EXCEPTION 'Native scheduled path missing'; END IF;
 IF current_setting('statement_timeout')<>'3s' OR current_setting('lock_timeout')<>'1s' THEN RAISE EXCEPTION 'Caller budgets changed'; END IF;
END $$;
DO $$ DECLARE bad jsonb; BEGIN
 FOR bad IN SELECT x FROM jsonb_array_elements(jsonb_build_array(
   jsonb_build_object('version',1,'entries','bad'),
   jsonb_build_object('version','1','entries',jsonb_build_array(pg_temp.entry())),
   jsonb_build_object('version',1,'entries',jsonb_build_array(pg_temp.entry()||'{"readAt":"garbage"}')),
   jsonb_build_object('version',1,'entries',jsonb_build_array(pg_temp.entry()||'{"readAt":"yesterday"}')),
   jsonb_build_object('version',1,'entries',jsonb_build_array(pg_temp.entry()||jsonb_build_object('readAt',now()+interval '1 hour'))),
   jsonb_build_object('version',1,'entries',jsonb_build_array(pg_temp.entry(),pg_temp.entry()))
 )) x LOOP
  UPDATE system_state SET value=bad;
  IF pg_temp.queue()->>'state'<>'invalid' OR pg_temp.queue() ? 'queued_receipts' THEN RAISE EXCEPTION 'Malformed queue became measured zero/count'; END IF;
 END LOOP;
 UPDATE system_state SET value=jsonb_build_object('version',1,'entries','[]'::jsonb),updated_at=now()+interval '1 minute';
 IF pg_temp.queue()->>'state'<>'invalid' THEN RAISE EXCEPTION 'Future queue clock admitted'; END IF;
 UPDATE system_state SET updated_at=now()-interval '1 minute';
 IF pg_temp.queue()->>'queued_receipts'<>'0' THEN RAISE EXCEPTION 'Measured empty queue lost'; END IF;
 DELETE FROM system_state;
 IF pg_temp.queue()->>'state'<>'unrecorded' OR pg_temp.queue() ? 'queued_receipts' THEN RAISE EXCEPTION 'Absent queue became zero'; END IF;
END $$;
SET ROLE anon;
DO $$ DECLARE r jsonb:=public.live_bid_tape(5); BEGIN
 IF NOT r->'sources' ? 'purplewave' THEN RAISE EXCEPTION 'Anonymous public contract lost'; END IF;
 BEGIN PERFORM value FROM public.system_state; RAISE EXCEPTION 'Raw queue became public'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
