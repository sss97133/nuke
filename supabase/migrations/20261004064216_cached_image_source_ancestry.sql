-- C17: preserve the visibility and current attachment of immutable cached
-- image testimony through its sanctioned projection, witness and public reader.
-- No originals/backfill, grants, policies, jobs, tables or inference are changed.
-- All definitions commit together or remain unchanged on lock/error.
BEGIN;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='5s';

CREATE OR REPLACE FUNCTION public.get_cached_image_projection_parents(
  p_vehicle_id uuid, p_image_ids uuid[], p_cutoff timestamptz
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET statement_timeout='30s' SET lock_timeout='5s'
AS $function$
DECLARE result jsonb;
BEGIN
  IF p_vehicle_id IS NULL OR p_cutoff IS NULL OR NOT isfinite(p_cutoff)
     OR p_image_ids IS NULL OR cardinality(p_image_ids) NOT BETWEEN 1 AND 1000
     OR array_position(p_image_ids, NULL) IS NOT NULL
     OR (SELECT count(DISTINCT x) FROM unnest(p_image_ids) x) <> cardinality(p_image_ids) THEN
    RAISE EXCEPTION 'invalid bounded image parent selection' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.vehicles WHERE id=p_vehicle_id AND is_public IS TRUE)
     OR EXISTS (SELECT 1 FROM unnest(p_image_ids) x LEFT JOIN public.vehicle_images i
       ON i.id=x AND i.vehicle_id=p_vehicle_id WHERE i.id IS NULL) THEN
    RAISE EXCEPTION 'image parent selection requires a public same-vehicle cohort' USING ERRCODE='23514';
  END IF;
  -- Indexed image/analysis lookup. Latest testimony is returned even when it
  -- needs review; the caller must not silently fall back to an older verdict.
  WITH selected AS (
    SELECT x.image_id,x.ordinality,p.parent FROM unnest(p_image_ids) WITH ORDINALITY x(image_id,ordinality)
    LEFT JOIN LATERAL (
      SELECT jsonb_build_object('id',o.id,'vehicle_id',o.vehicle_id,'kind',o.kind,
        'source_is_public',public.observation_is_public(o.kind,o.structured_data),
        'is_superseded',o.is_superseded,'observed_at',o.observed_at,'ingested_at',o.ingested_at,
        'agent_model',o.agent_model,'agent_tier',o.agent_tier,'extraction_method',o.extraction_method,
        'confidence',o.confidence,'confidence_score',o.confidence_score,
        'structured_data',jsonb_build_object('image_id',o.structured_data->'image_id',
          'analysis_kind',o.structured_data->'analysis_kind','state_observations',
          jsonb_build_object('rust_severity',o.structured_data->'state_observations'->'rust_severity',
            'paint_state',o.structured_data->'state_observations'->'paint_state',
            'completeness',o.structured_data->'state_observations'->'completeness'),
          'needs_review',o.structured_data->'needs_review','needs_clarification',o.structured_data->'needs_clarification',
          'attribution_doubt',o.structured_data->'attribution_doubt','scene_type',o.structured_data->'scene_type')) parent
      FROM public.vehicle_observations o
      WHERE o.structured_data->>'image_id'=x.image_id::text
        AND o.structured_data->>'analysis_kind'='image_deep_byok'
        AND o.kind='condition' AND o.vehicle_id=p_vehicle_id AND o.ingested_at<=p_cutoff
      ORDER BY o.ingested_at DESC,o.id DESC LIMIT 1
    ) p ON true
  ) SELECT jsonb_build_object('parents',jsonb_agg(jsonb_build_object('image_id',image_id,'parent',parent) ORDER BY ordinality),
      'requested',count(*),'found',count(parent),'cutoff',p_cutoff) INTO result FROM selected;
  RETURN result;
END
$function$;

