-- Profile overhaul (synthesis fix #8): per-day contribution aggregates RPC.
--
-- The profile timeline was fed by three wide row-level selects
-- (profileService.ts: vehicle_images / vehicle_timeline_events /
-- work_sessions with .limit(5000)), which PostgREST's db-max-rows silently
-- caps at 1000 rows each -- the timeline rendered whichever arbitrary slice
-- fit. For user 0 the real substrate is 20,978 images + 4,295 timeline
-- events + 325 work sessions; the truncation threw most of it away.
--
-- This RPC replaces all three with one per-day GROUP BY, returning a few
-- hundred (day, kind, n) rows instead of 3,000 capped wide rows.
--
-- day >= '2000-01-01' on every leg: bogus-EXIF floor (camera clocks reset to
-- 1970/1980 produce taken_at values that would stretch the timeline axis
-- back decades).

CREATE OR REPLACE FUNCTION get_user_contribution_days(p_user_id uuid)
RETURNS TABLE(day date, kind text, n int)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Photos: day = capture time when EXIF has it, upload time otherwise.
  SELECT
    COALESCE(vi.taken_at, vi.created_at)::date AS day,
    'photo'::text AS kind,
    count(*)::int AS n
  FROM vehicle_images vi
  WHERE vi.user_id = p_user_id
    AND COALESCE(vi.taken_at, vi.created_at)::date >= DATE '2000-01-01'
  GROUP BY 1

  UNION ALL

  -- Timeline events
  SELECT
    vte.event_date AS day,
    'event'::text AS kind,
    count(*)::int AS n
  FROM vehicle_timeline_events vte
  WHERE vte.user_id = p_user_id
    AND vte.event_date >= DATE '2000-01-01'
  GROUP BY 1

  UNION ALL

  -- Work sessions
  SELECT
    ws.session_date AS day,
    'work'::text AS kind,
    count(*)::int AS n
  FROM work_sessions ws
  WHERE ws.user_id = p_user_id
    AND ws.session_date >= DATE '2000-01-01'
  GROUP BY 1

  ORDER BY 1, 2;
$$;

COMMENT ON FUNCTION get_user_contribution_days(uuid) IS
  'Per-day contribution aggregates (photo/event/work) for a user profile timeline. Replaces three 1000-row-capped wide selects. day >= 2000-01-01 filters bogus-EXIF dates.';
