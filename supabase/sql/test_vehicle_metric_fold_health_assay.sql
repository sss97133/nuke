-- Real migration and PostgreSQL semantics in an empty disposable PG17 database.
-- psql -X -v ON_ERROR_STOP=1 -d dm_fold_assay -f this-file.sql
-- Synthetic fixtures only; no production testimony, functions or cron extension.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_fold_assay%'
     OR current_setting('server_version_num')::int / 10000 <> 17
     OR to_regclass('public.vehicles') IS NOT NULL
     OR to_regclass('cron.job') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable dm_fold_assay* database';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA cron;
CREATE TABLE cron.job(jobid bigint PRIMARY KEY,jobname text,schedule text,active boolean,command text);
CREATE TABLE cron.job_run_details(runid bigint PRIMARY KEY,jobid bigint,status text,start_time timestamptz,return_message text);
CREATE TABLE public.vehicles(id uuid PRIMARY KEY,observation_count integer,source text,created_at timestamptz);
CREATE TABLE public.vehicle_observations(
  id uuid PRIMARY KEY,vehicle_id uuid REFERENCES public.vehicles(id),kind text,
  observed_at timestamptz,ingested_at timestamptz,is_superseded boolean DEFAULT false
);
CREATE INDEX idx_observations_vehicle ON public.vehicle_observations(vehicle_id) WHERE vehicle_id IS NOT NULL;
CREATE INDEX idx_vehicle_observations_ingested_at ON public.vehicle_observations(ingested_at DESC);
CREATE TABLE public.vehicle_live_metrics(
  vehicle_id uuid PRIMARY KEY,observation_count integer,comment_count integer,last_observation_at timestamptz,updated_at timestamptz
);
CREATE TABLE public.vehicle_metric_recompute_queue(
  vehicle_id uuid PRIMARY KEY REFERENCES public.vehicles(id),live_metrics_dirty boolean NOT NULL DEFAULT false,
  observation_count_dirty boolean NOT NULL DEFAULT false,queued_at timestamptz NOT NULL DEFAULT now(),
  attempts smallint NOT NULL DEFAULT 0,last_error text
);
CREATE INDEX idx_vehicle_metric_recompute_queue_queued_at ON public.vehicle_metric_recompute_queue(queued_at);
CREATE TABLE public.pipeline_registry(
  table_name text,column_name text,owned_by text,description text,do_not_write_directly boolean,write_via text,
  UNIQUE(table_name,column_name)
);
CREATE TABLE public.listing_feeds(id uuid PRIMARY KEY,last_error text);
CREATE TABLE public.admin_notifications(
  notification_type text,title text,message text,action_required text,priority integer,
  metadata jsonb,created_at timestamptz DEFAULT now()
);
CREATE INDEX idx_admin_notifications_created_at ON public.admin_notifications(created_at DESC);
CREATE FUNCTION public.get_pipeline_pulse_24h() RETURNS jsonb LANGUAGE sql STABLE AS
$$ SELECT '{"fixture":"outside_assay_scope"}'::jsonb $$;
CREATE FUNCTION public.pipeline_heartbeat() RETURNS void LANGUAGE plpgsql AS $$ BEGIN RETURN; END $$;
REVOKE ALL ON FUNCTION public.pipeline_heartbeat() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pipeline_heartbeat() TO service_role;
-- Existing view's names, types, order and access are the compatibility contract.
CREATE VIEW public.v_job_health AS SELECT
  j.jobid,j.jobname,j.schedule,j.active,0::bigint runs_24h,0::bigint failed_24h,
  0::bigint consecutive_failures,NULL::text last_status,NULL::timestamptz last_run_at,
  NULL::text last_error,NULL::text declared_writer,j.command FROM cron.job j;
REVOKE ALL ON public.v_job_health FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.v_job_health TO service_role;
GRANT USAGE ON SCHEMA public,cron TO service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA public,cron TO service_role;
GRANT INSERT ON public.admin_notifications TO service_role;

\ir ../migrations/20261004040221_vehicle_metric_fold_health_assay.sql
BEGIN;
SET LOCAL track_functions='all';

INSERT INTO cron.job VALUES
 (500,'drain-vehicle-derived-queues','*/5 * * * *',true,'SELECT public.drain_vehicle_derived_queues()'),
 (486,'pipeline-heartbeat','0 */6 * * *',true,'SELECT public.pipeline_heartbeat()');
INSERT INTO cron.job_run_details VALUES
 (1,500,'succeeded',statement_timestamp(),'success'),
 (2,486,'succeeded',statement_timestamp(),'success');
