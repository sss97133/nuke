\set ON_ERROR_STOP on
-- Disposable PostgreSQL fixture only: scoped source/page and replay contract.
CREATE SCHEMA extensions;
CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
CREATE SCHEMA auth;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('request.jwt.claim.role',true) $$;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA storage;
CREATE TABLE storage.buckets(id text PRIMARY KEY,public boolean NOT NULL);
CREATE TABLE storage.objects(id uuid PRIMARY KEY,bucket_id text REFERENCES storage.buckets(id));
CREATE TABLE public.catalog_sources(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL,provider text NOT NULL,base_url text);
CREATE TABLE public.reference_documents(id uuid PRIMARY KEY,category text,page_count integer,file_hash text,source_url text,
 source_capture jsonb,superseded_by uuid,is_current boolean NOT NULL DEFAULT true);
CREATE TABLE public.document_pages(id uuid PRIMARY KEY,document_id uuid NOT NULL REFERENCES public.reference_documents(id),page_number integer NOT NULL,
 UNIQUE(document_id,page_number));
CREATE TABLE public.catalog_reference_documents(catalog_id uuid NOT NULL REFERENCES public.catalog_sources(id),
 reference_document_id uuid NOT NULL REFERENCES public.reference_documents(id),source_revision text NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(catalog_id,reference_document_id),
 UNIQUE(reference_document_id),UNIQUE(catalog_id,source_revision));
