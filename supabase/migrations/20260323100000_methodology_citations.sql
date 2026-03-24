-- =============================================================================
-- METHODOLOGY CITATIONS — EPISTEMOLOGICAL FOUNDATION
-- =============================================================================
-- Papers that justify HOW we qualify data, not WHAT the data says.
-- A cited epistemology: every trust score, confidence decay, and agent routing
-- decision traces back to published research.
--
-- The ZEH paper (Sato 2026) is the first entry: it formalizes why tiered
-- agent routing exists, why multi-model jury works, and why extraction
-- confidence must decay with task complexity.
--
-- Papers have half-lives too. A 2024 benchmark paper loses relevance when
-- the models it tested are superseded. We track that.
-- =============================================================================

-- ============================================
-- 1. THE PAPERS THEMSELVES
-- ============================================
CREATE TABLE IF NOT EXISTS methodology_references (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity
  doi text UNIQUE,                          -- e.g. '10.48550/arXiv.2601.15714'
  arxiv_id text,                            -- e.g. '2601.15714'
  title text NOT NULL,
  authors text[] NOT NULL,
  publication_year int NOT NULL,
  journal_or_venue text,                    -- e.g. 'arXiv preprint', 'NeurIPS 2026'
  url text,                                 -- canonical link
  subject_areas text[],                     -- e.g. ['cs.LG', 'cs.AI', 'cs.CL']

  -- What it says (our interpretation, not reproduction)
  abstract_summary text NOT NULL,           -- 1-2 sentence distillation (NOT the abstract itself)
  key_metric text,                          -- the measurable concept introduced (e.g. 'Zero-Error Horizon')
  key_finding text NOT NULL,                -- the core claim in our words

  -- Relevance decay
  published_at date NOT NULL,
  relevance_half_life_days int NOT NULL DEFAULT 730,  -- how fast this paper's claims decay (default 2yr)
  superseded_by uuid REFERENCES methodology_references(id),
  superseded_at timestamptz,
  relevance_notes text,                     -- why decay rate was chosen

  -- Status
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded', 'retracted', 'archived')),

  -- Housekeeping
  added_by text DEFAULT 'system',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

COMMENT ON TABLE methodology_references IS 'Academic papers cited as epistemological foundation for data quality methodology. Not vehicle data — methodology data.';
COMMENT ON COLUMN methodology_references.relevance_half_life_days IS 'Days until this papers claims lose 50% relevance. Model benchmark papers decay fast (~365d). Theoretical frameworks decay slow (~1825d).';
COMMENT ON COLUMN methodology_references.key_metric IS 'The measurable concept introduced by the paper that we adopt as a platform metric.';

-- ============================================
-- 2. MEASURABLE BENCHMARKS FROM PAPERS
-- ============================================
-- A paper introduces a concept (ZEH). We measure it against our pipeline.
-- Each row is ONE measurement at ONE point in time.
CREATE TABLE IF NOT EXISTS methodology_benchmarks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_id uuid NOT NULL REFERENCES methodology_references(id) ON DELETE CASCADE,

  -- What we're measuring
  metric_name text NOT NULL,                -- e.g. 'zero_error_horizon'
  task_type text NOT NULL,                  -- e.g. 'vin_extraction', 'price_extraction', 'condition_assessment'
  model_id text NOT NULL,                   -- e.g. 'claude-haiku-4-5', 'claude-sonnet-4-6', 'gemini-2.0-flash'

  -- The measurement
  measured_value numeric,                   -- the ZEH score, accuracy threshold, etc.
  unit text,                                -- e.g. 'characters', 'fields', 'tokens', 'pct'
  measurement_context jsonb DEFAULT '{}',   -- sample size, conditions, edge cases
  measured_at timestamptz NOT NULL DEFAULT now(),

  -- Comparison to paper's claims
  paper_reported_value numeric,             -- what the paper found for this model/task
  delta_from_paper numeric,                 -- our measurement minus paper's
  notes text,                               -- interpretation

  created_at timestamptz DEFAULT now()
);

