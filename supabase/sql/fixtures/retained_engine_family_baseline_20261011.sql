-- Canonical function/view definitions captured read-only 2026-10-11.
-- Disposable test baseline only. No customer rows. Includes actual visibility predicate.
SET check_function_bodies=off;

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
$function$;

CREATE OR REPLACE FUNCTION public.observation_is_public(p_kind observation_kind, p_data jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT p_kind IN ('listing', 'sale_result', 'comment', 'bid', 'specification', 'condition', 'media', 'splice')
     AND COALESCE(p_data::text, '') !~* ('"(invoice_number|line_items|subtotal|tax|total_amount|receipt_id|file_url'
                                         '|receipt_type|vendor_address|client_billing|billing|billed_usd|paid_usd|cost_usd'
                                         '|price_usd|amount_usd|payment_method|payment|payments|amount_paid|balance_due'
                                         '|order_number|order_contents|order|client|correct_owner|prior_owner_id'
                                         '|correct_owner_discovered_person_id|customer_name|client_name|email|phone'
                                         '|total_?paid|balance_?remaining|full_?name|first_?name|last_?name'
                                         '|given_?name|family_?name|legal_?name|buyer_?name|seller_?name'
                                         '|owner_?name|person_?name|technician_?name|participant_?name|contact_?name)"\s*:')
     AND NOT (p_kind IN ('condition', 'media') AND COALESCE(p_data::text, '') ~* '(invoice|receipt|\$\s?[0-9])');
$function$;

CREATE OR REPLACE FUNCTION public.retained_craigslist_odometer_matches(p vehicle_observations, o vehicle_observations)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 SELECT coalesce(public.retained_craigslist_odometer_value_matches(p,o)
  AND public.observation_is_public(p.kind,p.structured_data)
  AND EXISTS(SELECT FROM public.vehicles v WHERE v.id=p.vehicle_id AND v.is_public IS TRUE AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item')
  AND EXISTS(SELECT FROM public.observation_sources s WHERE s.id=p.source_id AND s.slug='craigslist' AND 'listing'=ANY(s.supported_observations))
  AND EXISTS(SELECT FROM public.observation_properties r WHERE r.id=o.property_id AND r.property_key='mileage_miles' AND r.namespace='core' AND r.label='Odometer Reading (mi)' AND r.data_type='integer'
    AND r.unit='miles' AND r.ratified_at IS NOT NULL AND r.deprecated_at IS NULL AND 'listing'=ANY(r.applies_to_kinds)),false);
$function$;

CREATE OR REPLACE FUNCTION public.retained_craigslist_odometer_value_matches(p vehicle_observations, o vehicle_observations)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
DECLARE w jsonb:=public.retained_craigslist_odometer_witness(p);d jsonb:=o.structured_data;
BEGIN
 IF w IS NULL THEN RETURN false;END IF;
 RETURN coalesce(o.id<>p.id AND o.source_observation_id=p.id AND o.vehicle_id=p.vehicle_id AND o.source_id=p.source_id AND o.source_url=p.source_url
  AND o.kind::text='listing' AND o.is_superseded IS FALSE AND o.subject_type='vehicle' AND o.subject_id IS NULL
  AND o.extraction_method='retained_listing_property_projection_v1' AND o.observed_at=p.ingested_at
  AND o.property_id='abdd7a7a-02c1-4b09-afc6-1a288207dd2d'::uuid
  AND o.source_identifier='retained_listing_mileage_miles_v1:'||p.id::text AND o.raw_source_ref='vehicle_observations:'||p.id::text
  AND o.confidence_score BETWEEN 0 AND 0.4 AND o.agent_cost_cents=0 AND o.agent_model IS NULL AND o.content_hash IS NOT NULL
  AND d->'mileage_miles'=w->'value' AND d->'source_value'=w->'source_value' AND d->'source_reading_value'=w->'value'
  AND d->'odometer_broken'=w->'odometer_broken' AND d->'odometer_rolled_over'=w->'odometer_rolled_over' AND d->'source_native_post_id'=w->'source_native_post_id'
  AND d->>'source_profile'='craigslist_auto_miles_v1' AND d->>'reading_role'='listing_odometer_label' AND d->>'true_mileage_status'='unknown'
  AND d->>'source_reading_unit'='miles' AND d->>'reading_unit_basis'='platform_auto_miles_attribute'
  AND d->'reported_precision_miles'='1'::jsonb AND d->'value_is_approximate'='false'::jsonb
  AND d->>'normalization_version'='retained_odometer_miles_v1' AND d->>'source_observation_id'=p.id::text AND d->>'property_key'='mileage_miles'
  AND d->>'source_field'='extraction_metadata.raw.attributes.raw.auto_miles' AND d->>'analysis_kind'='retained_listing_property_projection'
  AND d->>'projection_version'='retained_listing_mileage_miles_v1' AND d->>'claim_role'='listing_claim'
  AND d->>'observed_at_basis'='source_testimony_recorded_at' AND d->>'source_extraction_method'=p.extraction_method
  AND CASE WHEN pg_catalog.pg_input_is_valid(d->>'source_recorded_at','timestamptz') AND (d->>'source_observed_at' IS NULL OR pg_catalog.pg_input_is_valid(d->>'source_observed_at','timestamptz'))
   THEN (d->>'source_recorded_at')::timestamptz=p.ingested_at AND (d->>'source_observed_at')::timestamptz IS NOT DISTINCT FROM p.observed_at ELSE false END
  AND d->'source_confidence_score'=to_jsonb(p.confidence_score)
  AND d->>'source_event_time_status'='unknown' AND d->>'factory_configuration_status'='unknown' AND d->>'current_configuration_status'='unknown'
  AND d->'independent_source'='false'::jsonb,false);
END $function$;

CREATE OR REPLACE FUNCTION public.retained_craigslist_odometer_witness(p vehicle_observations)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
DECLARE r jsonb:=p.extraction_metadata->'raw';a jsonb:=r->'attributes';raw text:=a->'raw'->>'auto_miles';n integer;
BEGIN
 IF p.kind::text IS DISTINCT FROM 'listing' OR p.extraction_method IS DISTINCT FROM 'html_parse' OR p.is_superseded IS DISTINCT FROM false
  OR p.property_id IS NOT NULL OR p.subject_type IS DISTINCT FROM 'vehicle' OR p.subject_id IS NOT NULL
  OR p.source_url IS NULL OR p.source_url !~ '^https://([a-z0-9-]+[.]craigslist[.]org/([a-z]+/)?ct[od]/d/[^/?#]+/[0-9]+[.]html|www[.]craigslist[.]org/view/d/[^/?#]+/[A-Za-z0-9_-]+)$'
  OR NOT isfinite(p.ingested_at) OR p.ingested_at IS NULL OR (p.observed_at IS NOT NULL AND NOT isfinite(p.observed_at))
  OR p.confidence_score IS NULL OR p.confidence_score NOT BETWEEN 0.4 AND 1
  OR jsonb_typeof(r->'post_id') IS DISTINCT FROM 'string' OR r->>'post_id' !~ '^[0-9]{1,20}$' OR p.source_identifier IS DISTINCT FROM r->>'post_id'
  OR jsonb_typeof(a->'raw') IS DISTINCT FROM 'object' OR jsonb_typeof(a->'raw'->'auto_miles') IS DISTINCT FROM 'string'
  OR raw IS NULL OR length(raw)>20 OR raw !~ '^([0-9]+|[0-9]{1,3}(,[0-9]{3})+)$'
  OR a->'odometer_raw' IS DISTINCT FROM a->'raw'->'auto_miles' OR jsonb_typeof(a->'odometer') IS DISTINCT FROM 'number'
  OR jsonb_typeof(a->'odometer_broken') IS DISTINCT FROM 'boolean' OR jsonb_typeof(a->'odometer_rolled_over') IS DISTINCT FROM 'boolean'
  THEN RETURN NULL; END IF;
 IF replace(raw,',','')::numeric NOT BETWEEN 0 AND 9999999 THEN RETURN NULL;END IF;
 IF substring(p.source_url FROM '/([0-9]+)[.]html$') IS NOT NULL AND substring(p.source_url FROM '/([0-9]+)[.]html$') IS DISTINCT FROM r->>'post_id' THEN RETURN NULL;END IF;
 n:=replace(raw,',','')::integer;
 IF (a->>'odometer')::numeric<>n OR (a->>'odometer_broken')::boolean IS DISTINCT FROM(a->'raw'?'odometer_broken')
  OR(a->>'odometer_rolled_over')::boolean IS DISTINCT FROM(a->'raw'?'odometer_rolled_over') THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('value',n,'source_value',raw,'odometer_broken',a->'odometer_broken','odometer_rolled_over',a->'odometer_rolled_over','source_native_post_id',r->'post_id');
END $function$;

CREATE OR REPLACE FUNCTION public.retained_craigslist_year_matches(p vehicle_observations, o vehicle_observations)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 SELECT coalesce(public.retained_craigslist_year_value_matches(p,o)
  AND public.observation_is_public(p.kind,p.structured_data)
  AND EXISTS(SELECT FROM public.vehicles v WHERE v.id=p.vehicle_id AND v.is_public IS TRUE AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item')
  AND EXISTS(SELECT FROM public.observation_sources s WHERE s.id=p.source_id AND s.slug='craigslist' AND 'listing'=ANY(s.supported_observations))
  AND EXISTS(SELECT FROM public.observation_properties r WHERE r.id=o.property_id AND r.property_key='year' AND r.namespace='core' AND r.label='Model Year' AND r.data_type='integer'
    AND r.unit IS NULL AND r.ratified_at IS NOT NULL AND r.deprecated_at IS NULL AND 'listing'=ANY(r.applies_to_kinds)),false);
$function$;

CREATE OR REPLACE FUNCTION public.retained_craigslist_year_value_matches(p vehicle_observations, o vehicle_observations)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
DECLARE w jsonb:=public.retained_craigslist_year_witness(p);d jsonb:=o.structured_data;
BEGIN
 IF w IS NULL THEN RETURN false;END IF;
 RETURN coalesce(o.id<>p.id AND o.source_observation_id=p.id AND o.vehicle_id=p.vehicle_id AND o.source_id=p.source_id AND o.source_url=p.source_url
  AND o.kind::text='listing' AND o.is_superseded IS FALSE AND o.subject_type='vehicle' AND o.subject_id IS NULL
  AND o.extraction_method='retained_listing_property_projection_v1' AND o.observed_at=p.ingested_at
  AND o.property_id='ece619f7-c49a-44f7-999f-a41acf5d4dc3'::uuid
  AND o.source_identifier='retained_listing_year_v1:'||p.id::text AND o.raw_source_ref='vehicle_observations:'||p.id::text
  AND o.confidence_score BETWEEN 0 AND 0.4 AND o.agent_cost_cents=0 AND o.agent_model IS NULL AND o.content_hash IS NOT NULL
  AND d->'year'=w->'value' AND d->'source_value'=w->'source_value' AND d->'source_native_post_id'=w->'source_native_post_id'
  AND d->>'source_profile'='craigslist_year_attribute_v1' AND d->>'year_label_basis'='platform_year_attribute_or_title_row'
  AND d->>'identity_role'='extractor_vehicle_label' AND d->>'identity_resolution_status'='unverified'
  AND d->>'normalization_version'='retained_listing_year_attribute_v1' AND d->>'source_observation_id'=p.id::text AND d->>'property_key'='year'
  AND d->>'source_field'='extraction_metadata.raw.attributes.raw.year' AND d->>'analysis_kind'='retained_listing_property_projection'
  AND d->>'projection_version'='retained_listing_year_v1' AND d->>'claim_role'='listing_claim'
  AND d->>'observed_at_basis'='source_testimony_recorded_at' AND d->>'source_extraction_method'=p.extraction_method
  AND CASE WHEN pg_catalog.pg_input_is_valid(d->>'source_recorded_at','timestamptz') AND (d->>'source_observed_at' IS NULL OR pg_catalog.pg_input_is_valid(d->>'source_observed_at','timestamptz'))
   THEN (d->>'source_recorded_at')::timestamptz=p.ingested_at AND (d->>'source_observed_at')::timestamptz IS NOT DISTINCT FROM p.observed_at ELSE false END
  AND d->'source_confidence_score'=to_jsonb(p.confidence_score)
  AND d->>'source_event_time_status'='unknown' AND d->>'factory_configuration_status'='unknown' AND d->>'current_configuration_status'='unknown'
  AND d->'independent_source'='false'::jsonb,false);
END $function$;

CREATE OR REPLACE FUNCTION public.retained_craigslist_year_witness(p vehicle_observations)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
DECLARE r jsonb:=p.extraction_metadata->'raw';a jsonb:=r->'attributes';raw text:=a->'raw'->>'year';n integer;
BEGIN
 IF p.kind::text IS DISTINCT FROM 'listing' OR p.extraction_method IS DISTINCT FROM 'html_parse' OR p.is_superseded IS DISTINCT FROM false
  OR p.property_id IS NOT NULL OR p.subject_type IS DISTINCT FROM 'vehicle' OR p.subject_id IS NOT NULL
  OR p.source_url IS NULL OR p.source_url !~ '^https://([a-z0-9-]+[.]craigslist[.]org/([a-z]+/)?ct[od]/d/[^/?#]+/[0-9]+[.]html|www[.]craigslist[.]org/view/d/[^/?#]+/[A-Za-z0-9_-]+)$'
  OR NOT isfinite(p.ingested_at) OR p.ingested_at IS NULL OR (p.observed_at IS NOT NULL AND NOT isfinite(p.observed_at))
  OR p.confidence_score IS NULL OR p.confidence_score NOT BETWEEN 0.4 AND 1
  OR jsonb_typeof(r->'post_id') IS DISTINCT FROM 'string' OR r->>'post_id' !~ '^[0-9]{1,20}$' OR p.source_identifier IS DISTINCT FROM r->>'post_id'
  OR jsonb_typeof(a->'raw') IS DISTINCT FROM 'object' OR jsonb_typeof(a->'raw'->'year') IS DISTINCT FROM 'string'
  OR raw IS NULL OR raw !~ '^[0-9]{4}$' THEN RETURN NULL;END IF;
 IF substring(p.source_url FROM '/([0-9]+)[.]html$') IS NOT NULL AND substring(p.source_url FROM '/([0-9]+)[.]html$') IS DISTINCT FROM r->>'post_id' THEN RETURN NULL;END IF;
 n:=raw::integer;IF n NOT BETWEEN 1800 AND 2100 THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('value',n,'source_value',raw,'source_native_post_id',r->'post_id');
END $function$;

CREATE OR REPLACE FUNCTION public.retained_description_powertrain_witness(p_key text, p_text text)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
DECLARE sentence text; candidate jsonb; witness jsonb;
BEGIN
 IF p_key NOT IN('engine_configuration','engine_displacement_l','transmission_type') OR p_key IS NULL
  OR p_text IS NULL OR octet_length(p_text)<100 OR octet_length(p_text)>32000 THEN RETURN NULL; END IF;
 FOR sentence IN SELECT btrim(t,E' \t\r\n') FROM regexp_split_to_table(p_text,E'(?<=[.!?])[ \t\r\n]+|[\r\n]+') t LOOP
  IF sentence !~* '^(This\y|The (car|truck|motorcycle|bike|vehicle|engine|conversion)\y|It\y|Finished in\y|Powered by\y|Power (is ((provided|supplied) by|from)|comes from)\y)'
   OR sentence !~* '(\ypowered by\y|(^|, | and )power (is ((provided|supplied) by|from)|comes from)\y)' THEN CONTINUE; END IF;
  IF octet_length(sentence)>500 OR sentence ~* '\y(unknown|unspecified|not|no|without|or|would|could|might|may|should|planned|proposed|intend|originally|previously|formerly|removed|replaced|spare|uninstalled|other|another)\y|["“”]' THEN RETURN NULL; END IF;
  IF p_key='transmission_type' AND sentence !~* E'\\y(manual|automatic|cvt|semi)[ \t]+(transmission|transaxle|gearbox)\\y' THEN CONTINUE; END IF;
  candidate:=public.retained_powertrain_value(p_key,to_jsonb(sentence));
  IF candidate IS NULL THEN
   IF (p_key='engine_configuration' AND sentence ~* '\y(v|i|inline|flat)[- ]?(2|3|4|5|6|8|10|12|16|two|three|four|five|six|eight|ten|twelve|sixteen)\y')
    OR (p_key='engine_displacement_l' AND sentence ~* '\d[ ,.-]*(liter|litre|l|cc|ci)\y')
    OR p_key='transmission_type' THEN RETURN NULL; END IF;
   CONTINUE;
  END IF;
  IF witness IS NOT NULL AND witness->'value' IS DISTINCT FROM candidate THEN RETURN NULL; END IF;
  IF witness IS NULL THEN witness:=jsonb_build_object('source_value',sentence,'value',candidate); END IF;
 END LOOP;
 RETURN witness;
END $function$;

CREATE OR REPLACE FUNCTION public.retained_description_presentation_witness(p_key text, p_text text)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
DECLARE sentence text;finish text[];interior text[];drive text[];value text;w jsonb;
BEGIN
 IF p_key NOT IN('interior_color','exterior_color','drivetrain_layout') OR p_text IS NULL OR octet_length(p_text)<100 OR octet_length(p_text)>32000 THEN RETURN NULL;END IF;
 FOR sentence IN SELECT btrim(t,E' \t\r\n') FROM regexp_split_to_table(p_text,E'(?<=[.!?])[ \t\r\n]+|[\r\n]+')t LOOP
  finish:=regexp_match(sentence,'(?:^(?:Finished|The (?:car|truck|vehicle|motorcycle|bike) is (?:finished|refinished)|It is (?:finished|refinished)) in ([A-Za-z][A-Za-z0-9 /()''-]{0,79}?) over ([A-Za-z][A-Za-z0-9 /()''-]{0,79}?) (leather|vinyl|cloth)(?=[ ,.;]|$)){1,1}?','i');
  interior:=regexp_match(sentence,'(?:^The (?:cabin|interior|seats) (?:is|are) (?:trimmed|upholstered|finished) in ([A-Za-z][A-Za-z0-9 /()''-]{0,79}?) (leather|vinyl|cloth)(?=[ ,.;]|$)){1,1}?','i');
  drive:=regexp_match(sentence,'^Power is (?:sent|delivered|routed) to (?:the )?(rear|front) wheels\y','i');
  IF p_key='drivetrain_layout' AND sentence ~* '^Power is (sent|delivered|routed)\y' AND drive IS NULL THEN RETURN NULL;END IF;
  value:=CASE p_key WHEN 'drivetrain_layout' THEN CASE WHEN drive IS NULL THEN NULL WHEN lower(drive[1])='rear' THEN 'RWD' ELSE 'FWD' END
   WHEN 'exterior_color' THEN finish[1] ELSE coalesce(finish[2],interior[1]) END;
  IF value IS NULL THEN CONTINUE;END IF;
  IF octet_length(sentence)>500 OR sentence ~* '\y(unknown|unspecified|not|no|without|or|would|could|might|may|should|planned|proposed|intend|originally|previously|formerly|removed|spare|uninstalled|other|another)\y|["“”]'
   OR value<>btrim(value,E' \t\r\n') OR value ~* '\yand\y' THEN RETURN NULL;END IF;
  IF p_key='drivetrain_layout' AND (sentence ~* '\y(if|when|only|transfer case|all four|all[- ]wheel|four[- ]wheel|AWD|4WD)\y'
   OR (value='RWD' AND sentence ~* '\yfront\y') OR (value='FWD' AND sentence ~* '\yrear\y')) THEN RETURN NULL;END IF;
  IF w IS NOT NULL AND w->>'value'<>value THEN RETURN NULL;END IF;
  IF w IS NULL THEN w:=jsonb_build_object('source_value',sentence,'value',value);END IF;
 END LOOP;RETURN w;
END $function$;

CREATE OR REPLACE FUNCTION public.retained_description_property_matches(p vehicle_observations, o vehicle_observations)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 SELECT coalesce(public.retained_description_property_value_matches(p,o)
  AND EXISTS(SELECT FROM public.vehicles v WHERE v.id=p.vehicle_id AND v.is_public IS TRUE AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item')
  AND EXISTS(SELECT FROM public.observation_sources s WHERE s.id=p.source_id AND s.slug='bat' AND o.kind::text=ANY(s.supported_observations::text[]))
  AND EXISTS(SELECT FROM public.observation_properties r WHERE r.id=o.property_id AND r.property_key=o.structured_data->>'property_key' AND r.namespace='core' AND r.deprecated_at IS NULL AND o.kind::text=ANY(r.applies_to_kinds::text[])),false);
$function$;

CREATE OR REPLACE FUNCTION public.retained_description_property_value_matches(p vehicle_observations, o vehicle_observations)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE k text:=o.structured_data->>'property_key'; w jsonb; d jsonb:=o.structured_data;
BEGIN
 w:=public.retained_description_property_witness(p,k);
 IF w IS NULL THEN RETURN false; END IF;
 RETURN coalesce(
  o.id<>p.id AND o.source_observation_id=p.id AND o.vehicle_id=p.vehicle_id AND o.source_id=p.source_id AND o.source_url=p.source_url
  AND o.kind::text=CASE WHEN k='mileage_miles' THEN 'condition' ELSE 'specification' END AND o.is_superseded IS FALSE AND o.subject_type='vehicle' AND o.subject_id IS NULL
  AND o.observed_at=p.ingested_at AND o.extraction_method='retained_listing_property_projection_v1'
  AND o.source_identifier='retained_listing_'||k||'_v1:'||p.id::text AND o.raw_source_ref='vehicle_observations:'||p.id::text
  AND o.confidence_score BETWEEN 0 AND 0.6 AND o.agent_cost_cents=0 AND o.agent_model IS NULL AND o.content_hash IS NOT NULL
  AND d->k=w->'value' AND d->'source_value'=w->'source_value' AND d->>'normalization_version'=CASE WHEN k='mileage_miles' THEN 'retained_odometer_miles_v1' WHEN k IN('interior_color','exterior_color') THEN 'retained_color_text_v1' ELSE 'retained_powertrain_v1' END
  AND d->>'source_witness_version'=CASE WHEN k='mileage_miles' THEN 'retained_description_odometer_v1' WHEN k IN('interior_color','exterior_color','drivetrain_layout') THEN 'retained_description_presentation_v1' ELSE 'retained_description_powertrain_v1' END
  AND (k NOT IN('interior_color','exterior_color','drivetrain_layout') OR d->>'source_event_time_status'='unknown')
  AND (k<>'mileage_miles' OR (d->'source_reading_value'=w->'source_reading_value' AND d->'source_reading_unit'=w->'source_reading_unit'
   AND d->'reported_precision_miles'=w->'reported_precision_miles' AND d->'value_is_approximate'=w->'value_is_approximate'
   AND d->'reading_role'=w->'reading_role' AND d->'true_mileage_status'=w->'true_mileage_status'
   AND d->>'source_observed_at_basis'='source_capture' AND d->>'source_event_time_status'='unknown'))
  AND d->'source_capture_sha256'=p.structured_data->'source_capture_sha256'
  AND d->>'source_field'='content_text' AND d->>'source_observation_id'=p.id::text
  AND d->>'analysis_kind'='retained_listing_property_projection' AND d->>'projection_version'='retained_listing_'||k||'_v1'
  AND d->>'claim_role'='listing_claim' AND d->>'observed_at_basis'='source_testimony_recorded_at'
  AND d->>'factory_configuration_status'='unknown' AND d->>'current_configuration_status'='unknown' AND d->'independent_source'='false'::jsonb
  AND (d->>'source_recorded_at')::timestamptz=p.ingested_at AND (d->>'source_observed_at')::timestamptz=p.observed_at
  AND d->'source_confidence_score'=to_jsonb(p.confidence_score) AND d->>'source_extraction_method'=p.extraction_method
,false);
 EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN false;
END $function$;

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
END $function$;

CREATE OR REPLACE FUNCTION public.retained_description_year_matches(p vehicle_observations, o vehicle_observations)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 SELECT coalesce(public.retained_description_year_value_matches(p,o) AND public.observation_is_public(p.kind,p.structured_data)
  AND EXISTS(SELECT FROM public.vehicles v WHERE v.id=p.vehicle_id AND v.is_public IS TRUE AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item')
  AND EXISTS(SELECT FROM public.observation_sources s WHERE s.id=p.source_id AND s.slug='bat' AND 'specification'=ANY(s.supported_observations))
  AND EXISTS(SELECT FROM public.observation_properties r WHERE r.id=o.property_id AND r.property_key='year' AND r.namespace='core' AND r.label='Model Year' AND r.data_type='integer'
    AND r.unit IS NULL AND r.ratified_at IS NOT NULL AND r.deprecated_at IS NULL AND 'specification'=ANY(r.applies_to_kinds)),false);
$function$;

CREATE OR REPLACE FUNCTION public.retained_description_year_text_witness(p_text text)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
DECLARE sentence text;m text[];n integer;
BEGIN
 IF p_text IS NULL OR octet_length(p_text) NOT BETWEEN 100 AND 32000 THEN RETURN NULL;END IF;
 sentence:=btrim((regexp_split_to_array(p_text,E'(?<=[.!?])[ \\t\\r\\n]+|[\\r\\n]+'))[1],E' \t\r\n');
 IF octet_length(sentence)>500 THEN RETURN NULL;END IF;
 m:=regexp_match(sentence COLLATE pg_catalog."C",$re$(?:^This ([0-9]{4}) ([A-Za-z][A-Za-z0-9 ./'’′+-]{0,119}?) (?:is|was|has|had|remained|features)\y){1,1}?$re$);
 IF m IS NULL OR m[2] ~* '\y(engine|motor|transmission|transaxle|gearbox|chassis|frame|body|panel|parts|replica|scale|memorabilia|artwork|collection)\y'
  OR m[2] ~* '^model\y' THEN RETURN NULL;END IF;
 n:=m[1]::integer;IF n NOT BETWEEN 1800 AND 2100 THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('value',n,'source_value',sentence,'source_year_token',m[1],'source_subject_label',m[2]);
END $function$;

CREATE OR REPLACE FUNCTION public.retained_description_year_value_matches(p vehicle_observations, o vehicle_observations)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
DECLARE w jsonb;d jsonb:=o.structured_data;
BEGIN
 -- These are already necessary conditions below. Refuse unrelated candidates
 -- before the native parser, including other fields of the same source parent.
 IF o.property_id IS DISTINCT FROM 'ece619f7-c49a-44f7-999f-a41acf5d4dc3'::uuid
  OR o.extraction_method IS DISTINCT FROM 'retained_listing_property_projection_v1'
  OR d->>'source_profile' IS DISTINCT FROM 'bat_description_year_label_v1' THEN RETURN false;END IF;
 w:=public.retained_description_property_witness(p,'year');
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
END $function$;

CREATE OR REPLACE FUNCTION public.retained_listing_identity_matches(p vehicle_observations, o vehicle_observations)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 SELECT coalesce(public.retained_listing_identity_value_matches(p,o)
  AND EXISTS(SELECT FROM public.vehicles v WHERE v.id=p.vehicle_id AND v.is_public IS TRUE AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item')
  AND EXISTS(SELECT FROM public.observation_sources s WHERE s.id=p.source_id AND s.slug='bat' AND 'specification'=ANY(s.supported_observations))
  AND EXISTS(SELECT FROM public.observation_properties r WHERE r.id=o.property_id AND r.property_key=o.structured_data->>'property_key' AND r.namespace='core'
   AND r.deprecated_at IS NULL AND r.ratified_at IS NOT NULL AND r.unit IS NULL
   AND r.data_type=CASE WHEN o.structured_data->>'property_key'='year' THEN 'integer' ELSE 'string' END
   AND r.label=CASE o.structured_data->>'property_key' WHEN 'year' THEN 'Model Year' WHEN 'make' THEN 'Make' WHEN 'model' THEN 'Model' ELSE 'VIN' END
   AND 'specification'=ANY(r.applies_to_kinds)),false);
$function$;

CREATE OR REPLACE FUNCTION public.retained_listing_identity_value(p_key text, p_value jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
DECLARE raw text;n numeric;
BEGIN
 IF p_key='year' THEN
  IF jsonb_typeof(p_value) IS DISTINCT FROM 'number' THEN RETURN NULL;END IF;
  n:=(p_value#>>'{}')::numeric;
  RETURN CASE WHEN n=trunc(n) AND n BETWEEN 1800 AND 2100 THEN p_value END;
 ELSIF p_key='vin' THEN
  IF jsonb_typeof(p_value) IS DISTINCT FROM 'string' THEN RETURN NULL;END IF;
  raw:=p_value#>>'{}';
  RETURN CASE WHEN length(raw)=17 AND raw !~ '[^ABCDEFGHJKLMNPRSTUVWXYZ0123456789]'
   AND raw ~ '[0123456789]' AND raw !~ '^(.)\1+$' THEN p_value END;
 ELSIF p_key IN('make','model') THEN
  IF jsonb_typeof(p_value) IS DISTINCT FROM 'string' THEN RETURN NULL;END IF;
  raw:=p_value#>>'{}';
  RETURN CASE WHEN raw=btrim(raw,E' \t\r\n') AND length(raw) BETWEEN 1 AND 120
   AND raw !~ '[[:cntrl:]]' AND raw !~* '^(unknown|unspecified|n/a|none|null|tbd|unidentified|other)$' THEN p_value END;
 END IF;RETURN NULL;
END $function$;

CREATE OR REPLACE FUNCTION public.retained_listing_identity_value_matches(p vehicle_observations, o vehicle_observations)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE k text:=o.structured_data->>'property_key';d jsonb:=o.structured_data;value jsonb;
BEGIN
 value:=public.retained_listing_identity_value(k,p.structured_data->k);
 IF value IS NULL THEN RETURN false;END IF;
 RETURN coalesce(p.kind::text='listing' AND p.extraction_method='html_match' AND p.is_superseded IS FALSE
  AND p.property_id IS NULL AND p.subject_type='vehicle' AND p.subject_id IS NULL
  AND p.source_url ~ '^https://bringatrailer[.]com/listing/[^/?#]+/?$' AND p.confidence_score BETWEEN 0.6 AND 1
  AND isfinite(p.ingested_at) AND (p.observed_at IS NULL OR isfinite(p.observed_at))
  AND o.id<>p.id AND o.source_observation_id=p.id AND o.vehicle_id=p.vehicle_id AND o.source_id=p.source_id AND o.source_url=p.source_url
  AND o.kind::text='specification' AND o.is_superseded IS FALSE AND o.subject_type='vehicle' AND o.subject_id IS NULL
  AND o.extraction_method='retained_listing_property_projection_v1' AND o.observed_at=p.ingested_at
  AND o.source_identifier='retained_listing_'||k||'_v1:'||p.id::text AND o.raw_source_ref='vehicle_observations:'||p.id::text
  AND o.confidence_score BETWEEN 0 AND 0.6 AND o.agent_cost_cents=0 AND o.agent_model IS NULL AND o.content_hash IS NOT NULL
  AND d->k=value AND d->'source_value'=p.structured_data->k AND d->>'normalization_version'='retained_listing_identity_labels_v1'
  AND d->>'source_observation_id'=p.id::text AND d->>'property_key'=k AND d->>'source_field'=k
  AND d->>'analysis_kind'='retained_listing_property_projection' AND d->>'projection_version'='retained_listing_'||k||'_v1'
  AND d->>'claim_role'='listing_claim' AND d->>'observed_at_basis'='source_testimony_recorded_at'
  AND d->>'identity_role'='extractor_vehicle_label' AND d->>'identity_resolution_status'='unverified'
  AND (k<>'vin' OR (d->>'vin_identifier_namespace'='standard_17_character_vin_label' AND d->>'vin_format_status'='17_character_format' AND d->>'vin_checksum_status'='not_evaluated'))
  AND d->>'source_event_time_status'='unknown' AND d->>'factory_configuration_status'='unknown'
  AND d->>'current_configuration_status'='unknown' AND d->'independent_source'='false'::jsonb
  AND (d->>'source_recorded_at')::timestamptz=p.ingested_at
  AND (d->>'source_observed_at')::timestamptz IS NOT DISTINCT FROM p.observed_at
  AND d->'source_confidence_score'=to_jsonb(p.confidence_score) AND d->>'source_extraction_method'=p.extraction_method
,false);
 EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN false;
END $function$;

CREATE OR REPLACE FUNCTION public.retained_odometer_witness(p_text text)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
DECLARE sentence text;m text[];w jsonb;candidate jsonb;token text;decimals integer;numerator numeric;denominator numeric;
 amount numeric;unit text;normalized numeric;precision numeric;
BEGIN
 IF p_text IS NULL OR octet_length(p_text)<100 OR octet_length(p_text)>32000 THEN RETURN NULL; END IF;
 FOR sentence IN SELECT btrim(t,E' \t\r\n') FROM regexp_split_to_table(p_text,E'(?<=[.!?])[ \t\r\n]+|[\r\n]+') t LOOP
  m:=regexp_match(sentence,E'^The (?:(?:five|six|seven)-digit |digital |retrofitted digital )?odometer (?:now )?(?:shows|indicates|reads|displays)[ \t]+(~|approximately[ \t]+|about[ \t]+)?((?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:[.]\\d{1,3})?)(k)?[ \t]+(miles|kilometers|km)\\y','i');
  IF m IS NULL THEN CONTINUE; END IF;
  IF octet_length(sentence)>500 OR sentence ~* '\y(or|would|could|might|may|should|planned|proposed|previously|formerly|hypothetical|example)\y' THEN RETURN NULL; END IF;
  token:=replace(m[2],',','');decimals:=CASE WHEN position('.' IN token)>0 THEN length(split_part(token,'.',2)) ELSE 0 END;
  denominator:=power(10::numeric,decimals);numerator:=replace(token,'.','')::numeric*CASE WHEN m[3] IS NOT NULL THEN 1000 ELSE 1 END;
  amount:=numerator/denominator;unit:=CASE WHEN lower(m[4])='miles' THEN 'miles' ELSE 'kilometers' END;
  IF numerator>9007199254740991 OR amount<0 OR amount>=10000000 OR (unit='miles' AND mod(numerator,denominator)<>0) THEN RETURN NULL; END IF;
  normalized:=round(CASE WHEN unit='kilometers' THEN amount*1000/1609.344 ELSE amount END);
  precision:=CASE WHEN m[3] IS NOT NULL THEN 1000 ELSE 1 END/denominator;
  IF unit='kilometers' THEN precision:=round(greatest(1,precision*1000/1609.344),6); END IF;
  candidate:=jsonb_build_object('source_value',sentence,'value',normalized,'source_reading_value',amount,
   'source_reading_unit',unit,'reported_precision_miles',precision,
   'value_is_approximate',m[1] IS NOT NULL OR m[3] IS NOT NULL OR unit='kilometers',
   'reading_role','odometer_display','true_mileage_status','unknown');
  IF w IS NOT NULL AND (w->'source_reading_value' IS DISTINCT FROM candidate->'source_reading_value'
   OR w->'source_reading_unit' IS DISTINCT FROM candidate->'source_reading_unit') THEN RETURN NULL; END IF;
  IF w IS NULL THEN w:=candidate; END IF;
 END LOOP;RETURN w;
END $function$;

CREATE OR REPLACE FUNCTION public.retained_powertrain_value(p_key text, p_raw jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE t text; m text[]; v text; vals text[]:=ARRAY[]::text[]; n numeric; unit text;
BEGIN
 IF jsonb_typeof(p_raw) IS DISTINCT FROM 'string' THEN RETURN NULL; END IF;
 t:=btrim(p_raw#>>'{}');
 IF t='' OR length(t)>500 OR t ~* '\m(unknown|unspecified|not|no|without|or)\M' THEN RETURN NULL; END IF;
 IF p_key='drivetrain_layout' THEN
  RETURN CASE WHEN t ~* '^(FWD|RWD|AWD|4WD)$' THEN to_jsonb(upper(t)) END;
 ELSIF p_key='transmission_type' THEN
  FOR m IN SELECT regexp_matches(lower(t),'\m(manual|automatic|cvt|semi)\M','g') LOOP
   IF NOT m[1]=ANY(vals) THEN vals:=array_append(vals,m[1]); END IF;
  END LOOP;
 ELSIF p_key='engine_configuration' THEN
  FOR m IN SELECT regexp_matches(lower(t),'\m(v|i|inline|flat)[-\s]?(2|3|4|5|6|8|10|12|16|two|three|four|five|six|eight|ten|twelve|sixteen)\M','g') LOOP
   v:=(CASE m[1] WHEN 'flat' THEN 'flat-' WHEN 'v' THEN 'V' ELSE 'I' END)||
    (CASE m[2] WHEN 'two' THEN '2' WHEN 'three' THEN '3' WHEN 'four' THEN '4' WHEN 'five' THEN '5'
     WHEN 'six' THEN '6' WHEN 'eight' THEN '8' WHEN 'ten' THEN '10' WHEN 'twelve' THEN '12' WHEN 'sixteen' THEN '16' ELSE m[2] END);
   IF NOT v=ANY(vals) THEN vals:=array_append(vals,v); END IF;
  END LOOP;
 ELSIF p_key='engine_displacement_l' THEN
  FOR m IN SELECT regexp_matches(lower(t),'(?<![-+.,\d])\m(\d+(?:,\d{3})*(?:\.\d+)?)\s*-?\s*(liter|litre|l|cc|ci)\M','g') LOOP
   vals:=array_append(vals,m[1]); unit:=m[2];
  END LOOP;
  IF cardinality(vals)<>1 THEN RETURN NULL; END IF;
  n:=replace(vals[1],',','')::numeric * CASE unit WHEN 'cc' THEN .001 WHEN 'ci' THEN .016387064 ELSE 1 END;
  RETURN CASE WHEN n>0 AND n<=30 THEN to_jsonb(round(n,6)) END;
 ELSE RETURN NULL;
 END IF;
 RETURN CASE WHEN cardinality(vals)=1 THEN to_jsonb(vals[1]) END;
END $function$;

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
$function$;

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
$function$;

SET check_function_bodies=on;

CREATE VIEW public.vehicle_canonical AS  WITH ranked AS (
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
          WHERE o.extraction_method IS DISTINCT FROM 'garage_owner_correction_v1'::text AND o.is_superseded = false AND (o.source_observation_id IS NULL OR (EXISTS ( SELECT
                   FROM vehicle_observations yp
                     JOIN vehicles yv ON yv.id = yp.vehicle_id AND yv.is_public IS TRUE AND yv.deleted_at IS NULL AND yv.listing_kind IS DISTINCT FROM 'non_vehicle_item'::text
                     JOIN observation_sources ys ON ys.id = yp.source_id AND ys.slug = 'bat'::text AND ('specification'::observation_kind = ANY (ys.supported_observations))
                     JOIN observation_properties yr ON yr.id = o.property_id AND yr.property_key = 'year'::text AND yr.namespace = 'core'::text AND yr.label = 'Model Year'::text AND yr.data_type = 'integer'::text AND yr.unit IS NULL AND yr.ratified_at IS NOT NULL AND yr.deprecated_at IS NULL AND ('specification'::observation_kind = ANY (yr.applies_to_kinds))
                  WHERE yp.id = o.source_observation_id AND observation_is_public(yp.kind, yp.structured_data) AND retained_description_year_value_matches(yp.*, o.*))) OR (EXISTS ( SELECT
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
  WHERE rn = 1;
