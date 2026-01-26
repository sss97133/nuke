-- ============================================================
-- SEC COMPLIANCE SCHEMA ADDITIONS
-- Add tables and columns needed for Form C and Form D compliance
-- Generated: 2026-01-25
-- ============================================================

-- ============================================================
-- PHASE 1: CORE COMPLIANCE (Critical for any offering)
-- ============================================================

-- ------------------------------------------------------------
-- 1. BUSINESS OFFERINGS
-- Tracks Reg D, Reg CF, Reg A+ offerings
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS business_offerings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,

  -- Exemption details
  federal_exemption TEXT[] DEFAULT ARRAY[]::TEXT[], -- ['506b', '506c', 'reg_cf', 'reg_a_plus', '504']
  state_exemptions JSONB DEFAULT '[]'::JSONB, -- [{state: 'CA', exemption: 'Rule 1001'}]

  -- Security details
  security_type TEXT CHECK (security_type IN (
    'common_stock', 'preferred_stock', 'llc_interests', 'membership_units',
    'convertible_note', 'safe', 'debt', 'revenue_share', 'other'
  )),
  share_class TEXT, -- 'Class A', 'Class B', 'Series A Preferred', etc.
  security_description TEXT,

  -- Offering terms
  total_offering_amount NUMERIC(15,2) NOT NULL,
  minimum_investment NUMERIC(12,2),
  maximum_investment NUMERIC(12,2),

  -- Oversubscription terms (Form C)
  accepts_oversubscriptions BOOLEAN DEFAULT false,
  max_oversubscription_amount NUMERIC(15,2),

  -- Pricing
  price_per_share NUMERIC(10,4),
  valuation_pre_money NUMERIC(15,2),
  valuation_post_money NUMERIC(15,2),
  valuation_method TEXT, -- 'discounted_cash_flow', '409a', 'comparable_sales', 'other'

  -- Progress tracking
  amount_sold NUMERIC(15,2) DEFAULT 0,
  amount_remaining NUMERIC(15,2),
  total_investors INTEGER DEFAULT 0,
  accredited_investors INTEGER DEFAULT 0,
  non_accredited_investors INTEGER DEFAULT 0,

  -- Timeline
  offering_start_date DATE,
  offering_end_date DATE,
  first_sale_date DATE,
  indefinite_offering BOOLEAN DEFAULT false,

  -- Flags
  is_business_combination BOOLEAN DEFAULT false,
  is_pooled_investment_fund BOOLEAN DEFAULT false,

  -- Use of proceeds (Form C requirement)
  use_of_proceeds JSONB DEFAULT '{}'::JSONB,
  -- Example: {"equipment": {"amount": 200000, "percentage": 40}, "marketing": {"amount": 150000, "percentage": 30}}

  -- SEC filings
  form_d_filed_date DATE,
  form_d_file_number TEXT,
  form_c_filed_date DATE,
  form_c_file_number TEXT,

  -- Status
  status TEXT DEFAULT 'pending' CHECK (status IN (
    'pending', 'active', 'closed', 'terminated', 'withdrawn'
  )),

  -- Metadata
  notes TEXT,
  metadata JSONB DEFAULT '{}'::JSONB,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_business_offerings_business ON business_offerings(business_id);
