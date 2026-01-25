-- Full Financial Products Infrastructure
-- Supports: Investment, Payments, Lending, Insurance
-- Ready for partner integration or DIY

-- ============================================
-- 1. INSURANCE PRODUCTS
-- ============================================

-- Insurance partners/carriers
CREATE TABLE IF NOT EXISTS insurance_partners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_name TEXT NOT NULL,
  partner_type TEXT NOT NULL, -- 'carrier', 'mga', 'broker', 'api_provider'
  api_endpoint TEXT,
  api_key_encrypted TEXT,
  supported_products TEXT[] DEFAULT '{}', -- 'agreed_value', 'liability', 'storage', 'transit', 'gap'
  commission_rate NUMERIC(5,4), -- Our commission percentage
  is_active BOOLEAN DEFAULT false,
  sandbox_mode BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insurance product catalog
CREATE TABLE IF NOT EXISTS insurance_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id UUID REFERENCES insurance_partners(id),
  product_code TEXT NOT NULL,
  product_name TEXT NOT NULL,
  product_type TEXT NOT NULL, -- 'agreed_value', 'liability', 'storage', 'transit', 'gap', 'title'
  description TEXT,
  min_premium NUMERIC(10,2),
  max_coverage NUMERIC(15,2),
  deductible_options JSONB DEFAULT '[]',
  term_options JSONB DEFAULT '[]', -- months
  eligibility_rules JSONB DEFAULT '{}',
  is_active BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insurance quotes
CREATE TABLE IF NOT EXISTS insurance_quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  vehicle_id UUID REFERENCES vehicles(id),
  product_id UUID REFERENCES insurance_products(id),
  partner_id UUID REFERENCES insurance_partners(id),
  quote_reference TEXT,
  coverage_amount NUMERIC(15,2),
  deductible NUMERIC(10,2),
  premium_amount NUMERIC(10,2),
  term_months INTEGER,
  quote_data JSONB DEFAULT '{}',
  status TEXT DEFAULT 'quoted', -- 'quoted', 'accepted', 'declined', 'expired', 'bound'
  valid_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insurance policies (bound coverage)
CREATE TABLE IF NOT EXISTS insurance_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id UUID REFERENCES insurance_quotes(id),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  vehicle_id UUID REFERENCES vehicles(id),
  product_id UUID REFERENCES insurance_products(id),
  partner_id UUID REFERENCES insurance_partners(id),
  policy_number TEXT,
  coverage_amount NUMERIC(15,2) NOT NULL,
  deductible NUMERIC(10,2),
  premium_amount NUMERIC(10,2) NOT NULL,
  effective_date DATE NOT NULL,
  expiration_date DATE NOT NULL,
  status TEXT DEFAULT 'active', -- 'active', 'cancelled', 'expired', 'claims_pending'
  policy_document_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insurance claims
CREATE TABLE IF NOT EXISTS insurance_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id UUID NOT NULL REFERENCES insurance_policies(id),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  claim_number TEXT,
  claim_type TEXT NOT NULL, -- 'collision', 'theft', 'vandalism', 'weather', 'mechanical', 'other'
  incident_date DATE NOT NULL,
  incident_description TEXT,
  damage_estimate NUMERIC(15,2),
  claim_amount NUMERIC(15,2),
  settlement_amount NUMERIC(15,2),
  status TEXT DEFAULT 'submitted', -- 'submitted', 'under_review', 'approved', 'denied', 'settled', 'closed'
  documents JSONB DEFAULT '[]',
  adjuster_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 2. LENDING PRODUCTS (Vehicle Bonds)
-- ============================================

-- Lending partners/funding sources
CREATE TABLE IF NOT EXISTS lending_partners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_name TEXT NOT NULL,
  partner_type TEXT NOT NULL, -- 'bank', 'credit_union', 'private_lender', 'fund', 'platform_capital'
  funding_capacity NUMERIC(15,2),
  min_loan_amount NUMERIC(10,2),
  max_loan_amount NUMERIC(15,2),
  base_rate NUMERIC(6,4), -- Base interest rate
  spread NUMERIC(6,4), -- Additional spread
  max_ltv NUMERIC(5,4), -- Max loan-to-value ratio
  supported_terms INTEGER[] DEFAULT '{12,24,36,48,60}',
  is_active BOOLEAN DEFAULT false,
  sandbox_mode BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Loan products
