\set ON_ERROR_STOP on
-- Disposable PG17: reuse the full existing curator and measured-gate contract.
-- All new fixtures are reference/metadata rows; no vehicle testimony is written.
\i supabase/sql/test_schema_proposal_key_gate.sql
CREATE SCHEMA extensions;
CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
CREATE SCHEMA storage;
CREATE TABLE storage.buckets(id text PRIMARY KEY,public boolean);
CREATE TABLE storage.objects(id uuid PRIMARY KEY,bucket_id text,name text,version text,metadata jsonb,user_metadata jsonb,UNIQUE(bucket_id,name));
CREATE TABLE public.reference_documents(id uuid PRIMARY KEY,title text,category text,file_path text,file_hash text,file_size_bytes bigint,
 page_count integer,extraction_method text,superseded_by uuid REFERENCES public.reference_documents(id),source_url text,source_capture jsonb);
CREATE TABLE public.document_pages(id uuid PRIMARY KEY,document_id uuid NOT NULL REFERENCES public.reference_documents(id),page_number int,
 extraction_notes text,extracted_text text,has_diagrams boolean,extraction_method text,UNIQUE(document_id,page_number));
-- A type-only fixture for the unchanged assembly function's declaration. No rows.
CREATE TABLE public.vehicle_observations(id uuid PRIMARY KEY,source_id uuid REFERENCES public.observation_sources(id),kind text,
 vehicle_id uuid REFERENCES public.vehicles(id),subject_id uuid,is_superseded boolean,extraction_method text,analysis_deferred boolean,
 confidence_score numeric,structured_data jsonb,citation_document_id uuid REFERENCES public.reference_documents(id),citation_page_number int,
 citation_excerpt text,source_url text,raw_source_ref text,observed_at timestamptz,observer_raw jsonb);
\i supabase/migrations/20261116055600_evidence_part_number_validation.sql
\i supabase/migrations/20261126090153_qualified_reference_document_evidence.sql
\i supabase/migrations/20261126092812_wire_reference_property_vocabulary.sql

SELECT pg_temp.ok('proposal files an open concept without numerical or vehicle claims',
 (SELECT status='open' FROM schema_proposals WHERE id='1b91df64-a041-47f6-b7aa-dadf4c00e918')
 AND NOT EXISTS(SELECT FROM observation_properties WHERE property_key='wire_dc_resistance_per_length')
 AND NOT EXISTS(SELECT FROM vehicle_observations));
DO $$ DECLARE m jsonb; BEGIN
 m:=public.schema_proposal_key_gate(ARRAY['1b91df64-a041-47f6-b7aa-dadf4c00e918']::uuid[]);
 PERFORM pg_temp.ok('unretained page cannot register a property',m->>'decision'='refused' AND m->'reasons'?'citation_reference_not_current');
END $$;
-- Build one synthetic current source with its exact canonical revision. Text is
-- reused from the open proposal; these are vocabulary witnesses, not values.
INSERT INTO storage.buckets VALUES('reference-docs',true);
INSERT INTO storage.objects VALUES('72000000-0000-0000-0000-000000000001','reference-docs','supplied/'||repeat('a',64)||'.pdf','fixture-v1',
 '{"mimetype":"application/pdf","size":100}',jsonb_build_object('sha256',repeat('a',64),'source_role','public_reference'));
INSERT INTO reference_documents VALUES('72000000-0000-0000-0000-000000000002','Reference contract fixture','component_datasheet',
 'reference-docs/supplied/'||repeat('a',64)||'.pdf',repeat('a',64),100,1,'supplied_visual_reference_v1',NULL,'https://manufacturer.example/cable.pdf',NULL);
INSERT INTO document_pages
SELECT '72000000-0000-0000-0000-000000000003','72000000-0000-0000-0000-000000000002',1,'Fixture page 1',
 (SELECT string_agg(e->>'quote',E'\n' ORDER BY ord) FROM schema_proposals p,
  jsonb_array_elements(p.evidence) WITH ORDINALITY a(e,ord) WHERE p.id='1b91df64-a041-47f6-b7aa-dadf4c00e918'),false,'supplied_visual_reference_v1';
DO $$ DECLARE pages jsonb; rev text; BEGIN
 SELECT jsonb_agg(jsonb_build_object('page_number',page_number,'printed_label',extraction_notes,
  'extracted_text',extracted_text,'has_diagrams',has_diagrams) ORDER BY page_number) INTO pages FROM document_pages;
 SELECT encode(extensions.digest(jsonb_build_object('document',jsonb_build_object('title',r.title,'category',r.category,'source_url',r.source_url,
 'pdf_sha256',r.file_hash,'page_count',r.page_count),'pages',pages,'object_id',o.id,'object_version',o.version)::text,'sha256'),'hex')
 INTO rev FROM reference_documents r CROSS JOIN storage.objects o;
 UPDATE reference_documents SET source_capture=jsonb_build_object('schema','supplied_reference_v1','visibility','public_reference',
  'storage_object_id','72000000-0000-0000-0000-000000000001','storage_version','fixture-v1','revision',rev,
  'pages_sha256',encode(extensions.digest(pages::text,'sha256'),'hex'));
 UPDATE schema_proposals SET evidence=(SELECT jsonb_agg(e||jsonb_build_object('row_id','72000000-0000-0000-0000-000000000003',
  'document_id','72000000-0000-0000-0000-000000000002','file_sha256',repeat('a',64),'reference_revision',rev) ORDER BY ord)
  FROM jsonb_array_elements(evidence) WITH ORDINALITY a(e,ord)) WHERE id='1b91df64-a041-47f6-b7aa-dadf4c00e918';
