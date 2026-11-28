\set ON_ERROR_STOP on
-- Run only in a disposable database. All source content below is synthetic.
CREATE SCHEMA auth;
CREATE SCHEMA storage;
CREATE SCHEMA extensions;
CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
 $$ SELECT nullif(current_setting('request.jwt.claim.role',true),'') $$;
DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE TABLE storage.buckets(id text PRIMARY KEY,public boolean);
CREATE TABLE storage.objects(id uuid PRIMARY KEY,bucket_id text,name text,version text,metadata jsonb);
CREATE TABLE public.catalog_sources(id uuid PRIMARY KEY,name text NOT NULL,provider text NOT NULL,base_url text);
CREATE TABLE public.catalog_text_chunks(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),catalog_id uuid,chunk_index integer,text_content text);
CREATE TABLE public.reference_documents(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),slug text UNIQUE NOT NULL,title text NOT NULL,
 category text NOT NULL,file_path text NOT NULL,file_hash text NOT NULL,file_size_bytes bigint,page_count int,
 base_trust_score numeric,extraction_method text,extraction_quality text,extracted_at timestamptz,
 source_url text,source_capture jsonb,superseded_by uuid);
CREATE TABLE public.document_pages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),document_id uuid REFERENCES public.reference_documents(id),
 page_number int NOT NULL,extracted_text text,has_diagrams boolean,extraction_method text,UNIQUE(document_id,page_number));
\i supabase/migrations/20261128044500_catalog_text_source_pages.sql

