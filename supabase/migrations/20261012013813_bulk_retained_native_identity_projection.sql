-- Deterministic native introduction labels and page enqueueing in the existing owner.
-- No model/provider calls, source activation, canonical vehicle mutation or budget increase.
BEGIN;
SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='1s';
DO $guard$ BEGIN
 IF EXISTS(SELECT FROM pg_stat_activity WHERE wait_event_type='Lock' AND pid<>pg_backend_pid()) OR
  (SELECT count(*) FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND state='active' AND query ~ '(vehicle_observations|retained_listing_property|vehicle_canonical|get_field_provenance)')>2 THEN RAISE EXCEPTION 'Relevant data work or lock wait active';END IF;
 IF NOT EXISTS(SELECT FROM cron.job WHERE jobname='project-retained-listing-properties' AND active AND schedule='* * * * *'
  AND encode(sha256(convert_to(command,'UTF8')),'base64')='w/ElpXz1aw8IfUpuaOrqo4T7qx//QC/kJOCRcCBUho0=') THEN RAISE EXCEPTION 'Existing replay paused or changed';END IF;
 IF encode(sha256(convert_to(pg_get_functiondef('public.claim_retained_listing_properties(text,integer)'::regprocedure),'UTF8')),'base64') IS DISTINCT FROM 'ncvsBq569AsAK8l+ZW1NDxa8Mo5eNJsHhFSQ1hd0vfo=' THEN RAISE EXCEPTION 'Existing claim_retained_listing_properties owner changed';END IF;
 IF encode(sha256(convert_to(pg_get_functiondef('public.enqueue_retained_listing_properties(uuid)'::regprocedure),'UTF8')),'base64') IS DISTINCT FROM 'LktAvxf59eoOBOIx0uhOIcP9fE26XLuQPlXUN54IQrI=' THEN RAISE EXCEPTION 'Existing enqueue_retained_listing_properties owner changed';END IF;
 IF encode(sha256(convert_to(pg_get_functiondef('public.get_field_provenance(uuid,text)'::regprocedure),'UTF8')),'base64') IS DISTINCT FROM 'XYGK5B9Wxh2YG4hZ4irrZbioBsf6rVHsfGB9IMKdlPg=' THEN RAISE EXCEPTION 'Existing get_field_provenance owner changed';END IF;
 IF encode(sha256(convert_to(pg_get_functiondef('public.retained_description_property_witness(public.vehicle_observations,text)'::regprocedure),'UTF8')),'base64') IS DISTINCT FROM 'qTZdIZXIWOgrIZ+8Bg9OvR1X/KEVzUV8qiKSGTYNRsc=' THEN RAISE EXCEPTION 'Existing retained_description_property_witness owner changed';END IF;
 IF encode(sha256(convert_to(pg_get_functiondef('public.retained_description_year_matches(public.vehicle_observations,public.vehicle_observations)'::regprocedure),'UTF8')),'base64') IS DISTINCT FROM 'kQW4dwSMtyJXgVEsO8EpxYfU2qYWoNZjxg+jhQgSESI=' THEN RAISE EXCEPTION 'Existing retained_description_year_matches owner changed';END IF;
 IF encode(sha256(convert_to(pg_get_functiondef('public.retained_description_year_text_witness(text)'::regprocedure),'UTF8')),'base64') IS DISTINCT FROM 'tVKMZxPtfQejooWKFH3cUB8Tk5Wpx03J/l88VS+0gZM=' THEN RAISE EXCEPTION 'Existing retained_description_year_text_witness owner changed';END IF;
 IF encode(sha256(convert_to(pg_get_functiondef('public.retained_description_year_value_matches(public.vehicle_observations,public.vehicle_observations)'::regprocedure),'UTF8')),'base64') IS DISTINCT FROM 'npkoHBQZA8Y673ip6e4bP3y1zLSNORBbuRxzE8W6YKI=' THEN RAISE EXCEPTION 'Existing retained_description_year_value_matches owner changed';END IF;
 IF encode(sha256(convert_to(pg_get_functiondef('public.retained_listing_property_result_matches(uuid,uuid,uuid)'::regprocedure),'UTF8')),'base64') IS DISTINCT FROM 'IPRlHeTfIaQOLBGzDSXUhBd/5juj+ZLxfiaBE9+8Rww=' THEN RAISE EXCEPTION 'Existing retained_listing_property_result_matches owner changed';END IF;
 IF encode(sha256(convert_to(pg_get_functiondef('public.seed_retained_listing_properties()'::regprocedure),'UTF8')),'base64') IS DISTINCT FROM 'HrG1YTGVqXFKHUHanlgT+6Kw6Ljxo5q9LTLQj4ECHog=' THEN RAISE EXCEPTION 'Existing seed_retained_listing_properties owner changed';END IF;
 IF encode(sha256(convert_to(pg_get_functiondef('public.validate_retained_listing_property_source()'::regprocedure),'UTF8')),'base64') IS DISTINCT FROM '3icCHwnpmcoHP6DSH7pMpMiIjMQR+NtbjDJLSaAylq4=' THEN RAISE EXCEPTION 'Existing validate_retained_listing_property_source owner changed';END IF;
 IF encode(sha256(convert_to(pg_get_viewdef('public.vehicle_canonical'::regclass,true),'UTF8')),'base64') IS DISTINCT FROM '4RZvRN5kPPFvLKS6RftqM9dCHuBlxOKcyd9lL/xcpPY=' THEN RAISE EXCEPTION 'Canonical reader changed';END IF;
 IF to_regprocedure('public.retained_description_identity_text_witness(text,text)') IS NOT NULL OR
  to_regprocedure('public.enqueue_retained_listing_properties(uuid[])') IS NOT NULL OR to_regprocedure('public.get_vehicle_specs(uuid[],boolean)') IS NOT NULL OR to_regprocedure('public.retained_vehicle_record_property_bindings(jsonb)') IS NOT NULL THEN RAISE EXCEPTION 'Bulk identity helpers already owned';END IF;
 IF (SELECT count(*) FROM observation_properties WHERE namespace='core' AND deprecated_at IS NULL AND ratified_at IS NOT NULL AND data_type='string' AND unit IS NULL AND 'specification'=ANY(applies_to_kinds)
  AND (id,property_key,label) IN(('8d274b73-a8a6-43bf-9036-5864d0152725'::uuid,'make','Make'),('a79b528f-7d9d-46ca-96f9-96d899e81d10'::uuid,'model','Model')))<>2 THEN RAISE EXCEPTION 'Ratified label meanings changed';END IF;
 IF encode(sha256(convert_to(pg_get_functiondef('public.finish_retained_listing_property(uuid,uuid,text,text,uuid)'::regprocedure),'UTF8')),'base64') IS DISTINCT FROM 'AvUDUP2JogKErmhrYYKKEkfKBwPUAsAuuGfd3uVWIUE=' THEN RAISE EXCEPTION 'Completion owner changed';END IF;
