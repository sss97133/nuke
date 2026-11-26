\set ON_ERROR_STOP on
-- All source rows are synthetic. No observation fixture is inserted: only the
-- actual ingest-observation HTTP producer may create numerical testimony.
\i supabase/sql/test_wire_reference_property_vocabulary.sql
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('request.jwt.claim.role',true) $$;
CREATE TABLE public.wire_specifications(id uuid PRIMARY KEY,wire_type text NOT NULL,mil_spec_reference text);
INSERT INTO public.wire_specifications VALUES('73000000-0000-0000-0000-000000000001','MIL-W-22759/16','MIL-W-22759/16'),
 ('73000000-0000-0000-0000-000000000002','MIL-W-22759/32','MIL-W-22759/32');
INSERT INTO public.observation_sources(id,slug,display_name,category) VALUES(
 '73000000-0000-0000-0000-000000000003','component-maker-documentation','Synthetic technical-documentation source','documentation');
ALTER TABLE public.vehicle_observations ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.vehicle_observations
 ADD COLUMN subject_type text DEFAULT 'vehicle',
 ADD COLUMN subject_organization_id uuid REFERENCES public.organizations(id),
 ADD COLUMN source_observation_id uuid REFERENCES public.vehicle_observations(id),
 ADD COLUMN component_subject_id uuid,
 ADD COLUMN observed_at_basis text,
 ADD COLUMN source_event_time_precision text,
 ADD COLUMN source_event_at timestamptz,
 ADD COLUMN source_identifier text,
 ADD COLUMN content_hash text UNIQUE,
 ADD COLUMN content_text text,
 ADD COLUMN confidence text,
 ADD COLUMN rank text,
 ADD COLUMN property_id uuid REFERENCES public.observation_properties(id),
 ADD COLUMN descriptor_id uuid CHECK(descriptor_id IS NULL),
 ADD COLUMN citation_secure_document_id uuid CHECK(citation_secure_document_id IS NULL),
 ADD COLUMN superseded_by uuid REFERENCES public.vehicle_observations(id),
 ADD COLUMN agent_model text;
\i supabase/migrations/20261126094848_conditioned_wire_reference_intake.sql
CREATE TABLE wire_reference_fixture_rows(size_code text PRIMARY KEY,gauge_label text,expected_awg integer,source_row text);
INSERT INTO wire_reference_fixture_rows
SELECT size_code,label,awg,'M22759/16-'||size_code||'-* '||label||' 1/30 .1 (1) .2 (2) .3 (3) 4 (4) '||us||' ('||km||') '||label||'-fixture'
FROM(VALUES('02','2/0',-1,'.100','.330'),('01','1/0',0,'.300','.900'),('1','1',1,'.150','.490'),('2','2',2,'.200','.656'))x(size_code,label,awg,us,km);
CREATE TABLE wire_reference_fixture_context(family text,headings text,units text,read_at timestamptz);
INSERT INTO wire_reference_fixture_context VALUES('Example resistance table M22759/16 tin-plated copper',
 E'Maximum      Thermax\nWeight       Resistance','Resistance in Ω/1,000 feet (Ω/Km), @20˚ C.',now());
UPDATE public.document_pages SET extracted_text=(SELECT
 E'Insulation rating150 C\n'||family||E'\n'||headings||E'\n'||(SELECT string_agg(source_row,E'\n' ORDER BY size_code) FROM wire_reference_fixture_rows)||E'\n'||units
 FROM wire_reference_fixture_context);
CREATE FUNCTION pg_temp.refresh_wire_reference_fixture() RETURNS void LANGUAGE plpgsql AS $$
DECLARE pages jsonb; rev text; BEGIN
 SELECT jsonb_agg(jsonb_build_object('page_number',page_number,'printed_label',extraction_notes,'extracted_text',extracted_text,
 'has_diagrams',has_diagrams) ORDER BY page_number) INTO pages FROM public.document_pages;
 SELECT encode(extensions.digest(jsonb_build_object('document',jsonb_build_object('title',r.title,'category',r.category,'source_url',r.source_url,
 'pdf_sha256',r.file_hash,'page_count',r.page_count),'pages',pages,'object_id',o.id,'object_version',o.version)::text,'sha256'),'hex')
 INTO rev FROM public.reference_documents r CROSS JOIN storage.objects o;
 UPDATE public.reference_documents SET source_capture=source_capture||jsonb_build_object('revision',rev,
  'pages_sha256',encode(extensions.digest(pages::text,'sha256'),'hex'),'retrieved_at',now()-interval '1 hour','retrieved_day',current_date::text);