INSERT INTO public.vehicles VALUES
 ('11111111-1111-1111-1111-111111111111',2,'fixture',statement_timestamp()),
 ('22222222-2222-2222-2222-222222222222',0,'fixture',statement_timestamp());
INSERT INTO public.vehicle_observations VALUES
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1','11111111-1111-1111-1111-111111111111','listing',
  '2020-01-01',statement_timestamp()-interval '20 minutes',false),
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2','11111111-1111-1111-1111-111111111111','comment',
  '2020-02-01',statement_timestamp()-interval '20 minutes',false);
INSERT INTO public.vehicle_live_metrics VALUES
 ('11111111-1111-1111-1111-111111111111',2,1,'2020-02-01',statement_timestamp());

-- Actual service reader; existing public readers remain denied, never fail open.
SET LOCAL ROLE service_role;
DO $$ DECLARE a jsonb; BEGIN
  a:=public.assay_vehicle_metric_fold();
  ASSERT a->>'status'='passed' AND (a->'counts'->>'vehicles_matching')::int=1;
  ASSERT (SELECT health_status='passed' AND last_status='succeeded' FROM public.v_job_health WHERE jobid=500);
  ASSERT (SELECT array_agg(column_name::text ORDER BY ordinal_position)
    FROM information_schema.columns WHERE table_schema='public' AND table_name='v_job_health') =
    ARRAY['jobid','jobname','schedule','active','runs_24h','failed_24h','consecutive_failures',
      'last_status','last_run_at','last_error','declared_writer','command','assay_status','assay','health_status'];
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN PERFORM * FROM public.v_job_health; RAISE EXCEPTION 'anon read leaked';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.assay_vehicle_metric_fold(); RAISE EXCEPTION 'anon helper leaked';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN PERFORM * FROM public.v_job_health; RAISE EXCEPTION 'authenticated read leaked';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.assay_vehicle_metric_fold(); RAISE EXCEPTION 'authenticated helper leaked';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

-- Lost queue work: cron succeeds, no queue remains, but output is absent/wrong.
UPDATE public.vehicle_live_metrics SET comment_count=0;
DO $$ DECLARE a jsonb; BEGIN
 a:=public.assay_vehicle_metric_fold();
 ASSERT a->>'status'='failed' AND a->'reasons' ? 'metric_output_mismatch';
 ASSERT (SELECT last_status='succeeded' AND failed_24h=0 AND health_status='failed'
   FROM public.v_job_health WHERE jobid=500), 'Cron success cannot hide wrong landed output';
END $$;
DELETE FROM public.vehicle_live_metrics;
DO $$ BEGIN ASSERT public.assay_vehicle_metric_fold()->>'status'='failed', 'Missing fold also fails'; END $$;
INSERT INTO public.vehicle_live_metrics VALUES
 ('11111111-1111-1111-1111-111111111111',2,1,'2020-02-01',statement_timestamp());

-- Fresh queue grace, exact 15-minute boundary, retries even after renewed clocks.
UPDATE public.vehicle_live_metrics SET observation_count=1;
INSERT INTO public.vehicle_metric_recompute_queue(vehicle_id,live_metrics_dirty,queued_at)
 VALUES('11111111-1111-1111-1111-111111111111',true,statement_timestamp()-interval '14 minutes');
DO $$ BEGIN ASSERT public.assay_vehicle_metric_fold()->>'status'='idle', 'Fresh queued replay has grace'; END $$;
DO $$ DECLARE a jsonb; BEGIN
 UPDATE public.vehicle_metric_recompute_queue SET queued_at=statement_timestamp()-interval '15 minutes';
 a:=public.assay_vehicle_metric_fold();
 ASSERT a->>'status'='failed' AND a->'reasons' ? 'metric_queue_overdue', 'Boundary is inclusive';
 UPDATE public.vehicle_metric_recompute_queue SET queued_at=statement_timestamp(),attempts=2,last_error='PRIVATE FIXTURE ERROR';
 a:=public.assay_vehicle_metric_fold();
 ASSERT a->>'status'='failed' AND a->'reasons' ? 'metric_queue_retry_error';
 ASSERT a::text NOT LIKE '%PRIVATE%' AND a::text NOT LIKE '%11111111%', 'Aggregate assay must not expose IDs/errors';
 ASSERT (a->'counts'->>'max_attempts_sampled')::int=2;
END $$;

