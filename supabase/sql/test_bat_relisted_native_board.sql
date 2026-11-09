-- Actual anonymous board/activity readers; imports the guarded disposable PG17 fixture.
\set ON_ERROR_STOP on
\ir test_bat_native_state_board.sql
ALTER TABLE vehicle_observations ADD COLUMN source_id uuid, ADD COLUMN vehicle_match_signals jsonb;
ALTER TABLE vehicle_events ADD COLUMN event_type text DEFAULT 'auction';
CREATE TABLE observation_sources(id uuid PRIMARY KEY,slug text UNIQUE,species text,supported_observations text[]);
ALTER TABLE observation_sources ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON observation_sources TO anon,authenticated;
-- No anonymous registry policy and no collector tables: the reader must not need either.
INSERT INTO observation_sources VALUES(md5('native-bat')::uuid,'bat','timed_auction',ARRAY['bid']);
INSERT INTO vehicles(id,listing_url,sale_status,platform_source,year,title,auction_end_date,origin_metadata)
 SELECT ('00000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,
 'https://carsandbids.com/auctions/prior-'||i,'not_sold','carsandbids',1995,'Canonical prior title',
 (now()-interval '1 year')::text,'{"import_source":"carsandbids"}' FROM generate_series(200,223)i;
INSERT INTO vehicles(id,listing_url,year,title,auction_end_date,high_bid,origin_metadata)
 SELECT ('00000000-0000-0000-0000-'||lpad((i+100)::text,12,'0'))::uuid,
 'https://bringatrailer.com/listing/relisted-'||i,1994,'1995 source title',
 (now()+interval '3 days')::text,10000,jsonb_build_object('source','bat_auctions_page','platform','bringatrailer',
 'external_id',100000+i,'last_sync',now()-interval '20 minutes') FROM generate_series(200,223)i;
INSERT INTO vehicle_events(vehicle_id,source_platform,source_url,event_status)
 SELECT id,'bat','https://bringatrailer.com/listing/relisted-'||right(id::text,6)::int,'active'
 FROM vehicles WHERE right(id::text,6)::int BETWEEN 200 AND 223;
INSERT INTO vehicle_observations(id,vehicle_id,source_url,observed_at,ingested_at,structured_data,extraction_method,source_identifier,is_superseded,kind,source_id,vehicle_match_signals)
 SELECT gen_random_uuid(),v.id,'https://bringatrailer.com/listing/relisted-'||right(v.id::text,6)::int,
 now()-interval '2 days',now()-interval '10 seconds',
 jsonb_build_object('received_at',now()-interval '20 seconds','native_post_id',100000+right(v.id::text,6)::int),
 'bat_public_live_v1','public-live:'||v.id,false,'bid',md5('native-bat')::uuid,
 jsonb_build_object('monitor_vehicle_id',('00000000-0000-0000-0000-'||lpad((right(v.id::text,6)::int+100)::text,12,'0'))::uuid,
 'binding_resolved_by','lot_slug','source_url_match',true)
 FROM vehicles v WHERE right(v.id::text,6)::int BETWEEN 200 AND 223;
INSERT INTO auction_events(vehicle_id,source_url,high_bid,auction_end_date,raw_data)
 SELECT o.vehicle_id,o.source_url,9000,now()+interval '3 days',jsonb_build_object('extractor','extract-bat-core',
 'listing_url',o.source_url,'live_stream',jsonb_build_object('observation_id',o.id),
 'source_read',jsonb_build_object('at',o.structured_data->>'received_at','clock_version',1,'bid_amount_version',1,'bid_amount',9000))
 FROM vehicle_observations o WHERE right(o.vehicle_id::text,6)::int BETWEEN 200 AND 223;
UPDATE vehicle_observations SET structured_data=structured_data||'{"native_post_id":999999}' WHERE right(vehicle_id::text,6)='000201';
UPDATE vehicle_observations SET source_id=md5('foreign')::uuid WHERE right(vehicle_id::text,6)='000202';
UPDATE vehicle_observations SET source_url=source_url||'-wrong' WHERE right(vehicle_id::text,6)='000203';
UPDATE vehicle_observations SET vehicle_match_signals=vehicle_match_signals||'{"monitor_vehicle_id":"invalid"}' WHERE right(vehicle_id::text,6)='000204';
UPDATE vehicles SET is_public=false WHERE right(id::text,6) IN('000305','000212');
UPDATE vehicles SET deleted_at=now() WHERE right(id::text,6) IN('000306','000213');
INSERT INTO vehicle_events(vehicle_id,source_platform,source_url,event_status) VALUES(md5('competing-owner')::uuid,'bat','https://bringatrailer.com/listing/relisted-207','active');
UPDATE auction_events SET outcome='sold' WHERE right(vehicle_id::text,6)='000208';
UPDATE auction_events SET raw_data=jsonb_set(raw_data,'{source_read,at}',to_jsonb(now()-interval '5 seconds')) WHERE right(vehicle_id::text,6)='000209';
UPDATE auction_events SET raw_data=jsonb_set(raw_data,'{source_read,bid_amount}','99999') WHERE right(vehicle_id::text,6)='000210';
UPDATE vehicles SET origin_metadata=jsonb_set(origin_metadata,'{last_sync}',to_jsonb(now()-interval '5 seconds')) WHERE right(id::text,6)='000311';
UPDATE vehicles SET listing_kind='non_vehicle_item' WHERE right(id::text,6)='000314';
UPDATE vehicle_observations SET is_superseded=true WHERE right(vehicle_id::text,6)='000215';
UPDATE vehicle_observations SET structured_data=structured_data||'{"projection_error":"unqualified"}' WHERE right(vehicle_id::text,6)='000216';
UPDATE vehicle_observations SET ingested_at=now()-interval '31 minutes' WHERE right(vehicle_id::text,6)='000217';
DELETE FROM vehicle_events WHERE right(vehicle_id::text,6)='000218';
UPDATE vehicle_observations SET structured_data=structured_data||'{"private":true}' WHERE right(vehicle_id::text,6)='000219';
INSERT INTO auction_events(vehicle_id,source_url) VALUES(md5('competing-auction')::uuid,'https://bringatrailer.com/listing/relisted-220');
UPDATE vehicles SET origin_metadata=origin_metadata||'{"source":"foreign"}' WHERE right(id::text,6)='000321';
UPDATE vehicles SET origin_metadata=origin_metadata||'{"external_id":"invalid"}' WHERE right(id::text,6)='000322';
UPDATE vehicles SET origin_metadata=jsonb_set(origin_metadata,'{last_sync}',to_jsonb(now()+interval '1 day')) WHERE right(id::text,6)='000323';
SELECT refresh_market_pulse_live_snapshot();
-- A distinct lot remains even when it uses the same canonical vehicle ID.
UPDATE market_pulse_live_snapshot SET payload=jsonb_set(payload,'{auctions}',(payload->'auctions')||jsonb_build_array(
 jsonb_build_array('00000000-0000-0000-0000-000000000200',1995,'SYNTHETIC','OTHER',1,now()+interval '2 days',now(),now(),NULL,false,'https://bringatrailer.com/listing/another-current-lot','Other source title')));
CREATE TEMP TABLE previous_acl AS SELECT oid,proacl FROM pg_proc WHERE oid IN('market_pulse_live()'::regprocedure,'market_lot_activity(uuid[],integer)'::regprocedure);
SET statement_timeout='3s'; SET lock_timeout='1s';
\ir ../migrations/20261109021917_bat_relisted_native_board.sql
\ir ../migrations/20261109021917_bat_relisted_native_board.sql
SELECT assert_contract(current_setting('statement_timeout')='3s' AND current_setting('lock_timeout')='1s','stricter budgets restored');
SELECT assert_contract(NOT EXISTS(SELECT FROM previous_acl a JOIN pg_proc p ON p.oid=a.oid WHERE p.proacl IS DISTINCT FROM a.proacl),'existing grants unchanged');
SET ROLE anon;
SELECT assert_contract((SELECT count(*)=0 FROM observation_sources),'anonymous registry remains unreadable');
SELECT assert_contract(EXISTS(SELECT FROM jsonb_array_elements(market_pulse_live()->'auctions')a
 WHERE a->>0='00000000-0000-0000-0000-000000000200' AND a->>4='9000' AND a->>1='1994' AND a->>11='1995 source title'
 AND a->>10='https://bringatrailer.com/listing/relisted-200'),'exact native relist current price and conflicting source identity reach canonical link');
SELECT assert_contract(NOT EXISTS(SELECT FROM jsonb_array_elements(market_pulse_live()->'auctions')a WHERE a->>0='00000000-0000-0000-0000-000000000300'),'same lot inventory duplicate removed');
SELECT assert_contract(EXISTS(SELECT FROM jsonb_array_elements(market_pulse_live()->'auctions')a WHERE a->>10='https://bringatrailer.com/listing/another-current-lot'),'different auction on same vehicle retained');
SELECT assert_contract(NOT EXISTS(SELECT FROM jsonb_array_elements(market_pulse_live()->'auctions')a WHERE right(a->>0,6)::int BETWEEN 201 AND 223),'wrong binding/source/post, private/deleted, competing, terminal, stale and mismatched clocks fail closed');
SELECT assert_contract(NOT EXISTS(SELECT FROM jsonb_array_elements(market_pulse_live()->'auctions')a WHERE a->>10='https://bringatrailer.com/listing/relisted-208'),'terminal native lot removes cached inventory row');
SELECT assert_contract(market_pulse_live()#>>'{native_state,00000000-0000-0000-0000-000000000200,source_listing_claims,year}'='1994'
 AND market_pulse_live()#>>'{native_state,00000000-0000-0000-0000-000000000200,canonical_identity,year}'='1995','source and canonical identity claims remain attributable');
SELECT assert_contract(market_lot_activity(ARRAY['00000000-0000-0000-0000-000000000200'::uuid])#>>'{lots,0,current_bid_at_capture}'='9000','same canonical current-lot evidence reader works');
RESET ROLE;
UPDATE vehicle_events SET event_status='ended' WHERE vehicle_id='00000000-0000-0000-0000-000000000200';
SET ROLE anon;
SELECT assert_contract(market_pulse_live()#>'{native_state,00000000-0000-0000-0000-000000000200}' IS NULL,'nonactive canonical episode cannot claim live native ownership');
SELECT assert_contract(jsonb_array_length(market_lot_activity(ARRAY['00000000-0000-0000-0000-000000000200'::uuid])->'lots')=0,'nonactive episode fails closed in evidence reader');
RESET ROLE;
SELECT assert_contract((SELECT year=1995 AND sale_status='not_sold' AND platform_source='carsandbids' AND listing_url LIKE 'https://carsandbids.com/%'
 FROM vehicles WHERE id='00000000-0000-0000-0000-000000000200'),'historical vehicle identity and listing never rewritten');