CREATE FUNCTION pg_temp.ok(v boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF v IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF; END $$;
CREATE FUNCTION pg_temp.refuses(source jsonb, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 BEGIN PERFORM public.record_catalog_text_source(source);
 EXCEPTION WHEN OTHERS THEN RETURN; END;
 RAISE EXCEPTION 'FAIL: % accepted',label;
END $$;
INSERT INTO storage.buckets VALUES ('reference-docs',true);
INSERT INTO storage.objects VALUES ('00000000-0000-4000-8000-000000000001','reference-docs','test catalog/a.pdf','version-1',
 '{"size":123,"mimetype":"application/pdf"}');
INSERT INTO public.catalog_sources VALUES ('00000000-0000-4000-8000-000000000002','Sample catalog','Supplier',
 'https://sample.supabase.co/storage/v1/object/public/reference-docs/test%20catalog/a.pdf');
INSERT INTO public.catalog_text_chunks(catalog_id,chunk_index,text_content) VALUES
 ('00000000-0000-4000-8000-000000000002',0,'first'||chr(12)||chr(12)||'thi'),
 ('00000000-0000-4000-8000-000000000002',1,'rd'||chr(12));
CREATE TEMP TABLE test_source AS SELECT jsonb_build_object(
 'catalog_id','00000000-0000-4000-8000-000000000002',
 'object_id','00000000-0000-4000-8000-000000000001','object_version','version-1',
 'object_name','test catalog/a.pdf','project_origin','https://sample.supabase.co',
 'pdf_sha256',repeat('a',64),'text_sha256',encode(extensions.digest(convert_to('first'||chr(12)||chr(12)||'third'||chr(12),'UTF8'),'sha256'),'hex'),
 'chunk_count',2,'page_count',3,'reader_actor','agent:test','reader_method','synthetic','reader_run_id','test') AS source;

SELECT pg_temp.refuses((SELECT source FROM test_source),'missing service role');
SELECT set_config('request.jwt.claim.role','service_role',false);
CREATE TEMP TABLE receipt AS SELECT public.record_catalog_text_source(source) AS result FROM test_source;
SELECT pg_temp.ok((SELECT (result->>'success')::boolean AND NOT (result->>'duplicate')::boolean FROM receipt),'initial admission');
SELECT pg_temp.ok((SELECT count(*)=3 AND count(*) FILTER (WHERE extracted_text='')=1
 AND bool_and(has_diagrams IS NULL) FROM public.document_pages),'all page boundaries, including empty text');
SELECT pg_temp.ok((SELECT count(*)=1 FROM public.catalog_reference_documents link JOIN receipt r
 ON link.reference_document_id=(r.result->>'document_id')::uuid
 WHERE link.catalog_id='00000000-0000-4000-8000-000000000002'),'typed catalog to reference-document link');
SELECT pg_temp.ok((SELECT public.catalog_text_source_evidence((result->>'document_id')::uuid)->>'pdf_hash_status'
 = 'client_attested_not_server_rehashed' FROM receipt),'qualified metadata and honest hash status');
SELECT pg_temp.ok((SELECT (public.record_catalog_text_source(source)->>'duplicate')::boolean FROM test_source),'idempotent replay');
SELECT pg_temp.ok((SELECT count(*)=1 FROM public.reference_documents) AND (SELECT count(*)=3 FROM public.document_pages),'no duplicate document or pages');
SELECT pg_temp.refuses((SELECT jsonb_set(source,'{text_sha256}',to_jsonb(repeat('f',64))) FROM test_source),'wrong text hash');
SELECT pg_temp.refuses((SELECT jsonb_set(source,'{object_version}',to_jsonb('wrong'::text)) FROM test_source),'wrong object version');
SELECT pg_temp.refuses((SELECT jsonb_set(source,'{object_name}',to_jsonb('other.pdf'::text)) FROM test_source),'wrong object name');
SELECT pg_temp.refuses((SELECT jsonb_set(source,'{project_origin}',to_jsonb('https://other.supabase.co'::text)) FROM test_source),'different storage origin');
SELECT pg_temp.refuses((SELECT jsonb_set(source,'{page_count}','2'::jsonb) FROM test_source),'wrong page count');
SELECT pg_temp.refuses((SELECT source||'{"invented":true}'::jsonb FROM test_source),'unknown source field');
UPDATE public.catalog_text_chunks SET text_content=NULL WHERE chunk_index=1;
SELECT pg_temp.refuses((SELECT source FROM test_source),'missing chunk text');
UPDATE public.catalog_text_chunks SET text_content='rd'||chr(12) WHERE chunk_index=1;
UPDATE storage.objects SET version='version-2';
SELECT pg_temp.ok((SELECT public.catalog_text_source_evidence((result->>'document_id')::uuid) IS NULL FROM receipt),'object version drift held');
UPDATE storage.objects SET version='version-1';
UPDATE public.document_pages SET extracted_text='altered' WHERE page_number=2;
SELECT pg_temp.ok((SELECT public.catalog_text_source_evidence((result->>'document_id')::uuid) IS NULL FROM receipt),'page mutation held');
SELECT pg_temp.refuses((SELECT source FROM test_source),'replay refuses mutated page');
UPDATE public.document_pages SET extracted_text='' WHERE page_number=2;
SELECT pg_temp.ok((SELECT public.catalog_text_source_evidence((result->>'document_id')::uuid) IS NOT NULL FROM receipt),'restored source qualifies again');
UPDATE public.document_pages SET page_number=4 WHERE page_number=3;
SELECT pg_temp.ok((SELECT public.catalog_text_source_evidence((result->>'document_id')::uuid) IS NULL FROM receipt),'page-number mutation held');
SELECT pg_temp.refuses((SELECT source FROM test_source),'replay refuses changed page numbering');
UPDATE public.document_pages SET page_number=3 WHERE page_number=4;
UPDATE public.reference_documents SET title='changed';
SELECT pg_temp.ok((SELECT public.catalog_text_source_evidence((result->>'document_id')::uuid) IS NULL FROM receipt),'catalog metadata mutation held');
UPDATE public.reference_documents SET title='Sample catalog';
UPDATE public.reference_documents SET extraction_quality='reviewed';
SELECT pg_temp.ok((SELECT public.catalog_text_source_evidence((result->>'document_id')::uuid) IS NULL FROM receipt),'unreviewed status mutation held');
UPDATE public.reference_documents SET extraction_quality='unreviewed_source_text';
UPDATE public.reference_documents SET source_capture=jsonb_set(source_capture,'{reader_actor}','"different"'::jsonb);
SELECT pg_temp.ok((SELECT public.catalog_text_source_evidence((result->>'document_id')::uuid) IS NULL FROM receipt),'reader attribution mutation held');
UPDATE public.reference_documents SET source_capture=jsonb_set(source_capture,'{reader_actor}','"agent:test"'::jsonb);
UPDATE storage.buckets SET public=false;
SELECT pg_temp.ok((SELECT public.catalog_text_source_evidence((result->>'document_id')::uuid) IS NULL FROM receipt),'private bucket held');
UPDATE storage.buckets SET public=true;
DELETE FROM public.catalog_reference_documents;
SELECT pg_temp.ok((SELECT public.catalog_text_source_evidence((result->>'document_id')::uuid) IS NULL FROM receipt),'missing typed link held');
SELECT pg_temp.refuses((SELECT source FROM test_source),'replay refuses missing typed link');
INSERT INTO public.catalog_reference_documents(catalog_id,reference_document_id,source_revision)
 SELECT '00000000-0000-4000-8000-000000000002',(result->>'document_id')::uuid,result->>'revision' FROM receipt;
CREATE FUNCTION public.test_reject_page() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF NEW.page_number=2 THEN RAISE EXCEPTION 'synthetic page failure'; END IF; RETURN NEW; END $$;
CREATE TRIGGER synthetic_page_failure BEFORE INSERT ON public.document_pages
 FOR EACH ROW EXECUTE FUNCTION public.test_reject_page();
SELECT pg_temp.refuses((SELECT jsonb_set(source,'{reader_method}',to_jsonb('failure_test'::text)) FROM test_source),'page insert failure');
SELECT pg_temp.ok((SELECT count(*)=1 FROM public.reference_documents)
 AND (SELECT count(*)=1 FROM public.catalog_reference_documents)
 AND (SELECT count(*)=3 FROM public.document_pages),'page failure rolls back document and typed link');
DROP TRIGGER synthetic_page_failure ON public.document_pages;
SELECT pg_temp.ok(NOT has_function_privilege('anon','public.record_catalog_text_source(jsonb)','EXECUTE')
 AND NOT has_function_privilege('authenticated','public.catalog_text_source_evidence(uuid)','EXECUTE')
 AND has_function_privilege('service_role','public.record_catalog_text_source(jsonb)','EXECUTE')
 AND NOT has_table_privilege('service_role','public.catalog_reference_documents','INSERT'),'service-only grants');
SELECT 'PASS: catalog source and pages are replay-safe, scoped, and version-held' AS result;
