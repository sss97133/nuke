-- Actual enqueue/claim/result/completion functions on isolated PG17 only.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_observation_analysis%' OR
     current_setting('server_version_num')::int/10000<>17 OR to_regclass('public.analysis_queue') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires empty disposable PG17 database';
  END IF;
END $$;
CREATE EXTENSION dblink;
DO $$ BEGIN
  IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE TABLE public.vehicles(id uuid PRIMARY KEY);
CREATE TABLE public.analysis_widgets(slug text PRIMARY KEY,is_enabled boolean,trigger_on_observation_kinds text[]);
CREATE TABLE public.analysis_queue(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),vehicle_id uuid NOT NULL UNIQUE REFERENCES public.vehicles,
  trigger_source text,trigger_reasons text[],widget_slugs text[],status text NOT NULL,
  priority smallint,worker_id text,claimed_at timestamptz,widgets_computed smallint,
  widgets_failed smallint,compute_time_ms integer,completed_at timestamptz,created_at timestamptz DEFAULT now());
CREATE TABLE public.analysis_signals(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),vehicle_id uuid,widget_slug text,
  score numeric,label text,severity text,value_json jsonb,reasons text[],evidence jsonb,confidence numeric,
  recommendations jsonb,previous_score numeric,previous_severity text,changed_at timestamptz,
  change_direction text,computed_at timestamptz,stale_at timestamptz,compute_time_ms integer,
  UNIQUE(vehicle_id,widget_slug));
CREATE TABLE public.analysis_signal_history(id uuid DEFAULT gen_random_uuid(),signal_id uuid,
  vehicle_id uuid,widget_slug text,score numeric,severity text,label text,reasons text[],computed_at timestamptz);
CREATE TABLE public.ars_recompute_queue(vehicle_id uuid PRIMARY KEY,dimension text);
CREATE TABLE public.vehicle_observations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),vehicle_id uuid,
  kind text,source_identifier text UNIQUE,extraction_metadata jsonb DEFAULT '{}'::jsonb);
CREATE FUNCTION public.trigger_ars_on_observation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
CREATE TRIGGER trg_ars_on_observation_insert AFTER INSERT ON public.vehicle_observations
  FOR EACH ROW WHEN(NEW.vehicle_id IS NOT NULL) EXECUTE FUNCTION public.trigger_ars_on_observation();
INSERT INTO public.vehicles VALUES('10000000-0000-4000-8000-000000000001'),('10000000-0000-4000-8000-000000000002'),
 ('10000000-0000-4000-8000-000000000003');
