-- Image analysis × ledger context (smallest fix from nuke-strategy/image-context-review.md).
--
-- 1. build_vehicle_context_packet(vehicle_id): one read-only jsonb packet of everything an image
--    analyzer needs to interpret a frame IN CONTEXT: identity, the description's claims
--    (vehicle_field_evidence), receipt items, the timeline (vehicle_events), observation kinds,
--    the ordered photo roster, and the Y/M/M condition baseline (NULL when none exists).
-- 2. record_contextual_image_claim(run_id, claim): the additive writer for ledger-targeted image
--    verdicts. A claim must name the ledger target it confirms / contradicts / adds; a frame the
--    document gate marks as a document cannot carry a condition claim. Every row is tagged with
--    run_id + extracted_by so revert_contextual_image_run() can supersede the whole run.
-- 3. revert_contextual_image_run(run_id): supersedes (never deletes) a run's rows.
-- Additive only: no existing row or function is changed.

set statement_timeout = '60s';
set lock_timeout = '5s';

create or replace function public.image_document_gate(p_file_name text, p_url text, p_labels text[])
returns boolean language sql immutable as $$
  select coalesce(
    (coalesce(p_file_name,'') || ' ' || coalesce(p_url,''))
      ~* '(^|[^a-z])(doc|docs|document|receipt|invoice|scan|title|buildsheet|build_sheet|window[-_ ]?sticker|carfax|repair[-_ ]?order|books|log|manual|page)([^a-z]|$)'
    or exists (select 1 from unnest(coalesce(p_labels,'{}'::text[])) l
               where lower(l) in ('document','paper','receipt','text','handwriting','invoice')),
    false);
$$;

create or replace function public.build_vehicle_context_packet(p_vehicle_id uuid, p_photo_limit integer default 400)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'packet_version', 'vcp-1',
    'vehicle_id', v.id,
    'identity', jsonb_build_object('year', v.year, 'make', v.make, 'model', v.model, 'trim', v.trim,
                                   'vin', v.vin, 'color', v.color, 'mileage', v.mileage),
    'description', v.description,
    'field_claims', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'field', e.field_name,
               'value', coalesce(e.value_text, e.value_number::text, e.value_date::text),
               'source_type', e.source_type, 'confidence', e.confidence_score) order by e.field_name)
      from (select * from vehicle_field_evidence
             where vehicle_id = v.id and coalesce(flagged_as_incorrect, false) = false
             order by created_at limit 200) e), '[]'::jsonb),
    'receipt_items', coalesce((
      select jsonb_agg(jsonb_build_object('id', ri.id, 'receipt_id', r.id, 'date', coalesce(r.receipt_date, r.transaction_date),
               'vendor', r.vendor_name, 'description', ri.description, 'part_number', ri.part_number,
               'total_price', ri.total_price) order by coalesce(r.receipt_date, r.transaction_date), ri.line_number)
      from receipts r join receipt_items ri on ri.receipt_id = r.id
      where r.vehicle_id = v.id and coalesce(r.is_superseded, false) = false), '[]'::jsonb),
    'timeline', coalesce((
      select jsonb_agg(jsonb_build_object('id', ev.id, 'event_type', ev.event_type, 'platform', ev.source_platform,
               'started_at', ev.started_at, 'ended_at', ev.ended_at, 'sold_at', ev.sold_at,
               'final_price', ev.final_price) order by coalesce(ev.started_at, ev.created_at))
      from (select * from vehicle_events where vehicle_id = v.id order by created_at limit 100) ev), '[]'::jsonb),
    'observation_kinds', coalesce((
      select jsonb_object_agg(k, n) from (
        select kind::text k, count(*) n from vehicle_observations
         where vehicle_id = v.id and coalesce(is_superseded, false) = false group by 1) o), '{}'::jsonb),
    'photos', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'position', p.position, 'file_name', p.file_name,
               'zone', p.vehicle_zone, 'angle', p.ai_detected_angle,
               'document_gate', image_document_gate(p.file_name, p.image_url, p.apple_ml_labels))
               order by p.position nulls last, p.created_at)
      from (select * from vehicle_images where vehicle_id = v.id and coalesce(is_superseded, false) = false
             order by position nulls last, created_at limit greatest(1, least(p_photo_limit, 2000))) p), '[]'::jsonb),
    'condition_baseline', (
      select jsonb_build_object('ymm_key', cd.ymm_key, 'group_size', cd.group_size, 'mean_score', cd.mean_score,
               'p25', cd.percentile_25, 'p75', cd.percentile_75, 'lifecycle_distribution', cd.lifecycle_distribution)
      from condition_distributions cd
      where cd.ymm_key = concat(v.year, '_', v.make, '_', v.model) and cd.group_type = 'ymm'
      order by cd.computed_at desc nulls last limit 1),
    'ymm_profile_present', exists(select 1 from ymm_knowledge yk where yk.ymm_key = concat(v.year, '_', v.make, '_', v.model))
  )
  from vehicles v where v.id = p_vehicle_id;
$$;

-- The contributing agent (user compute running the BYOK path). Starts on probation.
insert into public.contributors (contributor_type, source_id, agent_key, agent_version, status)
select 'agent', s.id, 'agent:grok-bot-byok', 'byok_contextual_v1', 'probation'
from observation_sources s
where s.slug = 'agent-submission'
  and not exists (select 1 from contributors c where c.agent_key = 'agent:grok-bot-byok');

