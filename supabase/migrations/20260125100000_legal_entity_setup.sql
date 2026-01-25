-- Legal Entity Setup for SEC Filings
-- Parent company and offering entity management

-- Parent company details
CREATE TABLE IF NOT EXISTS parent_company (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Basic Info
  legal_name TEXT NOT NULL,
  dba_name TEXT,
  entity_type TEXT NOT NULL, -- 'llc', 'series_llc', 'c_corp', 's_corp'

  -- Formation
  state_of_formation TEXT NOT NULL,
  formation_date DATE,
  fiscal_year_end TEXT DEFAULT '12/31',

  -- Tax & Registration
  ein TEXT, -- Federal EIN
  state_tax_id TEXT,
  sec_file_number TEXT, -- Once qualified
  cik_number TEXT, -- SEC CIK

  -- Addresses
  principal_address JSONB DEFAULT '{}',
  mailing_address JSONB DEFAULT '{}',
  registered_agent JSONB DEFAULT '{}',

  -- Contacts
  ceo_name TEXT,
  cfo_name TEXT,
  compliance_officer TEXT,
  contact_email TEXT,
  contact_phone TEXT,

  -- QuickBooks Integration
  quickbooks_realm_id TEXT,
  quickbooks_access_token TEXT,
  quickbooks_refresh_token TEXT,
  quickbooks_token_expires_at TIMESTAMPTZ,
  quickbooks_connected_at TIMESTAMPTZ,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- SEC Filing tracking
CREATE TABLE IF NOT EXISTS sec_filings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_company_id UUID REFERENCES parent_company(id),

  filing_type TEXT NOT NULL, -- 'form_1a', 'form_1a_pq', 'form_1k', 'form_1sa', 'form_1u', 'form_1z'
  filing_status TEXT DEFAULT 'draft', -- 'draft', 'review', 'submitted', 'qualified', 'withdrawn'

  -- Filing details
  accession_number TEXT, -- SEC accession number once filed
  filing_date DATE,
  effective_date DATE,

  -- Document storage
  document_url TEXT,
  document_data JSONB DEFAULT '{}', -- Structured filing data

  -- Review tracking
  sec_comments JSONB DEFAULT '[]',
  amendments INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Legal document templates and generated docs
CREATE TABLE IF NOT EXISTS legal_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_company_id UUID REFERENCES parent_company(id),
  offering_id UUID REFERENCES reg_a_offerings(id),

  document_type TEXT NOT NULL, -- 'operating_agreement', 'subscription_agreement', 'offering_circular', 'risk_disclosure', etc.
  document_name TEXT NOT NULL,
  version TEXT DEFAULT '1.0',

  -- Content
  template_data JSONB DEFAULT '{}', -- Variables used to generate
  generated_content TEXT, -- The actual document text
  pdf_url TEXT, -- Stored PDF

  -- Status
  status TEXT DEFAULT 'draft', -- 'draft', 'review', 'approved', 'executed'
  approved_by TEXT,
  approved_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert Nuke Ltd as parent company
INSERT INTO parent_company (
  legal_name,
  entity_type,
  state_of_formation
) VALUES (
  'Nuke Ltd',
  'llc',
  'Nevada'
) ON CONFLICT DO NOTHING;

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_legal_docs_type ON legal_documents(document_type);
CREATE INDEX IF NOT EXISTS idx_sec_filings_status ON sec_filings(filing_status);

-- RLS
ALTER TABLE parent_company ENABLE ROW LEVEL SECURITY;
ALTER TABLE sec_filings ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_documents ENABLE ROW LEVEL SECURITY;

-- Only service role can access (internal use)
CREATE POLICY "Service role access" ON parent_company FOR ALL USING (true);
CREATE POLICY "Service role access" ON sec_filings FOR ALL USING (true);
CREATE POLICY "Service role access" ON legal_documents FOR ALL USING (true);
