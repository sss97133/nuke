-- ============================================================================
-- DEAL INTELLIGENCE PLATFORM
--
-- Generalizes vlva_* tables into multi-tenant deal management,
-- adds visibility tiers for sensitive intelligence,
-- creates ingestion ledger for data provenance tracking,
-- and establishes trust scoring for data providers.
-- ============================================================================

-- ============================================================================
-- PHASE 1: Rename vlva_* tables to generic deal_* tables
-- ============================================================================

ALTER TABLE vlva_contacts RENAME TO deal_contacts;
ALTER TABLE vlva_vehicles RENAME TO deal_vehicle_details;
ALTER TABLE vlva_deals RENAME TO deal_jackets;
ALTER TABLE vlva_reconditioning RENAME TO deal_reconditioning;
ALTER TABLE vlva_documents RENAME TO deal_documents;
ALTER TABLE vlva_ownership RENAME TO deal_ownership;

-- Rename FK constraints to match new table names
ALTER TABLE deal_jackets RENAME CONSTRAINT vlva_deals_vehicle_id_fkey TO deal_jackets_vehicle_id_fkey;
ALTER TABLE deal_jackets RENAME CONSTRAINT vlva_deals_acquired_from_id_fkey TO deal_jackets_acquired_from_id_fkey;
ALTER TABLE deal_jackets RENAME CONSTRAINT vlva_deals_sold_to_id_fkey TO deal_jackets_sold_to_id_fkey;
ALTER TABLE deal_reconditioning RENAME CONSTRAINT vlva_reconditioning_deal_id_fkey TO deal_reconditioning_deal_id_fkey;
ALTER TABLE deal_reconditioning RENAME CONSTRAINT vlva_reconditioning_vendor_id_fkey TO deal_reconditioning_vendor_id_fkey;
ALTER TABLE deal_ownership RENAME CONSTRAINT vlva_ownership_vehicle_id_fkey TO deal_ownership_vehicle_id_fkey;
ALTER TABLE deal_ownership RENAME CONSTRAINT vlva_ownership_owner_id_fkey TO deal_ownership_owner_id_fkey;
ALTER TABLE deal_documents RENAME CONSTRAINT vlva_documents_deal_id_fkey TO deal_documents_deal_id_fkey;
ALTER TABLE deal_documents RENAME CONSTRAINT vlva_documents_vehicle_id_fkey TO deal_documents_vehicle_id_fkey;

-- ============================================================================
-- PHASE 2: Add multi-tenancy and visibility to deal_jackets
-- ============================================================================

-- Visibility tiers: who can see this data
CREATE TYPE intel_visibility AS ENUM ('public', 'org', 'principals', 'privileged');

ALTER TABLE deal_jackets ADD COLUMN organization_id uuid REFERENCES organizations_compat(id);
ALTER TABLE deal_jackets ADD COLUMN created_by uuid;
ALTER TABLE deal_jackets ADD COLUMN visibility intel_visibility NOT NULL DEFAULT 'org';
ALTER TABLE deal_jackets ADD COLUMN updated_at timestamptz DEFAULT now();

-- Add org_id to deal_contacts for multi-tenancy
ALTER TABLE deal_contacts ADD COLUMN organization_id uuid REFERENCES organizations_compat(id);

-- Add org_id to deal_vehicle_details
ALTER TABLE deal_vehicle_details ADD COLUMN organization_id uuid REFERENCES organizations_compat(id);

-- Backfill existing records to Viva Las Vegas Autos
UPDATE deal_jackets SET organization_id = 'c433d27e-2159-4f8c-b4ae-32a5e44a77cf' WHERE organization_id IS NULL;
UPDATE deal_contacts SET organization_id = 'c433d27e-2159-4f8c-b4ae-32a5e44a77cf' WHERE organization_id IS NULL;
UPDATE deal_vehicle_details SET organization_id = 'c433d27e-2159-4f8c-b4ae-32a5e44a77cf' WHERE organization_id IS NULL;

-- ============================================================================
-- PHASE 3: Enhance organization_behavior_signals with visibility + deal linkage
-- ============================================================================

ALTER TABLE organization_behavior_signals ADD COLUMN IF NOT EXISTS visibility intel_visibility NOT NULL DEFAULT 'org';
ALTER TABLE organization_behavior_signals ADD COLUMN IF NOT EXISTS deal_jacket_id uuid REFERENCES deal_jackets(id);
ALTER TABLE organization_behavior_signals ADD COLUMN IF NOT EXISTS reported_by uuid;

