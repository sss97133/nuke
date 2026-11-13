-- Actual scheduler plus reviewed relist reconciliation; disposable PG17 only.
\set ON_ERROR_STOP on
\ir test_bat_monitor_relisted_capture.sql
\ir ../migrations/20261109003500_bat_current_cadence_eligibility.sql
DELETE FROM monitored_auctions;
DELETE FROM auction_events;
DELETE FROM vehicle_events;
DELETE FROM vehicles;
DELETE FROM net.calls;
ALTER TABLE auction_events ADD COLUMN source text, ADD COLUMN high_bid numeric,
 ADD COLUMN total_bids integer, ADD COLUMN scraped_at timestamptz;
UPDATE live_auction_sources SET scraping_config='{"live_pull":{"lots_per_run":8,"closing_slots":1,"reserve_first_read":1,"cadence_minutes":{"under_12h":60,"h12_to_48":360,"over_48h":1440}}}';
CREATE FUNCTION pg_temp.seed_legacy(label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v uuid:=gen_random_uuid();
BEGIN
 INSERT INTO monitored_auctions(source_id,external_auction_id,external_auction_url,vehicle_id,
  auction_end_time,is_live,last_synced_at,last_comment_synced_at,sync_latency_ms,next_poll_at,poll_interval_ms)
 SELECT id,label,'https://bringatrailer.com/listing/'||label,v,now()+interval '3 days',true,
  timestamptz '2026-11-08 18:58:00+00',timestamptz '2026-11-08 18:59:00+00',1000,now()+interval '18 hours',86400000
 FROM live_auction_sources WHERE slug='bat';
 INSERT INTO auction_events(vehicle_id,source_url,source,high_bid,total_bids,scraped_at,updated_at,auction_end_date,outcome)
 VALUES(v,'https://bringatrailer.com/listing/'||label,'bat',350000,2,timestamptz '2026-11-08 18:58:05+00',
  timestamptz '2026-11-08 18:58:06+00',now()+interval '3 days','live');
END $$;
SELECT pg_temp.seed_legacy('legacy-current');
SELECT public.bat_live_pull_run(NULL,true);
SELECT pg_temp.ok('old scheduler waits18hours despite missing native context',(SELECT count(*)=0 FROM net.calls));
SET statement_timeout='3s';
SET lock_timeout='1s';
\ir ../migrations/20261109013547_bat_legacy_native_capture_catchup.sql
\ir ../migrations/20261109013547_bat_legacy_native_capture_catchup.sql
SELECT pg_temp.ok('caller stricter budgets restored',current_setting('statement_timeout')='3s' AND current_setting('lock_timeout')='1s');
SELECT public.bat_live_pull_run(NULL,true);
SELECT pg_temp.ok('one capture eligible at existing daily cadence',(SELECT count(*)=1 FROM net.calls)
 AND (SELECT bool_and(poll_interval_ms=86400000 AND last_synced_at>timestamptz '2026-11-08 20:01:29+00') FROM monitored_auctions));
DELETE FROM net.calls;
SELECT public.bat_live_pull_run(NULL,true);
SELECT pg_temp.ok('dispatch fences repeated capability catchup before success',(SELECT count(*)=0 FROM net.calls));
DELETE FROM monitored_auctions;
DELETE FROM auction_events;
SELECT pg_temp.seed_legacy(label) FROM unnest(ARRAY['failed','unreconciled','terminal','new-read','rich-receipt','old-lot','no-bids','quote-only','stale-evidence','foreign-source','connected']) label;
UPDATE monitored_auctions SET sync_latency_ms=NULL WHERE external_auction_id='failed';
UPDATE monitored_auctions SET last_comment_synced_at=last_synced_at-interval '1 minute' WHERE external_auction_id='unreconciled';
UPDATE monitored_auctions SET is_live=false WHERE external_auction_id='terminal';
UPDATE monitored_auctions SET last_synced_at=now(),last_comment_synced_at=now() WHERE external_auction_id='new-read';
UPDATE monitored_auctions SET stream_state=jsonb_build_object('last_observation_id',gen_random_uuid()) WHERE external_auction_id='rich-receipt';
UPDATE monitored_auctions SET stream_state=jsonb_build_object('sessions',jsonb_build_object('worker',jsonb_build_object('connected',true,'at',now()))) WHERE external_auction_id='connected';
UPDATE auction_events SET source_url=source_url||'-previous' WHERE source_url LIKE '%/old-lot';
UPDATE auction_events SET total_bids=0 WHERE source_url LIKE '%/no-bids';
UPDATE auction_events SET high_bid=NULL WHERE source_url LIKE '%/quote-only';
UPDATE auction_events SET scraped_at=timestamptz '2026-11-07 00:00:00+00' WHERE source_url LIKE '%/stale-evidence';
UPDATE auction_events SET source='foreign' WHERE source_url LIKE '%/foreign-source';
SELECT public.bat_live_pull_run(NULL,true);
SELECT pg_temp.ok('failure, ownership, source, freshness, terminal and connected boundaries preserved',(SELECT count(*)=0 FROM net.calls));
DELETE FROM monitored_auctions;
DELETE FROM auction_events;
SELECT pg_temp.seed_legacy('eligible-'||g) FROM generate_series(1,20) g;
SELECT public.bat_live_pull_run(NULL,true);
SELECT pg_temp.ok('twenty legacy cases still consume only existing eight slots',(SELECT count(*)=8 FROM net.calls));
