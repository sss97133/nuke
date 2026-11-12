-- Disposable PG17. Source inputs are read-only JSON views, never raw testimony writes.
-- The operational enqueue double reserves four requests per selected source.
-- Native custody/admission is proved by the identity contract and live canaries.
\set ON_ERROR_STOP on
DO $$ BEGIN IF current_database() NOT LIKE 'dm_refinement_%' THEN RAISE EXCEPTION 'disposable database required';END IF;END $$;
CREATE TYPE public.observation_kind AS ENUM('listing','sale_result','specification');
CREATE VIEW public.vehicle_observations AS SELECT * FROM jsonb_to_recordset(coalesce(nullif(current_setting('test.observations',true),''),'[]')::jsonb)
 AS r(id uuid,vehicle_id uuid,source_id uuid,kind public.observation_kind,property_id uuid,ingested_at timestamptz,
 extraction_method text,is_superseded boolean,subject_type text,subject_id uuid);
CREATE VIEW public.vehicles AS SELECT * FROM jsonb_to_recordset(coalesce(nullif(current_setting('test.vehicles',true),''),'[]')::jsonb)
 AS r(id uuid,is_public boolean,deleted_at timestamptz,listing_kind text);
CREATE TABLE public.observation_sources(id uuid,slug text);
CREATE TABLE public.retained_listing_property_work(source_observation_id uuid,property_id uuid,vehicle_id uuid,status text DEFAULT 'pending',PRIMARY KEY(source_observation_id,property_id));
CREATE TABLE public.retained_listing_property_replay(id boolean PRIMARY KEY,record_replay jsonb,scan_completed_at timestamptz,native_identity_completed_at timestamptz);
CREATE FUNCTION public.enqueue_retained_listing_properties(p_sources uuid[]) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
 INSERT INTO public.retained_listing_property_work(source_observation_id,property_id)
 SELECT o.id,k.id FROM public.vehicle_observations o CROSS JOIN(VALUES
 ('ece619f7-c49a-44f7-999f-a41acf5d4dc3'::uuid),('8d274b73-a8a6-43bf-9036-5864d0152725'::uuid),
 ('a79b528f-7d9d-46ca-96f9-96d899e81d10'::uuid),('9fc93dd3-3639-439a-8eed-3e9a0f846334'::uuid))k(id)
 WHERE o.id=ANY(p_sources) ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS n=ROW_COUNT;
 IF current_setting('test.enqueue_fail',true)='true' THEN RAISE EXCEPTION 'synthetic_enqueue_failure';END IF;
 IF current_setting('test.enqueue_ack',true)='null' THEN RETURN NULL;END IF;
 IF current_setting('test.enqueue_ack',true)='negative' THEN RETURN -1;END IF;
 IF current_setting('test.enqueue_ack',true)='over' THEN RETURN 1000;END IF;
 RETURN n;
END $$;
\ir fixtures/mccormick_replay_baseline.sql
INSERT INTO public.retained_listing_property_replay VALUES(true,
 '{"version":"retained_vehicle_properties_v1","after_vehicle_id":"09cd0529-aded-4154-a711-2062953ff59e","after_source_id":"00000000-0000-0000-0000-000000000000","active_vehicle_id":null,"upper_vehicle_id":"ffffffff-ffff-4fff-8fff-ffffffffffff","vehicles_finished":53356,"source_keys_seen":23055,"work_seeded":89614,"completed_at":null,"source_replays":{"other_source":{"after":"keep-me","work":123}}}',
 '2026-01-01','2026-01-01');
SELECT set_config('test.vehicles','[{"id":"10000000-0000-4000-8000-000000000001","is_public":true,"listing_kind":"vehicle"}]',false);
SELECT set_config('test.original_replay',(SELECT record_replay::text FROM public.retained_listing_property_replay),false);
SELECT set_config('test.observations',(SELECT jsonb_agg(jsonb_build_object('id','00000000-0000-4000-8000-'||lpad(i::text,12,'0'),
 'source_id','006f01c3-e5fb-44f5-ab40-e55b0654de1c','kind','listing','ingested_at','2026-01-01','extraction_method','mccormick_html_v1'))::text FROM generate_series(1,30)i),false);
