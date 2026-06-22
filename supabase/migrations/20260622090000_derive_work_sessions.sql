-- Work-session deriver: fill vehicle_images.work_session_id from capture metadata.
--
-- The audit (2026-06-22) found work_session_id only ~18% filled — the temporal grouping
-- attribution leans on (the "day is the unit" in engineering-manual Ch.16/18) was mostly
-- unfed, and the EXIF date backfill exposed ~20 capture-days per vehicle with no session
-- at all (build-day.mjs ran before dates were trustworthy). This derives the linkage from
-- capture metadata only — free, no AI (extraction-contract source #1/#2, Ch.19):
--
--   1. For each capture-DAY of RELEVANT frames (excludes unrelated/mismatch — a session is
--      this vehicle's work, not the Scout/PII that was de-polluted off it) that has no
--      work_session, create a lightweight 'derived' session: session_date, start/end =
--      min/max taken_at, duration, image_count. (build-day.mjs later enriches it with
--      cost/narrative; status='derived' marks the unenriched ones.)
--   2. Link every relevant frame to its day's session.
--
-- Idempotent and reversible. Linking uses DISTINCT ON so a day with multiple legacy
-- sessions resolves to one (earliest-created) deterministically.

CREATE OR REPLACE FUNCTION public.derive_work_sessions(p_vehicle_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_user uuid;
  v_created int := 0;
  v_linked int := 0;
BEGIN
  SELECT owner_id INTO v_user FROM vehicles WHERE id = p_vehicle_id;
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('vehicle_id', p_vehicle_id, 'error', 'no owner_id; sessions need a user');
  END IF;

  -- 1) Create a session for each relevant capture-day that lacks one.
  WITH days AS (
    SELECT COALESCE(vi.taken_at, vi.created_at)::date AS d,
           min(COALESCE(vi.taken_at, vi.created_at)) AS start_ts,
           max(COALESCE(vi.taken_at, vi.created_at)) AS end_ts,
           count(*) AS n
    FROM vehicle_images vi
    WHERE vi.vehicle_id = p_vehicle_id
      AND COALESCE(vi.taken_at, vi.created_at) IS NOT NULL
      AND COALESCE(vi.is_superseded,false) = false
      AND COALESCE(vi.image_vehicle_match_status,'pending') NOT IN ('unrelated','mismatch')
    GROUP BY 1
  ),
  missing AS (
    SELECT d.* FROM days d
    WHERE NOT EXISTS (
      SELECT 1 FROM work_sessions ws
      WHERE ws.vehicle_id = p_vehicle_id AND ws.session_date = d.d)
  ),
  ins AS (
    INSERT INTO work_sessions
      (id, user_id, vehicle_id, session_date, start_time, end_time,
       duration_minutes, image_count, status, session_type, created_at, updated_at)
    SELECT gen_random_uuid(), v_user, p_vehicle_id, d, start_ts, end_ts,
           GREATEST(0, floor(extract(epoch FROM (end_ts - start_ts)) / 60)::int),
           n, 'derived', 'capture_derived', now(), now()
    FROM missing
    RETURNING 1
  )
  SELECT count(*) INTO v_created FROM ins;

  -- 2) Link every relevant frame to its day's (single, deterministic) session.
  UPDATE vehicle_images vi
  SET work_session_id = s.id, updated_at = now()
  FROM (
    SELECT DISTINCT ON (session_date) id, session_date
    FROM work_sessions
    WHERE vehicle_id = p_vehicle_id
    ORDER BY session_date, created_at
  ) s
  WHERE vi.vehicle_id = p_vehicle_id
    AND s.session_date = COALESCE(vi.taken_at, vi.created_at)::date
    AND vi.work_session_id IS DISTINCT FROM s.id
    AND COALESCE(vi.is_superseded,false) = false
    AND COALESCE(vi.image_vehicle_match_status,'pending') NOT IN ('unrelated','mismatch');
  GET DIAGNOSTICS v_linked = ROW_COUNT;

  RETURN jsonb_build_object('vehicle_id', p_vehicle_id,
    'sessions_created', v_created, 'frames_linked', v_linked);
END $$;

COMMENT ON FUNCTION public.derive_work_sessions(uuid) IS
  'Fill work_session_id from capture metadata: one session per relevant capture-day '
  '(excludes unrelated/mismatch), created if missing, then links frames. See Ch.19.';
