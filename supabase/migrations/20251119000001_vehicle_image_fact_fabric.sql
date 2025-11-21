-- Vehicle Image Fact Fabric (VIFF) schema and financial readiness alignment
-- Establishes the fact backbone for image ingestion, guardrail batches, confidence scoring,
-- downstream fact runs, and readiness snapshots tied to valuations.

-- ============================================================================
-- ENUM TYPES
-- ============================================================================
CREATE TYPE image_asset_source_type AS ENUM ('upload','bat_import','dropbox','scraper','system','legacy');
CREATE TYPE image_fact_type AS ENUM ('component','damage','document','measurement','person','tool','instruction','environment','anomaly');
CREATE TYPE image_fact_consumer AS ENUM ('valuation','timeline','commerce','safety','user_display');
CREATE TYPE image_fact_state AS ENUM ('pending','approved','rejected','escalated');
CREATE TYPE image_fact_batch_status AS ENUM ('queued','running','failed','completed');

-- ============================================================================
-- MASTER QUESTION REGISTRY
-- ============================================================================
CREATE TABLE image_fact_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL,
  version TEXT NOT NULL,
  title TEXT,
  prompt JSONB NOT NULL,
  vehicle_filters JSONB,
  follow_up_prompts JSONB,
  required_fields JSONB,
  auto_actions JSONB,
  created_by UUID REFERENCES profiles(id),
  updated_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (slug, version)
);

-- ============================================================================
-- IMAGE ASSET REGISTRY
-- ============================================================================
CREATE TABLE vehicle_image_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  storage_bucket TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  storage_version TEXT,
  source_type image_asset_source_type NOT NULL DEFAULT 'upload',
  uploader_id UUID REFERENCES profiles(id),
  timeline_event_id UUID REFERENCES timeline_events(id) ON DELETE SET NULL,
  captured_at TIMESTAMPTZ,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  device_metadata JSONB,
  gps JSONB,
  area TEXT,
  angle TEXT,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  tags TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending_processing' CHECK (status IN ('pending_processing','processing','processed','archived')),
  original_hash TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- FACT BATCHES
-- ============================================================================
CREATE TABLE vehicle_image_fact_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  asset_ids UUID[] NOT NULL,
  guardrail_version TEXT,
  question_set_id UUID REFERENCES image_fact_questions(id),
  status image_fact_batch_status NOT NULL DEFAULT 'queued',
  queued_reason TEXT,
  queued_by UUID REFERENCES profiles(id),
  processor TEXT,
  processor_instance_id TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_log JSONB,
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- FACTS
-- ============================================================================
CREATE TABLE vehicle_image_facts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  asset_id UUID REFERENCES vehicle_image_assets(id) ON DELETE SET NULL,
  batch_id UUID REFERENCES vehicle_image_fact_batches(id) ON DELETE SET NULL,
  question_id UUID REFERENCES image_fact_questions(id),
  fact_type image_fact_type NOT NULL,
  component_slug TEXT,
  label TEXT,
  answer_text TEXT,
  numeric_value NUMERIC,
  units TEXT,
  bbox JSONB,
  evidence_urls TEXT[] NOT NULL DEFAULT '{}',
  raw_response JSONB,
  ai_model TEXT,
  captured_from TEXT,
  metadata JSONB,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- FACT RUNS / SECOND-PASS ANALYSIS
-- ============================================================================
CREATE TABLE vehicle_fact_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  batch_id UUID REFERENCES vehicle_image_fact_batches(id) ON DELETE SET NULL,
  run_type TEXT NOT NULL,
  input_fact_ids UUID[] NOT NULL DEFAULT '{}',
  output_summary TEXT,
  structured_payload JSONB,
  confidence INTEGER,
  script_version TEXT,
  ran_by TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- FACT CONFIDENCE