COMMENT ON TABLE methodology_benchmarks IS 'Concrete measurements of metrics introduced by cited papers, applied to our extraction pipeline. Tracked over time to show improvement.';
COMMENT ON COLUMN methodology_benchmarks.task_type IS 'Maps to extraction pipeline tasks: vin_extraction, price_extraction, ym_parsing, condition_assessment, trim_forensics, comment_sentiment, etc.';

CREATE INDEX idx_benchmarks_reference ON methodology_benchmarks(reference_id);
CREATE INDEX idx_benchmarks_task_model ON methodology_benchmarks(task_type, model_id);
CREATE INDEX idx_benchmarks_measured_at ON methodology_benchmarks(measured_at DESC);

-- ============================================
-- 3. HOW PAPERS MAP TO PLATFORM DECISIONS
-- ============================================
-- Each row says: "this paper justifies this design decision"
CREATE TABLE IF NOT EXISTS methodology_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_id uuid NOT NULL REFERENCES methodology_references(id) ON DELETE CASCADE,

  -- What it justifies
  platform_component text NOT NULL,         -- e.g. 'agent_tier_router', 'multi_model_jury', 'confidence_decay'
  design_decision text NOT NULL,            -- e.g. 'Route simple extractions to Haiku, complex to Sonnet'
  rationale text NOT NULL,                  -- e.g. 'Haiku ZEH for structured fields exceeds task complexity threshold'

  -- Where in the codebase
  implementation_refs text[],               -- file paths or function names
  db_objects text[],                        -- tables/columns affected

  -- Classification
  category text NOT NULL CHECK (category IN (
    'extraction_routing',      -- which model handles which task
    'confidence_scoring',      -- how we score extraction confidence
    'trust_hierarchy',         -- source trust levels
    'verification_protocol',   -- multi-model jury, blind/contextual passes
    'decay_model',             -- half-life and freshness calculations
    'quality_threshold',       -- minimum quality bars
    'provenance_tracking',     -- how we track evidence chains
    'human_in_loop'            -- when to escalate to human review
  )),

  created_at timestamptz DEFAULT now()
);

COMMENT ON TABLE methodology_applications IS 'Maps academic findings to specific platform design decisions. The cited reason a component exists or behaves the way it does.';

CREATE INDEX idx_applications_reference ON methodology_applications(reference_id);
CREATE INDEX idx_applications_component ON methodology_applications(platform_component);
CREATE INDEX idx_applications_category ON methodology_applications(category);

-- ============================================
-- 4. COMPUTED: CURRENT RELEVANCE SCORE
-- ============================================
-- Relevance decays exponentially from published_at using half_life
CREATE OR REPLACE FUNCTION methodology_relevance_score(ref methodology_references)
RETURNS numeric
LANGUAGE sql STABLE
AS $$
  SELECT CASE
    WHEN ref.status = 'retracted' THEN 0
    WHEN ref.status = 'superseded' THEN
      -- Superseded papers retain 25% max relevance (historical value)
      LEAST(25, (100 * power(0.5, extract(epoch FROM (now() - ref.published_at)) / (ref.relevance_half_life_days * 86400)))::numeric)
    ELSE
      (100 * power(0.5, extract(epoch FROM (now() - ref.published_at)) / (ref.relevance_half_life_days * 86400)))::numeric
  END
$$;

COMMENT ON FUNCTION methodology_relevance_score IS 'Exponential decay of paper relevance. Returns 0-100. Superseded papers cap at 25.';

-- ============================================
-- 5. VIEW: ACTIVE METHODOLOGY WITH RELEVANCE
-- ============================================
CREATE OR REPLACE VIEW methodology_active AS
SELECT
  r.id,
  r.title,
  r.authors,
  r.key_metric,
  r.key_finding,
  r.published_at,
  r.relevance_half_life_days,
  r.status,
  methodology_relevance_score(r)::numeric(5,1) AS relevance_pct,
  (SELECT count(*) FROM methodology_applications a WHERE a.reference_id = r.id) AS application_count,
  (SELECT count(*) FROM methodology_benchmarks b WHERE b.reference_id = r.id) AS benchmark_count,
  r.url
FROM methodology_references r
WHERE r.status IN ('active', 'superseded')
ORDER BY methodology_relevance_score(r) DESC;

