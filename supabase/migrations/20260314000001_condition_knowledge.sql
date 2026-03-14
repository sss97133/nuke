-- Condition Knowledge: structured failure modes, specifications, and inspection criteria
-- extracted from OEM service manuals. Links service_manual_chunks → condition_taxonomy.

CREATE TABLE IF NOT EXISTS condition_knowledge (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Source linkage
  chunk_id UUID REFERENCES service_manual_chunks(id),
  manual_section TEXT,
  page_range TEXT,

  -- Component hierarchy
  system TEXT NOT NULL,
  component TEXT NOT NULL,
  sub_component TEXT,

  -- Entry type
  condition_type TEXT NOT NULL CHECK (condition_type IN (
    'failure_mode', 'specification', 'inspection_criterion', 'maintenance_interval'
  )),

  -- Failure mode fields
  symptom TEXT,
  possible_causes TEXT[],
  corrections TEXT[],
  severity_class TEXT CHECK (severity_class IN (
    'cosmetic', 'functional', 'safety_critical', 'structural'
  )),

  -- Specification fields
  spec_name TEXT,
  spec_value TEXT,
  spec_unit TEXT,
  spec_min NUMERIC,
  spec_max NUMERIC,

  -- Inspection fields
  inspection_interval TEXT,
  inspection_method TEXT,
  pass_criteria TEXT,
  fail_indicators TEXT[],

  -- Domain mapping (connects to condition_taxonomy)
  condition_domain TEXT NOT NULL CHECK (condition_domain IN (
    'exterior', 'interior', 'mechanical', 'structural', 'provenance'
  )),
  related_zones TEXT[],
  descriptor_id UUID REFERENCES condition_taxonomy(descriptor_id),

  -- Applicability
  applicable_makes TEXT[],
  applicable_models TEXT[],
  applicable_years int4range,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common access patterns
CREATE INDEX IF NOT EXISTS idx_ck_system_component ON condition_knowledge(system, component);
CREATE INDEX IF NOT EXISTS idx_ck_condition_type ON condition_knowledge(condition_type);
CREATE INDEX IF NOT EXISTS idx_ck_domain ON condition_knowledge(condition_domain);
CREATE INDEX IF NOT EXISTS idx_ck_chunk ON condition_knowledge(chunk_id);
CREATE INDEX IF NOT EXISTS idx_ck_descriptor ON condition_knowledge(descriptor_id);

COMMENT ON TABLE condition_knowledge IS 'Structured condition knowledge extracted from OEM service manuals — failure modes, specifications, inspection criteria';
