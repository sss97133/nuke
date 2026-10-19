-- Preserved native listing introduction labels through the existing Model Year meaning.
BEGIN;SET LOCAL statement_timeout='30s';SET LOCAL lock_timeout='1s';
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM cron.job WHERE jobname='project-retained-listing-properties' AND active AND schedule='* * * * *' AND encode(sha256(convert_to(command,'UTF8')),'base64')='w/ElpXz1aw8IfUpuaOrqo4T7qx//QC/kJOCRcCBUho0=') THEN RAISE EXCEPTION 'Listing job changed or owner paused';END IF;
 IF (SELECT count(*) FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND state='active' AND query ~ '(vehicle_observations|retained_listing_property|vehicle_canonical|get_field_provenance)')>2 THEN RAISE EXCEPTION 'Relevant data work active';END IF;
 IF encode(sha256(convert_to(pg_get_functiondef('public.get_field_provenance(uuid,text)'::regprocedure),'UTF8')),'base64') IS DISTINCT FROM '1QnzMJ/fpWbz4PKoVTGhRI9AHIzEGR4tw1ZS2BDBWkQ=' OR
 encode(sha256(convert_to(pg_get_functiondef('public.seed_retained_listing_properties()'::regprocedure),'UTF8')),'base64') IS DISTINCT FROM 'HrG1YTGVqXFKHUHanlgT+6Kw6Ljxo5q9LTLQj4ECHog=' OR
 encode(sha256(convert_to(pg_get_functiondef('public.claim_retained_listing_properties(text,integer)'::regprocedure),'UTF8')),'base64') IS DISTINCT FROM 'ncvsBq569AsAK8l+ZW1NDxa8Mo5eNJsHhFSQ1hd0vfo=' OR
 encode(sha256(convert_to(pg_get_functiondef('public.enqueue_retained_listing_properties(uuid)'::regprocedure),'UTF8')),'base64') IS DISTINCT FROM 'cXR4fOjLssXQC2yce2pdZ5+O4wRArugJu5SMAT7vFsU=' OR
 encode(sha256(convert_to(pg_get_functiondef('public.retained_description_property_witness(public.vehicle_observations,text)'::regprocedure),'UTF8')),'base64') IS DISTINCT FROM 'DJp/hGw90lklOyVkfwR2+/VzU3avdiRD7OK7PL8tijQ=' OR
 encode(sha256(convert_to(pg_get_functiondef('public.trg_enqueue_retained_listing_properties()'::regprocedure),'UTF8')),'base64') IS DISTINCT FROM 'xHctvFszU9qLfSOvsxFsM8FaGRLolR/n34qvRq49k1M=' OR
 encode(sha256(convert_to(pg_get_functiondef('public.retained_listing_property_result_matches(uuid,uuid,uuid)'::regprocedure),'UTF8')),'base64') IS DISTINCT FROM 'bwn7BLm47h02LcHqm2Sg76190q2JXcMXMmD5xOgRXIw=' OR
 encode(sha256(convert_to(pg_get_functiondef('public.validate_retained_listing_property_source()'::regprocedure),'UTF8')),'base64') IS DISTINCT FROM 'cij+DppHCKB1Qtfq/3FbC+7bDJDFAqULXyfJuxf7vjo=' OR
 encode(sha256(convert_to(pg_get_viewdef('public.vehicle_canonical'::regclass,true),'UTF8')),'base64') IS DISTINCT FROM 'IKPz6j1eUahEzCyfqaxyhhaeaZrt06bBZvywC5XdyAg=' OR
 (SELECT encode(sha256(convert_to(pg_get_triggerdef(oid),'UTF8')),'base64') FROM pg_trigger WHERE tgname='retained_listing_property_intake') IS DISTINCT FROM 'FwppbUD0C0DgHcp1oDGZzuuX+detNNrJspeOQ0Yw3tQ=' THEN RAISE EXCEPTION 'Retained source owner changed';END IF;
 IF NOT EXISTS(SELECT FROM public.observation_sources WHERE id='4cdc735c-f117-42f2-889f-ba33805639a5' AND slug='bat' AND 'specification'=ANY(supported_observations)) OR
 NOT EXISTS(SELECT FROM public.observation_properties WHERE id='ece619f7-c49a-44f7-999f-a41acf5d4dc3' AND property_key='year' AND namespace='core' AND label='Model Year' AND data_type='integer' AND unit IS NULL AND deprecated_at IS NULL AND ratified_at IS NOT NULL AND 'specification'=ANY(applies_to_kinds)) THEN RAISE EXCEPTION 'Registered source or ratified year meaning changed';END IF;
 IF NOT EXISTS(SELECT FROM public.retained_listing_property_replay WHERE id AND projection_version='retained_craigslist_year_v1') THEN RAISE EXCEPTION 'Expected year replay unavailable';END IF;
 IF to_regprocedure('public.retained_description_year_text_witness(text)') IS NOT NULL THEN RAISE EXCEPTION 'Native year witness already installed';END IF;
