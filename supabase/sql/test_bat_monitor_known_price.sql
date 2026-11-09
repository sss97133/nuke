-- Disposable actual-scheduler contract; no publisher calls or real net dispatch.
\set ON_ERROR_STOP on
\ir test_bat_monitor_relisted_capture.sql
TRUNCATE monitored_auctions,auction_events,vehicle_events,vehicles,vehicle_observations,auction_comments,net.calls;
ALTER TABLE vehicles ADD COLUMN merged_into_vehicle_id uuid,ADD COLUMN status text;
ALTER TABLE auction_events ADD COLUMN id uuid DEFAULT gen_random_uuid(),ADD COLUMN source text DEFAULT 'bat',
 ADD COLUMN high_bid numeric,ADD COLUMN raw_data jsonb,ADD COLUMN duplicate_of uuid,ADD COLUMN total_bids integer,ADD COLUMN scraped_at timestamptz,ADD COLUMN source_listing_id text;
CREATE VIEW auction_events_canonical AS SELECT * FROM auction_events WHERE duplicate_of IS NULL;
ALTER TABLE vehicle_events ADD COLUMN id uuid DEFAULT gen_random_uuid(),ADD COLUMN sold_at timestamptz,ADD COLUMN duplicate_of_event_id uuid;
ALTER TABLE vehicle_events ADD COLUMN merged_from_vehicle_id uuid;
ALTER TABLE vehicle_observations ADD COLUMN merged_from_vehicle_id uuid,ADD COLUMN raw_source_ref text,
 ADD COLUMN subject_id uuid,ADD COLUMN auction_event_id uuid;
CREATE TABLE auction_event_duplicate_mark(event_id uuid,duplicate_of uuid,vehicle_id uuid,source text,canonical_listing_url text,run_id text,retired_at timestamptz);
CREATE INDEX fixture_duplicate_run ON auction_event_duplicate_mark(run_id);
CREATE TABLE superseded_rows(source_table text,row_id uuid,row_data jsonb,source jsonb,restored_at timestamptz);
CREATE INDEX fixture_beforeimage_row ON superseded_rows(source_table,row_id);
ALTER TABLE observation_sources ADD COLUMN species text DEFAULT 'timed_auction',ADD COLUMN supported_observations text[] DEFAULT ARRAY['bid'];
CREATE TABLE listing_page_snapshots(id uuid PRIMARY KEY,platform text,success boolean,http_status integer,listing_url text,fetched_at timestamptz);
UPDATE live_auction_sources SET scraping_config='{"live_pull":{"lots_per_run":8,"closing_slots":1,"reserve_first_read":1,"cadence_minutes":{"under_12h":60,"h12_to_48":360,"over_48h":1440}}}';
\ir ../migrations/20261109003500_bat_current_cadence_eligibility.sql
\ir ../migrations/20261109013547_bat_legacy_native_capture_catchup.sql
CREATE FUNCTION pg_temp.seed_price(label text,relisted boolean DEFAULT true) RETURNS void LANGUAGE plpgsql AS $$
DECLARE owner_id uuid:=CASE WHEN relisted THEN md5(label||'-owner')::uuid ELSE md5(label)::uuid END;
 lot text:='https://bringatrailer.com/listing/'||label;
