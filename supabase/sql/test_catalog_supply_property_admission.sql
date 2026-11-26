\set ON_ERROR_STOP on
-- Synthetic-only empty PostgreSQL17 contract; retained excerpts are parser fixtures,
-- never production source observations or claims of verified supplier contents.
DO $$ BEGIN
 IF current_database() NOT LIKE 'dm_refinement_%' OR to_regclass('public.vehicle_observations') IS NOT NULL
 THEN RAISE EXCEPTION 'Use empty disposable dm_refinement_ database'; END IF;
END $$;
CREATE SCHEMA auth;
CREATE SCHEMA storage;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('request.jwt.claim.role',true) $$;
CREATE TYPE public.observation_kind AS ENUM('specification');
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE TABLE storage.buckets(id text PRIMARY KEY,public boolean);
CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text,version text,metadata jsonb,user_metadata jsonb,UNIQUE(bucket_id,name));
CREATE TABLE public.reference_documents(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),slug text UNIQUE NOT NULL,title text NOT NULL,category text,
 file_path text,file_hash text,file_size_bytes bigint,page_count int,base_trust_score numeric,extraction_method text,extraction_quality text,
 extracted_at timestamptz,added_at timestamptz NOT NULL DEFAULT statement_timestamp(),source_url text,source_capture jsonb,superseded_by uuid);
CREATE TABLE public.document_pages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),document_id uuid REFERENCES public.reference_documents(id),
 page_number int,extracted_text text,has_diagrams boolean,extraction_method text,extraction_notes text,extracted_at timestamptz,UNIQUE(document_id,page_number));
CREATE TABLE public.observation_sources(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),slug text UNIQUE,display_name text,category text,
 base_trust_score numeric,supported_observations public.observation_kind[],notes text);
CREATE TABLE public.catalog_sources(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),base_url text);
CREATE TABLE public.catalog_parts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),catalog_id uuid REFERENCES public.catalog_sources(id),part_number text,supplier_url text);
CREATE TABLE public.vehicle_observations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),source_id uuid,kind text,vehicle_id uuid,subject_type text,subject_id uuid,
 source_observation_id uuid,source_url text,source_identifier text,observed_at timestamptz,extraction_method text,raw_source_ref text,content_text text,
 confidence_score numeric,analysis_deferred boolean,is_superseded boolean DEFAULT false,superseded_by uuid,superseded_at timestamptz,
 citation_document_id uuid,citation_page_number int,citation_excerpt text,structured_data jsonb,content_hash text UNIQUE,
 ingested_at timestamptz DEFAULT statement_timestamp(),is_processed boolean DEFAULT false,processed_at timestamptz);
INSERT INTO public.observation_sources(slug,display_name,category) VALUES('manual_upload','Manual upload','owner');
\i supabase/migrations/20261126003641_catalog_supply_property_admission.sql
CREATE FUNCTION pg_temp.ok(v boolean,m text) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF v IS DISTINCT FROM true THEN RAISE EXCEPTION '%',m; END IF;END$$;
CREATE FUNCTION pg_temp.refuse(q text,m text) RETURNS void LANGUAGE plpgsql AS $$BEGIN BEGIN EXECUTE q; EXCEPTION WHEN OTHERS THEN RETURN; END;RAISE EXCEPTION 'Expected refusal: %',m;END$$;
CREATE TEMP TABLE fixture(k text PRIMARY KEY,v jsonb);
-- Models the canonical intake's exact INSERT recipe. No scalar claims supplied by caller.
CREATE FUNCTION pg_temp.admit(q jsonb) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE r public.vehicle_observations; got uuid;
BEGIN
 IF q IS NULL THEN RAISE EXCEPTION 'No qualification'; END IF;
 SELECT * INTO r FROM jsonb_populate_record(NULL::public.vehicle_observations,q->'input');
 INSERT INTO public.vehicle_observations(source_id,kind,vehicle_id,subject_type,subject_id,source_observation_id,source_url,source_identifier,
 observed_at,extraction_method,raw_source_ref,content_text,confidence_score,analysis_deferred,is_superseded,citation_document_id,citation_page_number,
 citation_excerpt,structured_data,content_hash)
 VALUES(r.source_id,r.kind,r.vehicle_id,r.subject_type,r.subject_id,r.source_observation_id,r.source_url,r.source_identifier,r.observed_at,
 r.extraction_method,r.raw_source_ref,r.content_text,r.confidence_score,r.analysis_deferred,r.is_superseded,r.citation_document_id,
 r.citation_page_number,r.citation_excerpt,r.structured_data,r.content_hash) RETURNING id INTO got;
 RETURN got;
