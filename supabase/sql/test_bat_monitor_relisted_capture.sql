\set ON_ERROR_STOP on
\ir test_bat_monitor_episode_identity.sql
DELETE FROM monitored_auctions;
DELETE FROM auction_events;
DELETE FROM vehicle_events;
DELETE FROM vehicles;
DELETE FROM net.calls;
ALTER TABLE auction_comments ADD COLUMN source_url text;
ALTER TABLE vehicle_observations ADD COLUMN source_id uuid;
CREATE TABLE observation_sources(id uuid PRIMARY KEY,slug text UNIQUE);
INSERT INTO observation_sources VALUES(md5('native-bat')::uuid,'bat'),(md5('foreign')::uuid,'foreign');
INSERT INTO vehicles(id,listing_url,platform_source,sale_status,auction_end_date,origin_metadata) VALUES
 (md5('stub')::uuid,'https://bringatrailer.com/listing/relisted-current','bringatrailer','auction_live',(now()+interval '24 hours')::text,'{"source":"bat_auctions_page","external_id":"123"}'),
 (md5('canonical')::uuid,'https://bringatrailer.com/listing/previous-auction','bringatrailer','sold',(now()-interval '10 days')::text,'{}'),
 (md5('other')::uuid,'https://bringatrailer.com/listing/other','bringatrailer','sold',(now()-interval '10 days')::text,'{}');
INSERT INTO vehicle_events(vehicle_id,source_platform,event_type,event_status,source_url,ended_at,updated_at)
 VALUES(md5('canonical')::uuid,'bat','auction','active','https://bringatrailer.com/listing/relisted-current/',now()+interval '24 hours',now());
INSERT INTO auction_events VALUES(md5('canonical')::uuid,'https://bringatrailer.com/listing/relisted-current',now()-interval '5 seconds',now()+interval '24 hours','live');
INSERT INTO auction_comments VALUES(md5('canonical')::uuid,'https://bringatrailer.com/listing/relisted-current'),
 (md5('canonical')::uuid,'https://bringatrailer.com/listing/relisted-current/'),
 (md5('canonical')::uuid,'https://bringatrailer.com/listing/previous-auction');
INSERT INTO vehicle_observations(id,vehicle_id,kind,source_url,extraction_method,is_superseded,structured_data,vehicle_match_signals,source_id)
 VALUES(md5('receipt')::uuid,md5('canonical')::uuid,'bid','https://bringatrailer.com/listing/relisted-current',
 'bat_public_live_v1',false,'{"native_post_id":123}',jsonb_build_object('monitor_vehicle_id',md5('stub')::uuid,
 'binding_resolved_by','lot_slug','source_url_match',true),md5('native-bat')::uuid);
INSERT INTO monitored_auctions(id,source_id,vehicle_id,external_auction_id,external_auction_url,auction_end_time,is_live,
 last_synced_at,last_comment_synced_at,next_poll_at,stream_state)
 SELECT md5('monitor')::uuid,id,md5('stub')::uuid,'relisted-current','https://bringatrailer.com/listing/relisted-current',
 now()+interval '24 hours',true,now()-interval '1 minute',null,now()+interval '6 hours',jsonb_build_object('last_observation_id',md5('receipt')::uuid)
 FROM live_auction_sources WHERE slug='bat';
SELECT public.bat_live_pull_run(0,false);
SELECT pg_temp.ok('old reconciliation misses successful canonical relist capture',(SELECT last_comment_synced_at IS NULL FROM monitored_auctions WHERE id=md5('monitor')::uuid));
SET statement_timeout='3s'; SET lock_timeout='1s';
\ir ../migrations/20261109012847_bat_relisted_capture_reconciliation.sql
\ir ../migrations/20261109012847_bat_relisted_capture_reconciliation.sql
SELECT public.bat_live_pull_run(0,false);
SELECT pg_temp.ok('relist capture reconciles without rebinding or old-auction counts',(SELECT vehicle_id=md5('stub')::uuid
 AND last_comment_synced_at>=last_synced_at AND sync_latency_ms IS NOT NULL AND last_comment_count=2
 FROM monitored_auctions WHERE id=md5('monitor')::uuid));
SELECT pg_temp.ok('no additional dispatch or changed caller timeout',(SELECT count(*)=0 FROM net.calls)
 AND current_setting('statement_timeout')='3s' AND current_setting('lock_timeout')='1s');

CREATE FUNCTION pg_temp.reset_capture() RETURNS void LANGUAGE sql AS $$
 UPDATE monitored_auctions SET last_comment_synced_at=NULL,sync_latency_ms=NULL WHERE id=md5('monitor')::uuid;
$$;
SELECT pg_temp.reset_capture();
UPDATE vehicle_observations SET structured_data='{"native_post_id":999}';
SELECT public.bat_live_pull_run(0,false);
SELECT pg_temp.ok('foreign native post cannot account the capture',(SELECT last_comment_synced_at IS NULL FROM monitored_auctions WHERE id=md5('monitor')::uuid));
UPDATE vehicle_observations SET structured_data='{"native_post_id":123}',source_url='https://bringatrailer.com/listing/wrong-lot';
SELECT public.bat_live_pull_run(0,false);
SELECT pg_temp.ok('wrong native lot cannot account the capture',(SELECT last_comment_synced_at IS NULL FROM monitored_auctions WHERE id=md5('monitor')::uuid));
UPDATE vehicle_observations SET source_url='https://bringatrailer.com/listing/relisted-current',source_id=md5('foreign')::uuid;
SELECT public.bat_live_pull_run(0,false);
SELECT pg_temp.ok('foreign source cannot account the capture',(SELECT last_comment_synced_at IS NULL FROM monitored_auctions WHERE id=md5('monitor')::uuid));
UPDATE vehicle_observations SET source_id=md5('native-bat')::uuid;
INSERT INTO vehicle_events(vehicle_id,source_platform,source_url) VALUES(md5('other')::uuid,'bat','https://bringatrailer.com/listing/relisted-current');
SELECT public.bat_live_pull_run(0,false);
SELECT pg_temp.ok('ambiguous episode owner cannot account the capture',(SELECT last_comment_synced_at IS NULL FROM monitored_auctions WHERE id=md5('monitor')::uuid));
DELETE FROM vehicle_events WHERE vehicle_id=md5('other')::uuid;
UPDATE monitored_auctions SET stream_state='{}' WHERE id=md5('monitor')::uuid;
SELECT public.bat_live_pull_run(0,false);
SELECT pg_temp.ok('canonical event alone without native witness is insufficient',(SELECT last_comment_synced_at IS NULL FROM monitored_auctions WHERE id=md5('monitor')::uuid));

-- Normal same-vehicle reconciliation remains available without a remap receipt.
UPDATE monitored_auctions SET vehicle_id=md5('canonical')::uuid WHERE id=md5('monitor')::uuid;
SELECT public.bat_live_pull_run(0,false);
SELECT pg_temp.ok('normal own-vehicle capture still reconciles current lot only',(SELECT last_comment_synced_at>=last_synced_at
 AND sync_latency_ms IS NOT NULL AND last_comment_count=2 FROM monitored_auctions WHERE id=md5('monitor')::uuid));