END $guard$;
CREATE OR REPLACE FUNCTION public.retained_description_identity_text_witness(p_key text,p_text text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path='' AS $$
DECLARE w jsonb:=public.retained_description_year_text_witness(p_text);label text:=w->>'source_subject_label';maker text;value text;
BEGIN
 IF p_key IS NULL OR p_key NOT IN('make','model') OR w IS NULL THEN RETURN NULL;END IF;
 -- Exact publisher spelling and a full token boundary; no taxonomy/alias inference.
 FOREACH maker IN ARRAY ARRAY['International Harvester','Mercedes-Maybach','Harley-Davidson','Willys-Overland','Austin-Healey','Mercedes-Benz','Aston Martin','Mercedes-AMG','Autobianchi','Continental','Lamborghini','Rolls-Royce','AM General','Alfa Romeo','John Deere','Land Rover','Mitsubishi','Moto Guzzi','Oldsmobile','Steyr-Puch','Studebaker','Volkswagen','Airstream','Chevrolet','Husqvarna','Innocenti','Winnebago','Workhorse','Cadillac','Caterham','Chrysler','DeLorean','DeTomaso','Infiniti','Kawasaki','Maserati','Plymouth','Aprilia','Bentley','Bertone','Bultaco','Daimler','Ferrari','Hyundai','Lincoln','McLaren','Mercury','Packard','Peugeot','Polaris','Pontiac','Porsche','Renault','Sunbeam','Triumph','Victory','Vincent','Austin','Bimota','Datsun','DeSoto','Ducati','Hummer','Indian','Jaguar','Jensen','Kaiser','Lancia','Nissan','Saturn','Shelby','Subaru','Suzuki','Toyota','Willys','Yamaha','Acura','Ariel','Authi','Buick','Dodge','Edsel','Honda','Isuzu','Lexus','Lotus','Mazda','Panoz','Qvale','Rover','Smart','Vespa','Volvo','Audi','Fiat','Ford','Jeep','Lada','Mini','Puch','Saab','AJS','AMC','BMW','GMC','KTM','LTI','Ram','SRT','TVR','MG'] LOOP
  IF label=maker OR left(label,length(maker)+1)=maker||' ' THEN
   value:=CASE WHEN p_key='make' THEN maker ELSE substring(label FROM length(maker)+2) END;
   IF public.retained_listing_identity_value(p_key,to_jsonb(value)) IS NULL THEN RETURN NULL;END IF;
   RETURN (w-'value')||jsonb_build_object('value',value,'source_make_label',maker);
  END IF;
 END LOOP;RETURN NULL;
END $$;
CREATE OR REPLACE FUNCTION public.retained_description_identity_value_matches(p vehicle_observations, o vehicle_observations)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
DECLARE w jsonb;d jsonb:=o.structured_data;k text:=d->>'property_key';
BEGIN
 -- These are already necessary conditions below. Refuse unrelated candidates
 -- before the native parser, including other fields of the same source parent.
 IF k IS NULL OR k NOT IN('make','model') OR o.property_id IS DISTINCT FROM (CASE k WHEN 'make' THEN '8d274b73-a8a6-43bf-9036-5864d0152725'::uuid ELSE 'a79b528f-7d9d-46ca-96f9-96d899e81d10'::uuid END)
  OR o.extraction_method IS DISTINCT FROM 'retained_listing_property_projection_v1'
  OR d->>'source_profile' IS DISTINCT FROM 'bat_description_identity_label_v1' THEN RETURN false;END IF;
 w:=public.retained_description_property_witness(p,k);
 IF k IS NULL OR k NOT IN('make','model') OR w IS NULL THEN RETURN false;END IF;
 RETURN coalesce(o.id<>p.id AND o.source_observation_id=p.id AND o.vehicle_id=p.vehicle_id AND o.source_id=p.source_id AND o.source_url=p.source_url
  AND o.kind::text='specification' AND o.is_superseded IS FALSE AND o.subject_type='vehicle' AND o.subject_id IS NULL
  AND o.extraction_method='retained_listing_property_projection_v1' AND o.observed_at=p.ingested_at
  AND o.property_id=CASE k WHEN 'make' THEN '8d274b73-a8a6-43bf-9036-5864d0152725'::uuid ELSE 'a79b528f-7d9d-46ca-96f9-96d899e81d10'::uuid END
  AND o.source_identifier='retained_listing_'||k||'_v1:'||p.id::text AND o.raw_source_ref='vehicle_observations:'||p.id::text
  AND o.confidence_score BETWEEN 0 AND 0.6 AND o.agent_cost_cents=0 AND o.agent_model IS NULL AND o.content_hash IS NOT NULL
  AND d->k=w->'value' AND d->'source_value'=w->'source_value' AND d->'source_year_token'=w->'source_year_token'
  AND d->'source_subject_label'=w->'source_subject_label' AND d->'source_make_label'=w->'source_make_label'
  AND d->>'source_profile'='bat_description_identity_label_v1' AND d->>'identity_label_basis'='native_listing_subject_introduction'
  AND d->>'identity_role'='extractor_vehicle_label' AND d->>'identity_resolution_status'='unverified' AND d->>'model_label_scope'='publisher_subject_label_remainder'
  AND d->>'normalization_version'='retained_description_identity_labels_v1' AND d->>'source_witness_version'='retained_description_identity_labels_v1'
  AND d->'source_capture_sha256'=p.structured_data->'source_capture_sha256'
  AND d->>'source_observation_id'=p.id::text AND d->>'property_key'=k AND d->>'source_field'='content_text'
  AND d->>'analysis_kind'='retained_listing_property_projection' AND d->>'projection_version'='retained_listing_'||k||'_v1' AND d->>'claim_role'='listing_claim'
  AND d->>'observed_at_basis'='source_testimony_recorded_at' AND d->>'source_extraction_method'=p.extraction_method
  AND CASE WHEN pg_catalog.pg_input_is_valid(d->>'source_recorded_at','timestamptz') AND pg_catalog.pg_input_is_valid(d->>'source_observed_at','timestamptz')
   THEN (d->>'source_recorded_at')::timestamptz=p.ingested_at AND (d->>'source_observed_at')::timestamptz=p.observed_at ELSE false END
  AND d->'source_confidence_score'=to_jsonb(p.confidence_score)
  AND d->>'source_event_time_status'='unknown' AND d->>'factory_configuration_status'='unknown' AND d->>'current_configuration_status'='unknown'
  AND d->'independent_source'='false'::jsonb,false);
END $function$
;
CREATE OR REPLACE FUNCTION public.retained_description_identity_matches(p vehicle_observations, o vehicle_observations)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 SELECT coalesce(public.retained_description_identity_value_matches(p,o) AND public.observation_is_public(p.kind,p.structured_data)
  AND EXISTS(SELECT FROM public.vehicles v WHERE v.id=p.vehicle_id AND v.is_public IS TRUE AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item')
  AND EXISTS(SELECT FROM public.observation_sources s WHERE s.id=p.source_id AND s.slug='bat' AND 'specification'=ANY(s.supported_observations))
  AND EXISTS(SELECT FROM public.observation_properties r WHERE r.id=o.property_id AND r.property_key=o.structured_data->>'property_key' AND r.property_key IN('make','model') AND r.namespace='core' AND r.label=CASE r.property_key WHEN 'make' THEN 'Make' ELSE 'Model' END AND r.data_type='string'
    AND r.unit IS NULL AND r.ratified_at IS NOT NULL AND r.deprecated_at IS NULL AND 'specification'=ANY(r.applies_to_kinds)),false);
$function$
;
REVOKE ALL ON FUNCTION public.retained_description_identity_text_witness(text,text),public.retained_description_identity_value_matches(public.vehicle_observations,public.vehicle_observations),public.retained_description_identity_matches(public.vehicle_observations,public.vehicle_observations) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.retained_description_identity_text_witness(text,text),public.retained_description_identity_value_matches(public.vehicle_observations,public.vehicle_observations),public.retained_description_identity_matches(public.vehicle_observations,public.vehicle_observations) TO anon,authenticated,service_role;
COMMENT ON FUNCTION public.retained_description_identity_text_witness(text,text) IS 'Exact source introduction make token and remaining model label from a closed publisher-spelling list. Model label may include trim/body style; not a catalog-model match, vehicle identity resolution, verified factory/current configuration or source event time. Original sentence/year/subject/make labels survive. No paid or inference calls.';
DO $owners$ DECLARE f text;a text;b text;BEGIN
 f:=pg_get_functiondef('public.retained_description_property_witness(public.vehicle_observations,text)'::regprocedure);
 a:='RETURN CASE WHEN p_key=''year''';b:='RETURN CASE WHEN p_key IN(''make'',''model'') THEN public.retained_description_identity_text_witness(p_key,p.content_text) WHEN p_key=''year''';
 IF cardinality(string_to_array(f,a))<>2 THEN RAISE EXCEPTION 'Witness dispatch changed';END IF;EXECUTE replace(f,a,b);
 f:=pg_get_functiondef('public.validate_retained_listing_property_source()'::regprocedure);
 a:='public.retained_description_year_matches(p,NEW)';
 IF cardinality(string_to_array(f,a))<>2 THEN RAISE EXCEPTION 'Admission proof changed';END IF;
 EXECUTE replace(f,a,a||' OR public.retained_description_identity_matches(p,NEW)');
 FOREACH f IN ARRAY ARRAY['retained_listing_property_result_matches(uuid,uuid,uuid)','get_field_provenance(uuid,text)'] LOOP
  a:=pg_get_functiondef(('public.'||f)::regprocedure);b:='public.retained_description_year_matches(p,o)';
  IF f LIKE 'get_field%' THEN b:='public.retained_description_year_matches(dp,o)';END IF;
  IF cardinality(string_to_array(a,b))<>2 THEN RAISE EXCEPTION 'Completion/reader proof changed';END IF;
  EXECUTE replace(a,b,b||CASE WHEN f LIKE 'get_field%' THEN ' OR public.retained_description_identity_matches(dp,o)' ELSE ' OR public.retained_description_identity_matches(p,o)' END);
 END LOOP;
 f:=pg_get_viewdef('public.vehicle_canonical'::regclass,true);
 -- Separate source/property/custody proof for make/model, preserving all earlier branches.
 a:='o.source_observation_id IS NULL';
 IF cardinality(string_to_array(f,a))<>2 THEN RAISE EXCEPTION 'Canonical parent anchor changed';END IF;
 b:=a||$proof$ OR EXISTS(SELECT FROM public.vehicle_observations ip
 JOIN public.observation_sources isp ON isp.id=ip.source_id AND isp.slug='bat' AND 'specification'=ANY(isp.supported_observations)
 JOIN public.vehicles iv ON iv.id=ip.vehicle_id AND iv.is_public IS TRUE AND iv.deleted_at IS NULL AND iv.listing_kind IS DISTINCT FROM 'non_vehicle_item'
 JOIN public.observation_properties ir ON ir.id=o.property_id AND ir.property_key=o.structured_data->>'property_key' AND ir.property_key IN('make','model')
  AND ir.namespace='core' AND ir.label=CASE ir.property_key WHEN 'make' THEN 'Make' ELSE 'Model' END AND ir.data_type='string'
  AND ir.unit IS NULL AND ir.ratified_at IS NOT NULL AND ir.deprecated_at IS NULL AND 'specification'=ANY(ir.applies_to_kinds)
 WHERE ip.id=o.source_observation_id AND public.observation_is_public(ip.kind,ip.structured_data) AND public.retained_description_identity_value_matches(ip.*,o.*))$proof$;
 EXECUTE 'CREATE OR REPLACE VIEW public.vehicle_canonical AS '||replace(f,a,b);
 f:=pg_get_functiondef('public.get_field_provenance(uuid,text)'::regprocedure);a:='''source_url'',o.source_url)';
 IF cardinality(string_to_array(f,a))<>2 THEN RAISE EXCEPTION 'Reader qualifiers changed';END IF;
 EXECUTE replace(f,a,a||' || jsonb_build_object(''identity_label_basis'',o.structured_data->>''identity_label_basis'',''source_make_label'',o.structured_data->>''source_make_label'',''model_label_scope'',o.structured_data->>''model_label_scope'')');
END $owners$;
CREATE OR REPLACE FUNCTION public.enqueue_retained_listing_properties(p_sources uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET lock_timeout TO '500ms'
 SET statement_timeout TO '5s'
AS $function$
DECLARE n integer;native_count integer;
BEGIN
 IF p_sources IS NULL OR cardinality(p_sources)=0 THEN RETURN 0;END IF;
 IF array_ndims(p_sources)<>1 OR cardinality(p_sources)>500 OR array_position(p_sources,NULL) IS NOT NULL THEN RAISE EXCEPTION 'Expected at most500 nonnull retained source keys';END IF;
 INSERT INTO public.retained_listing_property_work(source_observation_id,property_id,vehicle_id)
 SELECT p.id,r.id,p.vehicle_id FROM public.vehicle_observations p
 JOIN public.vehicles v ON v.id=p.vehicle_id AND v.is_public IS TRUE AND v.deleted_at IS NULL
  AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
 JOIN public.observation_sources s ON s.id=p.source_id AND s.slug='bat'
 CROSS JOIN (VALUES('514cacd3-82b4-4330-b3df-e292612ee718'::uuid,'interior_color','interior_color'),
   ('efcb8c61-1ff5-4790-890e-2e09118e87e3'::uuid,'exterior_color','color'),
   ('c0f743ae-dc94-4dfd-98ef-514b76f74a9b'::uuid,'engine_configuration','engine_size'),
   ('66b2f1f6-b714-4ac0-85b6-60ba89529c1a'::uuid,'engine_displacement_l','engine_size'),
   ('235aed17-9bd3-4886-90be-9b1a8e2d1844'::uuid,'transmission_type','transmission'),
   ('32b51f19-e5cf-4f67-81d9-96c2d30885a1'::uuid,'drivetrain_layout','drivetrain')) r(id,property_key,source_field)
 JOIN public.observation_properties k ON k.id=r.id AND k.property_key=r.property_key
  AND k.namespace='core' AND k.deprecated_at IS NULL AND 'specification'=ANY(k.applies_to_kinds)
 WHERE p.id=ANY(p_sources) AND p.kind='listing' AND p.extraction_method='html_match'
 AND p.is_superseded IS FALSE AND p.property_id IS NULL AND p.subject_type='vehicle' AND p.subject_id IS NULL
 AND p.source_url ~ '^https://bringatrailer[.]com/listing/[^/?#]+/?$'
 AND isfinite(p.ingested_at) AND (p.observed_at IS NULL OR isfinite(p.observed_at))
 AND p.confidence_score BETWEEN 0.6 AND 1
 AND jsonb_typeof(p.structured_data->r.source_field)='string'
 AND nullif(btrim(p.structured_data->>r.source_field),'') IS NOT NULL
 AND length(p.structured_data->>r.source_field)<=500
 AND btrim(p.structured_data->>r.source_field) !~* '^(unknown|n/a|unspecified)$'
 AND (r.property_key IN('interior_color','exterior_color') OR
  public.retained_powertrain_value(r.property_key,p.structured_data->r.source_field) IS NOT NULL)
 ON CONFLICT(source_observation_id,property_id) DO NOTHING;
 GET DIAGNOSTICS n=ROW_COUNT;
 INSERT INTO public.retained_listing_property_work(source_observation_id,property_id,vehicle_id)
 SELECT p.id,r.id,p.vehicle_id FROM public.vehicle_observations p
 JOIN public.vehicles v ON v.id=p.vehicle_id AND v.is_public IS TRUE AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
 JOIN public.observation_sources s ON s.id=p.source_id AND s.slug='bat' AND 'specification'=ANY(s.supported_observations)
 CROSS JOIN (VALUES('c0f743ae-dc94-4dfd-98ef-514b76f74a9b'::uuid,'engine_configuration'),
  ('66b2f1f6-b714-4ac0-85b6-60ba89529c1a'::uuid,'engine_displacement_l'),('235aed17-9bd3-4886-90be-9b1a8e2d1844'::uuid,'transmission_type'),
  ('abdd7a7a-02c1-4b09-afc6-1a288207dd2d'::uuid,'mileage_miles'),
  ('514cacd3-82b4-4330-b3df-e292612ee718'::uuid,'interior_color'),('efcb8c61-1ff5-4790-890e-2e09118e87e3'::uuid,'exterior_color'),
  ('32b51f19-e5cf-4f67-81d9-96c2d30885a1'::uuid,'drivetrain_layout')) k(id,key)
 JOIN public.observation_properties r ON r.id=k.id AND r.property_key=k.key AND r.namespace='core' AND r.deprecated_at IS NULL AND (CASE WHEN k.key='mileage_miles' THEN 'condition' ELSE 'specification' END)=ANY(r.applies_to_kinds::text[])
 WHERE p.id=ANY(p_sources) AND public.retained_description_property_witness(p,k.key) IS NOT NULL
 ON CONFLICT(source_observation_id,property_id) DO NOTHING;
 GET DIAGNOSTICS native_count=ROW_COUNT;n:=n+native_count;
 INSERT INTO public.retained_listing_property_work(source_observation_id,property_id,vehicle_id)
 SELECT p.id,k.id,p.vehicle_id FROM public.vehicle_observations p
 JOIN public.vehicles v ON v.id=p.vehicle_id AND v.is_public IS TRUE AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
 JOIN public.observation_sources s ON s.id=p.source_id AND s.slug='bat' AND 'specification'=ANY(s.supported_observations)
 CROSS JOIN(VALUES('ece619f7-c49a-44f7-999f-a41acf5d4dc3'::uuid,'year'),('8d274b73-a8a6-43bf-9036-5864d0152725'::uuid,'make'),('a79b528f-7d9d-46ca-96f9-96d899e81d10'::uuid,'model'),('9fc93dd3-3639-439a-8eed-3e9a0f846334'::uuid,'vin'))k(id,key)
 JOIN public.observation_properties r ON r.id=k.id AND r.property_key=k.key AND r.namespace='core' AND r.deprecated_at IS NULL AND r.ratified_at IS NOT NULL AND 'specification'=ANY(r.applies_to_kinds)
 WHERE p.id=ANY(p_sources) AND p.kind='listing' AND p.extraction_method='html_match' AND p.is_superseded IS FALSE
  AND p.property_id IS NULL AND p.subject_type='vehicle' AND p.subject_id IS NULL
  AND p.source_url ~ '^https://bringatrailer[.]com/listing/[^/?#]+/?$' AND p.confidence_score BETWEEN 0.6 AND 1
  AND isfinite(p.ingested_at) AND (p.observed_at IS NULL OR isfinite(p.observed_at))
  AND public.retained_listing_identity_value(k.key,p.structured_data->k.key) IS NOT NULL
 ON CONFLICT(source_observation_id,property_id) DO NOTHING;
 GET DIAGNOSTICS native_count=ROW_COUNT;n:=n+native_count;
 INSERT INTO public.retained_listing_property_work(source_observation_id,property_id,vehicle_id)
 SELECT p.id,r.id,p.vehicle_id FROM public.vehicle_observations p
 JOIN public.vehicles v ON v.id=p.vehicle_id AND v.is_public IS TRUE AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
 JOIN public.observation_sources s ON s.id=p.source_id AND s.slug='craigslist' AND 'listing'=ANY(s.supported_observations)
 JOIN public.observation_properties r ON r.id='abdd7a7a-02c1-4b09-afc6-1a288207dd2d'::uuid AND r.property_key='mileage_miles' AND r.namespace='core' AND r.data_type='integer' AND r.unit='miles' AND r.label='Odometer Reading (mi)' AND r.ratified_at IS NOT NULL AND r.deprecated_at IS NULL AND 'listing'=ANY(r.applies_to_kinds)
 WHERE p.id=ANY(p_sources) AND public.observation_is_public(p.kind,p.structured_data) AND public.retained_craigslist_odometer_witness(p) IS NOT NULL
 ON CONFLICT(source_observation_id,property_id) DO NOTHING;
 GET DIAGNOSTICS native_count=ROW_COUNT;n:=n+native_count;
 INSERT INTO public.retained_listing_property_work(source_observation_id,property_id,vehicle_id)
 SELECT p.id,r.id,p.vehicle_id FROM public.vehicle_observations p
 JOIN public.vehicles v ON v.id=p.vehicle_id AND v.is_public IS TRUE AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
 JOIN public.observation_sources src ON src.id=p.source_id AND src.slug='craigslist' AND 'listing'=ANY(src.supported_observations)
 JOIN public.observation_properties r ON r.id='ece619f7-c49a-44f7-999f-a41acf5d4dc3'::uuid AND r.property_key='year' AND r.namespace='core' AND r.data_type='integer' AND r.unit IS NULL AND r.label='Model Year' AND r.ratified_at IS NOT NULL AND r.deprecated_at IS NULL AND 'listing'=ANY(r.applies_to_kinds)
 WHERE p.id=ANY(p_sources) AND public.observation_is_public(p.kind,p.structured_data) AND public.retained_craigslist_year_witness(p) IS NOT NULL
 ON CONFLICT(source_observation_id,property_id) DO NOTHING;
 GET DIAGNOSTICS native_count=ROW_COUNT;n:=n+native_count;
 INSERT INTO public.retained_listing_property_work(source_observation_id,property_id,vehicle_id)
 SELECT p.id,r.id,p.vehicle_id FROM public.vehicle_observations p
 JOIN public.vehicles v ON v.id=p.vehicle_id AND v.is_public IS TRUE AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
 JOIN public.observation_sources src ON src.id=p.source_id AND src.slug='bat' AND 'specification'=ANY(src.supported_observations)
 JOIN public.observation_properties r ON r.id='ece619f7-c49a-44f7-999f-a41acf5d4dc3'::uuid AND r.property_key='year' AND r.namespace='core' AND r.data_type='integer' AND r.unit IS NULL AND r.label='Model Year' AND r.ratified_at IS NOT NULL AND r.deprecated_at IS NULL AND 'specification'=ANY(r.applies_to_kinds)
 WHERE p.id=ANY(p_sources) AND public.observation_is_public(p.kind,p.structured_data) AND public.retained_description_property_witness(p,'year') IS NOT NULL
 ON CONFLICT(source_observation_id,property_id) DO NOTHING;
 GET DIAGNOSTICS native_count=ROW_COUNT;n:=n+native_count;
 INSERT INTO public.retained_listing_property_work(source_observation_id,property_id,vehicle_id)
 SELECT p.id,r.id,p.vehicle_id FROM public.vehicle_observations p
 JOIN public.vehicles v ON v.id=p.vehicle_id AND v.is_public IS TRUE AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
 JOIN public.observation_sources s ON s.id=p.source_id AND s.slug='bat' AND 'specification'=ANY(s.supported_observations)
 CROSS JOIN(VALUES('8d274b73-a8a6-43bf-9036-5864d0152725'::uuid,'make','Make'),('a79b528f-7d9d-46ca-96f9-96d899e81d10'::uuid,'model','Model'))k(id,key,label)
 JOIN public.observation_properties r ON r.id=k.id AND r.property_key=k.key AND r.label=k.label AND r.data_type='string' AND r.unit IS NULL AND r.namespace='core' AND r.deprecated_at IS NULL AND r.ratified_at IS NOT NULL AND 'specification'=ANY(r.applies_to_kinds)
 WHERE p.id=ANY(p_sources) AND public.observation_is_public(p.kind,p.structured_data) AND public.retained_description_property_witness(p,k.key) IS NOT NULL
 ON CONFLICT(source_observation_id,property_id) DO NOTHING;
 GET DIAGNOSTICS native_count=ROW_COUNT;RETURN n+native_count;

END $function$
;
REVOKE ALL ON FUNCTION public.enqueue_retained_listing_properties(uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_retained_listing_properties(uuid[]) TO service_role;
CREATE OR REPLACE FUNCTION public.enqueue_retained_listing_properties(p_source uuid) RETURNS integer
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp SET lock_timeout='500ms' SET statement_timeout='5s' AS $$
 SELECT CASE WHEN p_source IS NULL THEN 0 ELSE public.enqueue_retained_listing_properties(ARRAY[p_source]) END;
$$;
COMMENT ON FUNCTION public.enqueue_retained_listing_properties(uuid[]) IS 'Existing ingest-observation operational work owner, batched500-source PK inputs. Same ratified source/public-parent/witness gates and idempotent source-property keys; native make/model opening-label bindings added. Writes only operational queue, never testimony. 120attempts/minute and2admissions unchanged.';
ALTER TABLE public.retained_listing_property_replay
 ADD COLUMN native_identity_highwater uuid REFERENCES public.vehicle_observations(id),
 ADD COLUMN native_identity_cursor uuid REFERENCES public.vehicle_observations(id),
 ADD COLUMN native_identity_keys_seen bigint NOT NULL DEFAULT 0 CHECK(native_identity_keys_seen>=0),
 ADD COLUMN native_identity_work_seeded bigint NOT NULL DEFAULT 0 CHECK(native_identity_work_seeded>=0),
 ADD COLUMN native_identity_completed_at timestamptz;
UPDATE public.retained_listing_property_replay SET native_identity_highwater=(SELECT source_observation_id FROM public.retained_listing_property_work WHERE property_id='ece619f7-c49a-44f7-999f-a41acf5d4dc3' ORDER BY source_observation_id DESC LIMIT 1),
 native_identity_completed_at=CASE WHEN NOT EXISTS(SELECT FROM public.retained_listing_property_work WHERE property_id='ece619f7-c49a-44f7-999f-a41acf5d4dc3') THEN clock_timestamp() END WHERE id;
COMMENT ON COLUMN public.retained_listing_property_replay.native_identity_highwater IS 'Finite existing-year-work source-PK upper bound when native make/model bindings installed. UUID order is an enumeration key, never a source/event clock. Existing raw replay cursors/receipts remain intact; new native arrivals enqueue directly.';
COMMENT ON COLUMN public.retained_listing_property_replay.native_identity_cursor IS 'Exclusive last examined source UUID in the finite existing-year-parent repair.100repair plus400raw source keys per existing seed; no parallel writer, new cron or capacity.';
COMMENT ON COLUMN public.retained_listing_property_replay.native_identity_keys_seen IS 'Actual existing year work-source keys examined during native identity repair, including unsupported/ineligible/duplicate parents. Not vehicles or usable typed coverage.';
COMMENT ON COLUMN public.retained_listing_property_replay.native_identity_work_seeded IS 'New source-property work keys inserted by native identity repair, not selected canonical field gains or new modeled vehicles.';
COMMENT ON COLUMN public.retained_listing_property_replay.native_identity_completed_at IS 'Recording clock at finite existing-year-parent repair exhaustion. Full-corpus replay, new arrivals and failed admission tasks remain independent.';
CREATE OR REPLACE FUNCTION public.seed_retained_listing_properties()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET lock_timeout TO '500ms'
 SET statement_timeout TO '5s'
AS $function$
DECLARE s record;p record;n integer:=0;seeded integer:=0;direction text;upper_operator text;sources uuid[];repair_keys uuid[];repair_seeded integer:=0;raw_limit integer:=500;
BEGIN
 IF (SELECT count(*) FROM public.retained_listing_property_work WHERE status IN('pending','claimed'))>=500 THEN RETURN 0;END IF;
 SELECT * INTO s FROM public.retained_listing_property_replay WHERE id FOR UPDATE SKIP LOCKED;
 IF NOT FOUND THEN RETURN 0;END IF;
 IF s.native_identity_completed_at IS NULL THEN
  SELECT array_agg(x.source_observation_id ORDER BY x.source_observation_id) INTO repair_keys FROM(
   SELECT q.source_observation_id FROM public.retained_listing_property_work q
   WHERE q.property_id='ece619f7-c49a-44f7-999f-a41acf5d4dc3'
    AND q.source_observation_id>coalesce(s.native_identity_cursor,'00000000-0000-0000-0000-000000000000'::uuid)
    AND q.source_observation_id<=s.native_identity_highwater ORDER BY q.source_observation_id LIMIT 100)x;
  repair_seeded:=public.enqueue_retained_listing_properties(repair_keys);
  UPDATE public.retained_listing_property_replay SET native_identity_cursor=coalesce(repair_keys[cardinality(repair_keys)],native_identity_cursor),
   native_identity_keys_seen=native_identity_keys_seen+coalesce(cardinality(repair_keys),0),
   native_identity_work_seeded=native_identity_work_seeded+repair_seeded,
   native_identity_completed_at=CASE WHEN coalesce(cardinality(repair_keys),0)<100 THEN clock_timestamp() END WHERE id;
  raw_limit:=400;
 END IF;
 IF s.scan_completed_at IS NOT NULL THEN RETURN coalesce(cardinality(repair_keys),0);END IF;
 -- Both tokens are closed constants. Literal ordering and bound operator let
 -- each direction use the existing (kind,ingested_at) index, avoiding a CASE
 -- sort over the baseline or a cached generic OR plan over the unvisited gap.
 direction:=CASE s.scan_direction WHEN 'newest' THEN 'DESC' ELSE 'ASC' END;
 upper_operator:=CASE WHEN s.reverse_cursor_source_id IS NULL THEN '<=' ELSE '<' END;
 FOR p IN EXECUTE format($query$
  SELECT id,ingested_at FROM public.vehicle_observations
  WHERE kind='listing' AND isfinite(ingested_at)
   AND (ingested_at,id)>($1,$2) AND (ingested_at,id) %s ($3,$4)
  ORDER BY ingested_at %s,id %s LIMIT %s$query$,upper_operator,direction,direction,raw_limit)
 USING coalesce(s.cursor_recorded_at,'-infinity'::timestamptz),
  coalesce(s.cursor_source_id,'00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(s.reverse_cursor_recorded_at,s.upper_recorded_at),
  coalesce(s.reverse_cursor_source_id,s.upper_source_id) LOOP
  sources:=array_append(sources,p.id);
  IF s.scan_direction='newest' THEN
   s.reverse_cursor_recorded_at:=p.ingested_at;s.reverse_cursor_source_id:=p.id;
  ELSE s.cursor_recorded_at:=p.ingested_at;s.cursor_source_id:=p.id;END IF;
  n:=n+1;
 END LOOP;
 seeded:=public.enqueue_retained_listing_properties(sources);
 UPDATE public.retained_listing_property_replay SET cursor_recorded_at=s.cursor_recorded_at,
  cursor_source_id=s.cursor_source_id,reverse_cursor_recorded_at=s.reverse_cursor_recorded_at,
  reverse_cursor_source_id=s.reverse_cursor_source_id,scan_direction=CASE s.scan_direction WHEN 'newest' THEN 'oldest' ELSE 'newest' END,
  keys_seen=keys_seen+n,work_seeded=work_seeded+seeded,last_seed_at=clock_timestamp(),
  scan_completed_at=CASE WHEN n<raw_limit THEN clock_timestamp() END WHERE id;
 RETURN n+coalesce(cardinality(repair_keys),0);
END $function$
;
-- A property binding identifies the meaning of a retained column; it does not
-- upgrade that column to sourced testimony, a current physical state or a factory fact.
CREATE OR REPLACE FUNCTION public.retained_vehicle_record_property_bindings(p_record jsonb) RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' AS $$
 WITH fields(origin_column,property_key,normalization_version) AS(VALUES
  ('year','year','retained_record_identity_labels_v1'),('make','make','retained_record_identity_labels_v1'),
  ('model','model','retained_record_identity_labels_v1'),('vin','vin','retained_record_identity_labels_v1'),
  ('trim','trim','retained_record_identity_labels_v1'),('color','exterior_color','retained_record_text_v1'),
  ('interior_color','interior_color','retained_record_text_v1'),
  ('engine_size','engine_configuration','retained_powertrain_v1'),('engine_type','engine_configuration','retained_powertrain_v1'),
  ('engine_size','engine_displacement_l','retained_powertrain_v1'),('transmission','transmission_type','retained_powertrain_v1'),
  ('drivetrain','drivetrain_layout','retained_powertrain_v1')),
 values AS MATERIALIZED(SELECT f.*,p_record->f.origin_column AS source_value,
  CASE WHEN f.normalization_version='retained_powertrain_v1' THEN public.retained_powertrain_value(f.property_key,p_record->f.origin_column)
   WHEN f.property_key IN('year','make','model','vin') THEN public.retained_listing_identity_value(f.property_key,p_record->f.origin_column)
   ELSE public.retained_listing_identity_value('model',p_record->f.origin_column) END AS value FROM fields f),
 bound AS MATERIALIZED(SELECT v.*,r.id AS property_id,r.data_type,r.unit FROM values v JOIN public.observation_properties r
  ON r.property_key=v.property_key AND r.namespace='core' AND r.ratified_at IS NOT NULL AND r.deprecated_at IS NULL AND 'specification'=ANY(r.applies_to_kinds)
  AND r.unit IS NOT DISTINCT FROM CASE WHEN v.property_key='engine_displacement_l' THEN 'liters'::text END
  AND r.data_type=CASE WHEN v.property_key='year' THEN 'integer' WHEN v.property_key='engine_displacement_l' THEN 'numeric'
   WHEN v.property_key IN('transmission_type','drivetrain_layout') THEN 'enum' ELSE 'string' END WHERE v.value IS NOT NULL),
 conflicts AS(SELECT property_id,count(DISTINCT value)>1 AS disagree FROM bound GROUP BY property_id)
 SELECT coalesce(jsonb_agg(jsonb_build_object('property_id',b.property_id,'property_key',b.property_key,'data_type',b.data_type,'unit',b.unit,
  'value',b.value,'origin_relation','vehicles','origin_column',b.origin_column,'source_value',b.source_value,
  'normalization_version',b.normalization_version,'status','retained_record_binding','source_attribution_status','unassayed',
  'claim_role','record_metadata','independent_source',false,'factory_configuration_status','unknown','current_configuration_status','unknown',
  'record_columns_disagree',c.disagree) ORDER BY b.property_key,b.origin_column),'[]'::jsonb)
 FROM bound b JOIN conflicts c ON c.property_id=b.property_id;
$$;
REVOKE ALL ON FUNCTION public.retained_vehicle_record_property_bindings(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.retained_vehicle_record_property_bindings(jsonb) TO anon,authenticated,service_role;
COMMENT ON FUNCTION public.retained_vehicle_record_property_bindings(jsonb) IS 'Existing specification-reader record bindings, not testimony or canonical state: exact literal year/make/model/VIN/trim/color labels and existing deterministic powertrain normalizers over13 named public vehicle columns. Existing ratified property IDs/units only; source values and column disagreements survive. No mileage-miles binding without a unit witness, body-style vocabulary mint, factory assertion, physical identity resolution, record writes, model calls or provenance upgrade.';

-- Every eligible requested record gets a model, including records without claims.
-- Existing public record metadata is identified as unassayed, not promoted to testimony.
CREATE OR REPLACE FUNCTION public.get_vehicle_specs(p_vehicle_ids uuid[],p_include_typed_claims boolean DEFAULT false) RETURNS SETOF jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' SET statement_timeout='10s' AS $$
BEGIN
 IF p_vehicle_ids IS NULL OR cardinality(p_vehicle_ids)=0 THEN RETURN;END IF;
 IF array_ndims(p_vehicle_ids)<>1 OR cardinality(p_vehicle_ids)>200 OR array_position(p_vehicle_ids,NULL) IS NOT NULL THEN
  RAISE EXCEPTION 'Expected at most200 nonnull vehicle keys' USING ERRCODE='22023';END IF;
 IF p_include_typed_claims IS NULL OR (p_include_typed_claims AND cardinality(p_vehicle_ids)>20) THEN RAISE EXCEPTION 'Typed custody reads require at most20 vehicle keys' USING ERRCODE='22023';END IF;
 RETURN QUERY
 WITH requested AS MATERIALIZED(SELECT id,min(ord) AS ord FROM unnest(p_vehicle_ids) WITH ORDINALITY x(id,ord) GROUP BY id),
 gate AS MATERIALIZED(SELECT v.id,r.ord,v.created_at,v.updated_at,
  jsonb_build_object('year',v.year,'make',v.make,'model',v.model,'vin',v.vin,'trim',v.trim,'mileage',v.mileage,
   'color',v.color,'interior_color',v.interior_color,'transmission',v.transmission,'drivetrain',v.drivetrain,
   'engine_type',v.engine_type,'engine_size',v.engine_size,'body_style',v.body_style) AS retained_fields
  FROM requested r JOIN public.vehicles v ON v.id=r.id
  WHERE v.is_public IS TRUE AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'),
 field_contracts(key,data_type) AS(VALUES('year','integer'),('make','string'),('model','string'),('vin','string'),('trim','string'),
  ('mileage','integer'),('color','string'),('interior_color','string'),('transmission','string'),('drivetrain','string'),
  ('engine_type','string'),('engine_size','string'),('body_style','string'))
 SELECT jsonb_build_object('schema_version','vehicle_data_model_v1','vehicle_id',g.id,'read_at',statement_timestamp(),
  'grain','stored_vehicle_record','physical_identity_status','unresolved',
  'retained_record',jsonb_build_object('origin_relation','vehicles','row_created_at',g.created_at,'row_updated_at',g.updated_at,
   'clock_basis','record_maintenance_not_source_event_or_capture','source_attribution_status','unassayed',
   'factory_configuration_status','unknown','current_configuration_status','unknown',
   'property_bindings',public.retained_vehicle_record_property_bindings(g.retained_fields),
   'attributes',(SELECT jsonb_object_agg(f.key,jsonb_build_object('value',g.retained_fields->f.key,'data_type',f.data_type,
    'origin_column',f.key,'unit',NULL,'unit_status','not_established','value_status',CASE WHEN g.retained_fields->f.key IS NULL OR g.retained_fields->f.key='null'::jsonb THEN 'unrecorded' ELSE 'retained_record_value' END)) FROM field_contracts f)),
  'typed_claims_status',CASE WHEN p_include_typed_claims THEN 'current_core_scope_read' ELSE 'not_requested' END,
  'typed_claims',CASE WHEN p_include_typed_claims THEN coalesce((
   SELECT jsonb_agg(jsonb_build_object('property_id',r.id,'property_key',r.property_key,'data_type',r.data_type,'unit',r.unit,
    'value',c.structured_data->r.property_key,'status','current_canonical_claim','observation_id',c.observation_id,
    'source_id',o.source_id,'source_url',o.source_url,'source_observation_id',o.source_observation_id,
    'kind',o.kind,'extraction_method',o.extraction_method,'confidence_score',o.confidence_score,
    'observed_at',o.observed_at,'ingested_at',o.ingested_at,
    'qualifiers',jsonb_strip_nulls(jsonb_build_object(
     'claim_role',c.structured_data->'claim_role','source_profile',c.structured_data->'source_profile',
     'observed_at_basis',c.structured_data->'observed_at_basis','source_event_time_status',c.structured_data->'source_event_time_status',
     'source_recorded_at',c.structured_data->'source_recorded_at','source_observed_at',c.structured_data->'source_observed_at',
     'source_value',c.structured_data->'source_value','normalization_version',c.structured_data->'normalization_version',
     'source_subject_label',c.structured_data->'source_subject_label','source_make_label',c.structured_data->'source_make_label',
     'model_label_scope',c.structured_data->'model_label_scope','identity_resolution_status',c.structured_data->'identity_resolution_status',
     'factory_configuration_status',c.structured_data->'factory_configuration_status','current_configuration_status',c.structured_data->'current_configuration_status',
     'independent_source',c.structured_data->'independent_source','reported_precision_miles',c.structured_data->'reported_precision_miles',
     'value_is_approximate',c.structured_data->'value_is_approximate','reading_role',c.structured_data->'reading_role',
     'true_mileage_status',c.structured_data->'true_mileage_status','limitation',c.structured_data->'limitation')))
    ORDER BY r.property_key)
   FROM (SELECT * FROM public.vehicle_canonical vc WHERE vc.vehicle_id=g.id OFFSET 0)c
   JOIN public.vehicle_observations o ON o.id=c.observation_id AND o.vehicle_id=g.id AND public.observation_is_public(o.kind,o.structured_data)
   JOIN public.observation_properties r ON r.id=c.property_id AND r.namespace='core' AND r.ratified_at IS NOT NULL AND r.deprecated_at IS NULL
    AND r.property_key IN('year','make','model','vin','interior_color','exterior_color','engine_configuration','engine_displacement_l','transmission_type','drivetrain_layout','mileage_miles')
   WHERE CASE WHEN r.data_type IN('string','enum') THEN jsonb_typeof(c.structured_data->r.property_key)='string'
    WHEN r.data_type='numeric' THEN jsonb_typeof(c.structured_data->r.property_key)='number'
    WHEN r.data_type='integer' THEN CASE WHEN jsonb_typeof(c.structured_data->r.property_key)='number'
     THEN (c.structured_data->>r.property_key)::numeric=trunc((c.structured_data->>r.property_key)::numeric) ELSE false END
    ELSE false END),'[]'::jsonb) ELSE '[]'::jsonb END,
  'model_scope',jsonb_build_object('retained_record_fields',13,'record_binding_property_keys',11,'canonical_property_keys',11,'complete_vehicle_model',false,
   'source_event_history','not_reconstructed','retained_metadata_is_typed_testimony',false))
 FROM gate g ORDER BY g.ord;
END $$;
REVOKE ALL ON FUNCTION public.get_vehicle_specs(uuid[],boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_vehicle_specs(uuid[],boolean) TO anon,authenticated,service_role;
COMMENT ON FUNCTION public.get_vehicle_specs(uuid[],boolean) IS 'Existing specification reader bulk overload: at most200 requested public undeleted real vehicle records, including zero-claim records. Optional typed-claim custody reads are capped20 while the observation-property index remains invalid; default metadata-only does not assert zero typed claims.13 explicitly selected primitive record fields keep unassayed origin and unknown units/configuration;11 current type-valid canonical property selectors keep observation/property FKs and qualifiers. No per-record inference, source fetch, testimony writes, private-owner path or completeness promotion. Original scalar reader unchanged.';

DO $finish$ DECLARE f text:=pg_get_functiondef('public.finish_retained_listing_property(uuid,uuid,text,text,uuid)'::regprocedure);a text:='GET DIAGNOSTICS n=ROW_COUNT;RETURN n=1;';BEGIN
 IF cardinality(string_to_array(f,a))<>2 THEN RAISE EXCEPTION 'Completion CAS changed';END IF;
 EXECUTE replace(f,a,'GET DIAGNOSTICS n=ROW_COUNT;IF n=1 AND p_status=''done'' AND p_property=''ece619f7-c49a-44f7-999f-a41acf5d4dc3''::uuid THEN PERFORM public.enqueue_retained_listing_properties(p_source);END IF;RETURN n=1;');
END $finish$;
DO $$ DECLARE j bigint;BEGIN SELECT jobid INTO STRICT j FROM cron.job WHERE jobname='project-retained-listing-properties';PERFORM cron.alter_job(job_id:=j,active:=false);END $$;
NOTIFY pgrst,'reload schema';COMMIT;
