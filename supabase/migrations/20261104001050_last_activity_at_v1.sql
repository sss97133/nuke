-- last_activity_at v1  (2026-11-03 PT, authorized by skylar)
-- GOAL: a per-vehicle recency signal that comes ONLY from genuine activity:
--   (1) EXIF taken_at of photos filed to the vehicle by an owner / co-owner / contributor / uploader,
--   (2) real work-session end times (not photo-derived sessions),
--   (3) timeline events with genuine event_date (not backfills, merges, owner_request_*, pending_analysis, profile-fix runs).
-- It is NOT derived from vehicles.updated_at, image_count recomputes, merges, repoints or profile fixes,
-- and it never writes vehicles.updated_at (it lives in a side table, so the vehicles_update_timestamp trigger never fires).
-- Backup first: backup_20261103_get_user_garage_pre_last_activity.sql + table public.backup_20261103_get_user_garage_fn.
-- Revert: select public.revert_last_activity_at_v1();   (or 20261104001000_last_activity_at_v1_revert.sql)

-- ===== PART A: storage + helpers =====
create table if not exists public.vehicle_activity (
  vehicle_id            uuid primary key,
  last_activity_at      timestamptz,          -- greatest of the three below
  last_photo_taken_at   timestamptz,          -- EXIF taken_at of an eligible owner/contributor photo
  last_work_session_at  timestamptz,          -- real (non-derived) work session end
  last_event_at         timestamptz,          -- genuine timeline event date (noon PT, capped at now)
  computed_at           timestamptz not null default now()
);
comment on table public.vehicle_activity is 'Genuine per-vehicle activity recency (EXIF photos by owner/contributors, real work sessions, genuine timeline events). Never derived from updated_at/recomputes/merges. Row with all-null = computed, no genuine activity.';
create index if not exists vehicle_activity_last_activity_at_idx on public.vehicle_activity (last_activity_at desc nulls last);
alter table public.vehicle_activity enable row level security;
drop policy if exists vehicle_activity_select on public.vehicle_activity;
create policy vehicle_activity_select on public.vehicle_activity for select to anon, authenticated
  using (exists (select 1 from public.vehicles v where v.id = vehicle_activity.vehicle_id
                 and (v.is_public = true or v.user_id = auth.uid() or v.owner_id = auth.uid())));
grant select on public.vehicle_activity to anon, authenticated;

