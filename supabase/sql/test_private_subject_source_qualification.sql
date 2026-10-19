-- Synthetic disposable-only dependent policy contract; no production data.
\ir test_visual_subject_observations.sql
ALTER TABLE vehicle_images ADD COLUMN source text, ADD COLUMN ai_processing_status text DEFAULT 'pending';
ALTER TABLE vehicle_images ADD COLUMN exif_data jsonb, ADD COLUMN duplicate_of uuid,
 ADD COLUMN superseded_by uuid, ADD COLUMN superseded_at timestamptz;
CREATE TABLE reattribution_audit(id uuid PRIMARY KEY,observation_type text,old_observation_id uuid,new_observation_id uuid,
 old_vehicle_id uuid,new_vehicle_id uuid,created_at timestamptz);
ALTER TABLE reattribution_audit OWNER TO dm_contract_deployer;
CREATE TEMP TABLE private_policy_acl AS SELECT proacl,proowner FROM pg_proc
 WHERE oid='public.ingest_image_observation(uuid,uuid,text,numeric,text,text,jsonb,boolean,jsonb)'::regprocedure;
CREATE TEMP TABLE private_policy_functions AS SELECT oid FROM pg_proc WHERE pronamespace='public'::regnamespace;
\ir ../migrations/20261018203000_private_subject_source_qualification.sql
SELECT pg_temp.ok('private policy changes existing writer only; no grants/owner or functions added',
 (SELECT p.proacl IS NOT DISTINCT FROM a.proacl AND p.proowner=a.proowner FROM pg_proc p CROSS JOIN private_policy_acl a
  WHERE p.oid='public.ingest_image_observation(uuid,uuid,text,numeric,text,text,jsonb,boolean,jsonb)'::regprocedure)
 AND NOT EXISTS(SELECT oid FROM pg_proc WHERE pronamespace='public'::regnamespace EXCEPT SELECT oid FROM private_policy_functions));

INSERT INTO vehicle_images(id,user_id,image_url,file_hash,storage_path,source,vision_gate_status,taken_at,created_at)
SELECT pg_temp.u(k),pg_temp.u('photographer'),
 'https://qkgaybvrernstplzjaam.supabase.co/storage/v1/object/public/vehicle-photos/users/'||pg_temp.u('photographer')||'/capture-relay/'||md5(k)||md5(k)||'/fixture.JPG',
 md5(k)||md5(k),'users/'||pg_temp.u('photographer')||'/capture-relay/'||md5(k)||md5(k)||'/fixture.JPG',
 'capture_relay_ios','pending','2026-10-17T00:00:00.000001Z','2026-10-17T00:00:01.000001Z'
FROM unnest(ARRAY['native a','native b']) k;
CREATE TEMP TABLE private_source_before AS SELECT * FROM vehicle_images WHERE id IN(pg_temp.u('native a'),pg_temp.u('native b'));
CREATE TEMP TABLE private_cluster_before AS SELECT count(*) AS n FROM emergent_vehicle_clusters;
CREATE FUNCTION pg_temp.private_envelope(k text) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('method','device_privacy_v1','purpose','own_private_visual_subjects','user_id',user_id,
  'read_at','2026-10-18T00:00:00Z','subjects','[]'::jsonb,
  'inputs',jsonb_build_array(jsonb_build_object('image_id',id,'source_url',image_url,'input_url',image_url,
    'storage_path',storage_path,'source_sha256',file_hash,'input_sha256',file_hash,'source_qualified',true,
    'source_bytes_qualified',true,'representation','source','mime_type','image/jpeg','byte_length',4,
    'captured_at','2026-10-18T00:00:00Z','created_at',created_at,'taken_at',taken_at)),
  'native',jsonb_build_object('method','device_privacy_v1','purpose','own_private_visual_subjects','policy_version',1,
    'owner_user_id',user_id,'source_sha256',file_hash,'source_byte_length',4,'observed_at','2026-10-17T00:00:00Z',
    'classifier_revision',2,'face_revision',3,'os_major',26,'classifier_completed',true,'face_completed',true,
    'pixels_eligible',true,'clutter',false,'personal',false,'prominent_face',false,'is_vehicle',true,
    'max_core_confidence',0.8,'total_vehicle_confidence',0.8,'face_threshold',0.045,
    'labels',jsonb_build_array(jsonb_build_object('identifier','car','confidence',0.8)),
    'decode',jsonb_build_object('contract','imageio_thumbnail_512_v1','max_pixel',512,'orientation_applied',true,
      'input_sha256',repeat('b',64),'width',1,'height',1,'byte_length',4)))
 FROM vehicle_images WHERE id=pg_temp.u(k)
