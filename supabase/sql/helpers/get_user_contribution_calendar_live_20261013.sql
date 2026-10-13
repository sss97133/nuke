-- The live definition of public.get_user_contribution_calendar(uuid) as read from production on
-- 2026-10-13 17:00Z (source hash AyG8/X7N1BTsMUtDZrtNO4OVj4l+jJVZtXquibNBLUs=), kept so the contract
-- can start from the deployed state before applying 20261013171500_user_calendar_money_owner_only.sql.
CREATE OR REPLACE FUNCTION public.get_user_contribution_calendar(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH photo AS (
    SELECT COALESCE(vi.taken_at, vi.created_at)::date AS day, count(*)::int AS n
    FROM vehicle_images vi
    WHERE vi.user_id = p_user_id
      AND COALESCE(vi.taken_at, vi.created_at)::date >= DATE '2000-01-01'
    GROUP BY 1
  ),
  evt AS (
    SELECT vte.event_date AS day, count(*)::int AS n
    FROM vehicle_timeline_events vte
    WHERE vte.user_id = p_user_id AND vte.event_date >= DATE '2000-01-01'
    GROUP BY 1
  ),
  wk AS (
    SELECT ws.session_date AS day,
           count(*)::int AS sessions,
           COALESCE(sum(ws.duration_minutes), 0)::int AS minutes,
           round(COALESCE(sum(ws.total_job_cost), 0))::int AS cost
    FROM work_sessions ws
    WHERE ws.user_id = p_user_id AND ws.session_date >= DATE '2000-01-01'
    GROUP BY 1
  ),
  days AS (
    SELECT day FROM photo UNION SELECT day FROM evt UNION SELECT day FROM wk
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'day',          to_char(d.day, 'YYYY-MM-DD'),
           'photos',       COALESCE(p.n, 0),
           'events',       COALESCE(e.n, 0),
           'work',         COALESCE(w.sessions, 0),
           'work_minutes', COALESCE(w.minutes, 0),
           'work_cost',    COALESCE(w.cost, 0)
         ) ORDER BY d.day), '[]'::jsonb)
  FROM days d
  LEFT JOIN photo p ON p.day = d.day
  LEFT JOIN evt   e ON e.day = d.day
  LEFT JOIN wk    w ON w.day = d.day;
$function$
;