-- Existing heartbeat reader surfaces the output alarm despite cron success;
-- independent intake dedup does not mask it, and no extra schedule is created.
INSERT INTO public.admin_notifications(notification_type,metadata)
 VALUES('system_alert','{"kind":"pipeline_heartbeat"}');
SET LOCAL ROLE service_role;
SELECT public.pipeline_heartbeat();
SELECT public.pipeline_heartbeat();
RESET ROLE;
DO $$ BEGIN
 ASSERT (SELECT count(*)=1 FROM public.admin_notifications WHERE metadata->>'kind'='cron_health');
 ASSERT (SELECT metadata->'reasons'::text IS NOT NULL FROM public.admin_notifications WHERE metadata->>'kind'='cron_health');
 ASSERT (SELECT message LIKE '%fold_assay:%' AND message NOT LIKE '%PRIVATE%'
   FROM public.admin_notifications WHERE metadata->>'kind'='cron_health');
 ASSERT (SELECT count(*)=2 FROM cron.job), 'Existing cadence only, no parallel cron';
END $$;

-- Recovery: canonical worker clears retained queue only after successful replay.
UPDATE public.vehicle_live_metrics SET observation_count=2,updated_at=statement_timestamp();
DELETE FROM public.vehicle_metric_recompute_queue;
DO $$ BEGIN ASSERT public.assay_vehicle_metric_fold()->>'status'='passed'; END $$;
INSERT INTO public.vehicle_metric_recompute_queue(vehicle_id,live_metrics_dirty,queued_at)
 VALUES('11111111-1111-1111-1111-111111111111',true,statement_timestamp()+interval '1 day');
DO $$ BEGIN
 ASSERT public.assay_vehicle_metric_fold()->>'status'='partial', 'Invalid work clock cannot hide stale work as fresh';
END $$;
DELETE FROM public.vehicle_metric_recompute_queue;

-- Late source events use ingest grace, never their old event time as freshness.
INSERT INTO public.vehicle_observations VALUES
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3','11111111-1111-1111-1111-111111111111','comment',
  '2010-01-01',statement_timestamp()-interval '14 minutes',false);
DO $$ BEGIN ASSERT public.assay_vehicle_metric_fold()->>'status'='idle', 'Late event has ingestion grace'; END $$;
DO $$ BEGIN
 UPDATE public.vehicle_observations SET ingested_at=statement_timestamp()-interval '15 minutes'
 WHERE id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
 ASSERT public.assay_vehicle_metric_fold()->>'status'='failed', 'Late source missed count despite unchanged event max';
END $$;
UPDATE public.vehicles SET observation_count=3 WHERE id='11111111-1111-1111-1111-111111111111';
UPDATE public.vehicle_live_metrics SET observation_count=3,comment_count=2,updated_at=statement_timestamp();
DO $$ BEGIN ASSERT public.assay_vehicle_metric_fold()->>'status'='passed'; END $$;
UPDATE public.vehicle_live_metrics SET updated_at=statement_timestamp()-interval '1 hour';
DO $$ BEGIN ASSERT public.assay_vehicle_metric_fold()->>'status'='failed', 'Fold computation cannot predate known input'; END $$;
UPDATE public.vehicle_live_metrics SET updated_at=statement_timestamp();

-- Supersession retains testimony in the current ALL-observation metric contract.
UPDATE public.vehicle_observations SET is_superseded=true WHERE id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
DO $$ BEGIN ASSERT public.assay_vehicle_metric_fold()->>'status'='passed'; END $$;
-- Relinking dirties both existing heads; old head with no remaining observations
-- is still assayed through durable queued work, and errors are never erased.
UPDATE public.vehicle_observations SET vehicle_id='22222222-2222-2222-2222-222222222222';
INSERT INTO public.vehicle_metric_recompute_queue(vehicle_id,live_metrics_dirty,observation_count_dirty,queued_at)
 SELECT id,true,true,statement_timestamp()-interval '16 minutes' FROM public.vehicles;
DO $$ DECLARE a jsonb; BEGIN
 a:=public.assay_vehicle_metric_fold();
 ASSERT (a->'counts'->>'vehicles_eligible')::int=2 AND (a->'counts'->>'vehicles_mismatching')::int=2;
 ASSERT a->>'status'='failed', 'Old zero-input and new linked heads must both fail before replay';
END $$;
UPDATE public.vehicles SET observation_count=CASE WHEN id='11111111-1111-1111-1111-111111111111' THEN 0 ELSE 3 END;
UPDATE public.vehicle_live_metrics SET observation_count=0,comment_count=0,last_observation_at=NULL,updated_at=statement_timestamp();
INSERT INTO public.vehicle_live_metrics VALUES('22222222-2222-2222-2222-222222222222',3,2,'2020-02-01',statement_timestamp());
DELETE FROM public.vehicle_metric_recompute_queue;
DO $$ BEGIN ASSERT public.assay_vehicle_metric_fold()->>'status'='passed'; END $$;

