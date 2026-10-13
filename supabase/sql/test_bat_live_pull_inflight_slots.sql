-- Isolated PostgreSQL 17 regression for bat_live_pull_run after 20261013170000 (run-time pause samples, per-slot in-flight
-- accounting, SKIP LOCKED on dispatch and accounting). Synthetic rows only, never production. Loads the actual migrations
-- 20261006060000 (the base body) and 20261013170000 (the forward edit) and proves: the config row loses rest_probes and
-- pause_rest_p50_ms and gains pause_run_p50_ms; no pg_net probe is sent; a run records in_flight, slots_free, run_ms and
-- a run sample; an unread dispatch costs one slot, not the pass; in-flight lots are not re-dispatched; all slots in flight
-- skips dispatch with its own reason; the pause rule reads the run samples and clears when they drop; samples keep the
-- last 10; malformed samples and threshold fall back; a row locked by a second backend is skipped by dispatch and by
-- accounting; the migration applies twice; cron 510 is untouched. Execute in an empty dm_bat_live_pull_inflight_ci
-- database with no auth schema.
\set ON_ERROR_STOP on
DO $$ BEGIN
 IF current_database() <> 'dm_bat_live_pull_inflight_ci'
   OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='auth')
   OR EXISTS(SELECT 1 FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind IN ('r','p','v','m')) THEN
 RAISE EXCEPTION 'Refusing fixtures outside isolated DB'; END IF;
END $$;
SET statement_timeout='30s';
SET lock_timeout='3s';
CREATE SCHEMA net;
CREATE SCHEMA cron;
CREATE TABLE public.live_auction_sources(id uuid PRIMARY KEY,slug text UNIQUE,scraping_config jsonb DEFAULT '{}',
 last_successful_sync timestamptz,consecutive_failures integer DEFAULT 0,health_status text,last_sync_error text);
CREATE TABLE public.monitored_auctions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),source_id uuid,external_auction_id text,
 external_auction_url text,vehicle_id uuid,auction_end_time timestamptz,is_live boolean,current_bid_cents bigint,priority integer,
 last_synced_at timestamptz,next_poll_at timestamptz,poll_interval_ms integer,last_comment_count integer,
 last_comment_synced_at timestamptz,sync_latency_ms integer,stream_state jsonb DEFAULT '{}',UNIQUE(source_id,external_auction_id));
CREATE TABLE public.auction_events(vehicle_id uuid,source_url text,updated_at timestamptz,auction_end_date timestamptz,outcome text);
CREATE TABLE public.auction_comments(vehicle_id uuid);
CREATE TABLE public.vehicles(id uuid PRIMARY KEY,high_bid numeric,auction_end_date text,listing_url text,sale_status text,
 platform_source text,deleted_at timestamptz,origin_metadata jsonb);
CREATE TABLE public.vehicle_events(vehicle_id uuid,source_platform text,event_type text,ended_at timestamptz,source_url text,
 current_price numeric,updated_at timestamptz);
CREATE TABLE net.calls(id bigint GENERATED ALWAYS AS IDENTITY,body jsonb);
CREATE TABLE net._http_response(id bigint,timed_out boolean,status_code integer,created timestamptz);
CREATE FUNCTION net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE i bigint; BEGIN INSERT INTO net.calls(body) VALUES(body) RETURNING id INTO i; RETURN i; END $$;
CREATE FUNCTION net.http_get(url text,headers jsonb,timeout_milliseconds integer) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE i bigint; BEGIN INSERT INTO net.calls(body) VALUES('{"probe":true}') RETURNING id INTO i; RETURN i; END $$;
CREATE FUNCTION public.get_service_role_key_for_cron() RETURNS text LANGUAGE sql AS $$ SELECT 'fixture-key' $$;
CREATE FUNCTION public.get_service_url() RETURNS text LANGUAGE sql AS $$ SELECT 'https://fixture.invalid' $$;
CREATE TABLE cron.job(jobid bigint,jobname text,schedule text,active boolean,command text);
CREATE FUNCTION cron.alter_job(job_id bigint,schedule text DEFAULT NULL,command text DEFAULT NULL,database text DEFAULT NULL,
 username text DEFAULT NULL,active boolean DEFAULT NULL) RETURNS void LANGUAGE sql AS $$
 UPDATE cron.job SET schedule=coalesce(alter_job.schedule,job.schedule),command=coalesce(alter_job.command,job.command),
  active=coalesce(alter_job.active,job.active) WHERE jobid=job_id $$;
