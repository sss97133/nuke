-- Upgrade the existing complete intake fixture, then test the actual current
-- receipt and qualification functions. Synthetic disposable PG17 only.
\set ON_ERROR_STOP on
\i supabase/sql/test_contributor_intake.sql
RESET ROLE;
RESET request.jwt.claims;
CREATE TABLE public.image_observations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),image_id uuid,
  vehicle_id uuid,confidence_basis jsonb,observed_by text,observed_at timestamptz DEFAULT now(),
  is_active boolean DEFAULT true,superseded_by uuid);
ALTER TABLE public.vehicle_images ADD COLUMN is_duplicate boolean,ADD COLUMN doc_flag boolean,
 ADD COLUMN vision_gate_status text,ADD COLUMN taken_at timestamptz;
CREATE TABLE public.observation_extractors(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),source_id uuid NOT NULL REFERENCES public.observation_sources(id),
 slug text UNIQUE NOT NULL,display_name text NOT NULL,extractor_type text NOT NULL,edge_function_name text,
 extractor_config jsonb DEFAULT '{}',produces_kinds public.observation_kind[],is_active boolean DEFAULT true,schedule_type text DEFAULT 'on_demand');
\i supabase/migrations/20261030154125_qualify_contributor_evidence_receipts.sql

SELECT pg_temp.ok('historical label-based flags no longer establish current proof',
 (public.contributor_intake_progress_for('20d21fb0-4651-4469-a0ba-e751309a1e54')#>>'{counts,proven}')::int=0
 AND (SELECT count(*)=2 FROM public.vehicle_evidence_items
 WHERE vehicle_id='20d21fb0-4651-4469-a0ba-e751309a1e54' AND status='proven'));
SET test.auth_uid='00000000-0000-0000-0000-00000000000a';
INSERT INTO public.vehicles(id,user_id,year,make,model,vin)
 VALUES('a0000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-00000000000a',2000,'Fixture','Test','1M8GDM9AXKP042788');
INSERT INTO public.vehicle_evidence_items(vehicle_id,key,label,kind,satisfied_by,acceptance_rule)
 VALUES('a0000000-0000-4000-8000-000000000001','shot_vin_plate','Windshield VIN plate','photo','Windshield VIN plate','{"kind":"native_vehicle_identifier_v1"}'),
 ('a0000000-0000-4000-8000-000000000001','engine_claim','Engine internals','photo','Engine internals','{}'),
 ('a0000000-0000-4000-8000-000000000001','history','Build history','question','history','{}');
INSERT INTO public.vehicle_evidence_rungs(vehicle_id,key,position,label,basis,requirements,comps_spec)
 VALUES('a0000000-0000-4000-8000-000000000001','base',0,'Unverified','Fixture only','[]','{}'),
 ('a0000000-0000-4000-8000-000000000001','identifier',1,'Identifier documented','Fixture only','["shot_vin_plate"]','{}');
CREATE TEMP TABLE qualification_invite AS SELECT public.create_contributor_invite(
 'a0000000-0000-4000-8000-000000000001','Fixture contributor','builder') AS r;
SELECT public.set_contributor_intake_questions('a0000000-0000-4000-8000-000000000001',
 '[{"key":"history","prompt":"Describe the history","required":true}]');
CREATE TEMP TABLE unrelated_file AS SELECT public.contributor_intake_file(r->>'token',jsonb_build_object(
 'storage_path','vehicle-photos/contributors/'||(r->>'invite_id')||'/'||repeat('7',64)||'/unrelated.jpg',
 'image_url','https://example.test/unrelated.jpg','file_name','unrelated.jpg','mime_type','image/jpeg',
 'size_bytes',1,'sha256',repeat('7',64),'label','shot_vin_plate')) AS r FROM qualification_invite;
SELECT pg_temp.ok('a file with the expected label is received without proving the claim or advancing a rung',
 (SELECT r->>'ok'='true' AND r#>>'{progress,rung,key}'='base'
   AND (r#>>'{progress,counts,proven}')::int=0 FROM unrelated_file)
 AND (SELECT received_count=1 AND status='open' AND proof_ref IS NULL AND source_read_status='pending'
   FROM public.vehicle_evidence_items WHERE vehicle_id='a0000000-0000-4000-8000-000000000001' AND key='shot_vin_plate'));
SELECT pg_temp.ok('receipt has a durable review and explicitly non-verifying change record',
 EXISTS(SELECT FROM public.contributor_intake_reevaluations WHERE image_id=(SELECT (r->>'image_id')::uuid FROM unrelated_file))
 AND EXISTS(SELECT FROM public.vehicle_evidence_changes WHERE source_ref=(SELECT (r->>'image_id')::uuid FROM unrelated_file)
   AND event_kind='input_received' AND to_status='received' AND proof_ref IS NULL
   AND reasoning->>'rule'='contributor_input_received_v1' AND reasoning#>>'{result,claim_verified}'='false'));
SELECT public.contributor_intake_file(i.r->>'token',jsonb_build_object(
 'storage_path','vehicle-photos/contributors/'||(i.r->>'invite_id')||'/'||repeat('7',64)||'/unrelated.jpg',
 'image_url','https://example.test/unrelated.jpg','file_name','unrelated.jpg','mime_type','image/jpeg',
 'size_bytes',1,'sha256',repeat('7',64),'label','shot_vin_plate')) FROM qualification_invite i;
SELECT pg_temp.ok('replay neither repeats receipt nor queues another physical extraction',
 (SELECT received_count=1 FROM public.vehicle_evidence_items WHERE vehicle_id='a0000000-0000-4000-8000-000000000001' AND key='shot_vin_plate')
 AND (SELECT count(*)=1 FROM public.contributor_intake_reevaluations WHERE image_id=(SELECT (r->>'image_id')::uuid FROM unrelated_file)));
CREATE TEMP TABLE qualified_answer AS SELECT public.contributor_intake_answer(r->>'token','history',
 'The contributor reports a rebuild.','{}') AS r FROM qualification_invite;
SELECT pg_temp.ok('a completed answer remains testimony rather than mechanical verification',
 (SELECT r->>'ok'='true' AND (r#>>'{progress,counts,proven}')::int=0 FROM qualified_answer)
 AND (SELECT received_count=1 AND status='open' AND proof_ref IS NULL FROM public.vehicle_evidence_items
 WHERE vehicle_id='a0000000-0000-4000-8000-000000000001' AND key='history'));

-- A retained owner frame can be offered without uploading its bytes again.
CREATE TEMP TABLE original_frame AS WITH inserted AS (
 INSERT INTO public.vehicle_images(vehicle_id,user_id,image_url,file_hash,file_name,is_document,taken_at)
 VALUES('a0000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-00000000000a',
  'https://example.test/plate.jpg',repeat('9',64),'plate.jpg',false,'2026-10-01T12:00:00Z') RETURNING id)
 SELECT id FROM inserted;
CREATE TEMP TABLE retained_offer AS SELECT public.contributor_intake_file(r->>'token',jsonb_build_object(
 'storage_path','vehicle-photos/contributors/'||(r->>'invite_id')||'/'||repeat('9',64)||'/plate.jpg',
 'image_url','https://example.test/plate.jpg','file_name','plate.jpg','mime_type','image/jpeg',
 'size_bytes',1,'sha256',repeat('9',64),'label','shot_vin_plate')) AS r FROM qualification_invite;
SELECT pg_temp.ok('retained file reuse records the offered evidence and preserves its photographer',
 (SELECT (r->>'duplicate')::boolean AND (r->>'image_id')::uuid=(SELECT id FROM original_frame)
  AND (r#>>'{progress,counts,proven}')::int=0 FROM retained_offer)
 AND (SELECT user_id='00000000-0000-0000-0000-00000000000a' FROM public.vehicle_images WHERE id=(SELECT id FROM original_frame)));
CREATE TEMP TABLE qualified_reading AS WITH inserted AS (
 INSERT INTO public.image_observations(image_id,observed_by,confidence_basis)
 SELECT id,'visual_subject_reading_v1',jsonb_build_object('visual_subject_reading_v1',jsonb_build_object('envelope',
  jsonb_build_object('user_id','00000000-0000-0000-0000-00000000000a','inputs',jsonb_build_array(
   jsonb_build_object('image_id',id,'source_sha256',repeat('9',64),'input_sha256',repeat('9',64),'source_qualified',true)),
   'provider','Apple Vision (on-device)','model','vehicle-identity-context-fold-v3:fixture',
   'run_key','70000000-0000-4000-8000-000000000001',
   'raw_model_reading',jsonb_build_object('kind','on_device_identity_read_v1',
    'identity_run_id','70000000-0000-4000-8000-000000000001',
    'identity_method_version','vehicle-identity-context-fold-v3:fixture',
    'observations',jsonb_build_array(jsonb_build_object('image_id',id,'is_document',false,
      'vin_candidates',jsonb_build_array('1M8GDM9AXKP042788'),'on_device',jsonb_build_array(jsonb_build_object(
       'kind','ocr_text','value','1M8GDM9AXKP042788','confidence',0.99,'repaired',false,
       'source',jsonb_build_object('framework','Apple Vision','model','VNRecognizeTextRequest','revision',3,'method','v1'))))))))) FROM original_frame RETURNING id)
 SELECT id FROM inserted;
CREATE TEMP TABLE native_owner_acl AS SELECT oid,proacl,proowner FROM pg_proc WHERE oid IN
 ('public.evaluate_contributor_evidence_item(uuid,uuid)'::regprocedure,'public.contributor_retained_reading_for(uuid)'::regprocedure);
\i supabase/migrations/20261030213042_qualify_retained_native_identifier_witness.sql
SELECT pg_temp.ok('only the explicit source-bound identifier rule can qualify the VIN claim',
 (SELECT public.evaluate_contributor_evidence_item(i.id,r.id)->>'qualified'='true'
  FROM public.vehicle_evidence_items i,qualified_reading r
  WHERE i.vehicle_id='a0000000-0000-4000-8000-000000000001' AND i.key='shot_vin_plate'));
SELECT pg_temp.ok('zero capacity and another compute owner claim no work',
 public.claim_contributor_intake_reevaluation('zero',0,NULL,NULL)='[]'::jsonb
 AND public.claim_contributor_intake_reevaluation('wrong-owner',10,NULL,'00000000-0000-0000-0000-00000000000c')='[]'::jsonb);
CREATE TEMP TABLE review_claims AS SELECT x AS r FROM jsonb_array_elements(
 public.claim_contributor_intake_reevaluation('fixture-worker',10,'a0000000-0000-4000-8000-000000000001',NULL)) x;
SELECT pg_temp.ok('only new inputs are leased with pinned revision, unique nonce and retained compute authority',
 (SELECT count(*)=3 AND bool_and(r->>'lease_token' IS NOT NULL AND r#>>'{compute_authority,mode}'='retained_readings_only'
 AND r#>>'{compute_authority,cost_cents}'='0') FROM review_claims)
 AND NOT EXISTS(SELECT FROM public.contributor_intake_reevaluations WHERE request_revision=0 AND worker_id='fixture-worker'));
-- Kill the worker after claiming the source with its already-retained reading.
UPDATE public.contributor_intake_reevaluations SET lease_expires_at=clock_timestamp()-interval '1 second'
 WHERE image_id=(SELECT id FROM original_frame);
CREATE TEMP TABLE recovered_claim AS SELECT x AS r FROM jsonb_array_elements(
 public.claim_contributor_intake_reevaluation('fixture-worker',1,'a0000000-0000-4000-8000-000000000001',NULL)) x;
SELECT pg_temp.ok('expired claim recovers with a new nonce even when the worker name repeats',
 (SELECT count(*)=1 FROM recovered_claim)
 AND (SELECT old.r->>'lease_token'<>new.r->>'lease_token' FROM review_claims old,recovered_claim new
 WHERE old.r->>'id'=new.r->>'id'));
SELECT pg_temp.ok('the crashed worker cannot publish or acknowledge its stale lease',
 (SELECT public.finish_contributor_intake_reevaluation((r->>'id')::uuid,'fixture-worker',
  (r->>'claimed_revision')::bigint,(r->>'lease_token')::uuid)->>'status'='lease_lost'
 FROM review_claims WHERE r->>'image_id'=(SELECT id::text FROM original_frame)));
CREATE TEMP TABLE recovered_result AS SELECT public.finish_contributor_intake_reevaluation((r->>'id')::uuid,'fixture-worker',
 (r->>'claimed_revision')::bigint,(r->>'lease_token')::uuid) AS r FROM recovered_claim;
SELECT pg_temp.ok('recovery reuses the retained extraction and persists the evidence-based review',
 (SELECT r->>'status'='done' AND r#>>'{result,reading_ref}'=(SELECT id::text FROM qualified_reading) FROM recovered_result)
 AND (SELECT count(*)=1 FROM public.image_observations)
 AND EXISTS(SELECT FROM public.vehicle_evidence_changes WHERE source_ref=(SELECT id FROM original_frame)
  AND event_kind='claim_assessed' AND proof_ref=(SELECT id FROM original_frame)));
SELECT pg_temp.ok('repeat completion is idempotent',
 (SELECT public.finish_contributor_intake_reevaluation((r->>'id')::uuid,'fixture-worker',
  (r->>'claimed_revision')::bigint,(r->>'lease_token')::uuid)->>'status'='already_completed' FROM recovered_claim)
 AND (SELECT count(*)=1 FROM public.vehicle_evidence_changes WHERE source_ref=(SELECT id FROM original_frame) AND event_kind='claim_assessed'));
SELECT public.finish_contributor_intake_reevaluation((r->>'id')::uuid,'fixture-worker',
 (r->>'claimed_revision')::bigint,(r->>'lease_token')::uuid) FROM review_claims
 WHERE r->>'image_id' IS DISTINCT FROM (SELECT id::text FROM original_frame);
SELECT pg_temp.ok('an answered question stays answered while its mechanical claim remains unresolved and receives a relevant follow-up',
 (SELECT status='answered' FROM public.contributor_intake_questions WHERE vehicle_id='a0000000-0000-4000-8000-000000000001' AND key='history')
 AND EXISTS(SELECT FROM public.contributor_intake_questions WHERE vehicle_id='a0000000-0000-4000-8000-000000000001'
  AND key='review_'||substr(md5('history'),1,16) AND round=2 AND prompt LIKE '%Build history%')
 AND (SELECT assessment_status='unresolved' AND source_read_status='read' FROM public.vehicle_evidence_items
 WHERE vehicle_id='a0000000-0000-4000-8000-000000000001' AND key='history'));
SELECT pg_temp.ok('the reader returns qualified proof and its source pointer',
 (SELECT public.contributor_intake_progress_for('a0000000-0000-4000-8000-000000000001')#>>'{rung,key}'='identifier')
 AND (SELECT status='proven' AND proof_ref=(SELECT id FROM original_frame)
  FROM public.contributor_evidence_items_for('a0000000-0000-4000-8000-000000000001') WHERE key='shot_vin_plate'));

-- Reuse the exact same retained file for a different claim, then let another
-- contributor offer it during the active review. No bytes or testimony repeat.
SELECT public.contributor_intake_file(r->>'token',jsonb_build_object(
 'storage_path','vehicle-photos/contributors/'||(r->>'invite_id')||'/'||repeat('9',64)||'/plate.jpg',
 'image_url','https://example.test/plate.jpg','file_name','plate.jpg','mime_type','image/jpeg',
 'size_bytes',1,'sha256',repeat('9',64),'label','engine_claim')) FROM qualification_invite;
CREATE TEMP TABLE arriving_claim AS SELECT x AS r FROM jsonb_array_elements(
 public.claim_contributor_intake_reevaluation('arrivals',1,'a0000000-0000-4000-8000-000000000001',NULL)) x;
CREATE TEMP TABLE second_invite AS SELECT public.create_contributor_invite(
 'a0000000-0000-4000-8000-000000000001','Second fixture contributor','shop') AS r;
SELECT public.contributor_intake_file(r->>'token',jsonb_build_object(
 'storage_path','vehicle-photos/contributors/'||(r->>'invite_id')||'/'||repeat('9',64)||'/plate.jpg',
 'image_url','https://example.test/plate.jpg','file_name','plate.jpg','mime_type','image/jpeg',
 'size_bytes',1,'sha256',repeat('9',64),'label','shot_vin_plate')) FROM second_invite;
SELECT pg_temp.ok('completion acknowledges its revision and preserves an arrival during calculation',
 (SELECT public.finish_contributor_intake_reevaluation((r->>'id')::uuid,'arrivals',
  (r->>'claimed_revision')::bigint,(r->>'lease_token')::uuid)->>'status'='queued' FROM arriving_claim)
 AND (SELECT count(*)=1 FROM public.image_observations));
SELECT pg_temp.ok('retained reading qualifies only its registered claim and refines the unsupported engine question',
 (SELECT status='open' AND assessment_status='unresolved' AND source_read_status='read'
  FROM public.vehicle_evidence_items WHERE vehicle_id='a0000000-0000-4000-8000-000000000001' AND key='engine_claim')
 AND EXISTS(SELECT FROM public.contributor_intake_questions WHERE vehicle_id='a0000000-0000-4000-8000-000000000001'
  AND key='review_'||substr(md5('engine_claim'),1,16) AND prompt LIKE '%Engine internals%'));
CREATE TEMP TABLE final_claim AS SELECT x AS r FROM jsonb_array_elements(
 public.claim_contributor_intake_reevaluation('final-arrival',1,'a0000000-0000-4000-8000-000000000001',NULL)) x;
SELECT public.finish_contributor_intake_reevaluation((r->>'id')::uuid,'final-arrival',
 (r->>'claimed_revision')::bigint,(r->>'lease_token')::uuid) FROM final_claim;
SELECT pg_temp.ok('new context on a retained input is counted once and the latest review revision completes',
 (SELECT request_revision=completed_revision AND status='done' FROM public.contributor_intake_reevaluations
  WHERE image_id=(SELECT id FROM original_frame))
 AND (SELECT received_count=3 FROM public.vehicle_evidence_items
  WHERE vehicle_id='a0000000-0000-4000-8000-000000000001' AND key='shot_vin_plate'));
UPDATE public.vehicle_evidence_items SET assessment=jsonb_build_object('reading_ref',(SELECT id FROM qualified_reading),'qualified',true),
 acceptance_rule='{"kind":"native_vehicle_identifier_v1"}' WHERE vehicle_id='a0000000-0000-4000-8000-000000000001' AND key='engine_claim';
SELECT pg_temp.ok('a VIN reading and a forged passed flag cannot prove engine internals',
 (SELECT status='open' AND assessment_status='unresolved' FROM public.contributor_evidence_items_for('a0000000-0000-4000-8000-000000000001')
  WHERE key='engine_claim'));
UPDATE public.vehicle_images SET file_hash=repeat('6',64) WHERE id=(SELECT id FROM original_frame);
SELECT pg_temp.ok('changed source bytes immediately invalidate cached proof in the reader',
 public.contributor_intake_progress_for('a0000000-0000-4000-8000-000000000001')#>>'{rung,key}'='base');
UPDATE public.vehicle_images SET file_hash=repeat('9',64) WHERE id=(SELECT id FROM original_frame);
UPDATE public.image_observations SET is_active=false WHERE id=(SELECT id FROM qualified_reading);
SELECT pg_temp.ok('withdrawn readings cannot leave a proven claim visible',
 (public.contributor_intake_progress_for('a0000000-0000-4000-8000-000000000001')#>>'{counts,proven}')::int=0);
CREATE TEMP TABLE retry_claim AS SELECT x AS r FROM jsonb_array_elements(
 public.claim_contributor_intake_reevaluation('retry',1,'a0000000-0000-4000-8000-000000000001',NULL)) x;
CREATE TEMP TABLE retry_result AS SELECT public.retry_contributor_intake_reevaluation((r->>'id')::uuid,'retry',
 (r->>'claimed_revision')::bigint,(r->>'lease_token')::uuid) AS r FROM retry_claim;
SELECT pg_temp.ok('a fenced interruption retains work with a bounded retry delay',
 (SELECT r->>'status'='retry' FROM retry_result)
 AND (SELECT status='failed' AND request_revision>completed_revision AND next_attempt_at>clock_timestamp()
  FROM public.contributor_intake_reevaluations WHERE image_id=(SELECT id FROM original_frame)));
SELECT pg_temp.ok('unfenced legacy completion and unprivileged review calls are refused',
 NOT has_function_privilege('anon','public.finish_contributor_intake_reevaluation(uuid,text,bigint,uuid)','EXECUTE')
 AND NOT has_function_privilege('authenticated','public.claim_contributor_intake_reevaluation(text,integer,uuid,uuid)','EXECUTE'));

-- Exercise the actual reader with malformed/unqualified native payloads, not
-- only the boolean helper. Original receipt and testimony stay unchanged.
UPDATE public.image_observations SET is_active=true WHERE id=(SELECT id FROM qualified_reading);
DO $test$ DECLARE original jsonb; changed jsonb; patch jsonb; item_id uuid; reading_id uuid;
BEGIN
 SELECT id INTO reading_id FROM qualified_reading;
 SELECT confidence_basis INTO original FROM public.image_observations WHERE id=reading_id;
 SELECT id INTO item_id FROM public.vehicle_evidence_items
  WHERE vehicle_id='a0000000-0000-4000-8000-000000000001' AND key='shot_vin_plate';
 FOR patch IN SELECT x FROM jsonb_array_elements('[
  {"confidence":0.89},{"repaired":true},{"confidence":"0.99"},
  {"value":"1M8GDM9AXKP042788 1HGCM82633A004352"},
  {"source":{"framework":"other","model":"VNRecognizeTextRequest","revision":3,"method":"v1"}},
  {"source":{"framework":"Apple Vision","model":"VNRecognizeTextRequest","revision":0,"method":"v1"}}
 ]'::jsonb) x LOOP
  changed:=jsonb_set(original,'{visual_subject_reading_v1,envelope,raw_model_reading,observations,0,on_device,0}',
    original#>'{visual_subject_reading_v1,envelope,raw_model_reading,observations,0,on_device,0}'||patch);
  UPDATE public.image_observations SET confidence_basis=changed WHERE id=reading_id;
  PERFORM pg_temp.ok('unqualified OCR cannot prove the actual claim or advance its rung',
   public.evaluate_contributor_evidence_item(item_id,reading_id)->'qualified'='false'::jsonb
   AND public.contributor_intake_progress_for('a0000000-0000-4000-8000-000000000001')#>>'{rung,key}'='base');
 END LOOP;
 FOR changed IN SELECT x FROM (VALUES
  (jsonb_set(original,'{visual_subject_reading_v1,envelope,raw_model_reading,observations,0,vin_candidates}',
   '["1M8GDM9AXKP042788","1HGCM82633A004352"]')),
  (jsonb_set(original,'{visual_subject_reading_v1,envelope,user_id}',to_jsonb(gen_random_uuid()::text))),
  (jsonb_set(original,'{visual_subject_reading_v1,envelope,raw_model_reading,identity_run_id}',to_jsonb(gen_random_uuid()::text))),
  (original#-'{visual_subject_reading_v1,envelope,raw_model_reading,observations,0,on_device}'),
  (original#-'{visual_subject_reading_v1,envelope,raw_model_reading,identity_run_id}')
 ) invalid(x) LOOP
  UPDATE public.image_observations SET confidence_basis=changed WHERE id=reading_id;
  PERFORM pg_temp.ok('ambiguous candidates, absent readings and substituted owner/run cannot prove a claim',
   public.evaluate_contributor_evidence_item(item_id,reading_id)->'qualified'='false'::jsonb);
 END LOOP;
 UPDATE public.image_observations SET confidence_basis=original WHERE id=reading_id;
 PERFORM pg_temp.ok('actual native reading qualifies with pinned stronger revision',
  public.evaluate_contributor_evidence_item(item_id,reading_id)->>'qualification_revision'='native_vehicle_identifier_v2');
 -- A later model context with candidate strings cannot displace the reusable
 -- original qualified native witness or force completed extraction again.
 INSERT INTO public.image_observations(image_id,observed_by,observed_at,confidence_basis)
 SELECT image_id,observed_by,clock_timestamp()+interval '1 second',
  jsonb_set(original#-'{visual_subject_reading_v1,envelope,raw_model_reading,observations,0,on_device}',
    '{visual_subject_reading_v1,envelope,raw_model_reading,kind}','"on_device_identity_context_v1"')
 FROM public.image_observations WHERE id=reading_id;
 PERFORM pg_temp.ok('later candidate-only context does not hide a retained qualified native witness',
  public.contributor_retained_reading_for((SELECT id FROM original_frame))=reading_id);
END $test$;
SELECT pg_temp.ok('existing qualification owner grants and ownership stay unchanged',
 NOT EXISTS(SELECT FROM native_owner_acl a JOIN pg_proc p ON p.oid=a.oid
 WHERE p.proacl IS DISTINCT FROM a.proacl OR p.proowner<>a.proowner)
 AND NOT has_function_privilege('authenticated','public.contributor_native_identifier_matches(jsonb,text)','EXECUTE')
 AND NOT has_function_privilege('anon','public.contributor_native_identifier_matches(jsonb,text)','EXECUTE'));
\i supabase/migrations/20261030213042_qualify_retained_native_identifier_witness.sql
