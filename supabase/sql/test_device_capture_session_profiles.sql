-- Synthetic PG17 contract only; the included fixture refuses non-disposable databases.
\ir test_device_attribution.sql
SET ROLE dm_contract_deployer;
CREATE TABLE public.image_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), image_id uuid NOT NULL, vehicle_id uuid, cluster_id uuid,
  role text NOT NULL, confidence numeric NOT NULL, confidence_basis jsonb NOT NULL, observed_by text NOT NULL,
  agent_version text NOT NULL, is_active boolean NOT NULL DEFAULT true, superseded_by uuid
);
RESET ROLE;
\ir ../migrations/20261019020000_device_capture_session_profiles.sql

-- All fixture writes below remain in the disposable dm_refinement_* database.
INSERT INTO public.profiles(id) VALUES (pg_temp.u('capture'));
INSERT INTO public.vehicle_images(id,user_id,image_url,file_hash,taken_at,latitude,longitude)
SELECT pg_temp.i('capture-' || n), pg_temp.u('capture'), 'https://fixture.invalid/' || n,
  repeat(n::text,64), '2026-01-01T12:00:00Z'::timestamptz + n * interval '30 seconds',
  35.0, -115.0 FROM generate_series(1,8) n;
UPDATE public.vehicle_images SET vision_gate_status='approved',is_document=false,is_sensitive=false
 WHERE id IN (SELECT pg_temp.i('capture-' || n) FROM generate_series(1,8) n);
CREATE FUNCTION pg_temp.capture_request() RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('basis','capture_session','serial','CKR187F127263',
   'year',1966,'make','Ford','model','Mustang',
   'image_ids',jsonb_build_array(pg_temp.i('capture-1'),pg_temp.i('capture-2')),
   'evidence',jsonb_build_object('context_method','vin_capture_session_v1',
     'identity_run_id','30000000-0000-4000-8000-000000000001',
     'identity_method_version','vehicle-identity-context-fold-v3:fixture',
     'anchor_image_id',pg_temp.i('capture-1'),'anchor_source_sha256',repeat('1',64),
     'identifier_read','CKR187F127263','edit_distance','0','identifier_legibility','clear'))
$$;
CREATE FUNCTION pg_temp.chevrolet_capture_request() RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(pg_temp.capture_request(),
   '{make}',to_jsonb('Chevrolet'::text)),'{model}',to_jsonb('C10 Pickup'::text)),
   '{image_ids}',jsonb_build_array(pg_temp.i('capture-7'),pg_temp.i('capture-8'))),
   '{evidence,anchor_image_id}',to_jsonb(pg_temp.i('capture-7'))),
   '{evidence,anchor_source_sha256}',to_jsonb(repeat('7',64)))
$$;
CREATE FUNCTION pg_temp.record_capture_reading(anchor_label text, member_label text, anchor_vin text DEFAULT 'CKR187F127263') RETURNS void LANGUAGE plpgsql AS $$
DECLARE e jsonb; anchor_id uuid:=pg_temp.i(anchor_label); member_id uuid:=pg_temp.i(member_label);
BEGIN
 SELECT jsonb_build_object('user_id',pg_temp.u('capture'),'method','visual_subjects_v1','run_key','30000000-0000-4000-8000-000000000001',
   'provider','Apple Vision (on-device)','model','vehicle-identity-context-fold-v3:fixture','read_at',clock_timestamp(),
   'inputs',(SELECT jsonb_agg(jsonb_build_object('image_id',id,'source_sha256',file_hash,'input_sha256',file_hash,
     'source_qualified',true,'source_bytes_qualified',true,'representation','source','source_url',image_url,'input_url',image_url,
     'created_at',created_at,'taken_at',taken_at,'mime_type','image/jpeg','byte_length',100) ORDER BY id)
      FROM public.vehicle_images WHERE id IN (anchor_id,member_id)),
   'subjects','[]'::jsonb,'frames','[]'::jsonb,'unresolved','[]'::jsonb,'contradictions','[]'::jsonb,'rejected_links',0,
   'candidate_scope',jsonb_build_object('kind','account_associated_terminal_vehicles','vehicle_ids','[]'::jsonb,'retrieved',0,
     'exhausted',false,'truncated',false,'reference_photos_assessed',0,'unavailable_references','[]'::jsonb,'global_novelty_asserted',false),
   'raw_model_reading',jsonb_build_object('kind','on_device_identity_read_v1','identity_run_id','30000000-0000-4000-8000-000000000001',
     'identity_method_version','vehicle-identity-context-fold-v3:fixture','observations',jsonb_build_array(
       jsonb_build_object('image_id',anchor_id,'is_vehicle',false,'is_document',false,'labels',jsonb_build_array('VIN plate'),
         'vin_candidates',jsonb_build_array(anchor_vin)),
       jsonb_build_object('image_id',member_id,'is_vehicle',true,'is_document',false,'labels',jsonb_build_array('car'),'vin_candidates','[]'::jsonb))))
 INTO e;
 INSERT INTO public.image_observations(image_id,role,confidence,confidence_basis,observed_by,agent_version)
 VALUES(anchor_id,'part',0,jsonb_build_object('visual_subject_reading_v1',jsonb_build_object('envelope',e)),
   'visual_subject_reading_v1','visual_subject_reading_v1'),
       (member_id,'part',0,jsonb_build_object('visual_subject_reading_v1',jsonb_build_object('envelope',e)),
   'visual_subject_reading_v1','visual_subject_reading_v1');