CREATE FUNCTION pg_temp.ok(label text,condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %',label; END IF; RAISE NOTICE 'PASS %',label;
END $$;

-- Production shape before 20261006060000, then that migration, then the live 2026-10-13 shape (probe keys present).
INSERT INTO public.live_auction_sources(id,slug,scraping_config) VALUES('00000000-0000-0000-0000-0000000000b1','bat',
 '{"live_pull":{"reader":"extract-bat-core","lots_per_run":3,"cadence_minutes":{"under_12h":60,"h12_to_48":360,"over_48h":1440},
   "pause_rest_p50_ms":2000,"reserve_first_read":1,"priority_window_hours":48,"rest_probes":[],"last_run":{}}}');
INSERT INTO cron.job VALUES(510,'bat-live-pull','* * * * *',true,
 $c$SELECT set_config('app.writer', 'bat-live-pull', true); SET statement_timeout = '50s'; SELECT public.bat_live_pull_run(3);$c$);
\ir ../migrations/20261006060000_bat_live_pull_closing_slot_cap.sql
UPDATE public.live_auction_sources SET scraping_config=jsonb_set(jsonb_set(scraping_config,'{live_pull,pause_rest_p50_ms}','15000'),
 '{live_pull,rest_probes}','[[1,1760000000000],[2,1760000060000]]') WHERE slug='bat';
CREATE TEMP TABLE cron_before AS SELECT * FROM cron.job;

\ir ../migrations/20261013170000_bat_live_pull_run_samples_and_slots.sql

SELECT pg_temp.ok('config loses rest_probes and pause_rest_p50_ms, gains pause_run_p50_ms 15000, keeps the slot keys',
 (SELECT NOT (scraping_config->'live_pull' ? 'rest_probes') AND NOT (scraping_config->'live_pull' ? 'pause_rest_p50_ms')
   AND scraping_config#>>'{live_pull,pause_run_p50_ms}'='15000' AND scraping_config#>>'{live_pull,lots_per_run}'='6'
   AND scraping_config#>>'{live_pull,closing_slots}'='1' AND scraping_config#>>'{live_pull,reserve_first_read}'='1'
  FROM public.live_auction_sources WHERE slug='bat'));
SELECT pg_temp.ok('cron 510 is untouched',
 (SELECT count(*)=1 FROM cron.job j JOIN cron_before b USING(jobid)
  WHERE (j.jobname,j.schedule,j.active,j.command)=(b.jobname,b.schedule,b.active,b.command)));
SELECT pg_temp.ok('the function locks its three dispatch queues and the accounting rows and sends no probe',
 (SELECT (length(d)-length(replace(d,'FOR UPDATE OF m SKIP LOCKED','')))/length('FOR UPDATE OF m SKIP LOCKED')=4
   AND d NOT LIKE '%net.http_get%'
  FROM pg_get_functiondef('public.bat_live_pull_run(integer,boolean)'::regprocedure) d));

-- Fixture board, as the slot test's but with a fixed overdue order: 5 lots closing in 5 min (never read), 8 in-window lots
-- 3 h overdue (window-8 the most overdue, so the rest queue takes 8, 7, 6, 5 first), 1 never-dispatched lot closing in 5 days.
CREATE FUNCTION pg_temp.seed() RETURNS void LANGUAGE sql AS $$
 INSERT INTO public.monitored_auctions(source_id,external_auction_id,external_auction_url,vehicle_id,auction_end_time,is_live,priority,
   last_synced_at,next_poll_at)
 SELECT '00000000-0000-0000-0000-0000000000b1'::uuid,'closing-'||g,'https://bringatrailer.com/listing/closing-'||g,gen_random_uuid(),
   now()+interval '5 minutes',true,1,NULL,NULL FROM generate_series(1,5) g
 UNION ALL
 SELECT '00000000-0000-0000-0000-0000000000b1'::uuid,'window-'||g,'https://bringatrailer.com/listing/window-'||g,gen_random_uuid(),
   now()+interval '24 hours',true,1,now()-interval '9 hours',now()-interval '3 hours'-make_interval(mins=>g) FROM generate_series(1,8) g
 UNION ALL
 SELECT '00000000-0000-0000-0000-0000000000b1'::uuid,'far-1','https://bringatrailer.com/listing/far-1',gen_random_uuid(),
   now()+interval '5 days',true,2,NULL,NULL;