create or replace function public.record_contextual_image_claim(p_run_id text, p_claim jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_image vehicle_images%rowtype;
  v_kind text := p_claim->>'kind';
  v_action text := p_claim #>> '{ledger_target,action}';
  v_ref text := p_claim #>> '{ledger_target,ref}';
  v_field text := p_claim #>> '{ledger_target,field}';
  v_excerpt text := p_claim #>> '{ledger_target,excerpt}';
  v_contributor uuid;
  v_source uuid;
  v_gate boolean;
  v_desc text;
  v_id uuid;
  v_text text := coalesce(p_claim->>'content_text', '');
begin
  if p_run_id is null or p_run_id !~ '^[A-Za-z0-9_.:-]{6,80}$' then raise exception 'run_id required'; end if;
  select * into v_image from vehicle_images where id = (p_claim->>'image_id')::uuid;
  if not found or v_image.vehicle_id is distinct from (p_claim->>'vehicle_id')::uuid then
    raise exception 'image % is not on vehicle %', p_claim->>'image_id', p_claim->>'vehicle_id';
  end if;
  if v_kind not in ('condition', 'work_record', 'provenance', 'specification') then
    raise exception 'kind % not allowed for contextual image claims', v_kind;
  end if;
  if v_action not in ('confirm', 'contradict', 'add') or v_field is null then
    raise exception 'ledger_target {field, action confirm|contradict|add} required';
  end if;
  -- confirm/contradict must point at something that is actually on the ledger.
  if v_action in ('confirm', 'contradict') then
    select description into v_desc from vehicles where id = v_image.vehicle_id;
    if not (
      (v_ref = 'description' and v_excerpt is not null and length(v_excerpt) >= 8 and position(v_excerpt in coalesce(v_desc, '')) > 0)
      or exists (select 1 from vehicle_field_evidence where id::text = v_ref and vehicle_id = v_image.vehicle_id)
      or exists (select 1 from receipt_items ri join receipts r on r.id = ri.receipt_id where ri.id::text = v_ref and r.vehicle_id = v_image.vehicle_id)
      or exists (select 1 from vehicle_events where id::text = v_ref and vehicle_id = v_image.vehicle_id)
    ) then
      raise exception 'ledger_target.ref % does not resolve on vehicle %', v_ref, v_image.vehicle_id;
    end if;
  end if;
  v_gate := image_document_gate(v_image.file_name, v_image.image_url, v_image.apple_ml_labels)
            or (p_claim->>'scene_type') in ('receipt_document', 'data_plate', 'spreadsheet');
  if v_gate and v_kind = 'condition' then
    raise exception 'document gate: image % is a document; no condition claim', v_image.id;
  end if;
  select id, source_id into v_contributor, v_source from contributors where agent_key = 'agent:grok-bot-byok' limit 1;
  if v_source is null then raise exception 'contributor agent:grok-bot-byok missing'; end if;

  -- ALLOW_RAW_TESTIMONY_WRITE: sanctioned narrow writer for ledger-targeted image claims; every row is run-tagged and revertible via revert_contextual_image_run().
  insert into vehicle_observations (vehicle_id, observed_at, source_id, source_url, source_identifier, kind,
      content_text, content_hash, structured_data, confidence_score, extraction_method, agent_model,
      extracted_by, agent_tier, observer_raw, processing_metadata, is_processed)
  values (v_image.vehicle_id, now(), v_source, v_image.image_url,
      'agent:grok-bot-byok:' || v_image.id || ':' || v_field || ':' || p_run_id, v_kind::observation_kind,
      v_text, md5(v_text || coalesce(p_claim::text, '')),
      jsonb_build_object('image_id', v_image.id, 'image_url', v_image.image_url, 'document_gate', v_gate,
        'ledger_target', p_claim->'ledger_target', 'claim', p_claim->'value', 'scene_type', p_claim->>'scene_type',
        'baseline', p_claim->'baseline', 'contributor_id', v_contributor, 'run_id', p_run_id,
        'packet_version', p_claim->>'packet_version', 'revertible', true),
      least(greatest(coalesce((p_claim->>'confidence')::numeric, 0.5), 0), 0.99),
      'byok_contextual_v1', p_claim->>'model', 'agent:grok-bot-byok', 'byok',
      jsonb_build_object('contributor_id', v_contributor, 'agent_key', 'agent:grok-bot-byok'),
      jsonb_build_object('run_id', p_run_id, 'revert_with', 'revert_contextual_image_run'), false)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.revert_contextual_image_run(p_run_id text)
returns integer language sql security definer set search_path = public as $$
  with r as (
    update vehicle_observations set is_superseded = true, superseded_at = now()
     where extracted_by = 'agent:grok-bot-byok' and processing_metadata->>'run_id' = p_run_id
       and coalesce(is_superseded, false) = false
    returning 1)
  select count(*)::int from r;
$$;

revoke all on function public.build_vehicle_context_packet(uuid, integer) from public, anon, authenticated;
revoke all on function public.record_contextual_image_claim(text, jsonb) from public, anon, authenticated;
revoke all on function public.revert_contextual_image_run(text) from public, anon, authenticated;
grant execute on function public.build_vehicle_context_packet(uuid, integer) to service_role;
grant execute on function public.record_contextual_image_claim(text, jsonb) to service_role;
grant execute on function public.revert_contextual_image_run(text) to service_role;
