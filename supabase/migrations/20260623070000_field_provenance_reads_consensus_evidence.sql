-- Close the spec drill→cite→proof loop. get_field_provenance read vehicle_field_sources +
-- vehicles.<field>_source + vehicle_observations, but the build_field_consensus pipeline lands
-- provenance in field_evidence + vehicle_field_provenance — which it never queried. Result: the
-- iOS spec-drill showed a value with NO citation even when a cited source existed (e.g. K5 trim
-- "Cheyenne" sourced to the SPID build-plate photo). This adds those two systems as evidence/source
-- so the drill cites e.g. "Cheyenne — spid_rpo_plate (SPID build plate, photo 9d8fbb2d)". Read-only,
-- additive: every prior source still surfaces; the Evidence shape matches the iOS decoder exactly.

CREATE OR REPLACE FUNCTION public.get_field_provenance(p_vehicle_id uuid, p_field text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with gate as (
    select v.* from vehicles v
    where v.id = p_vehicle_id
      and (v.is_public = true
           or auth.uid() in (v.user_id, v.owner_id, v.uploaded_by))
  ),
  prov as (
    select primary_source, total_confidence
    from public.vehicle_field_provenance
    where vehicle_id = p_vehicle_id and field_name = p_field
    limit 1
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
        (select i.image_url from vehicle_images i
          where i.id = ((select nullif(to_jsonb(g)->>(p_field||'_source_image_id'),'') from gate g))::uuid),
        (select fe.raw_extraction_data->>'image_url' from public.field_evidence fe
          where fe.vehicle_id = p_vehicle_id and fe.field_name = p_field
            and fe.status <> 'superseded' and (fe.raw_extraction_data ? 'image_url')
          order by fe.source_confidence desc nulls last limit 1)),
    -- evidence = vehicle_field_sources ∪ field_evidence (the consensus pipeline), highest confidence first
    'evidence', coalesce((
        select jsonb_agg(e order by (e->>'confidence')::numeric desc nulls last) from (
          select jsonb_build_object(
            'source','vehicle_field_sources','value',fs.field_value,
            'source_type',fs.source_type,'confidence',fs.confidence_score,
            'verified',fs.is_verified,'reasoning',fs.ai_reasoning,
            'image_id',fs.source_image_id,'at',fs.created_at) as e
          from public.vehicle_field_sources fs
          where fs.vehicle_id = p_vehicle_id and fs.field_name = p_field
            and coalesce(fs.field_value,'') <> ''
          union all
          select jsonb_build_object(
            'source','field_evidence','value',fe.proposed_value,
            'source_type',fe.source_type,'confidence',fe.source_confidence,
            'verified',(fe.status='accepted'),'reasoning',fe.extraction_context,
            'image_id',fe.raw_extraction_data->>'photo_id','at',fe.created_at) as e
          from public.field_evidence fe
          where fe.vehicle_id = p_vehicle_id and fe.field_name = p_field
            and coalesce(fe.proposed_value,'') <> '' and fe.status <> 'superseded'
        ) all_e), '[]'::jsonb),
    'observations', coalesce((
        select jsonb_agg(jsonb_build_object(
            'id',o.id,'content',left(o.content_text,400),
            'value',o.structured_data->>p_field,'confidence',o.confidence_score,
            'observed_at',o.observed_at,'kind',o.kind::text,
            'source_slug',s.slug,'trust',s.base_trust_score,'source_url',o.source_url)
            order by o.confidence_score desc nulls last)
        from public.vehicle_observations o
        left join public.observation_sources s on s.id = o.source_id
        where o.vehicle_id = p_vehicle_id and coalesce(o.is_superseded,false)=false
          and o.structured_data ? p_field), '[]'::jsonb)
  ) end
$function$;

NOTIFY pgrst, 'reload schema';