CREATE TABLE IF NOT EXISTS loan_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id UUID REFERENCES lending_partners(id),
  product_code TEXT NOT NULL,
  product_name TEXT NOT NULL,
  product_type TEXT NOT NULL, -- 'vehicle_bond', 'restoration_loan', 'inventory_line', 'purchase_finance'
  min_amount NUMERIC(10,2),
  max_amount NUMERIC(15,2),
  min_term_months INTEGER,
  max_term_months INTEGER,
  rate_type TEXT DEFAULT 'fixed', -- 'fixed', 'variable'
  base_apr NUMERIC(6,4),
  max_apr NUMERIC(6,4),
  origination_fee NUMERIC(5,4),
  prepayment_penalty BOOLEAN DEFAULT false,
  eligibility_rules JSONB DEFAULT '{}',
  is_active BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Loan applications
CREATE TABLE IF NOT EXISTS loan_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  product_id UUID REFERENCES loan_products(id),
  vehicle_id UUID REFERENCES vehicles(id),
  requested_amount NUMERIC(15,2) NOT NULL,
  requested_term_months INTEGER NOT NULL,
  purpose TEXT, -- 'purchase', 'restoration', 'refinance', 'cash_out'
  vehicle_value NUMERIC(15,2),
  ltv_ratio NUMERIC(5,4),
  borrower_income NUMERIC(15,2),
  borrower_assets NUMERIC(15,2),
  credit_score INTEGER,
  status TEXT DEFAULT 'draft', -- 'draft', 'submitted', 'under_review', 'approved', 'declined', 'funded', 'withdrawn'
  decision_date TIMESTAMPTZ,
  decision_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Active loans
CREATE TABLE IF NOT EXISTS loans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID REFERENCES loan_applications(id),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  partner_id UUID REFERENCES lending_partners(id),
  vehicle_id UUID REFERENCES vehicles(id),
  loan_number TEXT,
  principal_amount NUMERIC(15,2) NOT NULL,
  interest_rate NUMERIC(6,4) NOT NULL,
  term_months INTEGER NOT NULL,
  monthly_payment NUMERIC(10,2) NOT NULL,
  origination_fee NUMERIC(10,2),
  funded_date DATE,
  maturity_date DATE,
  first_payment_date DATE,
  outstanding_principal NUMERIC(15,2),
  outstanding_interest NUMERIC(10,2),
  status TEXT DEFAULT 'active', -- 'active', 'current', 'delinquent', 'default', 'paid_off', 'charged_off'
  ucc_filing_number TEXT, -- Lien filing
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Loan payments
CREATE TABLE IF NOT EXISTS loan_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id UUID NOT NULL REFERENCES loans(id),
  payment_number INTEGER,
  due_date DATE NOT NULL,
  payment_date DATE,
  scheduled_amount NUMERIC(10,2) NOT NULL,
  principal_amount NUMERIC(10,2),
  interest_amount NUMERIC(10,2),
  late_fee NUMERIC(10,2) DEFAULT 0,
  total_paid NUMERIC(10,2),
  status TEXT DEFAULT 'scheduled', -- 'scheduled', 'pending', 'paid', 'late', 'missed'
  payment_method TEXT,
  transaction_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 3. PAYMENT PROCESSING
-- ============================================

-- Payment processors
CREATE TABLE IF NOT EXISTS payment_processors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  processor_name TEXT NOT NULL,
  processor_type TEXT NOT NULL, -- 'card', 'ach', 'wire', 'crypto', 'escrow'
  api_endpoint TEXT,
  api_key_encrypted TEXT,
  supported_methods TEXT[] DEFAULT '{}',
  fee_structure JSONB DEFAULT '{}',
  settlement_days INTEGER DEFAULT 2,
  is_active BOOLEAN DEFAULT false,
  sandbox_mode BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Payment methods (user saved methods)
CREATE TABLE IF NOT EXISTS user_payment_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  processor_id UUID REFERENCES payment_processors(id),
  method_type TEXT NOT NULL, -- 'card', 'bank_account', 'wire', 'crypto_wallet'
  display_name TEXT,
  last_four TEXT,
  card_brand TEXT,
  bank_name TEXT,
  routing_number_last_four TEXT,
  processor_token TEXT, -- Tokenized reference
  is_default BOOLEAN DEFAULT false,
  is_verified BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Transactions
CREATE TABLE IF NOT EXISTS payment_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  processor_id UUID REFERENCES payment_processors(id),
  payment_method_id UUID REFERENCES user_payment_methods(id),
  transaction_type TEXT NOT NULL, -- 'deposit', 'withdrawal', 'investment', 'redemption', 'fee', 'refund'
  reference_type TEXT, -- 'subscription', 'loan_payment', 'insurance_premium', 'trade'
  reference_id UUID,
  amount NUMERIC(15,2) NOT NULL,
  currency TEXT DEFAULT 'USD',
  fee_amount NUMERIC(10,2) DEFAULT 0,
  net_amount NUMERIC(15,2),
  status TEXT DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed', 'reversed'
  processor_reference TEXT,
  failure_reason TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Escrow accounts (for vehicle purchases, offerings)