END $$;
CREATE FUNCTION pg_temp.reference_refused(label text,reason text) RETURNS void LANGUAGE plpgsql AS $$ DECLARE m jsonb; BEGIN
 m:=public.schema_proposal_key_gate(ARRAY['1b91df64-a041-47f6-b7aa-dadf4c00e918']::uuid[]);
 PERFORM pg_temp.ok(label,m->>'decision'='refused' AND m->'reasons'?reason
  AND NOT EXISTS(SELECT FROM observation_properties WHERE property_key='wire_dc_resistance_per_length'));
END $$;
BEGIN;
UPDATE storage.buckets SET public=false;
SELECT pg_temp.reference_refused('private reference refused','citation_reference_not_current');
ROLLBACK;
BEGIN;
UPDATE storage.objects SET version='replaced';
SELECT pg_temp.reference_refused('replacement object refused','citation_reference_not_current');
ROLLBACK;
BEGIN;
UPDATE document_pages SET extracted_text=extracted_text||' changed';
SELECT pg_temp.reference_refused('changed page refused','citation_reference_not_current');
ROLLBACK;
BEGIN;
UPDATE document_pages SET extraction_method='generated_summary';
SELECT pg_temp.reference_refused('generated or unreviewed page refused','citation_reference_not_current');
ROLLBACK;
BEGIN;
UPDATE reference_documents SET superseded_by=id;
SELECT pg_temp.reference_refused('withdrawn reference refused','citation_reference_not_current');
ROLLBACK;
BEGIN;
DELETE FROM storage.objects;
SELECT pg_temp.reference_refused('missing retained bytes refused','citation_reference_not_current');
ROLLBACK;
BEGIN;
UPDATE schema_proposals SET evidence=(SELECT jsonb_agg(e||jsonb_build_object('reference_revision',repeat('b',64)))
 FROM jsonb_array_elements(evidence) e) WHERE id='1b91df64-a041-47f6-b7aa-dadf4c00e918';
SELECT pg_temp.reference_refused('stale requested revision refused','citation_reference_binding_mismatch');
ROLLBACK;
BEGIN;
UPDATE schema_proposals SET evidence=(SELECT jsonb_agg(e||jsonb_build_object('file_sha256',repeat('b',64)))
 FROM jsonb_array_elements(evidence) e) WHERE id='1b91df64-a041-47f6-b7aa-dadf4c00e918';
SELECT pg_temp.reference_refused('wrong requested file refused','citation_reference_binding_mismatch');
ROLLBACK;
BEGIN;
UPDATE schema_proposals SET evidence=(SELECT jsonb_agg(e||jsonb_build_object('document_id','72000000-0000-0000-0000-000000000099'))
 FROM jsonb_array_elements(evidence) e) WHERE id='1b91df64-a041-47f6-b7aa-dadf4c00e918';
SELECT pg_temp.reference_refused('different document binding refused','citation_reference_binding_mismatch');
ROLLBACK;
BEGIN;
UPDATE schema_proposals SET evidence=(SELECT jsonb_agg(e||jsonb_build_object('quote','Resistance is 900 synthetic unrelated units'))
 FROM jsonb_array_elements(evidence) e) WHERE id='1b91df64-a041-47f6-b7aa-dadf4c00e918';
SELECT pg_temp.reference_refused('invented quote refused','citation_quote_not_in_row');
ROLLBACK;
BEGIN;
UPDATE schema_proposals SET evidence=(SELECT jsonb_agg(e-'reference_revision'-'file_sha256')
 FROM jsonb_array_elements(evidence) e) WHERE id='1b91df64-a041-47f6-b7aa-dadf4c00e918';
SELECT pg_temp.reference_refused('missing expected fingerprint refused','citation_reference_binding_mismatch');
ROLLBACK;
DO $$ DECLARE m jsonb; BEGIN
 m:=public.schema_proposal_key_gate(ARRAY['1b91df64-a041-47f6-b7aa-dadf4c00e918']::uuid[]);
 PERFORM pg_temp.ok('exact current reviewed page ratifies vocabulary only',m->>'decision'='ratified'
  AND EXISTS(SELECT FROM observation_properties WHERE property_key='wire_dc_resistance_per_length' AND unit='ohm_per_m'
  AND verification_scope='class' AND cardinality='multi' AND discriminator_key='wire_condition_key' AND namespace='core')
  AND NOT EXISTS(SELECT FROM vehicle_observations)
  AND NOT EXISTS(SELECT FROM schema_proposal_reviews WHERE proposal_id='1b91df64-a041-47f6-b7aa-dadf4c00e918'));
 PERFORM pg_temp.ok('measured receipt binds actual source revision and page text hash',EXISTS(
  SELECT FROM jsonb_array_elements(m->'proposals') p,jsonb_array_elements(p->'citations') c
  WHERE c->>'document_id'='72000000-0000-0000-0000-000000000002' AND c->>'file_sha256'=repeat('a',64)
   AND c->>'reference_revision'=(SELECT source_capture->>'revision' FROM reference_documents)
   AND c->>'page_text_sha256'=(SELECT encode(extensions.digest(extracted_text,'sha256'),'hex') FROM document_pages)));
END $$;
SELECT pg_temp.ok('gate stays service-only',NOT has_function_privilege('anon','public.schema_proposal_key_gate(uuid[])','EXECUTE')
 AND NOT has_function_privilege('authenticated','public.schema_proposal_key_gate(uuid[])','EXECUTE')
 AND has_function_privilege('service_role','public.schema_proposal_key_gate(uuid[])','EXECUTE'));
SELECT 'PASS: qualified reference witnesses for measured class vocabulary, with no value or vehicle claim admission' AS result;
