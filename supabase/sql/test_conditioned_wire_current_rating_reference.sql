\set ON_ERROR_STOP on
-- Disposable metadata/source contract. Never INSERT numerical observations.
-- Actual retained manufacturer bytes are separately assayed and runtime intake
-- must use the canonical protected HTTP producer after normal deployment.
\i supabase/sql/test_wire_current_rating_vocabulary.sql
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
-- Match the deployed predecessor constraint, so a typed recipe alone cannot
-- conceal an inadmissible clock basis. No observation INSERT is needed.
ALTER TABLE public.vehicle_observations ADD CONSTRAINT vehicle_observations_clock_basis_check CHECK (
 observed_at_basis IS NULL OR observed_at_basis IN
  ('event_time','source_capture_time','source_publication_time')
) NOT VALID;
\i supabase/migrations/20261126094848_conditioned_wire_reference_intake.sql
-- Exact existing append-only implementation; no permissive trigger stub.
CREATE OR REPLACE FUNCTION public.vein_append_only()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  RAISE EXCEPTION '% is append-only: register a new version or append a new run', TG_TABLE_NAME;
END;
$function$;
\i supabase/migrations/20261126220938_conditioned_wire_current_rating_intake.sql
-- Synthetic metadata uses the closed profile identity solely to exercise its
-- interpreter in this disposable database. It is not a retained production PDF.
UPDATE storage.objects SET name='supplied/fc99c1dee1ea5336806d070b53a115127d153c6cf3cb9f7759b8fce6314c251e.pdf',
 user_metadata=jsonb_build_object('sha256','fc99c1dee1ea5336806d070b53a115127d153c6cf3cb9f7759b8fce6314c251e','source_role','public_reference');
UPDATE reference_documents SET page_count=51,file_hash='fc99c1dee1ea5336806d070b53a115127d153c6cf3cb9f7759b8fce6314c251e',
 file_path='reference-docs/supplied/fc99c1dee1ea5336806d070b53a115127d153c6cf3cb9f7759b8fce6314c251e.pdf',
 source_url='https://assets.motec.com.au/strapi/PDM_User_Manual_3a926f869d.pdf';
CREATE TABLE current_rating_fixture_context(family text,maximum text,headings text,qualifications text,read_at timestamptz);
INSERT INTO current_rating_fixture_context VALUES(E'M22759/16\nConductor: Tin Plated Copper','Maximum Temperature: 150 °C',
 E'Wire  Current Rating   Current Rating    Resistance Resistance\nGauge at 80 °C ambient at 100 °C ambient [ohm/m] [ohm/1000 ft]\n[A]* [A]*',
 E'*The current ratings above are an indication only for this synthetic contract.\n‡current rating for a single wire in free air',now());
CREATE TABLE current_rating_fixture_rows(gauge int PRIMARY KEY,row_text text,at80 numeric,at100 numeric);
INSERT INTO current_rating_fixture_rows VALUES(2,'2# 150‡ 120‡ 0.1 0.2',150,120),(4,'4# 120‡ 100‡ 0.1 0.2',120,100),(6,'6# 90‡ 75‡ 0.1 0.2',90,75);
UPDATE document_pages SET page_number=51,extraction_notes='48',extracted_text=(SELECT family||E'\n'||maximum||E'\n'||headings||E'\n'||
 (SELECT string_agg(row_text,E'\n' ORDER BY gauge) FROM current_rating_fixture_rows)||E'\n'||qualifications FROM current_rating_fixture_context);
CREATE FUNCTION pg_temp.refresh_current_rating_fixture() RETURNS void LANGUAGE plpgsql AS $$ DECLARE pages jsonb; rev text; BEGIN
 SELECT jsonb_agg(jsonb_build_object('page_number',page_number,'printed_label',extraction_notes,'extracted_text',extracted_text,
 'has_diagrams',has_diagrams) ORDER BY page_number) INTO pages FROM document_pages;
 SELECT encode(extensions.digest(jsonb_build_object('document',jsonb_build_object('title',r.title,'category',r.category,'source_url',r.source_url,
 'pdf_sha256',r.file_hash,'page_count',r.page_count),'pages',pages,'object_id',o.id,'object_version',o.version)::text,'sha256'),'hex')
 INTO rev FROM reference_documents r CROSS JOIN storage.objects o;
 UPDATE reference_documents SET source_capture=source_capture||jsonb_build_object('revision',rev,
 'pages_sha256',encode(extensions.digest(pages::text,'sha256'),'hex'),'retrieved_at',now()-interval '1 hour','retrieved_day',current_date::text);
