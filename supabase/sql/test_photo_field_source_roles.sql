-- Real photo writer -> existing acceptor, synthetic rows on EMPTY local PG17 only.
\set ON_ERROR_STOP on
DO $$ BEGIN
 IF current_database() NOT LIKE 'dm_refinement_%' OR to_regclass('public.vehicles') IS NOT NULL
 THEN RAISE EXCEPTION 'Requires empty disposable dm_refinement_* database'; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE TABLE vehicles(id uuid PRIMARY KEY,color text,interior_color text,displacement text,license_plate text,engine_type text,transmission text,body_style text,trim text,drivetrain text,fuel_type text);
CREATE TABLE vehicle_images(id uuid PRIMARY KEY,vehicle_id uuid,user_id uuid,vision_gate_status text,ai_scan_metadata jsonb,ai_processing_status text,is_superseded boolean DEFAULT false);
CREATE TABLE image_descriptions(image_id uuid,vehicle_id uuid,description text,description_type text,source text,source_version text,confidence numeric,evidence jsonb);
CREATE TABLE photo_extracted_fields(image_id uuid,user_id uuid,vehicle_id uuid,field_name text,value text,quote text,confidence numeric,source text,prompt_version text,meta jsonb,UNIQUE(image_id,field_name,source,prompt_version));
CREATE TABLE photo_text_lines(image_id uuid,user_id uuid,vehicle_id uuid,line_idx int,text text,region jsonb,confidence numeric,source text,prompt_version text,UNIQUE(image_id,line_idx,source,prompt_version));
CREATE TABLE field_evidence(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),vehicle_id uuid,field_name text,proposed_value text,source_type text,source_confidence numeric,extraction_context text,raw_extraction_data jsonb,status text DEFAULT 'pending',created_at timestamptz DEFAULT now(),assigned_at timestamptz,assigned_by text,supporting_signals jsonb,contradicting_signals jsonb,UNIQUE(vehicle_id,field_name,source_type,proposed_value));
CREATE TABLE vehicle_identifiers(vehicle_id uuid,source_image_id uuid,kind text,value text,evidence_class text);
CREATE TABLE angle_taxonomy(angle_id uuid,canonical_key text,deprecated_at timestamptz);
CREATE TABLE image_angle_observations(image_id uuid,vehicle_id uuid,angle_id uuid,confidence numeric,source text,source_version text,evidence jsonb);
CREATE TABLE image_camera_position(image_id uuid,vehicle_id uuid,subject_key text,azimuth_deg numeric,elevation_deg numeric,distance_mm numeric,confidence numeric,source text,source_version text,evidence jsonb,UNIQUE(image_id,subject_key,source,source_version));
CREATE TABLE photo_land_progress(image_id uuid PRIMARY KEY,result jsonb,landed_at timestamptz DEFAULT now());
CREATE TABLE vehicle_field_provenance(vehicle_id uuid,field_name text,current_value text,total_confidence numeric,confidence_factors jsonb,primary_source text,supporting_sources text[],conflicting_sources jsonb,last_verified_at timestamptz,last_verified_by text,updated_at timestamptz,PRIMARY KEY(vehicle_id,field_name));
CREATE TABLE cited_evidence_accept_log(run_id uuid,evidence_id uuid,vehicle_id uuid,field_name text,column_name text,action text,proposed_value text,prev_column_value text,prev_evidence_status text,prev_raw_extraction_data jsonb,prev_provenance jsonb);
-- Identifier format/ownership is tested by its own contract. This spy records
-- the original photo writer's typed plate-code handoff unchanged.
CREATE FUNCTION land_identifier_claims(uuid,jsonb,text,text,text,uuid,uuid) RETURNS void LANGUAGE sql AS $$
 INSERT INTO vehicle_identifiers(vehicle_id,source_image_id,kind,value)
 SELECT $1,$6,e->>'kind',e->>'value' FROM jsonb_array_elements($2->'identifiers') e