END $$;
SELECT pg_temp.refresh_wire_reference_fixture();
CREATE FUNCTION public.test_wire_resistance_fixture(p_size text DEFAULT '2',p_unit text DEFAULT 'ohm_per_1000ft')
RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT jsonb_build_object('profile','m22759_16_resistance_v1','wire_specification_id','73000000-0000-0000-0000-000000000001',
 'document_id',d.id,'reference_revision',d.source_capture->>'revision','file_sha256',d.file_hash,'source_unit',p_unit,
 'reader',jsonb_build_object('method','synthetic_reference_contract','model','fixture','run_id','wire-source-contract'),'read_at',f.read_at,
 'citations',jsonb_build_array(
  jsonb_build_object('role','wire_family','page_id',p.id,'excerpt',f.family),
  jsonb_build_object('role','column_headings','page_id',p.id,'excerpt',f.headings),
  jsonb_build_object('role','value_row','page_id',p.id,'excerpt',r.source_row),
  jsonb_build_object('role','units_temperature','page_id',p.id,'excerpt',f.units)))
 FROM public.reference_documents d JOIN public.document_pages p ON p.document_id=d.id
 CROSS JOIN wire_reference_fixture_context f CROSS JOIN wire_reference_fixture_rows r WHERE r.size_code=p_size
