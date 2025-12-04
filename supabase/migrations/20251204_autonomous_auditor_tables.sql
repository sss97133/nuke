-- ============================================
-- AUTONOMOUS DATA AUDITOR TABLES
-- ============================================
-- Supports the autonomous data auditor system
-- Tracks audit runs, results, and actions taken

BEGIN;

-- ============================================
-- 1. AUDIT RUNS TABLE
-- ============================================
-- Tracks each audit run

CREATE TABLE IF NOT EXISTS audit_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  run_id TEXT UNIQUE NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  
  -- Stats
  vehicles_audited INTEGER DEFAULT 0,
  vehicles_improved INTEGER DEFAULT 0,
  vehicles_flagged INTEGER DEFAULT 0,
  total_cost NUMERIC(10,2) DEFAULT 0,
  total_fixes INTEGER DEFAULT 0,
  
  -- Config used
  config JSONB,
  
  -- Status
  status TEXT CHECK (status IN ('running', 'completed', 'budget_exceeded', 'error')),
  error_message TEXT,
  
  -- Results
  results JSONB,  -- Full AuditRunSummary
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_runs_status ON audit_runs(status);
CREATE INDEX idx_audit_runs_started ON audit_runs(started_at DESC);

COMMENT ON TABLE audit_runs IS 'Tracks autonomous audit runs and their results';

-- ============================================
-- 2. AUDIT ACTIONS TABLE
-- ============================================
-- Individual actions taken by auditor

CREATE TABLE IF NOT EXISTS audit_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  run_id TEXT REFERENCES audit_runs(run_id) ON DELETE CASCADE,
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
  
  -- Action details
  action_type TEXT NOT NULL CHECK (action_type IN ('fetch_vin', 'scrape_listing', 'ocr_image', 'ai_analysis', 'apply_consensus', 'fix_validation')),
  description TEXT NOT NULL,
  field_name TEXT,
  
  -- Cost/benefit
  estimated_cost NUMERIC(10,4),
  actual_cost NUMERIC(10,4),
  expected_confidence_boost INTEGER,
  actual_confidence_boost INTEGER,
  priority INTEGER CHECK (priority BETWEEN 1 AND 5),
  
  -- Execution
  status TEXT NOT NULL CHECK (status IN ('pending', 'executing', 'completed', 'failed', 'skipped', 'needs_approval')),
  executed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  
  -- Results
  result JSONB,
  error_message TEXT,
  
  -- Proof tracking
  proof_sources TEXT[],
  proof_authenticity INTEGER CHECK (proof_authenticity BETWEEN 0 AND 100),
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_actions_run ON audit_actions(run_id);
CREATE INDEX idx_audit_actions_vehicle ON audit_actions(vehicle_id);
CREATE INDEX idx_audit_actions_status ON audit_actions(status);
CREATE INDEX idx_audit_actions_type ON audit_actions(action_type);

COMMENT ON TABLE audit_actions IS 'Individual actions taken by autonomous auditor';

-- ============================================
-- 3. HELPER FUNCTION: Get vehicles needing audit
-- ============================================