BEGIN
 INSERT INTO listing_page_snapshots VALUES(md5(label)::uuid,'bat',true,200,'https://bringatrailer.com/auctions/',now()-interval '5 minutes');
 INSERT INTO vehicles(id,listing_url,platform_source,sale_status,auction_end_date,high_bid,origin_metadata)
 VALUES(md5(label)::uuid,lot,'bringatrailer','auction_live',(now()+interval '3 days')::text,57500,
 jsonb_build_object('source','bat_auctions_page','platform','bringatrailer','external_id','123456',
 'last_sync',now()-interval '5 minutes','source_read_at',now()-interval '5 minutes','source_snapshot_id',md5(label)::uuid,'source_current_bid',57500));
 IF relisted THEN INSERT INTO vehicles(id,listing_url,sale_status) VALUES(owner_id,lot||'-prior','not_sold'); END IF;
 INSERT INTO vehicle_observations(id,vehicle_id,kind,source_url,source_id,extraction_method,is_superseded,structured_data,vehicle_match_signals)
 VALUES(md5(label)::uuid,owner_id,'bid',lot,md5('native-bat')::uuid,'bat_public_live_v1',false,
 jsonb_build_object('native_post_id',123456,'received_at',now()-interval '59 minutes'),
 jsonb_build_object('monitor_vehicle_id',md5(label)::uuid,'binding_resolved_by','lot_slug','source_url_match',true));
 INSERT INTO auction_events(vehicle_id,source_url,updated_at,auction_end_date,outcome,high_bid,total_bids,scraped_at,raw_data)
 VALUES(owner_id,lot,now()-interval '59 minutes',now()+interval '3 days','live',56666,11,now()-interval '59 minutes',
 jsonb_build_object('source_read',jsonb_build_object('at',now()-interval '59 minutes')));
 INSERT INTO vehicle_events(vehicle_id,source_platform,event_type,event_status,ended_at,source_url,current_price,updated_at)
 VALUES(owner_id,'bat','auction','active',now()+interval '3 days',lot,57500,now());
 INSERT INTO monitored_auctions(source_id,external_auction_id,external_auction_url,vehicle_id,auction_end_time,is_live,
 last_synced_at,last_comment_synced_at,sync_latency_ms,next_poll_at,poll_interval_ms,stream_state)
 SELECT id,label,lot,md5(label)::uuid,now()+interval '3 days',true,now()-interval '1 hour',now()-interval '58 minutes',
 1000,now()+interval '23 hours',86400000,jsonb_build_object('last_observation_id',md5(label)::uuid) FROM live_auction_sources WHERE slug='bat';
END $$;
SELECT pg_temp.seed_price('changed-relist'); SELECT pg_temp.seed_price('changed-direct',false);
-- Mutable vehicle price is deliberately unrelated to the retained source quote.
UPDATE vehicles SET high_bid=56666;
SELECT bat_live_pull_run(NULL,true);
SELECT pg_temp.ok('baseline ignores known changed price despite available slots',(SELECT count(*)=0 FROM net.calls));
SET statement_timeout='3s'; SET lock_timeout='1s';
\ir ../migrations/20261109035424_bat_known_price_capture_due.sql
\ir ../migrations/20261109035424_bat_known_price_capture_due.sql
SELECT bat_live_pull_run(NULL,true);
SELECT pg_temp.ok('actual scheduler recovers direct and relisted changed price',(SELECT count(*)=2 FROM net.calls));
SELECT pg_temp.ok('ordinary daily cadence and caller budgets unchanged',(SELECT bool_and(poll_interval_ms=86400000) FROM monitored_auctions)
 AND current_setting('statement_timeout')='3s' AND current_setting('lock_timeout')='1s');
TRUNCATE net.calls;
SELECT bat_live_pull_run(NULL,true);
SELECT pg_temp.ok('dispatch clock prevents repeating the same retained inventory change',(SELECT count(*)=0 FROM net.calls));
TRUNCATE monitored_auctions,auction_events,vehicle_events,vehicles,vehicle_observations,listing_page_snapshots,net.calls;
SELECT pg_temp.seed_price(x) FROM unnest(ARRAY['equal-price','zero-price','old-inventory','future-inventory','wrong-post','wrong-url',
 'failed','unreconciled','connected','terminal','ambiguous','wrong-snapshot','withdrawn','error','newer-native','no-native-clock','merged','wrong-binding','expired-episode',
 'malformed-native-clock','foreign-source','snapshot-clock-mismatch','ambiguous-episode','unknown-quote','string-quote'])x;
