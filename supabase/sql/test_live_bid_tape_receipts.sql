-- Disposable local PG17 fixture, never production.
\set ON_ERROR_STOP on
DO $$ BEGIN IF current_database() NOT LIKE 'dm_refinement_%' OR to_regclass('public.vehicle_observations') IS NOT NULL THEN RAISE EXCEPTION 'Empty disposable database required'; END IF; END $$;
CREATE TABLE vehicles(id uuid PRIMARY KEY,is_public boolean,deleted_at timestamptz);
CREATE TABLE vehicle_observations(id uuid DEFAULT gen_random_uuid(),vehicle_id uuid,source_id uuid,source_url text,source_identifier text,observed_at timestamptz,ingested_at timestamptz,kind text,structured_data jsonb,is_superseded boolean DEFAULT false,extraction_method text);
CREATE TABLE live_board_houses(house text,enabled boolean,label text DEFAULT 'Source');
CREATE TABLE live_auction_sources(slug text,scraping_config jsonb,last_sync_error text);
CREATE FUNCTION observation_is_public(text,jsonb) RETURNS boolean LANGUAGE sql AS $$ SELECT NOT $2 ? 'private' $$;
INSERT INTO vehicles VALUES ('00000000-0000-4000-8000-000000000001',true,null),('00000000-0000-4000-8000-000000000002',false,null),('00000000-0000-4000-8000-000000000003',true,now());
INSERT INTO live_board_houses(house,enabled) VALUES ('ebay-motors',true),('gooding',true);
INSERT INTO live_auction_sources VALUES ('gooding','{"live_board":{"last_run":{"state":"SECRET_INTERNAL_STATE","lots":0}}}','SECRET_ERROR');
CREATE FUNCTION pg_temp.add_receipt(vid int,ident text,kind text,d jsonb,ago interval DEFAULT interval '1 minute',method text DEFAULT null) RETURNS void LANGUAGE sql AS $$
INSERT INTO vehicle_observations(vehicle_id,source_id,source_url,source_identifier,observed_at,ingested_at,kind,structured_data,extraction_method)
VALUES (('00000000-0000-4000-8000-'||lpad(vid::text,12,'0'))::uuid,'00000000-0000-4000-8000-000000000099',CASE WHEN ident LIKE 'collecting-cars-bid:%' THEN 'https://collectingcars.com/for-sale/one' WHEN method='ebay_browse_auction_snapshot_v1' THEN 'https://www.ebay.com/itm/123' ELSE 'https://bringatrailer.com/listing/one' END,ident,now()-ago,now()-interval '1 second',kind,d,method) $$;
SELECT pg_temp.add_receipt(1,'public-live:1:comment:42:a','bid','{"transport":"public_pusher","public_live_frame":{"data":{"comment":{"id":42,"bidAmount":5000,"authorName":"SECRET_NAME"}}}}');
SELECT pg_temp.add_receipt(1,'public-live:1:comment:42:b','bid','{"transport":"missed_comments","public_live_frame":{"data":{"comment":{"id":42,"bidAmount":5000,"authorName":"SECRET_NAME"}}}}');
SELECT pg_temp.add_receipt(1,'public-live:1:comment:43:a','bid','{"transport":"missed_comments","public_live_frame":{"data":{"comment":{"id":43,"bidAmount":4000}}}}',interval '7 days');
SELECT pg_temp.add_receipt(2,'public-live:1:comment:44:a','bid','{"public_live_frame":{"data":{"comment":{"id":44,"bidAmount":9000}}}}');
SELECT pg_temp.add_receipt(3,'public-live:1:comment:45:a','bid','{"public_live_frame":{"data":{"comment":{"id":45,"bidAmount":9000}}}}');
SELECT pg_temp.add_receipt(1,'public-live:1:comment:46:a','bid','{"private":true,"public_live_frame":{"data":{"comment":{"id":46,"bidAmount":9000}}}}');
SELECT pg_temp.add_receipt(1,'collecting-cars-bid:5:42:1000','bid','{"amount":1000,"currency":"EUR","bid_count":42,"clock":"board_read"}');
SELECT pg_temp.add_receipt(1,'ebay-state-1','listing','{"capture_kind":"auction_bid_snapshot","current_bid":"1100.25","currency":"USD","bid_count":3,"clock":"source_read"}',interval '1 minute','ebay_browse_auction_snapshot_v1');
SELECT pg_temp.add_receipt(1,'ebay-opening','listing','{"capture_kind":"auction_bid_snapshot","current_bid":"100","currency":"USD","bid_count":0}',interval '1 minute','ebay_browse_auction_snapshot_v1');
SELECT pg_temp.add_receipt(1,'public-live:1:comment:48:a','bid','{"public_live_frame":{"data":{"comment":{"id":48,"bidAmount":"bad number"}}}}');
\ir ../migrations/20261108181944_live_bid_tape_source_receipts.sql
DO $$ DECLARE r jsonb; BEGIN
 r:=live_bid_tape(5);
 IF jsonb_array_length(r->'bids')<>5 THEN RAISE EXCEPTION 'Expected5 eligible deduplicated receipts: %',r; END IF;
 IF r::text LIKE '%SECRET_%' THEN RAISE EXCEPTION 'Bidder leak'; END IF;
 IF NOT EXISTS(SELECT FROM jsonb_array_elements(r->'bids') b WHERE b->>'house'='ebay-motors' AND b->>'amount'='1100.25' AND b->>'event_kind'='bid_snapshot') THEN RAISE EXCEPTION 'Lost exact eBay snapshot'; END IF;
 IF NOT EXISTS(SELECT FROM jsonb_array_elements(r->'bids') b WHERE b->>'recovered'='true' AND (b->>'bid_at')::timestamptz < now()-interval '1 day') THEN RAISE EXCEPTION 'Recovered history must retain original clock'; END IF;
 IF EXISTS(SELECT FROM jsonb_array_elements(r->'bids') b WHERE b->>'ingested_at' IS NULL OR b->>'observation_id' IS NULL OR b->>'source_url' IS NULL) THEN RAISE EXCEPTION 'Missing receipt'; END IF;
 IF NOT EXISTS(SELECT FROM jsonb_array_elements(r->'bids') b WHERE b->>'house'='ebay-motors' AND b->>'bid_count'='0' AND b->>'event_kind'='price_snapshot') THEN RAISE EXCEPTION 'Opening price must stay a quote'; END IF;
 RAISE NOTICE 'PASS source receipts, privacy, clocks, recovery, decimal amount and opening-price qualification';
END $$;
