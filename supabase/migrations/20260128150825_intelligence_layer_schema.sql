-- ============================================================================
-- INTELLIGENCE LAYER SCHEMA
-- Three-layer extraction: SOURCE → INTELLIGENCE → FRAMEWORK
-- ============================================================================

-- INTELLIGENCE DECISIONS
-- Every extraction gets evaluated, every decision is logged
CREATE TABLE IF NOT EXISTS intelligence_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Link to source capture (whatever raw extraction triggered this)
  source_capture_id uuid,
  source_url text,
  source_domain text,

  -- Overall outcome
  overall_decision text NOT NULL CHECK (overall_decision IN ('APPROVE', 'DOUBT', 'REJECT')),

  -- Counts for quick filtering
  approve_count int DEFAULT 0,
  doubt_count int DEFAULT 0,
  reject_count int DEFAULT 0,

  -- Full decision details (JSONB array of FieldDecision objects)
  field_decisions jsonb NOT NULL DEFAULT '[]',

  -- If REJECT, why?
  reject_reasons text[] DEFAULT '{}',

  -- If approved, what vehicle_id did it produce?
  resulting_vehicle_id uuid REFERENCES vehicles(id),

  -- Timestamps
  created_at timestamptz DEFAULT now(),
  processed_at timestamptz,  -- When moved to FRAMEWORK (or rejected)

  -- Index for finding recent decisions
  CONSTRAINT valid_counts CHECK (
    approve_count >= 0 AND doubt_count >= 0 AND reject_count >= 0
  )
);

-- DOUBT QUEUE
-- Items that need human research or AI investigation
CREATE TABLE IF NOT EXISTS doubt_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Link back to the intelligence decision
  intelligence_decision_id uuid REFERENCES intelligence_decisions(id),

  -- What field/value is in doubt?
  field_name text NOT NULL,
  field_value jsonb,

  -- Classification
  doubt_type text NOT NULL CHECK (doubt_type IN ('anomaly', 'conflict', 'edge_case', 'unknown_pattern')),
  priority text NOT NULL CHECK (priority IN ('high', 'medium', 'low')) DEFAULT 'medium',

  -- Description
  reason text NOT NULL,
  evidence jsonb DEFAULT '{}',

  -- Resolution workflow
  status text NOT NULL CHECK (status IN ('pending', 'researching', 'resolved', 'escalated')) DEFAULT 'pending',
  assigned_to text,  -- 'ai', 'human', or specific user_id

  -- Research results
  research_findings jsonb,
  resolution text CHECK (resolution IN ('APPROVE', 'REJECT', 'INCONCLUSIVE')),
  resolution_reason text,
  resolved_by text,
  resolved_at timestamptz,

  -- Did this create a new learned pattern?
  created_pattern_id uuid,

  -- Timestamps
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- LEARNED PATTERNS
-- Patterns discovered from resolving doubts
-- These feed back into the intelligence layer to auto-resolve future similar cases
CREATE TABLE IF NOT EXISTS intelligence_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- What type of pattern?
  pattern_type text NOT NULL,  -- 'vin_format', 'price_range', 'mileage_threshold', etc.

  -- The pattern itself (varies by type)
  pattern_definition jsonb NOT NULL,

  -- What should happen when this pattern matches?
  resolution text NOT NULL CHECK (resolution IN ('APPROVE', 'DOUBT', 'REJECT')),
  confidence float NOT NULL CHECK (confidence >= 0 AND confidence <= 1),

  -- Evidence that led to this pattern
  source_doubt_ids uuid[] DEFAULT '{}',  -- Which doubts led to this pattern
  examples_count int DEFAULT 1,

  -- Is this pattern active?
  is_active boolean DEFAULT true,

  -- Who/what created it?
  created_by text,  -- 'ai', 'human', 'auto_threshold'

  -- Timestamps
  created_at timestamptz DEFAULT now(),
  last_matched_at timestamptz,
  match_count int DEFAULT 0
);

