-- Empty disposable PG17 database only. Synthetic images; no network/model calls.
\set ON_ERROR_STOP on
DO $$ BEGIN
 IF current_database() NOT LIKE 'dm_refinement_%' OR to_regclass('public.vehicles') IS NOT NULL THEN
   RAISE EXCEPTION 'Requires empty disposable dm_refinement_* database';
 END IF;
END $$;



\ir fixtures/reviewed_image_analysis_base.sql

INSERT INTO observation_sources(slug) VALUES('photo_pipeline');
INSERT INTO vehicles VALUES('20000000-0000-4000-8000-000000000001','Fixture','Coupe',NULL);
INSERT INTO vehicle_images(id,vehicle_id,user_id,source,image_url,vision_gate_status,file_size,ai_scan_metadata) VALUES
('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','iphoto','https://example.invalid/old.jpg','approved',4000000,
 '{"classification":{"image_type":"other","confidence":0.3,"description":"Old classifier failure"},"byok_deep_analysis":{"scene_type":"body_exterior","build_phase_guess":"final_assembly","state_observations":{"completeness":"assembled"},"camera_pose":{"framing":"shop yard","azimuth_deg":135,"distance_est":"~4m"},"presence":{"person":false},"confidence":0.88,"agent_model":"older-model","narrative_one_line":"Prior shop image"}}'),
('10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','capture_relay_ios','https://example.invalid/finished.jpg','approved',3500000,
 '{"classification":{"image_type":"vehicle_exterior","confidence":0.95,"description":"Badge on car","vehicle_hints":{},"v2":{"prompt_version":"fixture","vehicle_fields":[{"field_name":"engine_type","value":"badge text must not land","evidence":"badge","confidence":0.95}],"text_lines":[],"angle":{"value":"exterior_three_quarter","confidence":0.95}}},"unrelated_namespace":{"keep":true}}');