-- ============================================
-- 6. VIEW: BENCHMARK TIMELINE
-- ============================================
CREATE OR REPLACE VIEW methodology_benchmark_timeline AS
SELECT
  b.id,
  r.title AS paper_title,
  r.key_metric,
  b.metric_name,
  b.task_type,
  b.model_id,
  b.measured_value,
  b.unit,
  b.paper_reported_value,
  b.delta_from_paper,
  b.measured_at,
  methodology_relevance_score(r)::numeric(5,1) AS paper_relevance_pct
FROM methodology_benchmarks b
JOIN methodology_references r ON r.id = b.reference_id
ORDER BY b.measured_at DESC;

-- ============================================
-- 7. ADD TO TRUST HIERARCHY
-- ============================================
INSERT INTO data_source_trust_hierarchy (source_type, trust_level, override_rules, description)
VALUES
  ('peer_reviewed_paper', 90, ARRAY['methodology_only'], 'Peer-reviewed academic paper — informs methodology, not vehicle data'),
  ('preprint_paper', 80, ARRAY['methodology_only'], 'arXiv preprint — not yet peer-reviewed but citable'),
  ('industry_standard', 95, ARRAY['specifications'], 'SAE/ISO/NHTSA standard — authoritative specification'),
  ('technical_service_bulletin', 85, ARRAY['procedures', 'known_issues'], 'OEM technical service bulletin — manufacturer-issued')
ON CONFLICT (source_type) DO NOTHING;

-- ============================================
-- 8. SEED: ZEH PAPER (first methodology reference)
-- ============================================
INSERT INTO methodology_references (
  doi, arxiv_id, title, authors, publication_year, journal_or_venue, url,
  subject_areas, abstract_summary, key_metric, key_finding,
  published_at, relevance_half_life_days, relevance_notes, added_by
) VALUES (
  '10.48550/arXiv.2601.15714',
  '2601.15714',
  'Even GPT-5.2 Can''t Count to Five: The Case for Zero-Error Horizons in Trustworthy LLMs',
  ARRAY['Ryoma Sato'],
  2026,
  'arXiv preprint',
  'https://arxiv.org/abs/2601.15714',
  ARRAY['cs.LG', 'cs.AI', 'cs.CL'],
  'Introduces Zero-Error Horizon (ZEH) as a trustworthiness metric — the maximum input complexity at which a model produces zero errors on algorithmic tasks.',
  'Zero-Error Horizon (ZEH)',
  'LLMs fail at trivially small input sizes on deterministic tasks (parity, bracket matching). Accuracy metrics mask this — ZEH exposes the true reliability boundary. Even frontier models cannot be trusted for exact computation beyond very short inputs.',
  '2026-01-22',
  548,  -- ~1.5yr: model benchmark papers decay faster as new models ship
  'Model benchmark paper. Half-life set to 1.5yr because the specific model results (GPT-5.2 ZEH values) become less relevant as newer models ship, but the ZEH framework itself is durable.',
  'skylar'
);

-- ============================================
-- 9. SEED: ZEH APPLICATIONS TO NUKE PLATFORM
-- ============================================
-- Get the ZEH paper ID for FK references
DO $$
DECLARE
  zeh_id uuid;