CREATE TABLE IF NOT EXISTS escrow_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  escrow_type TEXT NOT NULL, -- 'vehicle_purchase', 'offering', 'loan_proceeds'
  reference_type TEXT,
  reference_id UUID,
  escrow_agent TEXT, -- Third-party escrow company
  escrow_account_number TEXT,
  target_amount NUMERIC(15,2),
  funded_amount NUMERIC(15,2) DEFAULT 0,
  status TEXT DEFAULT 'open', -- 'open', 'funded', 'releasing', 'closed', 'refunded'
  release_conditions JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  funded_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ
);

-- ============================================
-- 4. MONEY TRANSMITTER COMPLIANCE
-- ============================================

-- State licenses (if acting as money transmitter)
CREATE TABLE IF NOT EXISTS money_transmitter_licenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state_code TEXT NOT NULL,
  license_number TEXT,
  license_type TEXT, -- 'money_transmitter', 'payment_processor', 'exemption'
  status TEXT DEFAULT 'not_required', -- 'not_required', 'applied', 'pending', 'active', 'expired', 'exempt'
  effective_date DATE,
  expiration_date DATE,
  surety_bond_amount NUMERIC(15,2),
  net_worth_requirement NUMERIC(15,2),
  renewal_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 5. PARTNER INTEGRATION WEBHOOKS
-- ============================================

CREATE TABLE IF NOT EXISTS partner_webhooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_type TEXT NOT NULL, -- 'insurance', 'lending', 'payment'
  partner_id UUID,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT DEFAULT 'received', -- 'received', 'processing', 'processed', 'failed'
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

-- ============================================
-- 6. PRODUCT CONFIGURATION (Demo/Live toggle)
-- ============================================

-- Extend platform_config for product availability
INSERT INTO platform_config (config_key, config_value, description)
VALUES
  ('insurance_enabled', '{"enabled": false, "demo_mode": true, "partner": null}', 'Insurance product availability'),
  ('lending_enabled', '{"enabled": false, "demo_mode": true, "partner": null}', 'Lending product availability'),
  ('payments_enabled', '{"enabled": true, "demo_mode": true, "processor": "mock"}', 'Payment processing availability')
ON CONFLICT (config_key) DO UPDATE SET config_value = EXCLUDED.config_value;

-- ============================================
-- 7. INDEXES
-- ============================================

CREATE INDEX IF NOT EXISTS idx_insurance_quotes_user ON insurance_quotes(user_id);
CREATE INDEX IF NOT EXISTS idx_insurance_quotes_vehicle ON insurance_quotes(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_insurance_policies_user ON insurance_policies(user_id);
CREATE INDEX IF NOT EXISTS idx_insurance_policies_status ON insurance_policies(status);
CREATE INDEX IF NOT EXISTS idx_insurance_claims_policy ON insurance_claims(policy_id);

CREATE INDEX IF NOT EXISTS idx_loan_applications_user ON loan_applications(user_id);
CREATE INDEX IF NOT EXISTS idx_loan_applications_status ON loan_applications(status);
CREATE INDEX IF NOT EXISTS idx_loans_user ON loans(user_id);
CREATE INDEX IF NOT EXISTS idx_loans_status ON loans(status);
CREATE INDEX IF NOT EXISTS idx_loan_payments_loan ON loan_payments(loan_id);
CREATE INDEX IF NOT EXISTS idx_loan_payments_due_date ON loan_payments(due_date);

CREATE INDEX IF NOT EXISTS idx_payment_transactions_user ON payment_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_status ON payment_transactions(status);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_type ON payment_transactions(transaction_type);

CREATE INDEX IF NOT EXISTS idx_partner_webhooks_partner ON partner_webhooks(partner_type, partner_id);
CREATE INDEX IF NOT EXISTS idx_partner_webhooks_status ON partner_webhooks(status);

-- ============================================
-- 8. SEED DEMO PARTNERS (Placeholder)
-- ============================================

-- Demo insurance partner
INSERT INTO insurance_partners (partner_name, partner_type, supported_products, is_active, sandbox_mode)
VALUES ('NUKE Insurance (Demo)', 'platform', ARRAY['agreed_value', 'storage', 'transit'], false, true);

-- Demo lending partner
INSERT INTO lending_partners (partner_name, partner_type, funding_capacity, min_loan_amount, max_loan_amount, base_rate, max_ltv, is_active, sandbox_mode)
VALUES ('NUKE Capital (Demo)', 'platform_capital', 1000000, 5000, 250000, 0.0899, 0.70, false, true);

-- Demo payment processor
INSERT INTO payment_processors (processor_name, processor_type, supported_methods, is_active, sandbox_mode)
VALUES ('NUKE Pay (Demo)', 'card', ARRAY['card', 'ach'], true, true);
