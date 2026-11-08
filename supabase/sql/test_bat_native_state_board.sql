-- Disposable PG17; the included fixture rejects non-disposable databases.
\set ON_ERROR_STOP on
\ir test_bat_episode_board_identity.sql
CREATE TABLE vehicle_observations(id uuid PRIMARY KEY,vehicle_id uuid,source_url text,observed_at timestamptz,ingested_at timestamptz,structured_data jsonb,extraction_method text,source_identifier text,is_superseded boolean,kind text);
CREATE FUNCTION observation_is_public(text,jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$SELECT coalesce(($2->>'private')::boolean,false)=false$$;
ALTER TABLE vehicle_observations ENABLE ROW LEVEL SECURITY;
CREATE POLICY public_observations ON vehicle_observations FOR SELECT TO anon,authenticated USING(observation_is_public(kind,structured_data));
GRANT SELECT ON vehicle_observations TO anon,authenticated,service_role;
INSERT INTO vehicles(id,listing_url,auction_end_date,high_bid,updated_at,origin_metadata)
 SELECT ('00000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'https://bringatrailer.com/listing/native-'||i,
   (now()-interval '3 minutes')::text,10000,now(),jsonb_build_object('source','bat_auctions_page','platform','bringatrailer','external_id',100000+i,'last_sync',now()-interval '20 minutes')
 FROM generate_series(100,110)i;
INSERT INTO vehicle_observations SELECT gen_random_uuid(),v.id,v.listing_url,now()-interval '1 minute',now()-interval '10 seconds',
 jsonb_build_object('received_at',now()-interval '20 seconds','native_post_id',v.origin_metadata->>'external_id'),
 'bat_public_live_v1','public-live:'||v.id,false,'bid'
 FROM vehicles v WHERE right(v.id::text,6)::int BETWEEN 100 AND 110;
INSERT INTO auction_events(vehicle_id,source_url,high_bid,auction_end_date,raw_data)
 SELECT o.vehicle_id,o.source_url,9000,now()+interval '2 minutes',jsonb_build_object('live_stream',jsonb_build_object('observation_id',o.id),
 'source_read',jsonb_build_object('at',now()-interval '10 minutes')) FROM vehicle_observations o;
-- Newer lower metadata must beat arbitrary vehicle.updated_at=now.
UPDATE vehicle_observations SET structured_data=jsonb_set(structured_data,'{native_post_id}','"999999"') WHERE right(vehicle_id::text,6)='000101';
UPDATE vehicle_observations SET source_url=source_url||'-wrong' WHERE right(vehicle_id::text,6)='000102';
UPDATE vehicle_observations SET is_superseded=true WHERE right(vehicle_id::text,6)='000103';
UPDATE vehicle_observations SET structured_data=structured_data||'{"private":true}' WHERE right(vehicle_id::text,6)='000104';
UPDATE vehicle_observations SET structured_data=structured_data||'{"projection_error":"unqualified"}' WHERE right(vehicle_id::text,6)='000105';
UPDATE auction_events SET outcome='sold' WHERE right(vehicle_id::text,6)='000106';
UPDATE vehicles SET deleted_at=now() WHERE right(id::text,6)='000107';
UPDATE vehicles SET origin_metadata=jsonb_set(origin_metadata,'{last_sync}',to_jsonb(now()-interval '5 seconds')) WHERE right(id::text,6)='000108';
UPDATE vehicle_observations SET structured_data=jsonb_set(structured_data,'{received_at}','"not a date"') WHERE right(vehicle_id::text,6)='000109';
UPDATE auction_events SET raw_data=jsonb_set(raw_data,'{source_read,at}',to_jsonb(now()-interval '5 seconds')) WHERE right(vehicle_id::text,6)='000110';
SELECT refresh_market_pulse_live_snapshot();
SELECT assert_contract(NOT EXISTS(SELECT FROM jsonb_array_elements(market_pulse_live()->'auctions')a WHERE right(a->>0,6)='000100'),'expired scalar lot missing before native reader');
\ir ../migrations/20261108192000_bat_native_state_board.sql
SET ROLE anon;
SELECT assert_contract(EXISTS(SELECT FROM jsonb_array_elements(market_pulse_live()->'auctions')a WHERE right(a->>0,6)='000100' AND a->>4='9000' AND (a->>5)::timestamptz>now()),'native extension absent from cache restored with newer lower authoritative price');
SELECT assert_contract(NOT EXISTS(SELECT FROM jsonb_array_elements(market_pulse_live()->'auctions')a WHERE right(a->>0,6)::int BETWEEN 101 AND 110),'wrong post/url, superseded/private/unqualified/terminal/deleted/newer inventory/malformed/newer HTML excluded');
SELECT assert_contract(market_pulse_live()#>>'{native_state,00000000-0000-0000-0000-000000000100,basis}'='canonical_native_fold','state provenance retained without raw/session data');
SELECT assert_contract(market_lot_activity(ARRAY['00000000-0000-0000-0000-000000000100'::uuid])#>>'{lots,0,current_bid_at_capture}'='9000','extended lot evidence uses same current amount');
RESET ROLE;
UPDATE auction_events SET outcome='sold' WHERE right(vehicle_id::text,6)='000100';
SET ROLE anon;
SELECT assert_contract(NOT EXISTS(SELECT FROM jsonb_array_elements(market_pulse_live()->'auctions')a WHERE right(a->>0,6)='000100'),'terminal outcome removes native state without waiting for cache');
RESET ROLE;
