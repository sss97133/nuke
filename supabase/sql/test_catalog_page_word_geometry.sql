\set ON_ERROR_STOP on
-- Disposable PostgreSQL fixture. The prior test supplies the real page-owner
-- schema and source-membership function; these objects are not production.
\i supabase/sql/test_catalog_reference_page_membership.sql
\i supabase/migrations/20261128084000_document_page_word_geometry.sql

INSERT INTO storage.objects VALUES
 ('00000000-0000-4000-8000-000000000031','reference-docs'),
 ('00000000-0000-4000-8000-000000000032','reference-docs');
INSERT INTO public.reference_documents(id,category,page_count,file_hash,source_url,source_capture) VALUES
 ('10000000-0000-4000-8000-000000000031','parts_catalog',1,repeat('5',64),'https://example.test/layout/31.pdf',
  jsonb_build_object('schema','attested_pdf_text_v1','revision',repeat('3',64),'storage_object_id','00000000-0000-4000-8000-000000000031')),
 ('10000000-0000-4000-8000-000000000032','parts_catalog',1,repeat('6',64),'https://example.test/layout/32.pdf',
  jsonb_build_object('schema','supplied_reference_v1','revision',repeat('4',64),'storage_object_id','00000000-0000-4000-8000-000000000032'));
INSERT INTO public.document_pages VALUES
 ('20000000-0000-4000-8000-000000000031','10000000-0000-4000-8000-000000000031',1),
 ('20000000-0000-4000-8000-000000000032','10000000-0000-4000-8000-000000000032',1);

DO $test$
DECLARE cfg jsonb; links jsonb; cat uuid; result jsonb; replay jsonb; read_id uuid; empty_id uuid;
 geometry text:='{"width":"100","height":"200","words":[["-0.640000","1","4","5","cover"],["10","20","30","40","38-2971-BL"],["11","50","31","60","38-2971-BL"]]}';
 empty_geometry text:='{"width":"100","height":"200","words":[]}';
 gh text; eh text; saved_receipt jsonb; bad_geometry text:='{"width":"100","height":"200","words":[["not-a-number","1","2","3","bad"]]}';