CREATE INDEX IF NOT EXISTS idx_business_offerings_status ON business_offerings(status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_business_offerings_dates ON business_offerings(offering_start_date, offering_end_date);

COMMENT ON TABLE business_offerings IS 'SEC-compliant securities offerings (Reg D, Reg CF, Reg A+)';
COMMENT ON COLUMN business_offerings.federal_exemption IS 'SEC exemptions claimed: 506b, 506c, reg_cf, reg_a_plus, 504';
COMMENT ON COLUMN business_offerings.use_of_proceeds IS 'Breakdown of how capital will be used (required for Form C)';

-- ------------------------------------------------------------
-- 2. BUSINESS FINANCIAL STATEMENTS
-- Audited/unaudited financials for disclosure
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS business_financial_statements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,

  -- Statement metadata
  statement_type TEXT NOT NULL CHECK (statement_type IN (
    'balance_sheet', 'income_statement', 'cash_flow', 'cap_table',
    'statement_of_changes', 'notes_to_financials'
  )),
  period_type TEXT CHECK (period_type IN ('annual', 'quarterly', 'monthly')),
  period_start_date DATE NOT NULL,
  period_end_date DATE NOT NULL,
  fiscal_year INTEGER,

  -- Audit status
  is_audited BOOLEAN DEFAULT false,
  is_reviewed BOOLEAN DEFAULT false, -- Review engagement (less than audit)
  auditor_name TEXT,
  auditor_opinion TEXT, -- 'unqualified', 'qualified', 'adverse', 'disclaimer'
  audit_date DATE,

  -- File references
  document_url TEXT, -- PDF/Excel of full statements
  document_hash TEXT, -- SHA-256 for integrity

  -- Key figures (for quick display without parsing full PDF)
  total_assets NUMERIC(15,2),
  total_liabilities NUMERIC(15,2),
  shareholders_equity NUMERIC(15,2),
  revenue NUMERIC(15,2),
  cost_of_revenue NUMERIC(15,2),
  gross_profit NUMERIC(15,2),
  operating_expenses NUMERIC(15,2),
  net_income NUMERIC(15,2),
  ebitda NUMERIC(15,2),
  cash_on_hand NUMERIC(15,2),
  accounts_receivable NUMERIC(15,2),
  inventory NUMERIC(15,2),
  total_debt NUMERIC(15,2),

  -- Detailed data (if structured)
  detailed_data JSONB DEFAULT '{}'::JSONB,

  -- Metadata
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_financial_statements_business ON business_financial_statements(business_id);
CREATE INDEX IF NOT EXISTS idx_financial_statements_period ON business_financial_statements(period_end_date DESC);
CREATE INDEX IF NOT EXISTS idx_financial_statements_type ON business_financial_statements(statement_type);

COMMENT ON TABLE business_financial_statements IS 'Audited/reviewed financial statements for SEC compliance';
COMMENT ON COLUMN business_financial_statements.is_reviewed IS 'Review engagement (SSARS) - less rigorous than audit';

-- ------------------------------------------------------------
-- 3. BUSINESS SHARE CLASSES
-- Capitalization structure (common, preferred, voting rights)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS business_share_classes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,

  share_class_name TEXT NOT NULL, -- 'Common Stock', 'Series A Preferred', etc.
  share_class_code TEXT, -- 'COM', 'PREF-A', etc.

  -- Authorization
  authorized_shares INTEGER,
  issued_shares INTEGER,
  outstanding_shares INTEGER,
  treasury_shares INTEGER,
  reserved_for_options INTEGER, -- Employee stock option pool

  -- Rights and preferences
  voting_rights TEXT CHECK (voting_rights IN ('full', 'limited', 'none', 'super')),
  votes_per_share NUMERIC(5,2) DEFAULT 1.0,

  -- Dividends
  dividend_rights TEXT, -- 'participating', 'non_participating', 'cumulative', 'none'
  dividend_rate NUMERIC(5,2), -- Annual percentage if fixed
  dividend_priority INTEGER, -- 1 = paid first

  -- Liquidation
  liquidation_preference NUMERIC(5,2) DEFAULT 1.0, -- Multiple (e.g., 1.5x investment)
  liquidation_priority INTEGER, -- 1 = paid first in exit
  participation_rights TEXT, -- 'participating', 'non_participating', 'capped_participation'
  participation_cap NUMERIC(5,2), -- Max multiple if capped (e.g., 3x)

  -- Conversion
  is_convertible BOOLEAN DEFAULT false,
  conversion_ratio NUMERIC(10,4), -- Shares of common per preferred
  conversion_price NUMERIC(10,4),
  conversion_triggers TEXT[], -- ['ipo', 'change_of_control', 'qualified_financing', 'holder_option']

  -- Anti-dilution
  anti_dilution_type TEXT CHECK (anti_dilution_type IN (
    'none', 'full_ratchet', 'weighted_average_broad', 'weighted_average_narrow'
  )),

  -- Redemption
  is_redeemable BOOLEAN DEFAULT false,
  redemption_price NUMERIC(10,4),
  redemption_date DATE,

  -- Metadata
  description TEXT,
  notes TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_share_classes_business ON business_share_classes(business_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_share_classes_unique ON business_share_classes(business_id, share_class_name);

COMMENT ON TABLE business_share_classes IS 'Capitalization table: share classes, voting rights, liquidation preferences';
COMMENT ON COLUMN business_share_classes.liquidation_preference IS 'Multiple of original investment paid in liquidation (e.g., 1.5x)';
COMMENT ON COLUMN business_share_classes.anti_dilution_type IS 'Protection for existing shareholders when new shares issued at lower price';

-- ============================================================
-- PHASE 2: DUE DILIGENCE & TRANSPARENCY
-- ============================================================

-- ------------------------------------------------------------
-- 4. BUSINESS INDEBTEDNESS
-- Outstanding loans, lines of credit, bonds
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS business_indebtedness (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,

  -- Creditor details
  creditor_name TEXT NOT NULL,
  creditor_address TEXT,
  creditor_relationship TEXT, -- 'bank', 'insider', 'vendor', 'investor', 'government', 'other'

  -- Debt details
  debt_type TEXT CHECK (debt_type IN (
    'term_loan', 'line_of_credit', 'revolving_credit', 'bonds',
    'convertible_note', 'promissory_note', 'mortgage', 'lease_obligation', 'other'
  )),
  original_principal NUMERIC(15,2),
  outstanding_balance NUMERIC(15,2) NOT NULL,
  currency TEXT DEFAULT 'USD',

  -- Terms
  interest_rate NUMERIC(5,2), -- Annual percentage
  interest_type TEXT CHECK (interest_type IN ('fixed', 'variable', 'zero')),
  origination_date DATE,
  maturity_date DATE,
  payment_frequency TEXT CHECK (payment_frequency IN (
    'monthly', 'quarterly', 'semi_annual', 'annual', 'bullet', 'on_demand'
  )),
  monthly_payment NUMERIC(12,2),

  -- Security
  is_secured BOOLEAN DEFAULT false,
  collateral_description TEXT,
  collateral_value NUMERIC(15,2),

  -- Covenants
  financial_covenants TEXT, -- Description of debt covenants
  is_subordinated BOOLEAN DEFAULT false,
  subordination_description TEXT,

  -- Conversion rights (if convertible)
  is_convertible BOOLEAN DEFAULT false,
  conversion_terms TEXT,
  conversion_price NUMERIC(10,4),

  -- Status
  status TEXT DEFAULT 'current' CHECK (status IN (
    'current', 'delinquent', 'default', 'paid_off', 'refinanced'
  )),
  is_related_party BOOLEAN DEFAULT false,

  -- Metadata
  notes TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_indebtedness_business ON business_indebtedness(business_id);
CREATE INDEX IF NOT EXISTS idx_indebtedness_status ON business_indebtedness(status) WHERE status IN ('current', 'delinquent', 'default');

COMMENT ON TABLE business_indebtedness IS 'Outstanding debt obligations for SEC disclosure';
COMMENT ON COLUMN business_indebtedness.is_related_party IS 'True if creditor is insider/affiliate (requires disclosure)';

-- ------------------------------------------------------------
-- 5. BUSINESS RELATED PARTY TRANSACTIONS
-- Insider transactions (Form C requirement)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS business_related_party_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,

  -- Party information
  related_party_name TEXT NOT NULL,
  related_party_relationship TEXT CHECK (related_party_relationship IN (
    'officer', 'director', 'beneficial_owner', 'promoter',
    'family_member', 'affiliate_entity', 'other'
  )),
  related_party_user_id UUID REFERENCES auth.users(id),
  related_party_title TEXT, -- 'CEO', 'Director', '25% Owner', etc.

  -- Transaction details
  transaction_type TEXT CHECK (transaction_type IN (
    'loan_to_company', 'loan_from_company', 'lease_to_company', 'lease_from_company',
    'purchase_from_party', 'sale_to_party', 'service_agreement', 'consulting_agreement',
    'guarantee', 'equity_purchase', 'equity_sale', 'compensation', 'other'
  )),
  transaction_date DATE NOT NULL,
  transaction_amount NUMERIC(12,2),
  currency TEXT DEFAULT 'USD',

  -- Terms
  terms TEXT, -- Interest rate, payment schedule, duration, etc.
  business_purpose TEXT NOT NULL, -- Why transaction occurred
  is_ongoing BOOLEAN DEFAULT false,
  expected_end_date DATE,

  -- Approvals
  board_approved BOOLEAN DEFAULT false,
  approval_date DATE,
  independent_committee_approved BOOLEAN DEFAULT false,

  -- Fair market value assessment
  fmv_determined BOOLEAN DEFAULT false,
  fmv_method TEXT, -- 'independent_appraisal', 'comparable_transactions', 'board_determination'
  fmv_amount NUMERIC(12,2),

  -- Metadata
  notes TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_related_party_txns_business ON business_related_party_transactions(business_id);
CREATE INDEX IF NOT EXISTS idx_related_party_txns_date ON business_related_party_transactions(transaction_date DESC);

COMMENT ON TABLE business_related_party_transactions IS 'Transactions with insiders (officers, directors, 20%+ owners) - SEC Form C/D disclosure';
COMMENT ON COLUMN business_related_party_transactions.fmv_determined IS 'Whether fair market value was independently determined';

-- ------------------------------------------------------------
-- 6. BUSINESS RELATED PERSONS (SEC Disclosure Format)
-- Standardized format for directors, officers, promoters
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS business_related_persons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,

  -- Person type
  person_type TEXT[] DEFAULT ARRAY[]::TEXT[], -- ['director', 'executive_officer', 'promoter', 'beneficial_owner']

  -- Identity
  full_legal_name TEXT NOT NULL,
  user_id UUID REFERENCES auth.users(id), -- If on platform

  -- Contact (SEC requires addresses)
  business_street_address_1 TEXT,
  business_street_address_2 TEXT,
  business_city TEXT,
  business_state TEXT,
  business_zip_code TEXT,
  business_country TEXT DEFAULT 'US',

  -- Position details
  title TEXT, -- 'Chief Executive Officer', 'Director', 'Promoter', etc.
  start_date DATE,
  end_date DATE,
  is_current BOOLEAN DEFAULT true,

  -- Ownership (if beneficial owner)
  ownership_percentage NUMERIC(5,2),
  share_count INTEGER,
  share_class TEXT,

  -- Background (Form C requirement for officers/directors)
  prior_experience TEXT, -- Prior positions, companies
  educational_background TEXT,
  other_business_affiliations TEXT, -- Current outside positions

  -- Compensation (if officer)
  annual_compensation NUMERIC(12,2),
  compensation_currency TEXT DEFAULT 'USD',
  equity_compensation_shares INTEGER,

  -- Metadata
  notes TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_related_persons_business ON business_related_persons(business_id);
CREATE INDEX IF NOT EXISTS idx_related_persons_current ON business_related_persons(business_id) WHERE is_current = true;

COMMENT ON TABLE business_related_persons IS 'SEC-compliant disclosure of directors, officers, promoters, and 20%+ beneficial owners';
COMMENT ON COLUMN business_related_persons.person_type IS 'Array can include: director, executive_officer, promoter, beneficial_owner';

-- ------------------------------------------------------------
-- 7. BUSINESS PRIOR OFFERINGS
-- Historical fundraising (3-year lookback for Form C)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS business_prior_offerings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,

  -- Offering details
  offering_date DATE NOT NULL,
  exemption_used TEXT[], -- ['506b', 'reg_cf', 'reg_a_plus']
  security_type TEXT,
  amount_raised NUMERIC(15,2),
  number_of_investors INTEGER,

  -- Filing details
  form_d_number TEXT,
  form_c_number TEXT,
  state TEXT, -- If state-level filing

  -- Status
  offering_status TEXT CHECK (offering_status IN (
    'completed', 'terminated', 'ongoing', 'withdrawn'
  )),

  -- Metadata
  notes TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prior_offerings_business ON business_prior_offerings(business_id);
CREATE INDEX IF NOT EXISTS idx_prior_offerings_date ON business_prior_offerings(offering_date DESC);

COMMENT ON TABLE business_prior_offerings IS 'Historical securities offerings (3-year lookback required for Form C)';

-- ============================================================
-- PHASE 3: BUSINESS TABLE ENHANCEMENTS
-- Add columns to existing businesses table
-- ============================================================

DO $$
BEGIN
  -- Incorporation details
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'businesses' AND column_name = 'incorporation_jurisdiction'
  ) THEN
    ALTER TABLE businesses ADD COLUMN incorporation_jurisdiction TEXT;
    COMMENT ON COLUMN businesses.incorporation_jurisdiction IS 'State/country of incorporation (e.g., Delaware, Nevada, Cayman Islands)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'businesses' AND column_name = 'year_incorporated'
  ) THEN
    ALTER TABLE businesses ADD COLUMN year_incorporated INTEGER;
    COMMENT ON COLUMN businesses.year_incorporated IS 'Year of incorporation/formation';
  END IF;

  -- Industry classification (NAICS)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'businesses' AND column_name = 'naics_code'
  ) THEN
    ALTER TABLE businesses ADD COLUMN naics_code TEXT;
    CREATE INDEX IF NOT EXISTS idx_businesses_naics ON businesses(naics_code);
    COMMENT ON COLUMN businesses.naics_code IS 'North American Industry Classification System code (6 digits)';
  END IF;

  -- Revenue range (Form D requirement)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'businesses' AND column_name = 'revenue_range'
  ) THEN
    ALTER TABLE businesses ADD COLUMN revenue_range TEXT
      CHECK (revenue_range IN (
        'no_revenues', 'under_1m', '1m_5m', '5m_25m', '25m_100m', 'over_100m'
      ));
    COMMENT ON COLUMN businesses.revenue_range IS 'SEC Form D revenue bracket';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'businesses' AND column_name = 'revenue_declaration_date'
  ) THEN
    ALTER TABLE businesses ADD COLUMN revenue_declaration_date DATE;
    COMMENT ON COLUMN businesses.revenue_declaration_date IS 'When revenue range was last updated';
  END IF;

  -- SEC filing tracking
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'businesses' AND column_name = 'is_sec_filer'
  ) THEN
    ALTER TABLE businesses ADD COLUMN is_sec_filer BOOLEAN DEFAULT false;
    COMMENT ON COLUMN businesses.is_sec_filer IS 'Has filed Form D, Form C, or other SEC disclosures';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'businesses' AND column_name = 'cik_number'
  ) THEN
    ALTER TABLE businesses ADD COLUMN cik_number TEXT;
    COMMENT ON COLUMN businesses.cik_number IS 'SEC Central Index Key (if registered)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'businesses' AND column_name = 'latest_form_d_date'
  ) THEN
    ALTER TABLE businesses ADD COLUMN latest_form_d_date DATE;
    COMMENT ON COLUMN businesses.latest_form_d_date IS 'Most recent Form D filing date';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'businesses' AND column_name = 'latest_form_c_date'
  ) THEN
    ALTER TABLE businesses ADD COLUMN latest_form_c_date DATE;
    COMMENT ON COLUMN businesses.latest_form_c_date IS 'Most recent Form C filing date';
  END IF;

  -- Risk disclosures (Form C requirement)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'businesses' AND column_name = 'risk_factors'
  ) THEN
    ALTER TABLE businesses ADD COLUMN risk_factors TEXT;
    COMMENT ON COLUMN businesses.risk_factors IS 'Investment risk disclosures (required for Form C)';
  END IF;

  -- Intellectual property
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'businesses' AND column_name = 'intellectual_property'
  ) THEN
    ALTER TABLE businesses ADD COLUMN intellectual_property JSONB DEFAULT '{}'::JSONB;
    COMMENT ON COLUMN businesses.intellectual_property IS 'Patents, trademarks, copyrights - structured as JSONB';
  END IF;

  -- Target market description
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'businesses' AND column_name = 'target_market_description'
  ) THEN
    ALTER TABLE businesses ADD COLUMN target_market_description TEXT;
    COMMENT ON COLUMN businesses.target_market_description IS 'Description of target customer base/market';
  END IF;