CREATE OR REPLACE FUNCTION public.ingest_cached_image_property_batch(p_claims jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET statement_timeout='30s' SET lock_timeout='5s'
AS $function$
DECLARE
  n integer;
  source_row public.observation_sources%ROWTYPE;
  base_score numeric;
  score numeric;
  factors jsonb;
  inserted_ids uuid[];
  receipt jsonb;
  verified_count integer;
BEGIN
  IF jsonb_typeof(p_claims) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'claims must be a JSON array' USING ERRCODE='22023';
  END IF;
  n:=jsonb_array_length(p_claims);
  IF n NOT BETWEEN 1 AND 3000 OR octet_length(p_claims::text)>12000000 THEN
    RAISE EXCEPTION 'cached image batch exceeds bounded intake' USING ERRCODE='22023';
  END IF;
  -- Shape first: casts below cannot convert arbitrary JSON into admissible facts.
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_claims) c WHERE
      jsonb_typeof(c) IS DISTINCT FROM 'object'
      OR c->>'source_slug' IS DISTINCT FROM 'photo_pipeline'
      OR c->>'kind' IS DISTINCT FROM 'condition'
      OR c->'agent_inferred' IS DISTINCT FROM 'true'::jsonb
      OR c->'defer_analysis' IS DISTINCT FROM 'true'::jsonb
      OR c->'agent_cost_cents' IS DISTINCT FROM '0'::jsonb
      OR c->>'extraction_method' IS DISTINCT FROM 'cached_byok_property_projection_v1'
      OR coalesce(c->>'content_hash','') !~ '^[0-9a-f]{64}$'
      OR jsonb_typeof(c->'source_result_json') IS DISTINCT FROM 'string'
      OR octet_length(c->>'source_result_json') NOT BETWEEN 2 AND 32768
      OR coalesce(c->>'vehicle_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      OR jsonb_typeof(c->'structured_data') IS DISTINCT FROM 'object'
      OR coalesce(c->'structured_data'->>'image_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      OR coalesce(c->'structured_data'->>'source_observation_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      OR coalesce(c->'structured_data'->>'source_result_hash','') !~ '^[0-9a-f]{64}$'
      OR coalesce(c->>'property_key','') NOT IN ('image_visible_rust_severity','image_visible_paint_stage','image_visible_assembly_state')
      OR EXISTS (SELECT 1 FROM jsonb_object_keys(c) k WHERE k NOT IN
        ('source_slug','kind','vehicle_id','property_key','agent_inferred','defer_analysis','observed_at',
         'source_identifier','raw_source_ref','agent_model','agent_tier','extraction_method','agent_cost_cents','structured_data','content_hash','source_result_json'))
    ) THEN RAISE EXCEPTION 'invalid cached image claim shape' USING ERRCODE='23514'; END IF;
  IF (SELECT count(DISTINCT c->>'source_identifier') FROM jsonb_array_elements(p_claims) c) <> n THEN
    RAISE EXCEPTION 'duplicate or absent claim identity in batch' USING ERRCODE='23514';
  END IF;

  SELECT * INTO source_row FROM public.observation_sources WHERE slug='photo_pipeline' FOR SHARE;
  IF NOT FOUND OR NOT ('condition'::public.observation_kind=ANY(source_row.supported_observations)) THEN
    RAISE EXCEPTION 'canonical photo source unavailable' USING ERRCODE='23514';
  END IF;
  -- Lock exact referenced rows, in a deterministic order, until commit. Privacy,
  -- source testimony, image attribution and registry cannot change mid-admission.
  PERFORM 1 FROM public.vehicles v JOIN (SELECT DISTINCT (c->>'vehicle_id')::uuid id
    FROM jsonb_array_elements(p_claims) c) x ON x.id=v.id ORDER BY v.id FOR SHARE OF v;
  PERFORM 1 FROM public.vehicle_images i JOIN (SELECT DISTINCT (c->'structured_data'->>'image_id')::uuid id
    FROM jsonb_array_elements(p_claims) c) x ON x.id=i.id ORDER BY i.id FOR SHARE OF i;
  PERFORM 1 FROM public.vehicle_observations o JOIN (SELECT DISTINCT (c->'structured_data'->>'source_observation_id')::uuid id
    FROM jsonb_array_elements(p_claims) c) x ON x.id=o.id ORDER BY o.id FOR SHARE OF o;
  PERFORM 1 FROM public.observation_properties p JOIN (SELECT DISTINCT c->>'property_key' k
    FROM jsonb_array_elements(p_claims) c) x ON x.k=p.property_key ORDER BY p.id FOR SHARE OF p;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_claims) c
    LEFT JOIN public.vehicles v ON v.id=(c->>'vehicle_id')::uuid
    LEFT JOIN public.vehicle_images i ON i.id=(c->'structured_data'->>'image_id')::uuid
    LEFT JOIN public.vehicle_observations o ON o.id=(c->'structured_data'->>'source_observation_id')::uuid
    LEFT JOIN public.observation_properties p ON p.property_key=c->>'property_key'
    CROSS JOIN LATERAL (SELECT CASE c->>'property_key'
      WHEN 'image_visible_rust_severity' THEN 'rust_severity'
      WHEN 'image_visible_paint_stage' THEN 'paint_state' ELSE 'completeness' END source_key) m
    WHERE v.id IS NULL OR v.is_public IS DISTINCT FROM true
      OR i.id IS NULL OR i.vehicle_id IS DISTINCT FROM v.id
      OR i.vision_gate_status::text IS DISTINCT FROM 'approved'
      OR i.is_sensitive IS TRUE OR i.is_superseded IS TRUE OR i.is_duplicate IS TRUE OR i.is_document IS TRUE
      OR i.image_vehicle_match_status IN ('mismatch','unrelated')
      OR NOT coalesce(((i.source IN ('bat','bat_import') AND i.image_url ~ '^https://([a-zA-Z0-9-]+\.)*bringatrailer\.com/[^?#[:space:]]+$')
        OR (i.source='external_import' AND i.image_url ~ '^https://images\.craigslist\.org/[^?#[:space:]]+$')),false)
      OR o.id IS NULL OR o.vehicle_id IS DISTINCT FROM v.id OR o.kind::text IS DISTINCT FROM 'condition'
      OR public.observation_is_public(o.kind,o.structured_data) IS DISTINCT FROM true
      OR o.is_superseded IS TRUE OR o.structured_data->>'analysis_kind' IS DISTINCT FROM 'image_deep_byok'
      OR o.structured_data->>'image_id' IS DISTINCT FROM i.id::text
      OR o.structured_data->>'scene_type'='receipt_document'
      OR o.confidence::text='low' OR o.confidence_score IS NULL OR o.confidence_score<0.6 OR o.confidence_score>1
      OR o.structured_data->'needs_review'='true'::jsonb OR o.structured_data->'needs_clarification'='true'::jsonb
      OR (o.structured_data ? 'attribution_doubt' AND o.structured_data->'attribution_doubt' NOT IN ('null'::jsonb,'false'::jsonb,'0'::jsonb,'""'::jsonb))
      OR nullif(btrim(o.agent_model),'') IS NULL OR nullif(btrim(o.extraction_method),'') IS NULL
      OR o.ingested_at IS NULL OR NOT isfinite(o.ingested_at)
      OR p.id IS NULL OR p.deprecated_at IS NOT NULL OR p.namespace IS DISTINCT FROM 'core'
      OR NOT coalesce('condition'::public.observation_kind=ANY(p.applies_to_kinds),false)
      OR p.data_type IS DISTINCT FROM 'enum' OR p.discriminator_key IS DISTINCT FROM 'image_id'
      OR c->>'agent_model' IS DISTINCT FROM o.agent_model
      OR nullif(c->>'agent_tier','') IS DISTINCT FROM nullif(o.agent_tier,'')
      OR (c->>'observed_at')::timestamptz IS DISTINCT FROM o.ingested_at
      OR c->>'raw_source_ref' IS DISTINCT FROM 'vehicle_observations:'||o.id::text
      OR c->>'source_identifier' IS DISTINCT FROM 'byok_image_properties_v1:'||o.id::text||':'||
        (c->'structured_data'->>'source_result_hash')||':'||(c->>'property_key')
      OR encode(sha256(convert_to(c->>'source_result_json','UTF8')),'hex')
        IS DISTINCT FROM c->'structured_data'->>'source_result_hash'
      OR (c->>'source_result_json')::jsonb IS DISTINCT FROM jsonb_build_object(
        'observation_id',o.id,'image_id',i.id,'vehicle_id',v.id,'model',o.agent_model,
        'method',o.extraction_method,'recorded_at',c->'structured_data'->>'source_recorded_at',
        'state_observations',jsonb_build_object(
          'rust_severity',o.structured_data->'state_observations'->'rust_severity',
          'paint_state',o.structured_data->'state_observations'->'paint_state',
          'completeness',o.structured_data->'state_observations'->'completeness'))
      OR jsonb_typeof(c->'structured_data'->(c->>'property_key')) IS DISTINCT FROM 'string'
      OR c->'structured_data'->(c->>'property_key') IS DISTINCT FROM o.structured_data->'state_observations'->m.source_key
      OR NOT CASE c->>'property_key'
        WHEN 'image_visible_rust_severity' THEN c->'structured_data'->>(c->>'property_key') IN ('none','surface','pitting','perforation')
        WHEN 'image_visible_paint_stage' THEN c->'structured_data'->>(c->>'property_key') IN ('bare_metal','primer','sealer','base','clear','aged')
        ELSE c->'structured_data'->>(c->>'property_key') IN ('stripped','partial','assembled') END
      -- Rebuild all provenance from the immutable parent. Timestamp strings are
      -- preserved byte-for-byte for v1 JS hashing but must denote the same clocks.
      OR (c->'structured_data'->>'source_recorded_at')::timestamptz IS DISTINCT FROM o.ingested_at
      OR (c->'structured_data'->>'source_observed_at')::timestamptz IS DISTINCT FROM o.observed_at
      OR c->'structured_data' IS DISTINCT FROM jsonb_build_object(
        c->>'property_key',o.structured_data->'state_observations'->m.source_key,
        'image_id',i.id,'property_key',c->>'property_key','analysis_kind','image_property_projection',
        'projection_version','byok_image_properties_v1','source_observation_id',o.id,
        'source_result_hash',c->'structured_data'->>'source_result_hash',
        'source_extraction_method',o.extraction_method,'source_model_confidence',o.confidence_score,
        'source_recorded_at',c->'structured_data'->>'source_recorded_at',
        'source_observed_at',c->'structured_data'->'source_observed_at',
        'observed_at_basis','source_testimony_recorded_at','capture_at',NULL,'analyzed_at',NULL,
        'claim_role','inferred','source_family','image:'||i.id::text,
        'limitation','Projection of an existing model reading of one image. Capture and analysis clocks are unverified. Not whole-vehicle condition or independent corroboration.')
  ) THEN RAISE EXCEPTION 'cached image source, privacy, property or provenance changed' USING ERRCODE='23514'; END IF;

  -- An immutable parent/property already admitted under another v1 identity is
  -- a conflict, not a second independent claim. Reuse the image+analysis index;
  -- never search the full observation log for a JSON parent reference.
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_claims) c
    JOIN public.vehicle_observations o
      ON o.structured_data->>'image_id'=c->'structured_data'->>'image_id'
      AND o.structured_data->>'analysis_kind'='image_property_projection'
      AND o.source_id=source_row.id AND o.kind='condition'
      AND o.structured_data->>'source_observation_id'=c->'structured_data'->>'source_observation_id'
      AND o.structured_data->>'property_key'=c->>'property_key'
    WHERE o.source_identifier IS DISTINCT FROM c->>'source_identifier'
       OR o.content_hash IS DISTINCT FROM c->>'content_hash') THEN
    RAISE EXCEPTION 'existing immutable parent property has a conflicting projection identity' USING ERRCODE='23514';
  END IF;

  -- Same formula as ingest-observation for this deliberately narrow payload:
  -- explicit vehicle +0.1, no source URL/text/owner claim, inferred cap at 0.6.
  base_score:=least(1.0,coalesce(nullif(source_row.base_trust_score,0),0.5)+0.1);
  score:=least(base_score,0.6);
  factors:=jsonb_build_object('vehicle_match',0.1);
  IF base_score>0.6 THEN factors:=factors||jsonb_build_object('agent_inferred_cap',0.6-base_score); END IF;

  WITH inserted AS (
    INSERT INTO public.vehicle_observations
      (vehicle_id,vehicle_match_confidence,observed_at,source_id,source_identifier,kind,
       content_hash,structured_data,confidence,confidence_score,confidence_factors,
       agent_tier,agent_model,agent_cost_cents,extraction_method,raw_source_ref,property_id)
    SELECT (c->>'vehicle_id')::uuid,1.0,(c->>'observed_at')::timestamptz,source_row.id,c->>'source_identifier','condition',
      c->>'content_hash',c->'structured_data',
      CASE WHEN score<0.4 THEN 'low'::public.confidence_level ELSE 'medium'::public.confidence_level END,
      score,factors,nullif(c->>'agent_tier',''),c->>'agent_model',0,c->>'extraction_method',c->>'raw_source_ref',p.id
    FROM jsonb_array_elements(p_claims) c JOIN public.observation_properties p ON p.property_key=c->>'property_key'
    ORDER BY c->>'vehicle_id',c->'structured_data'->>'image_id',c->>'source_identifier'
    ON CONFLICT ON CONSTRAINT unique_observation DO NOTHING RETURNING id
  ) SELECT coalesce(array_agg(id),'{}'::uuid[]) INTO inserted_ids FROM inserted;

  -- A second statement sees both our inserts and a concurrent unique-key winner.
  -- Read stored rows + trigger-created witnesses; HTTP success alone is no receipt.
  SELECT count(*),jsonb_agg(jsonb_build_object(
    'index',c.ordinality-1,'observation_id',o.id,'duplicate',NOT(o.id=ANY(inserted_ids)),
    'vehicle_id',o.vehicle_id,'image_id',(o.structured_data->>'image_id')::uuid,
    'property_id',o.property_id,'property_key',p.property_key,'value',o.structured_data->p.property_key,
    'source_observation_id',(o.structured_data->>'source_observation_id')::uuid,
    'source_result_hash',o.structured_data->>'source_result_hash','source_recorded_at',o.structured_data->>'source_recorded_at',
    'confidence_score',o.confidence_score,'witness_id',w.id) ORDER BY c.ordinality)
    INTO verified_count,receipt
  FROM jsonb_array_elements(p_claims) WITH ORDINALITY c(claim,ordinality)
  JOIN public.vehicle_observations o ON o.source_id=source_row.id AND o.kind='condition'
    AND o.source_identifier=c.claim->>'source_identifier' AND o.content_hash=c.claim->>'content_hash'
  JOIN public.observation_properties p ON p.id=o.property_id AND p.property_key=c.claim->>'property_key'
  JOIN public.observation_witnesses w ON w.observation_id=o.id
    AND w.image_id=(c.claim->'structured_data'->>'image_id')::uuid AND w.witness_role='derived'
  WHERE o.vehicle_id=(c.claim->>'vehicle_id')::uuid AND o.structured_data=c.claim->'structured_data'
    AND o.observed_at=(c.claim->>'observed_at')::timestamptz AND o.is_superseded IS NOT TRUE
    AND o.agent_model=c.claim->>'agent_model' AND o.extraction_method=c.claim->>'extraction_method'
    AND o.raw_source_ref=c.claim->>'raw_source_ref' AND o.confidence_score>=0 AND o.confidence_score<=0.6;
  IF verified_count<>n THEN
    RAISE EXCEPTION 'atomic cached property readback incomplete or conflicting' USING ERRCODE='23514';
  END IF;
  RETURN jsonb_build_object('success',true,'source_id',source_row.id,'submitted',n,
    'inserted',cardinality(inserted_ids),'duplicates',n-cardinality(inserted_ids),'verified',verified_count,'results',receipt);
