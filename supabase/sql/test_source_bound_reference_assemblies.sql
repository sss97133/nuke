\set ON_ERROR_STOP on
-- Synthetic-only disposable database. No retained financial, vehicle or image testimony.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA public;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role',true),'') $$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT null::uuid $$;
CREATE TABLE storage.buckets(id text PRIMARY KEY,public boolean);
CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text,version text,metadata jsonb,user_metadata jsonb,UNIQUE(bucket_id,name));
CREATE TABLE public.reference_documents(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),slug text UNIQUE NOT NULL,title text NOT NULL,category text NOT NULL,
 file_path text NOT NULL,file_hash text NOT NULL,file_size_bytes bigint,page_count int,year int,vehicle_scope_class text,vehicle_scope_specific jsonb,
 topics text[],base_trust_score numeric DEFAULT .85,extraction_method text,extraction_quality text,added_at timestamptz NOT NULL DEFAULT now(),
 extracted_at timestamptz,superseded_by uuid REFERENCES public.reference_documents(id),notes text);
CREATE TABLE public.document_pages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),document_id uuid NOT NULL REFERENCES public.reference_documents(id),
 page_number int NOT NULL,extracted_text text,text_search tsvector,has_diagrams boolean DEFAULT false,extraction_method text,extraction_notes text,
 topics text[],extracted_at timestamptz NOT NULL DEFAULT now(),UNIQUE(document_id,page_number));
CREATE TABLE public.observation_sources(id uuid PRIMARY KEY,slug text);
CREATE TABLE public.vehicle_observations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),source_id uuid,kind text,vehicle_id uuid,subject_id uuid,
 is_superseded boolean DEFAULT false,extraction_method text,analysis_deferred boolean,confidence_score numeric,structured_data jsonb,
 citation_document_id uuid,citation_page_number int,citation_excerpt text,source_url text,raw_source_ref text,observed_at timestamptz,observer_raw jsonb,
 component_subject_id uuid,source_observation_id uuid,property_id uuid,descriptor_id uuid,ingested_at timestamptz,content_text text);
CREATE TABLE public.component_assembly_map(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),assembly_name text NOT NULL,assembly_category text NOT NULL,
 assembly_description text,sub_components jsonb DEFAULT '[]',catalog_part_map jsonb DEFAULT '{}',possible_states jsonb DEFAULT '[]',
 state_indicators jsonb DEFAULT '{}',application_years text,application_models text[],created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
CREATE TABLE public.catalog_parts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),part_number text,name text,price_current numeric);
CREATE TABLE public.vehicles(id uuid PRIMARY KEY,year int,make text,model text,body_style text,is_public boolean,deleted_at timestamptz,user_id uuid,owner_id uuid,uploaded_by uuid);
CREATE TABLE public.subject_taxonomy(subject_id uuid PRIMARY KEY,subject_key text,display_name text);
CREATE TABLE public.vehicle_images(id uuid PRIMARY KEY,image_url text,taken_at timestamptz,exif_data jsonb);
CREATE TABLE public.observation_witnesses(observation_id uuid,image_id uuid);
CREATE FUNCTION public.vehicle_user_has_access(uuid,uuid) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
CREATE FUNCTION public.component_reading_matches(public.vehicle_observations,public.vehicle_observations,public.vehicle_images) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
\ir fixtures/reference_component_fold_owner.sql
\ir fixtures/reference_assembly_owners.sql
\ir ../migrations/20261111170449_source_bound_reference_assemblies.sql

