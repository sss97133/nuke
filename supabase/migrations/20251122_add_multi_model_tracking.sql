-- Multi-Model Answer Tracking and Consensus System
-- Enables tracking which models answered which questions, building consensus, and identifying gaps

-- Add provenance tracking to vehicle_images
ALTER TABLE vehicle_images 
ADD COLUMN IF NOT EXISTS analysis_history JSONB DEFAULT '{}'::jsonb;

ALTER TABLE vehicle_images
ADD COLUMN IF NOT EXISTS context_score INTEGER DEFAULT 0;

ALTER TABLE vehicle_images
ADD COLUMN IF NOT EXISTS processing_models_used TEXT[] DEFAULT ARRAY[]::TEXT[];

ALTER TABLE vehicle_images
ADD COLUMN IF NOT EXISTS total_processing_cost NUMERIC(10,6) DEFAULT 0;

-- Table to track individual question answers from multiple models
CREATE TABLE IF NOT EXISTS image_question_answers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  image_id UUID REFERENCES vehicle_images(id) ON DELETE CASCADE,
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
  
  -- The question
  question_key TEXT NOT NULL,        -- "angle_detection", "engine_parts", etc
  question_difficulty TEXT,          -- "trivial", "simple", "moderate", "expert"
  
  -- The answer
  answer JSONB NOT NULL,
  confidence INTEGER CHECK (confidence >= 0 AND confidence <= 100),
  
  -- Model provenance
  model_used TEXT NOT NULL,          -- "gpt-4o-mini-2024-11-20", "claude-3-haiku"
  model_cost NUMERIC(10,6),
  answered_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Context used
  context_score INTEGER,             -- Context richness when answered
  context_items_used JSONB,          -- What context enabled this answer
  /*
  Example:
  {
    "spid_data": true,
    "receipts": ["receipt_id_1", "receipt_id_2"],
    "timeline_events": 5,
    "user_tags": 2,
    "previous_analysis": true
  }
  */
  
  -- Validation
  validated_by_receipt UUID REFERENCES receipts(id),
  validated_by_user UUID REFERENCES profiles(id),
  validated_at TIMESTAMPTZ,
  
  -- Consensus tracking
  consensus_with_answer_ids UUID[],  -- Other answers that agree
  consensus_confidence INTEGER,       -- Combined confidence from consensus
  is_consensus_answer BOOLEAN DEFAULT false,
  
  -- Reprocessing
  should_reprocess BOOLEAN DEFAULT false,
  reprocessed_from UUID REFERENCES image_question_answers(id),
  superseded_by UUID REFERENCES image_question_answers(id),
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_image_question_answers_image ON image_question_answers(image_id);
CREATE INDEX idx_image_question_answers_vehicle ON image_question_answers(vehicle_id);
CREATE INDEX idx_image_question_answers_question ON image_question_answers(question_key);
CREATE INDEX idx_image_question_answers_should_reprocess ON image_question_answers(should_reprocess) WHERE should_reprocess = true;
CREATE INDEX idx_image_question_answers_model ON image_question_answers(model_used);

-- Table for tracking missing context (gap identification)
CREATE TABLE IF NOT EXISTS missing_context_reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
  image_id UUID REFERENCES vehicle_images(id) ON DELETE CASCADE,
  
  -- What's missing
  missing_items JSONB NOT NULL,
  /*
  [
    {
      "type": "receipt",
      "for_item": "intake manifold",
      "would_improve_confidence_by": 55,
      "current_confidence": 40,
      "potential_confidence": 95
    },
    {
      "type": "user_tag",
      "for_item": "carburetor brand",
      "action": "User should photograph manufacturer tag"
    }
  ]
  */
  
  -- Impact assessment
  current_completeness NUMERIC(5,2),   -- e.g. 45.00 (percent)
  potential_completeness NUMERIC(5,2), -- e.g. 90.00 (with missing items)
  estimated_cost_savings NUMERIC(10,6), -- How much we'd save on reprocessing
  
  -- Tracking
  identified_by_model TEXT,
  identified_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Resolution
  items_added INTEGER DEFAULT 0,
  resolved_at TIMESTAMPTZ,
  improvement_achieved NUMERIC(5,2),  -- Actual improvement after context added
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_missing_context_vehicle ON missing_context_reports(vehicle_id);
CREATE INDEX idx_missing_context_unresolved ON missing_context_reports(resolved_at) WHERE resolved_at IS NULL;

-- Table for NCRS-style judging criteria (professional standards)
CREATE TABLE IF NOT EXISTS ncrs_judging_criteria (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Category
  category TEXT NOT NULL,        -- "exterior", "interior", "chassis", "engine"
  section TEXT NOT NULL,         -- "paint", "panel_fit", "chrome", etc
  criterion TEXT NOT NULL,       -- Specific thing being judged
  
  -- Factory specs
  factory_spec TEXT,             -- What is factory correct
  tolerance TEXT,                -- Acceptable variation
  measurement_unit TEXT,         -- "inches", "mm", "visual", etc
  
  -- Deduction rules
  deduction_minor INTEGER,       -- Points for minor deviation
  deduction_major INTEGER,       -- Points for major deviation
  
  -- Reference
  reference_source TEXT,         -- "NCRS Judging Guide 4th Ed", "Factory Manual"
  page_number TEXT,              -- Specific page
  reference_image_url TEXT,      -- Photo of the page
  
  -- Applicability
  applies_to_makes TEXT[],       -- ["Chevrolet", "GM"]
  applies_to_models TEXT[],      -- ["Corvette", "Corvette Sting Ray"]
  applies_to_years INTEGER[],    -- [1963, 1964, 1965, 1966, 1967]
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ncrs_criteria_applicability ON ncrs_judging_criteria 
  USING GIN (applies_to_makes, applies_to_models, applies_to_years);

COMMENT ON TABLE image_question_answers IS 'Tracks individual answers from multiple models, enabling consensus and provenance tracking';
COMMENT ON TABLE missing_context_reports IS 'Expensive model output identifying what documentation would improve analysis';
COMMENT ON TABLE ncrs_judging_criteria IS 'Professional appraisal standards for factory correctness assessment';