END $$;
CREATE FUNCTION pg_temp.document(body text,url text DEFAULT 'https://supplier.example/TEST-KIT') RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE h text; d jsonb; BEGIN
 h:=encode(sha256(convert_to(body,'UTF8')),'hex');
 INSERT INTO storage.objects(bucket_id,name,version,metadata,user_metadata)
 VALUES('reference-docs','supplied/'||h||'.md','fixture-v1',jsonb_build_object('mimetype','text/markdown','size',octet_length(body)),
 jsonb_build_object('sha256',h,'source_role','supplied_catalog_unverified')) ON CONFLICT DO NOTHING;
 d:=jsonb_build_object('title','Synthetic contract source','source_url',url,'file_sha256',h,'claimed_captured_at','2026-09-27T00:19:17Z','media_type','text/markdown');
 RETURN public.record_supplied_catalog_document(d,body);
END$$;
INSERT INTO storage.buckets VALUES('reference-docs',true);
INSERT INTO public.catalog_sources(id,base_url) VALUES('00000000-0000-0000-0000-000000000001','https://supplier.example'),
 ('00000000-0000-0000-0000-000000000002','https://other.example');
INSERT INTO public.catalog_parts(id,catalog_id,part_number,supplier_url) VALUES
 ('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000001','TEST-KIT','https://supplier.example/TEST-KIT'),
 ('00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000002','TEST-KIT','https://supplier.example/TEST-KIT');