-- Example patterns to seed the system
INSERT INTO intelligence_patterns (pattern_type, pattern_definition, resolution, confidence, created_by, examples_count)
VALUES
  -- Pre-1981 GM VINs are legitimate edge cases
  (
    'vin_format',
    '{"description": "Pre-1981 GM truck VIN format", "vin_length_min": 10, "vin_length_max": 13, "starts_with": ["C", "T"], "year_range": [1960, 1980]}',
    'APPROVE',
    0.85,
    'system_seed',
    1
  ),
  -- High-value sales ($2M+) from known auction houses are legitimate
  (
    'price_range',
    '{"description": "High-value auction sale", "price_min": 2000000, "source_categories": ["auction"], "trusted_domains": ["rmsothebys.com", "gooding.com", "bonhams.com", "bringatrailer.com"]}',
    'APPROVE',
    0.75,
    'system_seed',
    1
  ),
  -- VINs with I, O, Q are always invalid (hard rule)
  (
    'vin_format',
    '{"description": "VIN contains invalid characters", "contains_any": ["I", "O", "Q"], "vin_length": 17}',
    'REJECT',
    0.99,
    'system_seed',
    1
  )
ON CONFLICT DO NOTHING;

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Intelligence decisions
CREATE INDEX IF NOT EXISTS idx_intelligence_decisions_overall
  ON intelligence_decisions(overall_decision);
CREATE INDEX IF NOT EXISTS idx_intelligence_decisions_source_url
  ON intelligence_decisions(source_url);
CREATE INDEX IF NOT EXISTS idx_intelligence_decisions_created
  ON intelligence_decisions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_intelligence_decisions_domain
  ON intelligence_decisions(source_domain);

-- Doubt queue
CREATE INDEX IF NOT EXISTS idx_doubt_queue_status_priority
  ON doubt_queue(status, priority);
CREATE INDEX IF NOT EXISTS idx_doubt_queue_doubt_type
  ON doubt_queue(doubt_type);
CREATE INDEX IF NOT EXISTS idx_doubt_queue_pending
  ON doubt_queue(created_at) WHERE status = 'pending';

-- Learned patterns
CREATE INDEX IF NOT EXISTS idx_patterns_type_active
  ON intelligence_patterns(pattern_type) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_patterns_resolution
  ON intelligence_patterns(resolution);

-- ============================================================================
-- FUNCTIONS
-- ============================================================================

-- Increment pattern match count when used
CREATE OR REPLACE FUNCTION record_pattern_match(p_pattern_id uuid)
RETURNS void AS $$
BEGIN
  UPDATE intelligence_patterns
  SET
    match_count = match_count + 1,
    last_matched_at = now()
  WHERE id = p_pattern_id;
END;
$$ LANGUAGE plpgsql;