END
$function$;

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
      and (not coalesce((o.extraction_method='cached_byok_property_projection_v1' OR o.structured_data->>'analysis_kind'='image_property_projection' OR o.structured_data->>'projection_version'='byok_image_properties_v1'),false) or coalesce(a.id IS NOT NULL AND a.vehicle_id=o.vehicle_id AND a.kind::text='condition'
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
  )
  select case when not exists (select 1 from gate) then null else jsonb_build_object(
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
    'evidence', coalesce((
        select jsonb_agg(e order by (e->>'confidence')::numeric desc nulls last) from (
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
        ) all_e), '[]'::jsonb),
    'observations', coalesce((
        select jsonb_agg(jsonb_build_object(
            'id',o.id,'content',left(o.content_text,400),
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
        from readable_observations o), '[]'::jsonb),
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
        from image_observations o), '[]'::jsonb)
  ) end
$function$;

COMMENT ON FUNCTION public.get_cached_image_projection_parents(uuid,uuid[],timestamptz) IS
'Owner: ingest-observation-batch cached image projection. <=1000 indexed explicit same-public-vehicle image parents at cutoff; full original observation_is_public verdict accompanies sanitized fields. Newest restricted/review/superseded testimony is never replaced with an older eligible verdict.';
COMMENT ON FUNCTION public.ingest_cached_image_property_batch(jsonb) IS
'Owner: ingest-observation-batch cached_image_property_projection_v1. Existing service-only max3000 canonical hashed intake locks original vehicle/image/source/registry; full original visibility, attachment and nonsupersession are checked before any write. Atomic derived-witness/readback, no inference or source edits.';
COMMENT ON FUNCTION public.get_field_provenance(uuid,text) IS
'Owner: field provenance reader. Existing public/owner vehicle and image gates preserved. Cached BYOK properties additionally require eligible current full-source ancestry and retained source clocks; source ingest is projection observed_at, original observed_at does not attest image capture/analysis time. No canonical promotion or independent corroboration.';
NOTIFY pgrst,'reload schema';
COMMIT;
