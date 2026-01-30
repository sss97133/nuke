-- Extraction Comparisons Table
-- Stores naive vs playwright comparison data for investor metrics

CREATE TABLE IF NOT EXISTS extraction_comparisons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- URL info
  url TEXT NOT NULL,
  domain TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,

  -- Naive/Free method results
  free_success BOOLEAN DEFAULT FALSE,
  free_quality NUMERIC(4,3),  -- 0.000 to 1.000
  free_fields TEXT[],
  free_time_ms INTEGER,
  free_methods_attempted TEXT[],

  -- Playwright/Compute method results
  paid_success BOOLEAN DEFAULT FALSE,
  paid_quality NUMERIC(4,3),
  paid_fields TEXT[],
  paid_cost NUMERIC(10,4) DEFAULT 0,  -- For future paid API tracking
  paid_time_ms INTEGER,
  paid_methods_attempted TEXT[],

  -- Comparison metrics
  quality_delta NUMERIC(4,3),  -- paid - free
  additional_fields TEXT[],
  cost_per_field NUMERIC(10,4),

  -- Best result
  best_method TEXT,
  best_quality NUMERIC(4,3),
  recommendation TEXT,

  -- Site classification
  difficulty TEXT CHECK (difficulty IN ('easy', 'medium', 'hard')),

  -- Full result for debugging
  full_result JSONB,

  -- Indexes
  CONSTRAINT unique_url_timestamp UNIQUE (url, timestamp)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_extraction_comparisons_domain ON extraction_comparisons(domain);
CREATE INDEX IF NOT EXISTS idx_extraction_comparisons_difficulty ON extraction_comparisons(difficulty);
CREATE INDEX IF NOT EXISTS idx_extraction_comparisons_created ON extraction_comparisons(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_extraction_comparisons_free_success ON extraction_comparisons(free_success);
CREATE INDEX IF NOT EXISTS idx_extraction_comparisons_paid_success ON extraction_comparisons(paid_success);

-- RLS policies
ALTER TABLE extraction_comparisons ENABLE ROW LEVEL SECURITY;

-- Allow service role full access
CREATE POLICY "Service role has full access to extraction_comparisons"
  ON extraction_comparisons
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Allow anon to read for frontend display
CREATE POLICY "Anon can read extraction_comparisons"
  ON extraction_comparisons
  FOR SELECT
  TO anon
  USING (true);

COMMENT ON TABLE extraction_comparisons IS 'Stores naive vs playwright extraction comparison data for investor metrics and site difficulty classification';
