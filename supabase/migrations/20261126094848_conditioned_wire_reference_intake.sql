-- Existing observation/property owners retain the numerical claim. These are
-- typed class-condition and page-witness projections, never installed-wire facts.
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='2s';
CREATE FUNCTION public.wire_resistance_condition_key(p_spec uuid,p_document uuid,p_source_part text,p_awg integer,p_temperature numeric,p_role text)
RETURNS text LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog AS $$
 SELECT 'wire-rdc:v1:'||p_spec::text||':doc='||p_document::text||':part='||p_source_part||':awg='||p_awg::text||':C='||trim_scale(p_temperature)::text||':role='||p_role
$$;
REVOKE ALL ON FUNCTION public.wire_resistance_condition_key(uuid,uuid,text,integer,numeric,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.wire_resistance_condition_key(uuid,uuid,text,integer,numeric,text) TO service_role;
CREATE TABLE public.wire_resistance_conditions(
 condition_key text PRIMARY KEY,
 wire_specification_id uuid NOT NULL REFERENCES public.wire_specifications(id),
 reference_document_id uuid NOT NULL REFERENCES public.reference_documents(id),
 source_part_number text NOT NULL CHECK(source_part_number ~ '^[A-Za-z0-9][A-Za-z0-9./_-]{0,99}$'),
 gauge_awg integer NOT NULL CHECK(gauge_awg BETWEEN -3 AND 40),
 conductor_temperature_c numeric NOT NULL CHECK(conductor_temperature_c BETWEEN -273.15 AND 500),
 value_role text NOT NULL CHECK(value_role IN('maximum','nominal')),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(wire_specification_id,reference_document_id,source_part_number,gauge_awg,conductor_temperature_c,value_role),
 UNIQUE(condition_key,reference_document_id),
 CHECK(condition_key=public.wire_resistance_condition_key(wire_specification_id,reference_document_id,source_part_number,gauge_awg,conductor_temperature_c,value_role))
);
CREATE TABLE public.wire_resistance_claims(
 observation_id uuid PRIMARY KEY REFERENCES public.vehicle_observations(id),
 condition_key text NOT NULL,
 document_id uuid NOT NULL REFERENCES public.reference_documents(id),
 reference_revision text NOT NULL CHECK(reference_revision ~ '^[0-9a-f]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(condition_key,document_id) REFERENCES public.wire_resistance_conditions(condition_key,reference_document_id)
);
CREATE TABLE public.observation_reference_spans(
 observation_id uuid NOT NULL REFERENCES public.vehicle_observations(id),
 citation_role text NOT NULL CHECK(citation_role ~ '^[a-z][a-z0-9_.]{0,99}$'),
 page_id uuid NOT NULL REFERENCES public.document_pages(id),
 quote_start integer NOT NULL CHECK(quote_start>=0),
 quote_length integer NOT NULL CHECK(quote_length BETWEEN 1 AND 4000),
 page_text_sha256 text NOT NULL CHECK(page_text_sha256 ~ '^[0-9a-f]{64}$'),
 PRIMARY KEY(observation_id,citation_role)
);
CREATE INDEX wire_resistance_claims_condition ON public.wire_resistance_claims(condition_key,observation_id);
CREATE INDEX wire_resistance_claims_document ON public.wire_resistance_claims(document_id,observation_id);
CREATE INDEX observation_reference_spans_page ON public.observation_reference_spans(page_id,observation_id);
ALTER TABLE public.wire_resistance_conditions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wire_resistance_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.observation_reference_spans ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wire_resistance_conditions,public.wire_resistance_claims,public.observation_reference_spans FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.wire_resistance_conditions,public.wire_resistance_claims,public.observation_reference_spans TO service_role;

-- Deliberately closed format reader: the retained M22759/16 resistance table.
-- It derives the values from exact cited text; no caller-supplied numeric value,
-- vehicle, operating current, ampacity, protection or applicability is accepted.
CREATE FUNCTION public.qualify_wire_resistance_reference(p_reading jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public SET timezone='UTC' SET statement_timeout='10s'
AS $fn$
DECLARE d public.reference_documents%ROWTYPE; page public.document_pages%ROWTYPE;
 spec public.wire_specifications%ROWTYPE; prop public.observation_properties%ROWTYPE;
 evidence jsonb; c jsonb; citations jsonb:='[]'; canon jsonb; fields jsonb; recipe jsonb;
 text_by_role jsonb:='{}'; position_by_role jsonb:='{}'; seen text[]:='{}';
 source_id uuid; page_id uuid; value_page integer; value_excerpt text;
 parts text[]; temperature_parts text[]; gauge integer; temperature numeric;
 source_token text; normalized numeric; exact_normalized numeric; scale_digits integer;
 condition_key text; identity_hash text; profile_fingerprint text; read_at timestamptz; role text; pos integer;
BEGIN
 IF jsonb_typeof(p_reading) IS DISTINCT FROM 'object'
 OR EXISTS(SELECT FROM jsonb_object_keys(p_reading) k WHERE k<>ALL(ARRAY[
  'profile','wire_specification_id','document_id','reference_revision','file_sha256','source_unit','reader','read_at','citations']))
 OR p_reading->>'profile' IS DISTINCT FROM 'm22759_16_resistance_v1'
 OR coalesce(p_reading->>'source_unit','') NOT IN('ohm_per_1000ft','ohm_per_km')
 OR jsonb_typeof(p_reading->'reader') IS DISTINCT FROM 'object'
 OR EXISTS(SELECT FROM jsonb_object_keys(p_reading->'reader') k WHERE k<>ALL(ARRAY['method','model','run_id']))
 OR EXISTS(SELECT FROM jsonb_object_keys(p_reading->'reader') k WHERE jsonb_typeof(p_reading->'reader'->k) IS DISTINCT FROM 'string')
 OR jsonb_typeof(p_reading->'read_at') IS DISTINCT FROM 'string'
 OR length(coalesce(p_reading#>>'{reader,method}','')) NOT BETWEEN 1 AND 100
 OR length(coalesce(p_reading#>>'{reader,model}','')) NOT BETWEEN 1 AND 100
 OR length(coalesce(p_reading#>>'{reader,run_id}','')) NOT BETWEEN 1 AND 150
 OR jsonb_typeof(p_reading->'citations') IS DISTINCT FROM 'array'
 THEN RETURN jsonb_build_object('ok',false,'reason','reading_shape'); END IF;
 IF jsonb_array_length(p_reading->'citations')<>4 THEN RETURN jsonb_build_object('ok',false,'reason','four_citation_roles_required'); END IF;
 SELECT * INTO spec FROM public.wire_specifications WHERE id=(p_reading->>'wire_specification_id')::uuid
  AND wire_type='MIL-W-22759/16' AND mil_spec_reference='MIL-W-22759/16';
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'reason','wire_family_unqualified'); END IF;
 SELECT * INTO prop FROM public.observation_properties WHERE property_key='wire_dc_resistance_per_length'
  AND namespace='core' AND deprecated_at IS NULL AND ratified_at IS NOT NULL
  AND data_type='numeric' AND unit='ohm_per_m' AND verification_scope='class'
  AND cardinality='multi' AND discriminator_key='wire_condition_key'
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
 read_at:=(p_reading->>'read_at')::timestamptz;
 IF isfinite(read_at) IS DISTINCT FROM true OR read_at>current_timestamp+interval '5 minutes'
 OR (read_at>=coalesce((d.source_capture->>'retrieved_at')::timestamptz,(d.source_capture->>'retrieved_day')::date::timestamptz)) IS DISTINCT FROM true
 THEN RETURN jsonb_build_object('ok',false,'reason','reading_clock'); END IF;
 FOR c IN SELECT value FROM jsonb_array_elements(p_reading->'citations') LOOP
  role:=c->>'role';
  IF jsonb_typeof(c) IS DISTINCT FROM 'object'
  OR EXISTS(SELECT FROM jsonb_object_keys(c) k WHERE k<>ALL(ARRAY['role','page_id','excerpt']))
  OR coalesce(role,'') NOT IN('wire_family','column_headings','value_row','units_temperature') OR role=ANY(seen)
  OR jsonb_typeof(c->'excerpt') IS DISTINCT FROM 'string'
  OR length(coalesce(c->>'excerpt','')) NOT BETWEEN 1 AND 4000 THEN
   RETURN jsonb_build_object('ok',false,'reason','citation_shape'); END IF;
  SELECT * INTO page FROM public.document_pages WHERE id=(c->>'page_id')::uuid AND document_id=d.id
   AND extraction_method='supplied_visual_reference_v1';
  IF NOT FOUND OR (page_id IS NOT NULL AND page.id<>page_id) THEN
   RETURN jsonb_build_object('ok',false,'reason','citation_page_scope'); END IF;
  page_id:=page.id;pos:=strpos(page.extracted_text,c->>'excerpt');
  IF pos=0 THEN RETURN jsonb_build_object('ok',false,'reason','citation_not_verbatim'); END IF;
  seen:=array_append(seen,role);text_by_role:=text_by_role||jsonb_build_object(role,c->>'excerpt');
  position_by_role:=position_by_role||jsonb_build_object(role,pos);
  citations:=citations||jsonb_build_object('role',role,'page_id',page.id,'quote_start',pos-1,
   'quote_length',length(c->>'excerpt'),'page_text_sha256',encode(extensions.digest(page.extracted_text,'sha256'),'hex'));
  IF role='value_row' THEN value_page:=page.page_number;value_excerpt:=c->>'excerpt'; END IF;
 END LOOP;
 IF NOT ((position_by_role->>'wire_family')::int<(position_by_role->>'column_headings')::int
  AND (position_by_role->>'column_headings')::int<(position_by_role->>'value_row')::int
  AND (position_by_role->>'value_row')::int<(position_by_role->>'units_temperature')::int)
 OR position('M22759/16' IN text_by_role->>'wire_family')=0
 OR text_by_role->>'wire_family' !~* 'tin[- ]plated[[:space:]]+copper'
 OR text_by_role->>'column_headings' !~ 'Maximum[[:blank:]]+Thermax'
 OR text_by_role->>'column_headings' !~ 'Weight[[:blank:]]+Resistance'
 THEN RETURN jsonb_build_object('ok',false,'reason','table_context_unqualified'); END IF;
 parts:=regexp_match(btrim(value_excerpt),
  '^M22759/16-([0-9]{1,2})-\*[[:blank:]]+([1-4]/0|[0-9]{1,2})[[:blank:]]+[0-9]+/[0-9]+[[:blank:]]+(?:[0-9.]+[[:blank:]]+\([0-9.]+\)[[:blank:]]+){4}([0-9.]+)[[:blank:]]+\(([0-9.]+)\)[[:blank:]]+([A-Za-z0-9][A-Za-z0-9./_-]{0,99})$');
 temperature_parts:=regexp_match(btrim(text_by_role->>'units_temperature'),
  '^Resistance in [ΩΩ]/1,000 feet \([ΩΩ]/Km\), @([+-]?[0-9]+(?:[.][0-9]+)?)[˚°][[:blank:]]*C[.]$');
 IF parts IS NULL OR temperature_parts IS NULL THEN RETURN jsonb_build_object('ok',false,'reason','table_format_unqualified'); END IF;
 IF parts[2] ~ '^[1-4]/0$' THEN
  gauge:=1-left(parts[2],1)::int;
  IF parts[1]<>'0'||left(parts[2],1) THEN RETURN jsonb_build_object('ok',false,'reason','size_code_conflict'); END IF;
 ELSE
  gauge:=parts[2]::int;
  IF parts[1]<>parts[2] OR gauge NOT BETWEEN 1 AND 40 THEN RETURN jsonb_build_object('ok',false,'reason','size_code_conflict'); END IF;
 END IF;
 IF position(parts[2]||'-' IN parts[5])<>1 THEN RETURN jsonb_build_object('ok',false,'reason','manufacturer_part_gauge_conflict'); END IF;
 temperature:=temperature_parts[1]::numeric;
 IF temperature NOT BETWEEN -273.15 AND 500 OR parts[3]::numeric<=0 OR parts[4]::numeric<=0 THEN
  RETURN jsonb_build_object('ok',false,'reason','source_quantity_range'); END IF;
 source_token:=CASE p_reading->>'source_unit' WHEN 'ohm_per_1000ft' THEN parts[3] ELSE parts[4] END;
 -- International foot is exactly 0.3048 m (NIST: https://www.nist.gov/pml/us-surveyfoot).
 -- Normalize the maximum upward to 12 significant decimal digits so SDK JSON
 -- number serialization preserves the bound. The exact source token is retained.
 exact_normalized:=source_token::numeric/CASE p_reading->>'source_unit' WHEN 'ohm_per_1000ft' THEN 304.8 ELSE 1000 END;
 scale_digits:=11-floor(log(10::numeric,exact_normalized))::integer;
 normalized:=round(exact_normalized,scale_digits);
 IF normalized<exact_normalized THEN normalized:=normalized+power(10::numeric,-scale_digits); END IF;
 condition_key:=public.wire_resistance_condition_key(spec.id,d.id,parts[5],gauge,temperature,'maximum');
 SELECT jsonb_agg(value ORDER BY value->>'role') INTO citations FROM jsonb_array_elements(citations);
 SELECT jsonb_agg(jsonb_build_object('role',value->>'role','page_id',(value->>'page_id')::uuid,'excerpt',value->>'excerpt') ORDER BY value->>'role')
 INTO canon FROM jsonb_array_elements(p_reading->'citations');
 canon:=(p_reading-'citations'-'read_at')||jsonb_build_object('citations',canon,'read_at',read_at,
  'wire_specification_id',spec.id,'document_id',d.id);
 profile_fingerprint:=encode(extensions.digest(pg_get_functiondef('public.qualify_wire_resistance_reference(jsonb)'::regprocedure)
  ||pg_get_functiondef('public.wire_resistance_condition_key(uuid,uuid,text,integer,numeric,text)'::regprocedure),'sha256'),'hex');
 fields:=jsonb_build_object('definition_role','published_wire_resistance','applicability_status','unassessed',
  'installed_state','unestablished','wire_condition_key',condition_key,'wire_dc_resistance_per_length',normalized,
  'wire_reference_input',canon,'wire_reference_profile_fingerprint',profile_fingerprint,'source_value_token',source_token,'source_value_unit',p_reading->>'source_unit',
  'source_part_number',parts[5],'source_gauge_label',parts[2],'source_size_code',parts[1],'normalization_version','ohm_per_m_maximum_sig12_v1');
 identity_hash:=encode(extensions.digest(jsonb_build_object('reading',canon-'reader'-'read_at','profile_fingerprint',profile_fingerprint,'property_id',prop.id,'condition_key',condition_key)::text,'sha256'),'hex');
 recipe:=jsonb_build_object('vehicle_id',NULL,'subject_id',NULL,'subject_type','vehicle','subject_organization_id',NULL,
  'source_observation_id',NULL,'component_subject_id',NULL,'source_id',source_id,'kind','specification',
  'observed_at',read_at,'observed_at_basis','source_analysis_time','source_event_time_precision','unknown','source_event_at',NULL,'source_url',d.source_url,'source_identifier','wire-resistance:'||identity_hash,
  'content_hash',identity_hash,'content_text',value_excerpt,'structured_data',fields,'observer_raw',jsonb_build_object('reader',p_reading->'reader'),
  'extraction_method','supplied_wire_resistance_v1','raw_source_ref','sha256:'||d.file_hash,
  'analysis_deferred',true,'confidence','medium','confidence_score',0.6,'rank','normal','property_id',prop.id,
  'descriptor_id',NULL,'citation_document_id',d.id,'citation_secure_document_id',NULL,'citation_page_number',value_page,
  'citation_excerpt',value_excerpt,'is_superseded',false,'superseded_by',NULL,'agent_model',p_reading#>>'{reader,model}');
 RETURN jsonb_build_object('ok',true,'recipe',recipe,'condition',jsonb_build_object('condition_key',condition_key,
  'wire_specification_id',spec.id,'reference_document_id',d.id,'source_part_number',parts[5],'gauge_awg',gauge,'conductor_temperature_c',temperature,'value_role','maximum'),
  'citations',citations,'source',evidence,'scope','attributed_material_class_reference','model_calls',0);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR invalid_parameter_value
 OR invalid_datetime_format OR datetime_field_overflow THEN RETURN jsonb_build_object('ok',false,'reason','reading_value_invalid');
END $fn$;
REVOKE ALL ON FUNCTION public.qualify_wire_resistance_reference(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.qualify_wire_resistance_reference(jsonb) TO service_role;


CREATE FUNCTION public.wire_resistance_observation_binding(p_observation public.vehicle_observations)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public SET timezone='UTC' SET statement_timeout='10s'
AS $fn$
DECLARE q jsonb; item record;
BEGIN
 q:=public.qualify_wire_resistance_reference(p_observation.structured_data->'wire_reference_input');
 IF q->>'ok' IS DISTINCT FROM 'true' THEN RETURN q; END IF;
 FOR item IN SELECT key,value FROM jsonb_each(q->'recipe') LOOP
  IF to_jsonb(p_observation)->item.key IS DISTINCT FROM item.value THEN
   RETURN jsonb_build_object('ok',false,'reason','observation_field_mismatch','field',item.key);
  END IF;
 END LOOP;
 RETURN q;
END $fn$;
REVOKE ALL ON FUNCTION public.wire_resistance_observation_binding(public.vehicle_observations) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.wire_resistance_observation_binding(public.vehicle_observations) TO service_role;

CREATE FUNCTION public.guard_wire_resistance_reference()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET timezone='UTC'
AS $fn$
DECLARE q jsonb; old_reading boolean:=false; new_reading boolean;
BEGIN
 IF TG_OP='UPDATE' THEN
  old_reading:=OLD.extraction_method='supplied_wire_resistance_v1' OR EXISTS(
   SELECT FROM public.observation_properties p WHERE p.id=OLD.property_id AND p.property_key='wire_dc_resistance_per_length');
 END IF;
 new_reading:=NEW.extraction_method='supplied_wire_resistance_v1' OR EXISTS(
  SELECT FROM public.observation_properties p WHERE p.id=NEW.property_id AND p.property_key='wire_dc_resistance_per_length');
 IF NOT coalesce(old_reading,false) AND NOT coalesce(new_reading,false) THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' THEN
  IF EXISTS(SELECT FROM unnest(ARRAY['vehicle_id','subject_id','subject_type','subject_organization_id','source_observation_id',
    'component_subject_id','source_id','kind','observed_at','observed_at_basis','source_event_time_precision','source_event_at','source_url','source_identifier','content_hash','content_text',
    'structured_data','observer_raw','extraction_method','raw_source_ref','confidence','confidence_score','analysis_deferred','rank','property_id','descriptor_id',
    'citation_document_id','citation_secure_document_id','citation_page_number','citation_excerpt','agent_model']) k
   WHERE to_jsonb(NEW)->k IS DISTINCT FROM to_jsonb(OLD)->k) THEN
   RAISE EXCEPTION 'Wire reference testimony is immutable; admit a successor reading' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END IF;
 q:=public.wire_resistance_observation_binding(NEW);
 IF q->>'ok' IS DISTINCT FROM 'true' THEN
  RAISE EXCEPTION 'Wire resistance source binding refused: % (%)',q->>'reason',q->>'field' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.guard_wire_resistance_reference() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER wire_resistance_reference_guard BEFORE INSERT OR UPDATE ON public.vehicle_observations
 FOR EACH ROW EXECUTE FUNCTION public.guard_wire_resistance_reference();

CREATE FUNCTION public.wire_resistance_reference_evidence(p_observation_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public SET timezone='UTC' SET statement_timeout='10s'
AS $fn$
DECLARE o public.vehicle_observations%ROWTYPE; q jsonb; c jsonb;
BEGIN
 SELECT * INTO o FROM public.vehicle_observations WHERE id=p_observation_id
  AND is_superseded IS FALSE AND superseded_by IS NULL AND extraction_method='supplied_wire_resistance_v1';
 IF NOT FOUND THEN RETURN NULL; END IF;
 q:=public.wire_resistance_observation_binding(o);
 IF q->>'ok' IS DISTINCT FROM 'true' THEN RETURN NULL; END IF;
 IF NOT EXISTS(SELECT FROM public.wire_resistance_claims r JOIN public.wire_resistance_conditions wc USING(condition_key)
  WHERE r.observation_id=o.id AND r.document_id=o.citation_document_id
   AND r.reference_revision=q#>>'{source,reference_revision}'
   AND wc.condition_key=q#>>'{condition,condition_key}'
   AND wc.wire_specification_id=(q#>>'{condition,wire_specification_id}')::uuid
   AND wc.reference_document_id=(q#>>'{condition,reference_document_id}')::uuid
   AND wc.source_part_number=q#>>'{condition,source_part_number}'
   AND wc.gauge_awg=(q#>>'{condition,gauge_awg}')::int
   AND wc.conductor_temperature_c=(q#>>'{condition,conductor_temperature_c}')::numeric AND wc.value_role='maximum')
 THEN RETURN NULL; END IF;
 IF (SELECT count(*) FROM public.observation_reference_spans WHERE observation_id=o.id)<>4 THEN RETURN NULL; END IF;
 FOR c IN SELECT value FROM jsonb_array_elements(q->'citations') LOOP
  IF NOT EXISTS(SELECT FROM public.observation_reference_spans r WHERE r.observation_id=o.id
   AND r.citation_role=c->>'role' AND r.page_id=(c->>'page_id')::uuid
   AND r.quote_start=(c->>'quote_start')::int AND r.quote_length=(c->>'quote_length')::int
   AND r.page_text_sha256=c->>'page_text_sha256') THEN RETURN NULL; END IF;
 END LOOP;
 RETURN jsonb_build_object('observation_id',o.id,'property_id',o.property_id,'property_key','wire_dc_resistance_per_length',
  'value',o.structured_data->'wire_dc_resistance_per_length','unit','ohm_per_m','condition',q->'condition',
  'source',q->'source','citations',q->'citations','source_value_token',o.structured_data->'source_value_token',
  'source_value_unit',o.structured_data->'source_value_unit','normalization_version',o.structured_data->'normalization_version',
  'scope','attributed_material_class_reference','applicability_status','unassessed','installed_state','unestablished');
END $fn$;
REVOKE ALL ON FUNCTION public.wire_resistance_reference_evidence(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.wire_resistance_reference_evidence(uuid) TO service_role;

CREATE FUNCTION public.project_wire_resistance_reference(p_observation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public SET timezone='UTC' SET statement_timeout='10s'
AS $fn$
DECLARE o public.vehicle_observations%ROWTYPE; q jsonb; c jsonb; ck text; result jsonb;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
 SELECT * INTO o FROM public.vehicle_observations WHERE id=p_observation_id
  AND is_superseded IS FALSE AND superseded_by IS NULL AND extraction_method='supplied_wire_resistance_v1' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Current wire reference observation required' USING ERRCODE='23514'; END IF;
 q:=public.wire_resistance_observation_binding(o);
 IF q->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Wire reference source binding refused' USING ERRCODE='23514'; END IF;
 ck:=q#>>'{condition,condition_key}';
 INSERT INTO public.wire_resistance_conditions(condition_key,wire_specification_id,reference_document_id,source_part_number,gauge_awg,conductor_temperature_c,value_role)
 VALUES(ck,(q#>>'{condition,wire_specification_id}')::uuid,(q#>>'{condition,reference_document_id}')::uuid,
  q#>>'{condition,source_part_number}',(q#>>'{condition,gauge_awg}')::int,
  (q#>>'{condition,conductor_temperature_c}')::numeric,'maximum') ON CONFLICT DO NOTHING;
 INSERT INTO public.wire_resistance_claims(observation_id,condition_key,document_id,reference_revision)
 VALUES(o.id,ck,o.citation_document_id,q#>>'{source,reference_revision}') ON CONFLICT DO NOTHING;
 FOR c IN SELECT value FROM jsonb_array_elements(q->'citations') LOOP
  INSERT INTO public.observation_reference_spans(observation_id,citation_role,page_id,quote_start,quote_length,page_text_sha256)
  VALUES(o.id,c->>'role',(c->>'page_id')::uuid,(c->>'quote_start')::int,(c->>'quote_length')::int,c->>'page_text_sha256') ON CONFLICT DO NOTHING;
 END LOOP;
 result:=public.wire_resistance_reference_evidence(o.id);
 IF result IS NULL THEN RAISE EXCEPTION 'Wire reference projection no longer matches current source' USING ERRCODE='23514'; END IF;
 RETURN jsonb_build_object('success',true,'observation_id',o.id,'condition_key',ck,'current_source_verified',true,
  'scope','attributed_material_class_reference','model_calls',0);
END $fn$;
REVOKE ALL ON FUNCTION public.project_wire_resistance_reference(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.project_wire_resistance_reference(uuid) TO service_role;

COMMENT ON TABLE public.wire_resistance_conditions IS 'One source-defined manufacturer-variant/gauge/conductor-temperature/maximum-or-nominal condition within an existing wire family. No resistance value or installed-wire identity is stored here.';
COMMENT ON COLUMN public.wire_resistance_conditions.condition_key IS 'Canonical discriminator derived by wire_resistance_condition_key; names this precise class condition, not a vehicle wire.';
COMMENT ON COLUMN public.wire_resistance_conditions.wire_specification_id IS 'Existing material family owner; never a new per-reading wire specification.';
COMMENT ON COLUMN public.wire_resistance_conditions.reference_document_id IS 'Source namespace for this manufacturer-defined variant. Ratings are not asserted for every product under the MIL family.';
COMMENT ON COLUMN public.wire_resistance_conditions.source_part_number IS 'Literal manufacturer variant label from the source row, not an orderable catalog identity. catalog_parts owns resolved purchasing identities; that binding and applicability remain unassessed.';
COMMENT ON COLUMN public.wire_resistance_conditions.gauge_awg IS 'Standard numeric AWG index: 1/0 is0,2/0 is-1; source military size codes are preserved separately on the observation.';
COMMENT ON COLUMN public.wire_resistance_conditions.conductor_temperature_c IS 'Temperature of the published resistance value, parsed from the cited units footnote; not insulation or ambient rating.';
COMMENT ON COLUMN public.wire_resistance_conditions.value_role IS 'Published maximum or nominal role; the first source profile admits maximum only.';
COMMENT ON COLUMN public.wire_resistance_conditions.created_at IS 'Projection creation clock, not a physical measurement or manufacturing time.';

COMMENT ON TABLE public.wire_resistance_claims IS 'One immutable typed condition/document edge for a numerical vehicle_observations class-reference claim. The value stays in its registered observation property.';
COMMENT ON COLUMN public.wire_resistance_claims.observation_id IS 'Existing sanctioned ingest-observation testimony row. Never written or amended by this projection writer.';
COMMENT ON COLUMN public.wire_resistance_claims.condition_key IS 'Exact typed wire family/gauge/temperature/value-role discriminator.';
COMMENT ON COLUMN public.wire_resistance_claims.document_id IS 'Retained public reference source; eligibility rechecks the actual current document fingerprint.';
COMMENT ON COLUMN public.wire_resistance_claims.reference_revision IS 'Expected admitted revision; source withdrawal or mismatch removes eligibility on read.';
COMMENT ON COLUMN public.wire_resistance_claims.created_at IS 'Projection creation clock; not a new reading time.';

COMMENT ON TABLE public.observation_reference_spans IS 'Shared canonical public-reference document/page-span witnesses for existing observations. Profile-specific roles and source eligibility are enforced by sanctioned producers; original excerpts remain in the observation. This complements the existing image-only observation_witnesses owner and stores no property value.';
COMMENT ON COLUMN public.observation_reference_spans.observation_id IS 'Existing source observation owner; the wire profile additionally requires its typed wire_resistance_claims edge.';
COMMENT ON COLUMN public.observation_reference_spans.citation_role IS 'The exact role this page span supplies to the closed source profile.';
COMMENT ON COLUMN public.observation_reference_spans.page_id IS 'Actual retained document_pages row, qualified together with its public source document.';
COMMENT ON COLUMN public.observation_reference_spans.quote_start IS 'Zero-based character offset in the exact retained page extraction; not an assumed PDF pixel coordinate.';
COMMENT ON COLUMN public.observation_reference_spans.quote_length IS 'Character count of the exact verbatim source excerpt.';
COMMENT ON COLUMN public.observation_reference_spans.page_text_sha256 IS 'Fingerprint of the cited full extracted page; checked again against current source eligibility.';

COMMENT ON FUNCTION public.wire_resistance_observation_binding(public.vehicle_observations) IS 'Read-only common binding predicate over a typed observation value. Used by the insert guard, projection and evidence reader; can be tested without inserting testimony.';
COMMENT ON FUNCTION public.qualify_wire_resistance_reference(jsonb) IS 'Read-only closed source recipe: derive M22759/16 gauge, selected maximum resistance cell, source units and conductor temperature from four exact current retained-page witnesses. No caller values, vehicle application, ampacity or installed-state assertion.';
COMMENT ON FUNCTION public.project_wire_resistance_reference(uuid) IS 'Service-only idempotent immutable condition/page-edge projection from an existing fully qualified observation. Writes no testimony or numerical value; final current-source evidence is rechecked.';
COMMENT ON FUNCTION public.wire_resistance_reference_evidence(uuid) IS 'Current attributed material-class resistance evidence, including typed conditions and exact source spans; NULL after source/registry/observation withdrawal or projection mismatch. Not engineering/build/purchasing eligibility.';
COMMIT;
