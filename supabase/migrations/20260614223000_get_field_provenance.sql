-- get_field_provenance(vehicle, field) — the spec-table drill-to-source primitive.
--
-- The vehicle profile's SPECIFICATIONS table must obey the three-shelf law:
-- no number without a table behind it. A spec value (VIN, mileage, engine, …)
-- is "click-through ready" only when real evidence backs it; otherwise it
-- stays dead text. This RPC is the table behind each spec cell.
--
-- Mirrors compute_vehicle_investment_proof's "every value carries its source"
-- shape, but keyed by (vehicle_id, field). Unifies the three real provenance
-- substrates so even sparse vehicles return something honest:
--   1. vehicles inline columns   ({field}, {field}_source, {field}_confidence, {field}_source_image_id)
--   2. vehicle_field_sources     (field-keyed extraction evidence, when populated)
--   3. vehicle_observations      (the broad testimony trail; field present in structured_data)
--
-- SECURITY DEFINER so a public vehicle's provenance reads regardless of the
-- per-table RLS (vehicle_observations is not anon-readable); gated to public
-- vehicles OR the owner. Read-only / STABLE.
create or replace function public.get_field_provenance(p_vehicle_id uuid, p_field text)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  with gate as (
    select v.* from vehicles v
    where v.id = p_vehicle_id
      and (v.is_public = true
           or auth.uid() in (v.user_id, v.owner_id, v.uploaded_by))
  )
  select case when not exists (select 1 from gate) then null else jsonb_build_object(
    'field', p_field,
    'vehicle_id', p_vehicle_id,
    'value',             (select to_jsonb(g)->>p_field                          from gate g),
    'inline_source',     (select to_jsonb(g)->>(p_field||'_source')             from gate g),
    'inline_confidence', (select to_jsonb(g)->>(p_field||'_confidence')         from gate g),
    'source_image_url', (
        select i.image_url from vehicle_images i
        where i.id = ((select nullif(to_jsonb(g)->>(p_field||'_source_image_id'),'') from gate g))::uuid
    ),
    'evidence', coalesce((
        select jsonb_agg(jsonb_build_object(
            'source','vehicle_field_sources','value',fs.field_value,
            'source_type',fs.source_type,'confidence',fs.confidence_score,
            'verified',fs.is_verified,'reasoning',fs.ai_reasoning,
            'image_id',fs.source_image_id,'at',fs.created_at)
            order by fs.confidence_score desc nulls last)
        from vehicle_field_sources fs
        where fs.vehicle_id = p_vehicle_id and fs.field_name = p_field
          and coalesce(fs.field_value,'') <> ''), '[]'::jsonb),
    'observations', coalesce((
        select jsonb_agg(jsonb_build_object(
            'id',o.id,'content',left(o.content_text,400),
            'value',o.structured_data->>p_field,'confidence',o.confidence_score,
            'observed_at',o.observed_at,'kind',o.kind::text,
            'source_slug',s.slug,'trust',s.base_trust_score,'source_url',o.source_url)
            order by o.confidence_score desc nulls last)
        from vehicle_observations o
        left join observation_sources s on s.id = o.source_id
        where o.vehicle_id = p_vehicle_id and coalesce(o.is_superseded,false)=false
          and o.structured_data ? p_field), '[]'::jsonb)
  ) end
$$;

grant execute on function public.get_field_provenance(uuid, text) to anon, authenticated;
