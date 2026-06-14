-- ============================================================================
-- get_vehicle_contribution_days(p_vehicle_id) — per-day activity for the
-- vehicle profile timeline. Filed 2026-06-10 (C10 quality check).
--
-- The vehicle BarcodeTimeline fed ONLY on vehicle_timeline_events: an
-- owner-import truck with 861 photos showed "ALL (3) / PHOTOS (1)" on a
-- 48-year grid anchored at its MODEL YEAR. Photos and work sessions are the
-- real activity substrate. Sibling of get_user_contribution_days.
-- Legs are index-served: vehicle_images_taken_date (vehicle_id, taken_at),
-- idx_work_sessions_vehicle, vehicle_timeline_events(vehicle_id).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_vehicle_contribution_days(p_vehicle_id uuid)
RETURNS TABLE(day date, kind text, n int)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT vi.taken_at::date AS day, 'photo'::text AS kind, count(*)::int AS n
  FROM vehicle_images vi
  WHERE vi.vehicle_id = p_vehicle_id
    AND vi.taken_at IS NOT NULL
    AND vi.taken_at >= '2000-01-01'          -- bogus-EXIF floor
    AND COALESCE(vi.is_duplicate, false) = false
  GROUP BY 1
  UNION ALL
  SELECT ws.session_date, 'work', count(*)::int
  FROM work_sessions ws
  WHERE ws.vehicle_id = p_vehicle_id AND ws.session_date >= '2000-01-01'
  GROUP BY 1
  UNION ALL
  SELECT vte.event_date, 'event', count(*)::int
  FROM vehicle_timeline_events vte
  WHERE vte.vehicle_id = p_vehicle_id AND vte.event_date >= '2000-01-01'
  GROUP BY 1;
$$;

COMMENT ON FUNCTION public.get_vehicle_contribution_days(uuid) IS
  'Per-day photo/work/event densities for the vehicle profile timeline. The photos ARE the activity record.';

GRANT EXECUTE ON FUNCTION public.get_vehicle_contribution_days(uuid) TO authenticated, anon;
