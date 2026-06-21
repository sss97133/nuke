-- 20260530_get_day_card_context_exclude_comms.sql
--
-- Fix: get_day_card_context summed duration_minutes and counted sessions across
-- ALL session_types, including imessage_sync (texting threads) and baseline_backfill.
-- That inflated the DayCard narrative ("Session X of Y", "total build hours") —
-- e.g. the K2500 read 5,009h when ~148h was real work; 4,860h was texting.
--
-- Communication-derived sessions are context, not build labor. Exclude
-- imessage_sync + baseline_backfill from the build-arc counts and the hours sum.
-- NULL session_type is preserved (legacy real sessions default to 'auto_detected').
--
-- See: nuke_frontend/src/pages/vehicle-profile/VehicleProfileContext.tsx (same filter applied)

CREATE OR REPLACE FUNCTION public.get_day_card_context(
  p_vehicle_id UUID,
  p_date       DATE
) RETURNS JSONB
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_total_sessions   INT;
  v_session_number   INT;
  v_total_minutes    BIGINT;
  v_signals          JSONB;
BEGIN
  -- Level 1: vehicle build arc (real work sessions only — exclude comms/backfill)
  SELECT count(*)::INT INTO v_total_sessions
    FROM public.work_sessions
   WHERE vehicle_id = p_vehicle_id
     AND (session_type IS NULL OR session_type NOT IN ('imessage_sync','baseline_backfill'));

  IF v_total_sessions = 0 THEN
    RETURN jsonb_build_object(
      'total_sessions', 0,
      'session_number', 0,
      'total_minutes', 0,
      'signals', '[]'::jsonb
    );
  END IF;

  -- Session number chronologically (rank by date, where this date sits)
  SELECT count(*)::INT INTO v_session_number
    FROM public.work_sessions
   WHERE vehicle_id = p_vehicle_id
     AND session_date <= p_date
     AND (session_type IS NULL OR session_type NOT IN ('imessage_sync','baseline_backfill'));

  -- Total labor minutes across the build (real work only)
  SELECT COALESCE(SUM(duration_minutes), 0)::BIGINT INTO v_total_minutes
    FROM public.work_sessions
   WHERE vehicle_id = p_vehicle_id
     AND (session_type IS NULL OR session_type NOT IN ('imessage_sync','baseline_backfill'));

  -- Level 2: comparable signals (from analysis_signals if table exists).
  -- Subquery-then-aggregate so ORDER BY/LIMIT are valid; reasons is text[] so
  -- to_jsonb it. Defensive catch — signals are optional and must never break
  -- the build-arc counts above.
  BEGIN
    SELECT COALESCE(jsonb_agg(sig.obj), '[]'::jsonb) INTO v_signals
    FROM (
      SELECT jsonb_build_object(
        'widget_slug', widget_slug,
        'score', score,
        'label', label,
        'reasons', COALESCE(to_jsonb(reasons), '[]'::jsonb),
        'evidence', COALESCE(to_jsonb(evidence), '{}'::jsonb)
      ) AS obj
      FROM public.analysis_signals
      WHERE vehicle_id = p_vehicle_id
        AND widget_slug IN ('build_progress', 'cost_analysis', 'labor_efficiency', 'specialty_mix')
      ORDER BY computed_at DESC NULLS LAST
      LIMIT 3
    ) sig;
  EXCEPTION WHEN OTHERS THEN
    v_signals := '[]'::jsonb;
  END;

  RETURN jsonb_build_object(
    'total_sessions', v_total_sessions,
    'session_number', v_session_number,
    'total_minutes', v_total_minutes,
    'signals', v_signals
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_day_card_context(UUID, DATE) TO anon, authenticated;
