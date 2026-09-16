-- ════════════════════════════════════════════════════════════════════════════
-- image_analysis_coverage_rpc  —  Phase 1.1 of the image-ecosystem mandate
-- (docs/IMAGE_ANALYSIS_100X_PROMPT.md). The ONE canonical scoreboard for
-- "how deep-analyzed is the personal photo corpus", with source DNA on every count.
--
-- DESIGN INVARIANTS (load-bearing — do not "optimize" away):
--   • Every function is PER-VEHICLE and rides vehicle_images_vehicle_id_idx.
--     The 38.9M-row table is NEVER scanned and no jsonb aggregate runs corpus-wide
--     (that times out on the pooler — this is wound W5). The fleet number is a SUM
--     over a per-vehicle counter table, refreshed one vehicle at a time.
--   • Personal corpus = is_external=false. NOT source='user_upload': that slug is
--     only ~1 of ~9 personal sources (user_upload, iphoto, ssd_blast, hd_archive,
--     drop-folder, photo_auto_sync, capture_relay_ios, external_import,
--     bat_import_mirrored …). Filtering on user_upload undercounts personal by ~70%.
--
-- CANONICAL PER-IMAGE TIER LADDER (the intellectual adjudication — §4 of the prompt):
--   T0 GATED     vision_gate_status='approved'
--   T1 SEEN      ai_scan_metadata ? 'byok_deep_analysis'   (a deep BYOK verdict exists)
--   T2 PLACED    an active image_observations row exists    (search/convergence engine)
--   T2+CLIP      that row carries embedding_clip_vitb32
--   T3 CONNECTED the cascade fired (technician/equipment/consumable/parts evidence) [Phase 5]
--   T4 CONFIRMED the image's day work_session.owner_confirmed_at is set (the value gate)
--   analysis_depth_score ∈ [0,1]: tier attainment blended with verdict richness.
-- ════════════════════════════════════════════════════════════════════════════

-- ── per-image depth score (0–1): the rank-order key for the backlog + the timeline fuel ──
create or replace function nuke_image_depth_score(
  p_gated boolean, p_seen boolean, p_meta jsonb,
  p_placed boolean, p_clip boolean, p_connected boolean, p_confirmed boolean, p_stale boolean
) returns numeric
language sql immutable as $$
  select least(1.0, greatest(0.0,
      (case when p_gated then 0.12 else 0 end)
    + (case when p_seen  then 0.30 else 0 end)
    + (case when p_seen and coalesce((p_meta->'byok_deep_analysis'->>'context_complete')::boolean, false)
            then 0.08 else 0 end)
    + (case when p_seen and coalesce((p_meta->'byok_deep_analysis'->>'intent_confidence')::numeric, 0) >= 0.6
            then 0.08 else 0 end)
    + (case when p_seen and jsonb_typeof(p_meta->'byok_deep_analysis'->'components_seen') = 'array'
                       and jsonb_array_length(p_meta->'byok_deep_analysis'->'components_seen') > 0
            then 0.07 else 0 end)
    + (case when p_placed    then 0.13 else 0 end)
    + (case when p_clip      then 0.07 else 0 end)
    + (case when p_connected then 0.08 else 0 end)
    + (case when p_confirmed then 0.07 else 0 end)
    - (case when p_seen and p_stale then 0.05 else 0 end)
  ))::numeric;
$$;