SELECT recompute_vehicle_primary_image('20000000-0000-4000-8000-000000000001');
CREATE FUNCTION fixture_review(p_image uuid,p_hash text DEFAULT repeat('a',64),p_azimuth numeric DEFAULT 45,p_scene text DEFAULT 'body_exterior',p_extractor uuid DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE i vehicle_images%ROWTYPE; oid uuid; reviewed timestamptz=now(); v jsonb;
BEGIN
 SELECT * INTO i FROM vehicle_images WHERE id=p_image;
 v=jsonb_build_object('image_id',i.id,'vehicle_id',i.vehicle_id,'analysis_kind','image_deep_byok','is_inferred',true,
 'scene_type',p_scene,'build_phase_guess','final_assembly','intent','unknown','intent_confidence',0,'needs_clarification',true,
 'components_seen','[]'::jsonb,'state_observations',jsonb_build_object('rust_severity','unknown','paint_state','unknown','completeness','assembled'),
 'workshop_signals',jsonb_build_object('tools_visible','[]'::jsonb,'fixturing','unknown','lighting','natural_outdoor'),
 'presence',jsonb_build_object('person',false),'camera_pose',jsonb_build_object('framing','full vehicle','azimuth_deg',p_azimuth,'distance_est','~3m'),
 'narrative_one_line','Whole assembled car with clear surroundings','confidence',0.95);
 INSERT INTO vehicle_observations(vehicle_id,kind,source_id,source_url,source_identifier,observed_at,content_text,confidence_score,agent_model,agent_tier,extraction_method,extractor_id,raw_source_ref,structured_data,extraction_metadata,analysis_deferred)
 VALUES(i.vehicle_id,'condition',(SELECT id FROM observation_sources WHERE slug='photo_pipeline'),i.image_url,
 'reviewed_image_analysis_v1:'||i.id||':'||p_hash,reviewed,v->>'narrative_one_line',0.6,'fixture-model','interactive','reviewed_image_analysis_v1',p_extractor,'vehicle_images:'||i.id,v,
 jsonb_build_object('review_hash',p_hash,'reviewed_image',jsonb_build_object('image_url',i.image_url,'expected_updated_at',i.updated_at,'reviewed_url',i.image_url,'reviewed_sha256',repeat('b',64),'reviewed_at',reviewed),
 'reviewer_provenance',jsonb_build_object('agent_model','fixture-model','agent_tier','interactive','extraction_method','interactive visual review','run_id','fixture')),true)
 RETURNING id INTO oid;
 RETURN oid;
END $$;
-- Reproduce the production failure against the actual UUID column, including
-- the old predicate's implicit cast even when the payload omits extractor_id.
DO $$ BEGIN
 BEGIN
   PERFORM fixture_review('10000000-0000-4000-8000-000000000002');
   RAISE EXCEPTION 'old producer-label contract unexpectedly admitted a review';
 EXCEPTION WHEN invalid_text_representation THEN
   ASSERT SQLERRM LIKE '%photo-pipeline-orchestrator%', SQLERRM;
 END;
 ASSERT NOT EXISTS(SELECT FROM vehicle_observations), 'failed intake must leave no observation';
END $$;
\ir ../migrations/20261110020000_reviewed_extractor_uuid_contract.sql
DO $$ BEGIN
 BEGIN
   PERFORM fixture_review('10000000-0000-4000-8000-000000000002',repeat('a',64),45,'body_exterior','90000000-0000-4000-8000-000000000001');
   RAISE EXCEPTION 'unregistered extractor identity unexpectedly admitted';
 EXCEPTION WHEN check_violation THEN
   ASSERT SQLERRM='invalid_review_observation',SQLERRM;
 END;
 ASSERT NOT EXISTS(SELECT FROM vehicle_observations),'invalid identity must leave no observation';
END $$;
DO $$ DECLARE oid uuid; r jsonb; prior jsonb; count_camera int; BEGIN
 ASSERT EXISTS(SELECT FROM get_image_deep_analysis('10000000-0000-4000-8000-000000000001') WHERE narrative='Prior shop image'),'legacy reader behavior preserved';
 ASSERT has_function_privilege('anon','get_image_deep_analysis(uuid)','EXECUTE')
   AND has_function_privilege('authenticated','get_image_deep_analysis(uuid)','EXECUTE'),'reader grants preserved';
 ASSERT (SELECT primary_image_url='https://example.invalid/old.jpg' FROM vehicles),'baseline prefers old analyzed frame';
 oid=fixture_review('10000000-0000-4000-8000-000000000002');
 ASSERT EXISTS(SELECT FROM observation_witnesses WHERE observation_id=oid AND witness_role='derived'),'atomic source witness';
 r=project_reviewed_image_analysis(oid);
 ASSERT r->>'success'='true' AND r#>>'{cover,chosen_image_id}'='10000000-0000-4000-8000-000000000002',r::text;
 ASSERT (SELECT primary_image_url='https://example.invalid/finished.jpg' FROM vehicles),'original consumer selects newly reviewed frame';
 ASSERT NOT EXISTS(SELECT FROM field_evidence) AND NOT EXISTS(SELECT FROM photo_extracted_fields) AND NOT EXISTS(SELECT FROM fixture_helper_calls),'no old classifier claim replay';
 ASSERT (SELECT count(*)=1 FROM image_camera_position),'camera projected by actual landing trigger';
 ASSERT EXISTS(SELECT FROM image_observations WHERE id=(r->>'image_observation_id')::uuid
   AND image_id='10000000-0000-4000-8000-000000000002' AND vehicle_id='20000000-0000-4000-8000-000000000001'
   AND is_active AND observed_by='caller-byok' AND confidence=0.6 AND NOT is_high_confidence_subject
   AND confidence_basis#>>'{reviewed_image_analysis_v1,observation_id}'=oid::text
   AND confidence_basis#>>'{reviewed_image_analysis_v1,image_url}'='https://example.invalid/finished.jpg'),
   'T2 placement cites this exact guarded observation and source without an identity vote';
 ASSERT NOT EXISTS(SELECT FROM vehicle_image_attribution_queue),'completed review does not enqueue reattribution';
 ASSERT (SELECT ai_scan_metadata#>>'{unrelated_namespace,keep}'='true' AND vehicle_id='20000000-0000-4000-8000-000000000001' AND vision_gate_status='approved' FROM vehicle_images WHERE id='10000000-0000-4000-8000-000000000002'),'source and sibling metadata retained';
 r=project_reviewed_image_analysis(oid); ASSERT r->>'projection_duplicate'='true','same receipt replay';
 ASSERT (SELECT count(*)=1 FROM image_camera_position),'replay adds no camera row';
 ASSERT (SELECT count(*)=1 FROM image_observations),'replay adds no search row';
 SELECT ai_scan_metadata->'byok_deep_analysis' INTO prior FROM vehicle_images WHERE id='10000000-0000-4000-8000-000000000001';
 oid=fixture_review('10000000-0000-4000-8000-000000000001',repeat('c',64));
 ASSERT (SELECT extraction_metadata->'prior_analysis'=prior FROM vehicle_observations WHERE id=oid),'complete legacy before-image retained';
 PERFORM project_reviewed_image_analysis(oid);
 ASSERT NOT EXISTS(SELECT FROM field_evidence),'reviewing old lead also avoids classifier admission';
 RAISE NOTICE 'PASS: immutable full review, witness, preserved prior, actual triggers, scoring/primary and idempotence';
END $$;

-- Ordinary classifier updates retain the existing full landing behavior.
DO $$ DECLARE oid uuid; BEGIN
 oid=fixture_review('10000000-0000-4000-8000-000000000002',repeat('4',64),90);
 PERFORM project_reviewed_image_analysis(oid);
 ASSERT (SELECT count(*)=2 FROM image_camera_position WHERE image_id='10000000-0000-4000-8000-000000000002'),'changed review retains both camera observations';
 ASSERT (SELECT count(*)=1 FROM image_observations WHERE image_id='10000000-0000-4000-8000-000000000002' AND is_active),'one current search revision';
 ASSERT EXISTS(SELECT FROM image_observations old JOIN image_observations current ON old.superseded_by=current.id
   WHERE old.image_id='10000000-0000-4000-8000-000000000002' AND NOT old.is_active AND current.is_active
    AND current.confidence_basis#>>'{reviewed_image_analysis_v1,observation_id}'=oid::text),'prior search testimony preserved through existing owner';
 ASSERT EXISTS(SELECT FROM image_camera_position WHERE source_version='review:'||oid AND azimuth_deg=90 AND evidence->>'observation_id'=oid::text),'new camera testimony points to its immutable review';
 ASSERT EXISTS(SELECT FROM image_camera_position WHERE image_id='10000000-0000-4000-8000-000000000002' AND azimuth_deg=45),'prior camera testimony preserved';
 ASSERT (SELECT ai_scan_metadata#>>'{byok_deep_analysis,observation_id}'=oid::text AND ai_scan_metadata#>>'{byok_deep_analysis,camera_pose,azimuth_deg}'='90' FROM vehicle_images WHERE id='10000000-0000-4000-8000-000000000002'),'current cache selects current review';
 PERFORM project_reviewed_image_analysis(oid);
 ASSERT (SELECT count(*)=2 FROM image_camera_position WHERE image_id='10000000-0000-4000-8000-000000000002'),'changed review replay adds no camera row';
 RAISE NOTICE 'PASS: changed review retains prior camera testimony and points current cache to new review';
END $$;

-- Placement failure must roll back the entire cache/camera/search projection.
CREATE FUNCTION fixture_refuse_search() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
 IF current_setting('fixture.refuse_search',true)='true' THEN RAISE EXCEPTION 'fixture search unavailable'; END IF;
 RETURN NEW; END$$;
CREATE TRIGGER fixture_refuse_search BEFORE INSERT ON image_observations FOR EACH ROW EXECUTE FUNCTION fixture_refuse_search();
DO $$ DECLARE oid uuid; before_meta jsonb; before_camera int; before_search int; BEGIN
 oid=fixture_review('10000000-0000-4000-8000-000000000002',repeat('5',64),120);
 SELECT ai_scan_metadata INTO before_meta FROM vehicle_images WHERE id='10000000-0000-4000-8000-000000000002';
 SELECT count(*) INTO before_camera FROM image_camera_position;
 SELECT count(*) INTO before_search FROM image_observations;
 PERFORM set_config('fixture.refuse_search','true',true);
 BEGIN PERFORM project_reviewed_image_analysis(oid); RAISE EXCEPTION 'expected search failure';
 EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM='fixture search unavailable'; END;
 PERFORM set_config('fixture.refuse_search','false',true);
 ASSERT (SELECT ai_scan_metadata=before_meta FROM vehicle_images WHERE id='10000000-0000-4000-8000-000000000002'),'failed search leaves prior cache';
 ASSERT (SELECT count(*)=before_camera FROM image_camera_position),'failed search rolls back camera';
 ASSERT (SELECT count(*)=before_search FROM image_observations),'failed search adds no revision';
 ASSERT (SELECT count(*)=1 FROM image_observations WHERE image_id='10000000-0000-4000-8000-000000000002' AND is_active),'failed search restores active prior';
 PERFORM project_reviewed_image_analysis(oid);
 ASSERT EXISTS(SELECT FROM image_observations WHERE is_active AND confidence_basis#>>'{reviewed_image_analysis_v1,observation_id}'=oid::text),'same deferred observation can retry successfully';
 RAISE NOTICE 'PASS: actual search failure rolls back projection and preserves retry';
END $$;

INSERT INTO vehicle_images(id,vehicle_id,source,image_url,vision_gate_status) VALUES
('10000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000001','iphoto','https://example.invalid/reference.jpg','approved');
DO $$ DECLARE oid uuid; r jsonb; BEGIN
 oid=fixture_review('10000000-0000-4000-8000-000000000003',repeat('6',64),NULL,'receipt_document');
 r=project_reviewed_image_analysis(oid);
 ASSERT EXISTS(SELECT FROM image_observations WHERE id=(r->>'image_observation_id')::uuid AND is_active
   AND vehicle_id IS NULL AND role='incidental' AND NOT is_high_confidence_subject
   AND confidence_basis#>>'{reviewed_image_analysis_v1,evidence_role}'='reference'),
   'document/reference reading is retained without vehicle identity or physical-part attribution';
 ASSERT r->'search_vehicle_id'='null'::jsonb,'reference does not inflate vehicle placement';
 oid=fixture_review('10000000-0000-4000-8000-000000000003',repeat('7',64),NULL,'data_plate');
 r=project_reviewed_image_analysis(oid);
 ASSERT EXISTS(SELECT FROM image_observations WHERE id=(r->>'image_observation_id')::uuid AND is_active
   AND vehicle_id='20000000-0000-4000-8000-000000000001' AND role='part' AND confidence=0.6),
   'physical detail keeps part role and inferred confidence';
 ASSERT NOT EXISTS(SELECT FROM vehicle_image_attribution_queue),'neither role changes nor revisions enqueue identity changes';
 oid=fixture_review('10000000-0000-4000-8000-000000000003',repeat('8',64));
 UPDATE vehicle_images SET image_url='https://example.invalid/replaced.jpg' WHERE id='10000000-0000-4000-8000-000000000003';
 BEGIN PERFORM project_reviewed_image_analysis(oid); RAISE EXCEPTION 'expected replaced source refusal';
 EXCEPTION WHEN check_violation THEN ASSERT SQLERRM='review_source_changed'; END;
 ASSERT NOT EXISTS(SELECT FROM image_observations WHERE confidence_basis#>>'{reviewed_image_analysis_v1,observation_id}'=oid::text),'replacement admits no search reading';
 RAISE NOTICE 'PASS: reference/part qualification and exact source-URL refusal';
END $$;

UPDATE vehicle_images SET ai_scan_metadata=jsonb_set(ai_scan_metadata,'{classification,description}','"Changed classifier description"') WHERE id='10000000-0000-4000-8000-000000000002';
DO $$ BEGIN ASSERT EXISTS(SELECT FROM field_evidence WHERE proposed_value='badge text must not land'),'full classifier path retained'; END $$;

DO $$ DECLARE oid uuid; old_meta jsonb; BEGIN
 oid=fixture_review('10000000-0000-4000-8000-000000000002',repeat('d',64));
 UPDATE vehicle_images SET is_sensitive=true WHERE id='10000000-0000-4000-8000-000000000002';
 BEGIN PERFORM project_reviewed_image_analysis(oid); RAISE EXCEPTION 'expected withdrawal';
 EXCEPTION WHEN check_violation THEN ASSERT SQLERRM='review_source_withdrawn'; END;
 UPDATE vehicle_images SET is_sensitive=false WHERE id='10000000-0000-4000-8000-000000000002';
 BEGIN PERFORM project_reviewed_image_analysis(oid); RAISE EXCEPTION 'expected stale CAS';
 EXCEPTION WHEN check_violation THEN ASSERT SQLERRM='review_source_changed'; END;
 oid=fixture_review('10000000-0000-4000-8000-000000000002',repeat('e',64));
 UPDATE vehicle_observations SET is_superseded=true WHERE id=oid;
 BEGIN PERFORM project_reviewed_image_analysis(oid); RAISE EXCEPTION 'expected observation withdrawal';
 EXCEPTION WHEN check_violation THEN ASSERT SQLERRM='review_observation_not_eligible'; END;
 RAISE NOTICE 'PASS: withdrawn image/observation and stale source cannot reach projection';
END $$;

-- The real source hint guard is not disabled. If it attempts to unfile, the
-- entire projection (including its mismatch record) rolls back.
UPDATE vehicle_images SET ai_scan_metadata=jsonb_set(ai_scan_metadata,'{classification,vehicle_hints}','{"make":"Other"}'),user_confirmed_vehicle=true WHERE id='10000000-0000-4000-8000-000000000002';
UPDATE vehicle_images SET user_confirmed_vehicle=false WHERE id='10000000-0000-4000-8000-000000000002';
DO $$ DECLARE oid uuid; BEGIN
 oid=fixture_review('10000000-0000-4000-8000-000000000002',repeat('f',64));
 BEGIN PERFORM project_reviewed_image_analysis(oid); RAISE EXCEPTION 'expected filing guard';
 EXCEPTION WHEN check_violation THEN ASSERT SQLERRM='review_source_changed_during_projection'; END;
 ASSERT (SELECT vehicle_id IS NOT NULL FROM vehicle_images WHERE id='10000000-0000-4000-8000-000000000002');
 ASSERT NOT EXISTS(SELECT FROM image_vehicle_mismatches),'hint-guard writes rolled back';
 ASSERT NOT has_function_privilege('anon','project_reviewed_image_analysis(uuid)','EXECUTE');
 ASSERT NOT has_function_privilege('authenticated','project_reviewed_image_analysis(uuid)','EXECUTE');
 RAISE NOTICE 'PASS: no filing side effect and no public/user projection access';
END $$;

-- Concurrent sessions must reread the committed source after waiting on its
-- row lock. Exercise both admission and the later cache projection boundary.
CREATE EXTENSION dblink;
CREATE FUNCTION fixture_try_project(oid uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
 PERFORM set_config('request.jwt.claim.role','service_role',true);
 RETURN project_reviewed_image_analysis(oid);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('error',SQLERRM); END $$;
CREATE FUNCTION fixture_try_review(iid uuid,h text) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
 PERFORM set_config('request.jwt.claim.role','service_role',true);
 RETURN jsonb_build_object('observation_id',fixture_review(iid,h));
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('error',SQLERRM); END $$;
DO $$ DECLARE conn text; oid uuid; r jsonb; waiting boolean; n_before integer; BEGIN
 conn=format('dbname=%L host=%L port=%L user=%L',current_database(),split_part(current_setting('unix_socket_directories'),',',1),current_setting('port'),current_user);
 PERFORM dblink_connect('review_withdraw',conn);
 PERFORM dblink_connect('review_apply',conn||' application_name=reviewed_image_race');
 SELECT count(*) INTO n_before FROM vehicle_observations;
 PERFORM dblink_exec('review_withdraw','BEGIN');
 PERFORM dblink_exec('review_withdraw',$q$UPDATE vehicle_images SET vehicle_id=NULL WHERE id='10000000-0000-4000-8000-000000000001'$q$);
 PERFORM dblink_send_query('review_apply',$q$SELECT fixture_try_review('10000000-0000-4000-8000-000000000001',repeat('2',64))$q$);
 waiting=false;
 FOR j IN 1..100 LOOP
   SELECT EXISTS(SELECT FROM pg_stat_activity WHERE application_name='reviewed_image_race' AND wait_event_type='Lock') INTO waiting;
   EXIT WHEN waiting; PERFORM pg_sleep(0.01);
 END LOOP;
 ASSERT waiting,'admission waits for actual image row lock';
 PERFORM dblink_exec('review_withdraw','COMMIT');
 SELECT value INTO r FROM dblink_get_result('review_apply') AS t(value jsonb);
 ASSERT r->>'error'='review_source_changed',r::text;
 ASSERT (SELECT count(*) FROM vehicle_observations)=n_before,'concurrent withdrawal admits no review';
 PERFORM dblink_disconnect('review_apply'); PERFORM dblink_disconnect('review_withdraw');
 RAISE NOTICE 'PASS: real concurrent source withdrawal refuses admission';
END $$;
-- Separate committed setup is necessary so both remote sessions see the review.
UPDATE vehicle_images SET vehicle_id='20000000-0000-4000-8000-000000000001' WHERE id='10000000-0000-4000-8000-000000000001';
SELECT fixture_review('10000000-0000-4000-8000-000000000001',repeat('3',64));
DO $$ DECLARE conn text; oid uuid; r jsonb; waiting boolean; BEGIN
 SELECT id INTO oid FROM vehicle_observations WHERE source_identifier LIKE '%:'||repeat('3',64);
 conn=format('dbname=%L host=%L port=%L user=%L',current_database(),split_part(current_setting('unix_socket_directories'),',',1),current_setting('port'),current_user);
 PERFORM dblink_connect('review_withdraw',conn);
 PERFORM dblink_connect('review_apply',conn||' application_name=reviewed_image_race');
 PERFORM dblink_exec('review_withdraw','BEGIN');
 PERFORM dblink_exec('review_withdraw',$q$UPDATE vehicle_images SET is_sensitive=true WHERE id='10000000-0000-4000-8000-000000000001'$q$);
 PERFORM dblink_send_query('review_apply',format('SELECT fixture_try_project(%L)',oid));
 waiting=false;
 FOR j IN 1..100 LOOP
   SELECT EXISTS(SELECT FROM pg_stat_activity WHERE application_name='reviewed_image_race' AND wait_event_type='Lock') INTO waiting;
   EXIT WHEN waiting; PERFORM pg_sleep(0.01);
 END LOOP;
 ASSERT waiting,'projection waits for actual image row lock';
 PERFORM dblink_exec('review_withdraw','COMMIT');
 SELECT value INTO r FROM dblink_get_result('review_apply') AS t(value jsonb);
 ASSERT r->>'error'='review_source_withdrawn',r::text;
 PERFORM dblink_disconnect('review_apply'); PERFORM dblink_disconnect('review_withdraw');
 RAISE NOTICE 'PASS: real concurrent source withdrawal refuses projection';
END $$;

-- Retained T2 authority follows its exact source; withdrawal preserves history
-- and independent producers. Restoring a source never resurrects an old review.
INSERT INTO vehicle_images(id,vehicle_id,source,image_url,vision_gate_status) VALUES
('10000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000001','iphoto','https://example.invalid/current.jpg','approved');
DO $$ DECLARE oid uuid; r jsonb; placed uuid; independent uuid; flag text; k int=20; BEGIN
 oid=fixture_review('10000000-0000-4000-8000-000000000004',md5('current')||md5('current'));
 r=project_reviewed_image_analysis(oid); placed=(r->>'image_observation_id')::uuid;
 ASSERT (project_reviewed_image_analysis(oid)->>'image_observation_id')::uuid=placed,'replay returns exact stable search ID';
 ASSERT EXISTS(SELECT FROM get_image_deep_analysis('10000000-0000-4000-8000-000000000004') WHERE narrative='Whole assembled car with clear surroundings'),'actual deep reader sees current review';
 independent=ingest_image_observation('10000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000001','part',0.5,'independent-producer','v1','{}');
 UPDATE vehicle_images SET is_primary=is_primary WHERE id='10000000-0000-4000-8000-000000000004';
 ASSERT (SELECT is_active FROM image_observations WHERE id=placed),'benign primary update keeps placement';
 UPDATE vehicle_images SET image_url='https://example.invalid/replacement.jpg' WHERE id='10000000-0000-4000-8000-000000000004';
 ASSERT EXISTS(SELECT FROM image_observations old JOIN image_observations withdrawn ON old.superseded_by=withdrawn.id
   WHERE old.id=placed AND NOT old.is_active AND NOT withdrawn.is_active
    AND withdrawn.confidence_basis#>>'{reviewed_image_analysis_v1,state}'='withdrawn'
    AND withdrawn.confidence_basis#>>'{reviewed_image_analysis_v1,withdrawal_reason}'='source_changed'),
   'replacement appends explicit withdrawal preserving prior review';
 ASSERT (SELECT is_active FROM image_observations WHERE id=independent),'independent producer untouched';
 ASSERT (SELECT NOT ai_scan_metadata ? 'byok_deep_analysis' FROM vehicle_images WHERE id='10000000-0000-4000-8000-000000000004'),'direct cache consumers cannot read withdrawn review';
 ASSERT EXISTS(SELECT FROM vehicle_observations WHERE id=oid AND structured_data->>'narrative_one_line'='Whole assembled car with clear surroundings'),'complete review testimony retained after cache withdrawal';
 ASSERT NOT EXISTS(SELECT FROM get_image_deep_analysis('10000000-0000-4000-8000-000000000004')),'deep reader withholds cache after replacement';
 UPDATE vehicle_images SET image_url='https://example.invalid/current.jpg' WHERE id='10000000-0000-4000-8000-000000000004';
 BEGIN PERFORM project_reviewed_image_analysis(oid); RAISE EXCEPTION 'expected old review refusal';
 EXCEPTION WHEN check_violation THEN ASSERT SQLERRM='review_source_previously_withdrawn'; END;
 ASSERT NOT EXISTS(SELECT FROM get_image_deep_analysis('10000000-0000-4000-8000-000000000004')),'restoring URL does not resurrect old reading';
 FOREACH flag IN ARRAY ARRAY['is_sensitive','is_duplicate','is_superseded','is_document','doc_flag'] LOOP
   oid=fixture_review('10000000-0000-4000-8000-000000000004',md5(k::text)||md5(k::text)); k=k+1;
   r=project_reviewed_image_analysis(oid); placed=(r->>'image_observation_id')::uuid;
   EXECUTE format('UPDATE vehicle_images SET %I=true WHERE id=%L',flag,'10000000-0000-4000-8000-000000000004');
   ASSERT NOT (SELECT is_active FROM image_observations WHERE id=placed),flag||' withdraws search authority';
   ASSERT (SELECT NOT ai_scan_metadata ? 'byok_deep_analysis' FROM vehicle_images WHERE id='10000000-0000-4000-8000-000000000004'),flag||' removes only current review cache';
   ASSERT NOT EXISTS(SELECT FROM get_image_deep_analysis('10000000-0000-4000-8000-000000000004')),flag||' withholds reader';
   EXECUTE format('UPDATE vehicle_images SET %I=false WHERE id=%L',flag,'10000000-0000-4000-8000-000000000004');
 END LOOP;
 FOREACH flag IN ARRAY ARRAY['vision_gate_status','image_vehicle_match_status','vehicle_id'] LOOP
   oid=fixture_review('10000000-0000-4000-8000-000000000004',md5(k::text)||md5(k::text)); k=k+1;
   r=project_reviewed_image_analysis(oid); placed=(r->>'image_observation_id')::uuid;
   IF flag='vision_gate_status' THEN UPDATE vehicle_images SET vision_gate_status='pending' WHERE id='10000000-0000-4000-8000-000000000004';
   ELSIF flag='image_vehicle_match_status' THEN UPDATE vehicle_images SET image_vehicle_match_status='mismatch' WHERE id='10000000-0000-4000-8000-000000000004';
   ELSE UPDATE vehicle_images SET vehicle_id=NULL WHERE id='10000000-0000-4000-8000-000000000004'; END IF;
   ASSERT NOT (SELECT is_active FROM image_observations WHERE id=placed),flag||' withdraws search authority';
   ASSERT NOT EXISTS(SELECT FROM get_image_deep_analysis('10000000-0000-4000-8000-000000000004')),flag||' withholds reader';
   UPDATE vehicle_images SET vision_gate_status='approved',image_vehicle_match_status=NULL,vehicle_id='20000000-0000-4000-8000-000000000001' WHERE id='10000000-0000-4000-8000-000000000004';
 END LOOP;
 oid=fixture_review('10000000-0000-4000-8000-000000000004',md5('fresh')||md5('fresh'),NULL,'receipt_document');
 r=project_reviewed_image_analysis(oid);
 ASSERT EXISTS(SELECT FROM get_image_deep_analysis('10000000-0000-4000-8000-000000000004')),'fresh reference review is readable without claiming vehicle identity';
 ASSERT r->'search_vehicle_id'='null'::jsonb,'reference remains unplaced against vehicle';
 ASSERT (SELECT is_active FROM image_observations WHERE id=independent),'all withdrawals preserve independent source';
 ASSERT NOT EXISTS(SELECT FROM vehicle_image_attribution_queue),'withdrawal/review never promotes identity';
 RAISE NOTICE 'PASS: retained-source withdrawal, historical revision, reader refusal and fresh-review recovery';
END $$;

-- UPDATE OF observes SET targets, not earlier BEFORE-trigger assignments.
-- A later metadata-only classifier update can unfile this image.
INSERT INTO vehicle_images(id,vehicle_id,source,image_url,vision_gate_status,ai_scan_metadata) VALUES
('10000000-0000-4000-8000-000000000005','20000000-0000-4000-8000-000000000001','capture_relay_ios','https://example.invalid/hint-guard.jpg','approved',
 '{"classification":{"image_type":"vehicle_exterior","vehicle_hints":{},"description":"Fixture body"}}');
DO $$ DECLARE oid uuid; placed uuid; BEGIN
 oid=fixture_review('10000000-0000-4000-8000-000000000005',md5('hint')||md5('hint'));
 placed=(project_reviewed_image_analysis(oid)->>'image_observation_id')::uuid;
 ASSERT (SELECT vehicle_id IS NOT NULL AND ai_scan_metadata ? 'byok_deep_analysis' FROM vehicle_images WHERE id='10000000-0000-4000-8000-000000000005'),'review initially current';
 UPDATE vehicle_images SET ai_scan_metadata=jsonb_set(ai_scan_metadata,'{classification,vehicle_hints}','{"make":"Other"}') WHERE id='10000000-0000-4000-8000-000000000005';
 ASSERT (SELECT vehicle_id IS NULL AND NOT ai_scan_metadata ? 'byok_deep_analysis' FROM vehicle_images WHERE id='10000000-0000-4000-8000-000000000005'),'existing metadata hint guard unfiles and atomically withdraws cache';
 ASSERT NOT (SELECT is_active FROM image_observations WHERE id=placed),'metadata-only unfile withdraws current search';
 ASSERT NOT EXISTS(SELECT FROM get_image_deep_analysis('10000000-0000-4000-8000-000000000005')),'reader also withholds unfiled review';
 RAISE NOTICE 'PASS: actual hint-guard metadata-only unfile withdraws current review';
END $$;

-- The current contract carries inferred pose, not a measurement receipt. Do not
-- make guessing exact-looking numbers improve a cover; preserve the observations.
\ir ../migrations/20261109220000_cover_score_observed_framing.sql
DO $$ DECLARE unknown_pose jsonb; guessed_pose jsonb; claimed_measured jsonb; r jsonb; BEGIN
 unknown_pose='{"byok_deep_analysis":{"scene_type":"body_exterior","build_phase_guess":"final_assembly","state_observations":{"completeness":"assembled"},"presence":{"person":false},"confidence":0.9,"camera_pose":{"framing":"full vehicle","azimuth_deg":null,"distance_est":null}}}';
 guessed_pose=jsonb_set(unknown_pose,'{byok_deep_analysis,camera_pose}', '{"framing":"full vehicle","method":"agent_visual_estimate","azimuth_deg":45,"distance_est":"~3m","exif_present":true}');
 claimed_measured=jsonb_set(guessed_pose,'{byok_deep_analysis,camera_pose,method}','"calibrated measurement"');
 ASSERT image_hero_score(guessed_pose,3500000)>image_hero_score(unknown_pose,3500000),'shared duplicate score owner remains unchanged';
 INSERT INTO vehicles(id,make,model) VALUES('20000000-0000-4000-8000-000000000002','Fixture','Pose');
 INSERT INTO vehicle_images(id,vehicle_id,image_url,source,vision_gate_status,file_size,created_at,ai_scan_metadata) VALUES
 ('10000000-0000-4000-8000-000000000031','20000000-0000-4000-8000-000000000002','https://example.invalid/unknown.jpg','iphoto','approved',3500000,'2023-01-01',unknown_pose),
 ('10000000-0000-4000-8000-000000000032','20000000-0000-4000-8000-000000000002','https://example.invalid/guessed.jpg','iphoto','approved',3500000,'2021-01-01',guessed_pose),
 ('10000000-0000-4000-8000-000000000033','20000000-0000-4000-8000-000000000002','https://example.invalid/claimed-measured.jpg','iphoto','approved',3500000,'2022-01-01',claimed_measured);
 r=recompute_vehicle_primary_image('20000000-0000-4000-8000-000000000002');
 ASSERT r->>'chosen_image_id'='10000000-0000-4000-8000-000000000031','unknown pose is not penalized against guessed/measured-label poses';
 ASSERT (SELECT ai_scan_metadata=guessed_pose AND is_duplicate=false FROM vehicle_images WHERE id='10000000-0000-4000-8000-000000000032'),'stored inferred pose and duplicate flag preserved';
 UPDATE vehicle_images SET ai_scan_metadata=jsonb_set(unknown_pose,'{byok_deep_analysis,camera_pose,framing}','"close macro crop with clutter"') WHERE id='10000000-0000-4000-8000-000000000031';
 r=recompute_vehicle_primary_image('20000000-0000-4000-8000-000000000002');
 ASSERT r->>'chosen_image_id'='10000000-0000-4000-8000-000000000033','visible composition change replaces cover using existing clock tie-break';
 RAISE NOTICE 'PASS: cover ignores uncited pose, retains visible framing and leaves duplicate score/testimony unchanged';
END $$;