UPDATE vehicles SET origin_metadata=jsonb_set(origin_metadata,'{source_current_bid}','56666') WHERE id=md5('equal-price')::uuid;
UPDATE vehicles SET origin_metadata=jsonb_set(origin_metadata,'{source_current_bid}','0') WHERE id=md5('zero-price')::uuid;
UPDATE vehicles SET origin_metadata=origin_metadata-'source_current_bid' WHERE id=md5('unknown-quote')::uuid;
UPDATE vehicles SET origin_metadata=jsonb_set(origin_metadata,'{source_current_bid}','"57500"') WHERE id=md5('string-quote')::uuid;
UPDATE listing_page_snapshots SET fetched_at=now()-interval '2 hours' WHERE id=md5('old-inventory')::uuid;
UPDATE vehicles SET origin_metadata=jsonb_set(origin_metadata,'{source_read_at}',to_jsonb(now()-interval '2 hours')) WHERE id=md5('old-inventory')::uuid;
UPDATE listing_page_snapshots SET fetched_at=now()+interval '2 hours' WHERE id=md5('future-inventory')::uuid;
UPDATE vehicles SET origin_metadata=jsonb_set(origin_metadata,'{source_read_at}',to_jsonb(now()+interval '2 hours')) WHERE id=md5('future-inventory')::uuid;
UPDATE vehicle_observations SET structured_data=structured_data||'{"native_post_id":654321}' WHERE id=md5('wrong-post')::uuid;
UPDATE vehicle_observations SET source_url=source_url||'-foreign' WHERE id=md5('wrong-url')::uuid;
UPDATE monitored_auctions SET sync_latency_ms=NULL WHERE external_auction_id='failed';
UPDATE monitored_auctions SET last_synced_at=now()-interval '1 minute',last_comment_synced_at=now()-interval '2 minutes' WHERE external_auction_id='unreconciled';
UPDATE monitored_auctions SET stream_state=stream_state||jsonb_build_object('sessions',jsonb_build_object('worker',jsonb_build_object('connected',true,'at',now()))) WHERE external_auction_id='connected';
UPDATE auction_events SET outcome='sold' WHERE source_url LIKE '%/terminal';
INSERT INTO auction_events(vehicle_id,source_url,outcome) SELECT vehicle_id,source_url,'live' FROM auction_events WHERE source_url LIKE '%/ambiguous';
UPDATE listing_page_snapshots SET listing_url='https://foreign.invalid/auctions/' WHERE id=md5('wrong-snapshot')::uuid;
UPDATE vehicle_observations SET is_superseded=true WHERE id=md5('withdrawn')::uuid;
UPDATE vehicle_observations SET structured_data=structured_data||'{"projection_error":"test"}' WHERE id=md5('error')::uuid;
UPDATE auction_events SET raw_data=jsonb_build_object('source_read',jsonb_build_object('at',now())) WHERE source_url LIKE '%/newer-native';
UPDATE auction_events SET raw_data='{}' WHERE source_url LIKE '%/no-native-clock';
UPDATE vehicles SET merged_into_vehicle_id=md5('another')::uuid WHERE id=md5('merged')::uuid;
UPDATE vehicle_observations SET vehicle_match_signals='{}' WHERE id=md5('wrong-binding')::uuid;
UPDATE vehicle_events SET ended_at=now()-interval '1 day' WHERE source_url LIKE '%/expired-episode';
UPDATE auction_events SET raw_data=jsonb_build_object('source_read',jsonb_build_object('at','invalid'),
 'live_stream',jsonb_build_object('last_frame_received_at',now()-interval '1 hour')) WHERE source_url LIKE '%/malformed-native-clock';
UPDATE vehicle_observations SET source_id=md5('foreign')::uuid WHERE id=md5('foreign-source')::uuid;
UPDATE listing_page_snapshots SET fetched_at=now()-interval '4 minutes' WHERE id=md5('snapshot-clock-mismatch')::uuid;
INSERT INTO vehicle_events(vehicle_id,source_platform,event_type,event_status,ended_at,source_url,current_price)
 SELECT vehicle_id,source_platform,event_type,event_status,ended_at,source_url,current_price FROM vehicle_events WHERE source_url LIKE '%/ambiguous-episode';