-- people whose activity counts for a vehicle: owner / uploader / active non-"previously_owned" permission / contributor / current ownership / approved title verification
create or replace function public.vehicle_activity_user_ok(p_vehicle uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = public as $f$
  select p_user is not null and (
    exists (select 1 from vehicles v where v.id = p_vehicle and p_user in (v.user_id, v.owner_id, v.uploaded_by))
    or exists (select 1 from vehicle_user_permissions p where p.vehicle_id = p_vehicle and p.user_id = p_user
               and p.revoked_at is null and coalesce(p.is_active, true) and p.role <> 'previously_owned')
    or exists (select 1 from vehicle_contributors c where c.vehicle_id = p_vehicle and c.user_id = p_user)
    or exists (select 1 from vehicle_ownerships o where o.vehicle_id = p_vehicle and o.owner_profile_id = p_user and o.is_current = true)
    or exists (select 1 from ownership_verifications ov where ov.vehicle_id = p_vehicle and ov.user_id = p_user and ov.status = 'approved'));
$f$;

-- monotonic bump used by the triggers (only ever raises a value; writes nothing if not newer)
create or replace function public.vehicle_activity_bump(p_vehicle uuid, p_kind text, p_ts timestamptz)
returns void language plpgsql security definer set search_path = public as $f$
begin
  if p_vehicle is null or p_ts is null or p_ts > now() then return; end if;
  insert into vehicle_activity as a (vehicle_id, last_photo_taken_at, last_work_session_at, last_event_at, last_activity_at)
  values (p_vehicle,
          case when p_kind = 'photo' then p_ts end,
          case when p_kind = 'work_session' then p_ts end,
          case when p_kind = 'event' then p_ts end,
          p_ts)
  on conflict (vehicle_id) do update set
    last_photo_taken_at  = greatest(a.last_photo_taken_at,  excluded.last_photo_taken_at),
    last_work_session_at = greatest(a.last_work_session_at, excluded.last_work_session_at),
    last_event_at        = greatest(a.last_event_at,        excluded.last_event_at),
    last_activity_at     = greatest(a.last_activity_at,     excluded.last_activity_at),
    computed_at          = now()
  where (p_kind = 'photo'        and (a.last_photo_taken_at  is null or a.last_photo_taken_at  < p_ts))
     or (p_kind = 'work_session' and (a.last_work_session_at is null or a.last_work_session_at < p_ts))
     or (p_kind = 'event'        and (a.last_event_at        is null or a.last_event_at        < p_ts))
     or a.last_activity_at is null or a.last_activity_at < p_ts;
end $f$;

-- full recompute for one vehicle (backfill + repair tool; replaces the row with exact values)
create or replace function public.compute_vehicle_activity(p_vehicle uuid)
returns timestamptz language plpgsql security definer set search_path = public as $f$
declare ok uuid[]; ph timestamptz; ws timestamptz; ev timestamptz; la timestamptz;
begin
  select array_agg(distinct u) into ok from (
    select user_id u from vehicles where id = p_vehicle
    union all select owner_id from vehicles where id = p_vehicle
    union all select uploaded_by from vehicles where id = p_vehicle
    union all select user_id from vehicle_user_permissions where vehicle_id = p_vehicle and revoked_at is null and coalesce(is_active, true) and role <> 'previously_owned'
    union all select user_id from vehicle_contributors where vehicle_id = p_vehicle
    union all select owner_profile_id from vehicle_ownerships where vehicle_id = p_vehicle and is_current = true
    union all select user_id from ownership_verifications where vehicle_id = p_vehicle and status = 'approved') x
  where u is not null;
  if ok is not null then
    select vi.taken_at into ph from vehicle_images vi
     where vi.vehicle_id = p_vehicle and vi.taken_at is not null and vi.taken_at <= now()
       and vi.user_id = any(ok)
       and not coalesce(vi.is_superseded, false) and not coalesce(vi.is_duplicate, false)
       and vi.vision_gate_status::text not like 'rejected%'
       and coalesce(vi.image_vehicle_match_status, '') not in ('mismatch', 'unrelated')
     order by vi.taken_at desc limit 1;
    select max(least(now(), coalesce(w.end_time, w.start_time, (w.session_date::timestamp + interval '12 hours') at time zone 'America/Los_Angeles')))
      into ws from work_sessions w
     where w.vehicle_id = p_vehicle and w.user_id = any(ok)
       and not (coalesce(w.status, '') = 'derived' and coalesce(w.session_type, '') = 'capture_derived' and w.owner_confirmed_at is null);
    select max(least(now(), (t.event_date::timestamp + interval '12 hours') at time zone 'America/Los_Angeles'))
      into ev from timeline_events t
     where t.vehicle_id = p_vehicle and t.user_id = any(ok)
       and public.timeline_event_is_genuine_activity(t.event_type, t.source, t.data_source, t.metadata, t.merged_from_vehicle_id, t.event_date);
  end if;
  la := greatest(ph, ws, ev);
  insert into vehicle_activity as a (vehicle_id, last_activity_at, last_photo_taken_at, last_work_session_at, last_event_at, computed_at)
  values (p_vehicle, la, ph, ws, ev, now())
  on conflict (vehicle_id) do update set last_activity_at = excluded.last_activity_at, last_photo_taken_at = excluded.last_photo_taken_at,
    last_work_session_at = excluded.last_work_session_at, last_event_at = excluded.last_event_at, computed_at = now();
  return la;
end $f$;

-- what counts as a genuine timeline event (shared by trigger + recompute)
create or replace function public.timeline_event_is_genuine_activity(p_type text, p_source text, p_data_source text, p_meta jsonb, p_merged_from uuid, p_date date)
returns boolean language sql stable set search_path = public as $f$
  select p_date is not null and p_date <= current_date and p_date >= date '1950-01-01'
    and p_merged_from is null
    and coalesce(p_type, '') not in ('pending_analysis', 'photo_session', 'batch_image_upload')
    and coalesce(p_source, '')      !~* '(owner_request|profile_fix|merge|backfill|repoint|recompute|migration)'
    and coalesce(p_data_source, '') !~* '(owner_request|profile_fix|merge|backfill|repoint|recompute|migration)'
    and coalesce(p_meta ->> 'added_by', '') !~* 'owner_request'
    and coalesce(p_meta ->> 'source', '')   !~* '(owner_request|profile_fix|backfill)';
$f$;

-- ===== PART B: maintenance triggers (never raise; never write vehicles) =====
create or replace function public.trg_vehicle_activity_image() returns trigger language plpgsql security definer set search_path = public as $f$
begin
  begin
    if new.vehicle_id is not null and new.user_id is not null and new.taken_at is not null and new.taken_at <= now()
       and not coalesce(new.is_superseded, false) and not coalesce(new.is_duplicate, false)
       and new.vision_gate_status::text not like 'rejected%'
       and coalesce(new.image_vehicle_match_status, '') not in ('mismatch', 'unrelated')
       and public.vehicle_activity_user_ok(new.vehicle_id, new.user_id) then
      perform public.vehicle_activity_bump(new.vehicle_id, 'photo', new.taken_at);
    end if;
  exception when others then null;
  end;
  return null;
end $f$;

create or replace function public.trg_vehicle_activity_work_session() returns trigger language plpgsql security definer set search_path = public as $f$
declare ts timestamptz;
begin
  begin
    if new.vehicle_id is not null and new.user_id is not null
       and not (coalesce(new.status, '') = 'derived' and coalesce(new.session_type, '') = 'capture_derived' and new.owner_confirmed_at is null)
       and public.vehicle_activity_user_ok(new.vehicle_id, new.user_id) then
      ts := least(now(), coalesce(new.end_time, new.start_time, (new.session_date::timestamp + interval '12 hours') at time zone 'America/Los_Angeles'));
      perform public.vehicle_activity_bump(new.vehicle_id, 'work_session', ts);
    end if;
  exception when others then null;
  end;
  return null;
end $f$;

create or replace function public.trg_vehicle_activity_timeline() returns trigger language plpgsql security definer set search_path = public as $f$
declare ts timestamptz;
begin
  begin
    if new.vehicle_id is not null and new.user_id is not null
       and public.timeline_event_is_genuine_activity(new.event_type, new.source, new.data_source, new.metadata, new.merged_from_vehicle_id, new.event_date)
       and public.vehicle_activity_user_ok(new.vehicle_id, new.user_id) then
      ts := least(now(), (new.event_date::timestamp + interval '12 hours') at time zone 'America/Los_Angeles');
      perform public.vehicle_activity_bump(new.vehicle_id, 'event', ts);
    end if;
  exception when others then null;
  end;
  return null;
end $f$;

-- (apply with lock_timeout so a busy table never queues writers behind us)
set lock_timeout = '4s';
drop trigger if exists z_vehicle_activity_img_ins on public.vehicle_images;
create trigger z_vehicle_activity_img_ins after insert on public.vehicle_images
  for each row when (new.vehicle_id is not null and new.user_id is not null and new.taken_at is not null)
  execute function public.trg_vehicle_activity_image();
drop trigger if exists z_vehicle_activity_img_upd on public.vehicle_images;
create trigger z_vehicle_activity_img_upd after update of vehicle_id, taken_at, vision_gate_status, is_superseded, is_duplicate, image_vehicle_match_status on public.vehicle_images
  for each row when (new.vehicle_id is not null and new.user_id is not null and new.taken_at is not null)
  execute function public.trg_vehicle_activity_image();

drop trigger if exists z_vehicle_activity_ws on public.work_sessions;
create trigger z_vehicle_activity_ws after insert or update of vehicle_id, start_time, end_time, session_date, status, session_type, owner_confirmed_at on public.work_sessions
  for each row when (new.vehicle_id is not null and new.user_id is not null)
  execute function public.trg_vehicle_activity_work_session();

drop trigger if exists z_vehicle_activity_te on public.timeline_events;
create trigger z_vehicle_activity_te after insert or update of vehicle_id, event_date, event_type, source, data_source on public.timeline_events
  for each row when (new.vehicle_id is not null and new.user_id is not null and new.event_date is not null)
  execute function public.trg_vehicle_activity_timeline();
reset lock_timeout;

-- ===== PART C: batched backfill (resumable) =====
create table if not exists public.vehicle_activity_backfill_state (
  id int primary key default 1 check (id = 1), phase int not null default 0, cursor uuid, done boolean not null default false,
  processed bigint not null default 0, updated_at timestamptz not null default now());
insert into public.vehicle_activity_backfill_state (id) values (1) on conflict do nothing;

-- phase 0: every vehicle that has a relationship row (owners/permissions/contributors/ownerships/verifications) -> garage vehicles first
-- phase 1: keyset over vehicles that have a human owner/uploader column. Vehicles with no human relationship at all cannot have
--          eligible activity by definition, so they correctly have no row (NULL last_activity_at).
create or replace function public.backfill_vehicle_activity(p_budget_ms int default 6000, p_batch int default 100)
returns jsonb language plpgsql security definer set search_path = public as $f$
declare st vehicle_activity_backfill_state%rowtype; t0 timestamptz := clock_timestamp(); n int := 0; ids uuid[]; v uuid; stop boolean := false;
begin
  if not pg_try_advisory_xact_lock(hashtext('vehicle_activity_backfill')) then return jsonb_build_object('skipped', 'locked'); end if;
  select * into st from vehicle_activity_backfill_state where id = 1;
  if st.done then return jsonb_build_object('done', true, 'processed', st.processed); end if;
  while not stop and (clock_timestamp() - t0) < make_interval(secs => p_budget_ms / 1000.0) loop
    if st.phase = 0 then
      ids := array(select r.vehicle_id from (
                select vehicle_id from vehicle_user_permissions union select vehicle_id from vehicle_contributors
                union select vehicle_id from vehicle_ownerships union select vehicle_id from ownership_verifications) r
              where r.vehicle_id is not null and not exists (select 1 from vehicle_activity a where a.vehicle_id = r.vehicle_id) limit p_batch);
      if coalesce(cardinality(ids), 0) = 0 then st.phase := 1; continue; end if;
      foreach v in array ids loop
        perform compute_vehicle_activity(v); n := n + 1;
        if (clock_timestamp() - t0) >= make_interval(secs => p_budget_ms / 1000.0) then exit; end if;
      end loop;
    else
      ids := array(select id from vehicles where id > coalesce(st.cursor, '00000000-0000-0000-0000-000000000000'::uuid)
                   and (user_id is not null or owner_id is not null or uploaded_by is not null)
                   and merged_into_vehicle_id is null and deleted_at is null order by id limit p_batch);
      if coalesce(cardinality(ids), 0) = 0 then
        update vehicle_activity_backfill_state set done = true, processed = processed + n, updated_at = now() where id = 1;
        begin perform cron.unschedule('vehicle-activity-backfill'); exception when others then null; end;
        return jsonb_build_object('done', true, 'processed', st.processed + n);
      end if;
      foreach v in array ids loop
        if not exists (select 1 from vehicle_activity a where a.vehicle_id = v) then perform compute_vehicle_activity(v); n := n + 1; end if;
        st.cursor := v;
        if (clock_timestamp() - t0) >= make_interval(secs => p_budget_ms / 1000.0) then stop := true; exit; end if;
      end loop;
    end if;
  end loop;
  update vehicle_activity_backfill_state set phase = st.phase, cursor = st.cursor, processed = processed + n, updated_at = now() where id = 1;
  return jsonb_build_object('phase', st.phase, 'cursor', st.cursor, 'processed_now', n);
end $f$;
-- cron (self-unschedules when done):
-- select cron.schedule('vehicle-activity-backfill', '* * * * *', $$select public.backfill_vehicle_activity(6000, 100)$$);

-- ===== PART D: get_user_garage orders by / exposes last_activity_at (return type changes => DROP + CREATE in one txn) =====
begin;
set local lock_timeout = '5s';
drop function if exists public.get_user_garage(uuid);
CREATE FUNCTION public.get_user_garage(p_user_id uuid)
 RETURNS TABLE(vehicle_id uuid, year integer, make text, model text, trim_name text, image_url text, current_value numeric, purchase_price numeric, image_count bigint, relationship text, last_activity_at timestamptz)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- The owner, or the service role (no user id; the books and attribution scripts), sees everything.
  WITH viewer AS (SELECT coalesce(auth.uid() = p_user_id, false) OR coalesce(auth.role() = 'service_role', false) AS is_own),
  -- prec = precedence when one vehicle is reached by several routes (lower wins).
  --   1 owner | 2 previously_owned | 3 consigned (significant non-owner role) | 4 documenting (own photos / work in last 60d)
  --   5 contributor | 6 profile_record
  src AS (
    -- owner / co_owner permissions and approved title verifications: 'owner' (owner's own view and the public projection alike)
    SELECT vehicle_id, 1 prec, NULL::timestamptz act FROM vehicle_user_permissions
      WHERE user_id=p_user_id AND revoked_at IS NULL AND coalesce(is_active,true) AND role IN ('owner','co_owner')
    UNION ALL SELECT vehicle_id, 1, NULL FROM ownership_verifications WHERE user_id=p_user_id AND status='approved'
    -- Owner-only routes (every relationship the record holds).
    UNION ALL SELECT vehicle_id, 1, NULL FROM vehicle_ownerships WHERE owner_profile_id=p_user_id AND is_current=true AND (SELECT is_own FROM viewer)
    -- significant non-owner roles carried as their own role
    UNION ALL SELECT vehicle_id, 2, NULL FROM vehicle_user_permissions
      WHERE user_id=p_user_id AND revoked_at IS NULL AND coalesce(is_active,true) AND role='previously_owned' AND (SELECT is_own FROM viewer)
    UNION ALL SELECT vehicle_id, 2, NULL FROM discovered_vehicles WHERE user_id=p_user_id AND is_active=true AND relationship_type='previously_owned' AND (SELECT is_own FROM viewer)
    UNION ALL SELECT vehicle_id, 3, NULL FROM vehicle_user_permissions
      WHERE user_id=p_user_id AND revoked_at IS NULL AND coalesce(is_active,true) AND role='consigned' AND (SELECT is_own FROM viewer)
    -- documenting: own photo uploads or work sessions in the last 60 days, ranked by recency
    UNION ALL SELECT vi.vehicle_id, 4, max(vi.created_at) FROM vehicle_images vi
      WHERE vi.user_id=p_user_id AND vi.vehicle_id IS NOT NULL AND vi.created_at >= now() - interval '60 days'
        AND coalesce(vi.is_superseded,false)=false AND (SELECT is_own FROM viewer)
      GROUP BY vi.vehicle_id
    UNION ALL SELECT ws.vehicle_id, 4, max(ws.session_date)::timestamptz FROM work_sessions ws
      WHERE ws.user_id=p_user_id AND ws.vehicle_id IS NOT NULL AND ws.session_date >= current_date - 60 AND (SELECT is_own FROM viewer)
      GROUP BY ws.vehicle_id
    UNION ALL SELECT vehicle_id, 5, NULL FROM vehicle_contributors WHERE user_id=p_user_id AND (SELECT is_own FROM viewer)
    -- Creating a profile relates it to this account; it does not establish ownership.
    UNION ALL SELECT v.id, 6, NULL FROM vehicles v
      WHERE v.user_id=p_user_id AND v.deleted_at IS NULL AND v.merged_into_vehicle_id IS NULL AND (SELECT is_own FROM viewer)
  ),
  -- follow merged_into_vehicle_id (two hops) to the canonical vehicle
  canon AS (
    SELECT coalesce(m2.id, m1.id, sv.id) AS vid, s.prec, s.act
    FROM src s
    JOIN vehicles sv ON sv.id = s.vehicle_id
    LEFT JOIN vehicles m1 ON m1.id = sv.merged_into_vehicle_id
    LEFT JOIN vehicles m2 ON m2.id = m1.merged_into_vehicle_id
  ),
  dedup AS (SELECT vid AS vehicle_id, MIN(prec) pr, max(act) act FROM canon GROUP BY vid)
  SELECT v.id, v.year, v.make, v.model, v.trim,
         COALESCE(v.primary_image_url,
                  (SELECT vi2.image_url FROM vehicle_images vi2
                     WHERE vi2.vehicle_id = v.id AND vi2.image_url IS NOT NULL
                       -- the definer skips RLS and the vision gate; a stranger gets only an admitted frame
                       AND ((SELECT is_own FROM viewer) OR public.vehicle_image_gallery_eligible(vi2))
                     ORDER BY vi2.created_at LIMIT 1)),
         CASE WHEN (SELECT is_own FROM viewer) AND d.pr <> 6 THEN
           (SELECT ne.estimated_value FROM nuke_estimates ne
              WHERE ne.vehicle_id = v.id AND ne.comp_method = 'class_stratified'
              ORDER BY ne.calculated_at DESC NULLS LAST LIMIT 1) END,
         CASE WHEN (SELECT is_own FROM viewer) AND d.pr <> 6 THEN v.purchase_price END,
         COALESCE(v.image_count, 0)::bigint,
         CASE d.pr WHEN 1 THEN 'owner' WHEN 2 THEN 'previously_owned' WHEN 3 THEN 'consigned' WHEN 4 THEN 'documenting' WHEN 5 THEN 'contributor' ELSE 'profile_record' END,
         -- genuine activity only (EXIF photos by owner/contributors, real work sessions, genuine timeline events); see vehicle_activity
         va.last_activity_at
  FROM dedup d JOIN vehicles v ON v.id=d.vehicle_id
  LEFT JOIN vehicle_activity va ON va.vehicle_id = v.id
  WHERE v.merged_into_vehicle_id IS NULL AND v.deleted_at IS NULL
    AND ((SELECT is_own FROM viewer) OR v.is_public = true)
  -- display order: relationship group (owner, documenting, previously_owned, consigned, contributor, profile_record),
  -- then most recent GENUINE activity first (was: upload created_at of filed photos only)
  ORDER BY CASE d.pr WHEN 1 THEN 1 WHEN 4 THEN 2 WHEN 2 THEN 3 WHEN 3 THEN 4 WHEN 5 THEN 5 ELSE 6 END,
           va.last_activity_at DESC NULLS LAST, v.year;
$function$;
revoke all on function public.get_user_garage(uuid) from public, anon;
grant execute on function public.get_user_garage(uuid) to postgres, authenticated, service_role;
commit;
-- ===== PART E: revert function (restores get_user_garage from public.backup_20261103_get_user_garage_fn; removes everything else) =====
create or replace function public.revert_last_activity_at_v1() returns text
language plpgsql security definer set search_path = public as $f$
declare d text;
begin
  set local lock_timeout = '5s';
  select def into d from public.backup_20261103_get_user_garage_fn order by backed_up_at limit 1;
  if d is null then raise exception 'backup of get_user_garage missing; refusing to revert'; end if;
  begin perform cron.unschedule('vehicle-activity-backfill'); exception when others then null; end;
  drop trigger if exists z_vehicle_activity_img_ins on public.vehicle_images;
  drop trigger if exists z_vehicle_activity_img_upd on public.vehicle_images;
  drop trigger if exists z_vehicle_activity_ws on public.work_sessions;
  drop trigger if exists z_vehicle_activity_te on public.timeline_events;
  drop function if exists public.get_user_garage(uuid);
  execute d;
  revoke all on function public.get_user_garage(uuid) from public, anon;
  grant execute on function public.get_user_garage(uuid) to postgres, authenticated, service_role;
  drop function if exists public.backfill_vehicle_activity(int, int);
  drop function if exists public.trg_vehicle_activity_image();
  drop function if exists public.trg_vehicle_activity_work_session();
  drop function if exists public.trg_vehicle_activity_timeline();
  drop function if exists public.compute_vehicle_activity(uuid);
  drop function if exists public.vehicle_activity_bump(uuid, text, timestamptz);
  drop function if exists public.vehicle_activity_user_ok(uuid, uuid);
  drop function if exists public.timeline_event_is_genuine_activity(text, text, text, jsonb, uuid, date);
  drop table if exists public.vehicle_activity_backfill_state;
  drop table if exists public.vehicle_activity;
  return 'reverted last_activity_at v1 (backup table kept: backup_20261103_get_user_garage_fn; this function remains: drop it manually)';
end $f$;
revoke all on function public.revert_last_activity_at_v1() from public, anon, authenticated;
