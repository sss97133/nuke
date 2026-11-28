\set ON_ERROR_STOP on
-- Run only in a disposable database. All content and object metadata are synthetic.
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
CREATE TABLE public.reference_documents(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),slug text UNIQUE NOT NULL,title text NOT NULL,
 category text NOT NULL,file_path text NOT NULL,file_hash text NOT NULL,file_size_bytes bigint,page_count int,
 base_trust_score numeric,extraction_method text,extraction_quality text,extracted_at timestamptz,
 source_url text,source_capture jsonb,superseded_by uuid);
CREATE TABLE public.document_pages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),document_id uuid REFERENCES public.reference_documents(id),
 page_number int NOT NULL,extracted_text text,has_diagrams boolean,extraction_method text,UNIQUE(document_id,page_number));
\i supabase/migrations/20261128061000_attested_pdf_text_source.sql

CREATE FUNCTION pg_temp.ok(v boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF v IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF; END $$;
CREATE FUNCTION pg_temp.refuses(s jsonb,p jsonb,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN BEGIN PERFORM public.record_attested_pdf_text(s,p); EXCEPTION WHEN OTHERS THEN RETURN; END;
 RAISE EXCEPTION 'FAIL: % accepted',label; END $$;
INSERT INTO storage.buckets VALUES ('reference-docs',true);
INSERT INTO storage.objects VALUES ('00000000-0000-4000-8000-000000000001','reference-docs',
 'catalog-public/'||repeat('a',64)||'.pdf','version-1','{"size":123,"mimetype":"application/pdf"}');
CREATE TEMP TABLE fixture AS SELECT jsonb_build_object(
 'title','Synthetic SUV catalog','source_url','https://example.com/suv.pdf',
 'object_id','00000000-0000-4000-8000-000000000001','object_version','version-1',
 'object_name','catalog-public/'||repeat('a',64)||'.pdf','pdf_sha256',repeat('a',64),'pdf_size',123,
 'text_sha256',encode(extensions.digest(convert_to('first'||chr(12)||chr(12)||'third'||chr(12),'UTF8'),'sha256'),'hex'),
 'page_count',3,'reader_actor','agent:test','reader_method','client_sha256_pdftotext_v1','reader_run_id','test',
 'reader_verified_at',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')) AS source,
 '["first","","third"]'::jsonb AS pages;
SELECT pg_temp.refuses(source,pages,'missing service role') FROM fixture;
SELECT set_config('request.jwt.claim.role','service_role',false);
CREATE TEMP TABLE receipt AS SELECT public.record_attested_pdf_text(source,pages) AS result FROM fixture;
SELECT pg_temp.ok((SELECT (result->>'success')::boolean AND NOT (result->>'duplicate')::boolean FROM receipt),'initial source admission');
SELECT pg_temp.ok((SELECT count(*)=3 AND count(*) FILTER (WHERE extracted_text='')=1
 AND bool_and(has_diagrams IS NULL) FROM public.document_pages),'every page boundary including empty text');
SELECT pg_temp.ok((SELECT public.attested_pdf_text_evidence((result->>'document_id')::uuid)->>'pdf_hash_status'
 = 'client_attested_not_server_rehashed' FROM receipt),'qualified metadata and honest PDF hash status');
SELECT pg_temp.ok((SELECT public.attested_pdf_text_evidence((result->>'document_id')::uuid)->>'text_provenance_status'
 = 'client_attested_extraction_not_server_verified' FROM receipt),'text extraction is client-attested');
SELECT pg_temp.ok((SELECT (public.record_attested_pdf_text(source,pages)->>'duplicate')::boolean FROM fixture),'idempotent replay');
SELECT pg_temp.ok((SELECT count(*)=1 FROM public.reference_documents) AND (SELECT count(*)=3 FROM public.document_pages),'no duplicate pages');
SELECT pg_temp.refuses(jsonb_set(source,'{text_sha256}',to_jsonb(repeat('f',64))),pages,'wrong text hash') FROM fixture;
SELECT pg_temp.refuses(jsonb_set(source,'{object_version}',to_jsonb('wrong'::text)),pages,'wrong object version') FROM fixture;
SELECT pg_temp.refuses(jsonb_set(source,'{object_name}',to_jsonb('other.pdf'::text)),pages,'wrong object name') FROM fixture;
SELECT pg_temp.refuses(jsonb_set(source,'{pdf_size}','124'::jsonb),pages,'wrong object size') FROM fixture;
SELECT pg_temp.refuses(jsonb_set(source,'{page_count}','2'::jsonb),pages,'wrong page count') FROM fixture;
SELECT pg_temp.refuses(source,'["third","","first"]'::jsonb,'reordered page content') FROM fixture;
SELECT pg_temp.refuses(source,'["first",3,"third"]'::jsonb,'non-string page') FROM fixture;
SELECT pg_temp.refuses(source||'{"invented":true}'::jsonb,pages,'unknown source field') FROM fixture;
UPDATE storage.objects SET version='version-2';
SELECT pg_temp.ok((SELECT public.attested_pdf_text_evidence((result->>'document_id')::uuid) IS NULL FROM receipt),'object version drift held');
UPDATE storage.objects SET version='version-1';
UPDATE public.document_pages SET extracted_text='altered' WHERE page_number=2;
SELECT pg_temp.ok((SELECT public.attested_pdf_text_evidence((result->>'document_id')::uuid) IS NULL FROM receipt),'page mutation held');
SELECT pg_temp.refuses(source,pages,'replay refuses changed page') FROM fixture;
UPDATE public.document_pages SET extracted_text='' WHERE page_number=2;
SELECT pg_temp.ok((SELECT public.attested_pdf_text_evidence((result->>'document_id')::uuid) IS NOT NULL FROM receipt),'restored source qualifies');
UPDATE public.document_pages SET page_number=4 WHERE page_number=3;
SELECT pg_temp.ok((SELECT public.attested_pdf_text_evidence((result->>'document_id')::uuid) IS NULL FROM receipt),'page number drift held');
UPDATE public.document_pages SET page_number=3 WHERE page_number=4;
UPDATE public.reference_documents SET title='changed';
SELECT pg_temp.ok((SELECT public.attested_pdf_text_evidence((result->>'document_id')::uuid) IS NULL FROM receipt),'document metadata drift held');
UPDATE public.reference_documents SET title='Synthetic SUV catalog';
UPDATE public.reference_documents SET source_capture=jsonb_set(source_capture,'{reader_actor}','"changed"'::jsonb);
SELECT pg_temp.ok((SELECT public.attested_pdf_text_evidence((result->>'document_id')::uuid) IS NULL FROM receipt),'reader attribution drift held');
UPDATE public.reference_documents SET source_capture=jsonb_set(source_capture,'{reader_actor}','"agent:test"'::jsonb);
UPDATE storage.buckets SET public=false;
SELECT pg_temp.ok((SELECT public.attested_pdf_text_evidence((result->>'document_id')::uuid) IS NULL FROM receipt),'private bucket held');
UPDATE storage.buckets SET public=true;
CREATE FUNCTION public.test_reject_page() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF NEW.page_number=2 THEN RAISE EXCEPTION 'synthetic page failure'; END IF; RETURN NEW; END $$;
CREATE TRIGGER synthetic_page_failure BEFORE INSERT ON public.document_pages FOR EACH ROW EXECUTE FUNCTION public.test_reject_page();
SELECT pg_temp.refuses(jsonb_set(source,'{source_url}',to_jsonb('https://example.com/other.pdf'::text)),pages,'page insert failure') FROM fixture;
SELECT pg_temp.ok((SELECT count(*)=1 FROM public.reference_documents) AND (SELECT count(*)=3 FROM public.document_pages),
 'failed page insertion rolls back document');
DROP TRIGGER synthetic_page_failure ON public.document_pages;
SELECT pg_temp.ok(NOT has_function_privilege('anon','public.record_attested_pdf_text(jsonb,jsonb)','EXECUTE')
 AND NOT has_function_privilege('authenticated','public.attested_pdf_text_evidence(uuid)','EXECUTE')
 AND has_function_privilege('service_role','public.record_attested_pdf_text(jsonb,jsonb)','EXECUTE'),'service-only grants');
SELECT 'PASS: public PDF source pages are replay-safe and version-held' AS result;