END $$;

-- ============================================================
-- PHASE 4: ENHANCEMENTS TO EXISTING TABLES
-- ============================================================

-- Add SEC-reportable flag to business_ownership
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'business_ownership') THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'business_ownership' AND column_name = 'is_sec_reportable'
    ) THEN
      ALTER TABLE business_ownership ADD COLUMN is_sec_reportable BOOLEAN
        GENERATED ALWAYS AS (ownership_percentage >= 20.0) STORED;
      COMMENT ON COLUMN business_ownership.is_sec_reportable IS 'Auto-set to true if ownership >= 20% (SEC disclosure threshold)';
    END IF;
  END IF;
END $$;

-- Add promoter role to business_user_roles
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'business_user_roles') THEN
    -- Drop existing constraint
    ALTER TABLE business_user_roles DROP CONSTRAINT IF EXISTS business_user_roles_role_type_check;

    -- Add updated constraint with promoter
    ALTER TABLE business_user_roles ADD CONSTRAINT business_user_roles_role_type_check
      CHECK (role_type IN (
        'owner', 'manager', 'employee', 'contractor', 'intern', 'consultant', 'promoter'
      ));
  END IF;
END $$;

-- ============================================================
-- RLS POLICIES FOR NEW TABLES
-- ============================================================

-- Business offerings: Public read for active offerings, service role manages
ALTER TABLE business_offerings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone views active offerings" ON business_offerings;
CREATE POLICY "Anyone views active offerings" ON business_offerings
  FOR SELECT USING (status = 'active');

