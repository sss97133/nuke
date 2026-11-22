-- The garage activity clock and day squares stop treating a load date as activity.
--
-- Readers changed: vehicle_activity (the cache behind get_user_garage.last_activity_at, read by the web garage
-- card's "Active ... ago" and the iOS garage order) and get_vehicle_contribution_days_batch (the day squares and
-- the "first - last" range under them, web and iOS). Both keep their signatures.
--
-- What was wrong, measured 2026-11-21 on the 138 garage vehicles of the class price store (scripts/data/q.sh):
--   - 30 cars showed 2025-11-02 as their last activity. That day is a bulk profile import: the rows were
--     "Vehicle Profile Created" (metadata entry_type = profile_creation), "N Photos Added" (metadata upload_date)
--     and "SOLD AT AUCTION" rows built from the vehicle record (metadata vehicle_source), written 2025-12-03/04
--     and dated the import day. The rule admitted them because their source/data_source carry no import word.
--   - Listing discoveries backfilled later (metadata discovery / backfilled = true) and profile merges
--     (event_type profile_merged) counted as activity.
--   - Auction rows written by an import and dated the day they were written, with no listing-side date
--     (start_date and end_date empty): 2025-12-31 on 7 garage cars.
--   - Photos whose taken_at is the moment they were loaded: a listing import stamps imported_at, an upload
--     without EXIF and the drop folder's created_at fallback (exif date_source = created_at_fallback) carry the
--     load time. A photo dated within five minutes of its own row creation with no camera record is dated by
--     its load, not its capture. Live capture keeps its camera record, so it still counts.
--   - compute_vehicle_activity and the image trigger compared vision_gate_status with NOT LIKE without a
--     coalesce, so a photo with no gate status was dropped from the cache (the day reader coalesces). That left
--     the cache empty or older than the squares on 20 garage cars.
--   - vehicle_activity_bump only raises a value, so a cache row kept the date of a photo later moved to another
--     car. The cache rows are recomputed below.
-- Result on those 138 (same rules run inline before this migration): the last-activity day moves on 41 cars,
-- the range under the squares on 39, and the cars reading "13mo ago" drop from 60 to 29.
--
-- Rules, all in the database so web and iOS read the same thing:
--   vehicle_image_taken_at_is_load_time(taken_at, created_at, exif)  photo date is a load date
--   timeline_event_is_genuine_activity(6 args)                       + import-shaped metadata rules
--   timeline_event_is_genuine_activity(7 args, + created_at)         + same-day import of an auction row
-- No testimony row is written or changed. vehicle_activity is a derived cache.

SET lock_timeout = '5s';
SET statement_timeout = '60s';