END $$;
SELECT set_config('request.jwt.claims',json_build_object('role','authenticated','sub',pg_temp.u('capture'))::text,false);

SELECT pg_temp.record_capture_reading('capture-1','capture-2');

UPDATE public.image_observations SET confidence_basis = jsonb_set(confidence_basis,
  '{visual_subject_reading_v1,envelope,user_id}', to_jsonb(pg_temp.u('other')::text))
 WHERE image_id IN (pg_temp.i('capture-1'),pg_temp.i('capture-2'));
SET ROLE authenticated;
SELECT public.device_create_vehicle_profile(pg_temp.capture_request()) AS r \gset wrong_owner_read_
RESET ROLE;
SELECT pg_temp.ok('another account’s device read cannot qualify this capture',
 :'wrong_owner_read_r'::jsonb->>'status'='insufficient_evidence');
UPDATE public.image_observations SET confidence_basis = jsonb_set(confidence_basis,
  '{visual_subject_reading_v1,envelope,user_id}', to_jsonb(pg_temp.u('capture')::text))
 WHERE image_id IN (pg_temp.i('capture-1'),pg_temp.i('capture-2'));

-- Validate source custody and contextual bounds before creating anything.
SET ROLE authenticated;
SELECT public.device_create_vehicle_profile(jsonb_set(pg_temp.capture_request(),'{evidence,identifier_legibility}',
 to_jsonb('partial'::text))) AS r \gset partial_new_