END $$;
CREATE OR REPLACE FUNCTION public.retained_description_year_text_witness(p_text text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path='' AS $$
DECLARE sentence text;m text[];n integer;
BEGIN
 IF p_text IS NULL OR octet_length(p_text) NOT BETWEEN 100 AND 32000 THEN RETURN NULL;END IF;
 sentence:=btrim((regexp_split_to_array(p_text,E'(?<=[.!?])[ \\t\\r\\n]+|[\\r\\n]+'))[1],E' \t\r\n');
 m:=regexp_match(sentence COLLATE pg_catalog."C",$re$(?:^This ([0-9]{4}) ([A-Za-z][A-Za-z0-9 ./'’′+-]{0,119}?) (?:is|was|has|had|remained|features)\y){1,1}?$re$);
 IF m IS NULL OR octet_length(sentence)>500 OR m[2] ~* '\y(engine|motor|transmission|transaxle|gearbox|chassis|frame|body|panel|parts|replica|scale|memorabilia|artwork|collection)\y'
  OR m[2] ~* '^model\y' THEN RETURN NULL;END IF;
 n:=m[1]::integer;IF n NOT BETWEEN 1800 AND 2100 THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('value',n,'source_value',sentence,'source_year_token',m[1],'source_subject_label',m[2]);
END $$;

CREATE OR REPLACE FUNCTION public.retained_description_year_value_matches(p public.vehicle_observations,o public.vehicle_observations) RETURNS boolean
LANGUAGE plpgsql STABLE PARALLEL SAFE SET search_path='' AS $$
DECLARE w jsonb:=public.retained_description_property_witness(p,'year');d jsonb:=o.structured_data;
BEGIN
 IF w IS NULL THEN RETURN false;END IF;
 RETURN coalesce(o.id<>p.id AND o.source_observation_id=p.id AND o.vehicle_id=p.vehicle_id AND o.source_id=p.source_id AND o.source_url=p.source_url
  AND o.kind::text='specification' AND o.is_superseded IS FALSE AND o.subject_type='vehicle' AND o.subject_id IS NULL
  AND o.extraction_method='retained_listing_property_projection_v1' AND o.observed_at=p.ingested_at
  AND o.property_id='ece619f7-c49a-44f7-999f-a41acf5d4dc3'::uuid
  AND o.source_identifier='retained_listing_year_v1:'||p.id::text AND o.raw_source_ref='vehicle_observations:'||p.id::text
  AND o.confidence_score BETWEEN 0 AND 0.6 AND o.agent_cost_cents=0 AND o.agent_model IS NULL AND o.content_hash IS NOT NULL
  AND d->'year'=w->'value' AND d->'source_value'=w->'source_value' AND d->'source_year_token'=w->'source_year_token'
  AND d->'source_subject_label'=w->'source_subject_label'
  AND d->>'source_profile'='bat_description_year_label_v1' AND d->>'year_label_basis'='native_listing_subject_introduction'
  AND d->>'identity_role'='extractor_vehicle_label' AND d->>'identity_resolution_status'='unverified'
  AND d->>'normalization_version'='retained_description_year_label_v1' AND d->>'source_witness_version'='retained_description_year_label_v1'
  AND d->'source_capture_sha256'=p.structured_data->'source_capture_sha256'
  AND d->>'source_observation_id'=p.id::text AND d->>'property_key'='year' AND d->>'source_field'='content_text'
  AND d->>'analysis_kind'='retained_listing_property_projection' AND d->>'projection_version'='retained_listing_year_v1' AND d->>'claim_role'='listing_claim'
  AND d->>'observed_at_basis'='source_testimony_recorded_at' AND d->>'source_extraction_method'=p.extraction_method
  AND CASE WHEN pg_catalog.pg_input_is_valid(d->>'source_recorded_at','timestamptz') AND pg_catalog.pg_input_is_valid(d->>'source_observed_at','timestamptz')
   THEN (d->>'source_recorded_at')::timestamptz=p.ingested_at AND (d->>'source_observed_at')::timestamptz=p.observed_at ELSE false END
  AND d->'source_confidence_score'=to_jsonb(p.confidence_score)
  AND d->>'source_event_time_status'='unknown' AND d->>'factory_configuration_status'='unknown' AND d->>'current_configuration_status'='unknown'
  AND d->'independent_source'='false'::jsonb,false);
END $$;

CREATE OR REPLACE FUNCTION public.retained_description_year_matches(p public.vehicle_observations,o public.vehicle_observations) RETURNS boolean
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT coalesce(public.retained_description_year_value_matches(p,o) AND public.observation_is_public(p.kind,p.structured_data)
  AND EXISTS(SELECT FROM public.vehicles v WHERE v.id=p.vehicle_id AND v.is_public IS TRUE AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item')
  AND EXISTS(SELECT FROM public.observation_sources s WHERE s.id=p.source_id AND s.slug='bat' AND 'specification'=ANY(s.supported_observations))
  AND EXISTS(SELECT FROM public.observation_properties r WHERE r.id=o.property_id AND r.property_key='year' AND r.namespace='core' AND r.label='Model Year' AND r.data_type='integer'
    AND r.unit IS NULL AND r.ratified_at IS NOT NULL AND r.deprecated_at IS NULL AND 'specification'=ANY(r.applies_to_kinds)),false);
$$;
REVOKE ALL ON FUNCTION public.retained_description_year_text_witness(text),public.retained_description_year_value_matches(public.vehicle_observations,public.vehicle_observations),public.retained_description_year_matches(public.vehicle_observations,public.vehicle_observations) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.retained_description_year_text_witness(text),public.retained_description_year_value_matches(public.vehicle_observations,public.vehicle_observations),public.retained_description_year_matches(public.vehicle_observations,public.vehicle_observations) TO anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.retained_description_property_witness(p vehicle_observations, p_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE d jsonb:=p.structured_data; captured timestamptz;
BEGIN
 IF p.kind::text IS DISTINCT FROM 'listing' OR p.extraction_method IS DISTINCT FROM 'html_description_capture'
  OR p.is_superseded IS DISTINCT FROM false OR p.property_id IS NOT NULL OR p.subject_type IS DISTINCT FROM 'vehicle' OR p.subject_id IS NOT NULL
  OR p.source_url IS NULL OR p.source_url !~ '^https://bringatrailer[.]com/listing/[^/?#]+/?$'
  OR p.confidence_score IS NULL OR p.confidence_score NOT BETWEEN 0.6 AND 1
  OR p.observed_at IS NULL OR NOT isfinite(p.observed_at) OR p.ingested_at IS NULL OR NOT isfinite(p.ingested_at)
  OR d->>'extractor' IS DISTINCT FROM 'extract-bat-core'
  OR d->>'source_text_field' IS DISTINCT FROM 'extract-bat-core.extractDescription'
  OR d->'description_capture' IS DISTINCT FROM 'true'::jsonb OR d->'extractor_input_truncated' IS DISTINCT FROM 'false'::jsonb
  OR d->>'source_capture_basis' IS NULL OR d->>'source_capture_basis' NOT IN('direct_fetch','protected_snapshot')
  OR d->>'source_capture_sha256' IS NULL OR d->>'source_capture_sha256' !~ '^[0-9a-f]{64}$'
  OR d->>'observation_time_basis' IS DISTINCT FROM 'source_capture' OR d->>'source_event_time_status' IS DISTINCT FROM 'unknown'
  OR d->>'source_captured_at' IS NULL OR d->>'source_captured_at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?(Z|[+]00:00)$' THEN RETURN NULL; END IF;
 BEGIN captured:=(d->>'source_captured_at')::timestamptz;
 EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN NULL; END;
 IF captured IS DISTINCT FROM p.observed_at OR captured>p.ingested_at THEN RETURN NULL; END IF;
 RETURN CASE WHEN p_key='year' THEN public.retained_description_year_text_witness(p.content_text) WHEN p_key='mileage_miles' THEN public.retained_odometer_witness(p.content_text)
  WHEN p_key IN('interior_color','exterior_color','drivetrain_layout') THEN public.retained_description_presentation_witness(p_key,p.content_text)
  ELSE public.retained_description_powertrain_witness(p_key,p.content_text) END;
END $function$
;
CREATE OR REPLACE FUNCTION public.get_field_provenance(p_vehicle_id uuid, p_field text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with gate as (
    select v.* from public.vehicles v
    where v.id = p_vehicle_id
      and (v.is_public = true
           or auth.uid() in (v.user_id, v.owner_id, v.uploaded_by))
  ),
  prov as (
    select primary_source, total_confidence
    from public.vehicle_field_provenance
    where vehicle_id = p_vehicle_id and field_name = p_field
    limit 1
  ), visible_images as materialized (
    select i.id, i.image_url
    from public.vehicle_images i
    where i.vehicle_id = p_vehicle_id and exists (select 1 from gate)
      and nullif(btrim(i.image_url), '') is not null
      and i.is_sensitive is not true and i.is_superseded is not true
      and i.is_duplicate is not true
      and (i.vision_gate_status is null or i.vision_gate_status::text = 'approved')
      and coalesce(i.image_vehicle_match_status, '') not in ('mismatch', 'unrelated')
  ), field_observations as materialized (
    select o.*, s.slug as source_slug, s.base_trust_score as source_trust,
           case when o.structured_data->>'image_id'
             ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             then (o.structured_data->>'image_id')::uuid end as legacy_image_id
    from public.vehicle_observations o
    left join public.observation_sources s on s.id = o.source_id
    -- One original-source PK lookup per cached claim. Do not expose an eligible
    -- sanitized child after its full original is restricted, superseded or moved.
    left join public.vehicle_observations a on a.id = case
      when o.structured_data->>'source_observation_id'
        ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then (o.structured_data->>'source_observation_id')::uuid end
    where o.vehicle_id = p_vehicle_id and o.is_superseded is not true
      and o.structured_data ? p_field
      and (o.source_observation_id IS NULL OR o.structured_data->>'property_key'=p_field)
 AND (o.source_observation_id IS NULL OR EXISTS (SELECT FROM public.vehicle_observations dp WHERE dp.id=o.source_observation_id AND (public.retained_description_property_matches(dp,o) OR public.retained_listing_identity_matches(dp,o) OR public.retained_craigslist_odometer_matches(dp,o) OR public.retained_craigslist_year_matches(dp,o) OR public.retained_description_year_matches(dp,o))) OR EXISTS (
   SELECT 1 FROM public.vehicle_observations rp
   JOIN public.observation_sources rs ON rs.id=rp.source_id AND rs.slug='bat'
   JOIN public.vehicles rv ON rv.id=rp.vehicle_id AND rv.is_public IS TRUE
     AND rv.deleted_at IS NULL AND rv.listing_kind IS DISTINCT FROM 'non_vehicle_item'
   JOIN public.observation_properties rk ON rk.id=o.property_id AND rk.property_key IN ('interior_color','exterior_color','engine_configuration','engine_displacement_l','transmission_type','drivetrain_layout')
     AND rk.namespace='core' AND rk.deprecated_at IS NULL
   WHERE rp.id=o.source_observation_id AND rp.id<>o.id AND rp.vehicle_id=o.vehicle_id
     AND rp.source_id=o.source_id AND rp.source_url=o.source_url AND rp.kind::text='listing'
     AND rp.is_superseded IS FALSE AND rp.property_id IS NULL
     AND rp.subject_type='vehicle' AND rp.subject_id IS NULL AND rp.extraction_method='html_match'
     AND rp.source_url ~ '^https://bringatrailer[.]com/listing/[^/?#]+/?$'
     AND rp.confidence_score BETWEEN 0.6 AND 1 AND isfinite(rp.ingested_at)
     AND o.kind::text='specification' AND o.extraction_method='retained_listing_property_projection_v1'
     AND o.structured_data->>'source_observation_id'=rp.id::text
     AND o.structured_data->rk.property_key=CASE WHEN rk.property_key IN ('interior_color','exterior_color') THEN rp.structured_data->(CASE rk.property_key WHEN 'exterior_color' THEN 'color' ELSE 'interior_color' END)
 ELSE public.retained_powertrain_value(rk.property_key,rp.structured_data->(CASE rk.property_key WHEN 'transmission_type' THEN 'transmission' WHEN 'drivetrain_layout' THEN 'drivetrain' ELSE 'engine_size' END)) END
 AND (rk.property_key IN ('interior_color','exterior_color') OR
  (o.structured_data->'source_value'=rp.structured_data->(CASE rk.property_key WHEN 'transmission_type' THEN 'transmission' WHEN 'drivetrain_layout' THEN 'drivetrain' ELSE 'engine_size' END)
   AND o.structured_data->>'normalization_version'='retained_powertrain_v1'))
     AND o.structured_data->>'claim_role'='listing_claim'
     AND o.structured_data->>'observed_at_basis'='source_testimony_recorded_at'
     AND o.observed_at=rp.ingested_at AND o.confidence_score BETWEEN 0 AND 0.6
 ))

      and (not coalesce((o.extraction_method='cached_byok_property_projection_v1' OR o.structured_data->>'analysis_kind'='image_property_projection' OR o.structured_data->>'projection_version'='byok_image_properties_v1'),false) or coalesce(EXISTS(SELECT 1 FROM gate g WHERE g.is_public IS TRUE
          AND g.deleted_at IS NULL AND coalesce(g.listing_kind,'')<>'non_vehicle_item')
        AND a.id IS NOT NULL AND a.vehicle_id=o.vehicle_id AND a.kind::text='condition'
        AND a.is_superseded IS NOT TRUE AND public.observation_is_public(a.kind,a.structured_data)
        AND a.structured_data->>'analysis_kind'='image_deep_byok'
        AND a.structured_data->>'image_id'=o.structured_data->>'image_id'
        AND a.structured_data->>'scene_type' IS DISTINCT FROM 'receipt_document'
        AND a.structured_data->'needs_review' IS DISTINCT FROM 'true'::jsonb
        AND a.structured_data->'needs_clarification' IS DISTINCT FROM 'true'::jsonb
        AND (NOT a.structured_data ? 'attribution_doubt' OR a.structured_data->'attribution_doubt' IN ('null'::jsonb,'false'::jsonb,'0'::jsonb,'""'::jsonb))
        AND a.confidence::text IS DISTINCT FROM 'low' AND a.confidence_score BETWEEN 0.6 AND 1
        AND nullif(btrim(a.agent_model),'') IS NOT NULL AND nullif(btrim(a.extraction_method),'') IS NOT NULL
        AND isfinite(a.ingested_at) AND o.kind::text='condition'
        AND o.extraction_method='cached_byok_property_projection_v1'
        AND o.structured_data->>'analysis_kind'='image_property_projection'
        AND o.structured_data->>'projection_version'='byok_image_properties_v1'
        AND o.structured_data->>'property_key'=p_field
        AND p_field IN ('image_visible_rust_severity','image_visible_paint_stage','image_visible_assembly_state')
        AND o.structured_data->p_field=a.structured_data->'state_observations'->
          CASE p_field WHEN 'image_visible_rust_severity' THEN 'rust_severity'
            WHEN 'image_visible_paint_stage' THEN 'paint_state' ELSE 'completeness' END
        AND o.confidence_score BETWEEN 0 AND 0.6
        AND o.structured_data->>'claim_role'='inferred'
        AND o.structured_data->>'source_family'='image:'||(o.structured_data->>'image_id')
        AND o.structured_data->'source_model_confidence'=to_jsonb(a.confidence_score)
        AND o.agent_model=a.agent_model
        AND o.structured_data->>'source_extraction_method'=a.extraction_method
        AND o.raw_source_ref='vehicle_observations:'||a.id::text
        AND o.structured_data->>'source_result_hash' ~ '^[0-9a-f]{64}$'
        AND o.source_identifier='byok_image_properties_v1:'||a.id::text||':'||
          (o.structured_data->>'source_result_hash')||':'||p_field
        AND o.structured_data->>'observed_at_basis'='source_testimony_recorded_at'
        AND o.structured_data->'capture_at'='null'::jsonb AND o.structured_data->'analyzed_at'='null'::jsonb
        AND o.observed_at=a.ingested_at
        AND CASE WHEN pg_catalog.pg_input_is_valid(o.structured_data->>'source_recorded_at','timestamptz')
          AND (o.structured_data->>'source_observed_at' IS NULL OR
            pg_catalog.pg_input_is_valid(o.structured_data->>'source_observed_at','timestamptz'))
          THEN (o.structured_data->>'source_recorded_at')::timestamptz=a.ingested_at
            AND (o.structured_data->>'source_observed_at')::timestamptz IS NOT DISTINCT FROM a.observed_at
          ELSE false END, false))
      and (public.observation_is_public(o.kind,o.structured_data)
           or exists (select 1 from gate g where auth.uid() in (g.user_id,g.owner_id,g.uploaded_by)))
  ), image_observations as (
    -- Typed derived edges are authoritative when present. Visibility is checked
    -- again at read time; a hidden typed edge must not reopen a JSON fallback.
    select o.*, w.id as witness_id, w.witness_role,
           i.id as visible_image_id, i.image_url as visible_image_url
    from field_observations o
    join public.observation_witnesses w on w.observation_id = o.id and w.witness_role = 'derived'
      and (o.extraction_method is distinct from 'cached_byok_property_projection_v1'
        or w.image_id = o.legacy_image_id)
    join visible_images i on i.id = w.image_id
    union all
    select o.*, null::uuid as witness_id, null::text as witness_role,
           i.id as visible_image_id, i.image_url as visible_image_url
    from field_observations o
    join visible_images i on i.id = o.legacy_image_id
    where not exists (select 1 from public.observation_witnesses w
      where w.observation_id = o.id and w.witness_role = 'derived')
  ), readable_observations as (
    select o.* from field_observations o
    where (not (o.structured_data ? 'image_id') and not exists (
      select 1 from public.observation_witnesses w
      where w.observation_id = o.id and w.witness_role = 'derived'))
      or exists (select 1 from image_observations i where i.id = o.id)
  ), readable_observation_rows as materialized (
    select o.* from readable_observations o limit 1001
  ), readable_image_rows as materialized (
    select o.* from image_observations o limit 1001
  ), evidence_rows as materialized (
          select jsonb_build_object(
            'source','vehicle_field_sources','value',fs.field_value,
            'source_type',fs.source_type,'confidence',fs.confidence_score,
            'verified',fs.is_verified,'reasoning',fs.ai_reasoning,
            'image_id',i.id,'at',fs.created_at) as e
          from public.vehicle_field_sources fs
          left join visible_images i on i.id = fs.source_image_id
          where fs.vehicle_id = p_vehicle_id and fs.field_name = p_field
            and coalesce(fs.field_value,'') <> ''
          union all
          select jsonb_build_object(
            'source','field_evidence','value',fe.proposed_value,
            'source_type',fe.source_type,'confidence',fe.source_confidence,
            'verified',(fe.status='accepted'),'reasoning',fe.extraction_context,
            'image_id',i.id,'at',fe.created_at) as e
          from public.field_evidence fe
          left join visible_images i on i.id = case
            when fe.raw_extraction_data->>'photo_id'
              ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            then (fe.raw_extraction_data->>'photo_id')::uuid end
          where fe.vehicle_id = p_vehicle_id and fe.field_name = p_field
            and coalesce(fe.proposed_value,'') <> '' and fe.status <> 'superseded' and fe.status not like 'rejected%'
    limit 1001
  ), coverage as materialized (
    -- Count only the exact collections permitted by the original reader. Raw
    -- private/unrelated rows must not turn public coverage into a size oracle.
    select (select count(*) from readable_observation_rows)<=1000
       and (select count(*) from readable_image_rows)<=1000
       and (select count(*) from evidence_rows)<=1000 as admitted
  ), coverage_receipt as (
    select jsonb_build_object('contract','field_provenance_aggregate_cap_v1',
      'status',case when admitted then 'complete_current_reader' else 'refused_input_limit' end,
      'collectionRowLimit',1000,'bound','returned_collection_cardinality_only',
      'scanRowsBounded',false,'responseBytesBounded',false) as receipt from coverage
  )
  select case when not exists (select 1 from gate) then null
    when not (select admitted from coverage) then jsonb_build_object(
      'field',p_field,'vehicle_id',p_vehicle_id,'value',null,
      'inline_source',null,'inline_confidence',null,'source_image_url',null,
      'evidence','[]'::jsonb,'observations','[]'::jsonb,'image_observations','[]'::jsonb,
      'coverage',(select receipt from coverage_receipt))
    else jsonb_build_object(
    'coverage',(select receipt from coverage_receipt),
    'field', p_field,
    'vehicle_id', p_vehicle_id,
    'value',             (select to_jsonb(g)->>p_field                          from gate g),
    -- inline source falls back to the consensus primary_source (vehicle_field_provenance)
    'inline_source', coalesce(
        (select to_jsonb(g)->>(p_field||'_source')     from gate g),
        (select primary_source from prov)),
    'inline_confidence', coalesce(
        (select to_jsonb(g)->>(p_field||'_confidence') from gate g),
        (select total_confidence::text from prov)),
    -- source image falls back to the cited field_evidence row's photo
    'source_image_url', coalesce(
        (select i.image_url from visible_images i
          where i.id = case
            when (select to_jsonb(g)->>(p_field||'_source_image_id') from gate g)
              ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            then (select to_jsonb(g)->>(p_field||'_source_image_id') from gate g)::uuid end),
        (select i.image_url from public.field_evidence fe
          join visible_images i on
            i.id = case when fe.raw_extraction_data->>'photo_id'
              ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then (fe.raw_extraction_data->>'photo_id')::uuid end
            or (not (fe.raw_extraction_data ? 'photo_id')
                and i.image_url = fe.raw_extraction_data->>'image_url')
          where fe.vehicle_id = p_vehicle_id and fe.field_name = p_field
            and fe.status <> 'superseded' and fe.status not like 'rejected%'
          order by fe.source_confidence desc nulls last limit 1)),
    -- evidence = vehicle_field_sources ∪ field_evidence (the consensus pipeline), highest confidence first
    'evidence', coalesce((select jsonb_agg(e order by (e->>'confidence')::numeric desc nulls last)
      from evidence_rows), '[]'::jsonb),
    'observations', coalesce((
        select jsonb_agg(jsonb_build_object(
            'id',o.id,'content',left(o.content_text,400),
            'source_field',o.structured_data->>'source_field',
            'source_value',o.structured_data->'source_value',
            'normalization_version',o.structured_data->>'normalization_version',
            'source_witness_version',o.structured_data->>'source_witness_version',
            'source_reading_value',o.structured_data->'source_reading_value',
            'source_reading_unit',o.structured_data->>'source_reading_unit',
            'reported_precision_miles',o.structured_data->'reported_precision_miles',
            'value_is_approximate',o.structured_data->'value_is_approximate',
            'source_year_token',o.structured_data->>'source_year_token','source_subject_label',o.structured_data->>'source_subject_label','year_label_basis',o.structured_data->>'year_label_basis','reading_role',o.structured_data->>'reading_role','source_profile',o.structured_data->>'source_profile','reading_unit_basis',o.structured_data->>'reading_unit_basis','source_native_post_id',o.structured_data->>'source_native_post_id','odometer_broken',o.structured_data->'odometer_broken','odometer_rolled_over',o.structured_data->'odometer_rolled_over',
            'true_mileage_status',o.structured_data->>'true_mileage_status',
            'source_observed_at_basis',o.structured_data->>'source_observed_at_basis',
            'source_event_time_status',o.structured_data->>'source_event_time_status',
            'vin_identifier_namespace',o.structured_data->>'vin_identifier_namespace','vin_format_status',o.structured_data->>'vin_format_status','vin_checksum_status',o.structured_data->>'vin_checksum_status',
            'identity_role',o.structured_data->>'identity_role','identity_resolution_status',o.structured_data->>'identity_resolution_status',
            'source_capture_sha256',o.structured_data->>'source_capture_sha256',
            'claim_role',o.structured_data->>'claim_role',
            'independent_source',o.structured_data->'independent_source',
            'factory_configuration_status',o.structured_data->>'factory_configuration_status',
            'current_configuration_status',o.structured_data->>'current_configuration_status',
            'value',o.structured_data->>p_field,'confidence',o.confidence_score,
            'observed_at',o.observed_at,'ingested_at',o.ingested_at,
            'source_observation_id',o.structured_data->>'source_observation_id',
            'source_extraction_method',o.structured_data->>'source_extraction_method',
            'source_model_confidence',o.structured_data->'source_model_confidence',
            'source_recorded_at',o.structured_data->>'source_recorded_at',
            'source_observed_at',o.structured_data->>'source_observed_at',
            'observed_at_basis',o.structured_data->>'observed_at_basis',
            'capture_at',o.structured_data->'capture_at','analyzed_at',o.structured_data->'analyzed_at',
            'extraction_method',o.extraction_method,'agent_model',o.agent_model,'kind',o.kind::text,
            'source_slug',o.source_slug,'trust',o.source_trust,'source_url',o.source_url)
            order by o.confidence_score desc nulls last,o.observed_at desc nulls last,o.ingested_at desc,o.id)
        from readable_observation_rows o), '[]'::jsonb),
    'image_observations', coalesce((
        select jsonb_agg(jsonb_build_object(
            'observation_id',o.id,'image_id',o.visible_image_id,
            'witness_id',o.witness_id,'witness_role',o.witness_role,
            'image_url',o.visible_image_url,'value',o.structured_data->>p_field,
            'source_slug',o.source_slug,'source_url',o.source_url,
            'source_observation_id',o.structured_data->>'source_observation_id',
            'source_extraction_method',o.structured_data->>'source_extraction_method',
            'source_model_confidence',o.structured_data->'source_model_confidence',
            'source_recorded_at',o.structured_data->>'source_recorded_at',
            'source_observed_at',o.structured_data->>'source_observed_at',
            'observed_at_basis',o.structured_data->>'observed_at_basis',
            'capture_at',o.structured_data->'capture_at','analyzed_at',o.structured_data->'analyzed_at',
            'extraction_method',o.extraction_method,'agent_model',o.agent_model,
            'observed_at',o.observed_at,'ingested_at',o.ingested_at,
            'confidence',o.confidence_score,
            'claim_role',o.structured_data->>'claim_role',
            'image_region',o.structured_data->'image_region',
            'reference',o.structured_data->'reference',
            'source_family',o.structured_data->>'source_family',
            'visual_relation',o.structured_data->>'visual_relation',
            'limitation',coalesce(o.structured_data->>'limitation',o.extraction_metadata->>'limitation'),
            'is_inferred',coalesce(o.structured_data->'is_inferred',o.extraction_metadata->'is_inferred'))
            order by o.confidence_score desc nulls last, o.ingested_at desc, o.id)
        from readable_image_rows o), '[]'::jsonb)
  ) end
$function$
;
CREATE OR REPLACE FUNCTION public.retained_listing_property_result_matches(p_source uuid, p_property uuid, p_result uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '3s'
AS $function$
 SELECT EXISTS(SELECT FROM public.vehicle_observations p JOIN public.vehicle_observations o ON o.id=p_result
  WHERE p.id=p_source AND o.property_id=p_property AND (public.retained_description_property_matches(p,o) OR public.retained_listing_identity_matches(p,o) OR public.retained_craigslist_odometer_matches(p,o) OR public.retained_craigslist_year_matches(p,o) OR public.retained_description_year_matches(p,o))) OR EXISTS(SELECT 1 FROM public.vehicle_observations o
 JOIN public.vehicle_observations p ON p.id=p_source
 JOIN public.vehicles v ON v.id=p.vehicle_id AND v.is_public IS TRUE AND v.deleted_at IS NULL
  AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
 JOIN public.observation_sources s ON s.id=p.source_id AND s.slug='bat'
 JOIN public.observation_properties r ON r.id=p_property AND r.namespace='core' AND r.deprecated_at IS NULL
 WHERE o.id=p_result AND o.id<>p.id AND o.source_observation_id=p.id AND o.property_id=r.id
 AND o.vehicle_id=p.vehicle_id AND o.source_id=p.source_id AND o.source_url=p.source_url
 AND p.kind='listing' AND p.extraction_method='html_match' AND p.is_superseded IS FALSE
 AND p.property_id IS NULL AND p.subject_type='vehicle' AND p.subject_id IS NULL
 AND p.source_url ~ '^https://bringatrailer[.]com/listing/[^/?#]+/?$'
 AND p.confidence_score BETWEEN 0.6 AND 1 AND isfinite(p.ingested_at)
 AND (p.observed_at IS NULL OR isfinite(p.observed_at))
 AND o.kind='specification' AND o.is_superseded IS FALSE AND o.subject_type='vehicle' AND o.subject_id IS NULL
 AND o.extraction_method='retained_listing_property_projection_v1' AND o.observed_at=p.ingested_at
 AND o.raw_source_ref='vehicle_observations:'||p.id::text AND o.confidence_score BETWEEN 0 AND 0.6
 AND o.agent_cost_cents=0 AND o.content_hash IS NOT NULL
 AND r.property_key IN('interior_color','exterior_color','engine_configuration','engine_displacement_l','transmission_type','drivetrain_layout') AND 'specification'=ANY(r.applies_to_kinds)
 AND o.source_identifier='retained_listing_'||r.property_key||'_v1:'||p.id::text
 AND o.structured_data->>'source_observation_id'=p.id::text
 AND o.structured_data->>'property_key'=r.property_key AND o.structured_data->>'claim_role'='listing_claim'
 AND o.structured_data->>'observed_at_basis'='source_testimony_recorded_at'
 AND o.structured_data->>'source_field'=CASE r.property_key WHEN 'exterior_color' THEN 'color' WHEN 'interior_color' THEN 'interior_color'
  WHEN 'transmission_type' THEN 'transmission' WHEN 'drivetrain_layout' THEN 'drivetrain' ELSE 'engine_size' END
 AND ((r.property_key IN('interior_color','exterior_color') AND o.structured_data->r.property_key=p.structured_data->(CASE r.property_key WHEN 'exterior_color' THEN 'color' WHEN 'interior_color' THEN 'interior_color'
  WHEN 'transmission_type' THEN 'transmission' WHEN 'drivetrain_layout' THEN 'drivetrain' ELSE 'engine_size' END)) OR
  (r.property_key IN('engine_configuration','engine_displacement_l','transmission_type','drivetrain_layout')
   AND o.structured_data->r.property_key=public.retained_powertrain_value(r.property_key,p.structured_data->(CASE r.property_key WHEN 'exterior_color' THEN 'color' WHEN 'interior_color' THEN 'interior_color'
  WHEN 'transmission_type' THEN 'transmission' WHEN 'drivetrain_layout' THEN 'drivetrain' ELSE 'engine_size' END))
   AND o.structured_data->'source_value'=p.structured_data->(CASE r.property_key WHEN 'exterior_color' THEN 'color' WHEN 'interior_color' THEN 'interior_color'
  WHEN 'transmission_type' THEN 'transmission' WHEN 'drivetrain_layout' THEN 'drivetrain' ELSE 'engine_size' END)
   AND o.structured_data->>'normalization_version'='retained_powertrain_v1'))
 AND o.structured_data->>'projection_version'='retained_listing_'||r.property_key||'_v1'
 AND o.structured_data->>'analysis_kind'='retained_listing_property_projection'
 AND (o.structured_data->>'source_recorded_at')::timestamptz=p.ingested_at
 AND (o.structured_data->>'source_observed_at')::timestamptz IS NOT DISTINCT FROM p.observed_at
 AND o.structured_data->'source_confidence_score'=to_jsonb(p.confidence_score)
 AND o.structured_data->>'source_extraction_method'=p.extraction_method
 AND o.structured_data->>'factory_configuration_status'='unknown'
 AND o.structured_data->>'current_configuration_status'='unknown'
 AND o.structured_data->'independent_source'='false'::jsonb);
$function$
;
CREATE OR REPLACE FUNCTION public.validate_retained_listing_property_source()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE p public.vehicle_observations%ROWTYPE; v_property_key text; source_field text; projection_mode text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- Corrections use sanctioned supersession; never mutate the derived tuple.
    IF OLD.source_observation_id IS NOT NULL AND
      ROW(NEW.id,NEW.source_observation_id,NEW.vehicle_id,NEW.kind,NEW.property_id,NEW.subject_type,NEW.subject_id,
        NEW.source_id,NEW.source_url,NEW.source_identifier,NEW.raw_source_ref,NEW.observed_at,NEW.ingested_at,
        NEW.extraction_method,NEW.confidence_score,NEW.structured_data,NEW.content_hash,NEW.content_text)
      IS DISTINCT FROM
      ROW(OLD.id,OLD.source_observation_id,OLD.vehicle_id,OLD.kind,OLD.property_id,OLD.subject_type,OLD.subject_id,
        OLD.source_id,OLD.source_url,OLD.source_identifier,OLD.raw_source_ref,OLD.observed_at,OLD.ingested_at,
        OLD.extraction_method,OLD.confidence_score,OLD.structured_data,OLD.content_hash,OLD.content_text) THEN
      RAISE EXCEPTION 'retained property source tuple is immutable' USING ERRCODE='23514';
    END IF;
    IF OLD.source_observation_id IS NOT DISTINCT FROM NEW.source_observation_id THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'retained source links are assigned only on insert' USING ERRCODE='23514';
  END IF;
  IF NEW.source_observation_id IS NULL THEN
    IF NEW.extraction_method='retained_listing_property_projection_v1' THEN
      RAISE EXCEPTION 'retained projection requires typed source' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  v_property_key := NEW.structured_data->>'property_key';
  IF v_property_key IN('year','make','model','vin') THEN
    SELECT * INTO p FROM public.vehicle_observations WHERE id=NEW.source_observation_id FOR SHARE;
    IF NOT FOUND OR NOT (public.retained_listing_identity_matches(p,NEW) OR public.retained_craigslist_year_matches(p,NEW) OR public.retained_description_year_matches(p,NEW)) THEN
     RAISE EXCEPTION 'Retained identity must match exact source label' USING ERRCODE='23514';END IF;
    RETURN NEW;
  END IF;
  IF v_property_key='interior_color' THEN
    source_field := 'interior_color'; projection_mode := 'retained_listing_interior_color_v1';
  ELSIF v_property_key='exterior_color' THEN
    source_field := 'color'; projection_mode := 'retained_listing_exterior_color_v1';
  ELSIF v_property_key IN ('engine_configuration','engine_displacement_l','transmission_type','drivetrain_layout') THEN
    source_field:=CASE v_property_key WHEN 'transmission_type' THEN 'transmission' WHEN 'drivetrain_layout' THEN 'drivetrain' ELSE 'engine_size' END;
    projection_mode:='retained_listing_'||v_property_key||'_v1';
  ELSIF v_property_key='mileage_miles' THEN
    source_field:='content_text';projection_mode:='retained_listing_mileage_miles_v1';
  ELSE
    RAISE EXCEPTION 'unsupported retained property' USING ERRCODE='23514';
  END IF;
  SELECT * INTO p FROM public.vehicle_observations WHERE id=NEW.source_observation_id FOR SHARE;
  IF FOUND AND p.source_id='d7dad87c-0dc3-4b98-a31a-edf511618f8c'::uuid THEN
   IF NOT public.retained_craigslist_odometer_matches(p,NEW) THEN RAISE EXCEPTION 'Craigslist odometer must match retained attribute' USING ERRCODE='23514';END IF;
   RETURN NEW;
  END IF;
  IF FOUND AND p.extraction_method='html_description_capture' THEN
   IF NOT public.retained_description_property_matches(p,NEW) THEN
    RAISE EXCEPTION 'retained description must match exact source witness' USING ERRCODE='23514'; END IF;
   RETURN NEW;
  END IF;
  IF NOT FOUND OR p.kind::text IS DISTINCT FROM 'listing' OR p.is_superseded IS DISTINCT FROM false
    OR p.property_id IS NOT NULL OR p.subject_type IS DISTINCT FROM 'vehicle' OR p.subject_id IS NOT NULL
    OR p.extraction_method IS DISTINCT FROM 'html_match'
    OR p.source_url !~ '^https://bringatrailer[.]com/listing/[^/?#]+/?$'
    OR p.source_url IS NULL OR p.ingested_at IS NULL OR NOT isfinite(p.ingested_at)
    OR (p.observed_at IS NOT NULL AND NOT isfinite(p.observed_at))
    OR p.confidence_score IS NULL OR p.confidence_score < 0.6 OR p.confidence_score > 1
    OR jsonb_typeof(p.structured_data->source_field) IS DISTINCT FROM 'string'
    OR nullif(btrim(p.structured_data->>source_field),'') IS NULL
    OR length(p.structured_data->>source_field)>500
    OR btrim(p.structured_data->>source_field) ~* '^(unknown|n/a|unspecified)$'
    OR NOT EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id=p.vehicle_id AND v.is_public IS TRUE
      AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item')
    OR NOT EXISTS (SELECT 1 FROM public.observation_sources s WHERE s.id=p.source_id AND s.slug='bat') THEN
    RAISE EXCEPTION 'ineligible retained listing source' USING ERRCODE='23514';
  END IF;
  IF NEW.vehicle_id IS DISTINCT FROM p.vehicle_id OR NEW.source_id IS DISTINCT FROM p.source_id
    OR NEW.source_url IS DISTINCT FROM p.source_url OR NEW.kind::text IS DISTINCT FROM 'specification'
    OR NEW.subject_type IS DISTINCT FROM 'vehicle' OR NEW.subject_id IS NOT NULL
    OR NEW.observed_at IS DISTINCT FROM p.ingested_at
    OR NEW.extraction_method IS DISTINCT FROM 'retained_listing_property_projection_v1'
    OR NEW.source_identifier IS DISTINCT FROM projection_mode||':'||p.id::text
    OR NEW.raw_source_ref IS DISTINCT FROM 'vehicle_observations:'||p.id::text
    OR NEW.confidence_score IS NULL OR NEW.confidence_score<0 OR NEW.confidence_score>0.6
    OR NEW.structured_data->v_property_key IS DISTINCT FROM
      (CASE WHEN v_property_key IN ('interior_color','exterior_color') THEN p.structured_data->source_field
       ELSE public.retained_powertrain_value(v_property_key,p.structured_data->source_field) END)
    OR (v_property_key IN ('engine_configuration','engine_displacement_l','transmission_type','drivetrain_layout') AND
      (public.retained_powertrain_value(v_property_key,p.structured_data->source_field) IS NULL
       OR NEW.structured_data->'source_value' IS DISTINCT FROM p.structured_data->source_field
       OR NEW.structured_data->>'normalization_version' IS DISTINCT FROM 'retained_powertrain_v1'
       OR NEW.structured_data->>'factory_configuration_status' IS DISTINCT FROM 'unknown'
       OR NEW.structured_data->>'current_configuration_status' IS DISTINCT FROM 'unknown'
       OR NEW.structured_data->'independent_source' IS DISTINCT FROM 'false'::jsonb))
    OR NEW.structured_data->>'source_observation_id' IS DISTINCT FROM p.id::text
    OR NEW.structured_data->>'claim_role' IS DISTINCT FROM 'listing_claim'
    OR NEW.structured_data->>'observed_at_basis' IS DISTINCT FROM 'source_testimony_recorded_at'
    OR NEW.structured_data->>'source_field' IS DISTINCT FROM source_field
    OR NEW.structured_data->>'property_key' IS DISTINCT FROM v_property_key
    OR NEW.structured_data->>'projection_version' IS DISTINCT FROM projection_mode
    OR NEW.structured_data->>'analysis_kind' IS DISTINCT FROM 'retained_listing_property_projection'
    OR (NEW.structured_data->>'source_recorded_at')::timestamptz IS DISTINCT FROM p.ingested_at
    OR (NEW.structured_data->>'source_observed_at')::timestamptz IS DISTINCT FROM p.observed_at
    OR NEW.structured_data->'source_confidence_score' IS DISTINCT FROM to_jsonb(p.confidence_score)
    OR NEW.structured_data->>'source_extraction_method' IS DISTINCT FROM p.extraction_method
    OR NOT EXISTS (SELECT 1 FROM public.observation_properties r WHERE r.id=NEW.property_id
      AND r.property_key=v_property_key AND r.namespace='core' AND r.deprecated_at IS NULL
      AND 'specification'=ANY(r.applies_to_kinds)) THEN
    RAISE EXCEPTION 'retained property must match exact source tuple' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END
$function$
;
CREATE OR REPLACE FUNCTION public.enqueue_retained_listing_properties(p_source uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET lock_timeout TO '500ms'
AS $function$
DECLARE n integer;native_count integer;
BEGIN
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
 WHERE p.id=p_source AND p.kind='listing' AND p.extraction_method='html_match'
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
 WHERE p.id=p_source AND public.retained_description_property_witness(p,k.key) IS NOT NULL
 ON CONFLICT(source_observation_id,property_id) DO NOTHING;
 GET DIAGNOSTICS native_count=ROW_COUNT;n:=n+native_count;
 INSERT INTO public.retained_listing_property_work(source_observation_id,property_id,vehicle_id)
 SELECT p.id,k.id,p.vehicle_id FROM public.vehicle_observations p
 JOIN public.vehicles v ON v.id=p.vehicle_id AND v.is_public IS TRUE AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
 JOIN public.observation_sources s ON s.id=p.source_id AND s.slug='bat' AND 'specification'=ANY(s.supported_observations)
 CROSS JOIN(VALUES('ece619f7-c49a-44f7-999f-a41acf5d4dc3'::uuid,'year'),('8d274b73-a8a6-43bf-9036-5864d0152725'::uuid,'make'),('a79b528f-7d9d-46ca-96f9-96d899e81d10'::uuid,'model'),('9fc93dd3-3639-439a-8eed-3e9a0f846334'::uuid,'vin'))k(id,key)
 JOIN public.observation_properties r ON r.id=k.id AND r.property_key=k.key AND r.namespace='core' AND r.deprecated_at IS NULL AND r.ratified_at IS NOT NULL AND 'specification'=ANY(r.applies_to_kinds)
 WHERE p.id=p_source AND p.kind='listing' AND p.extraction_method='html_match' AND p.is_superseded IS FALSE
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
 WHERE p.id=p_source AND public.observation_is_public(p.kind,p.structured_data) AND public.retained_craigslist_odometer_witness(p) IS NOT NULL
 ON CONFLICT(source_observation_id,property_id) DO NOTHING;
 GET DIAGNOSTICS native_count=ROW_COUNT;n:=n+native_count;
 INSERT INTO public.retained_listing_property_work(source_observation_id,property_id,vehicle_id)
 SELECT p.id,r.id,p.vehicle_id FROM public.vehicle_observations p
 JOIN public.vehicles v ON v.id=p.vehicle_id AND v.is_public IS TRUE AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
 JOIN public.observation_sources src ON src.id=p.source_id AND src.slug='craigslist' AND 'listing'=ANY(src.supported_observations)
 JOIN public.observation_properties r ON r.id='ece619f7-c49a-44f7-999f-a41acf5d4dc3'::uuid AND r.property_key='year' AND r.namespace='core' AND r.data_type='integer' AND r.unit IS NULL AND r.label='Model Year' AND r.ratified_at IS NOT NULL AND r.deprecated_at IS NULL AND 'listing'=ANY(r.applies_to_kinds)
 WHERE p.id=p_source AND public.observation_is_public(p.kind,p.structured_data) AND public.retained_craigslist_year_witness(p) IS NOT NULL
 ON CONFLICT(source_observation_id,property_id) DO NOTHING;
 GET DIAGNOSTICS native_count=ROW_COUNT;n:=n+native_count;
 INSERT INTO public.retained_listing_property_work(source_observation_id,property_id,vehicle_id)
 SELECT p.id,r.id,p.vehicle_id FROM public.vehicle_observations p
 JOIN public.vehicles v ON v.id=p.vehicle_id AND v.is_public IS TRUE AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
 JOIN public.observation_sources src ON src.id=p.source_id AND src.slug='bat' AND 'specification'=ANY(src.supported_observations)
 JOIN public.observation_properties r ON r.id='ece619f7-c49a-44f7-999f-a41acf5d4dc3'::uuid AND r.property_key='year' AND r.namespace='core' AND r.data_type='integer' AND r.unit IS NULL AND r.label='Model Year' AND r.ratified_at IS NOT NULL AND r.deprecated_at IS NULL AND 'specification'=ANY(r.applies_to_kinds)
 WHERE p.id=p_source AND public.observation_is_public(p.kind,p.structured_data) AND public.retained_description_property_witness(p,'year') IS NOT NULL
 ON CONFLICT(source_observation_id,property_id) DO NOTHING;
 GET DIAGNOSTICS native_count=ROW_COUNT;RETURN n+native_count;
END $function$
;
CREATE OR REPLACE VIEW public.vehicle_canonical AS  WITH ranked AS (
         SELECT o.vehicle_id,
            o.property_id,
            o.id AS observation_id,
            o.structured_data,
            o.content_text,
            o.confidence_score,
            o.observed_at,
            o.source_id,
            o.rank,
            o.kind,
            o.changeset_id,
            op.discriminator_key,
                CASE
                    WHEN op.discriminator_key IS NOT NULL THEN o.structured_data ->> op.discriminator_key
                    ELSE '__single__'::text
                END AS discriminator_value,
            row_number() OVER (PARTITION BY o.vehicle_id, o.property_id, (
                CASE
                    WHEN op.discriminator_key IS NOT NULL THEN o.structured_data ->> op.discriminator_key
                    ELSE '__single__'::text
                END) ORDER BY (
                CASE o.rank::text
                    WHEN 'preferred'::text THEN 0
                    WHEN 'normal'::text THEN 1
                    WHEN 'deprecated'::text THEN 2
                    ELSE 3
                END), (COALESCE(o.confidence_score, 0::numeric)) DESC, o.observed_at DESC) AS rn
           FROM vehicle_observations o
             JOIN observation_properties op ON op.id = o.property_id
          WHERE o.extraction_method IS DISTINCT FROM 'garage_owner_correction_v1'::text AND o.is_superseded = false AND (o.source_observation_id IS NULL OR EXISTS(SELECT FROM public.vehicle_observations yp
 JOIN public.vehicles yv ON yv.id=yp.vehicle_id AND yv.is_public IS TRUE AND yv.deleted_at IS NULL AND yv.listing_kind IS DISTINCT FROM 'non_vehicle_item'
 JOIN public.observation_sources ys ON ys.id=yp.source_id AND ys.slug='bat' AND 'specification'=ANY(ys.supported_observations)
 JOIN public.observation_properties yr ON yr.id=o.property_id AND yr.property_key='year' AND yr.namespace='core' AND yr.label='Model Year' AND yr.data_type='integer' AND yr.unit IS NULL AND yr.ratified_at IS NOT NULL AND yr.deprecated_at IS NULL AND 'specification'=ANY(yr.applies_to_kinds)
 WHERE yp.id=o.source_observation_id AND public.observation_is_public(yp.kind,yp.structured_data) AND public.retained_description_year_value_matches(yp,o)) OR (EXISTS ( SELECT
                   FROM vehicle_observations yp
                     JOIN vehicles yv ON yv.id = yp.vehicle_id AND yv.is_public IS TRUE AND yv.deleted_at IS NULL AND yv.listing_kind IS DISTINCT FROM 'non_vehicle_item'::text
                     JOIN observation_sources ys ON ys.id = yp.source_id AND ys.slug = 'craigslist'::text AND ('listing'::observation_kind = ANY (ys.supported_observations))
                     JOIN observation_properties yr ON yr.id = o.property_id AND yr.property_key = 'year'::text AND yr.namespace = 'core'::text AND yr.label = 'Model Year'::text AND yr.data_type = 'integer'::text AND yr.unit IS NULL AND yr.ratified_at IS NOT NULL AND yr.deprecated_at IS NULL AND ('listing'::observation_kind = ANY (yr.applies_to_kinds))
                  WHERE yp.id = o.source_observation_id AND observation_is_public(yp.kind, yp.structured_data) AND retained_craigslist_year_value_matches(yp.*, o.*))) OR (EXISTS ( SELECT
                   FROM vehicle_observations cp
                     JOIN vehicles cv ON cv.id = cp.vehicle_id AND cv.is_public IS TRUE AND cv.deleted_at IS NULL AND cv.listing_kind IS DISTINCT FROM 'non_vehicle_item'::text
                     JOIN observation_sources cs ON cs.id = cp.source_id AND cs.slug = 'craigslist'::text AND ('listing'::observation_kind = ANY (cs.supported_observations))
                     JOIN observation_properties cr ON cr.id = o.property_id AND cr.property_key = 'mileage_miles'::text AND cr.namespace = 'core'::text AND cr.label = 'Odometer Reading (mi)'::text AND cr.unit = 'miles'::text AND cr.data_type = 'integer'::text AND cr.ratified_at IS NOT NULL AND cr.deprecated_at IS NULL AND ('listing'::observation_kind = ANY (cr.applies_to_kinds))
                  WHERE cp.id = o.source_observation_id AND observation_is_public(cp.kind, cp.structured_data) AND retained_craigslist_odometer_value_matches(cp.*, o.*))) OR (EXISTS ( SELECT
                   FROM vehicle_observations dp
                     JOIN observation_sources ds ON ds.id = dp.source_id AND ds.slug = 'bat'::text
                     JOIN vehicles dv ON dv.id = dp.vehicle_id AND dv.is_public IS TRUE AND dv.deleted_at IS NULL AND dv.listing_kind IS DISTINCT FROM 'non_vehicle_item'::text
                     JOIN observation_properties dr ON dr.id = o.property_id AND dr.property_key = (o.structured_data ->> 'property_key'::text) AND dr.namespace = 'core'::text AND dr.deprecated_at IS NULL
                  WHERE dp.id = o.source_observation_id AND ((o.kind::text = ANY (ds.supported_observations::text[])) AND (o.kind::text = ANY (dr.applies_to_kinds::text[])) AND retained_description_property_value_matches(dp.*, o.*) OR ('specification'::observation_kind = ANY (ds.supported_observations)) AND ('specification'::observation_kind = ANY (dr.applies_to_kinds)) AND dr.ratified_at IS NOT NULL AND dr.unit IS NULL AND dr.data_type =
                        CASE
                            WHEN dr.property_key = 'year'::text THEN 'integer'::text
                            ELSE 'string'::text
                        END AND dr.label =
                        CASE dr.property_key
                            WHEN 'year'::text THEN 'Model Year'::text
                            WHEN 'make'::text THEN 'Make'::text
                            WHEN 'model'::text THEN 'Model'::text
                            ELSE 'VIN'::text
                        END AND retained_listing_identity_value_matches(dp.*, o.*)))) OR (EXISTS ( SELECT 1
                   FROM vehicle_observations rp
                     JOIN observation_sources rs ON rs.id = rp.source_id AND rs.slug = 'bat'::text
                     JOIN vehicles rv ON rv.id = rp.vehicle_id AND rv.is_public IS TRUE AND rv.deleted_at IS NULL AND rv.listing_kind IS DISTINCT FROM 'non_vehicle_item'::text
                     JOIN observation_properties rk ON rk.id = o.property_id AND (rk.property_key = ANY (ARRAY['interior_color'::text, 'exterior_color'::text, 'engine_configuration'::text, 'engine_displacement_l'::text, 'transmission_type'::text, 'drivetrain_layout'::text])) AND rk.namespace = 'core'::text AND rk.deprecated_at IS NULL
                  WHERE rp.id = o.source_observation_id AND rp.id <> o.id AND rp.vehicle_id = o.vehicle_id AND rp.source_id = o.source_id AND rp.source_url = o.source_url AND rp.kind::text = 'listing'::text AND rp.is_superseded IS FALSE AND rp.property_id IS NULL AND rp.subject_type = 'vehicle'::text AND rp.subject_id IS NULL AND rp.extraction_method = 'html_match'::text AND rp.source_url ~ '^https://bringatrailer[.]com/listing/[^/?#]+/?$'::text AND rp.confidence_score >= 0.6 AND rp.confidence_score <= 1::numeric AND isfinite(rp.ingested_at) AND o.kind::text = 'specification'::text AND o.extraction_method = 'retained_listing_property_projection_v1'::text AND (o.structured_data ->> 'source_observation_id'::text) = rp.id::text AND (o.structured_data -> rk.property_key) =
                        CASE
                            WHEN rk.property_key = ANY (ARRAY['interior_color'::text, 'exterior_color'::text]) THEN rp.structured_data ->
                            CASE rk.property_key
                                WHEN 'exterior_color'::text THEN 'color'::text
                                ELSE 'interior_color'::text
                            END
                            ELSE retained_powertrain_value(rk.property_key, rp.structured_data ->
                            CASE rk.property_key
                                WHEN 'transmission_type'::text THEN 'transmission'::text
                                WHEN 'drivetrain_layout'::text THEN 'drivetrain'::text
                                ELSE 'engine_size'::text
                            END)
                        END AND ((rk.property_key = ANY (ARRAY['interior_color'::text, 'exterior_color'::text])) OR (o.structured_data -> 'source_value'::text) = (rp.structured_data ->
                        CASE rk.property_key
                            WHEN 'transmission_type'::text THEN 'transmission'::text
                            WHEN 'drivetrain_layout'::text THEN 'drivetrain'::text
                            ELSE 'engine_size'::text
                        END) AND (o.structured_data ->> 'normalization_version'::text) = 'retained_powertrain_v1'::text) AND (o.structured_data ->> 'claim_role'::text) = 'listing_claim'::text AND (o.structured_data ->> 'observed_at_basis'::text) = 'source_testimony_recorded_at'::text AND o.observed_at = rp.ingested_at AND o.confidence_score >= 0::numeric AND o.confidence_score <= 0.6))) AND o.property_id IS NOT NULL AND o.rank::text <> 'deprecated'::text
        )
 SELECT vehicle_id,
    property_id,
    observation_id,
    structured_data,
    content_text,
    confidence_score,
    observed_at,
    source_id,
    kind,
    rank,
    changeset_id,
    discriminator_value
   FROM ranked
  WHERE rn = 1;;

ALTER TABLE public.retained_listing_property_replay DROP CONSTRAINT retained_listing_property_replay_projection_version_check;
ALTER TABLE public.retained_listing_property_replay ADD CONSTRAINT retained_listing_property_replay_projection_version_check
 CHECK(projection_version IN('retained_colors_v1','retained_listing_six_properties_v1','retained_description_powertrain_v1','retained_description_odometer_v1','retained_listing_model_fields_v1','retained_listing_vin_label_v1','retained_craigslist_odometer_v1','retained_craigslist_year_v1','retained_description_year_v1'));
UPDATE public.retained_listing_property_replay r SET previous_scan_receipt=to_jsonb(r),projection_version='retained_description_year_v1',
 upper_recorded_at=p.ingested_at,upper_source_id=p.id,cursor_recorded_at=NULL,cursor_source_id=NULL,reverse_cursor_recorded_at=NULL,reverse_cursor_source_id=NULL,
 keys_seen=0,work_seeded=0,started_at=clock_timestamp(),last_seed_at=NULL,scan_direction='newest',scan_completed_at=CASE WHEN p.id IS NULL THEN clock_timestamp() END
 FROM(SELECT true AS singleton)one LEFT JOIN LATERAL(SELECT id,ingested_at FROM public.vehicle_observations WHERE kind='listing' AND isfinite(ingested_at) ORDER BY ingested_at DESC,id DESC LIMIT 1)p ON true WHERE r.id;
DO $$ DECLARE j bigint;BEGIN SELECT jobid INTO STRICT j FROM cron.job WHERE jobname='project-retained-listing-properties';PERFORM cron.alter_job(job_id:=j,active:=false);END $$;
NOTIFY pgrst,'reload schema';COMMIT;
