-- profile_fix_*: evidence-gated fixes for the top scorecard failure patterns. All writes go through _pf_update (logged, reversible via profile_fix_revert(run)).
-- Never touches owner_id / origin_organization_id / organization_vehicles / ownership tables; never deletes vehicles.

-- (1) auto-resolve review_needed photos so they can reach galleries (approve only; never reject, never touch people-held photos)
create or replace function public.profile_fix_review_resolve_v1(p_vehicle uuid, p_dry boolean default true, p_run uuid default gen_random_uuid())
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

-- (2) minimum-evidence rule for condition_rating / known_flaws, and template-highlights cleanup
create or replace function public.profile_fix_min_evidence_v1(p_vehicle uuid, p_dry boolean default true, p_run uuid default gen_random_uuid())
returns jsonb
language plpgsql
set search_path to 'public','pg_temp'
as $f$
declare v record; cs record; fl record; new_kf text; out jsonb := '{}'::jsonb; r jsonb; mp int; mz int; mf int;
begin
  select num::int into mp from profile_quality_rules where rule_key='cond_min_photos';
  select num::int into mz from profile_quality_rules where rule_key='cond_min_zones';
  select num::int into mf from profile_quality_rules where rule_key='flaw_min_photos';
  select condition_rating, known_flaws, highlights into v from vehicles where id = p_vehicle;
  if not found then return jsonb_build_object('error','vehicle not found'); end if;

  if v.condition_rating is not null then
    select * into cs from _pq_condition_support(p_vehicle);
    if not cs.ok and not exists (select 1 from field_evidence fe where fe.vehicle_id = p_vehicle
          and fe.field_name in ('mechanical_condition','body_condition','interior_condition') and fe.status in ('accepted','pending','conflicted')) then
      r := _pf_update(p_run, 'min_evidence_condition_v1', 'vehicles', p_vehicle, 'condition_rating', 'null'::jsonb, p_vehicle,
            jsonb_build_object('scored_photos', cs.scored, 'zones', cs.zones, 'min_photos', mp, 'min_zones', mz, 'was', v.condition_rating), p_dry);
      if r is not null then out := out || jsonb_build_object('condition_rating', 'nulled'); end if;
    end if;
  end if;

  if v.known_flaws is not null and btrim(v.known_flaws) <> '' then
    select count(*)::int total, count(*) filter (where synthesized and supported)::int sup,
           count(*) filter (where synthesized and not supported)::int unsup, count(*) filter (where not synthesized)::int free
      into fl from _pq_flaw_lines(p_vehicle);
    if fl.unsup > 0 then
      select string_agg(line, E'\n' order by line_no) into new_kf from _pq_flaw_lines(p_vehicle) where (not synthesized) or supported;
      r := _pf_update(p_run, 'min_evidence_known_flaws_v1', 'vehicles', p_vehicle, 'known_flaws', to_jsonb(new_kf), p_vehicle,
            jsonb_build_object('lines_total', fl.total, 'lines_supported', fl.sup, 'lines_unsupported', fl.unsup, 'lines_free_text', fl.free, 'min_photos_per_zone', mf,
                               'dropped', (select jsonb_agg(jsonb_build_object('line', line, 'support', support, 'boilerplate', boilerplate)) from _pq_flaw_lines(p_vehicle) where synthesized and not supported)), p_dry);
      if r is not null then out := out || jsonb_build_object('known_flaws', case when new_kf is null then 'nulled' else 'trimmed' end); end if;
    end if;
  end if;

  if v.highlights ~ '^[0-9]+ photos across [0-9]+ documented zones(\n[0-9]+ modifications identified from photo evidence)?$' then
    r := _pf_update(p_run, 'generic_highlights_v1', 'vehicles', p_vehicle, 'highlights', 'null'::jsonb, p_vehicle,
          jsonb_build_object('reason', 'auto template (photo/zone counts), not a highlight'), p_dry);
    if r is not null then out := out || jsonb_build_object('highlights', 'nulled'); end if;
  end if;
  return out || jsonb_build_object('vehicle', p_vehicle, 'dry', p_dry);
end $f$;

