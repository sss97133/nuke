-- Forensic Before/After Detection Tables
-- The smoking gun: proof that work happened
-- 
-- Key insight: Before/After image pairs + time delta = verified work
-- System can CALL BS on unrealistic claims

-- Before/After Analysis Results
CREATE TABLE IF NOT EXISTS forensic_before_after (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES businesses(id),
  image_ids UUID[] NOT NULL,
  
  -- Before/After Pairs Detected
  -- [{ beforeImageIndex, afterImageIndex, component, beforeCondition, afterCondition, workPerformed, confidence }]
  before_after_pairs JSONB DEFAULT '[]',
  
  -- Work Detected Summary
  -- { workTypes: [], description, components: [] }
  work_detected JSONB DEFAULT '{}',
  
  -- Time Analysis
  -- { earliestImage, latestImage, totalHours, isReasonableForWork, concerns }
  time_analysis JSONB DEFAULT '{}',
  
  -- Cost Validation (system can call BS here)
  -- { estimatedLaborHours, estimatedMaterialsCost, totalEstimate, claimIsReasonable, concerns, marketComparison }
  cost_validation JSONB DEFAULT '{}',
  
  -- Claims being validated
  claimed_labor_hours REAL,
  claimed_materials_cost DECIMAL(10,2),
  claimed_total DECIMAL(10,2),
  
  -- Overall Validation Result
  overall_validation JSONB DEFAULT '{}',
  is_verified BOOLEAN DEFAULT FALSE,
  confidence REAL DEFAULT 0,
  concerns TEXT[] DEFAULT '{}',
  
  -- System BS Detection
  system_flagged BOOLEAN DEFAULT FALSE,
  flag_reason TEXT,
  
  -- User override (USER DATA ALWAYS WINS)
  user_verified BOOLEAN,
  user_verified_by UUID,
  user_verified_at TIMESTAMPTZ,
  user_notes TEXT,
  
  analyzed_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Review Queue for Flagged Concerns
-- When system calls BS, items go here for human review
CREATE TABLE IF NOT EXISTS forensic_review_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  forensic_record_id UUID REFERENCES forensic_before_after(id),
  
  -- Type of concern
  concern_type TEXT NOT NULL, -- 'before_after_mismatch', 'cost_anomaly', 'time_impossible', 'materials_mismatch'
  concerns TEXT[] DEFAULT '{}',
  
  -- Priority based on severity
  priority TEXT DEFAULT 'medium', -- 'low', 'medium', 'high', 'critical'
  status TEXT DEFAULT 'pending', -- 'pending', 'reviewed', 'resolved', 'dismissed'
  
  -- Resolution (human review)
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  resolution TEXT, -- 'verified', 'rejected', 'needs_more_info', 'user_override'
  resolution_notes TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_forensic_before_after_vehicle ON forensic_before_after(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_forensic_before_after_org ON forensic_before_after(organization_id);
CREATE INDEX IF NOT EXISTS idx_forensic_before_after_flagged ON forensic_before_after(system_flagged) WHERE system_flagged = TRUE;
CREATE INDEX IF NOT EXISTS idx_forensic_review_queue_status ON forensic_review_queue(status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_forensic_review_queue_priority ON forensic_review_queue(priority, created_at);

-- Comments for documentation
COMMENT ON TABLE forensic_before_after IS 'Forensic analysis of before/after image pairs to verify work claims';
COMMENT ON COLUMN forensic_before_after.system_flagged IS 'TRUE when system detects potential BS (unrealistic claims)';
COMMENT ON COLUMN forensic_before_after.user_verified IS 'User override - always wins over system';
COMMENT ON TABLE forensic_review_queue IS 'Queue of flagged items for human review when system calls BS';

