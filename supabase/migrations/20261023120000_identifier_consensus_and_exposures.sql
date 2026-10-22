-- Identifier consensus: a VIN/chassis number is a claim, validated by consistent citation
-- across a vehicle's provenance (ID plate/stamping photos > documents > listing text > bare column).
-- Format rules only FLAG a claim; they never decide it. Additive and reversible:
--   * new nullable columns on vehicle_identifiers
--   * new table identifier_exposures (one row per image exposure of an identifier)
--   * new read-only function identifier_consensus()
--   * get_field_provenance('vin') falls back to the consensus value when vehicles.vin is empty
-- Revert: restore the previous get_field_provenance body (migration history), drop the new objects.

alter table public.vehicle_identifiers
  add column if not exists evidence_class text,
  add column if not exists contributor_id uuid references public.contributors(id),
  add column if not exists source_observation_id uuid,
  add column if not exists independence_key text;

do $$ begin
  alter table public.vehicle_identifiers add constraint vehicle_identifiers_evidence_class_check
    check (evidence_class is null or evidence_class in
      ('plate_stamping','document','photo_text','listing_text','owner','registry','legacy_column'));
exception when duplicate_object then null; end $$;

create table if not exists public.identifier_exposures (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  image_id uuid not null references public.vehicle_images(id) on delete cascade,
  kind text not null check (kind in ('vin','chassis','engine','body_number','transmission','assigned_vin','coachbuilder_plate')),
  read_value text not null,
  value_norm text generated always as (upper(regexp_replace(coalesce(read_value,''), '[\s\-/.]', '', 'g'))) stored,
  evidence_class text not null check (evidence_class in ('plate_stamping','document','photo_text')),
  region jsonb,                 -- bbox / label of the visible region when the reader recorded one
  reader text not null,         -- e.g. photo_pipeline_caption_v1, rapidocr_box_v1, ios_vision_v1, user_agent
  reader_observation_id uuid,   -- the observation / text-read row the exposure was parsed from
  contributor_id uuid references public.contributors(id),
  reader_confidence numeric check (reader_confidence is null or reader_confidence between 0 and 1),
  quote text,
  partial boolean not null default false,  -- e.g. '2383' stamped where the full number is '2383 GT'
  run_id uuid,
  created_at timestamptz not null default now(),
  superseded_at timestamptz
);
create unique index if not exists identifier_exposures_uniq
  on public.identifier_exposures (image_id, kind, value_norm, reader);
create index if not exists identifier_exposures_vehicle on public.identifier_exposures (vehicle_id) where superseded_at is null;
create index if not exists identifier_exposures_run on public.identifier_exposures (run_id);
alter table public.identifier_exposures enable row level security;

-- Every exposure is also a photo-evidence claim in vehicle_identifiers (same run id, so one revert covers both).
create or replace function public.identifier_exposure_to_claim()
returns trigger language plpgsql security definer set search_path to 'public','pg_temp' as $f$
begin
  if new.partial then return new; end if;
  insert into public.vehicle_identifiers
    (vehicle_id, kind, value, make_canonical, source_kind, source_url, source_image_id, quote, extractor,
     run_id, confidence, rule_status, evidence_class, contributor_id, source_observation_id, independence_key)
  select new.vehicle_id, new.kind, new.read_value, upper(v.make), 'photo', i.image_url, new.image_id, new.quote,
         new.reader, new.run_id, coalesce(new.reader_confidence, 0.5), 'unchecked', new.evidence_class, new.contributor_id,
         new.reader_observation_id,
         'photo:'||coalesce(substring(i.image_url from '^https?://([^/]+)'),'unknown')
  from public.vehicle_images i join public.vehicles v on v.id = new.vehicle_id
  where i.id = new.image_id
  on conflict do nothing;
  return new;
end $f$;
drop trigger if exists trg_identifier_exposure_to_claim on public.identifier_exposures;
create trigger trg_identifier_exposure_to_claim after insert on public.identifier_exposures
  for each row execute function public.identifier_exposure_to_claim();

-- Consensus. confidence = 1 - prod over independent families (1 - family weight);
-- family weight combines its citations with diminishing returns (same family != independent);
-- citation weight = evidence-class base x contributor identity trust (beta mean / 0.5, clamped).
create or replace function public.identifier_consensus(p_vehicle_id uuid, p_kind text default 'vin')
returns jsonb language sql stable security definer set search_path to 'public','pg_temp' as $f$
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
$f$;
grant execute on function public.identifier_consensus(uuid, text) to anon, authenticated;

-- Images that likely expose an identifier but have no usable read. Drained by user-agent
-- observations (MCP submit_observation path: the contributor's own agent reads the photo and
-- submits an identifier_exposures row). No server-side paid inference consumes this queue.
create table if not exists public.identifier_read_queue (
  image_id uuid primary key references public.vehicle_images(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  reason text not null,          -- e.g. caption_mentions_plate, classification_failed, document_label
  expected_kinds text[] not null default array['vin','chassis'],
  priority int not null default 50,
  status text not null default 'pending' check (status in ('pending','claimed','read','unreadable','skipped')),
  claimed_by uuid references public.contributors(id),
  claimed_at timestamptz,
  result_exposure_id uuid references public.identifier_exposures(id),
  run_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists identifier_read_queue_pending on public.identifier_read_queue (priority desc, created_at) where status = 'pending';
alter table public.identifier_read_queue enable row level security;

-- get_field_provenance: identical to the previous body except the 'value' fallback and the added
-- 'identifier_consensus' key for p_field = 'vin'.
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
 AND (o.source_observation_id IS NULL OR EXISTS (SELECT FROM public.vehicle_observations dp WHERE dp.id=o.source_observation_id AND (public.retained_description_property_matches(dp,o) OR public.retained_listing_identity_matches(dp,o) OR public.retained_craigslist_odometer_matches(dp,o) OR public.retained_craigslist_year_matches(dp,o) OR public.retained_description_year_matches(dp,o) OR public.retained_description_identity_matches(dp,o))) OR EXISTS (
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
    'value', coalesce(nullif(btrim((select to_jsonb(g)->>p_field from gate g)), ''),
      -- VIN: an empty column is not 'Unknown' when cited claims agree (identifier_consensus_v1)
      case when p_field = 'vin' then public.identifier_consensus(p_vehicle_id, 'vin')->>'canonical_value' end),
    'identifier_consensus', case when p_field = 'vin' then public.identifier_consensus(p_vehicle_id, 'vin') end,
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
            'source_slug',o.source_slug,'trust',o.source_trust,'source_url',o.source_url) || jsonb_build_object('identity_label_basis',o.structured_data->>'identity_label_basis','source_make_label',o.structured_data->>'source_make_label','model_label_scope',o.structured_data->>'model_label_scope')
            || CASE WHEN p_field='engine_family_label' THEN jsonb_build_object(
              'label_role',o.structured_data->>'label_role','engine_identity_status',o.structured_data->>'engine_identity_status',
              'source_capture_basis',o.structured_data->>'source_capture_basis','source_captured_at',o.structured_data->>'source_captured_at')
             ELSE '{}'::jsonb END
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