-- (3) junk / placeholder / malformed values
create or replace function public.profile_fix_junk_values_v1(p_vehicle uuid, p_dry boolean default true, p_run uuid default gen_random_uuid())
returns jsonb
language plpgsql
set search_path to 'public','pg_temp'
as $f$
declare v jsonb; c text; val text; out jsonb := '[]'::jsonb; r jsonb; arr jsonb; joined text; yr int;
begin
  select to_jsonb(t) into v from vehicles t where t.id = p_vehicle;
  if v is null then return jsonb_build_object('error','vehicle not found'); end if;
  -- (a) blank / generic placeholders in descriptive text columns -> NULL
  foreach c in array array['color','color_primary','interior_color','trim','model','make','engine_size','transmission','body_style','drivetrain','fuel_type','engine_type','series'] loop
    val := v->>c;
    if val is not null and (btrim(val) = '' or lower(btrim(val)) in ('n/a','na','none','null','unknown','tbd','other','various','undefined','-','--','?','not specified','unspecified','not available')) then
      r := _pf_update(p_run, 'junk_generic_value_v1', 'vehicles', p_vehicle, c, 'null'::jsonb, p_vehicle, jsonb_build_object('was', val, 'reason', 'blank or generic placeholder'), p_dry);
      if r is not null then out := out || jsonb_build_array(r); end if;
    end if;
  end loop;
  -- (b) placeholder VIN (modern VIN ending in a sequence / repeated chars) with no supporting evidence anywhere
  val := v->>'vin'; yr := nullif(v->>'year','')::int;
  if val is not null and yr >= 1981 and (upper(val) ~ '(123456|000000|XXXXXX)$' or upper(val) ~ '^(.)\1{8,}')
     and not exists (select 1 from vehicle_identifiers vi where vi.vehicle_id = p_vehicle and vi.kind = 'vin' and vi.superseded_at is null)
     and not exists (select 1 from field_evidence fe where fe.vehicle_id = p_vehicle and fe.field_name = 'vin' and fe.status in ('accepted','pending','conflicted') and upper(fe.proposed_value) = upper(val))
     and (v->>'vin_source_image_id') is null then
    r := _pf_update(p_run, 'junk_placeholder_vin_v1', 'vehicles', p_vehicle, 'vin', 'null'::jsonb, p_vehicle,
          jsonb_build_object('was', val, 'reason', 'placeholder pattern, no identifier/evidence/photo support'), p_dry);
    if r is not null then out := out || jsonb_build_array(r); end if;
  end if;
  -- (c) raw JSON-array text stored in text columns -> newline list (content preserved)
  foreach c in array array['known_flaws','highlights','modifications','equipment','maintenance_notes','recent_service_history'] loop
    val := v->>c;
    if val ~ '^\s*\[' then
      begin
        arr := val::jsonb;
        if jsonb_typeof(arr) = 'array' and not exists (select 1 from jsonb_array_elements(arr) e where jsonb_typeof(e) <> 'string') then
          select string_agg(btrim(e #>> '{}'), E'\n') into joined from jsonb_array_elements(arr) e where btrim(e #>> '{}') <> '';
          r := _pf_update(p_run, 'malformed_json_text_v1', 'vehicles', p_vehicle, c, to_jsonb(joined), p_vehicle, jsonb_build_object('reason', 'JSON array stored as text'), p_dry);
          if r is not null then out := out || jsonb_build_array(r); end if;
        end if;
      exception when others then null;
      end;
    end if;
  end loop;
  return jsonb_build_object('vehicle', p_vehicle, 'dry', p_dry, 'changes', out);
end $f$;

revoke all on function public.profile_fix_review_resolve_v1(uuid,boolean,uuid), public.profile_fix_min_evidence_v1(uuid,boolean,uuid), public.profile_fix_junk_values_v1(uuid,boolean,uuid) from public, anon, authenticated;

-- (4) generalise at the source: synthesize_profile_from_vision no longer invents condition/flaws/highlights from thin evidence
create or replace function public.synthesize_profile_from_vision(p_vehicle_id uuid)
 returns jsonb
 language plpgsql
as $function$
DECLARE
  v_mods text[]; v_damage text[]; v_mod_text text; v_flaw_text text; v_avg_condition numeric;
  v_photo_count int; v_zone_count int; v_updated_fields text[] := ARRAY[]::text[]; v_current record;
  v_min_flaw int; v_cond_ok boolean;
BEGIN
  SELECT modifications, known_flaws, highlights, condition_rating INTO v_current FROM vehicles WHERE id = p_vehicle_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'vehicle not found'); END IF;
  SELECT num::int INTO v_min_flaw FROM public.profile_quality_rules WHERE rule_key = 'flaw_min_photos';
  SELECT ok INTO v_cond_ok FROM public._pq_condition_support(p_vehicle_id);

  SELECT array_agg(flag ORDER BY cnt DESC) INTO v_mods FROM (
    SELECT replace(initcap(replace(flag, '_', ' ')), 'Aftermarket ', '') as flag, count(*) as cnt
    FROM vehicle_images, unnest(modification_flags) as flag
    WHERE vehicle_id = p_vehicle_id AND is_duplicate IS NOT TRUE AND public.vehicle_image_gallery_eligible(vehicle_images)
      AND modification_flags IS NOT NULL AND modification_flags != '{}'
    GROUP BY flag HAVING count(*) >= 2 ORDER BY count(*) DESC LIMIT 20) sub;

  -- damage lines: a zone line needs >= flaw_min_photos eligible photos, a located zone, and is not the model's default "Paint Fade, Rust" pair
  SELECT array_agg(zone_damage) INTO v_damage FROM (
    SELECT initcap(replace(vi.vehicle_zone, '_', ' ')) || ': ' ||
           string_agg(DISTINCT replace(initcap(replace(flag, '_', ' ')), 'Uv ', 'UV '), ', ') as zone_damage
    FROM vehicle_images vi, unnest(vi.damage_flags) as flag
    WHERE vi.vehicle_id = p_vehicle_id AND vi.is_duplicate IS NOT TRUE AND public.vehicle_image_gallery_eligible(vi)
      AND vi.damage_flags IS NOT NULL AND vi.damage_flags != '{}'
      AND flag NOT IN ('dust_accumulation', 'dirt_accumulation', 'grime_accumulation')
      AND vi.vehicle_zone IS NOT NULL AND vi.vehicle_zone <> 'other'
    GROUP BY vi.vehicle_zone
    HAVING count(DISTINCT flag) >= 2 AND count(DISTINCT vi.id) >= v_min_flaw
       AND NOT (array_agg(DISTINCT flag) <@ ARRAY['paint_fade','rust'] AND array_agg(DISTINCT flag) @> ARRAY['paint_fade','rust'])
    ORDER BY count(*) DESC LIMIT 10) sub;

  SELECT count(DISTINCT vehicle_zone), count(*) INTO v_zone_count, v_photo_count FROM vehicle_images
  WHERE vehicle_id = p_vehicle_id AND is_duplicate IS NOT TRUE AND public.vehicle_image_gallery_eligible(vehicle_images) AND vehicle_zone IS NOT NULL;

  SELECT round(avg(condition_score), 1) INTO v_avg_condition FROM vehicle_images
  WHERE vehicle_id = p_vehicle_id AND is_duplicate IS NOT TRUE AND public.vehicle_image_gallery_eligible(vehicle_images) AND condition_score IS NOT NULL;

  IF v_current.modifications IS NULL AND v_mods IS NOT NULL AND array_length(v_mods, 1) > 0 THEN
    v_mod_text := array_to_string(v_mods, E'\n');
    UPDATE vehicles SET modifications = v_mod_text, updated_at = now() WHERE id = p_vehicle_id;
    v_updated_fields := array_append(v_updated_fields, 'modifications');
  END IF;

  IF v_current.known_flaws IS NULL AND v_damage IS NOT NULL AND array_length(v_damage, 1) > 0 THEN
    v_flaw_text := array_to_string(v_damage, E'\n');
    UPDATE vehicles SET known_flaws = v_flaw_text, updated_at = now() WHERE id = p_vehicle_id;
    v_updated_fields := array_append(v_updated_fields, 'known_flaws');
  END IF;

  -- highlights: no longer auto-generated (photo/zone counts are not a highlight)

  IF v_current.condition_rating IS NULL AND v_avg_condition IS NOT NULL AND coalesce(v_cond_ok, false) THEN
    UPDATE vehicles SET condition_rating = least(10, greatest(1, round(v_avg_condition * 2)::int)), updated_at = now() WHERE id = p_vehicle_id;
    v_updated_fields := array_append(v_updated_fields, 'condition_rating');
  END IF;

  IF array_length(v_updated_fields, 1) > 0 THEN
    BEGIN PERFORM persist_auction_readiness(p_vehicle_id); EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;

  RETURN jsonb_build_object('vehicle_id', p_vehicle_id, 'updated_fields', to_jsonb(v_updated_fields),
    'modifications_count', coalesce(array_length(v_mods, 1), 0), 'damage_zones', coalesce(array_length(v_damage, 1), 0),
    'photo_count', v_photo_count, 'zone_count', v_zone_count, 'avg_condition', v_avg_condition, 'condition_evidence_ok', v_cond_ok);
END;
$function$;

-- (5) scorecard: pre-1981 chassis numbers may be up to 17 chars (e.g. 14-digit Mercedes)
do $$
declare d text;
begin
  select pg_get_functiondef('public.profile_quality_snapshot_v1(uuid,uuid,text,text,boolean)'::regprocedure) into d;
  d := replace(d, '^[A-Z0-9]{5,13}$', '^[A-Z0-9]{5,17}$');
  execute d;
end $$;
revoke all on function public.profile_quality_snapshot_v1(uuid,uuid,text,text,boolean) from public, anon, authenticated;