BEGIN
  SELECT id INTO zeh_id FROM methodology_references WHERE arxiv_id = '2601.15714';

  -- Application 1: Agent tier routing
  INSERT INTO methodology_applications (reference_id, platform_component, design_decision, rationale, implementation_refs, db_objects, category)
  VALUES (
    zeh_id,
    'agent_tier_router',
    'Route extraction tasks by complexity: Haiku for structured/simple fields, Sonnet for ambiguous/complex, Opus for strategy',
    'Each model has a different ZEH per task type. Routing by complexity keeps tasks within each models zero-error horizon. Haiku reliably extracts year/make/model (low ZEH required). Sonnet handles trim forensics and condition assessment (higher ZEH needed). Opus handles multi-source reconciliation (highest complexity).',
    ARRAY['supabase/functions/agent-tier-router/index.ts', 'supabase/functions/haiku-extraction-worker/index.ts', 'supabase/functions/sonnet-supervisor/index.ts', '_shared/agentTiers.ts'],
    ARRAY['import_queue.processing_status', 'field_evidence.source_confidence'],
    'extraction_routing'
  );

  -- Application 2: Multi-model jury
  INSERT INTO methodology_applications (reference_id, platform_component, design_decision, rationale, implementation_refs, db_objects, category)
  VALUES (
    zeh_id,
    'multi_model_jury',
    'Hand same schema + source material to multiple models. Consensus = high confidence. Divergence = flag for review.',
    'ZEH differs across model families. Where Model A fails (beyond its ZEH), Model B may succeed, and vice versa. Agreement between models with different failure modes produces higher confidence than any single models output. Disagreement is itself a signal that the task is near or beyond ZEH boundaries.',
    ARRAY['digital-twin-architecture.md'],
    ARRAY['field_evidence.supporting_signals', 'field_evidence.contradicting_signals'],
    'verification_protocol'
  );

  -- Application 3: Confidence scoring with complexity awareness
  INSERT INTO methodology_applications (reference_id, platform_component, design_decision, rationale, implementation_refs, db_objects, category)
  VALUES (
    zeh_id,
    'field_evidence_confidence',
    'AI extraction confidence inversely correlated with task complexity. Simple structured fields get higher base confidence than complex inferential ones.',
    'ZEH shows accuracy is misleading — a model can score 95% overall while failing 100% beyond a complexity threshold. Source_confidence on field_evidence must account for WHERE in the ZEH curve the extraction task falls. VIN extraction (short, structured) gets higher AI confidence than condition narrative interpretation (long, unstructured).',
    ARRAY['supabase/functions/haiku-extraction-worker/index.ts', '_shared/agentTiers.ts'],
    ARRAY['field_evidence.source_confidence', 'data_source_trust_hierarchy'],
    'confidence_scoring'
  );

  -- Application 4: Testimony half-life calibration
  INSERT INTO methodology_applications (reference_id, platform_component, design_decision, rationale, implementation_refs, db_objects, category)
  VALUES (
    zeh_id,
    'testimony_half_life',
    'Extraction confidence decays faster for tasks near the models ZEH boundary. Simple field extractions retain confidence longer than complex inferential ones.',
    'ZEH is not static — it shifts with model updates, prompt engineering, and fine-tuning. An extraction performed at the boundary of a models ZEH in January may be well within a newer models ZEH by June. The half-life of extraction confidence should be shorter for boundary-complexity tasks and longer for well-within-horizon tasks.',
    ARRAY['extraction-vision-strategy.md'],
    ARRAY['field_evidence.source_confidence', 'field_evidence.extracted_at'],
    'decay_model'
  );

  -- Application 5: Human-in-the-loop escalation threshold
  INSERT INTO methodology_applications (reference_id, platform_component, design_decision, rationale, implementation_refs, db_objects, category)
  VALUES (
    zeh_id,
    'human_escalation_threshold',
    'Tasks estimated to be near or beyond model ZEH automatically escalate to human review instead of producing low-confidence AI output.',
    'ZEH provides a principled cutoff: if a task type has been measured to be near the models zero-error horizon, dont attempt automated extraction — flag for human review. This prevents the pipeline from confidently producing wrong answers on tasks the model cannot reliably solve.',
    ARRAY['supabase/functions/sonnet-supervisor/index.ts', 'supabase/functions/agent-tier-router/index.ts'],
    ARRAY['import_queue.processing_status', 'field_evidence.status'],
    'human_in_loop'
  );
END $$;

-- ============================================
-- 10. PIPELINE REGISTRY
-- ============================================
INSERT INTO pipeline_registry (table_name, column_name, owned_by, description, do_not_write_directly)
VALUES
  ('methodology_references', '*', 'manual / methodology-curator', 'Academic papers cited as epistemological foundation', false),
  ('methodology_benchmarks', '*', 'manual / benchmark-runner', 'Measurements of paper metrics against our pipeline', false),
  ('methodology_applications', '*', 'manual / methodology-curator', 'Maps papers to platform design decisions', false)
ON CONFLICT DO NOTHING;

-- ============================================
-- 11. UPDATED_AT TRIGGER
-- ============================================
CREATE OR REPLACE FUNCTION update_methodology_references_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_methodology_references_updated_at
  BEFORE UPDATE ON methodology_references
  FOR EACH ROW EXECUTE FUNCTION update_methodology_references_updated_at();
