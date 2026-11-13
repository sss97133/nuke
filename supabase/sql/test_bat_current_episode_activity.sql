\set ON_ERROR_STOP on
\ir test_bat_stable_board_identity.sql
ALTER TABLE auction_events ADD COLUMN duplicate_of uuid;
ALTER TABLE auction_comments ADD COLUMN auction_event_id uuid;
ALTER TABLE vehicles ADD COLUMN status text;
CREATE OR REPLACE VIEW auction_events_canonical WITH(security_invoker=true) AS SELECT * FROM auction_events WHERE duplicate_of IS NULL;
-- Mirror the already installed3158 activity fragment; its four-reader installer
-- has its own independent contract. This test exercises the full real reader.
DO $$ DECLARE body text:=pg_get_functiondef('market_lot_activity(uuid[],integer)'::regprocedure); BEGIN
 EXECUTE replace(body,'WHERE c.vehicle_id = v.id AND c.source_url IN (v.lot_url, v.lot_url || ''/'')',
 'WHERE c.vehicle_id = v.id AND c.source_url IN (v.lot_url, v.lot_url || ''/'')
      AND (c.auction_event_id IS NULL OR EXISTS (SELECT 1 FROM public.auction_events_canonical canonical_event WHERE canonical_event.id = c.auction_event_id OFFSET 0))');
END $$;
INSERT INTO vehicles(id,listing_url,sale_status,platform_source,auction_end_date,origin_metadata)
 SELECT ('00000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'https://bringatrailer.com/listing/historical-'||i,
 'sold','bringatrailer',(now()-interval '1 year')::text,'{}' FROM generate_series(600,624)i;
INSERT INTO vehicles(id,listing_url,auction_end_date,high_bid,origin_metadata)
 SELECT ('00000000-0000-0000-0000-'||lpad((i+100)::text,12,'0'))::uuid,'https://bringatrailer.com/listing/current-'||i,
 (now()+interval '2 days')::text,57500,jsonb_build_object('source','bat_auctions_page','platform','bringatrailer','external_id',100000+i)
 FROM generate_series(600,624)i;
INSERT INTO vehicle_events(vehicle_id,source_platform,event_type,event_status,source_url,ended_at)
 SELECT id,'bat','auction','active','https://bringatrailer.com/listing/current-'||right(id::text,6)::int,now()+interval '2 days'
 FROM vehicles WHERE right(id::text,6)::int BETWEEN 600 AND 624;
INSERT INTO vehicle_observations(id,vehicle_id,source_url,observed_at,ingested_at,structured_data,extraction_method,source_identifier,is_superseded,kind,source_id,vehicle_match_signals)
 SELECT gen_random_uuid(),v.id,'https://bringatrailer.com/listing/current-'||right(v.id::text,6)::int,now()-interval '2 days',now()-interval '1 day',
 jsonb_build_object('received_at',now()-interval '1 day','native_post_id',100000+right(v.id::text,6)::int),
 'bat_public_live_v1','public-live:'||v.id,false,'bid',md5('native-bat')::uuid,
 jsonb_build_object('monitor_vehicle_id',('00000000-0000-0000-0000-'||lpad((right(v.id::text,6)::int+100)::text,12,'0'))::uuid,'binding_resolved_by','lot_slug','source_url_match',true)
 FROM vehicles v WHERE right(v.id::text,6)::int BETWEEN 600 AND 624;
INSERT INTO auction_events(vehicle_id,source_url,high_bid,auction_end_date,scraped_at,raw_data)
 SELECT vehicle_id,source_url,57500,now()+interval '2 days',now()-interval '1 hour',
 jsonb_build_object('extractor','extract-bat-core','listing_url',source_url,'source_read',jsonb_build_object(
 'at',to_char((now()-interval '1 hour') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'basis','direct_fetch','clock_version',1,'bid_amount_version',1,'bid_amount',57500))
 FROM vehicle_observations WHERE right(vehicle_id::text,6)::int BETWEEN 600 AND 624;
INSERT INTO auction_comments(vehicle_id,auction_event_id,source_url,posted_at,bid_amount,bat_comment_id,sequence_number)
 SELECT e.vehicle_id,e.id,e.source_url||CASE WHEN g<12 THEN '/' ELSE '' END,now()-g*interval '1 minute',57500-g,600000+g,g
 FROM auction_events e CROSS JOIN generate_series(1,12)g WHERE right(e.vehicle_id::text,6)='000600';
INSERT INTO auction_comments(vehicle_id,source_url,posted_at,bid_amount,bat_comment_id)
 VALUES('00000000-0000-0000-0000-000000000600','https://bringatrailer.com/listing/historical-600',now(),999999,999999);
-- Marked duplicate comments are newer than real testimony: exclusion must happen before LIMIT.
INSERT INTO auction_events(vehicle_id,source_url,duplicate_of) SELECT vehicle_id,source_url||'/',id FROM auction_events WHERE right(vehicle_id::text,6)='000600';
INSERT INTO auction_comments(vehicle_id,auction_event_id,source_url,posted_at,bid_amount,bat_comment_id)
 SELECT vehicle_id,id,rtrim(source_url,'/'),now(),999999,900000+g FROM auction_events CROSS JOIN generate_series(1,45)g WHERE duplicate_of IS NOT NULL;
UPDATE vehicles SET is_public=false WHERE right(id::text,6) IN('000701','000602');
UPDATE vehicles SET deleted_at=now() WHERE right(id::text,6)='000703';
UPDATE vehicles SET merged_into_vehicle_id=md5('merged')::uuid WHERE right(id::text,6)='000604';
UPDATE vehicle_observations SET structured_data=structured_data||'{"native_post_id":99999}' WHERE right(vehicle_id::text,6)='000605';
UPDATE vehicle_observations SET source_id=md5('foreign')::uuid WHERE right(vehicle_id::text,6)='000606';
UPDATE vehicle_observations SET is_superseded=true WHERE right(vehicle_id::text,6)='000607';
UPDATE vehicle_observations SET structured_data=structured_data||'{"private":true}' WHERE right(vehicle_id::text,6)='000608';
UPDATE vehicle_observations SET vehicle_match_signals='{}' WHERE right(vehicle_id::text,6)='000609';
UPDATE vehicle_observations SET source_url=source_url||'-foreign' WHERE right(vehicle_id::text,6)='000610';
UPDATE auction_events SET outcome='sold' WHERE right(vehicle_id::text,6)='000611';
UPDATE vehicle_events SET event_status='ended' WHERE right(vehicle_id::text,6)='000612';
UPDATE vehicle_events SET ended_at=now()-interval '1 day' WHERE right(vehicle_id::text,6)='000613';
UPDATE vehicles SET auction_end_date=(now()-interval '1 day')::text WHERE right(id::text,6)='000714';
INSERT INTO vehicle_events(vehicle_id,source_platform,event_type,event_status,source_url,ended_at)
 SELECT vehicle_id,source_platform,event_type,event_status,source_url||'-other',ended_at FROM vehicle_events WHERE right(vehicle_id::text,6)='000615';
INSERT INTO auction_events(vehicle_id,source_url) SELECT vehicle_id,source_url||'-other' FROM auction_events WHERE right(vehicle_id::text,6)='000616';
UPDATE vehicles SET listing_kind='non_vehicle_item' WHERE right(id::text,6)='000717';
UPDATE vehicle_observations SET structured_data=structured_data||'{"projection_error":"unqualified"}' WHERE right(vehicle_id::text,6)='000618';
UPDATE vehicles SET high_bid=58000 WHERE right(id::text,6)='000719';
UPDATE vehicles SET status='merged' WHERE right(id::text,6) IN('000622','000723');
UPDATE vehicles SET origin_metadata=origin_metadata||'{"platform":"foreign"}' WHERE right(id::text,6)='000724';
-- Two public inventory locators for one native lot refuse arbitrary ownership.
INSERT INTO vehicles(id,listing_url,auction_end_date,high_bid,origin_metadata)
 SELECT md5('second-locator')::uuid,listing_url,auction_end_date,high_bid,origin_metadata FROM vehicles WHERE right(id::text,6)='000720';
INSERT INTO vehicle_observations SELECT (jsonb_populate_record(NULL::vehicle_observations,to_jsonb(o)||jsonb_build_object('id',gen_random_uuid(),
 'vehicle_match_signals',o.vehicle_match_signals||jsonb_build_object('monitor_vehicle_id',md5('second-locator')::uuid)))).*
 FROM vehicle_observations o WHERE right(vehicle_id::text,6)='000620';
-- A genuinely fresh native receipt retains its existing price/state priority.
UPDATE vehicle_observations SET ingested_at=now(),structured_data=structured_data||jsonb_build_object('received_at',now()) WHERE right(vehicle_id::text,6)='000621';
UPDATE vehicles SET high_bid=58000 WHERE right(id::text,6)='000721';
UPDATE auction_events e SET raw_data=raw_data||jsonb_build_object('live_stream',jsonb_build_object('observation_id',
 (SELECT id FROM vehicle_observations o WHERE o.vehicle_id=e.vehicle_id))) WHERE right(vehicle_id::text,6)='000621';
SELECT assert_contract(market_lot_activity(ARRAY['00000000-0000-0000-0000-000000000600'::uuid])->>'eligible_lots'='0','historical scalar excludes qualified current lot before repair');
\ir ../migrations/20261109041829_bat_current_episode_activity.sql
\ir ../migrations/20261109041829_bat_current_episode_activity.sql
SET ROLE anon;
SELECT assert_contract(market_lot_activity(ARRAY['00000000-0000-0000-0000-000000000600'::uuid])#>>'{lots,0,activity_rows}'='12',
 'all12 current native bids including both slash variants visible despite historical sold scalar and newer duplicate noise');
SELECT assert_contract(market_lot_activity(ARRAY['00000000-0000-0000-0000-000000000600'::uuid])#>>'{lots,0,source_url}'='https://bringatrailer.com/listing/current-600/'
 AND market_lot_activity(ARRAY['00000000-0000-0000-0000-000000000600'::uuid])#>>'{lots,0,source_bid_amount}'='57500'
 AND market_lot_activity(ARRAY['00000000-0000-0000-0000-000000000600'::uuid])#>>'{lots,0,source_bid_match}'='matched','exactcurrentlot capturedprice and visible original sourceclock preserved');
SELECT assert_contract(market_lot_activity(ARRAY['00000000-0000-0000-0000-000000000600'::uuid])#>'{lots,0,native_current_state}'='null'::jsonb
 AND market_lot_activity(ARRAY['00000000-0000-0000-0000-000000000600'::uuid])#>>'{lots,0,current_lot_identity,basis}'='retained_native_current_episode','old witness proves identity without fresh native label');
SELECT assert_contract(NOT EXISTS(SELECT FROM jsonb_array_elements(market_lot_activity(ARRAY['00000000-0000-0000-0000-000000000600'::uuid])#>'{lots,0,activity}') a
 WHERE a->>'bid_amount'='999999'),'historical and markedduplicate evidence never leaks into current lot');
SELECT assert_contract(market_lot_activity(ARRAY['00000000-0000-0000-0000-000000000619'::uuid])#>>'{lots,0,source_bid_match}'='mismatched','newer inventory quote is compared honestly with old captured source price');
SELECT assert_contract(market_lot_activity(ARRAY['00000000-0000-0000-0000-000000000620'::uuid])->>'eligible_lots'='0','ambiguous public inventory locators refuse current binding');
SELECT assert_contract(market_lot_activity(ARRAY['00000000-0000-0000-0000-000000000621'::uuid])#>>'{lots,0,current_bid_at_capture}'='57500'
 AND market_lot_activity(ARRAY['00000000-0000-0000-0000-000000000621'::uuid])#>'{lots,0,native_current_state}'<>'null'::jsonb,'fresh native current state keeps priority over stable inventory binding');
DO $$ DECLARE i integer; BEGIN FOR i IN 622..624 LOOP
 PERFORM assert_contract(market_lot_activity(ARRAY[('00000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid])->>'eligible_lots'='0','merged status or foreign native platform '||i); END LOOP; END $$;
DO $$ DECLARE i integer; BEGIN FOR i IN 601..618 LOOP
 PERFORM assert_contract(market_lot_activity(ARRAY[('00000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid])->>'eligible_lots'='0','negative qualification '||i); END LOOP; END $$;
SELECT assert_contract(market_lot_activity(ARRAY['00000000-0000-0000-0000-000000000600'::uuid],1)#>>'{lots,0,activity_rows}'='1'
 AND market_lot_activity(ARRAY['00000000-0000-0000-0000-000000000600'::uuid],1)#>>'{lots,0,has_more}'='true','existing perlot cap remains effective after canonical filtering');
RESET ROLE;
SELECT assert_contract(NOT EXISTS(SELECT FROM previous_acl a JOIN pg_proc p ON p.oid=a.oid WHERE p.proacl IS DISTINCT FROM a.proacl),'grants unchanged');
SELECT assert_contract(current_setting('statement_timeout')='3s' AND current_setting('lock_timeout')='1s','stricter budgets restored');
SELECT assert_contract((SELECT sale_status='sold' AND listing_url LIKE '%/historical-600' FROM vehicles WHERE right(id::text,6)='000600'),'historical vehicle scalars untouched');
-- A freshly recovered PRIOR sale must not veto or label the current lot's state.
UPDATE vehicles SET origin_metadata='{"source":"bat_auctions_page","external_id":"777777"}' WHERE right(id::text,6)='000600';
INSERT INTO vehicle_observations(id,vehicle_id,source_url,observed_at,ingested_at,structured_data,extraction_method,source_identifier,is_superseded,kind,source_id)
 VALUES(md5('historical-native')::uuid,'00000000-0000-0000-0000-000000000600','https://bringatrailer.com/listing/historical-600',
 now()-interval '1 year',now(),jsonb_build_object('native_post_id',777777,'received_at',now()),'bat_public_live_v1','public-live:historical-native',false,'bid',md5('native-bat')::uuid);
INSERT INTO auction_events(vehicle_id,source_url,outcome,auction_end_date,raw_data)
 VALUES('00000000-0000-0000-0000-000000000600','https://bringatrailer.com/listing/historical-600','sold',now()-interval '1 year',
 jsonb_build_object('live_stream',jsonb_build_object('observation_id',md5('historical-native')::uuid)));
SET ROLE anon;
SELECT assert_contract(market_lot_activity(ARRAY['00000000-0000-0000-0000-000000000600'::uuid])#>>'{lots,0,activity_rows}'='12'
 AND market_lot_activity(ARRAY['00000000-0000-0000-0000-000000000600'::uuid])#>'{lots,0,native_current_state}'='null'::jsonb,
 'prior-lot fresh native evidence neither hides current lot nor becomes its freshness label');
RESET ROLE;