SET request.jwt.claim.role='service_role';
-- Exact retained 8CYLK-style overview excerpt; other lines below are synthetic unit/refusal fixtures.
INSERT INTO fixture VALUES('body',to_jsonb(E'Item No. TEST-KIT\n$47.242 / Each\nAvailability: 97 Each In Stock\n## Overview\nPack Quantity: 6 Each\nStock Length: 4 FT\nKit Includes:\n- **Qty 8:** Bosch style EV1connector bodies with spring clip\n- **Qty 8**: Rubber 90º boots\n- **Qty 1:** Marker kit (1-8) with RT-375 Clear heat shrink\n- 4 Way Connector Body\n- 4 Cable Seals\nPack Quantity: 6 FT\nStock Length: 4 Each\nPack Quantity: 0 Each\nPack Quantity: NaN Each\n## Components\n- Qty 100: Related terminals'::text));
INSERT INTO fixture SELECT 'document',pg_temp.document(v#>>'{}') FROM fixture WHERE k='body';
INSERT INTO fixture SELECT 'source',to_jsonb(pg_temp.admit(public.qualify_catalog_document((v->>'document_id')::uuid))::text) FROM fixture WHERE k='document';
INSERT INTO fixture SELECT 'pack',to_jsonb(pg_temp.admit(public.qualify_catalog_supply_property(
 (SELECT(v#>>'{}')::uuid FROM fixture WHERE k='source'),'00000000-0000-0000-0000-000000000011',5))::text);
INSERT INTO fixture SELECT 'length',to_jsonb(pg_temp.admit(public.qualify_catalog_supply_property(
 (SELECT(v#>>'{}')::uuid FROM fixture WHERE k='source'),'00000000-0000-0000-0000-000000000011',6))::text);
SELECT pg_temp.ok((SELECT quantity=6 AND quantity_unit='ea' FROM public.catalog_supply_properties WHERE observation_id=(SELECT(v#>>'{}')::uuid FROM fixture WHERE k='pack')),'literal pack six');
SELECT pg_temp.ok((SELECT quantity=4 AND quantity_unit='ft' FROM public.catalog_supply_properties WHERE observation_id=(SELECT(v#>>'{}')::uuid FROM fixture WHERE k='length')),'four-foot stock unit');
SELECT pg_temp.ok(public.current_catalog_supply_properties('00000000-0000-0000-0000-000000000011')#>>'{0,purchasing_eligible}'='false','supplied URL never verifies authority');
SELECT pg_temp.ok((SELECT public.qualify_catalog_document((v->>'document_id')::uuid,(SELECT(v#>>'{}')::uuid FROM fixture WHERE k='source')) IS NOT NULL FROM fixture WHERE k='document'),'exact source replay verified');
SELECT pg_temp.ok((SELECT pg_temp.document(v#>>'{}')->>'document_id'=(SELECT v->>'document_id' FROM fixture WHERE k='document') FROM fixture WHERE k='body'),'immutable bytes replay');
SELECT pg_temp.ok((SELECT source_capture->>'claimed_captured_at'<>source_capture->>'imported_at' FROM public.reference_documents LIMIT 1),'capture and import clocks distinct');
SELECT pg_temp.ok((SELECT public.catalog_supply_witness(replace(v#>>'{}','Kit Includes:','Unqualified description'),'TEST-KIT',8) IS NULL
 FROM fixture WHERE k='body'),'numeric overview bullets need explicit component-list context');

DO $$
DECLARE s uuid; q jsonb; i int; n int;
BEGIN
 SELECT(v#>>'{}')::uuid INTO s FROM fixture WHERE k='source';
 FOR i IN 8..10 LOOP
  q:=public.qualify_catalog_supply_property(s,'00000000-0000-0000-0000-000000000011',i);
  IF q IS NULL OR q#>>'{property,component_catalog_part_id}' IS NOT NULL THEN RAISE EXCEPTION 'literal component claim loses unmapped identity'; END IF;
  PERFORM pg_temp.admit(q);
 END LOOP;
 FOREACH i IN ARRAY ARRAY[3,11,13,14,15,16,18] LOOP
  IF public.qualify_catalog_supply_property(s,'00000000-0000-0000-0000-000000000011',i) IS NOT NULL THEN
  RAISE EXCEPTION 'Unsupported or misleading quantity qualified at line %',i; END IF;
 END LOOP;
 IF public.qualify_catalog_supply_property(s,'00000000-0000-0000-0000-000000000012',5) IS NOT NULL THEN RAISE EXCEPTION 'Cross-supplier same SKU qualified'; END IF;
 q:=public.qualify_catalog_supply_property(s,'00000000-0000-0000-0000-000000000011',12);
 PERFORM pg_temp.refuse(format('SELECT pg_temp.admit(%L::jsonb)',jsonb_set(q,'{input,structured_data,quantity}','99')),'invented numeric fact');
 PERFORM pg_temp.refuse(format('SELECT pg_temp.admit(%L::jsonb)',jsonb_set(q,'{input,structured_data,verified}','true',true)),'invented extra authority flag');
 PERFORM pg_temp.refuse(format('SELECT pg_temp.admit(%L::jsonb)',jsonb_set(q,'{input,subject_id}','"00000000-0000-0000-0000-000000000012"')),'catalog retarget');
 SELECT count(*) INTO n FROM public.catalog_supply_properties;
 IF n<>5 THEN RAISE EXCEPTION 'Unexpected component claims %',n; END IF;
END$$;
-- Generic unrelated observations continue working, including NULL extraction method.
INSERT INTO public.vehicle_observations(content_text) VALUES('Unrelated fixture');
SELECT pg_temp.refuse($$UPDATE public.catalog_supply_properties SET quantity=99$$,'immutable typed index');
SELECT pg_temp.refuse($$UPDATE public.vehicle_observations SET content_text='new amount' WHERE extraction_method='catalog_supply_property_v1'$$,'immutable source property');
SELECT pg_temp.refuse($$UPDATE public.vehicle_observations SET superseded_by=gen_random_uuid() WHERE extraction_method='supplied_catalog_source_v1'$$,'source successor cannot retain current flag');
SELECT pg_temp.refuse($$UPDATE public.vehicle_observations SET superseded_at=now() WHERE extraction_method='catalog_supply_property_v1'$$,'property retirement cannot retain current flag');

-- A revised normalizer creates a distinct immutable interpretation of this
-- same original source; it does not require cloning source testimony.
DO $$
DECLARE original_definition text; s uuid; q jsonb; id uuid;
BEGIN
 original_definition:=pg_get_functiondef('public.catalog_supply_witness(text,text,integer)'::regprocedure);
 EXECUTE replace(original_definition,'catalog_supply_units_v1','catalog_supply_units_fixture_v2');
 SELECT(v#>>'{}')::uuid INTO s FROM fixture WHERE k='source';
 q:=public.qualify_catalog_supply_property(s,'00000000-0000-0000-0000-000000000011',5);
 id:=pg_temp.admit(q);
 IF (SELECT count(*) FROM public.catalog_supply_properties WHERE source_observation_id=s AND source_line=5)<>2 THEN
 RAISE EXCEPTION 'Normalizer revision collided with immutable old index'; END IF;
 IF public.qualify_catalog_supply_property(s,'00000000-0000-0000-0000-000000000011',5,(SELECT(v#>>'{}')::uuid FROM fixture WHERE k='pack')) IS NOT NULL THEN
 RAISE EXCEPTION 'Old normalized result stamped current'; END IF;
 EXECUTE original_definition;
END$$;

DO $$
DECLARE s uuid; d uuid; before_body text; q jsonb; old_url text; old_version text;
BEGIN
 SELECT(v#>>'{}')::uuid INTO s FROM fixture WHERE k='source';
 SELECT(v->>'document_id')::uuid INTO d FROM fixture WHERE k='document';
 SELECT extracted_text INTO before_body FROM public.document_pages WHERE document_id=d;
 q:=public.qualify_catalog_supply_property(s,'00000000-0000-0000-0000-000000000011',12);
 UPDATE public.document_pages SET extracted_text=extracted_text||'changed' WHERE document_id=d;
 IF public.qualify_catalog_supply_property(s,'00000000-0000-0000-0000-000000000011',5) IS NOT NULL THEN RAISE EXCEPTION 'Altered body retained authority'; END IF;
 PERFORM pg_temp.refuse(format('SELECT pg_temp.admit(%L::jsonb)',q),'source withdrawal between preview and insert');
 UPDATE public.document_pages SET extracted_text=before_body WHERE document_id=d;
 UPDATE public.catalog_parts SET part_number='OTHER' WHERE id='00000000-0000-0000-0000-000000000011';
 IF public.qualify_catalog_supply_property(s,'00000000-0000-0000-0000-000000000011',5) IS NOT NULL THEN RAISE EXCEPTION 'Changed catalog identity qualified'; END IF;
 UPDATE public.catalog_parts SET part_number='TEST-KIT' WHERE id='00000000-0000-0000-0000-000000000011';
 UPDATE storage.objects SET version='withdrawn' WHERE name=(SELECT substring(file_path from 16) FROM public.reference_documents WHERE id=d);
 IF public.catalog_document_evidence(d) IS NOT NULL THEN RAISE EXCEPTION 'Storage identity changed without stale hold'; END IF;
 UPDATE storage.objects SET version='fixture-v1';
 UPDATE storage.buckets SET public=false;
 IF public.catalog_document_evidence(d) IS NOT NULL THEN RAISE EXCEPTION 'Private source leaked'; END IF;
 UPDATE storage.buckets SET public=true;
 UPDATE public.vehicle_observations SET is_superseded=true,superseded_at=now() WHERE id=(SELECT(v#>>'{}')::uuid FROM fixture WHERE k='pack');
 IF public.qualify_catalog_supply_property(s,'00000000-0000-0000-0000-000000000011',5,(SELECT(v#>>'{}')::uuid FROM fixture WHERE k='pack')) IS NOT NULL THEN
 RAISE EXCEPTION 'Retired derived property remained current'; END IF;
 PERFORM pg_temp.refuse($q$UPDATE public.vehicle_observations SET superseded_at=NULL WHERE id=(SELECT(v#>>'{}')::uuid FROM fixture WHERE k='pack')$q$,'retirement history cannot clear');
 UPDATE public.vehicle_observations SET is_superseded=true WHERE id=s;
 IF public.qualify_catalog_supply_property(s,'00000000-0000-0000-0000-000000000011',5) IS NOT NULL THEN RAISE EXCEPTION 'Superseded source qualified'; END IF;
 IF public.current_catalog_supply_properties('00000000-0000-0000-0000-000000000011')#>>'{0,hold_reason}'<>'source_changed_or_withdrawn' THEN RAISE EXCEPTION 'Stale claim hidden'; END IF;
 PERFORM pg_temp.refuse(format('UPDATE public.vehicle_observations SET is_superseded=false WHERE id=%L',s),'withdrawn source cannot revive');
END$$;
SELECT pg_temp.ok(NOT has_table_privilege('anon','public.catalog_supply_properties','SELECT')
 AND NOT has_function_privilege('authenticated','public.current_catalog_supply_properties(uuid)','EXECUTE')
 AND NOT has_function_privilege('anon','public.record_supplied_catalog_document(jsonb,text)','EXECUTE'),'no new public access');
SET request.jwt.claim.role='authenticated';
SELECT pg_temp.refuse($$SELECT pg_temp.document('new original source')$$,'signed-in nonservice importer');
SELECT 'test_catalog_supply_property_admission: PASS';
