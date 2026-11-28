\set ON_ERROR_STOP on
-- Disposable database only. Existing indicators and explicit assessments must survive.
CREATE TABLE public.document_pages(id integer PRIMARY KEY,has_diagrams boolean DEFAULT false);
INSERT INTO public.document_pages(id) VALUES (1);
\i supabase/migrations/20261128063000_document_page_diagram_unknown_default.sql
INSERT INTO public.document_pages(id) VALUES (2);
INSERT INTO public.document_pages(id,has_diagrams) VALUES (3,false),(4,true),(5,NULL);
DO $$ BEGIN
 IF (SELECT has_diagrams FROM public.document_pages WHERE id=1) IS DISTINCT FROM false
  OR (SELECT has_diagrams FROM public.document_pages WHERE id=2) IS NOT NULL
  OR (SELECT has_diagrams FROM public.document_pages WHERE id=3) IS DISTINCT FROM false
  OR (SELECT has_diagrams FROM public.document_pages WHERE id=4) IS DISTINCT FROM true
  OR (SELECT has_diagrams FROM public.document_pages WHERE id=5) IS NOT NULL
 THEN RAISE EXCEPTION 'diagram default or existing assessments changed unexpectedly'; END IF;
END $$;
SELECT 'PASS: omitted diagram assessment remains unknown; explicit and historical values preserved' AS result;
