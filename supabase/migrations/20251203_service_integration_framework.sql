-- SERVICE INTEGRATION FRAMEWORK
-- Extensible system for automated data services (NHTSA, GM Heritage, Carfax, appraisals, etc.)

-- ============================================================================
-- 1. SERVICE REGISTRY
-- ============================================================================

CREATE TABLE IF NOT EXISTS service_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Service identity
  service_key TEXT UNIQUE NOT NULL,  -- 'gm_heritage', 'carfax', 'hagerty_appraisal'
  service_name TEXT NOT NULL,        -- 'GM Heritage Certificate'
  provider TEXT NOT NULL,            -- 'General Motors', 'Carfax', 'Hagerty'
  category TEXT NOT NULL,            -- 'documentation', 'history', 'appraisal', 'marketplace'
  
  -- Integration config
  integration_type TEXT NOT NULL,    -- 'api', 'email', 'web_form', 'manual', 'webhook'
  endpoint_url TEXT,                 -- API endpoint or form URL
  auth_method TEXT,                  -- 'api_key', 'oauth', 'basic', 'none'
  
  -- Execution rules
  trigger_mode TEXT NOT NULL,        -- 'auto', 'manual', 'conditional'
  trigger_conditions JSONB,          -- When to auto-execute
  required_fields TEXT[],            -- ['vin', 'year', 'make']
  
  -- Pricing
  is_free BOOLEAN DEFAULT true,
  price_usd NUMERIC,
  price_type TEXT,                   -- 'one_time', 'subscription', 'per_use'
  
  -- Performance
  avg_turnaround_hours NUMERIC,     -- How long it takes
  success_rate NUMERIC,              -- Historical success %
  
  -- What it provides
  fields_populated TEXT[],           -- ['build_date', 'factory_options', 'paint_code']
  document_types TEXT[],             -- ['certificate', 'build_sheet', 'window_sticker']
  
  -- Status
  is_enabled BOOLEAN DEFAULT true,
  is_beta BOOLEAN DEFAULT false,
  requires_approval BOOLEAN DEFAULT false,  -- For paid services
  
  -- Metadata
  description TEXT,
  icon_url TEXT,
  documentation_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT valid_category CHECK (category IN ('documentation', 'history', 'appraisal', 'marketplace', 'inspection', 'certification')),
  CONSTRAINT valid_integration_type CHECK (integration_type IN ('api', 'email', 'web_form', 'manual', 'webhook')),
  CONSTRAINT valid_trigger_mode CHECK (trigger_mode IN ('auto', 'manual', 'conditional'))
);

CREATE INDEX IF NOT EXISTS idx_service_integrations_category ON service_integrations(category);
CREATE INDEX IF NOT EXISTS idx_service_integrations_enabled ON service_integrations(is_enabled) WHERE is_enabled = true;

-- ============================================================================
-- 2. SERVICE EXECUTIONS
-- ============================================================================

CREATE TABLE IF NOT EXISTS service_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
  service_key TEXT REFERENCES service_integrations(service_key),
  user_id UUID,
  
  -- Execution tracking
  status TEXT NOT NULL DEFAULT 'queued',
  trigger_type TEXT,     -- 'auto', 'manual', 'scheduled'
  
  -- Request/Response
  request_data JSONB,    -- What we sent
  response_data JSONB,   -- What we got back
  error_message TEXT,
  retry_count INT DEFAULT 0,
  
  -- Timing
  queued_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  
  -- Results
  fields_populated JSONB,     -- { "build_date": "04/15/87", "paint_code": "70" }
  documents_created UUID[],   -- Links to documents table
  form_completion_id UUID,    -- Links to vehicle_form_completions
  
  -- Cost tracking
  price_paid NUMERIC,
  payment_id TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT valid_status CHECK (status IN ('queued', 'executing', 'completed', 'failed', 'cancelled', 'pending_payment')),
  CONSTRAINT valid_trigger_type CHECK (trigger_type IN ('auto', 'manual', 'scheduled'))
);

CREATE INDEX IF NOT EXISTS idx_service_executions_vehicle ON service_executions(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_service_executions_status ON service_executions(status);
CREATE INDEX IF NOT EXISTS idx_service_executions_service ON service_executions(service_key);

-- ============================================================================
-- 3. VEHICLE FIELD EVIDENCE (Multi-source data architecture)
-- ============================================================================

CREATE TABLE IF NOT EXISTS vehicle_field_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
  
  -- WHAT field is this evidence for?
  field_name TEXT NOT NULL,  -- 'vin', 'year', 'engine_code', etc.
  
  -- WHAT is the value?
  value_text TEXT,           -- For text fields
  value_number NUMERIC,      -- For numeric fields
  value_date DATE,           -- For dates
  value_json JSONB,          -- For complex data
  
  -- WHERE did this come from?
  source_type TEXT NOT NULL,  -- 'spid_sheet', 'nhtsa_decode', 'user_input', 
                              -- 'ocr_title', 'ocr_registration', 'ai_visual',
                              -- 'factory_manual', 'vin_tag', 'gm_heritage',
                              -- 'carfax', 'hagerty', 'appraisal'
  source_id UUID,             -- Links to image_id, document_id, service_execution_id
  
  -- HOW confident are we?
  confidence_score INT CHECK (confidence_score >= 0 AND confidence_score <= 100),
  extraction_model TEXT,      -- 'gpt-4o', 'user', 'nhtsa_api', 'gm_official', etc.
  
  -- WHEN?
  extracted_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Verification status
  verified_by_user BOOLEAN DEFAULT FALSE,
  flagged_as_incorrect BOOLEAN DEFAULT FALSE,
  
  -- Evidence details
  metadata JSONB,  -- Full extraction context
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(vehicle_id, field_name, source_type, source_id)
);

