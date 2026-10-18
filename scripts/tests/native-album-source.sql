-- Synthetic isolated PostgreSQL only. The harness never connects to production.
\set ON_ERROR_STOP on
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT nullif(current_setting('fixture.user_id',true),'')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
 SELECT current_setting('fixture.role',true) $$;
CREATE TABLE profiles(id uuid PRIMARY KEY);
CREATE TABLE vehicles(id uuid PRIMARY KEY);
CREATE TABLE vehicle_images(id uuid PRIMARY KEY,vehicle_id uuid REFERENCES vehicles,user_id uuid REFERENCES profiles,
 image_url text,file_hash text,exif_data jsonb,is_document boolean,is_duplicate boolean,is_superseded boolean,vision_gate_status text);
CREATE TABLE image_sets(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid REFERENCES profiles,
 created_by uuid REFERENCES profiles,vehicle_id uuid REFERENCES vehicles,is_personal boolean DEFAULT false,
 name text NOT NULL,metadata jsonb DEFAULT '{}',created_at timestamptz DEFAULT now());
CREATE TABLE image_set_members(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),image_set_id uuid REFERENCES image_sets,
 image_id uuid REFERENCES vehicle_images,added_by uuid REFERENCES profiles,display_order integer,notes text,role text,
 UNIQUE(image_set_id,image_id));
CREATE TABLE album_sync_map(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid REFERENCES profiles,
 apple_album_id text,apple_album_name text,image_set_id uuid REFERENCES image_sets,vehicle_id uuid,
 photo_count_apple integer,photo_count_nuke integer,sync_direction text,last_synced_at timestamptz,
 UNIQUE(user_id,apple_album_id));
ALTER TABLE image_sets ENABLE ROW LEVEL SECURITY;
CREATE POLICY existing_source_read ON image_sets FOR SELECT TO authenticated,anon USING (true);
CREATE POLICY existing_source_insert ON image_sets FOR INSERT TO authenticated WITH CHECK (user_id=auth.uid());
ALTER TABLE image_set_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY existing_member_read ON image_set_members FOR SELECT TO authenticated,anon
 USING (image_set_id IN (SELECT id FROM image_sets));
GRANT USAGE ON SCHEMA public,auth TO authenticated,anon,service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated,anon,service_role;
GRANT INSERT ON image_sets TO authenticated;
\ir ../../supabase/migrations/20261008070000_native_album_source_capture.sql
CREATE FUNCTION fixture_assert(ok boolean,message text) RETURNS void LANGUAGE plpgsql AS $$
 BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',message; END IF; END $$;
CREATE FUNCTION fixture_fails(statement text,expected_state text) RETURNS void LANGUAGE plpgsql AS $$
 BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
   IF SQLSTATE=expected_state THEN RETURN; END IF;
   RAISE EXCEPTION 'unexpected SQLSTATE %: %',SQLSTATE,SQLERRM;
  END;
  RAISE EXCEPTION 'expected failure did not occur: %',statement;
 END $$;
INSERT INTO profiles VALUES ('00000000-0000-4000-8000-000000000001'),('00000000-0000-4000-8000-000000000002');
INSERT INTO vehicles VALUES ('00000000-0000-4000-8000-000000000010');
INSERT INTO vehicle_images VALUES
 ('00000000-0000-4000-8000-000000000030','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000001','fixture-original',repeat('a',64),'{"uuid":"photo-a"}',false,false,false,'approved'),
 ('00000000-0000-4000-8000-000000000031',NULL,'00000000-0000-4000-8000-000000000002','other-account-original',repeat('b',64),'{"uuid":"photo-b"}',false,false,false,'approved'),
 ('00000000-0000-4000-8000-000000000032',NULL,'00000000-0000-4000-8000-000000000001','',NULL,'{"uuid":"photo-c"}',false,false,false,'skipped'),
 ('00000000-0000-4000-8000-000000000033',NULL,'00000000-0000-4000-8000-000000000001','document',repeat('d',64),'{"uuid":"photo-d"}',true,false,false,'approved');
CREATE FUNCTION fixture_capture(request integer,previous integer DEFAULT NULL,album_name text DEFAULT 'Human album') RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('contract','photokit_album_v1','request_id','00000000-0000-4000-8000-'||lpad(request::text,12,'0'),
 'previous_capture_id',CASE WHEN previous IS NULL THEN NULL ELSE '00000000-0000-4000-8000-'||lpad(previous::text,12,'0') END,
 'installation_id','00000000-0000-4000-8000-000000000050','observed_at','2026-10-08T06:00:00Z','access_scope','full',
 'album',jsonb_build_object('local_id','album-source-a','name',album_name,'folder_path',jsonb_build_array('Projects'),
 'source_kind','user','present',true,'photos',jsonb_build_array(
 jsonb_build_object('local_id','photo-a','source_version','version-a'),
 jsonb_build_object('local_id','photo-b','source_version','version-b'),
 jsonb_build_object('local_id','photo-c','source_version',null),
 jsonb_build_object('local_id','photo-d','source_version','version-d')))) $$;
CREATE FUNCTION fixture_read(local_id text,version text,hash text) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_array(jsonb_build_object('local_id',local_id,'source_version',version,'input_sha256',hash,
 'method_version','fixture-independent-read-v1','read_id','fixture-read-'||local_id)) $$;
