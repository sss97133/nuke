-- ============================================================
-- LABOR ESTIMATION FIXUP — Adapt existing tables for the pipeline
-- ============================================================

-- work_sessions: add missing columns for auto-detection pipeline
ALTER TABLE work_sessions
  ADD COLUMN IF NOT EXISTS session_type TEXT DEFAULT 'auto_detected',
  ADD COLUMN IF NOT EXISTS start_image_id UUID,
  ADD COLUMN IF NOT EXISTS end_image_id UUID,
  ADD COLUMN IF NOT EXISTS zones_touched TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS stages_observed TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS stage_transitions JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS technician_phone_link_id UUID;

-- labor_estimates: add missing columns for photo-based estimation
ALTER TABLE labor_estimates
  ADD COLUMN IF NOT EXISTS work_session_id UUID,
  ADD COLUMN IF NOT EXISTS zone_deltas JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS labor_line_items JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS total_hours_estimate REAL,
  ADD COLUMN IF NOT EXISTS total_cost_estimate REAL,
  ADD COLUMN IF NOT EXISTS labor_rate REAL DEFAULT 125,
  ADD COLUMN IF NOT EXISTS yono_confidence REAL,
  ADD COLUMN IF NOT EXISTS opus_validated BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS opus_validation_result JSONB,
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'draft';

-- Fix index: work_sessions uses start_time, not started_at
CREATE UNIQUE INDEX IF NOT EXISTS idx_work_sessions_vehicle_start_time
  ON work_sessions(vehicle_id, start_time);

-- Fix index: labor_estimates.work_session_id
CREATE INDEX IF NOT EXISTS idx_labor_estimates_session
  ON labor_estimates(work_session_id);

-- Fix: estimate_labor_from_delta function (the UNION ALL in SQL language
-- function caused syntax error — rewrite as plpgsql)
CREATE OR REPLACE FUNCTION estimate_labor_from_delta(
  p_vehicle_id UUID,
  p_zone TEXT,
  p_from_stage TEXT,
  p_to_stage TEXT
)
RETURNS TABLE (
  labor_operation_codes TEXT[],
  description TEXT,
  hours_min REAL,
  hours_max REAL,
  hours_typical REAL,
  materials_min REAL,
  materials_max REAL,
  match_type TEXT
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  -- Try exact zone match first
  RETURN QUERY
  SELECT
    m.labor_operation_codes,
    m.description,
    m.estimated_hours_min,
    m.estimated_hours_max,
    m.estimated_hours_typical,
    m.materials_cost_min,
    m.materials_cost_max,
    'exact'::TEXT AS match_type
  FROM stage_transition_labor_map m
  WHERE m.from_stage = p_from_stage
    AND m.to_stage = p_to_stage
    AND m.zone_pattern = p_zone
  LIMIT 1;

  IF FOUND THEN RETURN; END IF;

  -- Try pattern match (e.g., panel_* matches panel_hood)
  RETURN QUERY
  SELECT
    m.labor_operation_codes,
    m.description,
    m.estimated_hours_min,
    m.estimated_hours_max,
    m.estimated_hours_typical,
    m.materials_cost_min,
    m.materials_cost_max,
    'pattern'::TEXT AS match_type
  FROM stage_transition_labor_map m
  WHERE m.from_stage = p_from_stage
    AND m.to_stage = p_to_stage
    AND m.zone_pattern != '*'
    AND p_zone LIKE REPLACE(m.zone_pattern, '*', '%')
  LIMIT 1;

  IF FOUND THEN RETURN; END IF;

  -- Fallback: wildcard zone match
  RETURN QUERY
  SELECT
    m.labor_operation_codes,
    m.description,
    m.estimated_hours_min,
    m.estimated_hours_max,
    m.estimated_hours_typical,
    m.materials_cost_min,
    m.materials_cost_max,
    'wildcard'::TEXT AS match_type
  FROM stage_transition_labor_map m
  WHERE m.from_stage = p_from_stage
    AND m.to_stage = p_to_stage
    AND m.zone_pattern = '*'
  LIMIT 1;
END;
$$;

COMMENT ON FUNCTION estimate_labor_from_delta IS 'Estimate labor hours for a stage transition in a specific zone. Tries exact → pattern → wildcard match.';

-- Update detect_work_sessions to use start_time/end_time (existing columns)
CREATE OR REPLACE FUNCTION detect_work_sessions(
  p_vehicle_id UUID,
  p_gap_threshold_minutes INTEGER DEFAULT 120
)
RETURNS TABLE (
  session_number INTEGER,
  session_start TIMESTAMPTZ,
  session_end TIMESTAMPTZ,
  duration_minutes NUMERIC,
  image_count BIGINT,
  start_image_id UUID,
  end_image_id UUID,
  zones_touched TEXT[],
  stages_observed TEXT[],
  image_ids UUID[]
)
LANGUAGE sql
STABLE
AS $$
  WITH ordered_images AS (
    SELECT
      id,
      image_url,
      vehicle_zone,
      fabrication_stage,
      COALESCE(taken_at, created_at) AS ts,
      LAG(COALESCE(taken_at, created_at)) OVER (ORDER BY COALESCE(taken_at, created_at)) AS prev_ts
    FROM vehicle_images
    WHERE vehicle_id = p_vehicle_id
      AND image_url IS NOT NULL
      AND ai_processing_status = 'completed'
    ORDER BY COALESCE(taken_at, created_at)
  ),
  session_breaks AS (
    SELECT
      id, image_url, vehicle_zone, fabrication_stage, ts,
      CASE
        WHEN prev_ts IS NULL THEN 1
        WHEN EXTRACT(EPOCH FROM (ts - prev_ts)) / 60 > p_gap_threshold_minutes THEN 1
        ELSE 0
      END AS is_new_session
    FROM ordered_images
  ),
  session_groups AS (
    SELECT
      id, image_url, vehicle_zone, fabrication_stage, ts,
      SUM(is_new_session) OVER (ORDER BY ts) AS session_num
    FROM session_breaks
  )
  SELECT
    session_num::INTEGER AS session_number,
    MIN(ts) AS session_start,
    MAX(ts) AS session_end,
    ROUND(EXTRACT(EPOCH FROM (MAX(ts) - MIN(ts))) / 60, 1) AS duration_minutes,
    COUNT(*) AS image_count,
    (ARRAY_AGG(id ORDER BY ts))[1] AS start_image_id,
    (ARRAY_AGG(id ORDER BY ts DESC))[1] AS end_image_id,
    ARRAY_AGG(DISTINCT vehicle_zone) FILTER (WHERE vehicle_zone IS NOT NULL) AS zones_touched,
    ARRAY_AGG(DISTINCT fabrication_stage) FILTER (WHERE fabrication_stage IS NOT NULL) AS stages_observed,
    ARRAY_AGG(id ORDER BY ts) AS image_ids
  FROM session_groups
  GROUP BY session_num
  ORDER BY session_num;
$$;