-- Execute the actual source DO block client-side; the separate arrival contract
-- applies the full migration to an empty testimony table and tests synthetic arrivals.
\set seed_block `python3 scripts/ci/print-sql-block.py supabase/migrations/20261111041200_mccormick_retained_replay.sql seed_patch`
SELECT convert_from(decode(:'seed_block','base64'),'UTF8') \gexec
SELECT convert_from(decode(:'seed_block','base64'),'UTF8') \gexec
DO $contract$
DECLARE prior jsonb:=current_setting('test.original_replay')::jsonb;now_record jsonb;phase jsonb;n integer;initial_count integer;bad_ack text;
BEGIN
 INSERT INTO public.retained_listing_property_work(source_observation_id,property_id)
 SELECT ('10000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'ece619f7-c49a-44f7-999f-a41acf5d4dc3' FROM generate_series(1,500)i;
 n:=public.seed_retained_listing_properties();
 IF n<>0 OR (SELECT record_replay FROM public.retained_listing_property_replay)<>prior THEN RAISE EXCEPTION 'full queue advanced replay';END IF;
 DELETE FROM public.retained_listing_property_work WHERE source_observation_id='10000000-0000-4000-8000-000000000500';
 n:=public.seed_retained_listing_properties();
 IF n<>0 OR (SELECT record_replay FROM public.retained_listing_property_replay)<>prior THEN RAISE EXCEPTION 'less than four free slots advanced replay';END IF;
 DELETE FROM public.retained_listing_property_work WHERE source_observation_id BETWEEN '10000000-0000-4000-8000-000000000464' AND '10000000-0000-4000-8000-000000000499';
 n:=public.seed_retained_listing_properties();
 SELECT record_replay INTO now_record FROM public.retained_listing_property_replay;
 phase:=now_record#>'{source_replays,mccormicks_identity_v1}';
 IF n<>9 OR (SELECT count(*) FROM public.retained_listing_property_work WHERE status IN('pending','claimed'))<>499
  OR phase->>'source_keys_seen'<>'9' OR phase->>'work_seeded'<>'36' THEN RAISE EXCEPTION 'capacity-bounded slice wrong: %',phase;END IF;
 IF now_record-'source_replays'<>prior-'source_replays'
  OR now_record#>'{source_replays,other_source}'<>prior#>'{source_replays,other_source}' THEN RAISE EXCEPTION 'other checkpoint changed';END IF;
 UPDATE public.retained_listing_property_work SET status='done';
 -- A source appearing after the initial boundary belongs to the arrival path,
 -- not a silent expansion/restart of this finite baseline.
 PERFORM set_config('test.observations',(current_setting('test.observations')::jsonb||jsonb_build_array(
  jsonb_build_object('id','00000000-0000-4000-8000-000000000031','source_id','006f01c3-e5fb-44f5-ab40-e55b0654de1c',
   'kind','listing','ingested_at',clock_timestamp(),'extraction_method','mccormick_html_v1')))::text,false);
 -- One source slice yields the next eligible call to the preserved generic
 -- pass. Its one synthetic vehicle advances while McCormick is still unfinished.
 n:=public.seed_retained_listing_properties();
 SELECT record_replay INTO now_record FROM public.retained_listing_property_replay;
 IF now_record->>'after_vehicle_id'<>'10000000-0000-4000-8000-000000000001'
  OR now_record->>'vehicles_finished'<>'53357'
  OR now_record#>>'{source_replays,mccormicks_identity_v1,source_keys_seen}'<>'9'
  OR now_record#>>'{source_replays,mccormicks_identity_v1,completed_at}' IS NOT NULL
  OR now_record#>>'{source_replays,mccormicks_identity_v1,yield_to_generic}'<>'false' THEN
  RAISE EXCEPTION 'source replay starved or reset generic work';END IF;
 prior:=now_record||jsonb_build_object('source_replays',prior->'source_replays');
 n:=public.seed_retained_listing_properties();
 SELECT record_replay INTO now_record FROM public.retained_listing_property_replay;
 phase:=now_record#>'{source_replays,mccormicks_identity_v1}';
 IF n<>21 OR phase->>'source_keys_seen'<>'30' OR phase->>'work_seeded'<>'120' OR phase->>'completed_at' IS NULL THEN RAISE EXCEPTION 'finite boundary failed: %',phase;END IF;
 IF EXISTS(SELECT FROM public.retained_listing_property_work WHERE source_observation_id='00000000-0000-4000-8000-000000000031') THEN RAISE EXCEPTION 'later source leaked into baseline';END IF;
 IF now_record-'source_replays'<>prior-'source_replays' OR now_record#>'{source_replays,other_source}'<>prior#>'{source_replays,other_source}' THEN RAISE EXCEPTION 'generic replay reset';END IF;
 n:=public.seed_retained_listing_properties();
 SELECT record_replay INTO now_record FROM public.retained_listing_property_replay;
 IF now_record->>'after_vehicle_id'<>prior->>'after_vehicle_id' OR now_record->>'vehicles_finished'<>prior->>'vehicles_finished'
  OR now_record#>'{source_replays,mccormicks_identity_v1}'<>phase OR now_record->>'completed_at' IS NULL THEN RAISE EXCEPTION 'generic pass not resumed intact';END IF;
 SELECT count(*) INTO initial_count FROM public.retained_listing_property_work;
 PERFORM public.seed_retained_listing_properties();
 IF (SELECT count(*) FROM public.retained_listing_property_work)<>initial_count THEN RAISE EXCEPTION 'completed replay duplicated requests';END IF;
 DELETE FROM public.retained_listing_property_work;
 UPDATE public.retained_listing_property_replay SET record_replay=prior;
 PERFORM set_config('test.enqueue_fail','true',true);
 BEGIN
  PERFORM public.seed_retained_listing_properties();RAISE EXCEPTION 'expected enqueue refusal';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'synthetic_enqueue_failure' THEN RAISE;END IF;END;
 IF EXISTS(SELECT FROM public.retained_listing_property_work) OR (SELECT record_replay FROM public.retained_listing_property_replay)<>prior THEN RAISE EXCEPTION 'failure lost atomicity';END IF;
 PERFORM set_config('test.enqueue_fail','false',true);
 FOREACH bad_ack IN ARRAY ARRAY['null','negative','over'] LOOP
  PERFORM set_config('test.enqueue_ack',bad_ack,true);
  BEGIN
   PERFORM public.seed_retained_listing_properties();RAISE EXCEPTION 'expected acknowledgement refusal';
  EXCEPTION WHEN raise_exception THEN
   IF SQLERRM<>'McCormick admitted profile exceeded four identity keys' THEN RAISE;END IF;
  END;
  IF EXISTS(SELECT FROM public.retained_listing_property_work) OR (SELECT record_replay FROM public.retained_listing_property_replay)<>prior THEN RAISE EXCEPTION 'bad acknowledgement advanced state';END IF;
 END LOOP;
 PERFORM set_config('test.enqueue_ack','ok',true);
 UPDATE public.retained_listing_property_replay SET record_replay=prior||'{"source_replays":[]}'::jsonb;
 BEGIN
  PERFORM public.seed_retained_listing_properties();RAISE EXCEPTION 'expected checkpoint refusal';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Source replay map changed' THEN RAISE;END IF;END;
 IF (SELECT record_replay FROM public.retained_listing_property_replay)<>prior||'{"source_replays":[]}'::jsonb THEN RAISE EXCEPTION 'invalid checkpoint overwritten';END IF;
 UPDATE public.retained_listing_property_replay SET record_replay=prior;
 PERFORM set_config('test.observations','[]',false);
 n:=public.seed_retained_listing_properties();
 SELECT record_replay#>'{source_replays,mccormicks_identity_v1}' INTO phase FROM public.retained_listing_property_replay;
 IF n<>0 OR phase->>'source_keys_seen'<>'0' OR phase->>'work_seeded'<>'0' OR phase->>'completed_at' IS NULL THEN RAISE EXCEPTION 'empty source phase not explicit';END IF;
 RAISE NOTICE 'PASS: source boundary, backpressure, checkpoint preservation, resume/replay and failure atomicity';
END $contract$;