$$;
-- Marks a dispatched lot as read: the reader's auction_events upsert, updated at the dispatch clock.
CREATE FUNCTION pg_temp.land(p_ext text) RETURNS void LANGUAGE sql AS $$
 INSERT INTO public.auction_events(vehicle_id,source_url,updated_at,auction_end_date,outcome)
 SELECT vehicle_id,external_auction_url,last_synced_at,auction_end_time,'active' FROM public.monitored_auctions WHERE external_auction_id=p_ext;
$$;

-- 1. A full run: six slots, no probe, the run sampled.
BEGIN;
SELECT pg_temp.seed();
CREATE TEMP TABLE r1 AS SELECT public.bat_live_pull_run() AS r;
SELECT pg_temp.ok('six HTML reads dispatched, 0 in flight, 6 slots free, no pause, no probe call',
 (SELECT (r->>'dispatched')::int=6 AND (r->>'in_flight')::int=0 AND (r->>'slots_free')::int=6 AND r->>'skipped' IS NULL
   AND (r->>'run_ms')::int>=0 AND r->>'run_p50_ms' IS NULL FROM r1)
 AND (SELECT count(*)=6 FROM net.calls WHERE body ? 'url') AND (SELECT count(*)=0 FROM net.calls WHERE body ? 'probe'));
SELECT pg_temp.ok('closing cap, first-read reserve and the rest queue hold at six slots (1 closing, far-1, window-8 to 5)',
 (SELECT count(*)=1 FROM public.monitored_auctions WHERE last_synced_at=now() AND external_auction_id LIKE 'closing-%')
 AND (SELECT last_synced_at=now() FROM public.monitored_auctions WHERE external_auction_id='far-1')
 AND (SELECT string_agg(external_auction_id,',' ORDER BY external_auction_id)='window-5,window-6,window-7,window-8'
      FROM public.monitored_auctions WHERE last_synced_at=now() AND external_auction_id LIKE 'window-%'));