SELECT public.device_create_vehicle_profile(pg_temp.capture_request()-'make') AS r \gset no_namespace_
SELECT public.device_create_vehicle_profile(pg_temp.capture_request() #- '{evidence,anchor_source_sha256}') AS r \gset missing_hash_
SELECT public.device_create_vehicle_profile(jsonb_set(pg_temp.capture_request(),'{evidence,anchor_source_sha256}',to_jsonb(repeat('0',64)))) AS r \gset wrong_hash_
RESET ROLE;
SELECT pg_temp.ok('partial identifiers cannot mint and classic identifiers retain a make namespace',
 :'partial_new_r'::jsonb->>'status'='insufficient_evidence'
 AND :'no_namespace_r'::jsonb->>'status'='insufficient_evidence'
 AND NOT EXISTS(SELECT 1 FROM public.vehicles WHERE vin='CKR187F127263'));
SELECT pg_temp.ok('a source-bound anchor is required',
 :'missing_hash_r'::jsonb->>'status'='insufficient_evidence' AND :'wrong_hash_r'::jsonb->>'status'='insufficient_evidence');
UPDATE public.vehicle_images SET latitude=36 WHERE id=pg_temp.i('capture-2');
SET ROLE authenticated;
SELECT public.device_create_vehicle_profile(pg_temp.capture_request()) AS r \gset wrong_place_
RESET ROLE;
SELECT pg_temp.ok('distant photos do not inherit the anchor', :'wrong_place_r'::jsonb->>'status'='insufficient_evidence');
UPDATE public.vehicle_images SET latitude=35.0003 WHERE id=pg_temp.i('capture-2');
SET ROLE authenticated;
SELECT public.device_create_vehicle_profile(pg_temp.capture_request()) AS r \gset adjacent_bay_
RESET ROLE;
SELECT pg_temp.ok('a neighboring bay does not inherit the anchor', :'adjacent_bay_r'::jsonb->>'status'='insufficient_evidence');
UPDATE public.vehicle_images SET latitude=35 WHERE id=pg_temp.i('capture-2');
UPDATE public.vehicle_images SET latitude=35,taken_at='2026-01-01T13:00:00Z' WHERE id=pg_temp.i('capture-2');
SELECT pg_temp.record_capture_reading('capture-1','capture-2');
SET ROLE authenticated;
SELECT public.device_create_vehicle_profile(pg_temp.capture_request()) AS r \gset wrong_clock_
RESET ROLE;
SELECT pg_temp.ok('a later visit does not inherit the anchor', :'wrong_clock_r'::jsonb->>'status'='insufficient_evidence');
UPDATE public.vehicle_images SET taken_at='2026-01-01T12:01:00Z',is_sensitive=true WHERE id=pg_temp.i('capture-2');
SET ROLE authenticated;
SELECT public.device_create_vehicle_profile(pg_temp.capture_request()) AS r \gset sensitive_
RESET ROLE;
SELECT pg_temp.ok('sensitive source members cannot seed or join a profile', :'sensitive_r'::jsonb->>'status'='insufficient_evidence');
UPDATE public.vehicle_images SET is_sensitive=false WHERE id=pg_temp.i('capture-2');
SELECT pg_temp.record_capture_reading('capture-1','capture-2');
SELECT pg_temp.record_capture_reading('capture-3','capture-2','1HGCM82633A004352');
SET ROLE authenticated;
SELECT public.device_create_vehicle_profile(pg_temp.capture_request()) AS r \gset conflict_vin_
RESET ROLE;
SELECT pg_temp.ok('a nearby conflicting fresh VIN blocks client-selected membership',
 :'conflict_vin_r'::jsonb->>'status'='insufficient_evidence');
UPDATE public.vehicle_images SET is_sensitive=true WHERE id=pg_temp.i('capture-3');

SET ROLE authenticated;
SELECT public.device_create_vehicle_profile(pg_temp.capture_request()) AS r \gset capture_
SELECT public.device_create_vehicle_profile(pg_temp.capture_request()) AS r \gset replay_
RESET ROLE;
SELECT pg_temp.ok('a classic serial and nearby views seed one private profile without unique camera metadata or an album',
 :'capture_r'::jsonb->>'status'='created'
 AND (SELECT count(*) FROM public.vehicles WHERE vin='CKR187F127263')=1
 AND (SELECT count(*) FROM public.vehicle_images WHERE id IN (pg_temp.i('capture-1'),pg_temp.i('capture-2'))
      AND vehicle_id=(:'capture_r'::jsonb->>'vehicle_id')::uuid)=2
 AND (SELECT is_public=false AND owner_id IS NULL AND created_via_role='photographer'
      AND vin_source='device_capture_session' AND vin_source_image_id=pg_temp.i('capture-1')
      AND year_source='device_capture_session' FROM public.vehicles WHERE vin='CKR187F127263')
 AND EXISTS(SELECT 1 FROM public.vehicle_contributors WHERE vehicle_id=(:'capture_r'::jsonb->>'vehicle_id')::uuid
      AND user_id=pg_temp.u('capture') AND role='photographer' AND can_sell=false)
 AND :'replay_r'::jsonb->>'vehicle_id'=:'capture_r'::jsonb->>'vehicle_id');
SELECT pg_temp.record_capture_reading('capture-7','capture-8');
SET ROLE authenticated;
SELECT public.device_create_vehicle_profile(pg_temp.chevrolet_capture_request()) AS r \gset cross_make_
SELECT public.device_create_vehicle_profile(pg_temp.chevrolet_capture_request()) AS r \gset cross_make_replay_
RESET ROLE;
SELECT pg_temp.ok('a repeated classic serial on a different canonical make creates and replays a separate profile',
 :'cross_make_r'::jsonb->>'status'='created'
 AND :'cross_make_r'::jsonb->>'vehicle_id'<>:'capture_r'::jsonb->>'vehicle_id'
 AND :'cross_make_replay_r'::jsonb->>'vehicle_id'=:'cross_make_r'::jsonb->>'vehicle_id'
 AND (SELECT count(*) FROM public.vehicles WHERE vin='CKR187F127263')=2
 AND (SELECT make='Chevrolet' FROM public.vehicles WHERE id=(:'cross_make_r'::jsonb->>'vehicle_id')::uuid));
SELECT pg_temp.ok('all capture filings have audited attribution',
 (SELECT count(*) FROM public.reattribution_audit WHERE new_vehicle_id=(:'capture_r'::jsonb->>'vehicle_id')::uuid)=2);
SET ROLE authenticated;
SELECT public.device_create_vehicle_profile(jsonb_set(pg_temp.capture_request(),'{evidence,interpretation_run_key}',
 to_jsonb(repeat('f',64)))) AS r \gset confirmation_
SELECT public.device_create_vehicle_profile(jsonb_set(pg_temp.capture_request(),'{evidence,interpretation_run_key}',
 to_jsonb(repeat('f',64)))) AS r \gset confirmation_replay_
RESET ROLE;
SELECT pg_temp.ok('new supporting readings confirm prior filing without moving rows or duplicating replay',
 (SELECT count(*) FROM public.reattribution_audit WHERE new_vehicle_id=(:'capture_r'::jsonb->>'vehicle_id')::uuid)=4
 AND (SELECT count(*) FROM public.reattribution_audit WHERE new_vehicle_id=(:'capture_r'::jsonb->>'vehicle_id')::uuid
      AND old_vehicle_id=new_vehicle_id AND reason LIKE 'device capture_session confirms%')=2
 AND (SELECT count(*) FROM public.vehicle_images WHERE vehicle_id=(:'capture_r'::jsonb->>'vehicle_id')::uuid)=2);
SET ROLE authenticated;
SELECT public.device_file_images(jsonb_build_array(jsonb_build_object('image_id',pg_temp.i('capture-3'),
 'vehicle_id',:'capture_r'::jsonb->>'vehicle_id','method','capture_session','confidence',0.9))) AS r \gset bypass_
RESET ROLE;
SELECT pg_temp.ok('a direct filing cannot claim a capture session without profile validation',
 pg_temp.st(:'bypass_r'::jsonb,'capture-3')='insufficient_evidence');
UPDATE public.vehicle_images SET latitude=36 WHERE id=pg_temp.i('capture-3');
SET ROLE authenticated;
SELECT public.device_create_vehicle_profile(jsonb_set(pg_temp.capture_request(),'{image_ids}',
 jsonb_build_array(pg_temp.i('capture-1'),pg_temp.i('capture-3')))) AS r \gset replay_far_
RESET ROLE;
SELECT pg_temp.ok('replay revalidates new capture members instead of trusting a prior mint',
 :'replay_far_r'::jsonb->>'status'='insufficient_evidence'
 AND (SELECT vehicle_id IS NULL FROM public.vehicle_images WHERE id=pg_temp.i('capture-3')));
UPDATE public.vehicle_images SET latitude=35 WHERE id=pg_temp.i('capture-3');
UPDATE public.vehicle_images SET is_superseded=true WHERE id=pg_temp.i('capture-1');
SET ROLE authenticated;
SELECT public.device_create_vehicle_profile(jsonb_set(pg_temp.capture_request(),'{image_ids}',
 jsonb_build_array(pg_temp.i('capture-1'),pg_temp.i('capture-3')))) AS r \gset withdrawn_anchor_
RESET ROLE;
SELECT pg_temp.ok('a withdrawn anchor cannot file new photos on replay',
 :'withdrawn_anchor_r'::jsonb->>'status'='insufficient_evidence'
 AND (SELECT vehicle_id IS NULL FROM public.vehicle_images WHERE id=pg_temp.i('capture-3')));
UPDATE public.vehicle_images SET is_superseded=false WHERE id=pg_temp.i('capture-1');
UPDATE public.vehicle_images SET is_sensitive=false WHERE id=pg_temp.i('capture-3');
UPDATE public.image_observations SET is_active=false WHERE image_id=pg_temp.i('capture-3');
SELECT pg_temp.record_capture_reading('capture-3','capture-4');
SELECT jsonb_set(jsonb_set(jsonb_set(pg_temp.capture_request(),'{image_ids}',
 jsonb_build_array(pg_temp.i('capture-3'),pg_temp.i('capture-4'))),'{evidence,anchor_image_id}',to_jsonb(pg_temp.i('capture-3'))),
 '{evidence,anchor_source_sha256}',to_jsonb(repeat('3',64))) AS request \gset existing_capture_
SET ROLE authenticated;
SELECT public.device_create_vehicle_profile(jsonb_set(:'existing_capture_request'::jsonb,
 '{evidence,identifier_legibility}',to_jsonb('partial'::text))) AS r \gset existing_capture_
RESET ROLE;
SELECT pg_temp.ok('a subsequent capture resolves the existing profile and files through its audited path',
 :'existing_capture_r'::jsonb->>'vehicle_id'=:'capture_r'::jsonb->>'vehicle_id'
 AND (SELECT count(*) FROM public.vehicles WHERE vin='CKR187F127263')=1
 AND (SELECT count(*) FROM public.vehicle_images WHERE id IN(pg_temp.i('capture-3'),pg_temp.i('capture-4'))
      AND vehicle_id=(:'capture_r'::jsonb->>'vehicle_id')::uuid)=2
 AND EXISTS(SELECT 1 FROM public.reattribution_audit WHERE old_observation_id=pg_temp.i('capture-3')
      AND reason LIKE '%capture_session%'));
SELECT jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(
 pg_temp.capture_request()-'serial'-'year'-'make'-'model','{vin}',to_jsonb(pg_temp.vin('1FTRX18L?XKA00377'))),
 '{image_ids}',jsonb_build_array(pg_temp.i('capture-5'),pg_temp.i('capture-6'))),
 '{evidence,anchor_image_id}',to_jsonb(pg_temp.i('capture-5'))),
 '{evidence,anchor_source_sha256}',to_jsonb(repeat('5',64))),
 '{evidence,identifier_read}',to_jsonb(pg_temp.vin('1FTRX18L?XKA00377'))) AS request \gset modern_capture_
