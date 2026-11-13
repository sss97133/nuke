-- Actual reader on PG17, synthetic rows in an EMPTY disposable database only.
\set ON_ERROR_STOP on
DO $$ BEGIN
 IF current_database() NOT LIKE 'dm_refinement_%' OR to_regclass('public.vehicles') IS NOT NULL
 THEN RAISE EXCEPTION 'Requires empty disposable dm_refinement_* database'; END IF;
END $$;
-- Reuse the existing image/privacy reader fixture and its regression cases.
\ir test_cached_image_source_ancestry.sql
ALTER TABLE public.vehicles ADD COLUMN engine_type text;
ALTER TABLE public.vehicle_observations ADD COLUMN source_observation_id uuid,
 ADD COLUMN subject_type text, ADD COLUMN subject_id uuid;
-- Unrelated retained-listing and VIN decoders are not exercised by this contract.
DO $$ DECLARE n text; BEGIN
 FOREACH n IN ARRAY ARRAY['retained_description_property_matches','retained_listing_identity_matches',
  'retained_craigslist_odometer_matches','retained_craigslist_year_matches',
  'retained_description_year_matches','retained_description_identity_matches'] LOOP
  EXECUTE format('CREATE FUNCTION public.%I(public.vehicle_observations,public.vehicle_observations) RETURNS boolean LANGUAGE sql IMMUTABLE AS %L',n,'SELECT false');
 END LOOP;
