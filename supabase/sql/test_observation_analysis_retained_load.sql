-- Declared local load, not production fleet capacity: 1000 synthetic public
-- vehicles,5003 admissions,5000 duplicates; correction/crash during the drain.
-- Real admission trigger, queue/RPC/reader owners; no HTTP, model or source fetch.
\set ON_ERROR_STOP on
\i supabase/sql/test_registered_retained_analysis.sql
\i supabase/migrations/20261030184735_retain_analysis_pending_clock.sql
-- The real owner-authorized supersession RPC, with closed unrelated ownership
-- branches. Keep testimony and its correction lineage rather than editing it.
ALTER TYPE public.observation_kind ADD VALUE 'work_record';
ALTER TABLE public.vehicle_observations ADD COLUMN superseded_by uuid,
 ADD COLUMN superseded_at timestamptz,ADD COLUMN lineage_chain uuid[];
CREATE TABLE public.vehicle_ownerships(vehicle_id uuid,owner_profile_id uuid,is_current boolean);
CREATE TABLE public.ownership_verifications(vehicle_id uuid,user_id uuid,status text);
CREATE TABLE public.vehicle_contributors(vehicle_id uuid,user_id uuid);
\i supabase/migrations/20260709140000_supersede_observation.sql
CREATE EXTENSION dblink;
CREATE TEMP TABLE load_metrics(started timestamptz,admitted_at timestamptz,finished_at timestamptz,claimed integer,computed integer);
INSERT INTO load_metrics(started) VALUES(clock_timestamp());
CREATE TEMP TABLE load_faults(kind text PRIMARY KEY,vehicle_id uuid,queue_id uuid,revision bigint,lease_token uuid);
INSERT INTO public.vehicles(id,is_public,owner_id) SELECT format('90000000-0000-4000-8000-%s',lpad(n::text,12,'0'))::uuid,true,
 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid
 FROM generate_series(1,1000)n;
INSERT INTO public.observation_properties(id,property_key,namespace,data_type,applies_to_kinds,label)
 VALUES('77777777-7777-7777-7777-000000000005','year','core','integer',
  ARRAY['condition','specification']::public.observation_kind[],'Reported year');
-- Two source kinds arrive in separate committed admissions; an optional wake
-- never runs. Source IDs are deterministic only in this disposable fixture.
INSERT INTO public.vehicle_observations(id,vehicle_id,source_id,kind,structured_data,source_identifier,content_hash,observed_at,property_id,extraction_method,confidence_score)
 SELECT format('91000000-0000-4000-8000-%s',lpad(n::text,12,'0'))::uuid,
  format('90000000-0000-4000-8000-%s',lpad((((n-1)%1000)+1)::text,12,'0'))::uuid,
  '33333333-3333-3333-3333-333333333333',CASE WHEN n%2=0 THEN 'specification' ELSE 'condition' END::public.observation_kind,
  jsonb_build_object('fixture','isolated_load','year',1970+((n-1)%50),'mechanical_verification','unestablished'),
  'load:'||n,encode(sha256(convert_to('load:'||n,'UTF8')),'hex'),now(),
  '77777777-7777-7777-7777-000000000005','fixture_reported_intake',0.7
 FROM generate_series(1,5000)n;
INSERT INTO public.vehicle_observations(id,vehicle_id,source_id,kind,structured_data,source_identifier,content_hash,observed_at)
 SELECT id,vehicle_id,source_id,kind,structured_data,source_identifier,content_hash,observed_at FROM public.vehicle_observations
 WHERE source_identifier LIKE 'load:%' ON CONFLICT DO NOTHING;
UPDATE load_metrics SET admitted_at=clock_timestamp();
SELECT pg_temp.ok('duplicate arrivals do not repeat work revisions under load',
 (SELECT count(*)=1000 AND bool_and(request_revision=5) FROM public.analysis_queue WHERE vehicle_id::text LIKE '90000000-%'));