-- Unknown clock and oversized point reads cannot claim complete verification.
UPDATE public.vehicle_observations SET ingested_at=NULL WHERE id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
DO $$ BEGIN ASSERT public.assay_vehicle_metric_fold()->>'status'='partial'; END $$;
UPDATE public.vehicle_observations SET ingested_at=statement_timestamp()+interval '1 day'
 WHERE id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
DO $$ BEGIN ASSERT public.assay_vehicle_metric_fold()->>'status'='partial'; END $$;
UPDATE public.vehicle_observations SET ingested_at=statement_timestamp()-interval '20 minutes'
 WHERE id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
INSERT INTO public.vehicle_observations
 SELECT md5('oversize-'||i)::uuid,'22222222-2222-2222-2222-222222222222','comment',
  '2010-01-01',statement_timestamp()-interval '20 minutes',false FROM generate_series(1,5000) i;
DO $$ DECLARE a jsonb; BEGIN
 a:=public.assay_vehicle_metric_fold();
 ASSERT a->>'status'='partial' AND (a->'counts'->>'vehicles_over_scan_cap')::int=1;
 ASSERT (SELECT health_status='unknown' FROM public.v_job_health WHERE jobid=500);
END $$;
DELETE FROM public.vehicle_observations WHERE observed_at='2010-01-01' AND id<>'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';

-- Queue counters are explicit lower bounds when capped, even if every sampled
-- task is fresh. More than 100 source vehicles never turns into a fleet claim.
INSERT INTO public.vehicles
 SELECT md5('sample-'||i)::uuid,0,'fixture',statement_timestamp() FROM generate_series(1,1001) i;
INSERT INTO public.vehicle_metric_recompute_queue(vehicle_id,live_metrics_dirty,queued_at)
 SELECT md5('sample-'||i)::uuid,true,statement_timestamp() FROM generate_series(1,1001) i;
DO $$ DECLARE a jsonb; BEGIN
 a:=public.assay_vehicle_metric_fold();
 ASSERT a->>'status'='partial' AND a->'reasons' ? 'queue_sample_capped';
 ASSERT (a->'counts'->>'queue_sampled')::int=1001;
 ASSERT (a->'counts'->>'vehicles_sampled')::int<=100;
END $$;
DELETE FROM public.vehicle_metric_recompute_queue;
INSERT INTO public.vehicle_observations
 SELECT md5('sample-event-'||i)::uuid,md5('sample-'||i)::uuid,'listing','2021-01-01',
  statement_timestamp()-interval '16 minutes'-i*interval '1 second',false FROM generate_series(1,101) i;
UPDATE public.vehicles SET observation_count=1 WHERE id IN
 (SELECT md5('sample-'||i)::uuid FROM generate_series(1,101) i);
INSERT INTO public.vehicle_live_metrics
 SELECT md5('sample-'||i)::uuid,1,0,'2021-01-01',statement_timestamp() FROM generate_series(1,101) i;
DELETE FROM public.vehicle_live_metrics WHERE vehicle_id=md5('sample-101')::uuid;
DO $$ DECLARE a jsonb; BEGIN
 a:=public.assay_vehicle_metric_fold();
 ASSERT a->>'status'='passed' AND (a->'counts'->>'vehicles_eligible')::int=100;
 ASSERT a->>'scope'='bounded_recent_ingest_and_oldest_dirty_vehicles', 'Outside sample is expressly unverified';
END $$;
-- Outside-window work still fails promptly when its durable queued row ages.
INSERT INTO public.vehicle_metric_recompute_queue(vehicle_id,live_metrics_dirty,queued_at)
 VALUES(md5('sample-101')::uuid,true,statement_timestamp()-interval '16 minutes');
DO $$ BEGIN ASSERT public.assay_vehicle_metric_fold()->>'status'='failed'; END $$;
DELETE FROM public.vehicle_metric_recompute_queue;
DELETE FROM public.vehicle_observations WHERE observed_at='2021-01-01';
DELETE FROM public.vehicle_live_metrics WHERE last_observation_at='2021-01-01';
DELETE FROM public.vehicles WHERE id IN (SELECT md5('sample-'||i)::uuid FROM generate_series(1,1001) i);