DROP POLICY IF EXISTS "Business owners manage offerings" ON business_offerings;
CREATE POLICY "Business owners manage offerings" ON business_offerings
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM business_ownership
      WHERE business_ownership.business_id = business_offerings.business_id
        AND business_ownership.owner_id = auth.uid()
        AND business_ownership.status = 'active'
    )
  );

-- Financial statements: Restricted to owners and service role
ALTER TABLE business_financial_statements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Business owners view financials" ON business_financial_statements;
CREATE POLICY "Business owners view financials" ON business_financial_statements
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM business_ownership
      WHERE business_ownership.business_id = business_financial_statements.business_id
        AND business_ownership.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Service role manages financials" ON business_financial_statements;
CREATE POLICY "Service role manages financials" ON business_financial_statements
  FOR ALL USING (auth.role() = 'service_role');

-- Share classes: Public read
ALTER TABLE business_share_classes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone views share classes" ON business_share_classes;
CREATE POLICY "Anyone views share classes" ON business_share_classes
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Business owners manage share classes" ON business_share_classes;
CREATE POLICY "Business owners manage share classes" ON business_share_classes
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM business_ownership
      WHERE business_ownership.business_id = business_share_classes.business_id
        AND business_ownership.owner_id = auth.uid()
    )
  );

-- Indebtedness: Owners only
ALTER TABLE business_indebtedness ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Business owners view debt" ON business_indebtedness;
CREATE POLICY "Business owners view debt" ON business_indebtedness
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM business_ownership
      WHERE business_ownership.business_id = business_indebtedness.business_id
        AND business_ownership.owner_id = auth.uid()
    )
  );