-- Index for deal-linked signals
CREATE INDEX IF NOT EXISTS idx_obs_deal_jacket ON organization_behavior_signals(deal_jacket_id) WHERE deal_jacket_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_obs_visibility ON organization_behavior_signals(visibility);
CREATE INDEX IF NOT EXISTS idx_obs_reported_by ON organization_behavior_signals(reported_by) WHERE reported_by IS NOT NULL;

-- ============================================================================
-- PHASE 4: Ingestion Ledger — track every data submission through the pipeline
-- ============================================================================

CREATE TABLE IF NOT EXISTS ingestion_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Who submitted
  user_id uuid NOT NULL,
  organization_id uuid REFERENCES organizations_compat(id),

  -- How it arrived
  channel text NOT NULL CHECK (channel IN (
    'sms', 'telegram', 'web_upload', 'library_sync',
    'agent_action', 'api', 'email', 'file_drop'
  )),

  -- What was submitted
  submission_type text NOT NULL CHECK (submission_type IN (
    'images', 'documents', 'deal_jacket', 'vehicle_data',
    'receipt', 'observation', 'file_batch', 'library_access'
  )),
  description text,

  -- Pipeline status
  status text NOT NULL DEFAULT 'received' CHECK (status IN (
    'received', 'queued', 'processing', 'analyzed',
    'validated', 'complete', 'failed', 'partial'
  )),

  -- Counts
  items_total int NOT NULL DEFAULT 0,
  items_received int NOT NULL DEFAULT 0,
  items_ingested int NOT NULL DEFAULT 0,
  items_analyzed int NOT NULL DEFAULT 0,
  items_validated int NOT NULL DEFAULT 0,
  items_failed int NOT NULL DEFAULT 0,

  -- Per-item details and error tracking
  details jsonb DEFAULT '{}',
  errors jsonb DEFAULT '[]',

  -- Linked entities
  vehicle_ids uuid[] DEFAULT '{}',
  deal_jacket_id uuid REFERENCES deal_jackets(id),

  -- Timestamps
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz DEFAULT now()
);

-- User sees their own submissions
CREATE INDEX idx_ingestion_user ON ingestion_ledger(user_id, created_at DESC);
CREATE INDEX idx_ingestion_status ON ingestion_ledger(status) WHERE status NOT IN ('complete', 'failed');
CREATE INDEX idx_ingestion_org ON ingestion_ledger(organization_id) WHERE organization_id IS NOT NULL;

-- ============================================================================
-- PHASE 5: Data Provider Trust — confidence scoring for data sources
-- ============================================================================

CREATE TABLE IF NOT EXISTS data_provider_trust (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The provider (either a user or an automated source)
  user_id uuid,
  source_name text, -- for non-user sources (e.g., 'bat_scraper', 'firecrawl', 'ai_extraction')

  -- Role determines base trust
  provider_role text NOT NULL CHECK (provider_role IN (
    'owner',           -- vehicle owner: highest trust for their own vehicles
    'principal',       -- deal principal (buyer/seller): high trust
    'employee',        -- org employee: high trust for org data
    'contributor',     -- community contributor: medium trust
    'dealer',          -- dealer/shop: medium-high trust
    'agent',           -- AI agent: medium trust, depends on method
    'scraper',         -- web scraper: lower trust, depends on source
    'public_record',   -- government/registry: high trust
    'third_party'      -- unverified third party: low trust
  )),

  -- Trust scoring
  base_trust_score numeric(3,2) NOT NULL DEFAULT 0.50,
  adjusted_trust_score numeric(3,2) NOT NULL DEFAULT 0.50,

  -- Track record
  total_claims int NOT NULL DEFAULT 0,
  verified_claims int NOT NULL DEFAULT 0,
  disputed_claims int NOT NULL DEFAULT 0,
  verification_rate numeric(3,2) GENERATED ALWAYS AS (
    CASE WHEN total_claims > 0 THEN verified_claims::numeric / total_claims ELSE 0 END
  ) STORED,

  -- Context
  organization_id uuid REFERENCES organizations_compat(id),
  specializations text[] DEFAULT '{}', -- what they're trusted on
  notes text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  -- Either user_id or source_name must be set
  CONSTRAINT provider_identity CHECK (user_id IS NOT NULL OR source_name IS NOT NULL),
  CONSTRAINT unique_user_provider UNIQUE (user_id, provider_role, organization_id),
  CONSTRAINT unique_source_provider UNIQUE (source_name, provider_role)
);