CREATE OR REPLACE FUNCTION get_vehicles_needing_audit(
  min_score INTEGER DEFAULT 60,
  p_limit INTEGER DEFAULT 100
)
RETURNS TABLE(
  id UUID,
  year INTEGER,
  make TEXT,
  model TEXT,
  vin TEXT,
  sale_price NUMERIC,
  mileage INTEGER,
  listing_url TEXT,
  quality_score INTEGER,
  missing_count INTEGER
) AS $$
BEGIN
  RETURN QUERY
  WITH vehicle_scores AS (
    SELECT 
      v.id,
      v.year,
      v.make,
      v.model,
      v.vin,
      v.sale_price,
      v.mileage,
      v.listing_url,
      vqs.overall_score,
      COALESCE(
        (CASE WHEN v.vin IS NULL THEN 1 ELSE 0 END) +
        (CASE WHEN v.sale_price IS NULL AND v.current_value IS NULL THEN 1 ELSE 0 END) +
        (CASE WHEN v.mileage IS NULL THEN 1 ELSE 0 END) +
        (CASE WHEN v.year IS NULL THEN 1 ELSE 0 END),
        0
      ) as missing_count
    FROM vehicles v
    LEFT JOIN vehicle_quality_scores vqs ON vqs.vehicle_id = v.id
    WHERE v.status = 'active'
  )
  SELECT 
    vs.id,
    vs.year,
    vs.make,
    vs.model,
    vs.vin,
    vs.sale_price,
    vs.mileage,
    vs.listing_url,
    COALESCE(vs.overall_score, 0) as quality_score,
    vs.missing_count
  FROM vehicle_scores vs
  WHERE COALESCE(vs.overall_score, 0) < min_score
     OR vs.missing_count > 0
  ORDER BY 
    vs.missing_count DESC,  -- Most missing fields first
    vs.overall_score ASC    -- Lowest quality first
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_vehicles_needing_audit IS 'Returns priority queue of vehicles needing audit';

-- ============================================
-- 4. HELPER FUNCTION: Get audit statistics
-- ============================================

CREATE OR REPLACE FUNCTION get_audit_statistics(days INTEGER DEFAULT 7)
RETURNS JSONB AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'total_runs', COUNT(*),
    'total_vehicles_audited', SUM(vehicles_audited),
    'total_vehicles_improved', SUM(vehicles_improved),
    'total_cost', SUM(total_cost),
    'total_fixes', SUM(total_fixes),
    'avg_vehicles_per_run', AVG(vehicles_audited),
    'avg_cost_per_run', AVG(total_cost),
    'success_rate', 
      CASE WHEN COUNT(*) > 0 
      THEN ROUND((COUNT(*) FILTER (WHERE status = 'completed')::NUMERIC / COUNT(*)) * 100, 1)
      ELSE 0 
      END,
    'runs_by_status', (
      SELECT jsonb_object_agg(status, count)
      FROM (
        SELECT status, COUNT(*) as count
        FROM audit_runs
        WHERE started_at >= NOW() - INTERVAL '1 day' * days
        GROUP BY status
      ) s
    )
  ) INTO v_result
  FROM audit_runs
  WHERE started_at >= NOW() - INTERVAL '1 day' * days;
  
  RETURN v_result;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_audit_statistics IS 'Returns statistics for audit runs over specified days';

-- ============================================
-- 5. VIEW: Recent audit runs
-- ============================================

CREATE OR REPLACE VIEW recent_audit_runs AS
SELECT 
  run_id,
  started_at,
  completed_at,
  EXTRACT(EPOCH FROM (completed_at - started_at)) as duration_seconds,
  vehicles_audited,
  vehicles_improved,
  total_cost,
  total_fixes,
  status,
  ROUND((vehicles_improved::NUMERIC / NULLIF(vehicles_audited, 0)) * 100, 1) as improvement_rate
FROM audit_runs
ORDER BY started_at DESC
LIMIT 20;

COMMENT ON VIEW recent_audit_runs IS 'Shows recent audit runs with calculated metrics';

-- ============================================
-- 6. VIEW: Action effectiveness
-- ============================================

CREATE OR REPLACE VIEW audit_action_effectiveness AS
SELECT 
  action_type,
  COUNT(*) as total_attempts,
  COUNT(*) FILTER (WHERE status = 'completed') as successful,
  COUNT(*) FILTER (WHERE status = 'failed') as failed,
  AVG(actual_cost) as avg_cost,
  AVG(actual_confidence_boost) as avg_confidence_boost,
  ROUND((COUNT(*) FILTER (WHERE status = 'completed')::NUMERIC / COUNT(*)) * 100, 1) as success_rate
FROM audit_actions
GROUP BY action_type
ORDER BY success_rate DESC;

COMMENT ON VIEW audit_action_effectiveness IS 'Shows effectiveness of different audit action types';

COMMIT;

