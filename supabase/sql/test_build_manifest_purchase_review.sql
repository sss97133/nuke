-- ALLOW_RAW_TESTIMONY_WRITE: synthetic fixtures in an empty disposable PG17 database only.
\set ON_ERROR_STOP on
DO $$ BEGIN
 IF current_database() NOT LIKE 'dm_refinement_%' OR current_setting('server_version_num')::int/10000<>17
  OR EXISTS(SELECT 1 FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind IN('r','p','v','m')) THEN
  RAISE EXCEPTION 'requires an empty disposable PG17 dm_refinement database'; END IF;
END $$;
SET statement_timeout='10s';
CREATE SCHEMA auth;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('request.jwt.claim.role',true) $$;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
CREATE TABLE public.vehicles(id uuid PRIMARY KEY);
CREATE TABLE public.observation_sources(id uuid PRIMARY KEY,slug text NOT NULL);
CREATE TABLE public.vehicle_observations(id uuid PRIMARY KEY,vehicle_id uuid REFERENCES public.vehicles,
 source_id uuid REFERENCES public.observation_sources,is_superseded boolean,kind text,extraction_method text,
 confidence_score numeric,structured_data jsonb,superseded_by uuid REFERENCES public.vehicle_observations);
CREATE TABLE public.vehicle_build_manifest(id uuid PRIMARY KEY,vehicle_id uuid REFERENCES public.vehicles,
 device_name text,part_number text,purchased boolean,status text,evidence_level text,invoice_ref text,
 evidence_sources jsonb,lifecycle_state text,actual_cost numeric,price numeric,notes text,updated_at timestamptz);
ALTER TABLE public.vehicle_build_manifest ENABLE ROW LEVEL SECURITY;
CREATE POLICY fixture_public_read ON public.vehicle_build_manifest FOR SELECT TO anon,authenticated USING(true);
CREATE POLICY fixture_service_write ON public.vehicle_build_manifest TO service_role USING(true) WITH CHECK(true);
GRANT ALL ON public.vehicle_build_manifest TO service_role;
GRANT SELECT(id,vehicle_id,device_name,purchased,status,evidence_level) ON public.vehicle_build_manifest TO anon,authenticated;

\ir ../migrations/20261127191306_build_manifest_purchase_review.sql

CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF condition IS NOT TRUE THEN RAISE EXCEPTION 'FAIL %',label; END IF; RAISE NOTICE 'PASS %',label;
END $$;
CREATE FUNCTION pg_temp.refused(label text,sql_ text,code_ text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 BEGIN EXECUTE sql_; EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE=code_ THEN RAISE NOTICE 'PASS %',label; RETURN; END IF;
  RAISE EXCEPTION 'FAIL %: expected %, got % %',label,code_,SQLSTATE,SQLERRM;
 END;
 RAISE EXCEPTION 'FAIL %: accepted',label;
END $$;
CREATE FUNCTION pg_temp.state_hash(p_id uuid) RETURNS text LANGUAGE sql AS $$
 SELECT md5(jsonb_build_object('id',m.id,'vehicle_id',m.vehicle_id,'purchased',m.purchased,
  'status',m.status,'evidence_level',m.evidence_level,'invoice_ref',m.invoice_ref,
  'evidence_sources',m.evidence_sources,'lifecycle_state',m.lifecycle_state,'actual_cost',m.actual_cost)::text)
 FROM public.vehicle_build_manifest m WHERE id=p_id
$$;
INSERT INTO public.vehicles VALUES('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002');
INSERT INTO public.observation_sources VALUES('00000000-0000-0000-0000-000000000003','agent-submission');
INSERT INTO public.vehicle_build_manifest VALUES
 ('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001','Battery','FIXTURE-BAT',true,'purchased','invoice_proven','fixture private reference',
  '[{"type":"invoice","ref":"fixture private reference","private_amount":123}]',NULL,NULL,123,'private fixture note',NULL,NULL),
 ('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000001','Disconnect','FIXTURE-SW',true,'purchased','invoice_proven','fixture private reference',
  '[{"type":"invoice","ref":"fixture private reference"}]',NULL,NULL,321,'private fixture note',NULL,NULL);
INSERT INTO public.vehicle_observations(id,vehicle_id,source_id,is_superseded,kind,extraction_method,confidence_score,structured_data)
SELECT '00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000001',
 '00000000-0000-0000-0000-000000000003',false,'expert_opinion','harness_source_model_review_v1',0.6,
 jsonb_build_object('domain','wiring','report_kind','foreign_vehicle_purchase_evidence',
  'manifest_id','00000000-0000-0000-0000-000000000010','is_inferred',true,'owner_confirmed',false,
  'reviewed_state_hash',pg_temp.state_hash('00000000-0000-0000-0000-000000000010'),
  'document_subject','other_vehicle','source_document_sha256',repeat('a',64));
CREATE TEMP TABLE before_image AS SELECT * FROM public.vehicle_build_manifest WHERE id='00000000-0000-0000-0000-000000000010';

SELECT set_config('request.jwt.claim.role','service_role',false);
SELECT structured_data->>'reviewed_state_hash' AS fixture_expected_hash FROM public.vehicle_observations
 WHERE id='00000000-0000-0000-0000-000000000020' \gset
SET ROLE service_role;
CREATE TEMP TABLE withdrawal_response AS
 SELECT public.correct_build_manifest_purchase_evidence('00000000-0000-0000-0000-000000000010',
  :'fixture_expected_hash',
  '00000000-0000-0000-0000-000000000020') AS result;
RESET ROLE;
DO $$ DECLARE r jsonb; m public.vehicle_build_manifest; before_ jsonb; old_hash text; BEGIN
 SELECT to_jsonb(b) INTO before_ FROM before_image b;
 SELECT structured_data->>'reviewed_state_hash' INTO old_hash FROM public.vehicle_observations WHERE id='00000000-0000-0000-0000-000000000020';
 SELECT result INTO r FROM withdrawal_response;
 SELECT * INTO m FROM public.vehicle_build_manifest WHERE id='00000000-0000-0000-0000-000000000010';
 PERFORM pg_temp.ok('withdrawn to explicit unknown, not false',m.purchased IS NULL AND m.status='identified' AND m.evidence_level='assumed' AND r->>'purchase_state'='unknown');
 PERFORM pg_temp.ok('typed source review edge',m.purchase_review_observation_id='00000000-0000-0000-0000-000000000020');
 PERFORM pg_temp.ok('complete private before-image retained',m.evidence_sources->1->'before'=before_);
 PERFORM pg_temp.ok('original private invoice retained',m.evidence_sources->0=before_->'evidence_sources'->0);
 PERFORM pg_temp.ok('only procurement qualification/audit and clock changed',
  to_jsonb(m)-ARRAY['purchased','status','evidence_level','purchase_review_observation_id','evidence_sources','updated_at']
  =before_-ARRAY['purchased','status','evidence_level','purchase_review_observation_id','evidence_sources','updated_at']);
 r:=public.correct_build_manifest_purchase_evidence(m.id,old_hash,m.purchase_review_observation_id);
 PERFORM pg_temp.ok('same cited review retries without duplicate audit',r->>'status'='unchanged' AND (SELECT evidence_sources FROM public.vehicle_build_manifest WHERE id=m.id)=m.evidence_sources);
END $$;

SELECT pg_temp.refused('comment cannot impersonate a genuine writer frame',
 $$UPDATE public.vehicle_build_manifest SET purchased=true,purchase_review_observation_id=NULL
 /* PL/pgSQL function correct_build_manifest_purchase_evidence(uuid,text,uuid) line 1 at SQL statement */
 WHERE id='00000000-0000-0000-0000-000000000010'$$,'42501');
SELECT pg_temp.refused('direct re-promotion refused',
 $$UPDATE public.vehicle_build_manifest SET purchased=true,purchase_review_observation_id=NULL WHERE id='00000000-0000-0000-0000-000000000010'$$,'42501');
SELECT pg_temp.refused('private audit overwrite refused',
 $$UPDATE public.vehicle_build_manifest SET evidence_sources='[]' WHERE id='00000000-0000-0000-0000-000000000010'$$,'42501');
SELECT pg_temp.refused('cross-vehicle retarget refused',
 $$UPDATE public.vehicle_build_manifest SET vehicle_id='00000000-0000-0000-0000-000000000002' WHERE id='00000000-0000-0000-0000-000000000010'$$,'42501');
SELECT pg_temp.refused('reviewed row deletion refused',
 $$DELETE FROM public.vehicle_build_manifest WHERE id='00000000-0000-0000-0000-000000000010'$$,'23514');
UPDATE public.vehicle_build_manifest SET device_name='Battery label retained for separate review' WHERE id='00000000-0000-0000-0000-000000000010';
SELECT pg_temp.ok('unrelated device edit remains possible',device_name='Battery label retained for separate review') FROM public.vehicle_build_manifest WHERE id='00000000-0000-0000-0000-000000000010';

-- A separate unreviewed device exercises source admission and race/physical-evidence refusals.
INSERT INTO public.vehicle_observations(id,vehicle_id,source_id,is_superseded,kind,extraction_method,confidence_score,structured_data)
SELECT '00000000-0000-0000-0000-000000000021',vehicle_id,source_id,is_superseded,kind,extraction_method,confidence_score,
 structured_data||jsonb_build_object('manifest_id','00000000-0000-0000-0000-000000000011',
 'reviewed_state_hash',pg_temp.state_hash('00000000-0000-0000-0000-000000000011'))
FROM public.vehicle_observations WHERE id='00000000-0000-0000-0000-000000000020';
CREATE TEMP TABLE valid_review AS SELECT * FROM public.vehicle_observations WHERE id='00000000-0000-0000-0000-000000000021';
DO $$ DECLARE alter_ text; label_ text; old_hash text; BEGIN
 SELECT structured_data->>'reviewed_state_hash' INTO old_hash FROM valid_review;
 FOR alter_,label_ IN SELECT * FROM (VALUES
  ($m$vehicle_id='00000000-0000-0000-0000-000000000002'$m$,'foreign vehicle'),
  ($m$is_superseded=true$m$,'superseded source'),
  ($m$superseded_by='00000000-0000-0000-0000-000000000020'$m$,'source with successor'),
  ($m$kind='provenance'$m$,'wrong review kind'),
  ($m$extraction_method='unqualified fixture'$m$,'wrong review method'),
  ($m$confidence_score=1$m$,'unqualified confidence'),
  ($m$structured_data=structured_data||'{"owner_confirmed":true}'$m$,'invented owner confirmation'),
  ($m$structured_data=structured_data||'{"document_subject":"this_vehicle"}'$m$,'same vehicle invoice'),
  ($m$structured_data=structured_data||'{"source_document_sha256":"missing"}'$m$,'absent captured-source digest'),
  ($m$structured_data=structured_data||'{"manifest_id":"00000000-0000-0000-0000-000000000010"}'$m$,'wrong device key')
 ) v(a,l) LOOP
  EXECUTE 'UPDATE public.vehicle_observations SET '||alter_||' WHERE id=''00000000-0000-0000-0000-000000000021''';
  PERFORM pg_temp.refused(label_,format('SELECT public.correct_build_manifest_purchase_evidence(%L,%L,%L)',
    '00000000-0000-0000-0000-000000000011',old_hash,'00000000-0000-0000-0000-000000000021'),'23514');
  UPDATE public.vehicle_observations o SET (vehicle_id,is_superseded,kind,extraction_method,confidence_score,structured_data,superseded_by)
   =(v.vehicle_id,v.is_superseded,v.kind,v.extraction_method,v.confidence_score,v.structured_data,v.superseded_by) FROM valid_review v WHERE o.id=v.id;
 END LOOP;
 UPDATE public.vehicle_build_manifest SET invoice_ref='changed reference' WHERE id='00000000-0000-0000-0000-000000000011';
 PERFORM pg_temp.refused('changed source snapshot',format('SELECT public.correct_build_manifest_purchase_evidence(%L,%L,%L)',
  '00000000-0000-0000-0000-000000000011',old_hash,'00000000-0000-0000-0000-000000000021'),'40001');
 UPDATE public.vehicle_build_manifest SET invoice_ref='fixture private reference',lifecycle_state='in_hand' WHERE id='00000000-0000-0000-0000-000000000011';
 old_hash:=pg_temp.state_hash('00000000-0000-0000-0000-000000000011');
 UPDATE public.vehicle_observations SET structured_data=structured_data||jsonb_build_object('reviewed_state_hash',old_hash) WHERE id='00000000-0000-0000-0000-000000000021';
 PERFORM pg_temp.refused('physical build evidence prevents automatic withdrawal',format('SELECT public.correct_build_manifest_purchase_evidence(%L,%L,%L)',
  '00000000-0000-0000-0000-000000000011',old_hash,'00000000-0000-0000-0000-000000000021'),'23514');
 UPDATE public.vehicle_build_manifest SET lifecycle_state=NULL,actual_cost=123 WHERE id='00000000-0000-0000-0000-000000000011';
 old_hash:=pg_temp.state_hash('00000000-0000-0000-0000-000000000011');
 UPDATE public.vehicle_observations SET structured_data=structured_data||jsonb_build_object('reviewed_state_hash',old_hash) WHERE id='00000000-0000-0000-0000-000000000021';
 PERFORM pg_temp.refused('actual cost prevents automatic withdrawal',format('SELECT public.correct_build_manifest_purchase_evidence(%L,%L,%L)',
  '00000000-0000-0000-0000-000000000011',old_hash,'00000000-0000-0000-0000-000000000021'),'23514');
 UPDATE public.vehicle_build_manifest SET actual_cost=NULL,evidence_sources=evidence_sources||'[{"type":"photo","ref":"independent physical source"}]' WHERE id='00000000-0000-0000-0000-000000000011';
 old_hash:=pg_temp.state_hash('00000000-0000-0000-0000-000000000011');
 UPDATE public.vehicle_observations SET structured_data=structured_data||jsonb_build_object('reviewed_state_hash',old_hash) WHERE id='00000000-0000-0000-0000-000000000021';
 PERFORM pg_temp.refused('independent source must not be erased by foreign invoice review',format('SELECT public.correct_build_manifest_purchase_evidence(%L,%L,%L)',
  '00000000-0000-0000-0000-000000000011',old_hash,'00000000-0000-0000-0000-000000000021'),'23514');
END $$;
SELECT pg_temp.ok('public has no private writer or audit or witness access',
 NOT has_function_privilege('anon','public.correct_build_manifest_purchase_evidence(uuid,text,uuid)','EXECUTE')
 AND NOT has_function_privilege('authenticated','public.correct_build_manifest_purchase_evidence(uuid,text,uuid)','EXECUTE')
 AND has_function_privilege('service_role','public.correct_build_manifest_purchase_evidence(uuid,text,uuid)','EXECUTE')
 AND NOT has_column_privilege('anon','public.vehicle_build_manifest','evidence_sources','SELECT')
 AND NOT has_column_privilege('anon','public.vehicle_build_manifest','purchase_review_observation_id','SELECT'));
SELECT pg_temp.ok('closure trigger is always enabled',tgenabled='A') FROM pg_trigger WHERE tgrelid='public.vehicle_build_manifest'::regclass AND tgname='build_manifest_purchase_review_guard';
-- The service role cannot simulate the postgres-owned writer by creating a
-- same-named SECURITY DEFINER function in its own temporary schema.
SET ROLE service_role;
CREATE FUNCTION pg_temp.correct_build_manifest_purchase_evidence(uuid,text,uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN
 UPDATE public.vehicle_build_manifest SET purchased=true,purchase_review_observation_id=NULL WHERE id=$1;
END $$;
DO $$ BEGIN
 BEGIN
  PERFORM pg_temp.correct_build_manifest_purchase_evidence('00000000-0000-0000-0000-000000000010',NULL,NULL);
  RAISE EXCEPTION 'spoofed writer was accepted';
 EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS service temp definer cannot spoof canonical writer';
 END;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.role','anon',false);
SELECT pg_temp.refused('no service context even for privileged caller',
 $$SELECT public.correct_build_manifest_purchase_evidence('00000000-0000-0000-0000-000000000010','5313adc4bf089cee10ec44d5b98341e8','00000000-0000-0000-0000-000000000020')$$,'42501');
SET ROLE anon;
SELECT id,purchased,status,evidence_level FROM public.vehicle_build_manifest ORDER BY id;
RESET ROLE;