CREATE INDEX IF NOT EXISTS idx_evidence_vehicle_field ON vehicle_field_evidence(vehicle_id, field_name);
CREATE INDEX IF NOT EXISTS idx_evidence_source_type ON vehicle_field_evidence(source_type);

-- ============================================================================
-- 4. VEHICLE FORM COMPLETIONS
-- ============================================================================

CREATE TABLE IF NOT EXISTS vehicle_form_completions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
  
  -- WHICH form/source?
  form_type TEXT NOT NULL,  -- 'spid', 'nhtsa', 'title', 'registration', 
                             -- 'gm_heritage', 'carfax', 'appraisal', 'inspection'
  form_version TEXT,         -- '2024', 'v1', etc.
  
  -- Completion status
  status TEXT NOT NULL,      -- 'not_started', 'partial', 'complete', 
                             -- 'commissioned', 'in_progress'
  completeness_pct INT CHECK (completeness_pct >= 0 AND completeness_pct <= 100),
  
  -- Field coverage
  fields_extracted JSONB,    -- { "vin": true, "year": true, "make": false }
  fields_required JSONB,     -- { "vin": true, "year": true, "paint": false }
  
  -- Source reference
  source_id UUID,            -- Links to image_id, document_id, service_execution_id
  source_type TEXT,          -- 'spid_image', 'api_response', 'user_upload'
  source_url TEXT,           -- Link to original
  
  -- Metadata
  provider TEXT,             -- 'GM', 'NHTSA', 'Carfax', 'Internal'
  extracted_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,    -- For paid services
  
  -- Commissioned service tracking
  commissioned_at TIMESTAMPTZ,
  commission_price NUMERIC,
  commission_status TEXT,    -- 'pending', 'in_progress', 'completed'
  service_execution_id UUID REFERENCES service_executions(id),
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(vehicle_id, form_type),
  CONSTRAINT valid_form_status CHECK (status IN ('not_started', 'partial', 'complete', 'commissioned', 'in_progress', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_form_completions_vehicle ON vehicle_form_completions(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_form_completions_status ON vehicle_form_completions(status);

-- ============================================================================
-- 5. HELPER FUNCTIONS
-- ============================================================================

-- Calculate vehicle verification score
CREATE OR REPLACE FUNCTION calculate_verification_score(p_vehicle_id UUID)
RETURNS INT AS $$
DECLARE
  form_count INT;
  completed_count INT;
  weighted_score NUMERIC;
BEGIN
  -- Count forms
  SELECT 
    COUNT(*),
    COUNT(*) FILTER (WHERE status = 'complete')
  INTO form_count, completed_count
  FROM vehicle_form_completions
  WHERE vehicle_id = p_vehicle_id;
  
  IF form_count = 0 THEN RETURN 0; END IF;
  
  -- Calculate weighted score (official sources count more)
  SELECT AVG(
    CASE form_type
      WHEN 'spid' THEN completeness_pct * 1.5
      WHEN 'gm_heritage' THEN completeness_pct * 1.5
      WHEN 'nhtsa' THEN completeness_pct * 1.2
      WHEN 'title' THEN completeness_pct * 1.3
      ELSE completeness_pct
    END
  ) INTO weighted_score
  FROM vehicle_form_completions
  WHERE vehicle_id = p_vehicle_id;
  
  RETURN LEAST(100, ROUND(weighted_score)::INT);
END;
$$ LANGUAGE plpgsql STABLE;

-- Get missing required fields for a service
CREATE OR REPLACE FUNCTION get_missing_fields(p_vehicle_id UUID, p_required_fields TEXT[])
RETURNS TEXT[] AS $$
DECLARE
  v_data JSONB;
  missing TEXT[];
BEGIN
  SELECT row_to_json(v)::jsonb INTO v_data
  FROM vehicles v
  WHERE id = p_vehicle_id;
  
  SELECT array_agg(field)
  INTO missing
  FROM unnest(p_required_fields) field
  WHERE v_data->>field IS NULL OR v_data->>field = '';
  
  RETURN COALESCE(missing, ARRAY[]::TEXT[]);
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- 6. RLS POLICIES
-- ============================================================================

-- Service integrations are public (read-only)
ALTER TABLE service_integrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view enabled services" ON service_integrations FOR SELECT USING (is_enabled = true);

-- Service executions are private
ALTER TABLE service_executions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their service executions" ON service_executions FOR SELECT 
  USING (
    vehicle_id IN (SELECT id FROM vehicles WHERE uploaded_by = auth.uid())
    OR user_id = auth.uid()
  );

-- Field evidence is viewable by vehicle contributors
ALTER TABLE vehicle_field_evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view evidence for their vehicles" ON vehicle_field_evidence FOR SELECT
  USING (
    vehicle_id IN (SELECT id FROM vehicles WHERE uploaded_by = auth.uid())
  );

-- Form completions are viewable by vehicle contributors
ALTER TABLE vehicle_form_completions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view form completions for their vehicles" ON vehicle_form_completions FOR SELECT
  USING (
    vehicle_id IN (SELECT id FROM vehicles WHERE uploaded_by = auth.uid())
  );

-- Grant service role permissions
GRANT ALL ON service_integrations TO service_role;
GRANT ALL ON service_executions TO service_role;
GRANT ALL ON vehicle_field_evidence TO service_role;
GRANT ALL ON vehicle_form_completions TO service_role;

SELECT 'Service integration framework created successfully' as status;

