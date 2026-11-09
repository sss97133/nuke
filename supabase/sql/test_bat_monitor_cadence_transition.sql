-- Uses the existing isolated monitor fixture and actual scheduler function.
\set ON_ERROR_STOP on
\ir test_bat_monitor_episode_identity.sql
DELETE FROM monitored_auctions;
DELETE FROM auction_events;
DELETE FROM vehicle_events;
DELETE FROM vehicles;
DELETE FROM net.calls;
UPDATE live_auction_sources SET scraping_config='{"live_pull":{"lots_per_run":8,"closing_slots":1,"reserve_first_read":1,"cadence_minutes":{"under_12h":60,"h12_to_48":360,"over_48h":1440}}}';

CREATE FUNCTION pg_temp.seed_cadence(label text,ends_in interval,age interval,old_minutes integer,
  success boolean DEFAULT true,live boolean DEFAULT true,receipt boolean DEFAULT true) RETURNS void LANGUAGE sql AS $$
 INSERT INTO monitored_auctions(source_id,external_auction_id,external_auction_url,vehicle_id,
   auction_end_time,is_live,last_synced_at,last_comment_synced_at,sync_latency_ms,next_poll_at,poll_interval_ms)
 SELECT id,label,'https://bringatrailer.com/listing/'||label,gen_random_uuid(),now()+ends_in,live,
   now()-age,CASE WHEN receipt THEN now()-age+interval '1 minute' ELSE now()-age-interval '1 minute' END,
   CASE WHEN success THEN 1000 ELSE NULL END,now()+interval '4 hours',old_minutes*60000
 FROM live_auction_sources WHERE slug='bat';
$$;
SELECT pg_temp.seed_cadence('daily-to-six',interval '40 hours',interval '10 hours',1440);
SELECT pg_temp.seed_cadence('six-to-hour',interval '8 hours',interval '2 hours',360);
SELECT public.bat_live_pull_run(NULL,true);
SELECT pg_temp.ok('old scheduler leaves both transitioned lots unread',(SELECT count(*)=0 FROM net.calls));
SET statement_timeout='3s';
SET lock_timeout='1s';
\ir ../migrations/20261109003500_bat_current_cadence_eligibility.sql
\ir ../migrations/20261109003500_bat_current_cadence_eligibility.sql
SELECT pg_temp.ok('migration restores stricter caller budgets',current_setting('statement_timeout')='3s' AND current_setting('lock_timeout')='1s');
SELECT public.bat_live_pull_run(NULL,true);
SELECT pg_temp.ok('actual scheduler dispatches both current-cadence transitions',(SELECT count(*)=2 FROM net.calls));
SELECT pg_temp.ok('new schedules use existing current cadence',(SELECT bool_and(poll_interval_ms=CASE external_auction_id WHEN 'daily-to-six' THEN 21600000 ELSE 3600000 END) FROM monitored_auctions));
DELETE FROM net.calls;
SELECT public.bat_live_pull_run(NULL,true);
SELECT pg_temp.ok('no immediate duplicate dispatch',(SELECT count(*)=0 FROM net.calls));

DELETE FROM monitored_auctions;
SELECT pg_temp.seed_cadence('failed-backoff',interval '40 hours',interval '10 hours',1440,false);
SELECT pg_temp.seed_cadence('unreconciled',interval '40 hours',interval '10 hours',1440,true,true,false);
SELECT pg_temp.seed_cadence('not-yet-six',interval '40 hours',interval '2 hours',1440);
SELECT pg_temp.seed_cadence('still-daily',interval '60 hours',interval '10 hours',1440);
SELECT pg_temp.seed_cadence('terminal',interval '40 hours',interval '10 hours',1440,true,false);
SELECT pg_temp.seed_cadence('connected',interval '40 hours',interval '10 hours',1440);
UPDATE monitored_auctions SET stream_state=jsonb_build_object('sessions',jsonb_build_object('worker',jsonb_build_object('connected',true,'at',now()))) WHERE external_auction_id='connected';
SELECT public.bat_live_pull_run(NULL,true);
SELECT pg_temp.ok('retry, unreconciled, fresh, unchanged cadence, terminal and connected remain excluded',(SELECT count(*)=0 FROM net.calls));

DELETE FROM monitored_auctions;
SELECT pg_temp.seed_cadence('eligible-'||g,interval '40 hours',interval '10 hours',1440) FROM generate_series(1,20) g;
SELECT public.bat_live_pull_run(NULL,true);
SELECT pg_temp.ok('transition catchup stays within eight existing slots',(SELECT count(*)=8 FROM net.calls));
SELECT pg_temp.ok('cadence config and slot cap unchanged',(SELECT scraping_config#>>'{live_pull,lots_per_run}'='8' AND scraping_config#>>'{live_pull,cadence_minutes,h12_to_48}'='360' FROM live_auction_sources));