SELECT pg_temp.ok('last_run records in_flight, slots_free, run_ms, run_p50_ms and one run sample; no rest_probes',
 (SELECT scraping_config#>>'{live_pull,last_run,in_flight}'='0' AND scraping_config#>>'{live_pull,last_run,slots_free}'='6'
   AND (scraping_config#>>'{live_pull,last_run,run_ms}')::int>=0 AND scraping_config#>'{live_pull,last_run}' ? 'run_p50_ms'
   AND jsonb_array_length(scraping_config#>'{live_pull,run_samples}')=1
   AND jsonb_typeof(scraping_config#>'{live_pull,run_samples,0,0}')='number' AND jsonb_typeof(scraping_config#>'{live_pull,run_samples,0,1}')='number'
   AND NOT (scraping_config->'live_pull' ? 'rest_probes')
  FROM public.live_auction_sources WHERE slug='bat'));

-- 2. Two of the six (window-8, window-7) are still unread: the next run keeps four slots and does not re-dispatch them.
SELECT pg_temp.land(external_auction_id) FROM public.monitored_auctions
 WHERE last_synced_at=now() AND external_auction_id NOT IN ('window-8','window-7');
CREATE TEMP TABLE r2 AS SELECT public.bat_live_pull_run() AS r;
SELECT pg_temp.ok('an unread dispatch costs one slot: 2 in flight, 4 slots free, 4 dispatched',
 (SELECT (r->>'in_flight')::int=2 AND (r->>'slots_free')::int=4 AND (r->>'dispatched')::int=4 AND r->>'skipped' IS NULL FROM r2));
SELECT pg_temp.ok('the four slots went to 1 closing lot and window-4 to 2; the two in-flight lots were not dispatched again',
 (SELECT count(*)=2 FROM public.monitored_auctions WHERE last_synced_at=now() AND external_auction_id LIKE 'closing-%')
 AND (SELECT string_agg(external_auction_id,',' ORDER BY external_auction_id)='window-2,window-3,window-4,window-5,window-6,window-7,window-8'
      FROM public.monitored_auctions WHERE last_synced_at=now() AND external_auction_id LIKE 'window-%')
 AND (SELECT count(*)=10 FROM public.monitored_auctions WHERE last_synced_at=now()));
SELECT pg_temp.ok('the run accounted the four landed reads of the first run',
 (SELECT (r->>'accounted')::int=4 AND (r->>'read')::int=4 FROM r2));
ROLLBACK;

-- 3. All six unread: dispatch skipped with its own reason, the rest of the run still happens.
BEGIN;
SELECT pg_temp.seed();
CREATE TEMP TABLE r3a AS SELECT public.bat_live_pull_run() AS r;
CREATE TEMP TABLE r3 AS SELECT public.bat_live_pull_run() AS r;
SELECT pg_temp.ok('all six slots in flight: 0 dispatched, reason recorded, not a pause, stream still dispatched',
 (SELECT (r->>'in_flight')::int=6 AND (r->>'slots_free')::int=0 AND (r->>'dispatched')::int=0
   AND r->>'skipped'='all 6 slots in flight' AND (r->>'stream_lots')::int=5 FROM r3)
 AND (SELECT scraping_config#>>'{live_pull,last_run,paused_since}' IS NULL FROM public.live_auction_sources WHERE slug='bat'));
ROLLBACK;

-- 4. The pause rule reads the run samples and clears when they drop.
BEGIN;
SELECT pg_temp.seed();
UPDATE public.live_auction_sources SET scraping_config=jsonb_set(scraping_config,'{live_pull,run_samples}',
 (SELECT jsonb_agg(jsonb_build_array(1760000000000+g*60000,20000)) FROM generate_series(1,10) g)) WHERE slug='bat';
CREATE TEMP TABLE r4 AS SELECT public.bat_live_pull_run() AS r;
SELECT pg_temp.ok('a 20 s median run time pauses dispatch and degrades health',
 (SELECT (r->>'dispatched')::int=0 AND r->>'skipped' LIKE 'paused: run p50 20000 ms over the last 10 runs%' AND (r->>'run_p50_ms')::int=20000 FROM r4)
 AND (SELECT health_status='degraded' AND last_sync_error LIKE 'paused: run p50%' AND scraping_config#>>'{live_pull,last_run,paused_since}' IS NOT NULL
      FROM public.live_auction_sources WHERE slug='bat'));
UPDATE public.live_auction_sources SET scraping_config=jsonb_set(scraping_config,'{live_pull,run_samples}',
 (SELECT jsonb_agg(jsonb_build_array(1760000000000+g*60000,100)) FROM generate_series(1,10) g)) WHERE slug='bat';
CREATE TEMP TABLE r5 AS SELECT public.bat_live_pull_run() AS r;
SELECT pg_temp.ok('fast samples clear the pause: dispatch resumes, paused_since null',
 (SELECT (r->>'dispatched')::int=6 AND r->>'skipped' IS NULL AND (r->>'run_p50_ms')::int=100 FROM r5)
 AND (SELECT scraping_config#>>'{live_pull,last_run,paused_since}' IS NULL FROM public.live_auction_sources WHERE slug='bat'));
SELECT pg_temp.ok('samples keep the last 10 with this run appended last',
 (SELECT jsonb_array_length(scraping_config#>'{live_pull,run_samples}')=10
   AND (scraping_config#>>'{live_pull,run_samples,9,0}')::bigint > 1760000600000
   AND (scraping_config#>>'{live_pull,run_samples,0,0}')::bigint = 1760000120000
  FROM public.live_auction_sources WHERE slug='bat'));
ROLLBACK;

-- 5. A malformed sample list and a malformed threshold fall back instead of failing the run.
BEGIN;
SELECT pg_temp.seed();
UPDATE public.live_auction_sources SET scraping_config=jsonb_set(jsonb_set(scraping_config,'{live_pull,run_samples}','["x",[1,"y"],[2,30000],[3,30000],[4,30000]]'),
 '{live_pull,pause_run_p50_ms}','"fifteen"') WHERE slug='bat';
CREATE TEMP TABLE r6 AS SELECT public.bat_live_pull_run() AS r;
SELECT pg_temp.ok('malformed samples are ignored, the threshold defaults to 15000, and three 30 s samples still pause',
 (SELECT r->>'skipped' LIKE 'paused: run p50 30000 ms over the last 3 runs%' AND (r->>'dispatched')::int=0 FROM r6));
ROLLBACK;

-- 6. A row another backend holds is skipped by dispatch and by accounting; the run still fills its slots. The second
--    backend only sees committed rows, so this scenario runs in autocommit and cleans up after itself.
CREATE EXTENSION dblink;
SELECT pg_temp.seed();
SELECT dblink_connect('lock_holder',format('host=%s port=%s dbname=%s user=%s',
 split_part(current_setting('unix_socket_directories'),',',1),current_setting('port'),current_database(),current_user));
SELECT dblink_exec('lock_holder','BEGIN');
SELECT * FROM dblink('lock_holder',
 $q$SELECT id FROM public.monitored_auctions WHERE external_auction_id='window-8' FOR UPDATE$q$) AS locked(id uuid);
CREATE TEMP TABLE r7 AS SELECT public.bat_live_pull_run() AS r;
SELECT pg_temp.ok('the most overdue lot, locked elsewhere, is skipped and window-4 takes its slot; six still dispatched',
 (SELECT (r->>'dispatched')::int=6 FROM r7)
 AND (SELECT last_synced_at < now()-interval '1 hour' FROM public.monitored_auctions WHERE external_auction_id='window-8')
 AND (SELECT string_agg(external_auction_id,',' ORDER BY external_auction_id)='window-4,window-5,window-6,window-7'
      FROM public.monitored_auctions WHERE last_synced_at > now()-interval '1 minute' AND external_auction_id LIKE 'window-%'));
SELECT dblink_exec('lock_holder','ROLLBACK');
-- Accounting: window-4 was dispatched and its read lands; a second backend holds its row while the next run accounts.
SELECT pg_temp.land('window-4');
SELECT dblink_exec('lock_holder','BEGIN');
SELECT * FROM dblink('lock_holder',
 $q$SELECT id FROM public.monitored_auctions WHERE external_auction_id='window-4' FOR UPDATE$q$) AS locked(id uuid);
CREATE TEMP TABLE r8 AS SELECT public.bat_live_pull_run() AS r;
SELECT pg_temp.ok('a landed read whose row is locked elsewhere is left for the next minute, not waited on',
 (SELECT (r->>'read')::int=0 FROM r8)
 AND (SELECT last_comment_synced_at IS NULL FROM public.monitored_auctions WHERE external_auction_id='window-4'));
SELECT dblink_exec('lock_holder','ROLLBACK');
CREATE TEMP TABLE r9 AS SELECT public.bat_live_pull_run() AS r;
SELECT pg_temp.ok('once the lock is gone the read is accounted',
 (SELECT (r->>'read')::int=1 FROM r9)
 AND (SELECT last_comment_synced_at > now()-interval '1 minute' FROM public.monitored_auctions WHERE external_auction_id='window-4'));
SELECT dblink_disconnect('lock_holder');
DELETE FROM public.monitored_auctions;
DELETE FROM public.auction_events;
DELETE FROM net.calls;

-- 7. Re-runnable, and the declared threshold is restored.
UPDATE public.live_auction_sources SET scraping_config=jsonb_set(scraping_config,'{live_pull,pause_run_p50_ms}','20000') WHERE slug='bat';
\ir ../migrations/20261013170000_bat_live_pull_run_samples_and_slots.sql
SELECT pg_temp.ok('migration is re-runnable; it sets pause_run_p50_ms to its declared 15000 and still carries no probe keys',
 (SELECT scraping_config#>>'{live_pull,pause_run_p50_ms}'='15000' AND NOT (scraping_config->'live_pull' ? 'rest_probes')
  FROM public.live_auction_sources WHERE slug='bat'));
