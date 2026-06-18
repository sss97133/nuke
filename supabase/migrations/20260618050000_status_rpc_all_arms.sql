-- Extend the standing status RPC's cascade_arms to include the two arms added this session
-- (ARM6 part_observation_evidence + the micro-atom lane scene_micro_atom_evidence) and a
-- connected_t3 rollup, so the Phase-8 dashboard reflects the full butterfly cascade.
create or replace function get_image_ecosystem_status()
returns jsonb language sql stable security definer set search_path to 'public' as $function$
  with sb as (select * from get_fleet_analysis_scoreboard()),
  gate as (
    select coalesce(sum(greatest(0, photos - gated_t0)),0) gate_backlog,
           coalesce(sum(stale_rehash),0) stale_rehash,
           coalesce(sum(connected_t3),0) connected_t3
    from image_coverage_by_vehicle
  ),
  arms as (
    select (select count(*) from technician_work_evidence)  tech_evidence,
           (select count(*) from equipment_usage_evidence)  equipment_evidence,
           (select count(*) from consumable_usage_evidence) consumable_evidence,
           (select count(*) from part_observation_evidence) part_evidence,
           (select count(*) from scene_micro_atom_evidence) micro_atoms,
           (select count(*) from image_observations where is_active) engine_rows_active
  )
  select jsonb_build_object(
    'corpus_filter','is_external=false (personal corpus)',
    'coverage', jsonb_build_object('vehicles',sb.vehicles,'photos',sb.photos,'gated_t0',sb.gated_t0,
      'seen_t1',sb.seen_t1,'placed_t2',sb.placed_t2,'with_clip',sb.with_clip,'connected_t3',gate.connected_t3,
      'confirmed_t4',sb.confirmed_t4,'pct_deep',sb.pct_deep,'pct_engine',sb.pct_engine,
      'pct_clip',round(sb.with_clip::numeric/nullif(sb.placed_t2,0),4),'depth_score_avg',sb.depth_score_avg),
    'flow', jsonb_build_object('inflow_7d',sb.inflow_7d,'seen_7d',sb.seen_7d,
      'inflow_deficit_7d',greatest(0,sb.inflow_7d-sb.seen_7d),'gate_backlog',gate.gate_backlog,
      'stale_rehash_queue',gate.stale_rehash),
    'cascade_arms', jsonb_build_object('engine_rows_active',arms.engine_rows_active,
      'technician_work_evidence',arms.tech_evidence,'equipment_usage_evidence',arms.equipment_evidence,
      'consumable_usage_evidence',arms.consumable_evidence,'part_observation_evidence',arms.part_evidence,
      'scene_micro_atoms',arms.micro_atoms,
      'total_cascade_atoms', arms.tech_evidence+arms.equipment_evidence+arms.consumable_evidence+arms.part_evidence+arms.micro_atoms,
      'note','ARM3 tech/ARM4 equip/ARM5 consum are entity+owner-confirm gated; ARM6 parts + micro-atoms cascade per-batch; see 18-deep-image-analysis.md'),
    'source_dna', jsonb_build_object('canonical_marker','T1=ai_scan_metadata?byok_deep_analysis + T2=image_observations row',
      'rollup','image_coverage_by_vehicle counter (refresh_image_coverage per vehicle)','computed_at',now())
  ) from sb, gate, arms;
$function$;
