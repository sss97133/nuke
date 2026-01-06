-- Extend source_site_schemas metadata and add orchestration tables

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'source_site_schemas' AND column_name = 'site_specialization'
  ) THEN
    ALTER TABLE source_site_schemas ADD COLUMN site_specialization TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'source_site_schemas' AND column_name = 'classification_confidence'
  ) THEN
    ALTER TABLE source_site_schemas ADD COLUMN classification_confidence NUMERIC(4,2);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'source_site_schemas' AND column_name = 'image_include_selectors'
  ) THEN
    ALTER TABLE source_site_schemas ADD COLUMN image_include_selectors JSONB DEFAULT '[]'::JSONB;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'source_site_schemas' AND column_name = 'image_exclude_selectors'
  ) THEN
    ALTER TABLE source_site_schemas ADD COLUMN image_exclude_selectors JSONB DEFAULT '[]'::JSONB;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'source_site_schemas' AND column_name = 'pollution_notes'
  ) THEN
    ALTER TABLE source_site_schemas ADD COLUMN pollution_notes JSONB DEFAULT '[]'::JSONB;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'source_site_schemas' AND column_name = 'supplier_references'
  ) THEN
    ALTER TABLE source_site_schemas ADD COLUMN supplier_references JSONB DEFAULT '[]'::JSONB;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'source_site_schemas' AND column_name = 'rarity_notes'
  ) THEN
    ALTER TABLE source_site_schemas ADD COLUMN rarity_notes JSONB DEFAULT '[]'::JSONB;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'source_site_schemas' AND column_name = 'schema_proposals'
  ) THEN
    ALTER TABLE source_site_schemas ADD COLUMN schema_proposals JSONB DEFAULT '[]'::JSONB;
  END IF;
END $$;

-- Job queue for mapper / validator / extraction agents
CREATE TABLE IF NOT EXISTS ingestion_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES businesses(id) ON DELETE SET NULL,
  site_url TEXT,
  job_type TEXT NOT NULL CHECK (
    job_type IN ('mapper', 'validator', 'extraction', 'schema_steward', 'image_qa', 'schema_proposal')
  ),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (
    status IN ('queued', 'running', 'succeeded', 'failed', 'blocked', 'cancelled')
  ),
  attempt INTEGER DEFAULT 0,
  priority INTEGER DEFAULT 5,
  scheduled_for TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  payload JSONB DEFAULT '{}'::JSONB,
  result JSONB DEFAULT '{}'::JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_status ON ingestion_jobs(status);
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_type ON ingestion_jobs(job_type);
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_org ON ingestion_jobs(organization_id);
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_schedule ON ingestion_jobs(scheduled_for) WHERE status = 'queued';

COMMENT ON TABLE ingestion_jobs IS 'Queue of ingestion agent tasks (mapper, validator, extraction, etc.)';

-- Supplier references discovered during mapping
CREATE TABLE IF NOT EXISTS supplier_references (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES businesses(id) ON DELETE SET NULL,
  ingestion_job_id UUID REFERENCES ingestion_jobs(id) ON DELETE SET NULL,
  source_domain TEXT NOT NULL,
  source_url TEXT,
  supplier_name TEXT NOT NULL,
  supplier_domain TEXT,
  supplier_url TEXT,
  role TEXT,
  context_snippet TEXT,
  confidence NUMERIC(4,2),
  status TEXT DEFAULT 'new' CHECK (status IN ('new', 'in_review', 'linked', 'dismissed')),
  linked_organization_id UUID REFERENCES businesses(id) ON DELETE SET NULL,
  metadata JSONB DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_supplier_refs_org ON supplier_references(organization_id);
CREATE INDEX IF NOT EXISTS idx_supplier_refs_supplier_domain ON supplier_references(supplier_domain);
CREATE INDEX IF NOT EXISTS idx_supplier_refs_status ON supplier_references(status);

COMMENT ON TABLE supplier_references IS 'Mentions of suppliers/partners discovered on source sites (awaiting linkage)';

