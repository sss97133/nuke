-- Expose admitted properties through the existing profile reader and canonical
-- selection. Source claims never become model projection events or verified
-- mechanical facts by passing through this reader.
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='5s';
DO $$ BEGIN
 IF to_regprocedure('public.get_vehicle_specs(uuid[],boolean,jsonb)') IS NOT NULL THEN
  RAISE EXCEPTION 'Registered source-reader owner collision'; END IF;
END $$;

CREATE FUNCTION public.get_vehicle_specs(p_vehicle_ids uuid[],p_include_typed_claims boolean,p_claim_cursor jsonb)
RETURNS SETOF jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE base jsonb; claims jsonb; page jsonb; unresolved jsonb; contracts jsonb; image_unresolved jsonb;
 vehicle uuid; after_id uuid; page_size integer:=200; next_id uuid; has_more boolean;
 supported text[]:=ARRAY['year','make','model','vin','interior_color','exterior_color',
  'engine_configuration','engine_displacement_l','transmission_type','drivetrain_layout','mileage_miles',
  'engine_family_label','trim','body_style','image_visible_rust_severity','image_visible_paint_stage',
  'image_visible_assembly_state','image_visible_badge_text','image_spid_rpo_codes'];
BEGIN
 IF p_vehicle_ids IS NULL OR cardinality(p_vehicle_ids)=0 THEN RETURN; END IF;
 IF array_ndims(p_vehicle_ids)<>1 OR cardinality(p_vehicle_ids)<>1 OR array_position(p_vehicle_ids,NULL) IS NOT NULL
  OR p_include_typed_claims IS DISTINCT FROM true OR jsonb_typeof(p_claim_cursor) IS DISTINCT FROM 'object'
  OR EXISTS(SELECT FROM jsonb_object_keys(p_claim_cursor) k WHERE k NOT IN ('after','limit')) THEN
  RAISE EXCEPTION 'Source claim page requires one vehicle, typed claims and a cursor object' USING ERRCODE='22023'; END IF;
 IF p_claim_cursor ? 'after' THEN
  IF NOT pg_input_is_valid(p_claim_cursor->>'after','uuid') THEN RAISE EXCEPTION 'Invalid claim cursor' USING ERRCODE='22023'; END IF;
  after_id:=(p_claim_cursor->>'after')::uuid;
 END IF;
 IF p_claim_cursor ? 'limit' THEN
  IF NOT pg_input_is_valid(p_claim_cursor->>'limit','integer') THEN RAISE EXCEPTION 'Invalid page limit' USING ERRCODE='22023'; END IF;
  page_size:=(p_claim_cursor->>'limit')::integer;
  IF page_size NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Page limit must be1..200' USING ERRCODE='22023'; END IF;
 END IF;
 vehicle:=p_vehicle_ids[1];
 -- Preserve the bulk reader's public, undeleted vehicle scope and retained
 -- record contract. Private documents never gain a public route here.
 SELECT r INTO base FROM public.get_vehicle_specs(p_vehicle_ids,false) r;
 IF base IS NULL THEN RETURN; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('property_key',k,'registration',CASE
  WHEN r.id IS NULL THEN 'unregistered' WHEN r.deprecated_at IS NOT NULL THEN 'deprecated'
  WHEN r.namespace<>'core' OR r.ratified_at IS NULL THEN 'pending' ELSE 'registered' END,
  'state_owner','vehicle_canonical','reader','get_vehicle_specs:source_claims_v1') ORDER BY k),'[]') INTO contracts
 FROM unnest(supported) k LEFT JOIN public.observation_properties r ON r.property_key=k;
 WITH candidates AS MATERIALIZED (
  SELECT o.id,o.vehicle_id,o.structured_data,o.kind,o.source_id,o.source_url,o.source_observation_id,
   o.observed_at,o.ingested_at,o.extraction_method,o.agent_model,o.confidence_score,
   r.id AS property_id,r.property_key,r.label,r.data_type,r.unit,r.discriminator_key,
   r.property_key LIKE 'image_%' AS image_scoped
  FROM (SELECT * FROM public.vehicle_canonical c WHERE c.vehicle_id=vehicle OFFSET 0)c
  JOIN public.vehicle_observations o ON o.id=c.observation_id AND o.vehicle_id=vehicle
   AND o.is_superseded IS NOT TRUE AND public.observation_is_public(o.kind,o.structured_data)
  JOIN public.observation_sources source ON source.id=o.source_id
   AND (source.supported_observations IS NULL OR o.kind=ANY(source.supported_observations))
  JOIN public.observation_properties r ON r.id=c.property_id AND r.property_key=ANY(supported)
   AND r.namespace='core' AND r.ratified_at IS NOT NULL AND r.deprecated_at IS NULL AND o.kind=ANY(r.applies_to_kinds)
  LEFT JOIN public.vehicle_images image ON image.id=CASE WHEN r.property_key LIKE 'image_%'
    AND pg_input_is_valid(o.structured_data->>'image_id','uuid') THEN (o.structured_data->>'image_id')::uuid END
   AND image.vehicle_id=vehicle
  WHERE o.observed_at<=statement_timestamp() AND o.ingested_at<=statement_timestamp()
   AND (r.property_key NOT LIKE 'image_%' OR (image.id IS NOT NULL AND image.is_sensitive IS NOT TRUE
    AND image.is_document IS NOT TRUE AND image.doc_flag IS NOT TRUE))
   AND CASE WHEN r.property_key='image_visible_rust_severity' THEN o.structured_data->>r.property_key IN ('none','surface','pitting','perforation')
    WHEN r.property_key='image_visible_paint_stage' THEN o.structured_data->>r.property_key IN ('bare_metal','primer','sealer','base','clear','aged')
    WHEN r.property_key='image_visible_assembly_state' THEN o.structured_data->>r.property_key IN ('stripped','partial','assembled')
    WHEN r.data_type IN ('string','enum') THEN jsonb_typeof(o.structured_data->r.property_key)='string'
    WHEN r.data_type='numeric' THEN jsonb_typeof(o.structured_data->r.property_key)='number'
    WHEN r.data_type='integer' THEN CASE WHEN jsonb_typeof(o.structured_data->r.property_key)='number'
     THEN (o.structured_data->>r.property_key)::numeric=trunc((o.structured_data->>r.property_key)::numeric) ELSE false END
    WHEN r.data_type='jsonb' AND r.property_key='image_spid_rpo_codes' THEN
     CASE WHEN jsonb_typeof(o.structured_data->r.property_key)='array' THEN
      jsonb_array_length(o.structured_data->r.property_key) BETWEEN 1 AND 120
      AND NOT EXISTS(SELECT FROM jsonb_array_elements(o.structured_data->r.property_key)v
       WHERE jsonb_typeof(v)<>'string' OR (v#>>'{}') !~ '^[A-Z0-9]{3}$')
      AND (SELECT count(DISTINCT v) FROM jsonb_array_elements(o.structured_data->r.property_key)v)=jsonb_array_length(o.structured_data->r.property_key)
     ELSE false END
    ELSE false END
 ), image_fields AS MATERIALIZED (
  SELECT property_key,public.get_field_provenance(vehicle,property_key) AS provenance
  FROM (SELECT DISTINCT property_key FROM candidates WHERE image_scoped) f
 ), eligible AS MATERIALIZED (
  SELECT c.*,w.witness,coalesce(alt.disputed,false) AS disputed,coalesce(alt.readings,'[]') AS alternative_readings
  FROM candidates c LEFT JOIN image_fields f USING(property_key)
  LEFT JOIN LATERAL(SELECT w AS witness FROM jsonb_array_elements(coalesce(f.provenance->'image_observations','[]')) w
   WHERE w->>'observation_id'=c.id::text LIMIT 1)w ON c.image_scoped
  LEFT JOIN LATERAL(
   SELECT bool_or(CASE WHEN c.property_key='image_spid_rpo_codes' THEN
    ARRAY(SELECT v FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(a.structured_data->c.property_key)='array'
     THEN a.structured_data->c.property_key ELSE '[]'::jsonb END)v ORDER BY v)
     IS DISTINCT FROM ARRAY(SELECT v FROM jsonb_array_elements_text(c.structured_data->c.property_key)v ORDER BY v)
    ELSE a.structured_data->c.property_key IS DISTINCT FROM c.structured_data->c.property_key END) AS disputed,
    jsonb_agg(jsonb_build_object('observation_id',a.id,'value',a.structured_data->c.property_key,
     'confidence_score',a.confidence_score,'extraction_method',a.extraction_method,'agent_model',a.agent_model)
      ORDER BY a.id) AS readings
   FROM jsonb_array_elements(coalesce(f.provenance->'image_observations','[]')) other
   JOIN public.vehicle_observations a ON a.id=(other->>'observation_id')::uuid AND a.property_id=c.property_id
    AND a.vehicle_id=c.vehicle_id AND a.is_superseded IS NOT TRUE
   WHERE other->>'image_id'=w.witness->>'image_id' AND a.id<>c.id
  )alt ON c.image_scoped
  WHERE NOT c.image_scoped OR w.witness IS NOT NULL
 ), selected AS (
  SELECT * FROM eligible WHERE after_id IS NULL OR id>after_id ORDER BY id LIMIT page_size+1
 ) SELECT coalesce(jsonb_agg(jsonb_build_object('property_id',property_id,'property_key',property_key,'label',label,
  'data_type',data_type,'unit',unit,'value',structured_data->property_key,'status','current_canonical_claim',
  'evidence_state',CASE WHEN disputed THEN 'disputed' WHEN image_scoped THEN 'interpreted' ELSE 'reported' END,
  'alternative_readings',alternative_readings,
  'measurement_scope',CASE WHEN image_scoped THEN 'one_image_reading' ELSE 'attributed_source_claim' END,
  'mechanical_verification','unestablished','observation_id',id,'source_id',source_id,'source_url',source_url,
  'source_observation_id',coalesce(source_observation_id::text,witness->>'source_observation_id'),
  'image_id',witness->>'image_id','image_url',witness->>'image_url',
  'kind',kind,'extraction_method',extraction_method,'agent_model',agent_model,'confidence_score',confidence_score,
  'observed_at',observed_at,'ingested_at',ingested_at,
  'qualifiers',jsonb_strip_nulls(jsonb_build_object('claim_role',structured_data->'claim_role',
   'observed_at_basis',coalesce(structured_data->'observed_at_basis',structured_data->'source_observed_at_basis'),
   'source_value',structured_data->'source_value','normalization_version',structured_data->'normalization_version',
   'independent_source',structured_data->'independent_source','factory_configuration_status','unknown',
   'current_configuration_status','unknown','limitation',coalesce(structured_data->>'limitation',
    CASE WHEN image_scoped THEN 'An image reading does not establish whole-vehicle condition, originality or installed mechanical configuration.'
     ELSE 'A reported source claim does not independently verify installed or factory configuration.' END)))) ORDER BY id),'[]'),
  coalesce((SELECT jsonb_agg(jsonb_build_object('property_key',f.property_key,'reason','source_reader_refused_input_limit'))
   FROM image_fields f WHERE f.provenance#>>'{coverage,status}'='refused_input_limit'),'[]')
  INTO claims,image_unresolved FROM selected;
 -- Refusal remains explicit; an existing provenance input ceiling cannot look
 -- like zero evidence or trigger a fresh paid reading.
 SELECT coalesce(jsonb_agg(jsonb_build_object('property_key',key,'reason',reason)),'[]') INTO unresolved FROM(
  SELECT p->>'property_key' AS key,'property_'||(p->>'registration') AS reason FROM jsonb_array_elements(contracts)p
   WHERE p->>'registration'<>'registered'
 )reasons;
 unresolved:=unresolved||image_unresolved;
 has_more:=jsonb_array_length(claims)>page_size;
 SELECT coalesce(jsonb_agg(v ORDER BY n),'[]') INTO page FROM jsonb_array_elements(claims) WITH ORDINALITY x(v,n) WHERE n<=page_size;
 IF has_more THEN next_id:=(page->(page_size-1)->>'observation_id')::uuid; END IF;
 RETURN NEXT base||jsonb_build_object('typed_claims_status','current_registered_scope_read','typed_claims',page,
  'property_contracts',contracts,'unresolved_properties',unresolved,
  'claim_page',jsonb_build_object('limit',page_size,'has_more',has_more,'next_after',next_id,
   'selection','current_active_sources_each_page','reader','registered_profile_source_claims_v1'),
  'model_scope',base->'model_scope'||jsonb_build_object('canonical_property_keys',NULL,
   'declared_source_property_keys',cardinality(supported),'reader','registered_profile_source_claims_v1','complete_vehicle_model',false));
END $$;
REVOKE ALL ON FUNCTION public.get_vehicle_specs(uuid[],boolean,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_vehicle_specs(uuid[],boolean,jsonb) TO anon,authenticated,service_role;
COMMENT ON FUNCTION public.get_vehicle_specs(uuid[],boolean,jsonb) IS
 'Bounded current source-claim page through existing canonical selection and image provenance/privacy owner. Retains reported/interpreted scope, witness/source IDs and refusal metadata; no model-output minting, mechanical proof or historical replay claim. One public vehicle,1..200claims/page.';

-- Cached intake explicitly accepts defer_analysis=true only. Preserve that
-- scheduling authority in the operational column added by the queue owner.
-- No historical row is rewritten or enrolled by this change.
DO $cached_hold$
DECLARE d text; old_columns text:='agent_tier,agent_model,agent_cost_cents,extraction_method,raw_source_ref,property_id)';
 old_values text:=$v$score,factors,nullif(c->>'agent_tier',''),c->>'agent_model',0,c->>'extraction_method',c->>'raw_source_ref',p.id$v$;
BEGIN
 d:=pg_get_functiondef('public.ingest_cached_image_property_batch(jsonb)'::regprocedure);
 IF encode(sha256(convert_to(d,'UTF8')),'base64') IS DISTINCT FROM 'JKgY6uRVpQciYtpPkUv0VsEuYaNBkqPYM0pPspfAC6E='
  OR (length(d)-length(replace(d,old_columns,'')))/length(old_columns)<>1
  OR (length(d)-length(replace(d,old_values,'')))/length(old_values)<>1 THEN
  RAISE EXCEPTION 'Cached intake owner changed; review scheduling hold'; END IF;
 d:=replace(d,old_columns,'agent_tier,agent_model,agent_cost_cents,extraction_method,raw_source_ref,property_id,analysis_deferred)');
 d:=replace(d,old_values,old_values||',true');
 EXECUTE d;
END $cached_hold$;
NOTIFY pgrst,'reload schema';
COMMIT;
