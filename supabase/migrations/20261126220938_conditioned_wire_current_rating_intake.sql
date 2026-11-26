-- Protected source-class current-rating intake. Registered observations own
-- values; typed children retain conditions and exact public-reference witnesses.
-- No installed-wire, stock, thermal applicability or engineering release.
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='2s';
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM public.observation_properties WHERE property_key='wire_published_current_rating'
  AND namespace='core' AND deprecated_at IS NULL AND ratified_at IS NOT NULL AND data_type='numeric'
  AND unit='A' AND verification_scope='class' AND cardinality='multi'
  AND discriminator_key='wire_current_rating_condition_key') THEN
  RAISE EXCEPTION 'Ratified conditioned-current vocabulary required before numerical intake';
 END IF;
 IF to_regclass('public.observation_reference_spans') IS NULL
 OR to_regprocedure('public.reference_document_evidence(uuid)') IS NULL THEN
  RAISE EXCEPTION 'Existing retained-reference and shared-span owners required';
 END IF;
END $$;
CREATE FUNCTION public.wire_current_rating_condition_key(p_spec uuid,p_document uuid,p_awg integer,p_ambient numeric,p_maximum numeric,p_installation text,p_role text,p_duty text)
RETURNS text LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog AS $$
 SELECT 'wire-current:v1:'||p_spec||':doc='||p_document||':awg='||p_awg||':ambientC='||trim_scale(p_ambient)
  ||':maximumC='||trim_scale(p_maximum)||':installation='||p_installation||':role='||p_role||':duty='||p_duty
