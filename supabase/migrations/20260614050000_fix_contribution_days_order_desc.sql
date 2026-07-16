-- P0 fix: the user-profile timeline silently truncated at 2020-03-20.
--
-- get_user_contribution_days returns >1000 (day, kind, n) rows for a heavy
-- user (2,666 rows for user 0b9f107a, spanning 2004 -> 2026-06-14). It is
-- consumed over PostgREST (profileService.ts:28), where db-max-rows=1000 caps
-- the response. The prior tail `ORDER BY 1, 2` ordered days ASCENDING, so the
-- surviving 1000 rows were the OLDEST -- the cut landed on row 1000 =
-- 2020-03-20 (Skylar's "photos dropped off after Saturday March 21 2020"
-- seam) and every newer day, including all 2026 activity, was dropped before
-- it ever reached the heatmap.
--
-- Fix: order DESC so the surviving 1000 rows under the cap are the NEWEST
-- days. The barcode timeline sorts client-side anyway; ordering is only about
-- WHICH rows survive the cap. This unhides his recent (2025-2026) data.
--
-- Re-creates the function identically except for the ORDER BY tail.

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

  -- DESC so the newest days survive PostgREST's 1000-row cap (was ORDER BY 1,2
  -- which kept the oldest 1000 and hid everything after 2020-03-20).
  ORDER BY day DESC, kind;
$$;

COMMENT ON FUNCTION get_user_contribution_days(uuid) IS
  'Per-day contribution aggregates (photo/event/work) for a user profile timeline. Replaces three 1000-row-capped wide selects. day >= 2000-01-01 filters bogus-EXIF dates. ORDER BY day DESC so the newest days survive the PostgREST 1000-row cap (the 2020-03-20 truncation fix).';
