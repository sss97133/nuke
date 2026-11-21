-- get_vehicle_contribution_months_batch(p_vehicle_ids): the profile timeline's activity
-- (photos by capture date, work sessions, timeline events, linked document pages) for many
-- vehicles in one read, folded to months, one row per vehicle so no row cap can cut it.
--
-- Consumer: the garage cards' timeline strip and the garage's activity order
-- (nuke_frontend/src/hooks/useVehiclesDashboard.ts). Until now those cards read
-- get_vehicle_event_weeks_batch, which sees vehicle_events only: 129 week rows across the
-- 138 cars of the measured garage (2026-11-20), against 4,674 activity days in the sources
-- the profile timeline reads.
--
-- Visibility: a vehicle is returned only to a caller who may see it, the same rule as
-- get_vehicle_day_depth. Read-only; no table is written.
-- Measured 2026-11-20 on that garage: 133 rows, about 0.6 s.

SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.get_vehicle_contribution_months_batch(p_vehicle_ids uuid[])
 RETURNS TABLE(vehicle_id uuid, first_day date, last_day date, active_days integer,
               photos integer, work_days integer, events integer, documents integer, months jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
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
  d as (
    -- the four kinds and their filters are get_vehicle_contribution_days', set-based; change both together
    select vi.vehicle_id, vi.taken_at::date as day, 'photo'::text as kind, count(*)::int as n
      from vehicle_images vi join gate g on g.id = vi.vehicle_id
     where vi.taken_at is not null and vi.taken_at >= '2000-01-01'
       and coalesce(vi.is_duplicate, false) = false
     group by 1, 2
    union all
    select ws.vehicle_id, ws.session_date, 'work', count(*)::int
      from work_sessions ws join gate g on g.id = ws.vehicle_id
     where ws.session_date >= '2000-01-01'
     group by 1, 2
    union all
    select vte.vehicle_id, vte.event_date, 'event', count(*)::int
      from vehicle_timeline_events vte join gate g on g.id = vte.vehicle_id
     where vte.event_date >= '2000-01-01'
     group by 1, 2
    union all
    select l.vehicle_id, l.page_date, 'document', count(*)::int
      from receipt_vehicle_links l
      join gate g on g.id = l.vehicle_id
      join receipts r on r.id = l.receipt_id
     where l.status = 'linked' and l.retired_at is null
       and l.page_date is not null and l.page_date >= '2000-01-01'
       and coalesce(r.is_superseded, false) = false and r.duplicate_of is null
     group by 1, 2
  ),
  dd as (
    -- a camera clock set in the future is not a day on the record
    select * from d where day <= current_date + 1
  ),
  m as (
    select dd.vehicle_id, to_char(dd.day, 'YYYY-MM') as ym,
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
         jsonb_agg(jsonb_build_array(m.ym, m.p, m.w, m.e, m.doc) order by m.ym) as months
    from t join m using (vehicle_id)
   group by t.vehicle_id, t.first_day, t.last_day, t.active_days, t.work_days
$function$;

COMMENT ON FUNCTION public.get_vehicle_contribution_months_batch(uuid[]) IS
  'Per-vehicle activity for up to 500 vehicles the caller may see: first and last active day, active days, totals, and months as [YYYY-MM, photos, work sessions, events, document pages]. Same sources and filters as get_vehicle_contribution_days.';

REVOKE ALL ON FUNCTION public.get_vehicle_contribution_months_batch(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_vehicle_contribution_months_batch(uuid[]) TO anon, authenticated, service_role;