-- ── per-vehicle coverage (the primitive everything else sums) ──
create or replace function get_vehicle_analysis_coverage(p_vehicle_id uuid)
returns table(
  vehicle_id uuid,
  photos int, gated_t0 int, seen_t1 int, placed_t2 int, with_clip int,
  connected_t3 int, confirmed_t4 int, cascade_atoms int,
  stale_rehash int, inflow_7d int, seen_7d int,
  depth_score_avg numeric, pct_deep numeric, pct_engine numeric,
  source_dna jsonb
)
language sql stable security definer set search_path = public as $$
  with imgs as (
    select id, ai_scan_metadata, coalesce(stale,false) stale, vision_gate_status,
           taken_at, created_at, coalesce(taken_at::date, created_at::date) d
    from vehicle_images
    where vehicle_id = p_vehicle_id and is_external = false
  ),
  obs as (
    select image_id, bool_or(embedding_clip_vitb32 is not null) has_clip
    from image_observations
    where vehicle_id = p_vehicle_id and coalesce(is_active,true) and image_id is not null
    group by image_id
  ),
  confirmed_days as (
    select distinct session_date from work_sessions
    where vehicle_id = p_vehicle_id and owner_confirmed_at is not null
  ),
  j as (
    select
      (i.vision_gate_status = 'approved')              as gated,
      (i.ai_scan_metadata ? 'byok_deep_analysis')      as seen,
      (o.image_id is not null)                          as placed,
      coalesce(o.has_clip, false)                       as clip,
      false                                             as connected,  -- Phase 5
      (cd.session_date is not null)                     as confirmed,
      i.stale, i.ai_scan_metadata, i.taken_at, i.created_at
    from imgs i
    left join obs o on o.image_id = i.id
    left join confirmed_days cd on cd.session_date = i.d
  )
  select
    p_vehicle_id,
    count(*)::int,
    count(*) filter (where gated)::int,
    count(*) filter (where seen)::int,
    count(*) filter (where placed)::int,
    count(*) filter (where clip)::int,
    count(*) filter (where connected)::int,
    count(*) filter (where confirmed)::int,
    0::int,  -- cascade_atoms: wired in Phase 5 (ARM3-6)
    count(*) filter (where seen and stale)::int,
    count(*) filter (where taken_at >= now()-interval '7 days' or created_at >= now()-interval '7 days')::int,
    count(*) filter (where seen and (taken_at >= now()-interval '7 days' or created_at >= now()-interval '7 days'))::int,
    coalesce(round(avg(nuke_image_depth_score(gated,seen,ai_scan_metadata,placed,clip,connected,confirmed,stale)),4),0),
    round(count(*) filter (where gated and seen)::numeric   / nullif(count(*) filter (where gated),0), 4),
    round(count(*) filter (where gated and placed)::numeric / nullif(count(*) filter (where gated),0), 4),
    jsonb_build_object(
      'corpus_filter','is_external=false',
      't0_marker','vehicle_images.vision_gate_status=approved',
      't1_marker','vehicle_images.ai_scan_metadata ? byok_deep_analysis',
      't2_marker','image_observations.is_active row (distinct image_id)',
      'clip_col','image_observations.embedding_clip_vitb32',
      't4_marker','work_sessions.owner_confirmed_at (by day)',
      'pct_basis','of T0-gated images',
      'computed_at', now()
    )
  from j;
$$;

-- ── per-day coverage (feeds the BarcodeTimeline illumination, Phase 6) ──
create or replace function get_day_analysis_coverage(p_vehicle_id uuid, p_date date)
returns table(
  vehicle_id uuid, day date,
  photos int, gated_t0 int, seen_t1 int, placed_t2 int, with_clip int, confirmed_t4 int,
  depth_score_avg numeric
)
language sql stable security definer set search_path = public as $$
  with imgs as (
    select id, ai_scan_metadata, coalesce(stale,false) stale, vision_gate_status
    from vehicle_images
    where vehicle_id = p_vehicle_id and is_external = false
      and coalesce(taken_at::date, created_at::date) = p_date
  ),
  obs as (
    select image_id, bool_or(embedding_clip_vitb32 is not null) has_clip
    from image_observations
    where vehicle_id = p_vehicle_id and coalesce(is_active,true) and image_id is not null
    group by image_id
  ),
  confirmed as (
    select exists(select 1 from work_sessions
                  where vehicle_id = p_vehicle_id and session_date = p_date
                    and owner_confirmed_at is not null) as ok
  ),
  j as (
    select
      (i.vision_gate_status='approved') gated,
      (i.ai_scan_metadata ? 'byok_deep_analysis') seen,
      (o.image_id is not null) placed,
      coalesce(o.has_clip,false) clip,
      (select ok from confirmed) confirmed,
      i.stale, i.ai_scan_metadata
    from imgs i left join obs o on o.image_id = i.id
  )
  select
    p_vehicle_id, p_date,
    count(*)::int,
    count(*) filter (where gated)::int,
    count(*) filter (where seen)::int,
    count(*) filter (where placed)::int,
    count(*) filter (where clip)::int,
    count(*) filter (where confirmed)::int,
    coalesce(round(avg(nuke_image_depth_score(gated,seen,ai_scan_metadata,placed,clip,false,confirmed,stale)),4),0)
  from j;