CREATE FUNCTION pg_temp.ok(value boolean,message text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF value IS DISTINCT FROM true THEN RAISE EXCEPTION '%',message; END IF; END $$;
CREATE FUNCTION pg_temp.refuse(command text,message text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE refused boolean:=false; BEGIN BEGIN EXECUTE command; EXCEPTION WHEN OTHERS THEN refused:=true; END;
 IF NOT refused THEN RAISE EXCEPTION 'Expected refusal: %',message; END IF; END $$;
CREATE TABLE fixture_inputs(name text PRIMARY KEY,value jsonb);
INSERT INTO storage.buckets VALUES('reference-docs',true);
INSERT INTO storage.objects(bucket_id,name,version,metadata,user_metadata) VALUES('reference-docs','supplied/'||repeat('a',64)||'.pdf','fixture-v1',
 '{"mimetype":"application/pdf","size":100}',jsonb_build_object('sha256',repeat('a',64),'source_role','public_reference'));
INSERT INTO public.observation_sources VALUES('50000000-0000-0000-0000-000000000001','component-maker-documentation');
INSERT INTO fixture_inputs VALUES
 ('document',jsonb_build_object('title','Synthetic reference','category','parts_catalog','source_url','https://manufacturer.example/reference.pdf',
 'pdf_sha256',repeat('a',64),'page_count',3,'retrieved_day','2026-01-01','retrieved_at',null)),
 ('pages','[{"page_number":2,"printed_label":"Diagram 1","extracted_text":"1 UPPER A100; 2 RIGHT A101; 3 LEFT A102; 4 CORNER PAIR A103/A104","has_diagrams":true}]'),
 ('reader','{"method":"interactive_visual_review","model":"synthetic-reader","run_id":"fixture"}'),
 ('assembly','{"name":"outer_moldings","category":"trim","description":"Synthetic outer molding expectation","scope":"Outer finish moldings only","application":{"year_start":1973,"year_end":1973,"make":"Fixture","model":"Example","body_style":"two-door","series":[]},"positions":[],"exclusions":["glass","clips","seals"],"limitations":["Not installed-state evidence"]}');
UPDATE fixture_inputs SET value=jsonb_set(value,'{positions}',(
 SELECT jsonb_agg(jsonb_build_object('key',key,'label',key,'subject_id',null,'quantity',1,
  'part_numbers',pn,'part_number_binding',binding,'source_refs',jsonb_build_array(jsonb_build_object('page_number',2,'figure','Fixture figure','callout',callout,'excerpt',excerpt))))
 FROM (VALUES('upper','["A100"]'::jsonb,'exact_position','1','1 UPPER A100'),('right','["A101"]'::jsonb,'exact_position','2','2 RIGHT A101'),
 ('left','["A102"]'::jsonb,'exact_position','3','3 LEFT A102'),('corner.right','["A103","A104"]'::jsonb,'unordered_pair','4','4 CORNER PAIR A103/A104'),
 ('corner.left','["A103","A104"]'::jsonb,'unordered_pair','4','4 CORNER PAIR A103/A104')) x(key,pn,binding,callout,excerpt))) WHERE name='assembly';

SET request.jwt.claim.role='anon';
SELECT pg_temp.refuse($q$SELECT public.record_supplied_reference_document((SELECT value FROM fixture_inputs WHERE name='document'),
 (SELECT value FROM fixture_inputs WHERE name='pages'),(SELECT value FROM fixture_inputs WHERE name='reader'),now())$q$,'anon writer');
SET request.jwt.claim.role='service_role';
INSERT INTO fixture_inputs SELECT 'record',public.record_supplied_reference_document(
 (SELECT value FROM fixture_inputs WHERE name='document'),(SELECT value FROM fixture_inputs WHERE name='pages'),(SELECT value FROM fixture_inputs WHERE name='reader'),now());
SELECT pg_temp.ok((SELECT count(*)=1 FROM public.reference_documents),'one reference through writer');
SELECT pg_temp.ok(public.record_supplied_reference_document((SELECT value FROM fixture_inputs WHERE name='document'),
 (SELECT value FROM fixture_inputs WHERE name='pages'),(SELECT value FROM fixture_inputs WHERE name='reader'),now())->>'document_id'
 =(SELECT value->>'document_id' FROM fixture_inputs WHERE name='record'),'exact replay uses same document');
SELECT pg_temp.refuse($q$SELECT public.record_supplied_reference_document((SELECT value FROM fixture_inputs WHERE name='document'),
 (SELECT value||value FROM fixture_inputs WHERE name='pages'),(SELECT value FROM fixture_inputs WHERE name='reader'),now())$q$,'duplicate page');
SELECT pg_temp.refuse($q$SELECT public.record_supplied_reference_document((SELECT value FROM fixture_inputs WHERE name='document'),
 (SELECT value FROM fixture_inputs WHERE name='pages'),(SELECT value FROM fixture_inputs WHERE name='reader'),NULL)$q$,'required finite review clock');

-- Synthetic testimony models the existing ingest-observation output; this is a reader/SQL contract,
-- not a claim to have executed the HTTP producer here. The real handler has its own invocation test.
CREATE FUNCTION pg_temp.observe(a jsonb) RETURNS uuid LANGUAGE plpgsql AS $$ DECLARE id uuid; r jsonb; BEGIN
 SELECT value INTO r FROM fixture_inputs WHERE name='record';
 INSERT INTO public.vehicle_observations(source_id,kind,extraction_method,analysis_deferred,confidence_score,structured_data,citation_document_id,
 citation_page_number,citation_excerpt,source_url,raw_source_ref,observed_at,observer_raw)
 VALUES('50000000-0000-0000-0000-000000000001','specification','supplied_reference_assembly_v1',true,.6,
 jsonb_build_object('reference_assembly',a,'reference_revision',r->>'reference_revision','reference_file_hash',r->>'file_hash',
 'definition_role','manufacturer_expected_scope','taxonomy_binding','unresolved'),(r->>'document_id')::uuid,2,'1 UPPER A100',
 'https://manufacturer.example/reference.pdf','sha256:'||repeat('a',64),now(),'{"reader":{"model":"synthetic-reader"}}') RETURNING vehicle_observations.id INTO id;
 RETURN id; END $$;
INSERT INTO fixture_inputs SELECT 'observation',to_jsonb(pg_temp.observe((SELECT value FROM fixture_inputs WHERE name='assembly'))::text);
INSERT INTO fixture_inputs SELECT 'projection',public.project_reference_assembly((SELECT value#>>'{}' FROM fixture_inputs WHERE name='observation')::uuid);
SELECT pg_temp.ok(jsonb_array_length(public.get_all_assemblies_for_vehicle(1973,'Example'))=1,'existing resolver receives expectation');
SELECT pg_temp.ok(public.get_all_assemblies_for_vehicle(1973,'Example')#>>'{0,expected_piece_count}'='5','five scoped pieces');
SELECT pg_temp.ok(public.get_all_assemblies_for_vehicle(1973,'Example')#>'{0,whole_vehicle_expected_count}'='null','no whole-car denominator');
SELECT pg_temp.ok(public.get_all_assemblies_for_vehicle(1973,'Example')#>>'{0,taxonomy_binding}'='unresolved','no false taxonomy');
SELECT pg_temp.ok(public.get_all_assemblies_for_vehicle(1974,'Example')='[]' AND public.get_all_assemblies_for_vehicle(1973,'Other')='[]','exact application');
SELECT pg_temp.ok(public.get_assembly_context_for_ai('outer_moldings',1973)->>'source_status'='current_public_reference','sibling reader follows source');
SELECT pg_temp.ok(public.get_assembly_context_for_ai('outer_moldings',1974) IS NULL,'sibling respects year');
SELECT pg_temp.ok(public.project_reference_assembly((SELECT value#>>'{}' FROM fixture_inputs WHERE name='observation')::uuid)->>'duplicate'='true','projection replay');
SELECT pg_temp.ok((SELECT count(*)=1 FROM public.component_assembly_map),'replay has no duplicate assembly');
INSERT INTO public.vehicles(id,year,make,model,body_style,is_public) VALUES('70000000-0000-0000-0000-000000000001',1973,'Fixture','Example','two door',true),
 ('70000000-0000-0000-0000-000000000002',1973,'Fixture','Example','two-door',false),
 ('70000000-0000-0000-0000-000000000003',1973,'Other','Example','two-door',true),
 ('70000000-0000-0000-0000-000000000004',1973,'Fixture','Example','four-door sedan',true),
 ('70000000-0000-0000-0000-000000000005',1973,'Fixture','Example',null,true);
SET request.jwt.claim.role='anon';
INSERT INTO fixture_inputs SELECT 'public_fold',public.component_evidence_fold('70000000-0000-0000-0000-000000000001');
SELECT pg_temp.ok((SELECT jsonb_array_length(value#>'{component_evidence,expected_assemblies}')=1 FROM fixture_inputs WHERE name='public_fold'),'anonymous-context existing fold exposes qualified template');
SELECT pg_temp.ok((SELECT value#>>'{component_evidence,expected_population,status}'='unknown' AND value#>>'{component_evidence,expected_population,reason}'='partial_reference_scope_only' FROM fixture_inputs WHERE name='public_fold'),'partial scope never becomes full population');
SELECT pg_temp.ok(public.component_evidence_fold('70000000-0000-0000-0000-000000000002')='{}','private vehicle remains hidden');
SELECT pg_temp.ok(public.component_evidence_fold('70000000-0000-0000-0000-000000000003')#>'{component_evidence,expected_assemblies}'='[]','make applicability retained');
SELECT pg_temp.ok(public.component_evidence_fold('70000000-0000-0000-0000-000000000004')#>'{component_evidence,expected_assemblies}'='[]','known body mismatch withheld');
SELECT pg_temp.ok(public.component_evidence_fold('70000000-0000-0000-0000-000000000005')#>>'{component_evidence,expected_assemblies,0,applicability,status}'='body_style_unverified','unknown body is explicitly conditional');
SET request.jwt.claim.role='service_role';
SELECT pg_temp.refuse(format('SELECT public.project_reference_assembly(%L)',pg_temp.observe(jsonb_set((SELECT value FROM fixture_inputs WHERE name='assembly'),'{positions,0,subject_id}','"10000000-0000-0000-0000-000000000001"'))),'cannot bind unrelated registered subject');
SELECT pg_temp.refuse(format('SELECT public.project_reference_assembly(%L)',pg_temp.observe(jsonb_set((SELECT value FROM fixture_inputs WHERE name='assembly'),'{positions,1,key}','"upper"'))),'duplicate position');
SELECT pg_temp.refuse(format('SELECT public.project_reference_assembly(%L)',pg_temp.observe(jsonb_set((SELECT value FROM fixture_inputs WHERE name='assembly'),'{positions,0,source_refs,0,excerpt}','"not in retained page"'))),'invented citation');

BEGIN;
UPDATE public.component_assembly_map SET assembly_description='Uncited replacement';
SELECT pg_temp.ok(public.get_all_assemblies_for_vehicle(1973,'Example')='[]','changed projection cannot replace source description');
SELECT pg_temp.refuse(format('SELECT public.project_reference_assembly(%L)',(SELECT value#>>'{}' FROM fixture_inputs WHERE name='observation')),'replay cannot acknowledge changed projection');
ROLLBACK;
BEGIN;
UPDATE public.vehicle_observations SET is_superseded=true WHERE id=(SELECT value#>>'{}' FROM fixture_inputs WHERE name='observation')::uuid;
SELECT pg_temp.ok(public.get_all_assemblies_for_vehicle(1973,'Example')='[]','observation supersession removes expectation');
SELECT pg_temp.refuse(format('SELECT public.project_reference_assembly(%L)',(SELECT value#>>'{}' FROM fixture_inputs WHERE name='observation')),'replay rechecks source');
ROLLBACK;
BEGIN;
UPDATE public.reference_documents SET source_url='https://manufacturer.example/replaced.pdf';
SELECT pg_temp.ok(public.get_all_assemblies_for_vehicle(1973,'Example')='[]','source URL replacement');
ROLLBACK;
BEGIN;
UPDATE public.document_pages SET extracted_text=extracted_text||' changed';
SELECT pg_temp.ok(public.get_all_assemblies_for_vehicle(1973,'Example')='[]','page extraction mutation');
ROLLBACK;
BEGIN;
UPDATE storage.objects SET version='replacement';
SELECT pg_temp.ok(public.get_all_assemblies_for_vehicle(1973,'Example')='[]','current byte identity replacement');
ROLLBACK;
BEGIN;
UPDATE storage.buckets SET public=false;
SELECT pg_temp.ok(public.get_all_assemblies_for_vehicle(1973,'Example')='[]','private source not exposed');
ROLLBACK;
BEGIN;
DELETE FROM storage.objects;
SELECT pg_temp.ok(public.get_all_assemblies_for_vehicle(1973,'Example')='[]','withdrawn bytes not exposed');
ROLLBACK;

-- A real second session changes the source while projection waits for its row lock.
SELECT dblink_connect('source_change',format('dbname=%s host=%s port=%s user=%s',current_database(),split_part(current_setting('unix_socket_directories'),',',1),current_setting('port'),current_user));
SELECT dblink_send_query('source_change',$q$BEGIN; UPDATE storage.objects SET version='withdrawn-during-projection'; SELECT pg_sleep(0.25); COMMIT;$q$);
SELECT pg_sleep(0.05);
SELECT pg_temp.refuse(format('SELECT public.project_reference_assembly(%L)',(SELECT value#>>'{}' FROM fixture_inputs WHERE name='observation')),'source race');
SELECT dblink_disconnect('source_change');
SELECT pg_temp.ok(public.get_all_assemblies_for_vehicle(1973,'Example')='[]','no stale source after race');

INSERT INTO public.component_assembly_map(assembly_name,assembly_category,application_years,application_models) VALUES('legacy_door','body','1973-1987',ARRAY['Truck']);
SELECT pg_temp.ok(public.get_all_assemblies_for_vehicle(1973,'Truck')#>>'{0,source_status}'='legacy_unattributed','legacy behavior explicitly qualified');
SELECT 'source-bound reference SQL contract PASS' AS result;
