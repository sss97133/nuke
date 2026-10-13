-- The user contribution calendar carries a day's work cost only to that user.
--
-- Reported by the iOS lane 2026-10-13 17:55Z (read from pg_proc): get_user_contribution_calendar
-- (SECURITY DEFINER, EXECUTE for authenticated) reads no auth.uid and ships work_cost (the sum of
-- work_sessions.total_job_cost per day) to every signed-in caller, and the phone's Explore mode shows
-- the owner's sample profile through it. The sibling get_user_day_receipt already masks its costs and
-- receipts for anyone but the user and is unchanged.
--
-- Each day now carries work_cost only when auth.uid() is the user, otherwise null, plus money_masked;
-- photos, events, sessions and minutes are unchanged. Same signature, grants and SECURITY DEFINER.
-- Built from the live definition (supabase/sql/helpers), guarded by its hash and its own result.
BEGIN;
SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='1s';

DO $guard$
DECLARE a text;
BEGIN
  SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'base64') INTO a FROM pg_proc WHERE oid = 'public.get_user_contribution_calendar(uuid)'::regprocedure;
  IF a NOT IN ('AyG8/X7N1BTsMUtDZrtNO4OVj4l+jJVZtXquibNBLUs=', 'EqN5OwOgTFCPahttbPp7T5TgCv0Am7z8JBRzTOEmSxE=') THEN
    RAISE EXCEPTION 'get_user_contribution_calendar differs from the reviewed definition';
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.get_user_contribution_calendar(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- Money is the owner's: the day's work cost reaches the signed-in user whose sessions they are;
  -- every other caller gets the same calendar with work_cost null and money_masked true.
  WITH viewer AS (SELECT coalesce(auth.uid() = p_user_id, false) AS is_owner),
  photo AS (
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
           'work_cost',    CASE WHEN (SELECT is_owner FROM viewer) THEN COALESCE(w.cost, 0) ELSE NULL END,
           'money_masked', NOT (SELECT is_owner FROM viewer)
         ) ORDER BY d.day), '[]'::jsonb)
  FROM days d
  LEFT JOIN photo p ON p.day = d.day
  LEFT JOIN evt   e ON e.day = d.day
  LEFT JOIN wk    w ON w.day = d.day;
$function$;

COMMIT;