-- Get pending doubts for research (with locking to prevent double-processing)
CREATE OR REPLACE FUNCTION claim_doubts_for_research(
  p_limit int DEFAULT 10,
  p_priority text DEFAULT NULL,
  p_doubt_type text DEFAULT NULL
)
RETURNS SETOF doubt_queue AS $$
BEGIN
  RETURN QUERY
  UPDATE doubt_queue
  SET
    status = 'researching',
    updated_at = now()
  WHERE id IN (
    SELECT id FROM doubt_queue
    WHERE status = 'pending'
      AND (p_priority IS NULL OR priority = p_priority)
      AND (p_doubt_type IS NULL OR doubt_type = p_doubt_type)
    ORDER BY
      CASE priority
        WHEN 'high' THEN 1
        WHEN 'medium' THEN 2
        WHEN 'low' THEN 3
      END,
      created_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING doubt_queue.*;
END;
$$ LANGUAGE plpgsql;

-- Resolve a doubt and optionally create a learned pattern
CREATE OR REPLACE FUNCTION resolve_doubt(
  p_doubt_id uuid,
  p_resolution text,
  p_reason text,
  p_findings jsonb DEFAULT NULL,
  p_resolved_by text DEFAULT 'system',
  p_create_pattern boolean DEFAULT false,
  p_pattern_type text DEFAULT NULL,
  p_pattern_definition jsonb DEFAULT NULL
)
RETURNS jsonb AS $$
DECLARE
  v_pattern_id uuid;
  v_result jsonb;
BEGIN
  -- Update the doubt
  UPDATE doubt_queue
  SET
    status = 'resolved',
    resolution = p_resolution,
    resolution_reason = p_reason,
    research_findings = COALESCE(p_findings, research_findings),
    resolved_by = p_resolved_by,
    resolved_at = now(),
    updated_at = now()
  WHERE id = p_doubt_id;

  -- Optionally create a learned pattern
  IF p_create_pattern AND p_pattern_type IS NOT NULL AND p_pattern_definition IS NOT NULL THEN
    INSERT INTO intelligence_patterns (
      pattern_type,
      pattern_definition,
      resolution,
      confidence,
      source_doubt_ids,
      created_by
    ) VALUES (
      p_pattern_type,
      p_pattern_definition,
      p_resolution,
      0.7,  -- Start with moderate confidence
      ARRAY[p_doubt_id],
      p_resolved_by
    )
    RETURNING id INTO v_pattern_id;

    -- Link the pattern back to the doubt
    UPDATE doubt_queue
    SET created_pattern_id = v_pattern_id
    WHERE id = p_doubt_id;
  END IF;

  v_result := jsonb_build_object(
    'doubt_id', p_doubt_id,
    'resolution', p_resolution,
    'pattern_created', p_create_pattern,
    'pattern_id', v_pattern_id
  );

  RETURN v_result;
END;
$$ LANGUAGE plpgsql;

-- Stats view for monitoring
CREATE OR REPLACE VIEW intelligence_stats AS
SELECT
  -- Decision counts
  COUNT(*) FILTER (WHERE overall_decision = 'APPROVE') as total_approved,
  COUNT(*) FILTER (WHERE overall_decision = 'DOUBT') as total_doubted,
  COUNT(*) FILTER (WHERE overall_decision = 'REJECT') as total_rejected,

  -- Recent (last 24h)
  COUNT(*) FILTER (WHERE overall_decision = 'APPROVE' AND created_at > now() - interval '24 hours') as approved_24h,
  COUNT(*) FILTER (WHERE overall_decision = 'DOUBT' AND created_at > now() - interval '24 hours') as doubted_24h,
  COUNT(*) FILTER (WHERE overall_decision = 'REJECT' AND created_at > now() - interval '24 hours') as rejected_24h,

  -- Quality rate
  ROUND(
    COUNT(*) FILTER (WHERE overall_decision = 'APPROVE')::numeric /
    NULLIF(COUNT(*)::numeric, 0) * 100,
    2
  ) as approval_rate_pct
FROM intelligence_decisions;

CREATE OR REPLACE VIEW doubt_queue_stats AS
SELECT
  -- Status counts
  COUNT(*) FILTER (WHERE status = 'pending') as pending_count,
  COUNT(*) FILTER (WHERE status = 'researching') as researching_count,
  COUNT(*) FILTER (WHERE status = 'resolved') as resolved_count,
  COUNT(*) FILTER (WHERE status = 'escalated') as escalated_count,

  -- Priority breakdown (pending only)
  COUNT(*) FILTER (WHERE status = 'pending' AND priority = 'high') as high_priority_pending,
  COUNT(*) FILTER (WHERE status = 'pending' AND priority = 'medium') as medium_priority_pending,
  COUNT(*) FILTER (WHERE status = 'pending' AND priority = 'low') as low_priority_pending,

  -- Doubt type breakdown (pending only)
  COUNT(*) FILTER (WHERE status = 'pending' AND doubt_type = 'anomaly') as anomaly_pending,
  COUNT(*) FILTER (WHERE status = 'pending' AND doubt_type = 'conflict') as conflict_pending,
  COUNT(*) FILTER (WHERE status = 'pending' AND doubt_type = 'edge_case') as edge_case_pending,

  -- Oldest pending
  MIN(created_at) FILTER (WHERE status = 'pending') as oldest_pending_at
FROM doubt_queue;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE intelligence_decisions IS 'Records every extraction evaluation decision (APPROVE/DOUBT/REJECT)';
COMMENT ON TABLE doubt_queue IS 'Queue of uncertain extractions needing research before final decision';
COMMENT ON TABLE intelligence_patterns IS 'Learned patterns from resolved doubts - feeds back into validation';
COMMENT ON VIEW intelligence_stats IS 'Quick stats on intelligence layer performance';
COMMENT ON VIEW doubt_queue_stats IS 'Stats on pending research queue';
