-- ============================================================
-- LABOR ESTIMATION PIPELINE — "Photos Are The Time Clock"
-- ============================================================
-- Adds fabrication stage tracking, work session detection,
-- stage transition labor mapping, labor estimates, and
-- YONO training queue for active learning.
-- ============================================================

-- Phase 1d: Add fabrication_stage to vehicle_images
ALTER TABLE vehicle_images
  ADD COLUMN IF NOT EXISTS fabrication_stage TEXT,
  ADD COLUMN IF NOT EXISTS stage_confidence REAL;

COMMENT ON COLUMN vehicle_images.fabrication_stage IS 'Fabrication stage: raw/disassembled/stripped/fabricated/primed/blocked/basecoated/clearcoated/assembled/complete. Owned by yono-analyze.';
COMMENT ON COLUMN vehicle_images.stage_confidence IS 'Confidence in fabrication_stage prediction (0-1). Owned by yono-analyze.';

-- Phase 2: Work sessions table
CREATE TABLE IF NOT EXISTS work_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id),
  session_type TEXT NOT NULL DEFAULT 'auto_detected',
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER GENERATED ALWAYS AS (EXTRACT(EPOCH FROM (ended_at - started_at)) / 60) STORED,
  image_count INTEGER NOT NULL DEFAULT 0,
  start_image_id UUID REFERENCES vehicle_images(id),
  end_image_id UUID REFERENCES vehicle_images(id),
  zones_touched TEXT[] DEFAULT '{}',
  stages_observed TEXT[] DEFAULT '{}',
  stage_transitions JSONB DEFAULT '[]',
  technician_phone_link_id UUID,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_work_sessions_vehicle ON work_sessions(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_work_sessions_started ON work_sessions(started_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_work_sessions_vehicle_start ON work_sessions(vehicle_id, started_at);

COMMENT ON TABLE work_sessions IS 'Auto-detected work sessions from photo timestamp clustering. Owned by auto-detect-sessions.';

-- Phase 3: Stage transition labor map (seed data)
CREATE TABLE IF NOT EXISTS stage_transition_labor_map (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_stage TEXT NOT NULL,
  to_stage TEXT NOT NULL,
  zone_pattern TEXT DEFAULT '*',
  labor_operation_codes TEXT[] DEFAULT '{}',
  description TEXT,
  estimated_hours_min REAL NOT NULL,
  estimated_hours_max REAL NOT NULL,
  estimated_hours_typical REAL NOT NULL,
  materials_cost_min REAL DEFAULT 0,
  materials_cost_max REAL DEFAULT 0,
  confidence TEXT DEFAULT 'medium',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(from_stage, to_stage, zone_pattern)
);

COMMENT ON TABLE stage_transition_labor_map IS 'Maps fabrication stage transitions to labor hours and costs. Seed data, manually curated.';

-- Seed with ~15 known transitions
INSERT INTO stage_transition_labor_map (from_stage, to_stage, zone_pattern, description, estimated_hours_min, estimated_hours_max, estimated_hours_typical, materials_cost_min, materials_cost_max, confidence) VALUES
  ('raw', 'disassembled', '*', 'Full vehicle disassembly', 8, 24, 16, 0, 100, 'medium'),
  ('raw', 'stripped', 'panel_*', 'Single panel strip (media blast or chemical)', 1, 4, 2, 20, 80, 'high'),
  ('disassembled', 'stripped', '*', 'Media blast / chemical strip full body', 8, 20, 12, 200, 600, 'medium'),
  ('stripped', 'fabricated', 'panel_*', 'Panel fabrication — patch panels, rust repair', 4, 12, 6, 50, 300, 'high'),
  ('stripped', 'fabricated', 'ext_*', 'Exterior metalwork — straightening, leading', 2, 8, 4, 30, 150, 'medium'),
  ('fabricated', 'primed', 'panel_*', 'Panel prime — epoxy + high-build', 1, 3, 2, 40, 120, 'high'),
  ('fabricated', 'primed', '*', 'Full body prime', 4, 8, 6, 200, 500, 'medium'),
  ('primed', 'blocked', 'panel_*', 'Block sand single panel', 2, 6, 3, 20, 60, 'high'),
  ('primed', 'blocked', '*', 'Full body block sand', 8, 24, 16, 100, 300, 'medium'),
  ('blocked', 'basecoated', 'panel_*', 'Spray base coat — single panel', 1, 3, 2, 60, 200, 'high'),
  ('blocked', 'basecoated', '*', 'Spray base coat — full body', 3, 8, 5, 300, 800, 'medium'),
  ('basecoated', 'clearcoated', 'panel_*', 'Clear coat — single panel', 0.5, 2, 1, 40, 120, 'high'),
  ('basecoated', 'clearcoated', '*', 'Clear coat — full body', 2, 6, 4, 200, 600, 'medium'),
  ('clearcoated', 'assembled', '*', 'Reassembly — trim, glass, wiring', 16, 60, 32, 200, 2000, 'low'),
  ('assembled', 'complete', '*', 'Final assembly, testing, detail', 4, 16, 8, 50, 500, 'low')
ON CONFLICT (from_stage, to_stage, zone_pattern) DO NOTHING;

-- Phase 3: Labor estimates table
CREATE TABLE IF NOT EXISTS labor_estimates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id),
  work_session_id UUID REFERENCES work_sessions(id),
  zone_deltas JSONB NOT NULL DEFAULT '[]',
  labor_line_items JSONB NOT NULL DEFAULT '[]',
  total_hours_estimate REAL,
  total_cost_estimate REAL,
  labor_rate REAL DEFAULT 125,
  yono_confidence REAL,
  opus_validated BOOLEAN DEFAULT FALSE,
  opus_validation_result JSONB,
  status TEXT DEFAULT 'draft',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_labor_estimates_vehicle ON labor_estimates(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_labor_estimates_session ON labor_estimates(work_session_id);

COMMENT ON TABLE labor_estimates IS 'AI-generated labor estimates from photo delta analysis. Owned by compute-labor-estimate.';

-- Phase 5: YONO training queue (active learning)
CREATE TABLE IF NOT EXISTS yono_training_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  image_id UUID REFERENCES vehicle_images(id),
  image_url TEXT,
  prediction_type TEXT NOT NULL,
  yono_prediction JSONB NOT NULL,
  ground_truth JSONB,
  ground_truth_source TEXT,
  disagreement_type TEXT,
  priority INTEGER DEFAULT 50,
  training_status TEXT DEFAULT 'pending',
  exported_at TIMESTAMPTZ,
  trained_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_yono_training_queue_status ON yono_training_queue(training_status);
CREATE INDEX IF NOT EXISTS idx_yono_training_queue_type ON yono_training_queue(prediction_type);

COMMENT ON TABLE yono_training_queue IS 'Active learning queue: stores YONO predictions vs ground truth for retraining. Owned by yono-escalation-router.';

-- Phase 2a: detect_work_sessions SQL function
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

COMMENT ON FUNCTION detect_work_sessions IS 'Groups vehicle images into work sessions by timestamp proximity. Gap threshold default 120 min.';

-- Phase 3b: estimate_labor_from_delta SQL function
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
LANGUAGE sql
STABLE
AS $$
  -- Try exact zone match first
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
    AND (m.zone_pattern = p_zone OR p_zone LIKE REPLACE(m.zone_pattern, '*', '%'))
  ORDER BY
    CASE WHEN m.zone_pattern = p_zone THEN 0 ELSE 1 END,
    m.zone_pattern DESC
  LIMIT 1

  UNION ALL

  -- Fallback: wildcard zone match
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
$$;

COMMENT ON FUNCTION estimate_labor_from_delta IS 'Estimate labor hours for a stage transition in a specific zone. Tries exact zone match, falls back to wildcard.';

-- Register new columns in pipeline_registry
INSERT INTO pipeline_registry (table_name, column_name, owned_by, description, do_not_write_directly, write_via)
VALUES
  ('vehicle_images', 'fabrication_stage', 'yono-analyze', 'Fabrication stage classification (10-stage taxonomy)', true, 'yono-analyze edge function'),
  ('vehicle_images', 'stage_confidence', 'yono-analyze', 'Confidence in fabrication_stage prediction (0-1)', true, 'yono-analyze edge function'),
  ('work_sessions', 'id', 'auto-detect-sessions', 'Auto-detected work sessions from photo timestamps', true, 'auto-detect-sessions edge function'),
  ('labor_estimates', 'id', 'compute-labor-estimate', 'AI-generated labor estimates from photo deltas', true, 'compute-labor-estimate edge function'),
  ('yono_training_queue', 'id', 'yono-escalation-router', 'Active learning queue for YONO retraining', true, 'yono-escalation-router edge function')
ON CONFLICT DO NOTHING;