-- A separate vehicle and capture context: conflicting VINs in one neighborhood must refuse.
UPDATE public.vehicle_images SET latitude=36 WHERE id IN (pg_temp.i('capture-5'),pg_temp.i('capture-6'));
SELECT pg_temp.record_capture_reading('capture-5','capture-6',pg_temp.vin('1FTRX18L?XKA00377'));
SET ROLE authenticated;
SELECT public.device_create_vehicle_profile(:'modern_capture_request'::jsonb) AS r \gset modern_capture_
RESET ROLE;
SELECT pg_temp.ok('a modern VIN seeds only the evidence supplied without inventing year or make provenance',
 :'modern_capture_r'::jsonb->>'status'='created'
 AND (SELECT year IS NULL AND make IS NULL AND model IS NULL AND year_source IS NULL AND make_source IS NULL
      AND model_source IS NULL FROM public.vehicles WHERE id=(:'modern_capture_r'::jsonb->>'vehicle_id')::uuid));
SELECT pg_temp.ok('writer access remains unchanged',
 NOT has_function_privilege('anon','public.device_create_vehicle_profile(jsonb)','EXECUTE')
 AND has_function_privilege('authenticated','public.device_create_vehicle_profile(jsonb)','EXECUTE')
 AND NOT has_function_privilege('service_role','public.device_file_images_as(uuid,jsonb,boolean)','EXECUTE'));
SELECT 'capture-session profile contract: PASS' AS result;
