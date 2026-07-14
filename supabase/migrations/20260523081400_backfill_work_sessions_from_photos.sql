-- 20260523081400_backfill_work_sessions_from_photos.sql
--
-- Worth Engine: backfill baseline work_sessions from photo bursts so v1
-- (work_session-derived $) becomes available alongside v2/v3, enabling the
-- 3-method convergence path in vehicle_full_picture.
--
-- A "baseline" work_session is created for each (vehicle_id, date) where photos
-- exist but no session was logged. duration_minutes is set from the burst-
-- clustering function. The session can be enriched later by build-day.mjs with
-- specialty mix, parts cost, etc. — this just creates the empty shell so the
-- v1 method has substrate to operate on.
--
-- Idempotent: skips dates that already have a work_session.
-- Trust invariant: never updates an existing row — only inserts new ones.

CREATE OR REPLACE FUNCTION public.backfill_work_sessions_from_photos(
  p_vehicle_id UUID,
  p_owner_id   UUID DEFAULT NULL
) RETURNS TABLE (
  date_processed DATE,
  duration_min   INT,
  action         TEXT
)
LANGUAGE plpgsql AS $$
DECLARE
  v_user_id UUID;
  v_date DATE;
  v_burst_min INT;
  v_start TIMESTAMPTZ;
  v_end TIMESTAMPTZ;
  v_img_count INT;
BEGIN
  -- Resolve owner_id: prefer arg, fall back to vehicles.owner_id
  IF p_owner_id IS NOT NULL THEN
    v_user_id := p_owner_id;
  ELSE
    SELECT owner_id INTO v_user_id FROM vehicles WHERE id = p_vehicle_id;
  END IF;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Cannot backfill: vehicle % has no owner_id and none provided', p_vehicle_id;
  END IF;

  FOR v_date IN
    SELECT DISTINCT taken_at::date
      FROM vehicle_images
     WHERE vehicle_id = p_vehicle_id
       AND taken_at IS NOT NULL
     ORDER BY taken_at::date
  LOOP
    -- Skip if a session already exists for this date
    IF EXISTS (
      SELECT 1 FROM work_sessions
       WHERE vehicle_id = p_vehicle_id AND session_date = v_date
    ) THEN
      date_processed := v_date;
      duration_min := NULL;
      action := 'skipped_already_exists';
      RETURN NEXT;
      CONTINUE;
    END IF;

    v_burst_min := compute_active_minutes_burst(p_vehicle_id, v_date, 30);

    SELECT MIN(taken_at), MAX(taken_at), count(*)
      INTO v_start, v_end, v_img_count
      FROM vehicle_images
     WHERE vehicle_id = p_vehicle_id
       AND taken_at::date = v_date;

    INSERT INTO work_sessions (
      user_id, vehicle_id, session_date,
      start_time, end_time, duration_minutes,
      confidence_score, image_count,
      title, work_type, session_type, status,
      labor_rate_per_hour, metadata
    ) VALUES (
      v_user_id, p_vehicle_id, v_date,
      v_start, v_end, v_burst_min,
      0.6, v_img_count,
      'Baseline session from photo bursts',
      'general', 'baseline_backfill', 'auto_inferred',
      160, jsonb_build_object(
        'derived_from', 'compute_active_minutes_burst',
        'burst_gap_minutes', 30,
        'backfilled_at', now()
      )
    );

    date_processed := v_date;
    duration_min := v_burst_min;
    action := 'inserted';
    RETURN NEXT;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.backfill_work_sessions_from_photos(UUID, UUID) IS
'Worth Engine: idempotently create baseline work_sessions for any vehicle date with photos but no session. duration_minutes = burst-clustered active minutes. Skips existing sessions (trust invariant — no UPDATE).';

GRANT EXECUTE ON FUNCTION public.backfill_work_sessions_from_photos(UUID, UUID) TO authenticated;