-- Genuine concurrent transactions on one enrolled vehicle, same transaction
-- trigger as admissions above. Both kinds/dependencies must survive the race.
SELECT dblink_connect('load-a',format('dbname=%s host=%s port=%s user=%s',current_database(),current_setting('unix_socket_directories'),current_setting('port'),current_user));
SELECT dblink_connect('load-b',format('dbname=%s host=%s port=%s user=%s',current_database(),current_setting('unix_socket_directories'),current_setting('port'),current_user));
SELECT dblink_exec('load-a','BEGIN');
SELECT dblink_exec('load-a',$q$INSERT INTO public.vehicle_observations(vehicle_id,kind,source_identifier) VALUES('90000000-0000-4000-8000-000000000001','condition','concurrent-a')$q$);
SELECT dblink_send_query('load-b',$q$INSERT INTO public.vehicle_observations(vehicle_id,kind,source_identifier) VALUES('90000000-0000-4000-8000-000000000001','specification','concurrent-b') RETURNING id$q$);
SELECT dblink_exec('load-a','COMMIT');
SELECT * FROM dblink_get_result('load-b') AS r(id uuid);
SELECT dblink_disconnect('load-a'); SELECT dblink_disconnect('load-b');
SELECT pg_temp.ok('concurrent kinds keep their requested revisions and both readers',
 (SELECT request_revision=7 AND widget_slugs @> ARRAY['data-quality','photo-coverage'] FROM public.analysis_queue
  WHERE vehicle_id='90000000-0000-4000-8000-000000000001'));
CREATE TEMP TABLE loaded_health AS SELECT public.analysis_queue_health(NULL,1000) AS r;
SELECT pg_temp.ok('health distinguishes the bounded oldest selection from the complete queue',
 (SELECT r->>'selected'='1000' AND (r->>'has_more')::boolean AND r->>'legacy_unenrolled'='not_scanned' FROM loaded_health));
DO $$ DECLARE c public.analysis_queue; widget_slug text; result jsonb; jobs integer:=0; computations integer:=0;
 successor uuid; original uuid; BEGIN
 <<work>> LOOP
  SELECT * INTO c FROM public.claim_analysis_queue_batch(1,'isolated-load',NULL,true);
  EXIT WHEN c.id IS NULL;
  jobs:=jobs+1;
  IF jobs>1003 THEN RAISE EXCEPTION 'Retained worker hot-loop'; END IF;
  FOREACH widget_slug IN ARRAY c.claimed_widget_slugs LOOP
   result:=public.compute_retained_analysis_widget(c.vehicle_id,widget_slug,(SELECT w.retained_dispatch_method FROM public.analysis_widgets w WHERE w.slug=widget_slug));
   PERFORM public.record_analysis_queue_signal(c.id,'isolated-load',c.claimed_revision,c.lease_token,
    jsonb_build_object('vehicle_id',c.vehicle_id,'widget_slug',widget_slug,'score',NULL,'severity','info','value_json',result,'evidence',result->'evidence'));
   computations:=computations+1;
   IF jobs=1 AND widget_slug='data-quality' THEN
    INSERT INTO load_faults VALUES('correction',c.vehicle_id,c.id,c.claimed_revision,c.lease_token);
    -- A real correction arrives after a checkpoint while999 other cars wait.
    INSERT INTO public.vehicle_observations(vehicle_id,kind,source_identifier,extraction_method,structured_data)
     VALUES(c.vehicle_id,'specification','load-owner-rejection','owner_rejected_v1',
      '{"reason":"The reported year was withdrawn by the fixture owner."}') RETURNING id INTO successor;
    PERFORM set_config('test.auth_uid','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',true);
    FOR original IN SELECT id FROM public.vehicle_observations WHERE vehicle_id=c.vehicle_id AND property_id IS NOT NULL LOOP
     PERFORM public.supersede_observation(original,successor);
    END LOOP;
    PERFORM set_config('test.auth_uid','',true);
   END IF;
   IF jobs=2 AND widget_slug='data-quality' THEN
    INSERT INTO load_faults VALUES('worker_crash',c.vehicle_id,c.id,c.claimed_revision,c.lease_token);
    -- Process dies after first-widget publication, without completion.
    UPDATE public.analysis_queue SET lease_expires_at=clock_timestamp()-interval '1s' WHERE id=c.id;
    CONTINUE work;
   END IF;
  END LOOP;
  PERFORM public.finish_analysis_queue_work(c.id,'isolated-load',c.claimed_revision,c.lease_token,c.claimed_widget_slugs);
 END LOOP;
 UPDATE load_metrics SET finished_at=clock_timestamp(),claimed=jobs,computed=computations;
