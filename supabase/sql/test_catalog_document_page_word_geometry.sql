\set ON_ERROR_STOP on
-- Disposable source-owner fixture; source text and geometry are synthetic.
\i supabase/sql/test_catalog_text_source.sql
CREATE FUNCTION public.attested_pdf_text_evidence(uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT NULL::jsonb $$;
CREATE FUNCTION public.reference_document_evidence(uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT NULL::jsonb $$;
\i supabase/migrations/20261128073000_catalog_reference_page_membership.sql
\i supabase/migrations/20261128084000_document_page_word_geometry.sql
\i supabase/migrations/20261128100000_catalog_document_page_word_geometry.sql

DO $test$
DECLARE cat uuid:='00000000-0000-4000-8000-000000000002'; doc uuid; result jsonb; replay jsonb; e uuid;
 geometry text:='{"width":"100","height":"200","words":[["-0.64","1","4","5","cover"],["10","20","30","40","38-2971-BL"],["11","50","31","60","38-2971-BL"]]}';
 empty_geometry text:='{"width":"100","height":"200","words":[]}';
 verified timestamptz:='2026-01-01T00:00:00Z';
BEGIN
 SELECT (r.result->>'document_id')::uuid INTO doc FROM receipt r;
 PERFORM set_config('request.jwt.claim.role','service_role',true);
 result:=public.record_catalog_document_page_word_geometry(cat,doc,1,repeat('a',64),geometry,'pdftotext fixture','agent:test','word-run',verified);
 e:=(result->>'extraction_id')::uuid;
 IF result->>'duplicate'<>'false' OR (result->>'word_count')::integer<>3
  OR public.catalog_page_word_geometry_evidence(e)->>'source_basis' IS DISTINCT FROM 'catalog_document_v1'
  OR NOT EXISTS(SELECT FROM public.document_page_word_regions WHERE extraction_id=e AND word_ordinal=1 AND x_min=-0.64 AND word_text='cover')
  OR (SELECT count(*) FROM public.document_page_word_regions WHERE extraction_id=e AND word_text='38-2971-BL')<>2
  THEN RAISE EXCEPTION 'Whole catalog page geometry did not qualify'; END IF;
 replay:=public.record_catalog_document_page_word_geometry(cat,doc,1,repeat('a',64),geometry,'pdftotext fixture','agent:test','word-run',verified);
 IF replay->>'duplicate'<>'true' OR (replay->>'extraction_id')::uuid<>e
  OR (SELECT count(*) FROM public.reference_documents)<>1 OR (SELECT count(*) FROM public.document_pages)<>3
  OR (SELECT count(*) FROM public.catalog_reference_documents)<>1
  THEN RAISE EXCEPTION 'Replay created duplicate source records'; END IF;
 result:=public.record_catalog_document_page_word_geometry(cat,doc,2,repeat('a',64),empty_geometry,'pdftotext fixture','agent:test','word-run',verified);
 IF (result->>'word_count')::integer<>0 OR public.catalog_page_word_geometry_evidence((result->>'extraction_id')::uuid) IS NULL
  THEN RAISE EXCEPTION 'Empty source page was not retained'; END IF;
 BEGIN
  PERFORM public.record_catalog_document_page_word_geometry(cat,doc,1,repeat('a',64),geometry,'pdftotext fixture','different','word-run',verified);
  RAISE EXCEPTION 'Unexpected replay with different attribution';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Unexpected replay with different attribution' THEN RAISE; END IF; END;
 BEGIN
  PERFORM public.record_catalog_document_page_word_geometry(cat,doc,1,repeat('b',64),geometry,'pdftotext fixture','agent:test','word-run',verified);
  RAISE EXCEPTION 'Unexpected acceptance of different PDF';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Unexpected acceptance of different PDF' THEN RAISE; END IF; END;
 BEGIN
  PERFORM public.record_catalog_document_page_word_geometry(cat,doc,4,repeat('a',64),geometry,'pdftotext fixture','agent:test','word-run',verified);
  RAISE EXCEPTION 'Unexpected acceptance of missing page';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Unexpected acceptance of missing page' THEN RAISE; END IF; END;
 BEGIN
  PERFORM public.record_catalog_document_page_word_geometry(cat,doc,1,repeat('a',64),
   '{"width":"100","height":"200","words":[["bad","1","2","3","word"]]}',
   'pdftotext fixture','agent:test','word-run',verified);
  RAISE EXCEPTION 'Unexpected acceptance of malformed geometry';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM='Unexpected acceptance of malformed geometry' THEN RAISE; END IF; END;
 -- A different page is part of the same transcript source qualification.
 UPDATE public.document_pages SET extracted_text='changed' WHERE document_id=doc AND page_number=3;
 IF public.catalog_page_word_geometry_evidence(e) IS NOT NULL THEN RAISE EXCEPTION 'Changed source transcript was not held'; END IF;
 BEGIN
  PERFORM public.record_catalog_document_page_word_geometry(cat,doc,1,repeat('a',64),geometry,'pdftotext fixture','agent:test','word-run',verified);
  RAISE EXCEPTION 'Unexpected replay against changed source';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Unexpected replay against changed source' THEN RAISE; END IF; END;
 UPDATE public.document_pages SET extracted_text='third' WHERE document_id=doc AND page_number=3;
 UPDATE storage.objects SET version='changed';
 IF public.catalog_page_word_geometry_evidence(e) IS NOT NULL THEN RAISE EXCEPTION 'Changed source object was not held'; END IF;
 UPDATE storage.objects SET version='version-1';
 UPDATE public.document_page_word_extractions SET geometry_attestation=geometry_attestation||'{"extra":true}'::jsonb WHERE id=e;
 IF public.catalog_page_word_geometry_evidence(e) IS NOT NULL THEN RAISE EXCEPTION 'Changed attestation was not held'; END IF;
 UPDATE public.document_page_word_extractions SET geometry_attestation=geometry_attestation-'extra' WHERE id=e;
 UPDATE public.document_page_word_regions SET word_text='changed' WHERE extraction_id=e AND word_ordinal=2;
 IF public.catalog_page_word_geometry_evidence(e) IS NOT NULL THEN RAISE EXCEPTION 'Changed word was not held'; END IF;
 UPDATE public.document_page_word_regions SET word_text='38-2971-BL' WHERE extraction_id=e AND word_ordinal=2;
 IF public.catalog_page_word_geometry_evidence(e) IS NULL THEN RAISE EXCEPTION 'Restored source did not requalify'; END IF;
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 BEGIN
  PERFORM public.record_catalog_document_page_word_geometry(cat,doc,1,repeat('a',64),geometry,'pdftotext fixture','agent:test','word-run',verified);
  RAISE EXCEPTION 'Unexpected authenticated caller';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 IF has_function_privilege('anon','public.record_catalog_document_page_word_geometry(uuid,uuid,integer,text,text,text,text,text,timestamptz)','EXECUTE')
  OR has_function_privilege('authenticated','public.record_catalog_document_page_word_geometry(uuid,uuid,integer,text,text,text,text,text,timestamptz)','EXECUTE')
  OR NOT has_function_privilege('service_role','public.record_catalog_document_page_word_geometry(uuid,uuid,integer,text,text,text,text,text,timestamptz)','EXECUTE')
  THEN RAISE EXCEPTION 'Whole catalog writer grants are wrong'; END IF;
END $test$;
SELECT 'PASS: whole catalog page word geometry, replay and source drift' AS result;