END $$;
SELECT pg_temp.refresh_current_rating_fixture();
CREATE FUNCTION pg_temp.current_rating_reading(p_gauge int DEFAULT 2,p_ambient numeric DEFAULT 80) RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT jsonb_build_object('profile','motec_m22759_16_current_rating_v1','wire_specification_id','73000000-0000-0000-0000-000000000001',
 'document_id',d.id,'reference_revision',d.source_capture->>'revision','file_sha256',d.file_hash,'ambient_temperature_c',p_ambient,
 'reader',jsonb_build_object('method','synthetic_source_contract','model','fixture','run_id','current-rating-contract'),'read_at',f.read_at,
 'citations',jsonb_build_array(
 jsonb_build_object('role','wire_family','page_id',p.id,'excerpt',f.family),
 jsonb_build_object('role','maximum_temperature','page_id',p.id,'excerpt',f.maximum),
 jsonb_build_object('role','column_headings','page_id',p.id,'excerpt',f.headings),
 jsonb_build_object('role','value_row','page_id',p.id,'excerpt',r.row_text),
 jsonb_build_object('role','rating_qualifications','page_id',p.id,'excerpt',f.qualifications)))
 FROM reference_documents d JOIN document_pages p ON p.document_id=d.id CROSS JOIN current_rating_fixture_context f
 CROSS JOIN current_rating_fixture_rows r WHERE r.gauge=p_gauge
