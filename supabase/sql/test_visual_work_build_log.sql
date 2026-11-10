-- Empty local fixture only. Actual atomic image-witness projection, actual new
-- build-log reader and source withdrawal. Unrelated reported-listing matcher is
-- a false control; its existing contract is unchanged by this migration.
\set ON_ERROR_STOP on
DO $$ BEGIN IF current_database() NOT LIKE 'dm_refinement_%' OR to_regclass('public.vehicles') IS NOT NULL
 THEN RAISE EXCEPTION 'Requires an empty disposable dm_refinement_ database'; END IF; END $$;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('test.role',true) $$;
CREATE TABLE vehicles(id uuid PRIMARY KEY,user_id uuid,owner_id uuid,uploaded_by uuid,is_public boolean,deleted_at timestamptz);
CREATE FUNCTION vehicle_user_has_access(uuid,uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE TABLE observation_sources(id uuid PRIMARY KEY,slug text);
CREATE TABLE vehicle_images(id uuid PRIMARY KEY,vehicle_id uuid,image_url text,taken_at timestamptz,vision_gate_status text,
 is_sensitive boolean,is_duplicate boolean,is_superseded boolean,is_document boolean,redaction_level text,ai_scan_metadata jsonb,image_vehicle_match_status text,exif_data jsonb);
CREATE TABLE vehicle_observations(id uuid PRIMARY KEY,vehicle_id uuid,source_id uuid,source_url text,kind text,structured_data jsonb,
 confidence_score numeric,extraction_method text,is_superseded boolean DEFAULT false,observed_at timestamptz DEFAULT now(),
 submitted_by_user_id uuid,source_observation_id uuid,ingested_at timestamptz DEFAULT now());
CREATE TABLE observation_witnesses(id uuid DEFAULT gen_random_uuid(),observation_id uuid REFERENCES vehicle_observations(id),
 image_id uuid REFERENCES vehicle_images(id),witness_role text,capture_method text,image_timestamp timestamptz,
 attestation_notes text,added_by_user_id uuid,added_by_agent_key text,UNIQUE(observation_id,image_id,witness_role));
CREATE TABLE vehicle_documents(id uuid PRIMARY KEY,vehicle_id uuid,file_url text);
CREATE TABLE receipts(id uuid PRIMARY KEY,source_document_table text,source_document_id uuid,vendor_name text,currency text,is_superseded boolean,duplicate_of uuid);
CREATE TABLE receipt_items(id uuid PRIMARY KEY,receipt_id uuid,line_number int,description text,part_number text,quantity numeric,hours numeric,total_price numeric);
CREATE TABLE receipt_vehicle_links(id uuid PRIMARY KEY,receipt_id uuid,vehicle_id uuid,status text,retired_at timestamptz,page_date date);
CREATE TABLE stage_transition_labor_map(id uuid PRIMARY KEY,from_stage text,to_stage text,zone_pattern text,description text,
 estimated_hours_min real,estimated_hours_max real,estimated_hours_typical real);
CREATE FUNCTION retained_reported_work_matches(vehicle_observations,vehicle_observations) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
\ir fixtures/visual_work_owners_20261109.sql
\ir ../migrations/20261109235000_visual_work_build_log_reader.sql
GRANT EXECUTE ON FUNCTION vehicle_build_log_public(uuid,boolean) TO anon,authenticated,service_role;

INSERT INTO vehicles VALUES('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',NULL,NULL,true,NULL);
INSERT INTO observation_sources VALUES('30000000-0000-0000-0000-000000000001','internal-inference');
INSERT INTO vehicle_images(id,vehicle_id,image_url,taken_at,vision_gate_status) VALUES
 ('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','https://images.example/before.jpg','2026-04-27 17:00Z','approved'),
 ('4abcdef1-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','https://images.example/after.jpg','2026-05-05 21:00Z','approved');
INSERT INTO vehicle_documents VALUES('50000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','https://private.example/original.pdf');
UPDATE vehicle_images SET exif_data='{"capture_time_zone":"America/Los_Angeles","capture_time_basis":"Original EXIF local time retained in the Photos library"}';
INSERT INTO receipts VALUES('60000000-0000-0000-0000-000000000001','vehicle_documents','50000000-0000-0000-0000-000000000001','Example upholstery','USD',false,NULL);
INSERT INTO receipt_items VALUES
 ('70000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001',1,'Black upholstery','SYNTHETIC-1',1,999,420),
 ('70000000-0000-0000-0000-000000000002','60000000-0000-0000-0000-000000000001',2,'Recover seat',NULL,1,3.5,210);
INSERT INTO receipt_vehicle_links VALUES('80000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','linked',NULL,'2025-09-08');
INSERT INTO stage_transition_labor_map VALUES('90000000-0000-0000-0000-000000000001','needs_work','recovered','*','Synthetic upholstery scope',16,40,24);
INSERT INTO vehicle_observations(id,vehicle_id,source_id,source_url,kind,confidence_score,extraction_method,structured_data)
VALUES('a0000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',
 'https://images.example/after.jpg','work_record',.6,'visual_work_v1',
 '{"contract":"visual_work_v1","title":"Cabin upholstery","summary":"The earlier cabin has torn upholstery; the later frame shows black seat covers.",
 "image_id":"4abcdef1-0000-0000-0000-000000000002","visual_sources":[
 {"image_id":"40000000-0000-0000-0000-000000000001","source_url":"https://images.example/before.jpg","role":"before","caption":"Torn seating"},
 {"image_id":"4abcdef1-0000-0000-0000-000000000002","source_url":"https://images.example/after.jpg","role":"after","caption":"Black covered seating"}],
 "receipt_links":[
 {"receipt_id":"60000000-0000-0000-0000-000000000001","item_id":"70000000-0000-0000-0000-000000000001","link_id":"80000000-0000-0000-0000-000000000001","source_table":"vehicle_documents","source_id":"50000000-0000-0000-0000-000000000001","source_url":"https://private.example/original.pdf","relation":"candidate_material","description":"Black upholstery","part_number":"SYNTHETIC-1"},
 {"receipt_id":"60000000-0000-0000-0000-000000000001","item_id":"70000000-0000-0000-0000-000000000002","link_id":"80000000-0000-0000-0000-000000000001","source_table":"vehicle_documents","source_id":"50000000-0000-0000-0000-000000000001","source_url":"https://private.example/original.pdf","relation":"documented_operation","description":"Recover seat","part_number":null}],
 "effort_reference":{"reference_id":"90000000-0000-0000-0000-000000000001","from_stage":"needs_work","to_stage":"recovered","zone_pattern":"*"},"gaps":["Hidden cushion foam is not established by the finished appearance."]}');
-- One legacy control remains exactly once; typed visual work is not repeated there.
INSERT INTO vehicle_observations(id,vehicle_id,kind,structured_data) VALUES('a0000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','work_record','{"title":"Legacy control"}');
DO $$ DECLARE v uuid:='10000000-0000-0000-0000-000000000001'; j jsonb; saved jsonb;
BEGIN
 PERFORM set_config('test.role','anon',false); PERFORM set_config('test.uid','',false);
 ASSERT NOT has_function_privilege('anon','visual_work_build_log(uuid)','EXECUTE');
 j:=vehicle_build_log_public(v,false);
 ASSERT jsonb_array_length(j->'work_records')=1 AND j#>>'{work_records,0,item}'='Legacy control';
 ASSERT jsonb_array_length(j->'visual_work')=1 AND jsonb_array_length(j#>'{visual_work,0,images}')=2,j::text;
 ASSERT j#>>'{visual_work,0,images,0,taken_at}' LIKE '2026-04-27%',j::text;
 ASSERT j#>>'{visual_work,0,images,0,capture_time_zone}'='America/Los_Angeles',j::text;
 ASSERT j#>'{visual_work,0,receipts,0,amount}'='null' AND j#>'{visual_work,0,receipts,0,hours}'='null',j::text;
 ASSERT j#>>'{visual_work,0,receipts,1,hours}'='3.5',j::text;
 ASSERT j#>>'{visual_work,0,effort_reference,basis}'='seed_uncalibrated',j::text;
 ASSERT j::text NOT LIKE '%private.example%' AND j::text NOT LIKE '%420%' AND j::text NOT LIKE '%999%',j::text;
 ASSERT (SELECT count(*) FROM observation_witnesses)=1,'Actual atomic witness not projected';
 PERFORM set_config('test.role','authenticated',false); PERFORM set_config('test.uid','20000000-0000-0000-0000-000000000001',false);
 ASSERT vehicle_build_log_public(v,false)#>>'{visual_work,0,receipts,0,amount}'='420';
 -- Receipt withdrawal retains the visual operation but not money, hours or a stale citation.
 UPDATE receipt_vehicle_links SET retired_at=now();
 j:=vehicle_build_log_public(v,false);
 ASSERT j#>'{visual_work,0,receipts}'='[]' AND j#>>'{visual_work,0,receipt_links_unavailable}'='2',j::text;
 UPDATE receipt_vehicle_links SET retired_at=NULL;
 UPDATE receipt_items SET part_number='REPLACEMENT' WHERE line_number=1;
 ASSERT jsonb_array_length(vehicle_build_log_public(v,false)#>'{visual_work,0,receipts}')=1;
 UPDATE receipt_items SET part_number='SYNTHETIC-1' WHERE line_number=1;
 UPDATE vehicle_documents SET file_url='https://private.example/replacement.pdf';
 ASSERT vehicle_build_log_public(v,false)#>'{visual_work,0,receipts}'='[]';
 UPDATE vehicle_documents SET file_url='https://private.example/original.pdf';
 -- A required before source cannot be silently dropped while retaining the conclusion.
 UPDATE vehicle_images SET image_url='https://images.example/replaced.jpg' WHERE image_url LIKE '%before.jpg';
 ASSERT NOT (vehicle_build_log_public(v,false)?'visual_work');
 UPDATE vehicle_images SET image_url='https://images.example/before.jpg' WHERE image_url LIKE '%replaced.jpg';
 UPDATE vehicle_images SET is_sensitive=true WHERE image_url LIKE '%before.jpg';
 ASSERT NOT (vehicle_build_log_public(v,false)?'visual_work');
 UPDATE vehicle_images SET is_sensitive=false;
 UPDATE vehicle_images SET taken_at='2027-01-01' WHERE image_url LIKE '%before.jpg';
 ASSERT NOT (vehicle_build_log_public(v,false)?'visual_work');
 UPDATE vehicle_images SET taken_at='2026-04-27 17:00Z' WHERE image_url LIKE '%before.jpg';
 UPDATE vehicle_images SET vehicle_id=NULL WHERE image_url LIKE '%after.jpg';
 ASSERT NOT (vehicle_build_log_public(v,false)?'visual_work');
 UPDATE vehicle_images SET vehicle_id=v;
 SELECT structured_data INTO saved FROM vehicle_observations WHERE extraction_method='visual_work_v1';
 UPDATE vehicle_observations SET structured_data=jsonb_set(saved,'{image_id}','"4ABCDEF1-0000-0000-0000-000000000002"') WHERE extraction_method='visual_work_v1';
 ASSERT jsonb_array_length(vehicle_build_log_public(v,false)->'visual_work')=1,'Uppercase main source matches the derived witness';
 -- A repeated physical frame cannot supply both sides of a change, regardless of UUID casing.
 UPDATE vehicle_images SET id='4abcdef0-0000-0000-0000-000000000001' WHERE image_url LIKE '%before.jpg';
 UPDATE vehicle_observations SET structured_data=jsonb_set(saved,'{visual_sources,0,image_id}','"4ABCDEF0-0000-0000-0000-000000000001"') WHERE extraction_method='visual_work_v1';
 ASSERT jsonb_array_length(vehicle_build_log_public(v,false)->'visual_work')=1,'Uppercase reference should resolve';
 UPDATE vehicle_observations SET structured_data=jsonb_set(structured_data,'{visual_sources}',(structured_data->'visual_sources')||
  jsonb_build_array(jsonb_build_object('image_id','4abcdef0-0000-0000-0000-000000000001','source_url','https://images.example/before.jpg','role','after','caption','Same physical frame'))) WHERE extraction_method='visual_work_v1';
 ASSERT NOT (vehicle_build_log_public(v,false)?'visual_work'),'Same frame repeated in mixed case';
 UPDATE vehicle_images SET id='40000000-0000-0000-0000-000000000001' WHERE image_url LIKE '%before.jpg';
 UPDATE vehicle_observations SET structured_data=jsonb_set(saved,'{visual_sources,0,image_id}','"not-a-uuid"') WHERE extraction_method='visual_work_v1';
 ASSERT NOT (vehicle_build_log_public(v,false)?'visual_work');
 UPDATE vehicle_observations SET structured_data=saved WHERE extraction_method='visual_work_v1';
 UPDATE vehicle_observations SET source_url='https://images.example/wrong.jpg' WHERE extraction_method='visual_work_v1';
 ASSERT NOT (vehicle_build_log_public(v,false)?'visual_work');
 UPDATE vehicle_observations SET source_url='https://images.example/after.jpg' WHERE extraction_method='visual_work_v1';
 UPDATE vehicles SET is_public=false;
 PERFORM set_config('test.uid','',false); PERFORM set_config('test.role','anon',false);
 ASSERT NOT (vehicle_build_log_public(v,false)?'visual_work');
 PERFORM set_config('test.uid','20000000-0000-0000-0000-000000000001',false); PERFORM set_config('test.role','authenticated',false);
 ASSERT jsonb_array_length(vehicle_build_log_public(v,false)->'visual_work')=1;
 UPDATE vehicles SET deleted_at=now();
 ASSERT NOT (vehicle_build_log_public(v,false)?'visual_work');
 RAISE NOTICE 'visual work: actual witness, exact source links, receipt withdrawal, masks, partial semantics and legacy control pass';
END $$;
