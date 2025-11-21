-- VIFF schema shim
-- Ensures supabase db reset / seed scripts can run even if the canonical migration
-- has not been executed yet (e.g., during local bootstrap). All statements are
-- defensive (IF NOT EXISTS) so repeated executions are safe.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'image_asset_source_type') THEN
    CREATE TYPE image_asset_source_type AS ENUM ('upload','bat_import','dropbox','scraper','system','legacy');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'image_fact_type') THEN
    CREATE TYPE image_fact_type AS ENUM ('component','damage','document','measurement','person','tool','instruction','environment','anomaly');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'image_fact_consumer') THEN
    CREATE TYPE image_fact_consumer AS ENUM ('valuation','timeline','commerce','safety','user_display');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'image_fact_state') THEN
    CREATE TYPE image_fact_state AS ENUM ('pending','approved','rejected','escalated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'image_fact_batch_status') THEN
    CREATE TYPE image_fact_batch_status AS ENUM ('queued','running','failed','completed');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS image_fact_questions (
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

CREATE TABLE IF NOT EXISTS vehicle_image_assets (
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

CREATE TABLE IF NOT EXISTS vehicle_image_fact_batches (
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

CREATE TABLE IF NOT EXISTS vehicle_image_facts (
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

CREATE TABLE IF NOT EXISTS vehicle_fact_runs (
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

CREATE TABLE IF NOT EXISTS image_fact_confidence (
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

CREATE TABLE IF NOT EXISTS image_fact_links (
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

CREATE TABLE IF NOT EXISTS image_fact_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fact_id UUID NOT NULL REFERENCES vehicle_image_facts(id) ON DELETE CASCADE,
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  reviewer_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  decision TEXT NOT NULL CHECK (decision IN ('approve','reject','needs_more')),
  notes TEXT,
  source_view TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS financial_readiness_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  valuation_id UUID REFERENCES vehicle_valuations(id) ON DELETE SET NULL,
  readiness_score INTEGER NOT NULL DEFAULT 0 CHECK (readiness_score BETWEEN 0 AND 100),
  missing_items TEXT[] NOT NULL DEFAULT '{}',
  details JSONB,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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