$$;
DO $$ DECLARE r record; q jsonb; recipe jsonb; changed jsonb; field text; a numeric; expected numeric; BEGIN
 FOR r IN SELECT * FROM current_rating_fixture_rows LOOP
  FOREACH a IN ARRAY ARRAY[80,100]::numeric[] LOOP
   expected:=CASE a WHEN 80 THEN r.at80 ELSE r.at100 END;
   q:=public.qualify_wire_current_rating_reference(pg_temp.current_rating_reading(r.gauge,a));recipe:=q->'recipe';
   PERFORM pg_temp.ok('six source cells preserve distinct ambient and maximum temperatures',q->>'ok'='true'
    AND (recipe#>>'{structured_data,wire_published_current_rating}')::numeric=expected
    AND (q#>>'{condition,gauge_awg}')::int=r.gauge AND (q#>>'{condition,ambient_temperature_c}')::numeric=a
    AND q#>>'{condition,maximum_wire_temperature_c}'='150' AND q#>>'{condition,duty_basis}'='source_unspecified'
    AND q#>>'{condition,value_role}'='published_indicative' AND q#>>'{condition,installation_condition}'='single_wire_in_free_air'
    AND recipe#>>'{structured_data,actual_conductor_temperature}'='unestablished'
    AND recipe#>>'{structured_data,applicability_status}'='unassessed' AND jsonb_array_length(q->'citations')=5);
   PERFORM pg_temp.ok('exact recipe binds the typed observation without inserting it',
    public.wire_current_rating_observation_binding(jsonb_populate_record(NULL::vehicle_observations,recipe))->>'ok'='true');
  END LOOP;
 END LOOP;
 recipe:=public.qualify_wire_current_rating_reference(pg_temp.current_rating_reading())->'recipe';
 FOREACH field IN ARRAY ARRAY['vehicle_id','property_id','source_id','extraction_method','source_identifier','observed_at_basis','analysis_deferred','confidence_score','content_text','structured_data'] LOOP
  changed:=recipe||jsonb_build_object(field,CASE field
   WHEN 'vehicle_id' THEN to_jsonb('73000000-0000-0000-0000-000000000001'::text)
   WHEN 'property_id' THEN to_jsonb('73000000-0000-0000-0000-000000000001'::text)
   WHEN 'source_id' THEN to_jsonb('73000000-0000-0000-0000-000000000001'::text)
   WHEN 'analysis_deferred' THEN 'false'::jsonb WHEN 'confidence_score' THEN '1'::jsonb
   WHEN 'structured_data' THEN recipe->'structured_data'||'{"owner_confirmed":true}'::jsonb ELSE '"altered"'::jsonb END);
  q:=public.wire_current_rating_observation_binding(jsonb_populate_record(NULL::vehicle_observations,changed));
  PERFORM pg_temp.ok('mutated recipe field refused: '||field,q->>'ok'='false' AND q->>'reason'='observation_field_mismatch');
 END LOOP;
 PERFORM pg_temp.ok('equivalent numeric ambient scales retain one identity',
  public.qualify_wire_current_rating_reference(pg_temp.current_rating_reading(2,80))#>>'{recipe,content_hash}'=
  public.qualify_wire_current_rating_reference(pg_temp.current_rating_reading(2,80.000))#>>'{recipe,content_hash}');
END $$;
CREATE FUNCTION pg_temp.current_rating_refused(p_reading jsonb,p_reason text) RETURNS void LANGUAGE plpgsql AS $$ DECLARE q jsonb; BEGIN
 q:=public.qualify_wire_current_rating_reference(p_reading);
 PERFORM pg_temp.ok('source refusal: '||p_reason,q->>'ok'='false' AND q->>'reason'=p_reason);
END $$;
SELECT pg_temp.current_rating_refused(pg_temp.current_rating_reading(2,90),'source_ambient_column_unavailable');
SELECT pg_temp.current_rating_refused(pg_temp.current_rating_reading()||'{"ambient_temperature_c":"80"}','reading_shape');
SELECT pg_temp.current_rating_refused(pg_temp.current_rating_reading()||'{"current_a":999}','reading_shape');
SELECT pg_temp.current_rating_refused(pg_temp.current_rating_reading()||jsonb_build_object('read_at','infinity'),'reading_clock');
SELECT pg_temp.current_rating_refused(pg_temp.current_rating_reading()||jsonb_build_object('read_at',now()+interval '1 day'),'reading_clock');
SELECT pg_temp.current_rating_refused(pg_temp.current_rating_reading()||jsonb_build_object('wire_specification_id','73000000-0000-0000-0000-000000000002'),'wire_family_unqualified');
SELECT pg_temp.current_rating_refused(pg_temp.current_rating_reading()||jsonb_build_object('reference_revision',repeat('b',64)),'reference_not_current');
SELECT pg_temp.current_rating_refused(jsonb_set(pg_temp.current_rating_reading(),'{citations,3,excerpt}','"2# 999‡ 999‡ 0.1 0.2"'),'citation_not_verbatim');
SELECT pg_temp.current_rating_refused(jsonb_set(pg_temp.current_rating_reading(),'{citations,4,excerpt}','"‡current rating for a single wire in free air"'),'table_context_unqualified');
SELECT pg_temp.current_rating_refused(jsonb_set(pg_temp.current_rating_reading(),'{citations}',(pg_temp.current_rating_reading()->'citations')-4),'five_citation_roles_required');
BEGIN;
UPDATE reference_documents SET superseded_by=id;
SELECT pg_temp.current_rating_refused(pg_temp.current_rating_reading(),'reference_not_current');
ROLLBACK;
BEGIN;
UPDATE document_pages SET extracted_text=extracted_text||' changed';
SELECT pg_temp.current_rating_refused(pg_temp.current_rating_reading(),'reference_not_current');
ROLLBACK;
SELECT pg_temp.ok('private ACLs deny public source interpretation and direct projection writes',
 NOT has_function_privilege('anon','public.qualify_wire_current_rating_reference(jsonb)','EXECUTE')
 AND NOT has_function_privilege('authenticated','public.wire_current_rating_reference_evidence(uuid)','EXECUTE')
 AND NOT has_table_privilege('anon','public.wire_current_rating_conditions','SELECT')
 AND NOT has_table_privilege('service_role','public.wire_current_rating_claims','INSERT')
 AND NOT has_table_privilege('service_role','public.wire_current_rating_conditions','UPDATE')
 AND has_function_privilege('service_role','public.project_wire_current_rating_reference(uuid)','EXECUTE'));
SELECT pg_temp.ok('child tables have RLS and append-only triggers',
 (SELECT count(*)=2 AND bool_and(relrowsecurity) FROM pg_class WHERE oid IN('wire_current_rating_conditions'::regclass,'wire_current_rating_claims'::regclass))
 AND (SELECT count(*)=2 FROM pg_trigger WHERE tgname IN('wire_current_rating_conditions_immutable','wire_current_rating_claims_immutable') AND NOT tgisinternal));
SET ROLE anon;
DO $$ BEGIN
 BEGIN PERFORM public.qualify_wire_current_rating_reference('{}');RAISE EXCEPTION 'anonymous qualifier unexpectedly allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM * FROM public.wire_current_rating_conditions;RAISE EXCEPTION 'anonymous source rows unexpectedly exposed';
 EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
RESET ROLE;
SET request.jwt.claim.role='authenticated';
DO $$ BEGIN
 BEGIN PERFORM public.project_wire_current_rating_reference('00000000-0000-0000-0000-000000000000');RAISE EXCEPTION 'nonservice projection unexpectedly allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
SET request.jwt.claim.role='service_role';
DO $$ BEGIN
 BEGIN PERFORM public.project_wire_current_rating_reference('00000000-0000-0000-0000-000000000000');RAISE EXCEPTION 'missing observation unexpectedly projected';
 EXCEPTION WHEN check_violation THEN NULL;END;
END $$;
SELECT pg_temp.ok('pure source contract creates zero numerical observations or projections',
 NOT EXISTS(SELECT FROM vehicle_observations) AND NOT EXISTS(SELECT FROM wire_current_rating_conditions)
 AND NOT EXISTS(SELECT FROM wire_current_rating_claims) AND NOT EXISTS(SELECT FROM observation_reference_spans)
 AND public.wire_current_rating_reference_evidence('00000000-0000-0000-0000-000000000000') IS NULL);
SELECT 'PASS: conditioned current-rating source recipe, exact observation binding, withdrawal and private boundaries; zero numerical testimony fixtures' AS result;
