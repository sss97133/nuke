-- Phase 8.1: get_image_ecosystem_status() — the ONE standing status call. Consolidates
-- the coverage scoreboard with the gate backlog and cascade-arm fill, every number
-- carrying source DNA. Reads the per-vehicle counter + small evidence tables only — never
-- a 38.9M scan. Replaces "cron succeeded" log-watching with a real health surface.
create or replace function get_image_ecosystem_status()
returns jsonb
language sql stable security definer set search_path = public as $$
  with sb as (select * from get_fleet_analysis_scoreboard()),
  gate as (
    select coalesce(sum(greatest(0, photos - gated_t0)), 0) gate_backlog,
           coalesce(sum(stale_rehash), 0) stale_rehash
    from image_coverage_by_vehicle
  ),
  arms as (
    select
      (select count(*) from technician_work_evidence)  tech_evidence,
      (select count(*) from equipment_usage_evidence)  equipment_evidence,
      (select count(*) from consumables)               consumables,
      (select count(*) from image_observations where is_active) engine_rows_active
  )
  select jsonb_build_object(
    'corpus_filter', 'is_external=false (personal corpus)',
    'coverage', jsonb_build_object(
      'vehicles', sb.vehicles,
      'photos', sb.photos,
      'gated_t0', sb.gated_t0,
      'seen_t1', sb.seen_t1,
      'placed_t2', sb.placed_t2,
      'with_clip', sb.with_clip,
      'confirmed_t4', sb.confirmed_t4,
      'pct_deep', sb.pct_deep,
      'pct_engine', sb.pct_engine,
      'pct_clip', round(sb.with_clip::numeric / nullif(sb.placed_t2, 0), 4),
      'depth_score_avg', sb.depth_score_avg
    ),
    'flow', jsonb_build_object(
      'inflow_7d', sb.inflow_7d,
      'seen_7d', sb.seen_7d,
      'inflow_deficit_7d', greatest(0, sb.inflow_7d - sb.seen_7d),
      'gate_backlog', gate.gate_backlog,
      'stale_rehash_queue', gate.stale_rehash
    ),
    'cascade_arms', jsonb_build_object(
      'engine_rows_active', arms.engine_rows_active,
      'technician_work_evidence', arms.tech_evidence,
      'equipment_usage_evidence', arms.equipment_evidence,
      'consumables', arms.consumables,
      'note', 'arms 3-5 are entity-resolution + owner-confirm gated; see 18-deep-image-analysis.md'
    ),
    'source_dna', jsonb_build_object(
      'canonical_marker', 'T1=ai_scan_metadata?byok_deep_analysis + T2=image_observations row',
      'rollup', 'image_coverage_by_vehicle counter (refresh_image_coverage per vehicle)',
      'computed_at', now()
    )
  )
  from sb, gate, arms;
$$;
grant execute on function get_image_ecosystem_status() to anon, authenticated, service_role;