$$;

-- ── fleet rollup: a per-vehicle counter table (no corpus scan ever) ──
create table if not exists image_coverage_by_vehicle (
  vehicle_id uuid primary key,
  photos int, gated_t0 int, seen_t1 int, placed_t2 int, with_clip int,
  connected_t3 int, confirmed_t4 int, cascade_atoms int,
  stale_rehash int, inflow_7d int, seen_7d int,
  depth_score_avg numeric, pct_deep numeric, pct_engine numeric,
  refreshed_at timestamptz default now()
);
comment on table image_coverage_by_vehicle is
  'Per-vehicle image-analysis coverage cache (Tier 0-4). Refreshed one vehicle at a time via refresh_image_coverage(); the fleet scoreboard sums this. Personal corpus = is_external=false.';

create or replace function refresh_image_coverage(p_vehicle_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into image_coverage_by_vehicle as t
  select c.vehicle_id, c.photos, c.gated_t0, c.seen_t1, c.placed_t2, c.with_clip,
         c.connected_t3, c.confirmed_t4, c.cascade_atoms, c.stale_rehash, c.inflow_7d, c.seen_7d,
         c.depth_score_avg, c.pct_deep, c.pct_engine, now()
  from get_vehicle_analysis_coverage(p_vehicle_id) c
  on conflict (vehicle_id) do update set
    photos=excluded.photos, gated_t0=excluded.gated_t0, seen_t1=excluded.seen_t1,
    placed_t2=excluded.placed_t2, with_clip=excluded.with_clip, connected_t3=excluded.connected_t3,
    confirmed_t4=excluded.confirmed_t4, cascade_atoms=excluded.cascade_atoms,
    stale_rehash=excluded.stale_rehash, inflow_7d=excluded.inflow_7d, seen_7d=excluded.seen_7d,
    depth_score_avg=excluded.depth_score_avg, pct_deep=excluded.pct_deep, pct_engine=excluded.pct_engine,
    refreshed_at=now();
end; $$;

-- one-line fleet scoreboard — sums the counter table, with source DNA
create or replace function get_fleet_analysis_scoreboard()
returns table(
  vehicles int, photos bigint, gated_t0 bigint, seen_t1 bigint, placed_t2 bigint, with_clip bigint,
  confirmed_t4 bigint, stale_rehash bigint, inflow_7d bigint, seen_7d bigint,
  pct_deep numeric, pct_engine numeric, depth_score_avg numeric,
  refreshed_at timestamptz, source_dna jsonb
)
language sql stable security definer set search_path = public as $$
  select
    count(*)::int, sum(photos), sum(gated_t0), sum(seen_t1), sum(placed_t2), sum(with_clip),
    sum(confirmed_t4), sum(stale_rehash), sum(inflow_7d), sum(seen_7d),
    round(sum(seen_t1)::numeric  / nullif(sum(gated_t0),0), 4),
    round(sum(placed_t2)::numeric / nullif(sum(gated_t0),0), 4),
    round(avg(depth_score_avg), 4),
    max(refreshed_at),
    jsonb_build_object(
      'rollup','image_coverage_by_vehicle (per-vehicle counter table; never a 38.9M scan)',
      'corpus_filter','is_external=false',
      'canonical_marker','T1=ai_scan_metadata?byok_deep_analysis  +  T2=image_observations row',
      'computed_at', now())
  from image_coverage_by_vehicle;
$$;

grant execute on function nuke_image_depth_score(boolean,boolean,jsonb,boolean,boolean,boolean,boolean,boolean) to anon, authenticated, service_role;
grant execute on function get_vehicle_analysis_coverage(uuid) to anon, authenticated, service_role;
grant execute on function get_day_analysis_coverage(uuid,date) to anon, authenticated, service_role;
grant execute on function get_fleet_analysis_scoreboard() to anon, authenticated, service_role;
grant execute on function refresh_image_coverage(uuid) to service_role;
grant select on image_coverage_by_vehicle to anon, authenticated, service_role;