INSERT INTO public.analysis_widgets VALUES('a',true,ARRAY['listing']),('b',true,ARRAY['work_record']);
-- An old pending row must not be silently enrolled by the migration.
INSERT INTO public.analysis_queue(vehicle_id,status,priority) VALUES('10000000-0000-4000-8000-000000000002','pending',100);
\i supabase/migrations/20261030150308_durable_observation_analysis_work.sql
CREATE FUNCTION pg_temp.ok(label text, passed boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF passed IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF; RAISE NOTICE 'PASS: %',label; END $$;
SELECT pg_temp.ok('legacy queue is not activated',NOT EXISTS(SELECT FROM public.claim_analysis_queue_batch(1,'worker',NULL::uuid)));
SELECT public.enqueue_analysis_work('10000000-0000-4000-8000-000000000003','unrelated_vehicle','{}',ARRAY['a'],100);

SELECT pg_temp.ok('zero capacity is not bypassed',NOT EXISTS(
 SELECT FROM public.claim_analysis_queue_batch(0,'worker','10000000-0000-4000-8000-000000000003')));

-- Two genuinely concurrent admission transactions contend on one derived queue
-- row. No HTTP call or coordinator process runs after either insert.
SELECT dblink_connect('a',format('dbname=%s host=%s port=%s user=%s',current_database(),current_setting('unix_socket_directories'),current_setting('port'),current_user));
SELECT dblink_connect('b',format('dbname=%s host=%s port=%s user=%s',current_database(),current_setting('unix_socket_directories'),current_setting('port'),current_user));
SELECT dblink_exec('a','BEGIN');
SELECT dblink_exec('a',$q$INSERT INTO public.vehicle_observations(vehicle_id,kind,source_identifier)
 VALUES('10000000-0000-4000-8000-000000000001','listing','source-a')$q$);
SELECT dblink_send_query('b',$q$INSERT INTO public.vehicle_observations(vehicle_id,kind,source_identifier)
 VALUES('10000000-0000-4000-8000-000000000001','work_record','source-b') RETURNING id$q$);
SELECT dblink_exec('a','COMMIT');
SELECT * FROM dblink_get_result('b') AS result(id uuid);
SELECT dblink_disconnect('a'); SELECT dblink_disconnect('b');
SELECT pg_temp.ok('both admission kinds persist their dependencies atomically',
 (SELECT request_revision=2 AND widget_slugs=ARRAY['a','b'] AND status='pending' FROM public.analysis_queue
  WHERE vehicle_id='10000000-0000-4000-8000-000000000001'));
INSERT INTO public.vehicle_observations(vehicle_id,kind,source_identifier)
 VALUES('10000000-0000-4000-8000-000000000001','listing','source-a') ON CONFLICT DO NOTHING;
SELECT pg_temp.ok('replay does not create new work',(SELECT request_revision=2 FROM public.analysis_queue
 WHERE vehicle_id='10000000-0000-4000-8000-000000000001'));
CREATE TEMP TABLE claim_a AS SELECT * FROM public.claim_analysis_queue_batch(1,'worker-a','10000000-0000-4000-8000-000000000001');
SELECT pg_temp.ok('claim pins the exact revision and widget snapshot',
 (SELECT claimed_revision=2 AND claimed_widget_slugs=ARRAY['a','b'] AND lease_expires_at>now() FROM claim_a));
SELECT pg_temp.ok('a second worker cannot take the active lease',NOT EXISTS(
 SELECT FROM public.claim_analysis_queue_batch(1,'worker-b','10000000-0000-4000-8000-000000000001')));
SELECT public.record_analysis_queue_signal(id,'worker-a',2,lease_token,jsonb_build_object('vehicle_id',vehicle_id,
 'widget_slug','a','severity','info','score',25,'reasons',jsonb_build_array('fixture'),'value_json','{}'::jsonb)) FROM claim_a;
SELECT pg_temp.ok('completed widget is checkpointed before worker completion',
 (SELECT widget_slugs=ARRAY['b'] FROM public.analysis_queue WHERE id=(SELECT id FROM claim_a)));
-- The worker is killed here. Expiry is advanced only in this isolated fixture.
UPDATE public.analysis_queue SET lease_expires_at=now()-interval '1 second' WHERE id=(SELECT id FROM claim_a);
CREATE TEMP TABLE recovered AS SELECT * FROM public.claim_analysis_queue_batch(1,'worker-a','10000000-0000-4000-8000-000000000001');
SELECT pg_temp.ok('crash recovery reuses the completed result instead of rerunning it',
 (SELECT claimed_revision=2 AND claimed_widget_slugs=ARRAY['b'] FROM recovered));
SELECT pg_temp.ok('old lease cannot publish even when a replacement reuses the worker name',
 (SELECT public.record_analysis_queue_signal(id,'worker-a',2,lease_token,jsonb_build_object('vehicle_id',vehicle_id,
 'widget_slug','a','severity','critical','score',99)) ->>'status'='lease_lost' FROM claim_a));
SELECT pg_temp.ok('old worker cannot close the replacement lease',
 (SELECT public.finish_analysis_queue_work(id,'worker-a',2,lease_token,ARRAY['a','b'])->>'status'='lease_lost' FROM claim_a));
SELECT public.record_analysis_queue_signal(id,'worker-a',2,lease_token,jsonb_build_object('vehicle_id',vehicle_id,
 'widget_slug','b','severity','ok','score',75,'reasons',jsonb_build_array('fixture'),'value_json','{}'::jsonb)) FROM recovered;
SELECT public.finish_analysis_queue_work(id,'worker-a',2,lease_token,ARRAY['b']) FROM recovered;
SELECT pg_temp.ok('both dependent readers have their recorded output',
 (SELECT count(*)=2 AND bool_and(value_json#>>'{analysis_work,revision}'='2') FROM public.analysis_signals
 WHERE vehicle_id='10000000-0000-4000-8000-000000000001'));
SELECT pg_temp.ok('only the processed revision is acknowledged',
 (SELECT status='complete' AND completed_revision=2 FROM public.analysis_queue WHERE id=(SELECT id FROM claim_a)));

INSERT INTO public.vehicle_observations(vehicle_id,kind,source_identifier)
 VALUES('10000000-0000-4000-8000-000000000001','listing','source-c');
CREATE TEMP TABLE active AS SELECT * FROM public.claim_analysis_queue_batch(1,'active','10000000-0000-4000-8000-000000000001');
INSERT INTO public.vehicle_observations(vehicle_id,kind,source_identifier)
 VALUES('10000000-0000-4000-8000-000000000001','work_record','source-d');
SELECT pg_temp.ok('new arrival preserves the active claim and both dependencies',
 (SELECT request_revision=4 AND claimed_revision=3 AND worker_id='active' AND widget_slugs=ARRAY['a','b']
  FROM public.analysis_queue WHERE id=(SELECT id FROM active)));
SELECT public.record_analysis_queue_signal(id,'active',3,lease_token,jsonb_build_object('vehicle_id',vehicle_id,
 'widget_slug','a','severity','ok','score',80,'value_json','{}'::jsonb)) FROM active;
SELECT public.finish_analysis_queue_work(id,'active',3,lease_token,ARRAY['a']) FROM active;
SELECT pg_temp.ok('completion cannot erase a later arrival',
 (SELECT status='pending' AND request_revision=4 AND completed_revision=2 AND widget_slugs=ARRAY['a','b']
 FROM public.analysis_queue WHERE id=(SELECT id FROM active)));
SELECT pg_temp.ok('unrelated legacy vehicle remains unchanged',
 (SELECT request_revision=0 AND status='pending' AND worker_id IS NULL FROM public.analysis_queue
 WHERE vehicle_id='10000000-0000-4000-8000-000000000002'));
SELECT pg_temp.ok('targeted work did not claim a higher-priority unrelated vehicle',
 (SELECT request_revision=1 AND status='pending' AND worker_id IS NULL FROM public.analysis_queue
 WHERE vehicle_id='10000000-0000-4000-8000-000000000003'));
SELECT pg_temp.ok('anonymous and arbitrary signed-in users cannot enqueue or finish work',
 NOT has_function_privilege('anon','public.enqueue_analysis_work(uuid,text,text[],text[],integer)','EXECUTE')
 AND NOT has_function_privilege('authenticated','public.finish_analysis_queue_work(uuid,text,bigint,uuid,text[],integer,integer,text)','EXECUTE'));
SELECT pg_temp.ok('stale output did not overwrite recorded result',
 (SELECT score=80 FROM public.analysis_signals WHERE widget_slug='a'));

-- An admission cannot succeed when recording its required work fails.
ALTER TABLE public.analysis_queue ADD CONSTRAINT fixture_fail_work CHECK(request_revision<5) NOT VALID;
DO $$ BEGIN
  BEGIN
    INSERT INTO public.vehicle_observations(vehicle_id,kind,source_identifier)
      VALUES('10000000-0000-4000-8000-000000000001','listing','must-rollback');
    RAISE EXCEPTION 'expected queue rejection';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;
SELECT pg_temp.ok('failed work admission rolls back its observation',NOT EXISTS(
 SELECT FROM public.vehicle_observations WHERE source_identifier='must-rollback'));

ALTER TABLE public.analysis_queue DROP CONSTRAINT fixture_fail_work;
INSERT INTO public.vehicle_observations(vehicle_id,kind,source_identifier,extraction_metadata)
 VALUES('10000000-0000-4000-8000-000000000003','listing','deferred-input','{"analysis_deferred":true}');
SELECT pg_temp.ok('service-deferred work is durable but cannot be claimed',
 (SELECT analysis_deferred AND request_revision=2 FROM public.analysis_queue WHERE vehicle_id='10000000-0000-4000-8000-000000000003')
 AND NOT EXISTS(SELECT FROM public.claim_analysis_queue_batch(1,'worker','10000000-0000-4000-8000-000000000003')));
INSERT INTO public.vehicle_observations(vehicle_id,kind,source_identifier)
 VALUES('10000000-0000-4000-8000-000000000003','work_record','ordinary-arrival');
SELECT pg_temp.ok('an ordinary arrival cannot lift deferred compute',
 (SELECT analysis_deferred AND request_revision=3 FROM public.analysis_queue WHERE vehicle_id='10000000-0000-4000-8000-000000000003'));
SELECT public.enqueue_analysis_work('10000000-0000-4000-8000-000000000003','cron_sweep','{}',NULL,50);
SELECT pg_temp.ok('a cron cannot lift deferred compute',
 (SELECT analysis_deferred FROM public.analysis_queue WHERE vehicle_id='10000000-0000-4000-8000-000000000003'));
SELECT public.enqueue_analysis_work('10000000-0000-4000-8000-000000000003','owner_evaluation','{}',NULL,90);
CREATE TEMP TABLE authorized AS SELECT * FROM public.claim_analysis_queue_batch(1,'authorized','10000000-0000-4000-8000-000000000003');
SELECT pg_temp.ok('an explicit existing owner evaluation can resume deferred calculations',(SELECT count(*)=1 FROM authorized));
INSERT INTO public.vehicle_observations(vehicle_id,kind,source_identifier,extraction_metadata)
 VALUES('10000000-0000-4000-8000-000000000003','listing','new-defer-during-calculation','{"analysis_deferred":true}');
SELECT pg_temp.ok('a new deferral fences the running calculation',
 (SELECT public.record_analysis_queue_signal(id,'authorized',claimed_revision,lease_token,
  jsonb_build_object('vehicle_id',vehicle_id,'widget_slug','a','severity','info','score',1))->>'status'='lease_lost' FROM authorized));