END $$;
SELECT pg_temp.ok('all declared load subjects reach both readers; unrelated car remains separate and deferred',
 (SELECT count(*)=2000 AND bool_and(score IS NULL AND value_json->>'assessment_status'='not_assessed') FROM public.analysis_signals WHERE vehicle_id::text LIKE '90000000-%')
 AND (SELECT count(*)=1000 AND bool_and(widget_slugs=ARRAY['requires-separate-authority']) FROM public.analysis_queue WHERE vehicle_id::text LIKE '90000000-%')
 AND (SELECT analysis_deferred FROM public.analysis_queue WHERE vehicle_id='11111111-1111-1111-1111-111111111111'));
SELECT pg_temp.ok('each load property reaches its correct source-cited reader without cross-vehicle association',
 (SELECT count(*)=1000 AND bool_and(value_json#>>'{details,claims_in_page}'=
   CASE WHEN vehicle_id=(SELECT vehicle_id FROM load_faults WHERE kind='correction') THEN '0' ELSE '1' END) FROM public.analysis_signals
  WHERE vehicle_id::text LIKE '90000000-%' AND widget_slug='data-quality')
 AND NOT EXISTS(SELECT FROM public.analysis_signals s CROSS JOIN LATERAL jsonb_array_elements(s.evidence->'record_ids')c
  JOIN public.vehicle_observations o ON o.id=(c->>'observation_id')::uuid WHERE s.vehicle_id::text LIKE '90000000-%' AND o.vehicle_id<>s.vehicle_id));
SELECT pg_temp.ok('correction during active load removes its obsolete assertion and retains lineage',
 (SELECT s.value_json#>>'{details,claims_in_page}'='0' AND jsonb_array_length(s.evidence->'record_ids')=0
  FROM load_faults f JOIN public.analysis_signals s ON s.vehicle_id=f.vehicle_id AND s.widget_slug='data-quality' WHERE f.kind='correction')
 AND (SELECT count(*)=5 AND bool_and(is_superseded AND superseded_by IS NOT NULL AND superseded_at IS NOT NULL)
  FROM public.vehicle_observations WHERE vehicle_id=(SELECT vehicle_id FROM load_faults WHERE kind='correction') AND property_id IS NOT NULL));
SELECT pg_temp.ok('crash recovery never repeats its checkpointed source read or accepts the dead nonce',
 (SELECT count(*)=1 FROM public.analysis_signal_history h JOIN load_faults f ON f.vehicle_id=h.vehicle_id
  WHERE f.kind='worker_crash' AND h.widget_slug='data-quality')
 AND (SELECT public.finish_analysis_queue_work(f.queue_id,'isolated-load',f.revision,f.lease_token,'{}')->>'status'='lease_lost'
  FROM load_faults f WHERE kind='worker_crash'));
SELECT jsonb_build_object('scope','isolated_PG17_fixture','vehicles',1000,'admissions',5003,'duplicate_attempts',5000,
 'corrections_during_load',1,'worker_crashes_during_load',1,
 'claimed',claimed,'computations',computed,'admission_seconds',extract(epoch FROM admitted_at-started),
 'drain_seconds',extract(epoch FROM finished_at-admitted_at),'health',public.analysis_queue_health(NULL,2000),
 'production_capacity','not_established','physical_filing','not_tested') AS load_receipt FROM load_metrics;