-- A photo's taken_at is its load time, not its capture time: dated within five minutes of its own row, with no
-- camera record in its metadata or marked by the writer as the created_at fallback.
-- IMMUTABLE and without SET so the planner inlines it; the CASE reads exif_data only for a photo dated near its
-- row creation, so the day reader does not detoast metadata for every photo.
CREATE OR REPLACE FUNCTION public.vehicle_image_taken_at_is_load_time(p_taken_at timestamptz, p_created_at timestamptz, p_exif jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$
  select case
    when p_taken_at is null or p_created_at is null then false
    when abs(extract(epoch from (p_taken_at - p_created_at))) < 300
      then not coalesce(p_exif ?| array['Make', 'Model', 'camera_make', 'camera_model', 'DateTimeOriginal',
                                        'CreateDate', 'dateTaken', 'lens_model', 'LensModel'], false)
           or coalesce(p_exif ->> 'date_source', '') = 'created_at_fallback'
    -- a created_at fallback is the row's own clock, so it always falls inside the window above
    else false
  end
$function$;

COMMENT ON FUNCTION public.vehicle_image_taken_at_is_load_time(timestamptz, timestamptz, jsonb) IS
  'True when a photo''s taken_at is the time it was loaded, not captured: within five minutes of its row''s created_at with no camera record (Make/Model/DateTimeOriginal/CreateDate/dateTaken/lens), or exif date_source = created_at_fallback. Such a photo is not activity and has no day on the activity timeline.';

-- What counts as a genuine timeline event (trigger, recompute and day reader). Added: rows an import writes about
-- the profile itself (profile created, photos added, a sale built from the vehicle record), discoveries and
-- backfills of a listing, and profile merges.
CREATE OR REPLACE FUNCTION public.timeline_event_is_genuine_activity(p_type text, p_source text, p_data_source text, p_meta jsonb, p_merged_from uuid, p_date date)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select p_date is not null and p_date <= current_date and p_date >= date '1950-01-01'
    and p_merged_from is null
    and coalesce(p_type, '') not in ('pending_analysis', 'photo_session', 'batch_image_upload', 'profile_merged')
    and coalesce(p_source, '')      !~* '(owner_request|profile_fix|merge|backfill|repoint|recompute|migration)'
    and coalesce(p_data_source, '') !~* '(owner_request|profile_fix|merge|backfill|repoint|recompute|migration)'
    and coalesce(p_meta ->> 'added_by', '') !~* 'owner_request'
    and coalesce(p_meta ->> 'source', '')   !~* '(owner_request|profile_fix|backfill)'
    -- an import's rows about the profile: created, photos added (dated by upload_date), a sale built from the record
    and coalesce(p_meta ->> 'entry_type', '') <> 'profile_creation'
    and not coalesce(p_meta ?| array['upload_date', 'vehicle_source'], false)
    -- a listing found or backfilled later is a discovery, not something done to the car
    and coalesce(p_meta ->> 'discovery', '') <> 'true'
    and coalesce(p_meta ->> 'backfilled', '') <> 'true';
$function$;

-- With the row's creation time: an auction row dated the day it was written, with no listing-side date, was
-- dated by the import that wrote it.
CREATE OR REPLACE FUNCTION public.timeline_event_is_genuine_activity(p_type text, p_source text, p_data_source text, p_meta jsonb, p_merged_from uuid, p_date date, p_created_at timestamptz)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select public.timeline_event_is_genuine_activity(p_type, p_source, p_data_source, p_meta, p_merged_from, p_date)
    and not (coalesce(p_type, '') in ('auction_listed', 'auction_started', 'auction_ended', 'auction_sold', 'auction_reserve_not_met')
             and p_created_at is not null
             and p_date = (p_created_at at time zone 'UTC')::date
             and nullif(p_meta ->> 'start_date', '') is null
             and nullif(p_meta ->> 'end_date', '') is null);
$function$;

COMMENT ON FUNCTION public.timeline_event_is_genuine_activity(text, text, text, jsonb, uuid, date, timestamptz) IS
  'Genuine-activity rule for a timeline event with its row creation time: the six-argument rule, and not an auction row dated the day it was written with no listing-side start or end date.';

CREATE OR REPLACE FUNCTION public.compute_vehicle_activity(p_vehicle uuid)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
       and coalesce(vi.vision_gate_status::text, '') not like 'rejected%'
       and coalesce(vi.image_vehicle_match_status, '') not in ('mismatch', 'unrelated')
       and not public.vehicle_image_taken_at_is_load_time(vi.taken_at, vi.created_at, vi.exif_data)
     order by vi.taken_at desc limit 1;
    select max(least(now(), coalesce(w.end_time, w.start_time, (w.session_date::timestamp + interval '12 hours') at time zone 'America/Los_Angeles')))
      into ws from work_sessions w
     where w.vehicle_id = p_vehicle and w.user_id = any(ok)
       and not (coalesce(w.status, '') = 'derived' and coalesce(w.session_type, '') = 'capture_derived' and w.owner_confirmed_at is null);
    select max(least(now(), (t.event_date::timestamp + interval '12 hours') at time zone 'America/Los_Angeles'))
      into ev from timeline_events t
     where t.vehicle_id = p_vehicle and t.user_id = any(ok)
       and public.timeline_event_is_genuine_activity(t.event_type, t.source, t.data_source, t.metadata, t.merged_from_vehicle_id, t.event_date, t.created_at);
  end if;
  la := greatest(ph, ws, ev);
  insert into vehicle_activity as a (vehicle_id, last_activity_at, last_photo_taken_at, last_work_session_at, last_event_at, computed_at)
  values (p_vehicle, la, ph, ws, ev, now())
  on conflict (vehicle_id) do update set last_activity_at = excluded.last_activity_at, last_photo_taken_at = excluded.last_photo_taken_at,
    last_work_session_at = excluded.last_work_session_at, last_event_at = excluded.last_event_at, computed_at = now();
  return la;
end $function$;

CREATE OR REPLACE FUNCTION public.trg_vehicle_activity_image()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  begin
    if new.vehicle_id is not null and new.user_id is not null and new.taken_at is not null and new.taken_at <= now()
       and not coalesce(new.is_superseded, false) and not coalesce(new.is_duplicate, false)
       and coalesce(new.vision_gate_status::text, '') not like 'rejected%'
       and coalesce(new.image_vehicle_match_status, '') not in ('mismatch', 'unrelated')
       and not public.vehicle_image_taken_at_is_load_time(new.taken_at, new.created_at, new.exif_data)
       and public.vehicle_activity_user_ok(new.vehicle_id, new.user_id) then
      perform public.vehicle_activity_bump(new.vehicle_id, 'photo', new.taken_at);
    end if;
  exception when others then null;
  end;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.trg_vehicle_activity_timeline()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare ts timestamptz;
begin
  begin
    if new.vehicle_id is not null and new.user_id is not null
       and public.timeline_event_is_genuine_activity(new.event_type, new.source, new.data_source, new.metadata, new.merged_from_vehicle_id, new.event_date, new.created_at)
       and public.vehicle_activity_user_ok(new.vehicle_id, new.user_id) then
      ts := least(now(), (new.event_date::timestamp + interval '12 hours') at time zone 'America/Los_Angeles');
      perform public.vehicle_activity_bump(new.vehicle_id, 'event', ts);
    end if;
  exception when others then null;
  end;
  return null;
end $function$;

-- The day reader: body of 20261121051500 with the load-time photo rule and the seven-argument event rule.
CREATE OR REPLACE FUNCTION public.get_vehicle_contribution_days_batch(p_vehicle_ids uuid[])
 RETURNS TABLE(vehicle_id uuid, first_day date, last_day date, active_days integer,
               photos integer, work_days integer, events integer, documents integer, days jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET enable_indexscan TO 'off'
AS $function$
  with me as materialized (select auth.uid() as uid, auth.role() as role),
  gate as materialized (
    -- each vehicle, only if this caller may see it (the rule get_vehicle_day_depth uses)
    select v.id
      from vehicles v cross join me
     where v.id = any(p_vehicle_ids[1:500])
       and ((v.is_public is true and v.deleted_at is null)
            or me.role = 'service_role'
            or (me.uid is not null
                and (v.user_id = me.uid or v.owner_id = me.uid or v.uploaded_by = me.uid
                     or vehicle_user_has_access(v.id, me.uid))))
  ),
  -- the gated ids as one array, so each source is read by one bitmap scan over all of them
  ids as materialized (select coalesce(array_agg(gate.id), '{}'::uuid[]) as a from gate),
  d as (
    -- The sources of the profile timeline (get_vehicle_contribution_days), set-based, held to
    -- the rules compute_vehicle_activity uses for genuine activity: no superseded, duplicate,
    -- rejected or mismatched photo, no photo dated by its load, no unconfirmed capture-derived
    -- session, no system-dated or import-dated event.
    select vi.vehicle_id, vi.taken_at::date as day, 'photo'::text as kind, count(*)::int as n
      from vehicle_images vi
     where vi.vehicle_id = any((select ids.a from ids)::uuid[])
       and vi.taken_at is not null and vi.taken_at >= '2000-01-01'
       and not coalesce(vi.is_duplicate, false) and not coalesce(vi.is_superseded, false)
       and coalesce(vi.vision_gate_status::text, '') not like 'rejected%'
       and coalesce(vi.image_vehicle_match_status, '') not in ('mismatch', 'unrelated')
       and not public.vehicle_image_taken_at_is_load_time(vi.taken_at, vi.created_at, vi.exif_data)
     group by 1, 2
    union all
    select ws.vehicle_id, ws.session_date, 'work', count(*)::int
      from work_sessions ws
     where ws.vehicle_id = any((select ids.a from ids)::uuid[])
       and ws.session_date >= '2000-01-01'
       and not (coalesce(ws.status, '') = 'derived' and coalesce(ws.session_type, '') = 'capture_derived'
                and ws.owner_confirmed_at is null)
     group by 1, 2
    union all
    select t.vehicle_id, t.event_date, 'event', count(*)::int
      from timeline_events t
     where t.vehicle_id = any((select ids.a from ids)::uuid[])
       and t.event_date >= '2000-01-01'
       and public.timeline_event_is_genuine_activity(t.event_type, t.source, t.data_source, t.metadata, t.merged_from_vehicle_id, t.event_date, t.created_at)
     group by 1, 2
    union all
    select l.vehicle_id, l.page_date, 'document', count(*)::int
      from receipt_vehicle_links l
      join receipts r on r.id = l.receipt_id
     where l.vehicle_id = any((select ids.a from ids)::uuid[])
       and l.status = 'linked' and l.retired_at is null
       and l.page_date is not null and l.page_date >= '2000-01-01'
       and coalesce(r.is_superseded, false) = false and r.duplicate_of is null
     group by 1, 2
  ),
  dd as (
    -- a camera clock set in the future is not a day on the record
    select * from d where day <= current_date + 1
  ),
  m as (
    select dd.vehicle_id, dd.day as wk,
           coalesce(sum(dd.n) filter (where dd.kind = 'photo'), 0)::int as p,
           coalesce(sum(dd.n) filter (where dd.kind = 'work'), 0)::int as w,
           coalesce(sum(dd.n) filter (where dd.kind = 'event'), 0)::int as e,
           coalesce(sum(dd.n) filter (where dd.kind = 'document'), 0)::int as doc
      from dd group by 1, 2
  ),
  t as (
    select dd.vehicle_id, min(dd.day) as first_day, max(dd.day) as last_day,
           count(distinct dd.day)::int as active_days,
           count(distinct dd.day) filter (where dd.kind = 'work')::int as work_days
      from dd group by 1
  )
  select t.vehicle_id, t.first_day, t.last_day, t.active_days,
         sum(m.p)::int as photos, t.work_days, sum(m.e)::int as events, sum(m.doc)::int as documents,
         jsonb_agg(jsonb_build_array(m.wk, m.p, m.w, m.e, m.doc) order by m.wk) as days
    from t join m using (vehicle_id)
   group by t.vehicle_id, t.first_day, t.last_day, t.active_days, t.work_days
$function$;

COMMENT ON FUNCTION public.get_vehicle_contribution_days_batch(uuid[]) IS
  'Per-vehicle activity for up to 500 vehicles the caller may see: first and last active day, active days, totals, and days as [date, photos, work sessions, events, document pages]. Sources of get_vehicle_contribution_days under the genuine-activity rules of compute_vehicle_activity: a photo dated by its load (vehicle_image_taken_at_is_load_time) and an import-dated event have no day.';

REVOKE ALL ON FUNCTION public.get_vehicle_contribution_days_batch(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_vehicle_contribution_days_batch(uuid[]) TO anon, authenticated, service_role;

-- Recompute the cache where it can hold a value: every row that has one (146 on 2026-11-21) and every vehicle a
-- person is tied to by a contributor, permission or approved title row (a few hundred). The recompute replaces the
-- row with exact values, which also clears dates left behind by photos since moved to another vehicle.
SELECT count(public.compute_vehicle_activity(x.vehicle_id))
  FROM (
    SELECT vehicle_id FROM public.vehicle_activity WHERE last_activity_at IS NOT NULL
    UNION SELECT vehicle_id FROM public.vehicle_contributors WHERE vehicle_id IS NOT NULL
    UNION SELECT vehicle_id FROM public.vehicle_user_permissions WHERE vehicle_id IS NOT NULL AND revoked_at IS NULL
    UNION SELECT vehicle_id FROM public.ownership_verifications WHERE vehicle_id IS NOT NULL AND status = 'approved'
  ) x
  JOIN public.vehicles v ON v.id = x.vehicle_id
 WHERE v.deleted_at IS NULL AND v.merged_into_vehicle_id IS NULL;
