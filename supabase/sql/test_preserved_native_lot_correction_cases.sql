-- Called only after the empty-disposable guard and actual writer fixtures in the parent contract.
DO $$ BEGIN IF current_database() NOT LIKE 'dm_refinement_%' THEN RAISE EXCEPTION 'Disposable fixture only'; END IF; END $$;
CREATE TEMP TABLE native_fixture_clock AS SELECT now()-interval '10 minutes' AS at;
INSERT INTO vehicles(id,vin,status,listing_url,origin_metadata) VALUES
 ('90000000-0000-4000-8000-000000000001',NULL,'active','https://bringatrailer.com/listing/fixture-relist',
 '{"source":"bat_auctions_page","platform":"bringatrailer","external_id":"123456"}'),
 ('90000000-0000-4000-8000-000000000002','1HGCM82633A004352','active','https://bringatrailer.com/listing/fixture-prior-sale','{}');
INSERT INTO observation_sources VALUES('95000000-0000-4000-8000-000000000001','bat');
INSERT INTO auction_events(id,vehicle_id,source,source_url,source_listing_id,raw_data,outcome,high_bid,total_bids,comments_count,
 unique_bidders,watchers,page_views,auction_end_date,scraped_at)
 SELECT ('91000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,
 CASE WHEN g=1 THEN '90000000-0000-4000-8000-000000000002'::uuid ELSE '90000000-0000-4000-8000-000000000001'::uuid END,
 'bat','https://bringatrailer.com/listing/fixture-relist','fixture-lot',
 jsonb_build_object('listing_details',jsonb_build_object('vin','1HGCM82633A004352'),
 'source_read',jsonb_build_object('at',CASE WHEN g=1 THEN at-interval '1 hour' ELSE at END,'bid_amount',CASE WHEN g=1 THEN 56666 ELSE 57500 END)),
 'live',CASE WHEN g=1 THEN 56666 ELSE 57500 END,CASE WHEN g=1 THEN 11 ELSE 12 END,
 CASE WHEN g=1 THEN 59 ELSE 60 END,6,100,200,at+interval '2 days',at
 FROM generate_series(1,2)g CROSS JOIN native_fixture_clock;
INSERT INTO auction_comments(id,vehicle_id,auction_event_id,platform,source_url,content_hash,sequence_number,posted_at,
 author_username,comment_type,comment_text,bid_amount,bat_comment_id)
 SELECT ('92000000-0000-4000-8000-'||lpad((g+100*(e-1))::text,12,'0'))::uuid,
 CASE WHEN e=1 THEN '90000000-0000-4000-8000-000000000002'::uuid ELSE '90000000-0000-4000-8000-000000000001'::uuid END,
 ('91000000-0000-4000-8000-'||lpad(e::text,12,'0'))::uuid,'bat','https://bringatrailer.com/listing/fixture-relist',
 CASE WHEN e=2 AND g>50 THEN 'changed-sequence-' ELSE 'same-' END||g,g,
 at-interval '61 minutes'+g*interval '1 minute','fixture-bidder-'||g,
 CASE WHEN g<=11 OR g=60 THEN 'bid' ELSE 'comment' END,
 CASE WHEN g<=11 OR g=60 THEN 'USD bid fixture ' ELSE 'Comment fixture ' END||g,
 CASE WHEN g=60 THEN 57500 WHEN g=11 THEN 56666 WHEN g<=10 THEN g*1000 ELSE NULL END,1000+g
 FROM generate_series(1,2)e CROSS JOIN generate_series(1,60)g CROSS JOIN native_fixture_clock WHERE e=2 OR g<60;
SELECT record_external_auction_bids('auction_comments',ARRAY(SELECT id FROM auction_comments WHERE auction_event_id IN
 ('91000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002')));
INSERT INTO listing_page_snapshots SELECT '94000000-0000-4000-8000-000000000001','bat',true,200,at,
 'https://bringatrailer.com/listing/fixture-relist',repeat('a',64) FROM native_fixture_clock;
INSERT INTO vehicle_events(id,vehicle_id,source_platform,source_url,source_listing_id,event_type,event_status,metadata,current_price,bid_count,currency_code,ended_at)
 SELECT '93000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000001','bat',
 'https://bringatrailer.com/listing/fixture-relist','fixture-lot','auction','active',
 jsonb_build_object('source_read',jsonb_build_object('at',at),'original_field','preserve'),57500,12,'USD',at+interval '2 days' FROM native_fixture_clock;
INSERT INTO vehicle_observations(id,vehicle_id,source_url,source_identifier,kind,source_id,extraction_method,
 observed_at,ingested_at,raw_source_ref,vehicle_match_signals,structured_data,extraction_metadata,subject_type,subject_id)
 SELECT ('96000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,'90000000-0000-4000-8000-000000000001',
 'https://bringatrailer.com/listing/fixture-relist',CASE WHEN g=2 THEN 'public-live:123456:comment-added:comment:1060:fixture-hash' ELSE NULL END,
 CASE WHEN g=2 THEN 'bid' ELSE 'listing' END,'95000000-0000-4000-8000-000000000001',
 CASE WHEN g=2 THEN 'bat_public_live_v1' ELSE 'fixture_listing' END,
 CASE WHEN g=2 THEN at-interval '1 minute' ELSE at END,at+g*interval '1 second',
 CASE WHEN g=2 THEN 'bat:public-live:post:123456' ELSE 'fixture:retained-description' END,
 '{"binding":"bat_auctions_page","native_post_id":"123456","source_url_match":true}',
 CASE WHEN g=2 THEN jsonb_build_object('native_post_id',123456,'received_at',at,'unknown_native','retained',
 'public_live_frame',jsonb_build_object('event','comment-added','data',jsonb_build_object('comment',
 jsonb_build_object('id',1060,'post','123456','type','bat-bid','bidAmount',57500,'timestamp',extract(epoch FROM at-interval '1 minute')))))
 ELSE '{"native_description":"preserve every field"}'::jsonb END,
 CASE WHEN g=2 THEN '{"schema":"bat_public_live_v1"}'::jsonb ELSE '{"source":"fixture"}'::jsonb END,
 'vehicle','90000000-0000-4000-8000-000000000001'
 FROM generate_series(1,3)g CROSS JOIN native_fixture_clock;
UPDATE vehicle_observations SET auction_event_id='91000000-0000-4000-8000-000000000002',
 source_vehicle_event_id='93000000-0000-4000-8000-000000000001',
 structured_data=structured_data||'{"auction_event_id":"91000000-0000-4000-8000-000000000002","source_auction_event_id":"91000000-0000-4000-8000-000000000002"}'
 WHERE id='96000000-0000-4000-8000-000000000001';
CREATE FUNCTION pg_temp.native_plan() RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_array(jsonb_build_object('action','preserve_native_duplicate',
 'event_id',d.id,'canonical_event_id',k.id,'expected_vehicle_id',d.vehicle_id,'to_vehicle_id',k.vehicle_id,
 'vehicle_event_id',ep.id,'expected_event_sha256',encode(sha256(convert_to(to_jsonb(d)::text,'UTF8')),'hex'),
 'expected_canonical_sha256',encode(sha256(convert_to(to_jsonb(k)::text,'UTF8')),'hex'),
 'expected_episode_sha256',encode(sha256(convert_to(to_jsonb(ep)::text,'UTF8')),'hex'),
 'expected_comments',60,'expected_duplicate_comments',59,'run_id','synthetic-preserved-native-correction',
 'source_snapshot_id','94000000-0000-4000-8000-000000000001','source_sha256',repeat('a',64),
 'source',jsonb_build_object('ref','fixture:retained-native-capture'),'reason','Exact native VIN and current lot, preserve evidence',
 'observations',(SELECT jsonb_agg(jsonb_build_object('id',o.id,'sha256',encode(sha256(convert_to(to_jsonb(o)::text,'UTF8')),'hex')) ORDER BY o.id)
 FROM vehicle_observations o WHERE o.id IN('96000000-0000-4000-8000-000000000001','96000000-0000-4000-8000-000000000002','96000000-0000-4000-8000-000000000003'))))
 FROM auction_events d CROSS JOIN auction_events k CROSS JOIN vehicle_events ep
 WHERE d.id='91000000-0000-4000-8000-000000000002' AND k.id='91000000-0000-4000-8000-000000000001'
 AND ep.id='93000000-0000-4000-8000-000000000001'
$$;
CREATE TEMP TABLE original_comments AS SELECT * FROM auction_comments WHERE auction_event_id='91000000-0000-4000-8000-000000000002';
CREATE TEMP TABLE original_observations AS SELECT * FROM vehicle_observations;
CREATE TEMP TABLE correction_plan AS SELECT pg_temp.native_plan() AS value;
DO $$ DECLARE p jsonb:=pg_temp.native_plan(); bad jsonb; BEGIN
 FOR bad IN SELECT value FROM jsonb_array_elements(jsonb_build_array(
   jsonb_set(p,'{0,expected_event_sha256}','"wrong"'),
   jsonb_set(p,'{0,expected_duplicate_comments}','58'),
   jsonb_set(p,'{0,source_sha256}',to_jsonb(repeat('b',64))),
   jsonb_set(p,'{0,observations}',(p#>'{0,observations}')-0)
 )) LOOP
  BEGIN PERFORM correct_auction_event_link(bad); RAISE EXCEPTION 'unexpected guard success';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM='unexpected guard success' THEN RAISE; END IF; END;
 END LOOP;
 PERFORM pg_temp.ok('guard failures preserve marker and all comments',
 (SELECT duplicate_of IS NULL FROM auction_events WHERE id='91000000-0000-4000-8000-000000000002')
 AND (SELECT count(*)=60 FROM auction_comments WHERE auction_event_id='91000000-0000-4000-8000-000000000002'));
END $$;
-- Force a mid-flight dependent writer refusal: the entire correction must roll back.
DO $$ DECLARE variant integer; rejected boolean; BEGIN
 FOR variant IN 1..7 LOOP
  BEGIN
   IF variant=1 THEN UPDATE vehicle_observations SET extraction_method='unverified' WHERE id='96000000-0000-4000-8000-000000000002';
   ELSIF variant=2 THEN UPDATE vehicle_observations SET structured_data=jsonb_set(structured_data,'{public_live_frame,data,comment,bidAmount}','1') WHERE id='96000000-0000-4000-8000-000000000002';
   ELSIF variant=3 THEN UPDATE vehicles SET vin='JM1FD3337R0303216' WHERE id='90000000-0000-4000-8000-000000000002';
   ELSIF variant=4 THEN UPDATE vehicle_observations SET structured_data=jsonb_set(structured_data,'{source_auction_event_id}','"91000000-0000-4000-8000-000000000099"') WHERE id='96000000-0000-4000-8000-000000000001';
   ELSIF variant=5 THEN UPDATE auction_events SET total_bids=13 WHERE id='91000000-0000-4000-8000-000000000002';
   ELSIF variant=6 THEN UPDATE vehicle_observations SET is_superseded=true WHERE id='96000000-0000-4000-8000-000000000002';
   ELSE UPDATE vehicle_observations SET structured_data=structured_data||'{"projection_error":"failed"}' WHERE id='96000000-0000-4000-8000-000000000002'; END IF;
   rejected:=false;
   BEGIN PERFORM correct_auction_event_link(pg_temp.native_plan()); EXCEPTION WHEN OTHERS THEN rejected:=true; END;
   IF NOT rejected THEN RAISE EXCEPTION 'invalid native witness accepted: %',variant; END IF;
   RAISE EXCEPTION 'restore witness fixture';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'restore witness fixture' THEN RAISE; END IF; END;
 END LOOP;
END $$;
DO $$ BEGIN
 BEGIN
  UPDATE auction_events SET raw_data=jsonb_set(raw_data,'{source_read,at}',to_jsonb((SELECT at+interval '1 minute' FROM native_fixture_clock)))
   WHERE id='91000000-0000-4000-8000-000000000001';
  BEGIN PERFORM correct_auction_event_link(pg_temp.native_plan()); RAISE EXCEPTION 'unexpected newer conflict success';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'native duplicate episode is older than conflicting canonical state' THEN RAISE; END IF; END;
  RAISE EXCEPTION 'restore newer conflict fixture';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'restore newer conflict fixture' THEN RAISE; END IF; END;
 BEGIN
  UPDATE auction_events SET high_bid=57500,total_bids=12,
   raw_data=jsonb_set(raw_data,'{source_read,at}',to_jsonb((SELECT at+interval '1 minute' FROM native_fixture_clock)))
   WHERE id='91000000-0000-4000-8000-000000000001';
  PERFORM correct_auction_event_link(pg_temp.native_plan());
  PERFORM pg_temp.ok('newer same-state canonical clock survives attribution repair',
   (SELECT (raw_data#>>'{source_read,at}')::timestamptz=(SELECT at+interval '1 minute' FROM native_fixture_clock)
    FROM auction_events WHERE id='91000000-0000-4000-8000-000000000001'));
  RAISE EXCEPTION 'restore newer same-state fixture';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'restore newer same-state fixture' THEN RAISE; END IF; END;
END $$;
CREATE FUNCTION pg_temp.reject_episode_move() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic dependent refusal'; END $$;
CREATE TRIGGER reject_episode_move BEFORE UPDATE ON vehicle_events FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_episode_move();
DO $$ BEGIN
 BEGIN PERFORM correct_auction_event_link(pg_temp.native_plan()); RAISE EXCEPTION 'unexpected rollback test success';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'synthetic dependent refusal' THEN RAISE; END IF; END;
 PERFORM pg_temp.ok('mid-flight failure rolls back comments bids marker and audit',
 (SELECT duplicate_of IS NULL FROM auction_events WHERE id='91000000-0000-4000-8000-000000000002')
 AND (SELECT count(*)=60 FROM auction_comments WHERE auction_event_id='91000000-0000-4000-8000-000000000002')
 AND (SELECT count(*)=12 FROM external_auction_bids WHERE auction_event_id='91000000-0000-4000-8000-000000000002' AND superseded_by IS NULL)
 AND NOT EXISTS(SELECT 1 FROM auction_event_duplicate_mark)
 AND NOT EXISTS(SELECT 1 FROM superseded_rows));
END $$;
DROP TRIGGER reject_episode_move ON vehicle_events;
SELECT correct_auction_event_link(value) FROM correction_plan;
SELECT pg_temp.ok('all 59 duplicate comments remain byte-for-byte intact and unique native bid moves',
 (SELECT count(*)=59 FROM auction_comments a JOIN original_comments b USING(id)
 WHERE a.auction_event_id='91000000-0000-4000-8000-000000000002' AND to_jsonb(a)=to_jsonb(b))
 AND (SELECT count(*)=60 FROM auction_comments WHERE auction_event_id='91000000-0000-4000-8000-000000000001'));
SELECT pg_temp.ok('eleven external duplicates supersede and twelve canonical bids remain active',
 (SELECT count(*)=11 FROM external_auction_bids WHERE auction_event_id='91000000-0000-4000-8000-000000000002' AND superseded_by IS NOT NULL)
 AND (SELECT count(*)=12 FROM external_auction_bids WHERE auction_event_id='91000000-0000-4000-8000-000000000001' AND superseded_by IS NULL));
SELECT pg_temp.ok('observation source testimony and clocks survive exact ownership correction',
 (SELECT count(*)=3 FROM vehicle_observations a JOIN original_observations b USING(id)
 WHERE a.vehicle_id='90000000-0000-4000-8000-000000000002'
 AND to_jsonb(a)-'vehicle_id'-'subject_id'-'merged_from_vehicle_id'-'auction_event_id'-'structured_data'
   =to_jsonb(b)-'vehicle_id'-'subject_id'-'merged_from_vehicle_id'-'auction_event_id'-'structured_data'
 AND a.structured_data-'auction_event_id'-'source_auction_event_id'=b.structured_data-'auction_event_id'-'source_auction_event_id'));
SELECT pg_temp.ok('existing typed bindings remap before the sanctioned vehicle relink and absent refs stay absent',
 (SELECT auction_event_id='91000000-0000-4000-8000-000000000001'
 AND source_vehicle_event_id='93000000-0000-4000-8000-000000000001'
 AND structured_data->>'auction_event_id'='91000000-0000-4000-8000-000000000001'
 AND structured_data->>'source_auction_event_id'='91000000-0000-4000-8000-000000000001'
 FROM vehicle_observations WHERE id='96000000-0000-4000-8000-000000000001')
 AND (SELECT auction_event_id IS NULL AND source_vehicle_event_id IS NULL FROM vehicle_observations WHERE id='96000000-0000-4000-8000-000000000002'));
SELECT pg_temp.ok('canonical projection uses retained read clock and episode keeps original currency',
 (SELECT high_bid=57500 AND total_bids=12 AND (raw_data#>>'{source_read,at}')::timestamptz=(SELECT at FROM native_fixture_clock)
 FROM auction_events WHERE id='91000000-0000-4000-8000-000000000001')
 AND (SELECT vehicle_id='90000000-0000-4000-8000-000000000002' AND current_price=57500 AND currency_code='USD'
 FROM vehicle_events WHERE id='93000000-0000-4000-8000-000000000001'));
CREATE TEMP TABLE audit_size AS SELECT count(*) AS n FROM superseded_rows;
INSERT INTO bat_listings(id,bat_listing_url) SELECT '97000000-0000-4000-8000-000000000001',source_url FROM auction_events WHERE id='91000000-0000-4000-8000-000000000002';
INSERT INTO bat_bids(id,bat_listing_id,vehicle_id,bat_username,bid_amount,bid_timestamp,auction_event_id)
 VALUES('98000000-0000-4000-8000-000000000001','97000000-0000-4000-8000-000000000001',
 '90000000-0000-4000-8000-000000000001','retained_duplicate',50000,now(),'91000000-0000-4000-8000-000000000002');
SELECT record_external_auction_bids('bat_bids',ARRAY['98000000-0000-4000-8000-000000000001'::uuid]);
SELECT correct_auction_event_link(value) FROM correction_plan;
SELECT record_external_auction_bids('comment_lot_moves',ARRAY(SELECT id FROM original_comments));
SELECT pg_temp.ok('replay does not create new audit rows or recreate duplicate bids',
 (SELECT count(*)=(SELECT n FROM audit_size) FROM superseded_rows)
 AND NOT EXISTS(SELECT 1 FROM external_auction_bids WHERE auction_event_id='91000000-0000-4000-8000-000000000002' AND superseded_by IS NULL));
SELECT pg_temp.ok('caller timeout budgets remain at three seconds and one second',
 current_setting('statement_timeout')::interval=interval '3 seconds'
 AND current_setting('lock_timeout')::interval=interval '1 second');
SELECT pg_temp.ok('existing service-only correction and bid writer grants survive',
 NOT has_function_privilege('anon','correct_auction_event_link(jsonb,text)','EXECUTE')
 AND NOT has_function_privilege('authenticated','correct_auction_event_link(jsonb,text)','EXECUTE')
 AND has_function_privilege('service_role','correct_auction_event_link(jsonb,text)','EXECUTE')
 AND NOT has_function_privilege('anon','record_external_auction_bids(text,uuid[])','EXECUTE'));