$$;
CREATE FUNCTION pg_temp.private_admit(e jsonb, state text DEFAULT 'active') RETURNS uuid LANGUAGE sql AS $$
 SELECT ingest_image_observation((e #>> '{inputs,0,image_id}')::uuid,NULL,'part',0,'device_privacy_v1','device_privacy_v1',
   jsonb_build_object('device_privacy_v1',jsonb_build_object('state',state,'withdrawal_reason','synthetic privacy correction','envelope',e)),false,'{}')
$$;
CREATE FUNCTION pg_temp.private_refused(e jsonb,label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE refused boolean:=false; BEGIN
 BEGIN PERFORM pg_temp.private_admit(e); EXCEPTION WHEN OTHERS THEN refused:=true; END;
 PERFORM pg_temp.ok(label,refused);
END $$;
SELECT pg_temp.private_admit(pg_temp.private_envelope('native a'));
SELECT pg_temp.private_admit(pg_temp.private_envelope('native b'));
SELECT pg_temp.ok('private source receipts do not mint subjects or change any global source field',
 (SELECT count(*) FROM emergent_vehicle_clusters)=(SELECT n FROM private_cluster_before)
 AND NOT EXISTS(SELECT 1 FROM private_source_before b JOIN vehicle_images v USING(id) WHERE to_jsonb(b) IS DISTINCT FROM to_jsonb(v)));
DO $$ DECLARE item jsonb; e jsonb:=pg_temp.private_envelope('native a'); BEGIN
 FOR item IN SELECT value FROM jsonb_array_elements('[
  {"path":["native","classifier_revision"],"value":99},
  {"path":["native","face_revision"],"value":99},
  {"path":["native","policy_version"],"value":2},
  {"path":["native","os_major"],"value":27},
  {"path":["native","face_completed"],"value":false},
  {"path":["native","classifier_completed"],"value":false},
  {"path":["native","source_byte_length"],"value":5},
  {"path":["native","source_sha256"],"value":"bad"},
  {"path":["native","owner_user_id"],"value":"00000000-0000-4000-8000-000000009999"},
  {"path":["native","observed_at"],"value":"2026-10-18T00:06:00Z"},
  {"path":["native","observed_at"],"value":"infinity"},
  {"path":["native","decode","input_sha256"],"value":"bad"},
  {"path":["native","decode","width"],"value":0},
  {"path":["native","decode","width"],"value":1.5},
  {"path":["native","decode","height"],"value":1.5},
  {"path":["native","decode","byte_length"],"value":4.5},
  {"path":["native","labels"],"value":[{"identifier":"document","confidence":0.8}]},
  {"path":["native","labels"],"value":[{}]},
  {"path":["inputs","0","created_at"],"value":"2026-10-17T00:00:01.000002Z"},
  {"path":["inputs","0","taken_at"],"value":"2026-10-17T00:00:00.000002Z"},
  {"path":["inputs","0","source_url"],"value":"https://private.invalid/other.jpg"},
  {"path":["inputs","0","storage_path"],"value":"other"},
  {"path":["inputs","0","input_sha256"],"value":"bad"},
  {"path":["inputs","0","source_bytes_qualified"],"value":false},
  {"path":["inputs","0","captured_at"],"value":"infinity"}
 ]'::jsonb) LOOP
   PERFORM pg_temp.private_refused(jsonb_set(e,ARRAY(SELECT jsonb_array_elements_text(item->'path')),item->'value'),
     'reject altered native/captured evidence '||(item->'path')::text);
 END LOOP;
END $$;
SELECT pg_temp.private_refused(jsonb_set(jsonb_set(pg_temp.private_envelope('native a'),
 '{native,source_byte_length}','4.5'::jsonb),'{inputs,0,byte_length}','4.5'::jsonb),
 'fractional original length remains invalid even when native and captured counts agree');
DO $$ DECLARE field text; before jsonb; BEGIN
 FOR field IN SELECT unnest(ARRAY['is_sensitive','is_document','is_duplicate','is_superseded']) LOOP
   EXECUTE format('UPDATE vehicle_images SET %I=true WHERE id=$1',field) USING pg_temp.u('native a');
   PERFORM pg_temp.private_refused(pg_temp.private_envelope('native a'),'explicit '||field||' wins over native receipt');
   EXECUTE format('UPDATE vehicle_images SET %I=false WHERE id=$1',field) USING pg_temp.u('native a');
 END LOOP;
 UPDATE vehicle_images SET vision_gate_status='rejected_personal' WHERE id=pg_temp.u('native a');
 PERFORM pg_temp.private_refused(pg_temp.private_envelope('native a'),'rejected gate wins');
 UPDATE vehicle_images SET vision_gate_status=NULL WHERE id=pg_temp.u('native a');
 PERFORM pg_temp.private_refused(pg_temp.private_envelope('native a'),'legacy NULL is not pending purpose eligibility');
 UPDATE vehicle_images SET vision_gate_status='pending' WHERE id=pg_temp.u('native a');
END $$;

CREATE FUNCTION pg_temp.private_reading() RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('method','visual_subjects_v1','user_id',pg_temp.u('photographer'),'provider','synthetic','model','synthetic',
  'run_key','private-subject-reading','read_at','2026-10-18T00:00:00Z',
  'inputs',jsonb_build_array(pg_temp.private_envelope('native a')#>'{inputs,0}',pg_temp.private_envelope('native b')#>'{inputs,0}'),
  'subjects','[]'::jsonb,'frames',jsonb_build_array(
    jsonb_build_object('image_id',pg_temp.u('native a'),'medium','photograph','primary_subject','vehicle','view','exterior','bbox','[0,0,1,1]'::jsonb),
    jsonb_build_object('image_id',pg_temp.u('native b'),'medium','photograph','primary_subject','vehicle','view','exterior','bbox','[0,0,1,1]'::jsonb)),
  'unresolved',jsonb_build_array(jsonb_build_object('image_id',pg_temp.u('native a'),'reason','needs_corresponding_view'),
    jsonb_build_object('image_id',pg_temp.u('native b'),'reason','needs_corresponding_view')))
$$;
SELECT ingest_image_observation(pg_temp.u('native a'),NULL,'part',0,'visual_subject_reading_v1','visual_subject_reading_v1',
 jsonb_build_object('visual_subject_reading_v1',jsonb_build_object('envelope',pg_temp.private_reading())),false,'{}');
SELECT pg_temp.ok('pending exact native sources reach protected reading without global approval',
 EXISTS(SELECT 1 FROM image_observations WHERE image_id=pg_temp.u('native a') AND observed_by='visual_subject_reading_v1' AND is_active)
 AND (SELECT vision_gate_status='pending' AND ai_processing_status='pending' FROM vehicle_images WHERE id=pg_temp.u('native a')));

-- A sanctioned copy changes attribution rows, never the underlying photograph.
UPDATE vehicle_images SET exif_data='{"uuid":"synthetic-native-a","camera_make":"Apple","camera_model":"synthetic"}',
 vehicle_id=pg_temp.u('contaminated prior attachment') WHERE id=pg_temp.u('native a');
INSERT INTO vehicle_images SELECT (jsonb_populate_record(NULL::vehicle_images,to_jsonb(v)||jsonb_build_object(
 'id',pg_temp.u('native a leaf'),'vehicle_id',NULL,'is_duplicate',true,'duplicate_of',v.id))).*
 FROM vehicle_images v WHERE id=pg_temp.u('native a');
UPDATE vehicle_images SET is_superseded=true,superseded_by=pg_temp.u('native a leaf'),superseded_at='2026-10-18T00:00:01Z'
 WHERE id=pg_temp.u('native a');
INSERT INTO reattribution_audit VALUES(pg_temp.u('native attribution audit'),'image',pg_temp.u('native a'),pg_temp.u('native a leaf'),
 pg_temp.u('contaminated prior attachment'),NULL,'2026-10-18T00:00:01Z');
CREATE TEMP TABLE private_leaf_before AS SELECT * FROM vehicle_images WHERE id=pg_temp.u('native a leaf');
CREATE FUNCTION pg_temp.try_private_reading() RETURNS boolean LANGUAGE plpgsql AS $$ BEGIN
 PERFORM ingest_image_observation(pg_temp.u('native a'),NULL,'part',0,'visual_subject_reading_v1','visual_subject_reading_v1',
   jsonb_build_object('visual_subject_reading_v1',jsonb_build_object('envelope',pg_temp.private_reading())),false,'{}');
 RETURN true;
 EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'reading held: %',SQLERRM; RETURN false;
END $$;
SELECT pg_temp.ok('pending clone cannot inherit ancestor purpose approval or paid reading as permission',NOT pg_temp.try_private_reading());
UPDATE vehicle_images SET vision_gate_status='approved' WHERE id=pg_temp.u('native a leaf');
SELECT pg_temp.ok('current leaf own global approval permits original reading replay',pg_temp.try_private_reading());
SELECT pg_temp.ok('current source family preserves immutable original model receipt as one photo',
 EXISTS(SELECT 1 FROM image_observations WHERE image_id=pg_temp.u('native a') AND observed_by='visual_subject_reading_v1' AND is_active
  AND confidence_basis#>'{visual_subject_reading_v1,envelope}'=pg_temp.private_reading()
  AND confidence_basis#>>ARRAY['visual_subject_reading_v1','source_families',pg_temp.u('native a')::text,'root_image_id']=pg_temp.u('native a')::text
  AND confidence_basis#>>ARRAY['visual_subject_reading_v1','source_families',pg_temp.u('native a')::text,'current_image_id']=pg_temp.u('native a leaf')::text));
UPDATE vehicle_images SET vision_gate_status='pending' WHERE id=pg_temp.u('native a leaf');
SELECT pg_temp.ok('removing current leaf permission holds again despite an already retained source reading',NOT pg_temp.try_private_reading());
CREATE FUNCTION pg_temp.leaf_privacy() RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_set(jsonb_set(pg_temp.private_envelope('native a leaf'),'{read_at}','"2026-10-18T00:00:02Z"'),
  '{inputs,0,captured_at}','"2026-10-18T00:00:02Z"')||jsonb_build_object('source_family',jsonb_build_object(
   'root_image_id',pg_temp.u('native a'),'current_image_id',pg_temp.u('native a leaf'),
   'alias_image_ids',jsonb_build_array(pg_temp.u('native a'),pg_temp.u('native a leaf')),
   'audit_ids',jsonb_build_array(pg_temp.u('native attribution audit')),
   'source_sha256',(SELECT file_hash FROM vehicle_images WHERE id=pg_temp.u('native a leaf'))))
$$;
SELECT pg_temp.private_refused(pg_temp.private_envelope('native a leaf'),'leaf proof must independently name its complete audited family');
SELECT pg_temp.private_refused(jsonb_set(pg_temp.leaf_privacy(),'{source_family,audit_ids}','[]'),'caller cannot omit an attribution audit');
SELECT pg_temp.private_refused(jsonb_set(pg_temp.leaf_privacy(),'{inputs,0,captured_at}','"2026-10-18T00:00:00Z"'),
 'old byte capture cannot be retagged as current leaf privacy permission');
SELECT pg_temp.private_admit(pg_temp.leaf_privacy());
SELECT pg_temp.ok('new exact-leaf family proof permits old model reuse without a new model clock',pg_temp.try_private_reading());
SELECT pg_temp.ok('leaf duplicate flag/global pending processing remain unchanged and no new subject is minted by source reuse',
 (SELECT to_jsonb(v)=to_jsonb(b) FROM vehicle_images v CROSS JOIN private_leaf_before b WHERE v.id=b.id)
 AND (SELECT count(*) FROM emergent_vehicle_clusters)=(SELECT n FROM private_cluster_before));

SELECT pg_temp.private_admit(pg_temp.private_envelope('native a'),'withdrawn');
SELECT pg_temp.private_refused(pg_temp.private_envelope('native a'),'same device receipt cannot undo privacy withdrawal');
UPDATE vehicle_images SET vision_gate_status='approved' WHERE id=pg_temp.u('native a');
-- Simulate a later administrative head replacement: withdrawal history still wins.
UPDATE image_observations SET superseded_by=(SELECT id FROM image_observations WHERE image_id=pg_temp.u('native b') AND observed_by='device_privacy_v1' AND is_active LIMIT 1)
 WHERE image_id=pg_temp.u('native a') AND observed_by='device_privacy_v1' AND confidence_basis#>>'{device_privacy_v1,state}'='withdrawn';
DO $$ DECLARE refused boolean:=false; BEGIN
 BEGIN
  PERFORM ingest_image_observation(pg_temp.u('native a'),NULL,'part',0,'visual_subject_reading_v1','visual_subject_reading_v1',
    jsonb_build_object('visual_subject_reading_v1',jsonb_build_object('envelope',pg_temp.private_reading())),false,'{}');
 EXCEPTION WHEN OTHERS THEN refused:=true; END;
 PERFORM pg_temp.ok('withdrawal history blocks cached/new reading even after supersession and global approval',refused);
END $$;
SELECT pg_temp.ok('private policy adds no public row policies',
 NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename IN('image_observations','emergent_vehicle_clusters')));