-- Idle is absence of eligible sampled evidence, not proof that the fleet is right.
UPDATE public.vehicle_observations SET ingested_at=statement_timestamp()-interval '2 days';
DO $$ DECLARE a jsonb; BEGIN
 a:=public.assay_vehicle_metric_fold();
 ASSERT a->>'status'='idle' AND a->'reasons' ? 'no_eligible_sample';
END $$;
-- Job liveness is independently red even for an idle sample; paused stays paused.
UPDATE cron.job_run_details SET start_time=statement_timestamp()-interval '16 minutes' WHERE jobid=500;
DO $$ BEGIN ASSERT (SELECT health_status='failed' FROM public.v_job_health WHERE jobid=500); END $$;
UPDATE public.admin_notifications SET created_at=statement_timestamp()-interval '25 hours'
 WHERE metadata->>'kind'='cron_health';
SELECT public.pipeline_heartbeat();
DO $$ BEGIN
 ASSERT (SELECT count(*)=2 FROM public.admin_notifications WHERE metadata->>'kind'='cron_health'),
   'Existing alert dedup expires, so durable failure remains visible';
 ASSERT EXISTS (SELECT 1 FROM public.admin_notifications WHERE metadata->>'kind'='cron_health'
   AND created_at>statement_timestamp()-interval '1 hour' AND message LIKE '%fold_worker_no_run_15m:%');
END $$;
UPDATE cron.job SET active=false WHERE jobid=500;
DO $$ BEGIN ASSERT (SELECT health_status='paused' FROM public.v_job_health WHERE jobid=500); END $$;
UPDATE cron.job SET active=true WHERE jobid=500;
UPDATE cron.job_run_details SET start_time=statement_timestamp() WHERE jobid=500;

-- A broken reading becomes visible unknown; existing monitor alarms separately.
ALTER TABLE public.vehicle_live_metrics RENAME TO fixture_metrics_unavailable;
DO $$ BEGIN
 ASSERT public.assay_vehicle_metric_fold()->>'status'='unavailable';
 ASSERT (SELECT health_status='unknown' FROM public.v_job_health WHERE jobid=500);
END $$;
UPDATE public.admin_notifications SET created_at=statement_timestamp()-interval '25 hours'
 WHERE metadata->>'kind'='cron_health';
SELECT public.pipeline_heartbeat();
DO $$ BEGIN
 ASSERT EXISTS (SELECT 1 FROM public.admin_notifications WHERE metadata->>'kind'='cron_health'
   AND created_at>statement_timestamp()-interval '1 hour' AND message LIKE '%unavailable%');
 ASSERT (SELECT count(*)=1 FROM public.admin_notifications WHERE metadata->>'kind'='pipeline_heartbeat'),
   'An output alarm preserves the separate intake alert and its dedup';
END $$;
ALTER TABLE public.fixture_metrics_unavailable RENAME TO vehicle_live_metrics;

-- CTE is materialized once across many jobs, and legacy reads never call it.
INSERT INTO cron.job SELECT i,'fixture-'||i,'* * * * *',true,'SELECT 1' FROM generate_series(600,650) i;
DO $$ DECLARE before_calls bigint; after_calls bigint; reading jsonb; BEGIN
 SELECT coalesce(sum(calls),0) INTO before_calls FROM pg_stat_xact_user_functions
 WHERE funcid='public.assay_vehicle_metric_fold()'::regprocedure;
 SELECT jsonb_agg(to_jsonb(h)) INTO reading FROM public.v_job_health h;
 SELECT coalesce(sum(calls),0) INTO after_calls FROM pg_stat_xact_user_functions
 WHERE funcid='public.assay_vehicle_metric_fold()'::regprocedure;
 ASSERT after_calls-before_calls=1, 'Assay must run once, not once per job';
 before_calls:=after_calls;
 PERFORM jobid,jobname,last_status FROM public.v_job_health;
 SELECT coalesce(sum(calls),0) INTO after_calls FROM pg_stat_xact_user_functions
 WHERE funcid='public.assay_vehicle_metric_fold()'::regprocedure;
 ASSERT after_calls=before_calls, 'Legacy columns cannot invoke source scans';
 PERFORM assay,health_status FROM public.v_job_health WHERE jobname='pipeline-heartbeat';
 SELECT coalesce(sum(calls),0) INTO after_calls FROM pg_stat_xact_user_functions
 WHERE funcid='public.assay_vehicle_metric_fold()'::regprocedure;
 ASSERT after_calls=before_calls, 'Unrelated job readings cannot invoke the metric assay';
END $$;

ROLLBACK;
