\set ON_ERROR_STOP on
-- Disposable database: apply the extension after the existing pickup-source
-- contract and prove the original source qualifier and replay still work.
\i supabase/sql/test_catalog_text_source.sql
CREATE FUNCTION public.attested_pdf_text_evidence(p_id uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT NULL::jsonb $$;
CREATE FUNCTION public.reference_document_evidence(p_id uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT NULL::jsonb $$;
\i supabase/migrations/20261128073000_catalog_reference_page_membership.sql
SELECT pg_temp.ok((SELECT public.catalog_text_source_evidence((result->>'document_id')::uuid) IS NOT NULL FROM receipt),
 'existing whole-catalog source still qualifies after page membership migration');
SELECT pg_temp.ok((SELECT (public.record_catalog_text_source(source)->>'duplicate')::boolean FROM test_source),
 'existing whole-catalog replay remains idempotent');
SELECT pg_temp.ok((SELECT count(*)=1 AND bool_and(catalog_page_number IS NULL AND document_page_id IS NULL
 AND page_mapping_receipt IS NULL AND page_mapping_receipt_sha256 IS NULL) FROM public.catalog_reference_documents),
 'existing whole-document link has no fabricated page mapping');
SELECT 'PASS: existing catalog source qualifier and replay survive membership extension' AS result;