$$;
\ir fixtures/photo_field_source_role_owners.sql
\ir fixtures/cited_evidence_source_role_consumers.sql
\ir ../migrations/20261109223000_photo_field_source_roles.sql
CREATE TABLE fixture_cases(n int PRIMARY KEY,field text,value text,quote text,description text,reason text);
INSERT INTO fixture_cases VALUES
 (1,'engine_type','V8-400','text on hood scoop V8-400','Exterior view','appearance_text_not_vehicle_specification'),
 (2,'engine_type','999','Stamped text 999 on the body tag','Body tag','body_tag_code_requires_decode'),
 (3,'trim','A11','Stamped text A11 on the body tag','Body tag','body_tag_code_requires_decode'),
 (4,'body_style','ZX12 N','Stamped text ZX12 N on the body tag','Body tag','body_tag_code_requires_decode'),
 (5,'engine_type','V8 400','visible text V8 400 on the air cleaner cover','Engine bay','appearance_text_not_vehicle_specification'),
 (6,'model','Sport','visible SPORT decal on fender','Exterior view','appearance_text_not_vehicle_specification'),
 (7,'model','Sport','text on the side of the car above the front wheel','Exterior view','appearance_text_not_vehicle_specification'),
 (8,'model','Coupe','visible coupe emblem on the dashboard','Interior view','appearance_text_not_vehicle_specification'),
 (9,'series','Sport','visible gold lettering on front fender reading SPORT','Exterior view','appearance_text_not_vehicle_specification'),
 (10,'trim','Sport','text on the fender','Exterior view','appearance_text_not_vehicle_specification'),
 (11,'trim','V8-400','text on the hood scoop','Exterior view','appearance_text_not_vehicle_specification'),
 (12,'body_style','manual transmission interior','visible manual gear shift with 4-speed pattern','Interior view','cabin_detail_not_body_style'),
 (13,'color','red with orange and yellow pinstripes','visible painted surface with red base and orange/yellow stripes','Hood graphic close-up','graphic_not_body_paint'),
 (14,'color','red with orange and yellow pinstripe','visible painted surface with red base and orange/yellow stripes','Hood graphic close-up','graphic_not_body_paint'),
 (15,'engine_type','1234567','casting number 1234567 on the engine block','Engine block','component_identifier_requires_decode'),
 (16,'make','Brand','visible Brand emblem on steering wheel','Interior view','appearance_text_not_vehicle_specification'),
 (17,'color','Blue','blue engine block','Engine bay','not_body_paint'),
 (18,'make','OtherBrand','OtherBrand vehicle','Another OtherBrand car in the background.','other_vehicle_in_frame'),
 (19,'vin','UNVALIDATED','Vehicle text read','Vehicle plate','dedicated_identifier_admission_required'),
 (20,'color','Red','visible red base body paint with yellow stripes','Exterior view',null),
 (21,'transmission','manual','visible manual shift lever and clutch pedal','Interior view',null),
 (22,'mileage','42.6','odometer reads 00042 and separately colored tenths wheel 6','Instrument cluster',null),
 (23,'engine_type','455 V8','Work order vehicle header Engine:455 V8','Photograph of an engine work order',null),
 (24,'body_style','Coupe','Visible two-door coupe body shape','Exterior side profile',null),
 (25,'engine_casting_number','1234567','Casting number 1234567 on the block','Engine block',null),
 (26,'interior_color','Black','Visible black seat upholstery and door panels','Interior',null),
 (27,'drivetrain','RWD','Rear driveshaft connects gearbox to rear differential','Undercarriage',null),
 (28,'engine_code','YH','Stamped engine code YH on block pad','Engine stamp',null),
 (29,'displacement','400','text on hood scoop 400','Exterior view','appearance_text_not_vehicle_specification'),
 (30,'displacement','1234567','casting number 1234567 on engine block','Engine block','component_identifier_requires_decode'),
 (31,'displacement','999','Stamped text 999 on the body tag','Body tag','body_tag_code_requires_decode'),
 (32,'displacement','455ci','Work order engine displacement:455ci','Photograph of engine work order',null),
 (33,'engine_type','400 V8','400 printed on hood scoop','Exterior view','appearance_text_not_vehicle_specification'),
 (34,'engine_type','400 V8','400 embossed on shaker','Exterior view','appearance_text_not_vehicle_specification'),
 (35,'engine_type','999','Stamped 999','A close-up of the body tag','body_tag_code_requires_decode'),
 (36,'displacement','1234567','cast-in number1234567 on engine block','Engine block','component_identifier_requires_decode');