SELECT bat_live_pull_run(NULL,true);
SELECT pg_temp.ok('source identity clock ambiguity failure connected and terminal exclusions',(SELECT count(*)=0 FROM net.calls));
TRUNCATE monitored_auctions,auction_events,vehicle_events,vehicles,vehicle_observations,listing_page_snapshots,net.calls;
SELECT pg_temp.seed_price('cap-'||g) FROM generate_series(1,20)g;
SELECT bat_live_pull_run(NULL,true);
SELECT pg_temp.ok('known price recovery consumes at most eight existing slots',(SELECT count(*)=8 FROM net.calls));
SELECT pg_temp.ok('slot and source cadence configuration unchanged',(SELECT scraping_config#>>'{live_pull,lots_per_run}'='8'
 AND scraping_config#>>'{live_pull,cadence_minutes,over_48h}'='1440' FROM live_auction_sources));
TRUNCATE monitored_auctions,auction_events,vehicle_events,vehicles,vehicle_observations,listing_page_snapshots,net.calls;
SELECT pg_temp.seed_price('priority-'||g) FROM generate_series(1,20)g;
SELECT pg_temp.seed_price('closing-one'); SELECT pg_temp.seed_price('closing-two'); SELECT pg_temp.seed_price('first-read');
UPDATE vehicles SET auction_end_date=(now()+interval '5 minutes')::text WHERE listing_url LIKE '%/closing-%';
UPDATE monitored_auctions SET auction_end_time=now()+interval '5 minutes' WHERE external_auction_id LIKE 'closing-%';
UPDATE auction_events SET auction_end_date=now()+interval '5 minutes' WHERE source_url LIKE '%/closing-%';
UPDATE vehicle_events SET ended_at=now()+interval '5 minutes' WHERE source_url LIKE '%/closing-%';
UPDATE monitored_auctions SET next_poll_at=NULL,last_synced_at=NULL WHERE external_auction_id='first-read';
SELECT bat_live_pull_run(NULL,true);
SELECT pg_temp.ok('closing reserve first read and eight-slot budget survive price backlog',
 (SELECT count(*)=8 FROM net.calls WHERE body ? 'url')
 AND (SELECT count(*)=1 FROM net.calls WHERE body->>'url' LIKE '%/closing-%')
 AND (SELECT count(*)=1 FROM net.calls WHERE body->>'url' LIKE '%/first-read')
 AND (SELECT count(*)=6 FROM net.calls WHERE body->>'url' LIKE '%/priority-%'));
TRUNCATE net.calls;
UPDATE live_auction_sources SET scraping_config=jsonb_set(scraping_config,'{live_pull,run_samples}',
 '[[1,20000],[2,20000],[3,20000]]');
SELECT bat_live_pull_run(NULL,true);
SELECT pg_temp.ok('existing scheduler pause blocks all HTML price-change dispatch',NOT EXISTS(SELECT FROM net.calls WHERE body ? 'url'));
TRUNCATE monitored_auctions,auction_events,vehicle_events,vehicles,vehicle_observations,listing_page_snapshots,net.calls;
UPDATE live_auction_sources SET scraping_config=jsonb_set(scraping_config,'{live_pull,run_samples}','[]');
CREATE FUNCTION pg_temp.seed_corrected_price(label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE canonical_event uuid;duplicate_event uuid:=gen_random_uuid();evidence jsonb;
BEGIN
 PERFORM pg_temp.seed_price(label);
 SELECT id INTO STRICT canonical_event FROM auction_events WHERE vehicle_id=md5(label||'-owner')::uuid;
 evidence:=jsonb_build_object('run_id',label,'canonical_event_id',canonical_event,'native_post_id','123456','ref','retained:correction');
 UPDATE auction_events SET source_listing_id=label,raw_data=raw_data||jsonb_build_object('link_correction',evidence) WHERE id=canonical_event;
 INSERT INTO auction_events(id,vehicle_id,source_url,source_listing_id,duplicate_of,outcome)
 VALUES(duplicate_event,md5(label)::uuid,'https://bringatrailer.com/listing/'||label,label,canonical_event,'live');
 INSERT INTO auction_event_duplicate_mark VALUES(duplicate_event,canonical_event,md5(label)::uuid,'bat','https://bringatrailer.com/listing/'||label,label,NULL);
 UPDATE vehicle_observations SET vehicle_id=md5(label)::uuid,subject_id=md5(label)::uuid,
 raw_source_ref='bat:public-live:post:123456',vehicle_match_signals='{"binding":"bat_auctions_page","native_post_id":"123456","source_url_match":true}'
 WHERE id=md5(label)::uuid;
 INSERT INTO superseded_rows(source_table,row_id,row_data,source) SELECT 'vehicle_observations',id,to_jsonb(o),evidence FROM vehicle_observations o WHERE id=md5(label)::uuid;
 UPDATE vehicle_observations SET vehicle_id=md5(label||'-owner')::uuid,subject_id=md5(label||'-owner')::uuid,merged_from_vehicle_id=md5(label)::uuid WHERE id=md5(label)::uuid;
 UPDATE vehicle_events SET merged_from_vehicle_id=md5(label)::uuid WHERE vehicle_id=md5(label||'-owner')::uuid;
END $$;
SELECT pg_temp.seed_corrected_price('corrected-price');
SELECT bat_live_pull_run(NULL,true);
SELECT pg_temp.ok('preserved original binding gains eligibility only through sanctioned correction lineage',
 (SELECT count(*)=1 FROM net.calls WHERE body->>'url' LIKE '%/corrected-price')
 AND (SELECT NOT(vehicle_match_signals ? 'monitor_vehicle_id') AND vehicle_match_signals->>'binding'='bat_auctions_page'
 FROM vehicle_observations WHERE id=md5('corrected-price')::uuid));
-- A later native capture legitimately supplies ordinary lot_slug binding. The
-- preserved duplicate must not block accounting, but an unmarked owner still does.
INSERT INTO vehicle_observations SELECT (jsonb_populate_record(NULL::vehicle_observations,to_jsonb(o)||jsonb_build_object(
 'id',md5('corrected-price-next')::uuid,'structured_data',o.structured_data||jsonb_build_object('received_at',now()),
 'vehicle_match_signals',jsonb_build_object('monitor_vehicle_id',md5('corrected-price')::uuid,
 'binding_resolved_by','lot_slug','source_url_match',true)))).* FROM vehicle_observations o WHERE id=md5('corrected-price')::uuid;
UPDATE monitored_auctions SET stream_state=jsonb_set(stream_state,'{last_observation_id}',to_jsonb(md5('corrected-price-next')::uuid)) WHERE external_auction_id='corrected-price';
UPDATE auction_events SET updated_at=now(),high_bid=57500,total_bids=12,
 raw_data=jsonb_set(raw_data,'{source_read,at}',to_jsonb(now())) WHERE vehicle_id=md5('corrected-price-owner')::uuid;
INSERT INTO auction_comments SELECT md5('corrected-price-owner')::uuid,'https://bringatrailer.com/listing/corrected-price' FROM generate_series(1,12);
SELECT bat_live_pull_run(0,false);
SELECT pg_temp.ok('postdispatch native capture reconciles despite preserved marked duplicate',
 (SELECT last_comment_synced_at>=last_synced_at AND sync_latency_ms IS NOT NULL AND poll_interval_ms=86400000 AND last_comment_count=12
 FROM monitored_auctions WHERE external_auction_id='corrected-price'));
INSERT INTO auction_events(vehicle_id,source_url,outcome) VALUES(md5('foreign-owner')::uuid,'https://bringatrailer.com/listing/corrected-price','live');
UPDATE monitored_auctions SET last_comment_synced_at=NULL,last_synced_at=now()-interval '1 minute' WHERE external_auction_id='corrected-price';
SELECT bat_live_pull_run(0,false);
SELECT pg_temp.ok('unmarked competing auction still prevents canonical reconciliation',
 (SELECT last_comment_synced_at IS NULL FROM monitored_auctions WHERE external_auction_id='corrected-price'));
TRUNCATE monitored_auctions,auction_events,vehicle_events,vehicles,vehicle_observations,listing_page_snapshots,net.calls,auction_event_duplicate_mark,superseded_rows;
SELECT pg_temp.seed_corrected_price(x) FROM unnest(ARRAY['audit-missing','audit-owner','audit-payload','audit-clock','audit-source',
 'retired-marker','wrong-run','marker-owner','episode-lineage','duplicate-link','wrong-native-post',
 'current-foreign-ref','current-structured-ref','before-foreign-ref','before-structured-ref','restored-audit'])x;
DELETE FROM superseded_rows WHERE row_id=md5('audit-missing')::uuid;
UPDATE superseded_rows SET row_data=jsonb_set(row_data,'{vehicle_id}',to_jsonb(md5('foreign')::uuid)) WHERE row_id=md5('audit-owner')::uuid;
UPDATE superseded_rows SET row_data=jsonb_set(row_data,'{structured_data,unknown_payload}','"changed"') WHERE row_id=md5('audit-payload')::uuid;
UPDATE superseded_rows SET row_data=jsonb_set(row_data,'{structured_data,received_at}',to_jsonb(now())) WHERE row_id=md5('audit-clock')::uuid;
UPDATE superseded_rows SET row_data=jsonb_set(row_data,'{source_id}',to_jsonb(md5('foreign')::uuid)) WHERE row_id=md5('audit-source')::uuid;
UPDATE auction_event_duplicate_mark SET retired_at=now() WHERE run_id='retired-marker';
UPDATE auction_event_duplicate_mark SET run_id='foreign-run' WHERE run_id='wrong-run';
UPDATE auction_event_duplicate_mark SET vehicle_id=md5('foreign')::uuid WHERE run_id='marker-owner';
UPDATE vehicle_events SET merged_from_vehicle_id=NULL WHERE source_url LIKE '%/episode-lineage';
UPDATE auction_events SET duplicate_of=md5('foreign')::uuid WHERE vehicle_id=md5('duplicate-link')::uuid;
UPDATE auction_events SET raw_data=jsonb_set(raw_data,'{link_correction,native_post_id}','"999999"') WHERE vehicle_id=md5('wrong-native-post-owner')::uuid;
UPDATE vehicle_observations SET auction_event_id=md5('foreign')::uuid WHERE id=md5('current-foreign-ref')::uuid;
UPDATE vehicle_observations SET structured_data=structured_data||jsonb_build_object('source_auction_event_id',md5('foreign')::uuid) WHERE id=md5('current-structured-ref')::uuid;
UPDATE superseded_rows SET row_data=jsonb_set(row_data,'{auction_event_id}',to_jsonb(md5('foreign')::uuid)) WHERE row_id=md5('before-foreign-ref')::uuid;
UPDATE superseded_rows SET row_data=jsonb_set(row_data,'{structured_data,auction_event_id}',to_jsonb(md5('foreign')::uuid)) WHERE row_id=md5('before-structured-ref')::uuid;
UPDATE superseded_rows SET restored_at=now() WHERE row_id=md5('restored-audit')::uuid;
SELECT bat_live_pull_run(NULL,true);
SELECT pg_temp.ok('missing or conflicting correction lineage never relaxes ordinary native binding',(SELECT count(*)=0 FROM net.calls));