$$;
DO $$ DECLARE r record; q jsonb; a jsonb; b jsonb; BEGIN
 FOR r IN SELECT * FROM wire_reference_fixture_rows LOOP
  q:=public.qualify_wire_resistance_reference(public.test_wire_resistance_fixture(r.size_code));
  PERFORM pg_temp.ok('source gauge '||r.gauge_label||' derived without numeric caller input',q->>'ok'='true'
   AND (q#>>'{condition,gauge_awg}')::integer=r.expected_awg AND q#>>'{condition,conductor_temperature_c}'='20'
   AND q#>>'{condition,value_role}'='maximum' AND q#>>'{recipe,structured_data,installed_state}'='unestablished'
   AND q#>>'{recipe,structured_data,applicability_status}'='unassessed');
 END LOOP;
 a:=public.qualify_wire_resistance_reference(public.test_wire_resistance_fixture('2','ohm_per_1000ft'));
 b:=public.qualify_wire_resistance_reference(public.test_wire_resistance_fixture('2','ohm_per_km'));
 PERFORM pg_temp.ok('unit cells share one exact condition and retain distinct source tokens',
  a#>>'{condition,condition_key}'=b#>>'{condition,condition_key}'
  AND a#>>'{recipe,structured_data,source_value_token}'='.200' AND b#>>'{recipe,structured_data,source_value_token}'='.656'
  AND a#>>'{recipe,source_identifier}'<>b#>>'{recipe,source_identifier}');
 PERFORM pg_temp.ok('maximum conversion is conservative and JSON stable',
  (a#>>'{recipe,structured_data,wire_dc_resistance_per_length}')::numeric>=.200/304.8
  AND (a#>>'{recipe,structured_data,wire_dc_resistance_per_length}')::numeric<.200/304.8+0.000000000001);
 PERFORM pg_temp.ok('pure qualifier creates no observations or projections',
  NOT EXISTS(SELECT FROM public.vehicle_observations) AND NOT EXISTS(SELECT FROM public.wire_resistance_conditions)
  AND NOT EXISTS(SELECT FROM public.wire_resistance_claims) AND NOT EXISTS(SELECT FROM public.observation_reference_spans));
END $$;
CREATE FUNCTION pg_temp.wire_reference_refused(label text,p jsonb,reason text) RETURNS void LANGUAGE plpgsql AS $$ DECLARE q jsonb; BEGIN
 q:=public.qualify_wire_resistance_reference(p);
 PERFORM pg_temp.ok(label,q->>'ok'='false' AND q->>'reason'=reason);
END $$;
SELECT pg_temp.wire_reference_refused('caller cannot supply a numeric value',test_wire_resistance_fixture()||'{"value":60}','reading_shape');
SELECT pg_temp.wire_reference_refused('caller cannot supply a vehicle',test_wire_resistance_fixture()||'{"vehicle_id":"10000000-0000-0000-0000-000000000001"}','reading_shape');
SELECT pg_temp.wire_reference_refused('caller cannot supply temperature',test_wire_resistance_fixture()||'{"conductor_temperature_c":150}','reading_shape');
SELECT pg_temp.wire_reference_refused('unknown source unit is never defaulted',test_wire_resistance_fixture('2','awg'),'reading_shape');
SELECT pg_temp.wire_reference_refused('other wire family is not substituted',test_wire_resistance_fixture()||'{"wire_specification_id":"73000000-0000-0000-0000-000000000002"}','wire_family_unqualified');
SELECT pg_temp.wire_reference_refused('stale source revision held',test_wire_resistance_fixture()||jsonb_build_object('reference_revision',repeat('b',64)),'reference_not_current');
SELECT pg_temp.wire_reference_refused('missing unit/temperature witness held',jsonb_set(test_wire_resistance_fixture(),'{citations}',(test_wire_resistance_fixture()->'citations')-3),'four_citation_roles_required');
BEGIN;
UPDATE public.document_pages SET extracted_text=replace(extracted_text,'M22759/16-01-* 1/0','M22759/16-01-* 1');
UPDATE wire_reference_fixture_rows SET source_row=replace(source_row,'M22759/16-01-* 1/0','M22759/16-01-* 1') WHERE size_code='01';
SELECT pg_temp.refresh_wire_reference_fixture();
SELECT pg_temp.wire_reference_refused('military01 is not1AWG',test_wire_resistance_fixture('01'),'size_code_conflict');
ROLLBACK;
BEGIN;
UPDATE public.document_pages SET extracted_text=replace(extracted_text,') 2-fixture',') 1-fixture');
UPDATE wire_reference_fixture_rows SET source_row=replace(source_row,') 2-fixture',') 1-fixture') WHERE size_code='2';
SELECT pg_temp.refresh_wire_reference_fixture();
SELECT pg_temp.wire_reference_refused('manufacturer part/gauge mismatch held',test_wire_resistance_fixture(),'manufacturer_part_gauge_conflict');
ROLLBACK;
BEGIN;
UPDATE public.reference_documents SET source_capture=source_capture-'retrieved_at'-'retrieved_day';
SELECT pg_temp.wire_reference_refused('missing capture clock held',test_wire_resistance_fixture(),'reading_clock');
ROLLBACK;
BEGIN;
UPDATE storage.buckets SET public=false;
SELECT pg_temp.wire_reference_refused('private source held',test_wire_resistance_fixture(),'reference_not_current');
ROLLBACK;
BEGIN;
UPDATE public.observation_properties SET namespace='pending' WHERE property_key='wire_dc_resistance_per_length';
SELECT pg_temp.wire_reference_refused('unratified property held',test_wire_resistance_fixture(),'property_not_registered');
ROLLBACK;
-- Validate the actual typed row shape by value, without creating testimony.
DO $$ DECLARE q jsonb; typed public.vehicle_observations; bad public.vehicle_observations; k text; BEGIN
 q:=public.qualify_wire_resistance_reference(test_wire_resistance_fixture());
 SELECT * INTO typed FROM jsonb_populate_record(NULL::public.vehicle_observations,q->'recipe');
 PERFORM pg_temp.ok('typed canonical observation recipe passes the shared source binding',
  public.wire_resistance_observation_binding(typed)->>'ok'='true');
 FOREACH k IN ARRAY ARRAY['source_id','property_id','source_identifier','content_hash','citation_document_id','citation_page_number',
  'citation_excerpt','confidence_score','rank','vehicle_id','subject_id','structured_data'] LOOP
  SELECT * INTO bad FROM jsonb_populate_record(NULL::public.vehicle_observations,
   (q->'recipe')||jsonb_build_object(k,CASE WHEN k IN('confidence_score','citation_page_number') THEN '0'::jsonb
    WHEN k='structured_data' THEN '{}'::jsonb WHEN k IN('source_id','property_id','citation_document_id','vehicle_id','subject_id')
    THEN to_jsonb('73000000-0000-0000-0000-000000000099'::text) ELSE to_jsonb('tampered'::text) END));
  PERFORM pg_temp.ok('typed source receipt rejects altered '||k,public.wire_resistance_observation_binding(bad)->>'ok'='false');
 END LOOP;
 PERFORM pg_temp.ok('binding checks leave the observation table empty',NOT EXISTS(SELECT FROM public.vehicle_observations));
END $$;
SELECT pg_temp.ok('internal numerical source functions remain service-only',
 NOT has_function_privilege('anon','public.qualify_wire_resistance_reference(jsonb)','EXECUTE')
 AND NOT has_function_privilege('authenticated','public.project_wire_resistance_reference(uuid)','EXECUTE')
 AND has_function_privilege('service_role','public.qualify_wire_resistance_reference(jsonb)','EXECUTE'));
SELECT 'PASS: conditioned numerical reference recipes from cited source columns, no raw observation fixtures' AS result;
