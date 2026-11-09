-- Exact existing reader snapshot for the guarded atomic-photo migration contract.
CREATE OR REPLACE FUNCTION public.identifier_consensus(p_vehicle_id uuid, p_kind text DEFAULT 'vin'::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
with gate as (
  select v.id, v.vin from public.vehicles v
  where v.id = p_vehicle_id and (v.is_public = true or auth.uid() in (v.user_id, v.owner_id, v.uploaded_by))
), claims as (
  select i.*,
    coalesce(i.evidence_class, case i.source_kind
      when 'photo' then 'photo_text' when 'title' then 'document' when 'kardex' then 'document'
      when 'coa' then 'document' when 'owner' then 'owner' when 'listing_text' then 'listing_text'
      else 'legacy_column' end) as ev
  from public.vehicle_identifiers i join gate g on g.id = i.vehicle_id
  where i.superseded_at is null
    and (i.kind = p_kind or (p_kind = 'vin' and i.kind in ('vin','chassis')))
  union all
  -- the bare column is itself a (weak) claim when no backfilled row exists for it
  select null, g.id, 'vin', g.vin, upper(regexp_replace(g.vin, '[\s\-/.]', '', 'g')), null, null,
         'legacy_vin_column', null, null, null, 'vehicles.vin', null, null, null, 'unchecked', now(), null,
         'legacy_column', null, null, 'column:vehicles.vin', 'legacy_column'
  from gate g
  where p_kind = 'vin' and nullif(btrim(g.vin), '') is not null
    and not exists (select 1 from public.vehicle_identifiers x where x.vehicle_id = g.id
      and x.source_kind = 'legacy_vin_column' and x.superseded_at is null
      and x.value_norm = upper(regexp_replace(g.vin, '[\s\-/.]', '', 'g')))
), grouped as (
  -- a partial read (digits only) supports the longer value it prefixes when the rest is a short letter suffix
  select c.*, coalesce((select max(o.value_norm) from claims o
      where o.value_norm <> c.value_norm and c.value_norm ~ '^[0-9]+$'
        and left(o.value_norm, length(c.value_norm)) = c.value_norm
        and substr(o.value_norm, length(c.value_norm)+1) ~ '^[A-Z]{1,3}$'), c.value_norm) as grp
  from claims c
), weighted as (
  select g.*,
    coalesce(g.independence_key, g.contributor_id::text,
      case when g.source_kind = 'photo' then 'photo:' else 'text:' end
        || coalesce(substring(g.source_url from '^https?://(?:www\.)?([^/]+)'), g.extractor, 'unknown')) as fam,
    least(0.9, (case g.ev when 'plate_stamping' then 0.60 when 'document' then 0.50 when 'registry' then 0.50
        when 'listing_text' then 0.35 when 'owner' then 0.35 when 'photo_text' then 0.25 else 0.20 end)
      * greatest(0.3, least(1.6, coalesce(ct.trust_mean, 0.5) / 0.5))) as w
  from grouped g
  left join public.contributor_trust ct on ct.contributor_id = g.contributor_id and ct.family = 'identity'
), ranked as (
  select w2.*, row_number() over (partition by grp, fam order by w desc) as rk from weighted w2
), fam as (
  select grp, fam, 1 - exp(sum(ln(1 - least(0.95, w * case when rk = 1 then 1 else 0.3 end)))) as fw
  from ranked group by grp, fam
), val as (
  select f.grp, 1 - exp(sum(ln(1 - least(0.95, f.fw)))) as conf, count(*) as independent_sources
  from fam f group by f.grp
), ordered as (
  select v.*, row_number() over (order by conf desc, grp) as pos from val v
), summary as (
  select o.grp, o.conf, o.independent_sources, o.pos,
    (select count(*) from weighted w where w.grp = o.grp) as citations,
    (select count(distinct w.source_image_id) from weighted w where w.grp = o.grp and w.source_image_id is not null) as images,
    (select array_agg(distinct coalesce(substring(w.source_url from '^https?://(?:www\.)?([^/.]+)'), w.extractor))
       from weighted w where w.grp = o.grp and w.source_image_id is null) as text_sources,
    (select jsonb_object_agg(ev, n) from (select ev, count(*) n from weighted w where w.grp = o.grp group by ev) e) as evidence_mix,
    (select array_agg(distinct rule_status) from weighted w where w.grp = o.grp and rule_status in ('out_of_range','no_rule')) as rule_flags,
    (select w.value from weighted w where w.grp = o.grp and w.value_norm = o.grp
       order by case w.ev when 'plate_stamping' then 0 when 'document' then 1 when 'listing_text' then 2 else 3 end, w.observed_at
       limit 1) as display_value
  from ordered o
), top as (select * from summary where pos = 1), second as (select * from summary where pos = 2)
select case when not exists (select 1 from gate) then null else jsonb_build_object(
  'kind', p_kind,
  'status', case when not exists (select 1 from top) then 'none'
    when (select conf from top) * (1 - coalesce((select conf from second), 0)) >= 0.5
         and coalesce((select conf from second), 0) < 0.5 * (select conf from top) then 'resolved'
    when exists (select 1 from second) then 'conflict' else 'weak' end,
  'canonical_value', case when (select conf from top) * (1 - coalesce((select conf from second), 0)) >= 0.5
         and coalesce((select conf from second), 0) < 0.5 * (select conf from top)
    then (select display_value from top) end,
  'confidence', round(((select conf from top) * (1 - coalesce((select conf from second), 0)))::numeric, 3),
  'citation_summary', (select citations || case when citations = 1 then ' source' else ' sources' end || ': '
      || concat_ws(' + ', case when images > 0 then images || case when images = 1 then ' image' else ' images' end end,
                   case when text_sources is not null then array_to_string(text_sources, ', ') || ' text' end)
     from top),
  'values', coalesce((select jsonb_agg(jsonb_build_object('value', s.display_value, 'value_norm', s.grp,
      'confidence', round(s.conf::numeric, 3), 'independent_sources', s.independent_sources,
      'citations', s.citations, 'images', s.images, 'text_sources', to_jsonb(s.text_sources),
      'evidence_mix', s.evidence_mix, 'rule_flags', to_jsonb(s.rule_flags)) order by s.pos) from summary s), '[]'::jsonb),
  'shared_with_vehicles', (select count(*) from public.vehicles o, top t
     where upper(trim(o.vin)) in (t.grp, upper(trim(t.display_value))) and o.id <> p_vehicle_id
       and o.status is distinct from 'merged' and o.deleted_at is null),
  'method', 'identifier_consensus_v1'
) end
$function$;
