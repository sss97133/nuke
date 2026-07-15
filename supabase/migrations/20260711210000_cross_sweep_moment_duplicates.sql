-- ════════════════════════════════════════════════════════════════════════════
-- Cross-sweep moment duplicates (2026-07-11, K5 evidence day 2024-10-03).
--
-- THE WOUND: the personal library was ingested by 4 separate sweeps over 6 months
-- (user_upload 2025-10, hd_archive 2026-03-07, iphoto 2026-03-23, ssd_blast
-- 2026-04-11). Each sweep landed its own export of the same capture moment —
-- different resize/re-encode (different file_hash), second- vs ms-precision
-- taken_at. K5 day 2024-10-03: ~19 capture moments → 75 approved rows, every
-- one burned through BYOK deep analysis.
--
-- Why the existing organs missed it:
--   • trg_flag_duplicate_image needs identical file_hash — exports differ.
--   • flag_image_burst_duplicates needs phash — 0/75 of these rows have one.
--
-- THE FIX (no new structures — extends the existing duplicate organ family):
--   1. flag_cross_sweep_moment_duplicates(): a deterministic sibling detector
--      keyed on the cross-sweep signature — same vehicle, same second-bucket
--      taken_at, every row from a DIFFERENT source, at most one distinct
--      sub-second value (the ms rows are the untruncated originals), file-name
--      stems that exist must agree. Writes the SAME marker as its siblings:
--      is_duplicate=true, duplicate_of=<keeper>, + provenance breadcrumb in
--      ai_scan_metadata.duplicate_collapse. NEVER deletes (trust invariants).
--   2. get_vehicle_analysis_coverage / get_day_analysis_coverage: exclude
--      is_duplicate/is_superseded rows so day frame counts stop inflating
--      (mirrors how vision_gate_status exclusions work).
--   3. recompute_worth_minutes: same exclusion — duplicate frames at one
--      timestamp inflated the count(*)×5min labor floor 3-4x.
--   (The BYOK prepare worklist gets the matching filter in
--    scripts/deep-image-analysis-byok.mjs — that is where the token burn stops.)
--
-- Guards (a group that fails ANY guard is skipped and counted, never marked):
--   • ≥2 rows in the (vehicle, second) bucket
--   • every row from a distinct source (same-source pairs = possible burst —
--     that is flag_image_burst_duplicates' jurisdiction, not ours)
--   • ≤1 distinct non-zero sub-second fraction (two different ms values in one
--     second = two real captures)
--   • ≤1 distinct file-name stem among named rows (conflicting stems = two
--     different photos that happened to land on the same second)
-- ════════════════════════════════════════════════════════════════════════════

-- p_max_groups bounds ONE call's write set: trg_sync_vehicle_primary_image fires
-- per marked row (UPDATE OF is_duplicate) and recomputes the hero — a dense
-- vehicle marked in one statement exceeds the 120s statement timeout. Callers
-- loop until rows_marked = 0.
drop function if exists public.flag_cross_sweep_moment_duplicates(uuid, date, boolean);
create or replace function public.flag_cross_sweep_moment_duplicates(
  p_vehicle_id uuid,
  p_day date default null,
  p_dry_run boolean default false,
  p_max_groups int default 25
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_groups int := 0;
  v_skipped int := 0;
  v_marked int := 0;
  v_moments jsonb := '[]'::jsonb;
begin
  drop table if exists _csm;
  create temp table _csm on commit drop as
  with cand as (
    select id, source, taken_at, file_size, file_hash, ai_scan_metadata,
           date_trunc('second', taken_at) as sec,
           (extract(microseconds from taken_at)::bigint % 1000000) as frac_us,
           nullif(regexp_replace(coalesce(file_name,''), '\.[A-Za-z0-9]+$', ''), '') as stem,
           (ai_scan_metadata ? 'byok_deep_analysis') as seen
    from vehicle_images
    where vehicle_id = p_vehicle_id
      and is_external = false
      and taken_at is not null
      and coalesce(is_duplicate, false) = false
      and coalesce(is_superseded, false) = false
      and (vision_gate_status is null
           or vision_gate_status in ('pending','approved','review_needed'))
      and (p_day is null or (taken_at >= p_day and taken_at < p_day + 1))
  ),
  buckets as (
    select sec, count(*) as n,
           (count(*) = count(distinct source)) as one_per_source,
           (count(distinct frac_us) filter (where frac_us > 0) <= 1) as one_moment,
           (count(distinct stem) <= 1) as stems_agree
    from cand group by sec
    having count(*) >= 2
  ),
  ranked as (
    select c.*, b.one_per_source and b.one_moment and b.stems_agree as ok,
           row_number() over (
             partition by c.sec
             order by c.seen desc,
                      public.image_hero_score(c.ai_scan_metadata, c.file_size) desc,
                      (c.file_hash is not null) desc,
                      coalesce(c.file_size, 0) desc,
                      c.id desc
           ) as rn
    from cand c join buckets b using (sec)
  )
  select r.id, r.sec, r.source, r.rn, r.ok,
         first_value(r.id) over (partition by r.sec order by r.rn) as keeper_id
  from ranked r;

  select count(distinct sec) filter (where ok),
         count(distinct sec) filter (where not ok)
    into v_groups, v_skipped from _csm;

  if p_dry_run then
    select coalesce(jsonb_agg(m), '[]'::jsonb) into v_moments from (
      select jsonb_build_object(
        'moment', to_char(sec at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'keeper', keeper_id,
        'duplicates', jsonb_agg(jsonb_build_object('id', id, 'source', source)
                                order by rn) filter (where rn > 1)
      ) as m
      from _csm where ok group by sec, keeper_id order by sec limit 200
    ) s;
  else
    update vehicle_images vi
    set is_duplicate = true,
        duplicate_of = t.keeper_id,
        updated_at = now(),
        ai_scan_metadata = jsonb_set(
          coalesce(vi.ai_scan_metadata, '{}'::jsonb), '{duplicate_collapse}',
          jsonb_build_object(
            'method', 'cross_sweep_moment_v1',
            'canonical', t.keeper_id,
            'moment', to_char(t.sec at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
            'detected_at', now()))
    from _csm t
    where vi.id = t.id and t.ok and t.rn > 1
      and (p_max_groups is null or t.sec in
             (select distinct sec from _csm where ok order by sec limit p_max_groups));
    get diagnostics v_marked = row_count;
  end if;

  return jsonb_build_object(
    'vehicle_id', p_vehicle_id, 'day', p_day, 'dry_run', p_dry_run,
    'groups_collapsible', v_groups, 'groups_skipped_ambiguous', v_skipped,
    'rows_marked', v_marked)
    || case when p_dry_run then jsonb_build_object('moments', v_moments) else '{}'::jsonb end;
end $$;

revoke all on function public.flag_cross_sweep_moment_duplicates(uuid, date, boolean, int)
  from public, anon, authenticated;
grant execute on function public.flag_cross_sweep_moment_duplicates(uuid, date, boolean, int)
  to service_role;

comment on function public.flag_cross_sweep_moment_duplicates(uuid, date, boolean, int) is
  'Marks cross-sweep re-ingestions of the same capture moment (same second-bucket taken_at, all-distinct sources, one sub-second value, agreeing name stems) as is_duplicate → duplicate_of=<keeper>. Keeper = verdict-bearing, then image_hero_score, then content-rooted, then largest export. Sibling of flag_image_burst_duplicates (phash) and trg_flag_duplicate_image (file_hash) — this one needs neither hash. Never deletes. Dry-run returns the groups. p_max_groups bounds one call''s write set (hero trigger fires per row) — loop until rows_marked=0.';

-- ── coverage RPCs: duplicates leave the denominator ─────────────────────────
-- (bodies identical to 20260617000000_image_analysis_coverage_rpc.sql except
--  the imgs CTEs exclude is_duplicate/is_superseded rows + source_dna says so)

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
      and coalesce(is_duplicate,false) = false and coalesce(is_superseded,false) = false
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
      'dedup_filter','is_duplicate=false and is_superseded=false (cross-sweep/burst duplicates excluded 2026-07-11)',
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
      and coalesce(is_duplicate,false) = false and coalesce(is_superseded,false) = false
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

-- ── day-depth (BarcodeTimeline): same exclusion — this is the surface where
--    "75 frames on a ~19-moment day" was user-visible ──────────────────────
-- (body identical to 20260617020000_day_depth_rpc.sql except the imgs CTE)
create or replace function get_vehicle_day_depth(p_vehicle_id uuid)
returns table(day date, photos int, seen int, placed int, depth numeric)
language sql stable security definer set search_path = public as $$
  with imgs as (
    select id, ai_scan_metadata, coalesce(stale,false) stale,
           (vision_gate_status='approved') gated,
           (ai_scan_metadata ? 'byok_deep_analysis') seen,
           coalesce(taken_at::date, created_at::date) d
    from vehicle_images
    where vehicle_id = p_vehicle_id and is_external = false
      and coalesce(is_duplicate,false) = false and coalesce(is_superseded,false) = false
      and coalesce(taken_at::date, created_at::date) is not null
  ),
  obs as (
    select image_id, bool_or(embedding_clip_vitb32 is not null) clip
    from image_observations
    where vehicle_id = p_vehicle_id and coalesce(is_active,true) and image_id is not null
    group by image_id
  ),
  confirmed_days as (
    select distinct session_date from work_sessions
    where vehicle_id = p_vehicle_id and owner_confirmed_at is not null
  ),
  j as (
    select i.d, i.gated, i.seen, i.stale, i.ai_scan_metadata,
           (o.image_id is not null) placed, coalesce(o.clip,false) clip,
           (cd.session_date is not null) confirmed
    from imgs i
    left join obs o on o.image_id = i.id
    left join confirmed_days cd on cd.session_date = i.d
  )
  select d,
    count(*)::int,
    count(*) filter (where seen)::int,
    count(*) filter (where placed)::int,
    coalesce(round(avg(nuke_image_depth_score(gated,seen,ai_scan_metadata,placed,clip,false,confirmed,stale)),4),0)
  from j group by d order by d;
$$;
grant execute on function get_vehicle_day_depth(uuid) to anon, authenticated, service_role;

-- ── worth-minutes: duplicate frames stop inflating the labor floor ──────────
-- (body identical to 20260617050000_recompute_worth_minutes.sql except lf/ad
--  exclude is_duplicate/is_superseded rows)
create or replace function recompute_worth_minutes(p_vehicle_id uuid)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  with lf as (
    select vi.taken_at::date d, vi.taken_at ts,
      extract(epoch from (vi.taken_at - lag(vi.taken_at) over (partition by vi.taken_at::date order by vi.taken_at)))/60 gap
    from vehicle_images vi
    where vi.vehicle_id = p_vehicle_id and vi.is_external = false and vi.vision_gate_status = 'approved'
      and coalesce(vi.is_duplicate,false) = false and coalesce(vi.is_superseded,false) = false
      and vi.source is distinct from 'imessage' and vi.taken_at is not null
      and vi.ai_scan_metadata->'byok_deep_analysis'->>'intent' = 'labor'
      and (vi.ai_scan_metadata->'byok_deep_analysis'->>'intent_confidence')::numeric >= 0.6 ),
  b as (select d, ts, sum((gap is null or gap > 45)::int) over (partition by d order by ts) burst from lf),
  -- v3 per Worth Engine calibration spec (2026-05-23): GREATEST(span, n_photos × 5min) + 10min trailing
  bd as (select d, burst,
           greatest(round(extract(epoch from (max(ts) - min(ts)))/60), count(*) * 5) + 10 mins
         from b group by d, burst),
  dm as (select d, least(480, sum(mins))::int labor_minutes from bd group by d),
  ad as (select distinct taken_at::date d from vehicle_images
         where vehicle_id = p_vehicle_id and is_external = false and vision_gate_status = 'approved'
           and coalesce(is_duplicate,false) = false and coalesce(is_superseded,false) = false
           and ai_scan_metadata ? 'byok_deep_analysis' and taken_at is not null),
  upd as (
    update work_sessions ws set
      duration_minutes = coalesce(dm.labor_minutes, 0),
      total_labor_cost = round(coalesce(dm.labor_minutes, 0)/60.0 * 85, 2),
      total_job_cost   = round(coalesce(dm.labor_minutes, 0)/60.0 * 85 + coalesce(ws.total_parts_cost, 0), 2),
      metadata = jsonb_set(coalesce(ws.metadata, '{}'::jsonb), '{labor_minutes_recomputed_at}', to_jsonb(now()::text))
    from ad left join dm on dm.d = ad.d
    where ws.vehicle_id = p_vehicle_id and ws.session_date = ad.d
      and ws.owner_confirmed_at is null and ws.owner_confirmed_by is null
    returning 1)
  select count(*) into n from upd; return n;
end $$;
grant execute on function recompute_worth_minutes(uuid) to service_role;