DO $$ DECLARE c record; d jsonb; BEGIN
 FOR c IN SELECT * FROM fixture_cases LOOP
  ASSERT public.photo_field_not_about_vehicle(c.field,c.value,c.quote,c.description) IS NOT DISTINCT FROM c.reason,c.n::text;
  d:=public.photo_field_not_about_vehicle(jsonb_build_array(jsonb_build_object('field_name',c.field,'value',c.value,'evidence',c.quote)),c.description);
  ASSERT d->>'status'='ok' AND d#>>'{decisions,0,reason}' IS NOT DISTINCT FROM c.reason,d::text;
 END LOOP;
 ASSERT public.photo_field_not_about_vehicle('{}'::jsonb,'')->>'status'='invalid_field_collection';
 ASSERT public.photo_field_not_about_vehicle('engine_type','V8','visible V8 beneath open hood','Engine bay') IS NULL,'Physical engine observation is not scoop lettering';
END $$;
INSERT INTO vehicles(id) VALUES('20000000-0000-4000-8000-000000000001');
INSERT INTO vehicle_images(id,vehicle_id,vision_gate_status,ai_processing_status,ai_scan_metadata)
SELECT ('10000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'20000000-0000-4000-8000-000000000001','approved','completed',
 jsonb_build_object('classification',jsonb_build_object('image_type','detail_closeup','confidence',.95,'description',description,
 'v2',jsonb_build_object('prompt_version','fixture','vehicle_fields',jsonb_build_array(jsonb_build_object('field_name',field,'value',value,'evidence',quote,'confidence',.95)),
 'text_lines',jsonb_build_array(jsonb_build_object('text',value,'confidence',.95)),
 'vin',CASE WHEN n=19 THEN jsonb_build_object('value','UNVALIDATED','evidence','Retained literal only','confidence',.95) ELSE NULL END)))
FROM fixture_cases;
SELECT public.photo_land_classification(id) FROM vehicle_images ORDER BY id;
DO $$ BEGIN
 ASSERT (SELECT count(*) FROM field_evidence)=10,'Only valid source-role fields land';
 ASSERT (SELECT count(*) FROM photo_text_lines)=36,'All literal text stays retained';
 ASSERT (SELECT count(*) FROM photo_extracted_fields WHERE field_name NOT LIKE 'core.%')=36,'Original field readings stay retained including refused VIN';
 ASSERT NOT EXISTS(SELECT FROM field_evidence f JOIN fixture_cases c ON c.field=f.field_name AND c.value=f.proposed_value WHERE c.reason IS NOT NULL);
END $$;
SELECT public.accept_cited_field_evidence('30000000-0000-4000-8000-000000000001',100,'20000000-0000-4000-8000-000000000001');
DO $$ BEGIN
 ASSERT NOT EXISTS(SELECT FROM field_evidence WHERE status<>'accepted'),'Supported readings continue automatic processing without a manual queue';
 ASSERT (SELECT engine_type='455 V8' AND displacement='455ci' AND color='Red' AND transmission='manual' AND body_style='Coupe' AND interior_color='Black' AND drivetrain='RWD' FROM vehicles LIMIT 1);
 ASSERT EXISTS(SELECT FROM vehicle_field_provenance WHERE field_name='mileage' AND current_value='42.6');
END $$;
-- The original plate parser retains its identifier handoff, never a body-style claim.
INSERT INTO vehicle_images(id,vehicle_id,vision_gate_status,ai_processing_status,ai_scan_metadata) VALUES
('10000000-0000-4000-8000-000000000099','20000000-0000-4000-8000-000000000001','approved','completed',
 '{"classification":{"image_type":"detail_closeup","confidence":0.95,"description":"Manufacturer plate","v2":{"vehicle_fields":[{"field_name":"body_style","value":"65A","evidence":"plate text ''65A'' under body","confidence":0.95}],"text_lines":[{"text":"65A","confidence":0.95}]}}}');
SELECT public.photo_land_classification('10000000-0000-4000-8000-000000000099');
DO $$ BEGIN
 ASSERT EXISTS(SELECT FROM vehicle_identifiers WHERE kind='plate_body_code' AND value='65A' AND evidence_class='plate_stamping');
 ASSERT NOT EXISTS(SELECT FROM field_evidence WHERE proposed_value='65A');
END $$;
SELECT 'PASS: source-role refusals, literal retention, both writer guard contracts, automatic supported-field acceptance' AS result;
