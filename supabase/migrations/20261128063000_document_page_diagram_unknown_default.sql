-- A text-only page import did not inspect diagrams. Do not manufacture a
-- negative diagram assessment when an importer omits this optional field.
-- Existing values and reviewed source fingerprints are deliberately unchanged.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '10s';
DO $guard$
DECLARE required boolean; current_default text;
BEGIN
 SELECT a.attnotnull,pg_get_expr(d.adbin,d.adrelid) INTO required,current_default
 FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
 WHERE a.attrelid='public.document_pages'::regclass AND a.attname='has_diagrams' AND NOT a.attisdropped;
 IF NOT FOUND OR required OR (current_default IS NOT NULL AND current_default <> 'false') THEN
  RAISE EXCEPTION 'document_pages.has_diagrams contract changed; review required';
 END IF;
END $guard$;
ALTER TABLE public.document_pages ALTER COLUMN has_diagrams DROP DEFAULT;
COMMENT ON COLUMN public.document_pages.has_diagrams IS
 'NULL means diagram presence was not established. True and false are recorded indicators and require source-specific provenance; historical defaults did not assess pages.';
COMMIT;