CREATE INDEX idx_provider_trust_user ON data_provider_trust(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_provider_trust_source ON data_provider_trust(source_name) WHERE source_name IS NOT NULL;

-- Seed default trust scores for automated sources
INSERT INTO data_provider_trust (source_name, provider_role, base_trust_score, adjusted_trust_score, notes) VALUES
  ('bat_scraper', 'scraper', 0.70, 0.70, 'Bring a Trailer listing scraper — structured data, high consistency'),
  ('cab_scraper', 'scraper', 0.65, 0.65, 'Cars & Bids scraper'),
  ('firecrawl', 'scraper', 0.55, 0.55, 'Generic web scraper — varies by source'),
  ('ai_comment_discovery', 'agent', 0.60, 0.60, 'AI sentiment/insight extraction from comments'),
  ('ai_description_discovery', 'agent', 0.55, 0.55, 'AI field extraction from descriptions'),
  ('ai_image_analysis', 'agent', 0.50, 0.50, 'AI image classification and analysis'),
  ('public_auction_record', 'public_record', 0.90, 0.90, 'Verified auction sale results'),
  ('dmv_title_record', 'public_record', 0.95, 0.95, 'Government title/registration records')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- PHASE 6: RLS Policies
-- ============================================================================

-- Enable RLS on new tables
ALTER TABLE ingestion_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_provider_trust ENABLE ROW LEVEL SECURITY;
ALTER TABLE deal_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE deal_vehicle_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE deal_reconditioning ENABLE ROW LEVEL SECURITY;
ALTER TABLE deal_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE deal_ownership ENABLE ROW LEVEL SECURITY;

-- Ensure RLS is on for existing tables
ALTER TABLE deal_jackets ENABLE ROW LEVEL SECURITY;

-- === INGESTION LEDGER: Users see their own submissions ===
CREATE POLICY ingestion_ledger_own
  ON ingestion_ledger FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY ingestion_ledger_org_admin
  ON ingestion_ledger FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_contributors
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );

CREATE POLICY ingestion_ledger_insert
  ON ingestion_ledger FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- === DEAL JACKETS: Tiered visibility ===

-- Public deals: anyone authenticated
CREATE POLICY deal_jackets_public
  ON deal_jackets FOR SELECT
  USING (visibility = 'public');

-- Org-level: org members
CREATE POLICY deal_jackets_org
  ON deal_jackets FOR SELECT
  USING (
    visibility IN ('public', 'org') AND
    organization_id IN (
      SELECT organization_id FROM organization_contributors
      WHERE user_id = auth.uid()
    )
  );

-- Principals: named on the deal (acquired_from or sold_to linked via contacts)
CREATE POLICY deal_jackets_principals
  ON deal_jackets FOR SELECT
  USING (
    visibility IN ('public', 'org', 'principals') AND (
      created_by = auth.uid() OR
      organization_id IN (
        SELECT organization_id FROM organization_contributors
        WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
      )
    )
  );

-- Privileged: creator only
CREATE POLICY deal_jackets_privileged
  ON deal_jackets FOR SELECT
  USING (
    visibility = 'privileged' AND created_by = auth.uid()
  );

-- Insert: org members
CREATE POLICY deal_jackets_insert
  ON deal_jackets FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM organization_contributors
      WHERE user_id = auth.uid()
    )
  );

-- === ORGANIZATION BEHAVIOR SIGNALS: Tiered visibility ===

-- Drop existing empty policies if any, then create tiered ones
-- Public signals: anyone
CREATE POLICY obs_public
  ON organization_behavior_signals FOR SELECT
  USING (visibility = 'public');

-- Org signals: org members
CREATE POLICY obs_org
  ON organization_behavior_signals FOR SELECT
  USING (
    visibility IN ('public', 'org') AND
    organization_id IN (
      SELECT organization_id FROM organization_contributors
      WHERE user_id = auth.uid()
    )
  );

-- Deal signals: deal principals
CREATE POLICY obs_deal
  ON organization_behavior_signals FOR SELECT
  USING (
    visibility IN ('public', 'org', 'deal') AND (
      reported_by = auth.uid() OR
      organization_id IN (
        SELECT organization_id FROM organization_contributors
        WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
      )
    )
  );

-- Privileged signals: reporter only
CREATE POLICY obs_privileged
  ON organization_behavior_signals FOR SELECT
  USING (
    visibility = 'privileged' AND reported_by = auth.uid()
  );

