\set ON_ERROR_STOP on
-- Disposable source-custody contract. No vehicle testimony or property claims.
\i supabase/sql/fixtures/reference_document_schema.sql
CREATE SCHEMA extensions;
CREATE FUNCTION extensions.digest(text,text) RETURNS bytea LANGUAGE sql IMMUTABLE AS $$ SELECT public.digest($1,$2) $$;
\i supabase/migrations/20261116055600_evidence_part_number_validation.sql
\i supabase/migrations/20261126090153_qualified_reference_document_evidence.sql
CREATE FUNCTION pg_temp.ok(value boolean,message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF value IS DISTINCT FROM true THEN RAISE EXCEPTION '%',message; END IF; END $$;
CREATE TABLE fixture_reference(document_id uuid, revision text);
INSERT INTO storage.buckets VALUES('reference-docs',true);
INSERT INTO storage.objects(bucket_id,name,version,metadata,user_metadata)
VALUES('reference-docs','supplied/'||repeat('a',64)||'.pdf','fixture-v1',
 '{"mimetype":"application/pdf","size":100}',jsonb_build_object('sha256',repeat('a',64),'source_role','public_reference'));
SET request.jwt.claim.role='service_role';
INSERT INTO fixture_reference
SELECT (r->>'document_id')::uuid,r->>'reference_revision' FROM (SELECT public.record_supplied_reference_document(
 jsonb_build_object('title','Synthetic cable source','category','component_datasheet',
 'source_url','https://manufacturer.example/cable.pdf','pdf_sha256',repeat('a',64),'page_count',2,
 'retrieved_day',to_char(current_date,'YYYY-MM-DD'),'retrieved_at',NULL),
 '[{"page_number":1,"printed_label":"1","extracted_text":"Maximum resistance 0.183 ohm per 1000 ft at 20 C.","has_diagrams":false},
 {"page_number":2,"printed_label":"2","extracted_text":"Fixture cable construction.","has_diagrams":true}]',
 '{"method":"synthetic_visual_review","model":"fixture","run_id":"reference-contract"}',now()) r) s;
SELECT pg_temp.ok((SELECT public.reference_document_evidence(document_id)->>'reference_revision'=revision
 AND public.reference_document_evidence(document_id)->>'retained_page_count'='2' FROM fixture_reference),'source admitted through existing writer qualifies');
SELECT pg_temp.ok(public.reference_document_evidence('00000000-0000-0000-0000-000000000000') IS NULL,'missing source is unknown');
SELECT pg_temp.ok(NOT has_function_privilege('anon','public.reference_document_evidence(uuid)','EXECUTE')
 AND NOT has_function_privilege('authenticated','public.reference_document_evidence(uuid)','EXECUTE')
 AND has_function_privilege('service_role','public.reference_document_evidence(uuid)','EXECUTE'),'helper stays internal');
SET ROLE anon;
DO $$ BEGIN
 BEGIN PERFORM public.reference_document_evidence('00000000-0000-0000-0000-000000000000');
 RAISE EXCEPTION 'anonymous custody call unexpectedly allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
