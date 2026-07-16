-- Light up connected_t3 + cascade_atoms in the coverage RPC (were hardcoded 0/false, Phase 5
-- placeholders). connected_t3 = personal images that contributed >=1 cascade atom (Tier 3
-- CONNECTED); cascade_atoms = total atoms across the 5 ARM evidence tables for the vehicle. All
-- per-vehicle/indexed, never a corpus scan. depth_score_avg now incorporates the real connected
-- flag (arms-fired component of nuke_image_depth_score). Per-image depth stays COMPUTED (ontology
-- §III: current state is computed from the observation stack, not a stored snapshot) — exposed via
-- get_image_depth_score so every deep-analyzed image carries a depth number without a 38.9M ALTER.
create or replace function get_vehicle_analysis_coverage(p_vehicle_id uuid)
returns table(vehicle_id uuid, photos integer, gated_t0 integer, seen_t1 integer, placed_t2 integer,
  with_clip integer, connected_t3 integer, confirmed_t4 integer, cascade_atoms integer,
  stale_rehash integer, inflow_7d integer, seen_7d integer, depth_score_avg numeric,
  pct_deep numeric, pct_engine numeric, source_dna jsonb)
language sql stable security definer set search_path = 'public' as $function$
  with imgs as (
    select id, ai_scan_metadata, coalesce(stale,false) stale, vision_gate_status,
           taken_at, created_at, coalesce(taken_at::date, created_at::date) d
    from vehicle_images where vehicle_id = p_vehicle_id and is_external = false
  ),
  obs as (
    select image_id, bool_or(embedding_clip_vitb32 is not null) has_clip
    from image_observations where vehicle_id = p_vehicle_id and coalesce(is_active,true) and image_id is not null
    group by image_id
  ),
  connected_imgs as (
    select derived_from_image_id img from equipment_usage_evidence where vehicle_id=p_vehicle_id and derived_from_image_id is not null
    union select derived_from_image_id from consumable_usage_evidence where vehicle_id=p_vehicle_id and derived_from_image_id is not null
    union select derived_from_image_id from part_observation_evidence where vehicle_id=p_vehicle_id and derived_from_image_id is not null
    union select derived_from_image_id from scene_micro_atom_evidence where vehicle_id=p_vehicle_id and derived_from_image_id is not null
    union select derived_from_image_id from technician_work_evidence where vehicle_id=p_vehicle_id and derived_from_image_id is not null
  ),
  atom_total as (
    select (select count(*) from equipment_usage_evidence where vehicle_id=p_vehicle_id)
         + (select count(*) from consumable_usage_evidence where vehicle_id=p_vehicle_id)
         + (select count(*) from part_observation_evidence where vehicle_id=p_vehicle_id)
         + (select count(*) from scene_micro_atom_evidence where vehicle_id=p_vehicle_id)
         + (select count(*) from technician_work_evidence where vehicle_id=p_vehicle_id) n
  ),
  confirmed_days as (
    select distinct session_date from work_sessions where vehicle_id = p_vehicle_id and owner_confirmed_at is not null
  ),
  j as (
    select (i.vision_gate_status='approved') gated, (i.ai_scan_metadata ? 'byok_deep_analysis') seen,
           (o.image_id is not null) placed, coalesce(o.has_clip,false) clip,
           (ci.img is not null) connected, (cd.session_date is not null) confirmed,
           i.stale, i.ai_scan_metadata, i.taken_at, i.created_at
    from imgs i
    left join obs o on o.image_id = i.id
    left join connected_imgs ci on ci.img = i.id
    left join confirmed_days cd on cd.session_date = i.d
  )
  select p_vehicle_id, count(*)::int, count(*) filter(where gated)::int, count(*) filter(where seen)::int,
    count(*) filter(where placed)::int, count(*) filter(where clip)::int, count(*) filter(where connected)::int,
    count(*) filter(where confirmed)::int, (select n from atom_total)::int,
    count(*) filter(where seen and stale)::int,
    count(*) filter(where taken_at >= now()-interval '7 days' or created_at >= now()-interval '7 days')::int,
    count(*) filter(where seen and (taken_at >= now()-interval '7 days' or created_at >= now()-interval '7 days'))::int,
    coalesce(round(avg(nuke_image_depth_score(gated,seen,ai_scan_metadata,placed,clip,connected,confirmed,stale)),4),0),
    round(count(*) filter(where gated and seen)::numeric / nullif(count(*) filter(where gated),0),4),
    round(count(*) filter(where gated and placed)::numeric / nullif(count(*) filter(where gated),0),4),
    jsonb_build_object('corpus_filter','is_external=false','t1_marker','ai_scan_metadata ? byok_deep_analysis',
      't2_marker','image_observations row','t3_marker','>=1 row in ARM evidence tables (equip/consum/parts/micro/tech)',
      'cascade_atoms_basis','sum of 5 ARM evidence tables','t4_marker','work_sessions.owner_confirmed_at','computed_at',now())
  from j;
$function$;

-- per-image depth accessor (computed, not stored) — DoD#5: every deep-analyzed image carries a depth.
create or replace function get_image_depth_score(p_image_id uuid)
returns numeric language sql stable security definer set search_path='public' as $$
  select coalesce(round(nuke_image_depth_score(
    vi.vision_gate_status='approved', vi.ai_scan_metadata ? 'byok_deep_analysis', vi.ai_scan_metadata,
    exists(select 1 from image_observations o where o.image_id=vi.id and coalesce(o.is_active,true)),
    exists(select 1 from image_observations o where o.image_id=vi.id and o.embedding_clip_vitb32 is not null),
    exists(select 1 from part_observation_evidence e where e.derived_from_image_id=vi.id
           union all select 1 from scene_micro_atom_evidence e where e.derived_from_image_id=vi.id
           union all select 1 from equipment_usage_evidence e where e.derived_from_image_id=vi.id),
    false, coalesce(vi.stale,false)),4),0)
  from vehicle_images vi where vi.id=p_image_id;
$$;
grant execute on function get_image_depth_score(uuid) to anon, authenticated, service_role;