SELECT set_config('fixture.user_id','00000000-0000-4000-8000-000000000001',false);
SELECT set_config('fixture.role','authenticated',false);
CREATE TEMP TABLE fixture_result(payload jsonb);
INSERT INTO fixture_result SELECT bulk_add_to_image_set(fixture_capture(100));
SELECT fixture_assert((SELECT payload->>'source_count' FROM fixture_result)='4','unuploaded source memberships retained');
SELECT fixture_assert((SELECT payload->>'unlinked_count' FROM fixture_result)='4','unread membership is not zero coverage');
SELECT fixture_assert((SELECT count(*) FROM image_sets WHERE vehicle_id IS NOT NULL)=0,'album title/assigned image does not bind a vehicle');
SELECT fixture_assert((SELECT metadata->>'album_author' FROM image_sets)='unknown','account observing does not imply author');
SELECT bulk_add_to_image_set(fixture_capture(100),fixture_read('photo-a','version-a',repeat('a',64)));
SELECT fixture_assert((SELECT count(*) FROM image_set_members)=1,'same account original bytes qualify context link');
SELECT fixture_assert((SELECT count(*) FROM image_sets)=1,'replay appends no duplicate source capture');
SELECT fixture_assert(bulk_add_to_image_set(fixture_capture(100),fixture_read('photo-b','version-b',repeat('b',64)))->'readings'->0->>'status'='original_not_uploaded','other account cannot qualify');
SELECT fixture_assert(bulk_add_to_image_set(fixture_capture(100),fixture_read('photo-c',NULL,repeat('c',64)))->'readings'->0->>'status'='source_reference_unqualified','unknown version is unresolved');
SELECT fixture_assert(bulk_add_to_image_set(fixture_capture(100),fixture_read('photo-d','version-d',repeat('d',64)))->'readings'->0->>'status'='original_not_uploaded','document cannot qualify');
SELECT fixture_assert(bulk_add_to_image_set(fixture_capture(100),fixture_read('photo-a','version-a',repeat('b',64)))->'readings'->0->>'status'='original_not_uploaded','hash mismatch cannot qualify');
SELECT fixture_fails($q$SELECT bulk_add_to_image_set(fixture_capture(100,NULL,'Different title'))$q$,'23514');
SELECT fixture_assert(bulk_add_to_image_set(fixture_capture(101,NULL,'Changed title'))->>'status'='predecessor_conflict','new state requires acknowledged predecessor');
SELECT bulk_add_to_image_set(fixture_capture(101,100,'Changed title'));
SELECT bulk_add_to_image_set(fixture_capture(100));
SELECT fixture_assert((SELECT s.source_capture_id FROM album_sync_map m JOIN image_sets s ON s.id=m.image_set_id)='00000000-0000-4000-8000-000000000101','historical replay does not roll pointer backward');
SELECT bulk_add_to_image_set(fixture_capture(102,101));
SELECT fixture_assert((SELECT count(*) FROM image_sets)=3,'A to B to A retains three source events');
SELECT fixture_assert((SELECT count(*) FROM image_sets WHERE source_predecessor_id IS NOT NULL)=2,'source history has typed lineage');
SELECT fixture_fails($q$UPDATE image_sets SET name='Overwrite source'$q$,'23514');
SELECT fixture_fails($q$UPDATE image_sets SET vehicle_id='00000000-0000-4000-8000-000000000010'$q$,'23514');
SELECT fixture_fails($q$INSERT INTO image_set_members(image_set_id,image_id,added_by)
 SELECT image_set_id,'00000000-0000-4000-8000-000000000031','00000000-0000-4000-8000-000000000001' FROM album_sync_map$q$,'23514');
SELECT fixture_fails($q$UPDATE image_set_members SET image_id='00000000-0000-4000-8000-000000000031'$q$,'23514');
-- Ambiguous duplicates remain unlinked, rather than choosing newest assignment.
INSERT INTO vehicle_images SELECT '00000000-0000-4000-8000-000000000034',vehicle_id,user_id,image_url,file_hash,exif_data,is_document,is_duplicate,is_superseded,vision_gate_status FROM vehicle_images WHERE id='00000000-0000-4000-8000-000000000030';
SELECT fixture_assert(bulk_add_to_image_set(fixture_capture(102,101),fixture_read('photo-a','version-a',repeat('a',64)))->'readings'->0->>'status'='ambiguous_cloud_original','duplicate source leaf is unresolved');
SET ROLE authenticated;
SELECT fixture_assert((SELECT count(*) FROM image_sets)=3,'own account can read retained source history');
SELECT fixture_fails($q$INSERT INTO image_sets(user_id,created_by,name,is_personal,source_contract,source_capture_id,source_observed_at,metadata)
 SELECT user_id,created_by,name,is_personal,source_contract,gen_random_uuid(),source_observed_at,metadata FROM image_sets LIMIT 1$q$,'42501');
SELECT fixture_assert(bulk_add_to_image_set(fixture_capture(103,102,'Actual authenticated caller'))->>'status'='retained','authenticated caller reaches guarded definer writer');
SELECT set_config('fixture.user_id','00000000-0000-4000-8000-000000000002',false);
SELECT fixture_assert((SELECT count(*) FROM image_sets)=0,'other account cannot read native groups');
SELECT fixture_assert((SELECT count(*) FROM image_set_members)=0,'other account cannot read native byte links');
RESET ROLE;
SELECT set_config('fixture.user_id','',false);
SELECT set_config('fixture.role','service_role',false);
SELECT fixture_fails($q$SELECT bulk_add_to_image_set(fixture_capture(200))$q$,'42501');
SET ROLE anon;
SELECT fixture_assert((SELECT count(*) FROM image_sets)=0,'anonymous cannot read native groups');
SELECT fixture_fails($q$SELECT bulk_add_to_image_set(fixture_capture(200))$q$,'42501');
RESET ROLE;
SELECT 'PASS: native source retention, byte qualification, history, replay, privacy and immutable membership';