BEGIN
 PERFORM set_config('request.jwt.claim.role','service_role',true);
 gh:=encode(extensions.digest(convert_to(geometry,'UTF8'),'sha256'),'hex');
 eh:=encode(extensions.digest(convert_to(empty_geometry,'UTF8'),'sha256'),'hex');
 cfg:=jsonb_build_object('name','Geometry fixture','provider','fixture','base_url','https://example.test/layout/full.pdf',
  'full_pdf_sha256',repeat('a',64),'expected_page_count',2,'reader_actor','test-reader',
  'reader_run_id','fixed-geometry-run','reader_verified_at','2026-01-01T00:00:00Z');
 links:=jsonb_build_array(
  jsonb_build_object('catalog_page_number',1,'document_id','10000000-0000-4000-8000-000000000031',
   'document_page_id','20000000-0000-4000-8000-000000000031','pdf_sha256',repeat('5',64),
   'full_geometry_sha256',gh,'individual_geometry_sha256',gh,'full_render_sha256',repeat('8',64),'individual_render_sha256',repeat('8',64)),
  jsonb_build_object('catalog_page_number',2,'document_id','10000000-0000-4000-8000-000000000032',
   'document_page_id','20000000-0000-4000-8000-000000000032','pdf_sha256',repeat('6',64),
   'full_geometry_sha256',eh,'individual_geometry_sha256',eh,'full_render_sha256',repeat('9',64),'individual_render_sha256',repeat('9',64)));
 cat:=(public.record_catalog_page_membership(cfg,links)->>'catalog_id')::uuid;
 result:=public.record_catalog_page_word_geometry(cat,1,repeat('a',64),geometry,'pdftotext version fixture');
 read_id:=(result->>'extraction_id')::uuid;
 IF result->>'duplicate'<>'false' OR (result->>'word_count')::integer<>3
  OR public.catalog_page_word_geometry_evidence(read_id) IS NULL
  OR NOT EXISTS(SELECT FROM public.document_page_word_regions WHERE extraction_id=read_id AND word_ordinal=1 AND x_min=-0.64 AND word_text='cover')
  OR (SELECT count(*) FROM public.document_page_word_regions WHERE extraction_id=read_id AND word_text='38-2971-BL')<>2
  THEN RAISE EXCEPTION 'Exact keyed word geometry was not retained'; END IF;
 replay:=public.record_catalog_page_word_geometry(cat,1,repeat('a',64),geometry,'pdftotext version fixture');
 IF replay->>'duplicate'<>'true' OR (replay->>'extraction_id')::uuid<>read_id
  OR (SELECT count(*) FROM public.document_page_word_extractions WHERE page_id='20000000-0000-4000-8000-000000000031')<>1
  OR (SELECT count(*) FROM public.document_page_word_regions WHERE extraction_id=read_id)<>3
  THEN RAISE EXCEPTION 'Word geometry replay changed its keys'; END IF;
 result:=public.record_catalog_page_word_geometry(cat,2,repeat('a',64),empty_geometry,'pdftotext version fixture');
 empty_id:=(result->>'extraction_id')::uuid;
 IF (result->>'word_count')::integer<>0 OR public.catalog_page_word_geometry_evidence(empty_id) IS NULL
  OR EXISTS(SELECT FROM public.document_page_word_regions WHERE extraction_id=empty_id)
  THEN RAISE EXCEPTION 'Empty page extraction did not qualify'; END IF;
 result:=public.record_catalog_page_word_geometry(cat,2,repeat('a',64),empty_geometry,'pdftotext version alternate');
 IF result->>'duplicate'<>'false' OR (result->>'extraction_id')::uuid=empty_id
  OR result->>'extractor_version'<>'pdftotext version alternate'
  OR public.catalog_page_word_geometry_evidence(empty_id) IS NULL
  THEN RAISE EXCEPTION 'A different attributed extractor version did not remain separate'; END IF;
 BEGIN
  PERFORM public.record_catalog_page_word_geometry(cat,1,repeat('a',64),replace(geometry,'cover','changed'),'pdftotext version fixture');
  RAISE EXCEPTION 'Unexpected acceptance of changed source geometry';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Unexpected acceptance of changed source geometry' THEN RAISE; END IF; END;
 BEGIN
  PERFORM public.record_catalog_page_word_geometry(cat,1,repeat('b',64),geometry,'pdftotext version fixture');
  RAISE EXCEPTION 'Unexpected acceptance of another catalog edition';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Unexpected acceptance of another catalog edition' THEN RAISE; END IF; END;
 IF (SELECT count(*) FROM public.document_page_word_regions WHERE extraction_id=read_id)<>3
  THEN RAISE EXCEPTION 'Rejected geometry changed a word read'; END IF;
 -- In this disposable fixture, give malformed data a matching, qualified receipt.
 -- This proves the writer rejects its values after the source-hash check.
 SELECT page_mapping_receipt INTO saved_receipt FROM public.catalog_reference_documents
  WHERE catalog_id=cat AND catalog_page_number=1;
 UPDATE public.catalog_reference_documents SET
  page_mapping_receipt=jsonb_set(saved_receipt,'{word_geometry_sha256}',to_jsonb(encode(extensions.digest(convert_to(bad_geometry,'UTF8'),'sha256'),'hex')))
  WHERE catalog_id=cat AND catalog_page_number=1;
 UPDATE public.catalog_reference_documents SET page_mapping_receipt_sha256=encode(extensions.digest(convert_to(page_mapping_receipt::text,'UTF8'),'sha256'),'hex')
  WHERE catalog_id=cat AND catalog_page_number=1;
 IF public.catalog_page_member_evidence(cat,1,repeat('a',64)) IS NULL
  THEN RAISE EXCEPTION 'Malformed fixture never reached the geometry validator'; END IF;
 BEGIN
  PERFORM public.record_catalog_page_word_geometry(cat,1,repeat('a',64),bad_geometry,'pdftotext version fixture');
  RAISE EXCEPTION 'Unexpected acceptance of malformed geometry';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM='Unexpected acceptance of malformed geometry' THEN RAISE; END IF; END;
 UPDATE public.catalog_reference_documents SET page_mapping_receipt=saved_receipt,
  page_mapping_receipt_sha256=encode(extensions.digest(convert_to(saved_receipt::text,'UTF8'),'sha256'),'hex')
  WHERE catalog_id=cat AND catalog_page_number=1;
 IF public.catalog_page_word_geometry_evidence(read_id) IS NULL THEN RAISE EXCEPTION 'Restored membership did not qualify'; END IF;
 UPDATE public.reference_documents SET is_current=false WHERE id='10000000-0000-4000-8000-000000000031';
 IF public.catalog_page_word_geometry_evidence(read_id) IS NOT NULL THEN RAISE EXCEPTION 'Withdrawn page did not hold word evidence'; END IF;
 BEGIN
  PERFORM public.record_catalog_page_word_geometry(cat,1,repeat('a',64),geometry,'pdftotext version fixture');
  RAISE EXCEPTION 'Unexpected acceptance of withdrawn source';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Unexpected acceptance of withdrawn source' THEN RAISE; END IF; END;
 UPDATE public.reference_documents SET is_current=true WHERE id='10000000-0000-4000-8000-000000000031';
 UPDATE public.document_page_word_extractions SET extractor_version='tampered' WHERE id=read_id;
 IF public.catalog_page_word_geometry_evidence(read_id) IS NOT NULL THEN RAISE EXCEPTION 'Changed extractor attribution did not hold evidence'; END IF;
 UPDATE public.document_page_word_extractions SET extractor_version='pdftotext version fixture' WHERE id=read_id;
 UPDATE public.document_page_word_extractions SET geometry_text=replace(geometry,'cover','changed') WHERE id=read_id;
 IF public.catalog_page_word_geometry_evidence(read_id) IS NOT NULL THEN RAISE EXCEPTION 'Changed geometry did not hold evidence'; END IF;
 UPDATE public.document_page_word_extractions SET geometry_text=geometry WHERE id=read_id;
 UPDATE public.document_page_word_regions SET word_text='tampered' WHERE extraction_id=read_id AND word_ordinal=2;
 IF public.catalog_page_word_geometry_evidence(read_id) IS NOT NULL THEN RAISE EXCEPTION 'Changed word did not hold evidence'; END IF;
 BEGIN
  PERFORM public.record_catalog_page_word_geometry(cat,1,repeat('a',64),geometry,'pdftotext version fixture');
  RAISE EXCEPTION 'Unexpected replay over held word evidence';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Unexpected replay over held word evidence' THEN RAISE; END IF; END;
 UPDATE public.document_page_word_regions SET word_text='38-2971-BL' WHERE extraction_id=read_id AND word_ordinal=2;
 UPDATE public.document_page_word_regions SET x_min=12 WHERE extraction_id=read_id AND word_ordinal=2;
 IF public.catalog_page_word_geometry_evidence(read_id) IS NOT NULL THEN RAISE EXCEPTION 'Changed box did not hold evidence'; END IF;
 UPDATE public.document_page_word_regions SET x_min=10 WHERE extraction_id=read_id AND word_ordinal=2;
 IF public.catalog_page_word_geometry_evidence(read_id) IS NULL THEN RAISE EXCEPTION 'Restored source did not requalify'; END IF;
 DELETE FROM public.document_page_word_regions WHERE extraction_id=read_id AND word_ordinal=3; -- disposable fixture
 IF public.catalog_page_word_geometry_evidence(read_id) IS NOT NULL THEN RAISE EXCEPTION 'Missing word did not hold evidence'; END IF;
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 BEGIN
  PERFORM public.record_catalog_page_word_geometry(cat,2,repeat('a',64),empty_geometry,'pdftotext version fixture');
  RAISE EXCEPTION 'Unexpected authenticated caller';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 IF has_function_privilege('anon','public.record_catalog_page_word_geometry(uuid,integer,text,text,text)','EXECUTE')
  OR has_function_privilege('authenticated','public.catalog_page_word_geometry_evidence(uuid)','EXECUTE')
  OR NOT has_function_privilege('service_role','public.record_catalog_page_word_geometry(uuid,integer,text,text,text)','EXECUTE')
  OR has_table_privilege('anon','public.document_page_word_regions','SELECT')
  OR has_table_privilege('service_role','public.document_page_word_regions','INSERT')
  THEN RAISE EXCEPTION 'Word geometry grants are wrong'; END IF;
END $test$;
SELECT 'PASS: keyed word geometry, empty page, source withdrawal, tamper and replay' AS result;