-- ============================================================================
CREATE TABLE image_fact_confidence (
  fact_id UUID NOT NULL REFERENCES vehicle_image_facts(id) ON DELETE CASCADE,
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  consumer image_fact_consumer NOT NULL,
  score NUMERIC(4,3) NOT NULL,
  threshold NUMERIC(4,3) NOT NULL,
  state image_fact_state NOT NULL DEFAULT 'pending',
  reviewer_id UUID REFERENCES profiles(id),
  review_notes TEXT,
  locked_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (fact_id, consumer)
);

-- ============================================================================
-- FACT LINKS TO DOWNSTREAM ARTIFACTS
-- ============================================================================
CREATE TABLE image_fact_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fact_id UUID NOT NULL REFERENCES vehicle_image_facts(id) ON DELETE CASCADE,
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  linked_table TEXT NOT NULL,
  linked_id UUID NOT NULL,
  link_reason TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (fact_id, linked_table, linked_id)
);

-- ============================================================================
-- HUMAN REVIEW LOG
-- ============================================================================
CREATE TABLE image_fact_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fact_id UUID NOT NULL REFERENCES vehicle_image_facts(id) ON DELETE CASCADE,
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  reviewer_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  decision TEXT NOT NULL CHECK (decision IN ('approve','reject','needs_more')),
  notes TEXT,
  source_view TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- FINANCIAL READINESS SNAPSHOTS
-- ============================================================================
CREATE TABLE financial_readiness_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  valuation_id UUID REFERENCES vehicle_valuations(id) ON DELETE SET NULL,
  readiness_score INTEGER NOT NULL DEFAULT 0 CHECK (readiness_score BETWEEN 0 AND 100),
  missing_items TEXT[] NOT NULL DEFAULT '{}',
  details JSONB,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- VALUATION ALIGNMENT
-- ============================================================================
ALTER TABLE IF EXISTS vehicle_valuations
  ADD COLUMN IF NOT EXISTS evidence_score INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS required_evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS source_run_id UUID REFERENCES vehicle_fact_runs(id) ON DELETE SET NULL;

ALTER TABLE IF EXISTS vehicle_valuations_components
  ADD COLUMN IF NOT EXISTS fact_id UUID REFERENCES vehicle_image_facts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS fact_confidence NUMERIC(4,3),
  ADD COLUMN IF NOT EXISTS evidence_urls TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS component_condition TEXT,
  ADD COLUMN IF NOT EXISTS valuation_source TEXT NOT NULL DEFAULT 'viff';

-- ============================================================================
-- INDEXES
-- ============================================================================
CREATE INDEX idx_vehicle_image_assets_vehicle_uploaded_at ON vehicle_image_assets(vehicle_id, uploaded_at DESC);
CREATE INDEX idx_vehicle_image_fact_batches_vehicle_status ON vehicle_image_fact_batches(vehicle_id, status);
CREATE INDEX idx_vehicle_image_facts_vehicle_type ON vehicle_image_facts(vehicle_id, fact_type);
CREATE INDEX idx_vehicle_image_facts_component ON vehicle_image_facts(component_slug);
CREATE INDEX idx_image_fact_confidence_vehicle_consumer ON image_fact_confidence(vehicle_id, consumer);
CREATE INDEX idx_image_fact_links_lookup ON image_fact_links(linked_table, linked_id);
CREATE INDEX idx_vehicle_fact_runs_vehicle_type ON vehicle_fact_runs(vehicle_id, run_type);
CREATE INDEX idx_financial_readiness_vehicle_created ON financial_readiness_snapshots(vehicle_id, created_at DESC);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
ALTER TABLE vehicle_image_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_image_fact_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_image_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_fact_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE image_fact_confidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE image_fact_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE image_fact_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE image_fact_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_readiness_snapshots ENABLE ROW LEVEL SECURITY;