END $$;
CREATE FUNCTION public.retained_powertrain_value(text,jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$ SELECT NULL::jsonb $$;
CREATE FUNCTION public.identifier_consensus(uuid,text) RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT NULL::jsonb $$;
CREATE TABLE public.superseded_rows(id uuid PRIMARY KEY,source_table text,row_id uuid,row_data jsonb,
 source jsonb,superseded_at timestamptz,restored_at timestamptz);
CREATE INDEX ON public.superseded_rows(source_table,row_id);
CREATE TABLE public.receipts(id uuid PRIMARY KEY,vehicle_id uuid,scope_type text,scope_id text,
 source_document_id uuid,source_document_table text,is_superseded boolean,duplicate_of uuid);
CREATE TABLE public.receipt_vehicle_links(id uuid PRIMARY KEY,receipt_id uuid,vehicle_id uuid,status text,
 retired_at timestamptz,page_date date);
CREATE TABLE public.vehicle_documents(id uuid PRIMARY KEY,vehicle_id uuid,file_url text);
\ir fixtures/field_provenance_before_correction.sql
\ir ../migrations/20261109203000_current_field_correction_citations.sql
GRANT EXECUTE ON FUNCTION public.get_field_provenance(uuid,text) TO anon,authenticated,service_role;
BEGIN;
UPDATE public.vehicles SET engine_type='Fixture V8' WHERE id='11111111-1111-1111-1111-111111111111';
INSERT INTO public.vehicle_documents VALUES('88888888-8888-8888-8888-000000000001','11111111-1111-1111-1111-111111111111','https://example.invalid/private/payer-receipt.pdf');
INSERT INTO public.receipts VALUES('88888888-8888-8888-8888-000000000002','11111111-1111-1111-1111-111111111111','vehicle','11111111-1111-1111-1111-111111111111','88888888-8888-8888-8888-000000000001','vehicle_documents',false,null);
INSERT INTO public.receipt_vehicle_links VALUES('88888888-8888-8888-8888-000000000003','88888888-8888-8888-8888-000000000002','11111111-1111-1111-1111-111111111111','linked',null,'2026-01-01');
INSERT INTO public.superseded_rows VALUES('88888888-8888-8888-8888-000000000004','vehicles','11111111-1111-1111-1111-111111111111',
 '{"field":"engine_type","value":"Old badge claim","replacement":"Fixture V8"}',
 '{"type":"receipt","ref":"88888888-8888-8888-8888-000000000002","title":"private payer and amount","asserted_by":"private account"}','2026-02-01',null);
SET LOCAL ROLE anon;
DO $$ DECLARE p jsonb; BEGIN
 p:=public.get_field_provenance('11111111-1111-1111-1111-111111111111','engine_type');
 ASSERT p->>'value'='Fixture V8';
 ASSERT p->'current_correction'->>'receipt_id'='88888888-8888-8888-8888-000000000002';
 ASSERT p->'current_correction'->>'document_id'='88888888-8888-8888-8888-000000000001';
 ASSERT p->'current_correction'->>'page_date'='2026-01-01';
 ASSERT p::text !~ 'private|payer|asserted_by|amount|file_url', 'Public citation must not copy private correction/source content';
 ASSERT public.get_field_provenance('22222222-2222-2222-2222-222222222222','engine_type')->'current_correction'='null'::jsonb;
 ASSERT public.get_field_provenance('11111111-1111-1111-1111-111111111111','color')->'current_correction'='null'::jsonb;
END $$;
RESET ROLE;
-- Every source withdrawal is read-time effective; none mutates the retained correction.
DO $$ DECLARE mutation text; BEGIN
 FOREACH mutation IN ARRAY ARRAY[
  'UPDATE public.vehicles SET engine_type=''Different'' WHERE id=''11111111-1111-1111-1111-111111111111''',
  'UPDATE public.superseded_rows SET restored_at=now()',
  'UPDATE public.superseded_rows SET source=jsonb_set(source,''{ref}'',''"malformed"'')',
  'UPDATE public.superseded_rows SET source=jsonb_set(source,''{type}'',''"image"'')',
  'UPDATE public.receipts SET is_superseded=true',
  'UPDATE public.receipts SET duplicate_of=id',
  'UPDATE public.receipts SET vehicle_id=''22222222-2222-2222-2222-222222222222''',
  'UPDATE public.receipt_vehicle_links SET retired_at=now()',
  'UPDATE public.receipt_vehicle_links SET status=''unlinked''',
  'UPDATE public.receipt_vehicle_links SET page_date=null',
  'UPDATE public.vehicle_documents SET vehicle_id=''22222222-2222-2222-2222-222222222222''',
  'UPDATE public.receipts SET source_document_id=''88888888-8888-8888-8888-999999999999'''
 ] LOOP
  BEGIN
   EXECUTE mutation;
   ASSERT public.get_field_provenance('11111111-1111-1111-1111-111111111111','engine_type')->'current_correction'='null'::jsonb,mutation;
   RAISE EXCEPTION USING ERRCODE='P9991',MESSAGE='rollback fixture mutation';
  EXCEPTION WHEN SQLSTATE 'P9991' THEN NULL; END;
 END LOOP;
END $$;
-- The same owner accepts a receipt sourced from a currently visible vehicle image.
SAVEPOINT image_receipt;
UPDATE public.receipts SET vehicle_id=null,source_document_table='vehicle_images',source_document_id='44444444-4444-4444-4444-000000000001';
DO $$ BEGIN
 ASSERT public.get_field_provenance('11111111-1111-1111-1111-111111111111','engine_type')->'current_correction'->>'source_table'='vehicle_images';
END $$;
UPDATE public.vehicle_images SET is_sensitive=true WHERE id='44444444-4444-4444-4444-000000000001';
DO $$ BEGIN
 ASSERT public.get_field_provenance('11111111-1111-1111-1111-111111111111','engine_type')->'current_correction'='null'::jsonb;
END $$;
ROLLBACK TO SAVEPOINT image_receipt;
-- A more recent correction must block an older source even if restored or mismatched.
INSERT INTO public.superseded_rows SELECT '88888888-8888-8888-8888-000000000005',source_table,row_id,
 jsonb_set(row_data,'{replacement}','"Different"'),source,'2026-03-01',null FROM public.superseded_rows;
DO $$ BEGIN
 ASSERT public.get_field_provenance('11111111-1111-1111-1111-111111111111','engine_type')->'current_correction'='null'::jsonb;
END $$;
UPDATE public.superseded_rows SET row_data=jsonb_set(row_data,'{replacement}','"Fixture V8"'),restored_at=now() WHERE id='88888888-8888-8888-8888-000000000005';
DO $$ BEGIN
 ASSERT public.get_field_provenance('11111111-1111-1111-1111-111111111111','engine_type')->'current_correction'='null'::jsonb;
END $$;
ROLLBACK;
-- Native photo claims retain only current same-vehicle visible citations.
BEGIN;
INSERT INTO public.vehicle_images(id,vehicle_id,image_url,vision_gate_status) VALUES
 ('88888888-8888-8888-8888-000000000010','11111111-1111-1111-1111-111111111111','https://example.invalid/current.jpg','approved'),
 ('88888888-8888-8888-8888-000000000011',null,'https://example.invalid/withdrawn.jpg','approved');
INSERT INTO public.field_evidence(vehicle_id,field_name,proposed_value,source_type,source_confidence,status,raw_extraction_data) VALUES
 ('11111111-1111-1111-1111-111111111111','engine_type','current photo','ai_visual',90,'accepted','{"photo_id":"88888888-8888-8888-8888-000000000010"}'),
 ('11111111-1111-1111-1111-111111111111','engine_type','image ID only','ai_visual',90,'accepted','{"image_id":"88888888-8888-8888-8888-000000000010"}'),
 ('11111111-1111-1111-1111-111111111111','engine_type','URL only','ai_visual',90,'accepted','{"photo_id":null,"image_url":"https://example.invalid/current.jpg"}'),
 ('11111111-1111-1111-1111-111111111111','engine_type','ID and original URL','ai_visual',90,'accepted','{"photo_id":"88888888-8888-8888-8888-000000000010","image_url":"https://example.invalid/current.jpg"}'),
 ('11111111-1111-1111-1111-111111111111','engine_type','replaced URL','ai_visual',99,'accepted','{"photo_id":"88888888-8888-8888-8888-000000000010","image_url":"https://example.invalid/previous.jpg"}'),
 ('11111111-1111-1111-1111-111111111111','engine_type','conflicting IDs','ai_visual',99,'accepted','{"photo_id":"88888888-8888-8888-8888-000000000010","image_id":"88888888-8888-8888-8888-000000000011"}'),
 ('11111111-1111-1111-1111-111111111111','engine_type','independent document','receipt',90,'accepted','{"document_id":"fixture-receipt"}'),
 ('11111111-1111-1111-1111-111111111111','engine_type','withdrawn photo','ai_visual',99,'accepted','{"photo_id":"88888888-8888-8888-8888-000000000011"}'),
 ('11111111-1111-1111-1111-111111111111','engine_type','malformed citation','ai_visual',99,'accepted','{"photo_id":"broken","image_url":"https://example.invalid/current.jpg"}');
INSERT INTO public.vehicle_field_sources(vehicle_id,field_name,field_value,source_type,source_image_id) VALUES
 ('11111111-1111-1111-1111-111111111111','engine_type','field source current','photo','88888888-8888-8888-8888-000000000010'),
 ('11111111-1111-1111-1111-111111111111','engine_type','field source withdrawn','photo','88888888-8888-8888-8888-000000000011'),
 ('11111111-1111-1111-1111-111111111111','engine_type','independent report','listing',null);
SET LOCAL ROLE anon;
DO $$ DECLARE p jsonb; BEGIN
 p:=public.get_field_provenance('11111111-1111-1111-1111-111111111111','engine_type');
 ASSERT jsonb_array_length(p->'evidence')=7,p::text;
 ASSERT p->>'source_image_url'='https://example.invalid/current.jpg';
 ASSERT p::text !~ 'withdrawn|malformed|replaced URL|conflicting IDs', 'Withdrawn or replaced photos cannot retain current claim authority';
END $$;
RESET ROLE;
UPDATE public.vehicle_images SET image_url='https://example.invalid/replacement.jpg' WHERE id='88888888-8888-8888-8888-000000000010';
DO $$ DECLARE p jsonb; BEGIN
 p:=public.get_field_provenance('11111111-1111-1111-1111-111111111111','engine_type');
 ASSERT jsonb_array_length(p->'evidence')=5,p::text;
 ASSERT p::text !~ 'ID and original URL|URL only', 'Recorded URL cannot attach stale text to replacement bytes';
END $$;
UPDATE public.vehicle_images SET vehicle_id=null WHERE id='88888888-8888-8888-8888-000000000010';
SET LOCAL ROLE anon;
DO $$ DECLARE p jsonb; BEGIN
 p:=public.get_field_provenance('11111111-1111-1111-1111-111111111111','engine_type');
 ASSERT jsonb_array_length(p->'evidence')=2,p::text;
 ASSERT p->'source_image_url'='null'::jsonb;
END $$;
RESET ROLE;
ROLLBACK;
BEGIN;
UPDATE public.vehicles SET deleted_at=now() WHERE id='11111111-1111-1111-1111-111111111111';
SET LOCAL ROLE anon;
DO $$ BEGIN
 ASSERT public.get_field_provenance('11111111-1111-1111-1111-111111111111','engine_type') IS NULL;
 ASSERT public.get_field_provenance('99999999-9999-9999-9999-999999999999','engine_type') IS NULL;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL test.auth_uid='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
DO $$ BEGIN
 ASSERT public.get_field_provenance('99999999-9999-9999-9999-999999999999','engine_type') IS NOT NULL;
END $$;
RESET ROLE;
ROLLBACK;
SELECT 'PASS: current correction receipt, source withdrawal, independent evidence and visibility' AS result;
