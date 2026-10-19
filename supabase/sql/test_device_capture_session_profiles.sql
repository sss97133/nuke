-- Synthetic PG17 contract only; the included fixture refuses non-disposable databases.
\ir test_device_attribution.sql
SET ROLE dm_contract_deployer;
ALTER TABLE public.vehicle_images ADD COLUMN latitude double precision,
  ADD COLUMN longitude double precision, ADD COLUMN device_fingerprint text,
  ADD COLUMN is_sensitive boolean DEFAULT false;
RESET ROLE;
\ir ../migrations/20261019020000_device_capture_session_profiles.sql
\ir ../migrations/20261019020000_device_capture_session_profiles.sql

-- All fixture writes below remain in the disposable dm_refinement_* database.
INSERT INTO public.profiles(id) VALUES (pg_temp.u('capture'));
INSERT INTO public.vehicle_images(id,user_id,image_url,file_hash,taken_at,latitude,longitude,device_fingerprint)
SELECT pg_temp.i('capture-' || n), pg_temp.u('capture'), 'https://fixture.invalid/' || n,
  repeat(n::text,64), '2026-01-01T12:00:00Z'::timestamptz + n * interval '30 seconds',
  35.0, -115.0, 'fixture-device' FROM generate_series(1,6) n;
CREATE FUNCTION pg_temp.capture_request() RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('basis','capture_session','serial','6R07T123456',
   'year',1966,'make','Ford','model','Mustang',
   'image_ids',jsonb_build_array(pg_temp.i('capture-1'),pg_temp.i('capture-2')),
   'evidence',jsonb_build_object('context_method','vin_capture_session_v1',
     'anchor_image_id',pg_temp.i('capture-1'),'anchor_source_sha256',repeat('1',64),
     'identifier_read','6R07T123456','edit_distance','0','identifier_legibility','clear'))
$$;
SELECT set_config('request.jwt.claims',json_build_object('role','authenticated','sub',pg_temp.u('capture'))::text,false);

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
 AND NOT EXISTS(SELECT 1 FROM public.vehicles WHERE vin='6R07T123456'));
SELECT pg_temp.ok('a source-bound anchor is required',
 :'missing_hash_r'::jsonb->>'status'='insufficient_evidence' AND :'wrong_hash_r'::jsonb->>'status'='insufficient_evidence');
UPDATE public.vehicle_images SET device_fingerprint='other-device' WHERE id=pg_temp.i('capture-2');
SET ROLE authenticated;
SELECT public.device_create_vehicle_profile(pg_temp.capture_request()) AS r \gset wrong_device_
RESET ROLE;
SELECT pg_temp.ok('different devices do not inherit the anchor', :'wrong_device_r'::jsonb->>'status'='insufficient_evidence');
UPDATE public.vehicle_images SET device_fingerprint='fixture-device',latitude=36 WHERE id=pg_temp.i('capture-2');
SET ROLE authenticated;
SELECT public.device_create_vehicle_profile(pg_temp.capture_request()) AS r \gset wrong_place_
RESET ROLE;
SELECT pg_temp.ok('distant photos do not inherit the anchor', :'wrong_place_r'::jsonb->>'status'='insufficient_evidence');
UPDATE public.vehicle_images SET latitude=35,taken_at='2026-01-01T13:00:00Z' WHERE id=pg_temp.i('capture-2');
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

SET ROLE authenticated;
SELECT public.device_create_vehicle_profile(pg_temp.capture_request()) AS r \gset capture_
SELECT public.device_create_vehicle_profile(pg_temp.capture_request()) AS r \gset replay_
RESET ROLE;
SELECT pg_temp.ok('a classic VIN and nearby views seed one private profile without an album',
 :'capture_r'::jsonb->>'status'='created'
 AND (SELECT count(*) FROM public.vehicles WHERE vin='6R07T123456')=1
 AND (SELECT count(*) FROM public.vehicle_images WHERE id IN (pg_temp.i('capture-1'),pg_temp.i('capture-2'))
      AND vehicle_id=(:'capture_r'::jsonb->>'vehicle_id')::uuid)=2
 AND (SELECT is_public=false AND owner_id IS NULL AND created_via_role='photographer'
      AND vin_source='device_capture_session' AND vin_source_image_id=pg_temp.i('capture-1')
      AND year_source='device_capture_session' FROM public.vehicles WHERE vin='6R07T123456')
 AND EXISTS(SELECT 1 FROM public.vehicle_contributors WHERE vehicle_id=(:'capture_r'::jsonb->>'vehicle_id')::uuid
      AND user_id=pg_temp.u('capture') AND role='photographer' AND can_sell=false)
 AND :'replay_r'::jsonb->>'vehicle_id'=:'capture_r'::jsonb->>'vehicle_id');
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
SELECT jsonb_set(jsonb_set(jsonb_set(pg_temp.capture_request(),'{image_ids}',
 jsonb_build_array(pg_temp.i('capture-3'),pg_temp.i('capture-4'))),'{evidence,anchor_image_id}',to_jsonb(pg_temp.i('capture-3'))),
 '{evidence,anchor_source_sha256}',to_jsonb(repeat('3',64))) AS request \gset existing_capture_
SET ROLE authenticated;
SELECT public.device_create_vehicle_profile(jsonb_set(:'existing_capture_request'::jsonb,
 '{evidence,identifier_legibility}',to_jsonb('partial'::text))) AS r \gset existing_capture_
RESET ROLE;
SELECT pg_temp.ok('a subsequent capture resolves the existing profile and files through its audited path',
 :'existing_capture_r'::jsonb->>'vehicle_id'=:'capture_r'::jsonb->>'vehicle_id'
 AND (SELECT count(*) FROM public.vehicles WHERE vin='6R07T123456')=1
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
