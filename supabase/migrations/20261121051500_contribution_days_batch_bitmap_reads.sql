-- get_vehicle_contribution_days_batch: read the photo days with one bitmap heap scan.
--
-- Consumers: the web garage cards' day-square timeline (nuke_frontend/src/hooks/useVehiclesDashboard.ts)
-- and the iOS garage (apps/nuke-capture-ios, GarageTimeline.swift). Defined in 20261120162000.
-- Visibility: a vehicle is returned only to a caller who may see it, the same rule as
-- get_vehicle_day_depth. Read-only; no table is written.
--
-- Measured 2026-11-20 (scripts/data/q.sh, the body run as a prepared generic plan, which is how a
-- SQL function plans; production PostgreSQL 17.6):
--   - The photo branch is the cost. The 138-car garage behind the web garage page holds 28,402 dated
--     photos on 20,576 heap blocks of vehicle_images (59 GB). The function read them with a plain
--     index scan on vehicle_images_taken_date, one vehicle at a time: one synchronous read per block
--     when cold. That branch alone ran past 10 s cold; the browser measured the whole call at 7.7 s.
--     Timeline events were next (1.4 s cold), then receipts (0.08 s), work sessions (0.07 s), gate (0.02 s).
--   - A bitmap heap scan reads the same blocks in physical order with prefetch
--     (effective_io_concurrency 200). Cold, on fresh random sets of public vehicles with dated photos:
--     22k photos 5.2 s -> 2.9 s; 16k photos 4.5 s -> 2.0 s and 4.0 s -> 2.3 s (old and new body on
--     different but like-sized cold sets). Warm, 16k photos: 0.22 s -> 0.11 s.
--   - The planner estimates about one photo per vehicle and picks the index scan whatever the predicate
--     shape, so the function sets enable_indexscan = off for its own run (restored when it returns).
--     Every branch then plans as a bitmap scan on its existing index; no table is read sequentially.
--     No index is added. Each source now filters on the gated id array instead of joining the gate.
--   - Same output: old and new body return identical rows (md5 of the ordered rows) for that garage as
--     its owner (131 vehicles) and as anon (111).
--
-- Contract unchanged: same signature, columns, 500-id bound, visibility gate and genuine-activity rules.
-- CREATE OR REPLACE keeps the owner and the EXECUTE grants; they are restated below as before.

SET lock_timeout = '5s';
SET statement_timeout = '60s';

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
    -- rejected or mismatched photo, no unconfirmed capture-derived session, no system-dated event.
    select vi.vehicle_id, vi.taken_at::date as day, 'photo'::text as kind, count(*)::int as n
      from vehicle_images vi
     where vi.vehicle_id = any((select ids.a from ids)::uuid[])
       and vi.taken_at is not null and vi.taken_at >= '2000-01-01'
       and not coalesce(vi.is_duplicate, false) and not coalesce(vi.is_superseded, false)
       and coalesce(vi.vision_gate_status::text, '') not like 'rejected%'
       and coalesce(vi.image_vehicle_match_status, '') not in ('mismatch', 'unrelated')
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
       and public.timeline_event_is_genuine_activity(t.event_type, t.source, t.data_source, t.metadata, t.merged_from_vehicle_id, t.event_date)
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
  'Per-vehicle activity for up to 500 vehicles the caller may see: first and last active day, active days, totals, and days as [date, photos, work sessions, events, document pages]. Sources of get_vehicle_contribution_days under the genuine-activity rules of compute_vehicle_activity.';

REVOKE ALL ON FUNCTION public.get_vehicle_contribution_days_batch(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_vehicle_contribution_days_batch(uuid[]) TO anon, authenticated, service_role;