$$;
REVOKE ALL ON FUNCTION public.wire_current_rating_condition_key(uuid,uuid,integer,numeric,numeric,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.wire_current_rating_condition_key(uuid,uuid,integer,numeric,numeric,text,text,text) TO service_role;
CREATE TABLE public.wire_current_rating_conditions(
 condition_key text PRIMARY KEY,
 wire_specification_id uuid NOT NULL REFERENCES public.wire_specifications(id),
 reference_document_id uuid NOT NULL REFERENCES public.reference_documents(id),
 gauge_awg integer NOT NULL CHECK(gauge_awg BETWEEN -3 AND 40),
 ambient_temperature_c numeric NOT NULL CHECK(ambient_temperature_c BETWEEN -273.15 AND 500),
 maximum_wire_temperature_c numeric NOT NULL CHECK(maximum_wire_temperature_c BETWEEN -273.15 AND 500),
 installation_condition text NOT NULL CHECK(installation_condition='single_wire_in_free_air'),
 value_role text NOT NULL CHECK(value_role='published_indicative'),
 duty_basis text NOT NULL CHECK(duty_basis='source_unspecified'),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(maximum_wire_temperature_c>ambient_temperature_c),
 UNIQUE(wire_specification_id,reference_document_id,gauge_awg,ambient_temperature_c,maximum_wire_temperature_c,installation_condition,value_role,duty_basis),
 UNIQUE(condition_key,reference_document_id),
 CHECK(condition_key=public.wire_current_rating_condition_key(wire_specification_id,reference_document_id,gauge_awg,ambient_temperature_c,maximum_wire_temperature_c,installation_condition,value_role,duty_basis))
);
CREATE TABLE public.wire_current_rating_claims(
 observation_id uuid PRIMARY KEY REFERENCES public.vehicle_observations(id),
 condition_key text NOT NULL,
 document_id uuid NOT NULL REFERENCES public.reference_documents(id),
 reference_revision text NOT NULL CHECK(reference_revision ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(condition_key,document_id) REFERENCES public.wire_current_rating_conditions(condition_key,reference_document_id)
);
CREATE INDEX wire_current_rating_claims_condition ON public.wire_current_rating_claims(condition_key,observation_id);
CREATE INDEX wire_current_rating_claims_document ON public.wire_current_rating_claims(document_id,observation_id);
ALTER TABLE public.wire_current_rating_conditions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wire_current_rating_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wire_current_rating_conditions,public.wire_current_rating_claims FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.wire_current_rating_conditions,public.wire_current_rating_claims TO service_role;
CREATE TRIGGER wire_current_rating_conditions_immutable BEFORE UPDATE OR DELETE ON public.wire_current_rating_conditions FOR EACH ROW EXECUTE FUNCTION public.vein_append_only();
CREATE TRIGGER wire_current_rating_claims_immutable BEFORE UPDATE OR DELETE ON public.wire_current_rating_claims FOR EACH ROW EXECUTE FUNCTION public.vein_append_only();

CREATE FUNCTION public.qualify_wire_current_rating_reference(p_reading jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public SET timezone='UTC' SET statement_timeout='10s' AS $fn$
DECLARE spec public.wire_specifications%ROWTYPE; prop public.observation_properties%ROWTYPE;
 d public.reference_documents%ROWTYPE; page public.document_pages%ROWTYPE; evidence jsonb; source_id uuid;
 c jsonb; role text; seen text[]:='{}'; texts jsonb:='{}'; positions jsonb:='{}'; citations jsonb:='[]'; page_id uuid;
 at_pos integer; parts text[]; maximum_parts text[]; ambient numeric; maximum numeric; gauge integer; source_token text;
 current_a numeric; read_at timestamptz; ck text; canon jsonb; fields jsonb; fingerprint text; identity_hash text; recipe jsonb;
 value_page integer; value_excerpt text;
BEGIN
 IF jsonb_typeof(p_reading) IS DISTINCT FROM 'object'
 OR EXISTS(SELECT FROM jsonb_object_keys(p_reading) k WHERE k<>ALL(ARRAY[
  'profile','wire_specification_id','document_id','reference_revision','file_sha256','ambient_temperature_c','reader','read_at','citations']))
 OR p_reading->>'profile' IS DISTINCT FROM 'motec_m22759_16_current_rating_v1'
 OR jsonb_typeof(p_reading->'ambient_temperature_c') IS DISTINCT FROM 'number'
 OR jsonb_typeof(p_reading->'reader') IS DISTINCT FROM 'object'
 OR EXISTS(SELECT FROM jsonb_object_keys(p_reading->'reader') k WHERE k<>ALL(ARRAY['method','model','run_id']))
 OR EXISTS(SELECT FROM jsonb_object_keys(p_reading->'reader') k WHERE jsonb_typeof(p_reading->'reader'->k) IS DISTINCT FROM 'string')
 OR length(coalesce(p_reading#>>'{reader,method}','')) NOT BETWEEN 1 AND 100
 OR length(coalesce(p_reading#>>'{reader,model}','')) NOT BETWEEN 1 AND 100
 OR length(coalesce(p_reading#>>'{reader,run_id}','')) NOT BETWEEN 1 AND 150
 OR jsonb_typeof(p_reading->'read_at') IS DISTINCT FROM 'string'
 OR jsonb_typeof(p_reading->'citations') IS DISTINCT FROM 'array'
 THEN RETURN jsonb_build_object('ok',false,'reason','reading_shape'); END IF;
 IF jsonb_array_length(p_reading->'citations')<>5 THEN RETURN jsonb_build_object('ok',false,'reason','five_citation_roles_required'); END IF;
 ambient:=(p_reading->>'ambient_temperature_c')::numeric;
 IF ambient NOT IN(80,100) THEN RETURN jsonb_build_object('ok',false,'reason','source_ambient_column_unavailable'); END IF;
 SELECT * INTO spec FROM public.wire_specifications WHERE id=(p_reading->>'wire_specification_id')::uuid
  AND wire_type='MIL-W-22759/16' AND mil_spec_reference='MIL-W-22759/16';
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'reason','wire_family_unqualified'); END IF;
 SELECT * INTO prop FROM public.observation_properties WHERE property_key='wire_published_current_rating'
  AND namespace='core' AND deprecated_at IS NULL AND ratified_at IS NOT NULL AND data_type='numeric' AND unit='A'
  AND verification_scope='class' AND cardinality='multi' AND discriminator_key='wire_current_rating_condition_key'
  AND 'specification'::public.observation_kind=ANY(applies_to_kinds)
  AND 'documentation'::public.source_category=ANY(expected_source_categories);
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'reason','property_not_registered'); END IF;
 SELECT id INTO source_id FROM public.observation_sources WHERE slug='component-maker-documentation' AND category='documentation';
 IF source_id IS NULL THEN RETURN jsonb_build_object('ok',false,'reason','source_not_registered'); END IF;
 SELECT * INTO d FROM public.reference_documents WHERE id=(p_reading->>'document_id')::uuid;
 evidence:=public.reference_document_evidence(d.id);
 IF evidence IS NULL OR p_reading->>'reference_revision' IS DISTINCT FROM evidence->>'reference_revision'
  OR p_reading->>'file_sha256' IS DISTINCT FROM evidence->>'file_sha256' THEN
  RETURN jsonb_build_object('ok',false,'reason','reference_not_current'); END IF;
 -- This parser is deliberately bound to the actually reviewed manufacturer PDF.
 -- Other editions, thermal tables and larger gauges need their own source proof.
 IF d.file_hash<>'fc99c1dee1ea5336806d070b53a115127d153c6cf3cb9f7759b8fce6314c251e'
 OR d.source_url<>'https://assets.motec.com.au/strapi/PDM_User_Manual_3a926f869d.pdf'
 THEN RETURN jsonb_build_object('ok',false,'reason','source_profile_unqualified'); END IF;
 read_at:=(p_reading->>'read_at')::timestamptz;
 IF isfinite(read_at) IS DISTINCT FROM true OR read_at>current_timestamp+interval '5 minutes'
 OR (read_at>=coalesce((d.source_capture->>'retrieved_at')::timestamptz,(d.source_capture->>'retrieved_day')::date::timestamptz)) IS DISTINCT FROM true
 THEN RETURN jsonb_build_object('ok',false,'reason','reading_clock'); END IF;
 FOR c IN SELECT value FROM jsonb_array_elements(p_reading->'citations') LOOP
  role:=c->>'role';
  IF jsonb_typeof(c) IS DISTINCT FROM 'object' OR EXISTS(SELECT FROM jsonb_object_keys(c) k WHERE k<>ALL(ARRAY['role','page_id','excerpt']))
  OR coalesce(role,'') NOT IN('wire_family','maximum_temperature','column_headings','value_row','rating_qualifications') OR role=ANY(seen)
  OR jsonb_typeof(c->'excerpt') IS DISTINCT FROM 'string' OR length(coalesce(c->>'excerpt','')) NOT BETWEEN 1 AND 4000
  THEN RETURN jsonb_build_object('ok',false,'reason','citation_shape'); END IF;
  SELECT * INTO page FROM public.document_pages WHERE id=(c->>'page_id')::uuid AND document_id=d.id
   AND page_number=51 AND extraction_method='supplied_visual_reference_v1';
  IF NOT FOUND OR(page_id IS NOT NULL AND page.id<>page_id) THEN RETURN jsonb_build_object('ok',false,'reason','citation_page_scope'); END IF;
  page_id:=page.id;at_pos:=strpos(page.extracted_text,c->>'excerpt');
  IF at_pos=0 THEN RETURN jsonb_build_object('ok',false,'reason','citation_not_verbatim'); END IF;
  seen:=array_append(seen,role);texts:=texts||jsonb_build_object(role,c->>'excerpt');positions:=positions||jsonb_build_object(role,at_pos);
  citations:=citations||jsonb_build_object('role',role,'page_id',page.id,'quote_start',at_pos-1,'quote_length',length(c->>'excerpt'),
   'page_text_sha256',encode(extensions.digest(page.extracted_text,'sha256'),'hex'));
  IF role='value_row' THEN value_page:=page.page_number;value_excerpt:=c->>'excerpt'; END IF;
 END LOOP;
 IF NOT((positions->>'wire_family')::int<(positions->>'maximum_temperature')::int
  AND(positions->>'maximum_temperature')::int<(positions->>'column_headings')::int
  AND(positions->>'column_headings')::int<(positions->>'value_row')::int
  AND(positions->>'value_row')::int<(positions->>'rating_qualifications')::int)
 OR split_part(btrim(texts->>'wire_family'),E'\n',1)<>'M22759/16'
 OR texts->>'wire_family' !~ 'Conductor:[[:blank:]]+Tin Plated Copper'
 OR texts->>'column_headings' !~ '^Wire[[:blank:]]+Current Rating[[:blank:]]+Current Rating[[:blank:]]+Resistance Resistance'
 OR texts->>'column_headings' !~ 'at 80 °C ambient at 100 °C ambient'
 OR texts->>'column_headings' !~ '\[A\]\*'
 OR texts->>'rating_qualifications' !~ '^\*The current ratings above are an indication only'
 OR right(btrim(texts->>'rating_qualifications'),length('‡current rating for a single wire in free air'))<>'‡current rating for a single wire in free air'
 THEN RETURN jsonb_build_object('ok',false,'reason','table_context_unqualified'); END IF;
 parts:=regexp_match(btrim(value_excerpt),'^([246])#[[:blank:]]+([0-9]+)‡[[:blank:]]+([0-9]+)‡[[:blank:]]+[0-9.]+[[:blank:]]+[0-9.]+$');
 maximum_parts:=regexp_match(btrim(texts->>'maximum_temperature'),'^Maximum Temperature:[[:blank:]]*([0-9]+)[[:blank:]]*[°][[:blank:]]*C$');
 IF parts IS NULL OR maximum_parts IS NULL THEN RETURN jsonb_build_object('ok',false,'reason','table_format_unqualified'); END IF;
 gauge:=parts[1]::integer;maximum:=maximum_parts[1]::numeric;
 source_token:=parts[CASE ambient WHEN 80 THEN 2 ELSE 3 END];current_a:=source_token::numeric;
 IF maximum<=ambient OR maximum>500 OR current_a<=0 THEN RETURN jsonb_build_object('ok',false,'reason','source_quantity_range'); END IF;
 ck:=public.wire_current_rating_condition_key(spec.id,d.id,gauge,ambient,maximum,'single_wire_in_free_air','published_indicative','source_unspecified');
 SELECT jsonb_agg(value ORDER BY value->>'role') INTO citations FROM jsonb_array_elements(citations);
 SELECT jsonb_agg(jsonb_build_object('role',value->>'role','page_id',(value->>'page_id')::uuid,'excerpt',value->>'excerpt') ORDER BY value->>'role')
 INTO canon FROM jsonb_array_elements(p_reading->'citations');
 canon:=(p_reading-'citations'-'read_at')||jsonb_build_object('citations',canon,'read_at',read_at,'wire_specification_id',spec.id,'document_id',d.id,'ambient_temperature_c',trim_scale(ambient));
 fingerprint:=encode(extensions.digest(pg_get_functiondef('public.qualify_wire_current_rating_reference(jsonb)'::regprocedure)
  ||pg_get_functiondef('public.wire_current_rating_condition_key(uuid,uuid,integer,numeric,numeric,text,text,text)'::regprocedure),'sha256'),'hex');
 fields:=jsonb_build_object('definition_role','published_wire_current_rating','applicability_status','unassessed','installed_state','unestablished',
  'wire_current_rating_condition_key',ck,'wire_published_current_rating',current_a,'wire_current_rating_reference_input',canon,
  'wire_current_rating_profile_fingerprint',fingerprint,'source_value_token',source_token,'source_value_unit','A','source_footnote_marker','‡',
  'actual_conductor_temperature','unestablished','normalization_version','ampere_identity_v1');
 identity_hash:=encode(extensions.digest(jsonb_build_object('reading',canon-'reader'-'read_at','profile_fingerprint',fingerprint,'property_id',prop.id,'condition_key',ck)::text,'sha256'),'hex');
 recipe:=jsonb_build_object('vehicle_id',NULL,'subject_id',NULL,'subject_type','vehicle','subject_organization_id',NULL,
  'source_observation_id',NULL,'component_subject_id',NULL,'source_id',source_id,'kind','specification','property_id',prop.id,
  'observed_at',read_at,'observed_at_basis','source_analysis_time','source_event_time_precision','unknown','source_event_at',NULL,
  'source_url',d.source_url,'source_identifier','wire-current-rating:'||identity_hash,'content_hash',identity_hash,
  'content_text',value_excerpt,'structured_data',fields,'observer_raw',jsonb_build_object('reader',p_reading->'reader'),
  'extraction_method','supplied_wire_current_rating_v1','raw_source_ref','sha256:'||d.file_hash,'analysis_deferred',true,
  'confidence','medium','confidence_score',0.6,'rank','normal','descriptor_id',NULL,'citation_document_id',d.id,
  'citation_secure_document_id',NULL,'citation_page_number',value_page,'citation_excerpt',value_excerpt,'is_superseded',false,
  'superseded_by',NULL,'agent_model',p_reading#>>'{reader,model}');
 RETURN jsonb_build_object('ok',true,'recipe',recipe,'condition',jsonb_build_object('condition_key',ck,'wire_specification_id',spec.id,
  'reference_document_id',d.id,'gauge_awg',gauge,'ambient_temperature_c',ambient,'maximum_wire_temperature_c',maximum,
  'installation_condition','single_wire_in_free_air','value_role','published_indicative','duty_basis','source_unspecified'),
  'source',evidence,'citations',citations,'scope','attributed_material_class_reference','model_calls',0);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR invalid_parameter_value
 OR invalid_datetime_format OR datetime_field_overflow THEN RETURN jsonb_build_object('ok',false,'reason','reading_value_invalid');
END $fn$;
REVOKE ALL ON FUNCTION public.qualify_wire_current_rating_reference(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.qualify_wire_current_rating_reference(jsonb) TO service_role;

CREATE FUNCTION public.wire_current_rating_observation_binding(p_observation public.vehicle_observations)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public SET timezone='UTC' SET statement_timeout='10s' AS $fn$
DECLARE q jsonb; item record;
BEGIN
 q:=public.qualify_wire_current_rating_reference(p_observation.structured_data->'wire_current_rating_reference_input');
 IF q->>'ok' IS DISTINCT FROM 'true' THEN RETURN q; END IF;
 FOR item IN SELECT key,value FROM jsonb_each(q->'recipe') LOOP
  IF to_jsonb(p_observation)->item.key IS DISTINCT FROM item.value THEN
   RETURN jsonb_build_object('ok',false,'reason','observation_field_mismatch','field',item.key);
  END IF;
 END LOOP;
 RETURN q;
END $fn$;
REVOKE ALL ON FUNCTION public.wire_current_rating_observation_binding(public.vehicle_observations) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.wire_current_rating_observation_binding(public.vehicle_observations) TO service_role;

CREATE FUNCTION public.guard_wire_current_rating_reference()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET timezone='UTC' AS $fn$
DECLARE q jsonb; old_reading boolean:=false; new_reading boolean;
BEGIN
 IF TG_OP='UPDATE' THEN
  old_reading:=OLD.extraction_method='supplied_wire_current_rating_v1' OR OLD.structured_data ? 'wire_current_rating_reference_input' OR EXISTS(
   SELECT FROM public.observation_properties p WHERE p.id=OLD.property_id AND p.property_key='wire_published_current_rating');
 END IF;
 new_reading:=NEW.extraction_method='supplied_wire_current_rating_v1' OR NEW.structured_data ? 'wire_current_rating_reference_input' OR EXISTS(
  SELECT FROM public.observation_properties p WHERE p.id=NEW.property_id AND p.property_key='wire_published_current_rating');
 IF NOT coalesce(old_reading,false) AND NOT coalesce(new_reading,false) THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' THEN
  IF EXISTS(SELECT FROM unnest(ARRAY['vehicle_id','subject_id','subject_type','subject_organization_id','source_observation_id',
   'component_subject_id','source_id','kind','property_id','observed_at','observed_at_basis','source_event_time_precision','source_event_at',
   'source_url','source_identifier','content_hash','content_text','structured_data','observer_raw','extraction_method','raw_source_ref',
   'analysis_deferred','confidence','confidence_score','rank','descriptor_id','citation_document_id','citation_secure_document_id',
   'citation_page_number','citation_excerpt','agent_model']) k WHERE to_jsonb(NEW)->k IS DISTINCT FROM to_jsonb(OLD)->k)
  THEN RAISE EXCEPTION 'Current-rating reference testimony is immutable; admit a successor' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 q:=public.wire_current_rating_observation_binding(NEW);
 IF q->>'ok' IS DISTINCT FROM 'true' THEN
  RAISE EXCEPTION 'Current-rating source binding refused: % (%)',q->>'reason',q->>'field' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.guard_wire_current_rating_reference() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER wire_current_rating_reference_guard BEFORE INSERT OR UPDATE ON public.vehicle_observations
 FOR EACH ROW EXECUTE FUNCTION public.guard_wire_current_rating_reference();

CREATE FUNCTION public.wire_current_rating_reference_evidence(p_observation_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public SET timezone='UTC' SET statement_timeout='10s' AS $fn$
DECLARE o public.vehicle_observations%ROWTYPE; q jsonb; c jsonb; reader_fingerprint text;
BEGIN
 SELECT * INTO o FROM public.vehicle_observations WHERE id=p_observation_id AND is_superseded IS FALSE
  AND superseded_by IS NULL AND extraction_method='supplied_wire_current_rating_v1';
 IF NOT FOUND THEN RETURN NULL; END IF;
 q:=public.wire_current_rating_observation_binding(o);
 IF q->>'ok' IS DISTINCT FROM 'true' THEN RETURN NULL; END IF;
 IF NOT EXISTS(SELECT FROM public.wire_current_rating_claims r JOIN public.wire_current_rating_conditions wc USING(condition_key)
  WHERE r.observation_id=o.id AND r.document_id=o.citation_document_id AND r.reference_revision=q#>>'{source,reference_revision}'
  AND to_jsonb(wc)-'created_at'=q->'condition') THEN RETURN NULL; END IF;
 IF(SELECT count(*) FROM public.observation_reference_spans WHERE observation_id=o.id)<>5 THEN RETURN NULL; END IF;
 FOR c IN SELECT value FROM jsonb_array_elements(q->'citations') LOOP
  IF NOT EXISTS(SELECT FROM public.observation_reference_spans r WHERE r.observation_id=o.id AND r.citation_role=c->>'role'
   AND r.page_id=(c->>'page_id')::uuid AND r.quote_start=(c->>'quote_start')::integer
   AND r.quote_length=(c->>'quote_length')::integer AND r.page_text_sha256=c->>'page_text_sha256') THEN RETURN NULL; END IF;
 END LOOP;
 reader_fingerprint:=encode(extensions.digest(pg_get_functiondef('public.wire_current_rating_reference_evidence(uuid)'::regprocedure)
  ||pg_get_functiondef('public.wire_current_rating_observation_binding(public.vehicle_observations)'::regprocedure)
  ||(q#>>'{recipe,structured_data,wire_current_rating_profile_fingerprint}'),'sha256'),'hex');
 RETURN jsonb_build_object('observation_id',o.id,'property_id',o.property_id,'property_key','wire_published_current_rating',
  'value',o.structured_data->'wire_published_current_rating','unit','A','condition',q->'condition','source',q->'source','citations',q->'citations',
  'source_value_token',o.structured_data->'source_value_token','source_value_unit','A','source_footnote_marker','‡',
  'normalization_version','ampere_identity_v1','reader_fingerprint',reader_fingerprint,'scope','attributed_material_class_reference',
  'applicability_status','unassessed','installed_state','unestablished','actual_conductor_temperature','unestablished');
END $fn$;
REVOKE ALL ON FUNCTION public.wire_current_rating_reference_evidence(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.wire_current_rating_reference_evidence(uuid) TO service_role;

CREATE FUNCTION public.project_wire_current_rating_reference(p_observation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public SET timezone='UTC' SET statement_timeout='10s' AS $fn$
DECLARE o public.vehicle_observations%ROWTYPE; q jsonb; c jsonb; ck text; evidence jsonb;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
 SELECT * INTO o FROM public.vehicle_observations WHERE id=p_observation_id AND is_superseded IS FALSE
  AND superseded_by IS NULL AND extraction_method='supplied_wire_current_rating_v1' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Current source observation required' USING ERRCODE='23514'; END IF;
 q:=public.wire_current_rating_observation_binding(o);
 IF q->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Current-rating source binding refused' USING ERRCODE='23514'; END IF;
 ck:=q#>>'{condition,condition_key}';
 INSERT INTO public.wire_current_rating_conditions(condition_key,wire_specification_id,reference_document_id,gauge_awg,
  ambient_temperature_c,maximum_wire_temperature_c,installation_condition,value_role,duty_basis)
 VALUES(ck,(q#>>'{condition,wire_specification_id}')::uuid,(q#>>'{condition,reference_document_id}')::uuid,
  (q#>>'{condition,gauge_awg}')::integer,(q#>>'{condition,ambient_temperature_c}')::numeric,
  (q#>>'{condition,maximum_wire_temperature_c}')::numeric,'single_wire_in_free_air','published_indicative','source_unspecified')
 ON CONFLICT DO NOTHING;
 INSERT INTO public.wire_current_rating_claims(observation_id,condition_key,document_id,reference_revision)
 VALUES(o.id,ck,o.citation_document_id,q#>>'{source,reference_revision}') ON CONFLICT DO NOTHING;
 FOR c IN SELECT value FROM jsonb_array_elements(q->'citations') LOOP
  INSERT INTO public.observation_reference_spans(observation_id,citation_role,page_id,quote_start,quote_length,page_text_sha256)
  VALUES(o.id,c->>'role',(c->>'page_id')::uuid,(c->>'quote_start')::integer,(c->>'quote_length')::integer,c->>'page_text_sha256') ON CONFLICT DO NOTHING;
 END LOOP;
 evidence:=public.wire_current_rating_reference_evidence(o.id);
 IF evidence IS NULL THEN RAISE EXCEPTION 'Current-rating projection no longer matches its source' USING ERRCODE='23514'; END IF;
 RETURN jsonb_build_object('success',true,'observation_id',o.id,'condition_key',ck,'current_source_verified',true,
  'scope','attributed_material_class_reference','model_calls',0);
END $fn$;
REVOKE ALL ON FUNCTION public.project_wire_current_rating_reference(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.project_wire_current_rating_reference(uuid) TO service_role;
COMMENT ON TABLE public.wire_current_rating_conditions IS 'One immutable source-defined wire-family/document/gauge/ambient/maximum-temperature/installation/role/duty context. No numerical rating or installed-wire identity; actual conductor temperature is unknown.';
COMMENT ON COLUMN public.wire_current_rating_conditions.condition_key IS 'Deterministic canonical context key; equivalent numeric scales share identity.';
COMMENT ON COLUMN public.wire_current_rating_conditions.wire_specification_id IS 'Existing wire-family class owner; not a physical stock lot or installed conductor.';
COMMENT ON COLUMN public.wire_current_rating_conditions.reference_document_id IS 'Retained public manufacturer document defining this condition.';
COMMENT ON COLUMN public.wire_current_rating_conditions.gauge_awg IS 'Source gauge in internal AWG integer notation; no absent-gauge interpolation.';
COMMENT ON COLUMN public.wire_current_rating_conditions.ambient_temperature_c IS 'Source ambient-temperature column in degrees Celsius; not conductor temperature.';
COMMENT ON COLUMN public.wire_current_rating_conditions.maximum_wire_temperature_c IS 'Published maximum permitted wire temperature in degrees Celsius; not an actual operating temperature.';
COMMENT ON COLUMN public.wire_current_rating_conditions.installation_condition IS 'Explicit source qualification: one wire in free air; no covered, bundled or routed application inferred.';
COMMENT ON COLUMN public.wire_current_rating_conditions.value_role IS 'Source declares these ratings indicative; no assessed installation ampacity.';
COMMENT ON COLUMN public.wire_current_rating_conditions.duty_basis IS 'Source does not establish duty; continuous-duty qualification remains unknown.';
COMMENT ON COLUMN public.wire_current_rating_conditions.created_at IS 'Projection admission time, not source publication, event or installation time.';
COMMENT ON TABLE public.wire_current_rating_claims IS 'One immutable existing numerical observation to source-condition/document/revision edge. The A value remains in its registered vehicle_observations property; requalify through the evidence reader.';
COMMENT ON COLUMN public.wire_current_rating_claims.observation_id IS 'Existing canonical source-analysis observation owning the numerical current value.';
COMMENT ON COLUMN public.wire_current_rating_claims.condition_key IS 'Exact typed current-rating condition; separate from resistance temperature context.';
COMMENT ON COLUMN public.wire_current_rating_claims.document_id IS 'Retained source document; composite foreign key binds it to the condition.';
COMMENT ON COLUMN public.wire_current_rating_claims.reference_revision IS 'Source object/page/metadata qualification revision at admission; reader withholds withdrawn or changed source.';
COMMENT ON COLUMN public.wire_current_rating_claims.created_at IS 'Edge projection admission time; not an installation date.';
COMMENT ON FUNCTION public.wire_current_rating_condition_key(uuid,uuid,integer,numeric,numeric,text,text,text) IS 'Canonical source-defined thermal condition identity; no value or installation selection.';
COMMENT ON FUNCTION public.qualify_wire_current_rating_reference(jsonb) IS 'Closed MoTeC M22759/16 source profile: derives six footnoted heavy-wire A cells from exact five-role page witnesses. No numerical write, actual-temperature, duty or application inference.';
COMMENT ON FUNCTION public.wire_current_rating_observation_binding(public.vehicle_observations) IS 'Requalifies every protected recipe field against current source, registered property and interpreter; typed value only, no write.';
COMMENT ON FUNCTION public.guard_wire_current_rating_reference() IS 'Enforces qualified canonical source receipts on admission and immutable testimony thereafter; sanctioned supersession fields remain available.';
COMMENT ON FUNCTION public.wire_current_rating_reference_evidence(uuid) IS 'Private current-source reader: rechecks exact observation, typed condition/claim, five shared page spans and source/interpreter fingerprints; NULL on withdrawal/mismatch.';
COMMENT ON FUNCTION public.project_wire_current_rating_reference(uuid) IS 'Sanctioned service-only idempotent projection of an existing qualified observation into typed conditions, claims and shared page witnesses; never creates numerical testimony.';
COMMIT;