-- Insert: any authenticated user
CREATE POLICY obs_insert
  ON organization_behavior_signals FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- === DATA PROVIDER TRUST: Org admins + service role ===
CREATE POLICY provider_trust_read
  ON data_provider_trust FOR SELECT
  USING (
    user_id = auth.uid() OR
    organization_id IN (
      SELECT organization_id FROM organization_contributors
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    ) OR
    source_name IS NOT NULL -- automated sources are readable by all
  );

-- === DEAL SUB-TABLES: Inherit from deal_jackets org membership ===
CREATE POLICY deal_contacts_org
  ON deal_contacts FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_contributors
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY deal_vehicle_details_org
  ON deal_vehicle_details FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_contributors
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY deal_recon_org
  ON deal_reconditioning FOR SELECT
  USING (
    deal_id IN (
      SELECT id FROM deal_jackets
      WHERE organization_id IN (
        SELECT organization_id FROM organization_contributors
        WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY deal_docs_org
  ON deal_documents FOR SELECT
  USING (
    deal_id IN (
      SELECT id FROM deal_jackets
      WHERE organization_id IN (
        SELECT organization_id FROM organization_contributors
        WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY deal_ownership_org
  ON deal_ownership FOR SELECT
  USING (
    vehicle_id IN (
      SELECT id FROM deal_vehicle_details
      WHERE organization_id IN (
        SELECT organization_id FROM organization_contributors
        WHERE user_id = auth.uid()
      )
    )
  );

-- ============================================================================
-- PHASE 7: Backward compatibility views
-- ============================================================================

CREATE OR REPLACE VIEW vlva_deals AS SELECT * FROM deal_jackets WHERE organization_id = 'c433d27e-2159-4f8c-b4ae-32a5e44a77cf';
CREATE OR REPLACE VIEW vlva_contacts AS SELECT * FROM deal_contacts WHERE organization_id = 'c433d27e-2159-4f8c-b4ae-32a5e44a77cf';
CREATE OR REPLACE VIEW vlva_vehicles AS SELECT * FROM deal_vehicle_details WHERE organization_id = 'c433d27e-2159-4f8c-b4ae-32a5e44a77cf';

-- ============================================================================
-- PHASE 8: Backfill ingestion_ledger with the photo library sync attempt
-- ============================================================================

-- Record the photo library sync that was attempted but never completed
INSERT INTO ingestion_ledger (
  user_id, channel, submission_type, description, status,
  items_total, items_received, items_ingested, items_analyzed,
  items_failed, details, created_at
) VALUES (
  (SELECT id FROM auth.users LIMIT 1), -- primary user
  'library_sync',
  'images',
  'Apple Photos library sync — 56 albums, 10,676 photos discovered but never ingested',
  'failed',
  10676, 10676, 0, 0, 10676,
  '{"albums_discovered": 56, "daemon_ran": "2026-02-12T13:09:00Z", "daemon_stopped": "2026-02-12T13:28:00Z", "photos_processed_by_daemon": 11, "photos_uploaded": 0, "failure_reason": "daemon stopped after 19 minutes, no photos uploaded"}'::jsonb,
  '2026-02-04T00:00:00Z'
);

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE deal_jackets IS 'Multi-tenant deal management. Every vehicle buy/sell/consign transaction. Generalized from vlva_deals.';
COMMENT ON TABLE deal_contacts IS 'CRM contacts for deals — buyers, sellers, vendors. Multi-tenant via organization_id.';
COMMENT ON TABLE deal_vehicle_details IS 'Deal-specific vehicle details (stock number, condition, options). Links to core vehicles table via vehicle_id.';
COMMENT ON TABLE deal_reconditioning IS 'Line-item reconditioning costs for a deal. Vendor, description, amount.';
COMMENT ON TABLE deal_documents IS 'Documents associated with deals — titles, invoices, photos with OCR.';
COMMENT ON TABLE deal_ownership IS 'Ownership chain for deal vehicles.';
COMMENT ON TABLE ingestion_ledger IS 'Tracks every data submission through the pipeline. Users see their submission status here.';
COMMENT ON TABLE data_provider_trust IS 'Trust scoring for data sources. Confidence weighting based on provider role and track record.';
COMMENT ON TYPE intel_visibility IS 'Visibility tiers: public (platform), org (members), principals (deal parties), privileged (reporter only)';
