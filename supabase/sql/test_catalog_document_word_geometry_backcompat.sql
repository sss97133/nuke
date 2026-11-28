\set ON_ERROR_STOP on
-- Run the existing SUV page-mapping contract, then extend the same owner.
\i supabase/sql/test_catalog_page_word_geometry.sql
CREATE FUNCTION public.catalog_text_source_evidence(uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT NULL::jsonb $$;
\i supabase/migrations/20261128100000_catalog_document_page_word_geometry.sql
DO $test$
BEGIN
 IF (SELECT count(*) FROM public.document_page_word_extractions
     WHERE page_id='20000000-0000-4000-8000-000000000032')<>2
  OR EXISTS(SELECT 1 FROM public.document_page_word_extractions
    WHERE page_id='20000000-0000-4000-8000-000000000032'
     AND (source_basis<>'catalog_page_membership_v1' OR public.catalog_page_word_geometry_evidence(id) IS NULL))
  THEN RAISE EXCEPTION 'Existing page-mapping word geometry no longer qualifies'; END IF;
END $test$;
SELECT 'PASS: existing page-mapping word evidence survives whole-document extension' AS result;