-- Related party transactions: Public read (required for transparency)
ALTER TABLE business_related_party_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone views related party transactions" ON business_related_party_transactions;
CREATE POLICY "Anyone views related party transactions" ON business_related_party_transactions
  FOR SELECT USING (true);

-- Related persons: Public read
ALTER TABLE business_related_persons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone views related persons" ON business_related_persons;
CREATE POLICY "Anyone views related persons" ON business_related_persons
  FOR SELECT USING (true);

-- Prior offerings: Public read
ALTER TABLE business_prior_offerings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone views prior offerings" ON business_prior_offerings;
CREATE POLICY "Anyone views prior offerings" ON business_prior_offerings
  FOR SELECT USING (true);

-- ============================================================
-- HELPER FUNCTIONS
-- ============================================================

-- Function to calculate total outstanding debt
CREATE OR REPLACE FUNCTION get_total_debt(p_business_id UUID)
RETURNS NUMERIC(15,2)
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(SUM(outstanding_balance), 0)
  FROM business_indebtedness
  WHERE business_id = p_business_id
    AND status IN ('current', 'delinquent', 'default');
$$;

COMMENT ON FUNCTION get_total_debt IS 'Calculate total outstanding debt for a business';

-- Function to check if offering is fully subscribed
CREATE OR REPLACE FUNCTION is_offering_fully_subscribed(p_offering_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT amount_sold >= total_offering_amount
  FROM business_offerings
  WHERE id = p_offering_id;
$$;

COMMENT ON FUNCTION is_offering_fully_subscribed IS 'Check if offering has reached target amount';

-- ============================================================
-- SUMMARY
-- ============================================================

-- This migration adds:
-- - 7 new tables for SEC compliance
-- - 12 new columns to businesses table
-- - 1 computed column to business_ownership
-- - RLS policies for all new tables
-- - 2 helper functions

-- Next steps:
-- 1. Run this migration
-- 2. Update TypeScript types in nuke_frontend
-- 3. Create admin UI for managing offerings
-- 4. Implement Form D/Form C export functions
-- 5. Add validation logic for SEC filing requirements