-- Every mutation below is confined to this disposable reference fixture.
BEGIN;
UPDATE reference_documents SET superseded_by=id;
SELECT pg_temp.ok((SELECT public.reference_document_evidence(document_id) IS NULL FROM fixture_reference),'document superseded refuses qualification');
ROLLBACK;
BEGIN;
UPDATE reference_documents SET extraction_method='legacy_reader';
SELECT pg_temp.ok((SELECT public.reference_document_evidence(document_id) IS NULL FROM fixture_reference),'legacy extraction refuses qualification');
ROLLBACK;
BEGIN;
UPDATE reference_documents SET source_capture=jsonb_set(source_capture,'{visibility}','"private"');
SELECT pg_temp.ok((SELECT public.reference_document_evidence(document_id) IS NULL FROM fixture_reference),'private designation refuses qualification');
ROLLBACK;
BEGIN;
UPDATE reference_documents SET source_capture=jsonb_set(source_capture,'{schema}','"other"');
SELECT pg_temp.ok((SELECT public.reference_document_evidence(document_id) IS NULL FROM fixture_reference),'unknown custody schema refuses qualification');
ROLLBACK;
BEGIN;
UPDATE reference_documents SET source_capture=NULL;
SELECT pg_temp.ok((SELECT public.reference_document_evidence(document_id) IS NULL FROM fixture_reference),'missing custody refuses qualification');
ROLLBACK;
BEGIN;
UPDATE reference_documents SET file_hash=repeat('b',64);
SELECT pg_temp.ok((SELECT public.reference_document_evidence(document_id) IS NULL FROM fixture_reference),'file identity changed refuses qualification');
ROLLBACK;
BEGIN;
UPDATE reference_documents SET title='Changed source title';
SELECT pg_temp.ok((SELECT public.reference_document_evidence(document_id) IS NULL FROM fixture_reference),'title changes revision refuses qualification');
ROLLBACK;
BEGIN;
UPDATE reference_documents SET category='parts_catalog';
SELECT pg_temp.ok((SELECT public.reference_document_evidence(document_id) IS NULL FROM fixture_reference),'category changes revision refuses qualification');
ROLLBACK;
BEGIN;
UPDATE reference_documents SET page_count=3;
SELECT pg_temp.ok((SELECT public.reference_document_evidence(document_id) IS NULL FROM fixture_reference),'page count changes revision refuses qualification');
ROLLBACK;
BEGIN;
UPDATE reference_documents SET source_url='https://manufacturer.example/replacement.pdf';
SELECT pg_temp.ok((SELECT public.reference_document_evidence(document_id) IS NULL FROM fixture_reference),'URL changes revision refuses qualification');
ROLLBACK;
BEGIN;
UPDATE reference_documents SET source_url='http://localhost/private.pdf';
SELECT pg_temp.ok((SELECT public.reference_document_evidence(document_id) IS NULL FROM fixture_reference),'invalid source URL refuses qualification');
ROLLBACK;
BEGIN;
UPDATE reference_documents SET file_size_bytes=101;
SELECT pg_temp.ok((SELECT public.reference_document_evidence(document_id) IS NULL FROM fixture_reference),'recorded size mismatch refuses qualification');
ROLLBACK;
BEGIN;
UPDATE reference_documents SET source_capture=jsonb_set(source_capture,'{revision}',to_jsonb(repeat('b',64)));
SELECT pg_temp.ok((SELECT public.reference_document_evidence(document_id) IS NULL FROM fixture_reference),'revision changed refuses qualification');
ROLLBACK;
BEGIN;
UPDATE storage.objects SET id=gen_random_uuid();
SELECT pg_temp.ok((SELECT public.reference_document_evidence(document_id) IS NULL FROM fixture_reference),'object identity changed refuses qualification');
ROLLBACK;
BEGIN;
UPDATE storage.objects SET version='replacement';
SELECT pg_temp.ok((SELECT public.reference_document_evidence(document_id) IS NULL FROM fixture_reference),'object version changed refuses qualification');
ROLLBACK;
BEGIN;
UPDATE storage.objects SET user_metadata=jsonb_set(user_metadata,'{sha256}',to_jsonb(repeat('b',64)));
SELECT pg_temp.ok((SELECT public.reference_document_evidence(document_id) IS NULL FROM fixture_reference),'storage hash changed refuses qualification');
ROLLBACK;
BEGIN;
UPDATE storage.objects SET user_metadata=jsonb_set(user_metadata,'{source_role}','"private"');
SELECT pg_temp.ok((SELECT public.reference_document_evidence(document_id) IS NULL FROM fixture_reference),'storage role changed refuses qualification');
ROLLBACK;
BEGIN;
UPDATE storage.objects SET metadata=jsonb_set(metadata,'{mimetype}','"text/plain"');
SELECT pg_temp.ok((SELECT public.reference_document_evidence(document_id) IS NULL FROM fixture_reference),'storage MIME changed refuses qualification');
ROLLBACK;
BEGIN;
UPDATE storage.objects SET metadata=jsonb_set(metadata,'{size}','"invalid"');
SELECT pg_temp.ok((SELECT public.reference_document_evidence(document_id) IS NULL FROM fixture_reference),'storage size malformed refuses qualification');
ROLLBACK;
BEGIN;
UPDATE storage.objects SET metadata=metadata-'size';
SELECT pg_temp.ok((SELECT public.reference_document_evidence(document_id) IS NULL FROM fixture_reference),'storage size missing refuses qualification');
ROLLBACK;
BEGIN;
UPDATE storage.objects SET metadata=jsonb_set(metadata,'{size}','9999999999999999999999999999999999999999999');
SELECT pg_temp.ok((SELECT public.reference_document_evidence(document_id) IS NULL FROM fixture_reference),'storage size too large refuses qualification');
ROLLBACK;
BEGIN;
UPDATE storage.buckets SET public=false;
SELECT pg_temp.ok((SELECT public.reference_document_evidence(document_id) IS NULL FROM fixture_reference),'bucket private refuses qualification');
ROLLBACK;
BEGIN;
DELETE FROM storage.objects;
SELECT pg_temp.ok((SELECT public.reference_document_evidence(document_id) IS NULL FROM fixture_reference),'object withdrawn refuses qualification');
ROLLBACK;
BEGIN;
UPDATE document_pages SET extracted_text=extracted_text||' modified' WHERE page_number=1;
SELECT pg_temp.ok((SELECT public.reference_document_evidence(document_id) IS NULL FROM fixture_reference),'page text changed refuses qualification');
ROLLBACK;
BEGIN;
UPDATE document_pages SET extraction_notes='changed' WHERE page_number=1;
SELECT pg_temp.ok((SELECT public.reference_document_evidence(document_id) IS NULL FROM fixture_reference),'page label changed refuses qualification');
ROLLBACK;
BEGIN;
UPDATE document_pages SET has_diagrams=true WHERE page_number=1;
SELECT pg_temp.ok((SELECT public.reference_document_evidence(document_id) IS NULL FROM fixture_reference),'page diagram flag changed refuses qualification');
ROLLBACK;
BEGIN;
UPDATE document_pages SET extraction_method='unreviewed' WHERE page_number=1;
SELECT pg_temp.ok((SELECT public.reference_document_evidence(document_id) IS NULL FROM fixture_reference),'page reader changed refuses qualification');
ROLLBACK;
BEGIN;
DELETE FROM document_pages WHERE page_number=1;
SELECT pg_temp.ok((SELECT public.reference_document_evidence(document_id) IS NULL FROM fixture_reference),'page withdrawn refuses qualification');
ROLLBACK;
BEGIN;
DELETE FROM document_pages;
SELECT pg_temp.ok((SELECT public.reference_document_evidence(document_id) IS NULL FROM fixture_reference),'all pages withdrawn refuses qualification');
ROLLBACK;
SELECT pg_temp.ok((SELECT public.reference_document_evidence(document_id) IS NOT NULL FROM fixture_reference),'original source restored after mutation cases');
SELECT 'PASS: current retained document custody, revision binding, withdrawal and permissions' AS result;
