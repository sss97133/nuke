-- 20260523080700_get_day_card_context_rpc.sql
--
-- The missing RPC that DayCard.tsx has been silently waiting for.
-- Per docs/library/prompts/P10-day-card-seven-level-analysis.md, the DayCard's
-- ANALYSIS section depends on `get_day_card_context(p_vehicle_id, p_date)` returning:
--   - total_sessions: count of work_sessions for vehicle (all time)
--   - session_number: which # is this day's session (chronological)
--   - total_minutes: sum of duration_minutes across all sessions
--   - signals: array from analysis_signals (widget_slug, score, label, reasons, evidence)
--
-- DayCard.tsx line 60-78 calls this RPC. Today it returns nothing because the function
-- doesn't exist. After this migration deploys, the ANALYSIS section renders the
-- Seven-Level Analysis narrative paragraph for every day with a work_session.
--
-- See:
--   nuke_frontend/src/pages/vehicle-profile/DayCard.tsx (useDayCardContext hook, line 56-91)
--   docs/library/prompts/P10-day-card-seven-level-analysis.md (full spec)
--   docs/library/technical/design-book/vehicle-profile-computation-surface.md

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
  -- Level 1: vehicle build arc
  SELECT count(*)::INT INTO v_total_sessions
    FROM public.work_sessions
   WHERE vehicle_id = p_vehicle_id;

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
     AND session_date <= p_date;

  -- Total labor minutes across the build
  SELECT COALESCE(SUM(duration_minutes), 0)::BIGINT INTO v_total_minutes
    FROM public.work_sessions
   WHERE vehicle_id = p_vehicle_id;

  -- Level 2: comparable signals (from analysis_signals if table exists)
  BEGIN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'widget_slug', widget_slug,
      'score', score,
      'label', label,
      'reasons', COALESCE(reasons, '[]'::jsonb),
      'evidence', COALESCE(evidence, '{}'::jsonb)
    )), '[]'::jsonb) INTO v_signals
    FROM public.analysis_signals
    WHERE vehicle_id = p_vehicle_id
      AND widget_slug IN ('build_progress', 'cost_analysis', 'labor_efficiency', 'specialty_mix')
    ORDER BY computed_at DESC NULLS LAST
    LIMIT 3;
  EXCEPTION WHEN undefined_table OR undefined_column THEN
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

COMMENT ON FUNCTION public.get_day_card_context(UUID, DATE) IS
'Returns context for DayCard.tsx ANALYSIS section narrative composer. Provides session position in build arc + comparable signals. Per P10 spec.';

GRANT EXECUTE ON FUNCTION public.get_day_card_context(UUID, DATE) TO anon, authenticated;