CREATE FUNCTION public.attested_pdf_text_evidence(p_id uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT CASE WHEN is_current THEN jsonb_build_object('document_id',id) END FROM public.reference_documents WHERE id=p_id
$$;
CREATE FUNCTION public.reference_document_evidence(p_id uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT CASE WHEN is_current THEN jsonb_build_object('document_id',id) END FROM public.reference_documents WHERE id=p_id
$$;
INSERT INTO storage.buckets VALUES ('reference-docs',true);
INSERT INTO storage.objects VALUES
 ('00000000-0000-4000-8000-000000000011','reference-docs'),
 ('00000000-0000-4000-8000-000000000012','reference-docs'),
 ('00000000-0000-4000-8000-000000000013','reference-docs'),
 ('00000000-0000-4000-8000-000000000014','reference-docs');
INSERT INTO public.reference_documents(id,category,page_count,file_hash,source_url,source_capture) VALUES
 ('10000000-0000-4000-8000-000000000011','parts_catalog',1,repeat('1',64),'https://example.test/suv/0011.pdf',
  jsonb_build_object('schema','attested_pdf_text_v1','revision',repeat('a',64),'storage_object_id','00000000-0000-4000-8000-000000000011')),
 ('10000000-0000-4000-8000-000000000020','parts_catalog',1,repeat('2',64),'https://example.test/suv/0020.pdf',
  jsonb_build_object('schema','supplied_reference_v1','revision',repeat('b',64),'storage_object_id','00000000-0000-4000-8000-000000000012')),
 ('10000000-0000-4000-8000-000000000021','parts_catalog',1,repeat('3',64),'https://example.test/suv/0021.pdf',
  jsonb_build_object('schema','attested_pdf_text_v1','revision',repeat('c',64),'storage_object_id','00000000-0000-4000-8000-000000000013')),
 ('10000000-0000-4000-8000-000000000099','parts_catalog',1,repeat('4',64),'https://example.test/pickup/full.pdf',
  jsonb_build_object('schema','catalog_text_source_v1','revision',repeat('d',64),'storage_object_id','00000000-0000-4000-8000-000000000014'));
INSERT INTO public.document_pages VALUES
 ('20000000-0000-4000-8000-000000000011','10000000-0000-4000-8000-000000000011',1),
 ('20000000-0000-4000-8000-000000000020','10000000-0000-4000-8000-000000000020',1),
 ('20000000-0000-4000-8000-000000000021','10000000-0000-4000-8000-000000000021',1),
 ('20000000-0000-4000-8000-000000000099','10000000-0000-4000-8000-000000000099',1);
INSERT INTO public.catalog_sources(id,name,provider,base_url) VALUES
 ('30000000-0000-4000-8000-000000000099','Existing pickup catalog','LMC','https://example.test/pickup/full.pdf');
INSERT INTO public.catalog_reference_documents(catalog_id,reference_document_id,source_revision) VALUES
 ('30000000-0000-4000-8000-000000000099','10000000-0000-4000-8000-000000000099',repeat('d',64));
\i supabase/migrations/20261128073000_catalog_reference_page_membership.sql
DO $test$
DECLARE cfg jsonb; docs jsonb; first_receipt jsonb; again jsonb; catalog uuid; other_catalog uuid;
 link_row public.catalog_reference_documents%ROWTYPE; third jsonb;
BEGIN
 PERFORM set_config('request.jwt.claim.role','service_role',true);
 IF NOT EXISTS(SELECT 1 FROM public.catalog_reference_documents WHERE catalog_id='30000000-0000-4000-8000-000000000099'
  AND reference_document_id='10000000-0000-4000-8000-000000000099' AND catalog_page_number IS NULL
  AND document_page_id IS NULL AND page_mapping_receipt IS NULL AND page_mapping_receipt_sha256 IS NULL)
 THEN RAISE EXCEPTION 'Existing pickup whole-document link changed'; END IF;
 cfg:=jsonb_build_object('name','LMC 2026 SUV','provider','LMC','base_url','https://example.test/suv/full.pdf',
  'full_pdf_sha256',repeat('f',64),'expected_page_count',220,'reader_actor','test',
  'reader_run_id','fixed-run','reader_verified_at','2026-01-01T00:00:00Z');
 docs:=jsonb_build_array(
  jsonb_build_object('catalog_page_number',11,'document_id','10000000-0000-4000-8000-000000000011',
   'document_page_id','20000000-0000-4000-8000-000000000011','pdf_sha256',repeat('1',64),
   'full_geometry_sha256',repeat('7',64),'individual_geometry_sha256',repeat('7',64),
   'full_render_sha256',repeat('8',64),'individual_render_sha256',repeat('8',64)),
  jsonb_build_object('catalog_page_number',20,'document_id','10000000-0000-4000-8000-000000000020',
   'document_page_id','20000000-0000-4000-8000-000000000020','pdf_sha256',repeat('2',64),
   'full_geometry_sha256',repeat('9',64),'individual_geometry_sha256',repeat('9',64),
   'full_render_sha256',repeat('0',64),'individual_render_sha256',repeat('0',64)));
 first_receipt:=public.record_catalog_page_membership(cfg,docs);
 catalog:=(first_receipt->>'catalog_id')::uuid;
 IF first_receipt->>'inserted'<>'2' OR first_receipt->>'replayed'<>'0'
  OR public.catalog_page_member_evidence(catalog,11,repeat('f',64)) IS NULL
  OR public.catalog_page_member_evidence(catalog,20,repeat('f',64)) IS NULL
  OR public.catalog_page_member_evidence(catalog,11,repeat('e',64)) IS NOT NULL
  THEN RAISE EXCEPTION 'Initial page membership failed'; END IF;
 again:=public.record_catalog_page_membership(cfg,docs);
 IF again->>'inserted'<>'0' OR again->>'replayed'<>'2' OR (again->>'catalog_id')::uuid<>catalog
  OR (SELECT count(*) FROM public.catalog_reference_documents WHERE catalog_id=catalog)<>2
  THEN RAISE EXCEPTION 'Replay was not idempotent'; END IF;
 BEGIN
  PERFORM public.record_catalog_page_membership(cfg,jsonb_build_array(jsonb_set(docs->0,'{individual_render_sha256}',to_jsonb(repeat('f',64)))));
  RAISE EXCEPTION 'Unexpected acceptance of mismatched render';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM='Unexpected acceptance of mismatched render' THEN RAISE; END IF;
 END;
 BEGIN
  PERFORM public.record_catalog_page_membership(cfg,jsonb_build_array(docs->0,docs->0));
  RAISE EXCEPTION 'Unexpected acceptance of repeated page';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Unexpected acceptance of repeated page' THEN RAISE; END IF; END;
 BEGIN
  PERFORM public.record_catalog_page_membership(cfg,jsonb_build_array(jsonb_set(docs->0,'{document_page_id}',to_jsonb('20000000-0000-4000-8000-000000000020'::text))));
  RAISE EXCEPTION 'Unexpected acceptance of another document page';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Unexpected acceptance of another document page' THEN RAISE; END IF; END;
 UPDATE public.reference_documents SET is_current=false WHERE id='10000000-0000-4000-8000-000000000011';
 IF public.catalog_page_member_evidence(catalog,11,repeat('f',64)) IS NOT NULL THEN RAISE EXCEPTION 'Withdrawn source was not held'; END IF;
 BEGIN
  PERFORM public.record_catalog_page_membership(cfg,docs);
  RAISE EXCEPTION 'Unexpected acceptance of withdrawn source';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Unexpected acceptance of withdrawn source' THEN RAISE; END IF; END;
 UPDATE public.reference_documents SET is_current=true WHERE id='10000000-0000-4000-8000-000000000011';
 SELECT * INTO link_row FROM public.catalog_reference_documents WHERE catalog_id=catalog AND catalog_page_number=11;
 UPDATE public.catalog_reference_documents SET page_mapping_receipt=page_mapping_receipt||'{"extra":true}'::jsonb
  WHERE catalog_id=catalog AND catalog_page_number=11;
 IF public.catalog_page_member_evidence(catalog,11,repeat('f',64)) IS NOT NULL THEN RAISE EXCEPTION 'Changed comparison receipt was not held'; END IF;
 UPDATE public.catalog_reference_documents SET page_mapping_receipt=link_row.page_mapping_receipt
  WHERE catalog_id=catalog AND catalog_page_number=11;
 IF public.catalog_page_member_evidence(catalog,11,repeat('f',64)) IS NULL THEN RAISE EXCEPTION 'Restored fixture should qualify'; END IF;
 UPDATE public.catalog_reference_documents SET catalog_page_number=12 WHERE catalog_id=catalog AND catalog_page_number=11;
 IF public.catalog_page_member_evidence(catalog,12,repeat('f',64)) IS NOT NULL THEN RAISE EXCEPTION 'Changed page position was not held'; END IF;
 UPDATE public.catalog_reference_documents SET catalog_page_number=11 WHERE catalog_id=catalog AND catalog_page_number=12;
 INSERT INTO public.catalog_sources(name,provider,base_url) VALUES ('Duplicate catalog','LMC','https://example.test/suv/full.pdf');
 IF public.catalog_page_member_evidence(catalog,11,repeat('f',64)) IS NOT NULL THEN RAISE EXCEPTION 'Competing catalog identity was not held'; END IF;
 DELETE FROM public.catalog_sources WHERE name='Duplicate catalog'; -- disposable fixture only
 third:=jsonb_build_object('catalog_page_number',21,'document_id','10000000-0000-4000-8000-000000000021',
   'document_page_id','20000000-0000-4000-8000-000000000021','pdf_sha256',repeat('3',64),
   'full_geometry_sha256',repeat('7',64),'individual_geometry_sha256',repeat('7',64),
   'full_render_sha256',repeat('8',64),'individual_render_sha256',repeat('8',64));
 BEGIN
  PERFORM public.record_catalog_page_membership(cfg||'{"expected_page_count":221}'::jsonb,jsonb_build_array(third));
  RAISE EXCEPTION 'Unexpected acceptance of conflicting edition page count';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Unexpected acceptance of conflicting edition page count' THEN RAISE; END IF; END;
 BEGIN
  PERFORM public.record_catalog_page_membership(cfg||jsonb_build_object('name','Other catalog','base_url','https://example.test/other.pdf'),
   jsonb_build_array(jsonb_set(third,'{catalog_page_number}','19'::jsonb),jsonb_set(docs->1,'{pdf_sha256}',to_jsonb(repeat('f',64)))));
  RAISE EXCEPTION 'Unexpected acceptance of changed second source';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Unexpected acceptance of changed second source' THEN RAISE; END IF; END;
 IF EXISTS(SELECT 1 FROM public.catalog_sources WHERE base_url='https://example.test/other.pdf')
  THEN RAISE EXCEPTION 'Failed batch did not roll back its catalog'; END IF;
 BEGIN
  PERFORM public.record_catalog_page_membership(cfg||jsonb_build_object('name','Different catalog','base_url','https://example.test/different.pdf'),
   jsonb_build_array(docs->0));
  RAISE EXCEPTION 'Unexpected acceptance of a source already linked to another catalog';
 EXCEPTION WHEN unique_violation THEN NULL; END;
 IF EXISTS(SELECT 1 FROM public.catalog_sources WHERE base_url='https://example.test/different.pdf')
  OR public.catalog_page_member_evidence(catalog,11,repeat('f',64)) IS NULL
  THEN RAISE EXCEPTION 'Cross-catalog source conflict changed the existing link'; END IF;
 INSERT INTO public.catalog_sources(name,provider,base_url) VALUES ('Foreign key test','test','https://example.test/fk.pdf') RETURNING id INTO other_catalog;
 BEGIN
  INSERT INTO public.catalog_reference_documents(catalog_id,reference_document_id,source_revision,catalog_page_number,document_page_id,page_mapping_receipt,page_mapping_receipt_sha256)
  VALUES(other_catalog,'10000000-0000-4000-8000-000000000021',repeat('c',64),21,
   '20000000-0000-4000-8000-000000000020','{}'::jsonb,repeat('a',64));
  RAISE EXCEPTION 'Unexpected acceptance of unrelated document page';
 EXCEPTION WHEN foreign_key_violation THEN NULL; END;
 BEGIN
  INSERT INTO public.catalog_reference_documents(catalog_id,reference_document_id,source_revision,catalog_page_number,document_page_id,page_mapping_receipt,page_mapping_receipt_sha256)
  VALUES(other_catalog,'10000000-0000-4000-8000-000000000021',repeat('c',64),21,
   '20000000-0000-4000-8000-000000000021',NULL,repeat('a',64));
  RAISE EXCEPTION 'Unexpected acceptance of incomplete mapping receipt';
 EXCEPTION WHEN check_violation THEN NULL; END;
 INSERT INTO public.catalog_reference_documents(catalog_id,reference_document_id,source_revision,catalog_page_number,document_page_id,page_mapping_receipt,page_mapping_receipt_sha256)
 VALUES(catalog,'10000000-0000-4000-8000-000000000021',repeat('c',64),11,
  '20000000-0000-4000-8000-000000000021',link_row.page_mapping_receipt,link_row.page_mapping_receipt_sha256);
 IF public.catalog_page_member_evidence(catalog,11,repeat('f',64)) IS NOT NULL THEN RAISE EXCEPTION 'Competing page source was not held'; END IF;
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 BEGIN
  PERFORM public.record_catalog_page_membership(cfg,docs);
  RAISE EXCEPTION 'Unexpected authenticated caller';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 IF has_function_privilege('anon','public.record_catalog_page_membership(jsonb,jsonb)','EXECUTE')
  OR has_function_privilege('authenticated','public.catalog_page_member_evidence(uuid,integer,text)','EXECUTE')
  OR NOT has_function_privilege('service_role','public.record_catalog_page_membership(jsonb,jsonb)','EXECUTE')
  THEN RAISE EXCEPTION 'Membership function grants are wrong'; END IF;
END $test$;
SELECT 'PASS: source membership, source drift, receipt drift, conflict and service-only replay' AS result;