-- Helper expression replicated across policies
-- Allows viewers if vehicle is public, owner, uploader, or has active permission

  -- VEHICLE IMAGE ASSETS -----------------------------------------------------
  DROP POLICY IF EXISTS "Vehicle participants can view image assets" ON vehicle_image_assets;
  CREATE POLICY "Vehicle participants can view image assets"
    ON vehicle_image_assets
    FOR SELECT
    USING (
      EXISTS (
        SELECT 1
        FROM vehicles v
        LEFT JOIN vehicle_user_permissions vup
          ON vup.vehicle_id = v.id
         AND vup.user_id = auth.uid()
         AND COALESCE(vup.is_active, true) = true
         AND vup.role = ANY (ARRAY['owner','co_owner','mechanic','appraiser','moderator','contributor','photographer','dealer_rep','sales_agent','restorer','consigner','board_member']::text[])
        WHERE v.id = vehicle_image_assets.vehicle_id
          AND (
            v.is_public = true
            OR auth.uid() = v.user_id
            OR auth.uid() = v.owner_id
            OR auth.uid() = vehicle_image_assets.uploader_id
            OR (vup.user_id IS NOT NULL)
          )
      )
    );

  DROP POLICY IF EXISTS "Vehicle participants can insert image assets" ON vehicle_image_assets;
  CREATE POLICY "Vehicle participants can insert image assets"
    ON vehicle_image_assets
    FOR INSERT
    WITH CHECK (
      auth.uid() = uploader_id
      AND EXISTS (
        SELECT 1
        FROM vehicles v
        LEFT JOIN vehicle_user_permissions vup
          ON vup.vehicle_id = v.id
         AND vup.user_id = auth.uid()
         AND COALESCE(vup.is_active, true) = true
         AND vup.role = ANY (ARRAY['owner','co_owner','mechanic','appraiser','moderator','contributor','photographer','dealer_rep','sales_agent','restorer','consigner','board_member']::text[])
        WHERE v.id = vehicle_image_assets.vehicle_id
          AND (
            v.user_id = auth.uid()
            OR v.owner_id = auth.uid()
            OR vup.user_id IS NOT NULL
          )
      )
    );

  DROP POLICY IF EXISTS "Vehicle participants can update image assets" ON vehicle_image_assets;
  CREATE POLICY "Vehicle participants can update image assets"
    ON vehicle_image_assets
    FOR UPDATE
    USING (
      auth.uid() = uploader_id
      OR EXISTS (
        SELECT 1
        FROM vehicles v
        LEFT JOIN vehicle_user_permissions vup
          ON vup.vehicle_id = v.id
         AND vup.user_id = auth.uid()
         AND COALESCE(vup.is_active, true) = true
         AND vup.role = ANY (ARRAY['owner','co_owner','mechanic','appraiser','moderator','contributor','photographer','dealer_rep','sales_agent','restorer','consigner','board_member']::text[])
        WHERE v.id = vehicle_image_assets.vehicle_id
          AND (
            v.user_id = auth.uid()
            OR v.owner_id = auth.uid()
            OR vup.user_id IS NOT NULL
          )
      )
    )
    WITH CHECK (
      auth.uid() = uploader_id
      OR EXISTS (
        SELECT 1
        FROM vehicles v
        LEFT JOIN vehicle_user_permissions vup
          ON vup.vehicle_id = v.id
         AND vup.user_id = auth.uid()
         AND COALESCE(vup.is_active, true) = true
         AND vup.role = ANY (ARRAY['owner','co_owner','mechanic','appraiser','moderator','contributor','photographer','dealer_rep','sales_agent','restorer','consigner','board_member']::text[])
        WHERE v.id = vehicle_image_assets.vehicle_id
          AND (
            v.user_id = auth.uid()
            OR v.owner_id = auth.uid()
            OR vup.user_id IS NOT NULL
          )
      )
    );

  DROP POLICY IF EXISTS "Vehicle participants can delete image assets" ON vehicle_image_assets;
  CREATE POLICY "Vehicle participants can delete image assets"
    ON vehicle_image_assets
    FOR DELETE
    USING (
      auth.uid() = uploader_id
      OR EXISTS (
        SELECT 1
        FROM vehicles v
        LEFT JOIN vehicle_user_permissions vup
          ON vup.vehicle_id = v.id
         AND vup.user_id = auth.uid()
         AND COALESCE(vup.is_active, true) = true
         AND vup.role = ANY (ARRAY['owner','co_owner','mechanic','appraiser','moderator','contributor','photographer','dealer_rep','sales_agent','restorer','consigner','board_member']::text[])
        WHERE v.id = vehicle_image_assets.vehicle_id
          AND (
            v.user_id = auth.uid()
            OR v.owner_id = auth.uid()
            OR vup.user_id IS NOT NULL
          )
      )
    );

  -- READ-ONLY ACCESS POLICIES FOR FACT TABLES --------------------------------
  DROP POLICY IF EXISTS "Vehicle viewers can read fact batches" ON vehicle_image_fact_batches;
  CREATE POLICY "Vehicle viewers can read fact batches"
    ON vehicle_image_fact_batches
    FOR SELECT
    USING (
      EXISTS (
        SELECT 1
        FROM vehicles v
        LEFT JOIN vehicle_user_permissions vup
          ON vup.vehicle_id = v.id
         AND vup.user_id = auth.uid()
         AND COALESCE(vup.is_active, true) = true
         AND vup.role = ANY (ARRAY['owner','co_owner','mechanic','appraiser','moderator','contributor','photographer','dealer_rep','sales_agent','restorer','consigner','board_member']::text[])
        WHERE v.id = vehicle_image_fact_batches.vehicle_id
          AND (
            v.is_public = true
            OR auth.uid() = v.user_id
            OR auth.uid() = v.owner_id
            OR vup.user_id IS NOT NULL
          )
      )
    );

  DROP POLICY IF EXISTS "Vehicle viewers can read image facts" ON vehicle_image_facts;
  CREATE POLICY "Vehicle viewers can read image facts"
    ON vehicle_image_facts
    FOR SELECT
    USING (
      EXISTS (
        SELECT 1
        FROM vehicles v
        LEFT JOIN vehicle_user_permissions vup
          ON vup.vehicle_id = v.id
         AND vup.user_id = auth.uid()
         AND COALESCE(vup.is_active, true) = true
         AND vup.role = ANY (ARRAY['owner','co_owner','mechanic','appraiser','moderator','contributor','photographer','dealer_rep','sales_agent','restorer','consigner','board_member']::text[])
        WHERE v.id = vehicle_image_facts.vehicle_id
          AND (
            v.is_public = true
            OR auth.uid() = v.user_id
            OR auth.uid() = v.owner_id
            OR vup.user_id IS NOT NULL
          )
      )
    );

  DROP POLICY IF EXISTS "Vehicle viewers can read fact runs" ON vehicle_fact_runs;
  CREATE POLICY "Vehicle viewers can read fact runs"
    ON vehicle_fact_runs
    FOR SELECT
    USING (
      EXISTS (
        SELECT 1
        FROM vehicles v
        LEFT JOIN vehicle_user_permissions vup
          ON vup.vehicle_id = v.id
         AND vup.user_id = auth.uid()
         AND COALESCE(vup.is_active, true) = true
         AND vup.role = ANY (ARRAY['owner','co_owner','mechanic','appraiser','moderator','contributor','photographer','dealer_rep','sales_agent','restorer','consigner','board_member']::text[])
        WHERE v.id = vehicle_fact_runs.vehicle_id
          AND (
            v.is_public = true
            OR auth.uid() = v.user_id
            OR auth.uid() = v.owner_id
            OR vup.user_id IS NOT NULL
          )
      )
    );

  DROP POLICY IF EXISTS "Vehicle viewers can read fact confidence" ON image_fact_confidence;
  CREATE POLICY "Vehicle viewers can read fact confidence"
    ON image_fact_confidence
    FOR SELECT
    USING (
      EXISTS (
        SELECT 1
        FROM vehicles v
        LEFT JOIN vehicle_user_permissions vup
          ON vup.vehicle_id = v.id
         AND vup.user_id = auth.uid()
         AND COALESCE(vup.is_active, true) = true
         AND vup.role = ANY (ARRAY['owner','co_owner','mechanic','appraiser','moderator','contributor','photographer','dealer_rep','sales_agent','restorer','consigner','board_member']::text[])
        WHERE v.id = image_fact_confidence.vehicle_id
          AND (
            v.is_public = true
            OR auth.uid() = v.user_id
            OR auth.uid() = v.owner_id
            OR vup.user_id IS NOT NULL
          )
      )
    );

  DROP POLICY IF EXISTS "Vehicle viewers can read fact links" ON image_fact_links;
  CREATE POLICY "Vehicle viewers can read fact links"
    ON image_fact_links
    FOR SELECT
    USING (
      EXISTS (
        SELECT 1
        FROM vehicles v
        LEFT JOIN vehicle_user_permissions vup
          ON vup.vehicle_id = v.id
         AND vup.user_id = auth.uid()
         AND COALESCE(vup.is_active, true) = true
         AND vup.role = ANY (ARRAY['owner','co_owner','mechanic','appraiser','moderator','contributor','photographer','dealer_rep','sales_agent','restorer','consigner','board_member']::text[])
        WHERE v.id = image_fact_links.vehicle_id
          AND (
            v.is_public = true
            OR auth.uid() = v.user_id
            OR auth.uid() = v.owner_id
            OR vup.user_id IS NOT NULL
          )
      )
    );

  DROP POLICY IF EXISTS "Vehicle viewers can read fact reviews" ON image_fact_reviews;
  CREATE POLICY "Vehicle viewers can read fact reviews"
    ON image_fact_reviews
    FOR SELECT
    USING (
      EXISTS (
        SELECT 1
        FROM vehicles v
        LEFT JOIN vehicle_user_permissions vup
          ON vup.vehicle_id = v.id
         AND vup.user_id = auth.uid()
         AND COALESCE(vup.is_active, true) = true
         AND vup.role = ANY (ARRAY['owner','co_owner','mechanic','appraiser','moderator','contributor','photographer','dealer_rep','sales_agent','restorer','consigner','board_member']::text[])
        WHERE v.id = image_fact_reviews.vehicle_id
          AND (
            v.is_public = true
            OR auth.uid() = v.user_id
            OR auth.uid() = v.owner_id
            OR vup.user_id IS NOT NULL
          )
      )
    );

  DROP POLICY IF EXISTS "Authenticated users can read fact questions" ON image_fact_questions;
  CREATE POLICY "Authenticated users can read fact questions"
    ON image_fact_questions
    FOR SELECT
    USING (auth.uid() IS NOT NULL);

  DROP POLICY IF EXISTS "Vehicle viewers can read readiness snapshots" ON financial_readiness_snapshots;
  CREATE POLICY "Vehicle viewers can read readiness snapshots"
    ON financial_readiness_snapshots
    FOR SELECT
    USING (
      EXISTS (
        SELECT 1
        FROM vehicles v
        LEFT JOIN vehicle_user_permissions vup
          ON vup.vehicle_id = v.id
         AND vup.user_id = auth.uid()
         AND COALESCE(vup.is_active, true) = true
         AND vup.role = ANY (ARRAY['owner','co_owner','mechanic','appraiser','moderator','contributor','photographer','dealer_rep','sales_agent','restorer','consigner','board_member']::text[])
        WHERE v.id = financial_readiness_snapshots.vehicle_id
          AND (
            v.is_public = true
            OR auth.uid() = v.user_id
            OR auth.uid() = v.owner_id
            OR vup.user_id IS NOT NULL
          )
      )
    );

-- Success notice -------------------------------------------------------------
DO $$
BEGIN
  RAISE NOTICE '✅ Vehicle Image Fact Fabric schema installed';
  RAISE NOTICE 'VIFF tables, confidence tracking, and readiness snapshots are ready for ingestion.';
END $$;

