-- get_vehicle_day_depth — Phase 6.2: per-day analysis depth for the BarcodeTimeline
-- illumination. One query per vehicle, grouped by day (indexed on vehicle_id; never a
-- corpus scan). The timeline darkens/illuminates each day cell by this depth.
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
