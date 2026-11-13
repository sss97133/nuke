drop function if exists public.profile_fix_review_resolve_v1(uuid,boolean,uuid);
create or replace function public.profile_fix_review_resolve_v1(p_vehicle uuid, p_dry boolean default true, p_run uuid default gen_random_uuid(), p_max int default null)
returns jsonb
language plpgsql
set search_path to 'public','pg_temp'
as $f$
declare mn int; msh numeric; r record; n_a int := 0; n_b int := 0; v_rem int; v_people int; ev jsonb; rsn text;
begin
  select num::int into mn from profile_quality_rules where rule_key = 'review_cluster_min';
  select num into msh from profile_quality_rules where rule_key = 'review_cluster_share';
  perform set_config('app.skip_image_count_trigger', '1', true);   -- counts are recomputed by profile_fix_refresh_derived_v1 afterwards
  for r in
    with cand as (
      select vi.id, vi.vehicle_id, (vi.taken_at at time zone 'UTC')::date dt, vi.vision_gate_attribution_confidence conf,
             vi.image_vehicle_match_status ms, vi.vision_gate_agent_reasoning rsn
      from vehicle_images vi
      where vi.vehicle_id = p_vehicle and vi.vision_gate_status = 'review_needed'
        and vi.is_duplicate is not true and vi.is_superseded is not true
        and coalesce(vi.is_document,false) = false and vi.doc_flag is null and coalesce(vi.is_sensitive,false) = false
        and coalesce(vi.image_vehicle_match_status,'') not in ('mismatch','unrelated')
        and coalesce(vi.vision_gate_agent_reasoning,'') !~* '(apple_vision_people|person|people|selfie|face)'
        and not exists (select 1 from photo_extracted_fields pe where pe.image_id = vi.id and pe.field_name = 'core.is_automotive' and lower(pe.value) = 'false')
    ), clu as (
      select (vi.taken_at at time zone 'UTC')::date dt,
             count(*) filter (where vi.vision_gate_status = 'approved')::int a,
             count(*) filter (where vi.vision_gate_status = 'rejected_misattributed')::int m,
             count(*) filter (where vi.vision_gate_status = 'rejected_personal')::int p
      from vehicle_images vi
      where vi.vehicle_id = p_vehicle and vi.is_duplicate is not true and vi.is_superseded is not true and vi.taken_at is not null
        and vi.vision_gate_status in ('approved','rejected_misattributed','rejected_personal')
      group by 1
    ), unf as (
      select (i.taken_at at time zone 'UTC')::date dt, count(*)::int u
      from photo_gate_unfile_log l join vehicle_images i on i.id = l.image_id
      where l.old_vehicle_id = p_vehicle and l.action = 'unfiled' and l.reverted_at is null and i.taken_at is not null group by 1
    )
    select c.id, c.dt, c.conf, c.ms, c.rsn, coalesce(k.a,0) a, coalesce(k.m,0) + coalesce(u.u,0) m, coalesce(k.p,0) p,
           case when c.dt is not null and coalesce(k.a,0) + coalesce(k.m,0) + coalesce(u.u,0) + coalesce(k.p,0) >= mn
                     and coalesce(k.p,0) = 0
                     and coalesce(k.a,0)::numeric / nullif(coalesce(k.a,0) + coalesce(k.m,0) + coalesce(u.u,0) + coalesce(k.p,0),0) >= msh
                     and (c.rsn is null or c.rsn like 'no layer produced a verdict%' or c.rsn like 'L4-claimed:%' or c.rsn like 'L4-cron-claimed:%')
                then 'A_day_cluster'
                when c.ms = 'confirmed' and coalesce(c.conf,0) >= 0.9 then 'B_confirmed_match' end rule
    from cand c left join clu k on k.dt = c.dt left join unf u on u.dt = c.dt
  loop
    continue when r.rule is null;
    exit when p_max is not null and (n_a + n_b) >= p_max;   -- batch cap so very large vehicles can be resolved over several calls
    if r.rule = 'A_day_cluster' then
      ev := jsonb_build_object('rule', r.rule, 'day', r.dt, 'cluster_approved', r.a, 'cluster_rejected', r.m, 'cluster_people', r.p, 'min_n', mn, 'min_share', msh);
      rsn := 'auto-resolved (profile_fix_review_resolve_v1/A): ' || r.a || ' of ' || (r.a + r.m) || ' decided same-day photos on this vehicle are approved';
      n_a := n_a + 1;
    else
      ev := jsonb_build_object('rule', r.rule, 'match_status', r.ms, 'attribution_confidence', r.conf);
      rsn := 'auto-resolved (profile_fix_review_resolve_v1/B): vehicle match confirmed at ' || r.conf;
      n_b := n_b + 1;
    end if;
    perform _pf_update(p_run, 'review_resolve_v1', 'vehicle_images', r.id, 'vision_gate_status', to_jsonb('approved'::text), p_vehicle, ev, p_dry);
    perform _pf_update(p_run, 'review_resolve_v1', 'vehicle_images', r.id, 'vision_gate_processed_at', to_jsonb(now()), p_vehicle, ev, p_dry);
    perform _pf_update(p_run, 'review_resolve_v1', 'vehicle_images', r.id, 'vision_gate_agent_reasoning', to_jsonb(rsn), p_vehicle, ev, p_dry);
    perform _pf_update(p_run, 'review_resolve_v1', 'vehicle_images', r.id, 'vision_gate_attribution_confidence',
                       to_jsonb(case when r.rule = 'A_day_cluster' then round(0.85 * r.a::numeric / nullif(r.a + r.m,0), 2) else r.conf end), p_vehicle, ev, p_dry);
  end loop;
  select count(*) filter (where vision_gate_status = 'review_needed'),
         count(*) filter (where vision_gate_status = 'review_needed' and vision_gate_agent_reasoning like 'Held for review (apple_vision_people%')
    into v_rem, v_people
  from vehicle_images where vehicle_id = p_vehicle and is_duplicate is not true and is_superseded is not true;
  return jsonb_build_object('vehicle', p_vehicle, 'dry', p_dry, 'approved_A', n_a, 'approved_B', n_b, 'review_needed_now', v_rem, 'people_held', v_people);
end $f$;

alter function public.profile_fix_review_resolve_v1(uuid,boolean,uuid,int) set statement_timeout = '600s';
revoke all on function public.profile_fix_review_resolve_v1(uuid,boolean,uuid,int) from public, anon, authenticated;
