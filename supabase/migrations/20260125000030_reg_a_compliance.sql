-- Reg A+ Compliance Structure
-- Per-asset LLC entities, investor accreditation, subscription agreements
-- Part of Phase 3: Institutional-Grade Financial Infrastructure

-- Series LLC per asset
CREATE TABLE IF NOT EXISTS asset_legal_entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_entity_id UUID REFERENCES asset_legal_entities(id),

  -- Entity identification
  entity_name TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('series_llc', 'llc', 'corporation', 'lp', 'trust')),
  state_of_formation TEXT NOT NULL,
  formation_date DATE,

  -- Tax and registration
  ein TEXT, -- Employer Identification Number
  state_entity_number TEXT,
  registered_agent TEXT,
  registered_agent_address TEXT,

  -- Asset linkage
  vehicle_id UUID UNIQUE REFERENCES vehicles(id),
  asset_type TEXT CHECK (asset_type IN ('vehicle', 'collection', 'fund')),

  -- SEC registration
  sec_file_number TEXT,
  sec_cik TEXT, -- Central Index Key
  sec_registration_date DATE,

  -- Status
  status TEXT DEFAULT 'pending' CHECK (status IN (
    'pending', 'active', 'suspended', 'dissolved', 'merged'
  )),
  status_reason TEXT,

  -- Metadata
  operating_agreement_url TEXT,
  articles_url TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for legal entities
CREATE INDEX IF NOT EXISTS idx_legal_entities_parent ON asset_legal_entities(parent_entity_id);
CREATE INDEX IF NOT EXISTS idx_legal_entities_vehicle ON asset_legal_entities(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_legal_entities_status ON asset_legal_entities(status);

-- Reg A+ offerings
CREATE TABLE IF NOT EXISTS reg_a_offerings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id UUID NOT NULL REFERENCES asset_legal_entities(id) ON DELETE CASCADE,

  -- Offering classification
  tier TEXT NOT NULL CHECK (tier IN ('tier_1', 'tier_2')),
  -- Tier 1: $20M max, state registration required, no ongoing reporting
  -- Tier 2: $75M max, no state registration, ongoing SEC reporting

  -- Offering details
  offering_name TEXT NOT NULL,
  offering_description TEXT,
  max_offering_amount NUMERIC(15,2) NOT NULL,
  min_investment NUMERIC(15,2) DEFAULT 100.00,
  shares_offered INTEGER NOT NULL,
  price_per_share NUMERIC(10,2) NOT NULL,

  -- Progress
  amount_raised NUMERIC(15,2) DEFAULT 0,
  shares_sold INTEGER DEFAULT 0,
  investor_count INTEGER DEFAULT 0,

  -- Status
  offering_status TEXT DEFAULT 'pre_qualification' CHECK (offering_status IN (
    'draft', 'pre_qualification', 'sec_review', 'qualified',
    'open', 'fully_subscribed', 'closed', 'withdrawn', 'suspended'
  )),
  qualification_date DATE,
  open_date DATE,
  close_date DATE,

  -- Escrow
  escrow_agent_name TEXT,
  escrow_agent_address TEXT,
  escrow_account_number TEXT,
  minimum_escrow_amount NUMERIC(15,2),
  escrow_break_date DATE,

  -- Documents
  offering_circular_url TEXT,
  subscription_agreement_template_url TEXT,
  risk_factors_url TEXT,

  -- Metadata
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for offerings
CREATE INDEX IF NOT EXISTS idx_offerings_entity ON reg_a_offerings(entity_id);
CREATE INDEX IF NOT EXISTS idx_offerings_status ON reg_a_offerings(offering_status);
CREATE INDEX IF NOT EXISTS idx_offerings_tier ON reg_a_offerings(tier);

-- Investor accreditation
CREATE TABLE IF NOT EXISTS investor_accreditation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Accreditation status
  is_accredited BOOLEAN DEFAULT false,
  accreditation_type TEXT CHECK (accreditation_type IN (
    'income', -- $200k individual / $300k joint income
    'net_worth', -- $1M net worth excluding primary residence
    'professional', -- Series 7, 65, 82 holders
    'entity', -- Entity with $5M assets
    'knowledgeable_employee', -- For private funds
    'not_accredited'
  )),

  -- Financial qualification (for Tier 2 non-accredited investors)
  annual_income NUMERIC(15,2),
  net_worth NUMERIC(15,2),
  investment_limit_percentage NUMERIC(5,2), -- Max 10% of income/net worth

  -- Verification
  verification_method TEXT CHECK (verification_method IN (
    'self_certification',
    'third_party_letter', -- CPA, attorney, broker-dealer
    'cpa_letter',
    'tax_return_review',
    'credit_report',
    'entity_documents'
  )),
  verification_document_url TEXT,
  verified_by TEXT, -- Name of verifier
  verified_at TIMESTAMPTZ,

  -- Validity
  effective_date DATE DEFAULT CURRENT_DATE,
  expiration_date DATE, -- Must reverify annually
  is_valid BOOLEAN GENERATED ALWAYS AS (
    expiration_date IS NULL OR expiration_date >= CURRENT_DATE
  ) STORED,

  -- Metadata
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for accreditation
CREATE INDEX IF NOT EXISTS idx_accreditation_user ON investor_accreditation(user_id);
CREATE INDEX IF NOT EXISTS idx_accreditation_status ON investor_accreditation(is_accredited);
CREATE INDEX IF NOT EXISTS idx_accreditation_expiration ON investor_accreditation(expiration_date);

-- Subscription agreements
CREATE TABLE IF NOT EXISTS subscription_agreements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  offering_id UUID NOT NULL REFERENCES reg_a_offerings(id) ON DELETE CASCADE,

  -- Subscription details
  shares_subscribed INTEGER NOT NULL CHECK (shares_subscribed > 0),
  price_per_share NUMERIC(10,2) NOT NULL,
  total_amount NUMERIC(15,2) NOT NULL,

  -- Investor qualification
  accreditation_id UUID REFERENCES investor_accreditation(id),
  is_accredited_investor BOOLEAN NOT NULL,
  investment_limit_check BOOLEAN DEFAULT true, -- For non-accredited

  -- Status workflow
  status TEXT DEFAULT 'pending' CHECK (status IN (
    'pending', -- Initial state
    'signed', -- Investor signed
    'funded', -- Payment received
    'in_review', -- Compliance review
    'accepted', -- Issuer accepted
    'rejected', -- Issuer rejected
    'cancelled', -- Investor cancelled
    'completed' -- Shares issued
  )),

  -- Signature
  signature_timestamp TIMESTAMPTZ,
  signature_ip_address INET,
  electronic_signature TEXT,
  signature_method TEXT CHECK (signature_method IN ('click', 'typed', 'drawn', 'docusign')),

  -- Compliance checks
  aml_check_status TEXT CHECK (aml_check_status IN (
    'pending', 'passed', 'failed', 'review_required'
  )),
  aml_check_date TIMESTAMPTZ,
  kyc_verified BOOLEAN DEFAULT false,
  ofac_cleared BOOLEAN DEFAULT false,

  -- Payment
  payment_method TEXT,
  payment_reference TEXT,
  payment_received_at TIMESTAMPTZ,
  payment_amount NUMERIC(15,2),

  -- Share issuance
  shares_issued_at TIMESTAMPTZ,
  share_certificate_number TEXT,

  -- Documents
  signed_agreement_url TEXT,
  subscription_form_url TEXT,

  -- Rejection/cancellation
  rejection_reason TEXT,
  cancellation_reason TEXT,
  cancelled_at TIMESTAMPTZ,

  -- Metadata
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for subscriptions
CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscription_agreements(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_offering ON subscription_agreements(offering_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscription_agreements(status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_created ON subscription_agreements(created_at DESC);

-- Risk disclosure acknowledgments
CREATE TABLE IF NOT EXISTS risk_disclosure_acknowledgments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  offering_id UUID REFERENCES reg_a_offerings(id),

  -- Disclosure details
  disclosure_type TEXT NOT NULL CHECK (disclosure_type IN (
    'illiquidity', -- Can't easily sell
    'total_loss', -- May lose entire investment
    'no_guarantee', -- No guarantee of returns
    'no_dividends', -- May not receive distributions
    'dilution', -- Future offerings may dilute
    'conflicts_of_interest',
    'tax_consequences',
    'regulatory_risks',
    'market_risks',
    'operational_risks',
    'general_platform_risks'
  )),
  disclosure_version TEXT NOT NULL, -- Track version of disclosure
  disclosure_text TEXT, -- Actual text acknowledged

  -- Acknowledgment
  acknowledged_at TIMESTAMPTZ DEFAULT NOW(),
  acknowledgment_method TEXT DEFAULT 'checkbox' CHECK (acknowledgment_method IN (
    'checkbox', 'typed_confirmation', 'signature', 'video_verification'
  )),

  -- Context
  ip_address INET,
  user_agent TEXT,

  -- Metadata
  metadata JSONB DEFAULT '{}',

  -- Uniqueness
  UNIQUE(user_id, offering_id, disclosure_type, disclosure_version)
);

-- Indexes for disclosures
CREATE INDEX IF NOT EXISTS idx_disclosures_user ON risk_disclosure_acknowledgments(user_id);
CREATE INDEX IF NOT EXISTS idx_disclosures_offering ON risk_disclosure_acknowledgments(offering_id);

-- Fee schedules
CREATE TABLE IF NOT EXISTS offering_fee_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  offering_id UUID NOT NULL REFERENCES reg_a_offerings(id) ON DELETE CASCADE,

  -- Fee type
  fee_type TEXT NOT NULL CHECK (fee_type IN (
    'management', -- Ongoing management fee
    'performance', -- Carry/incentive fee
    'upfront', -- One-time fee at investment
    'platform', -- Platform transaction fee
    'redemption', -- Fee for early exit
    'acquisition', -- Cost to acquire asset
    'disposition', -- Cost to sell asset
    'administrative', -- Ongoing admin costs
    'custody' -- Asset storage/custody
  )),
  fee_name TEXT NOT NULL,
  fee_description TEXT,

  -- Fee calculation
  fee_percentage NUMERIC(6,4), -- e.g., 0.0200 = 2%
  fee_fixed_amount NUMERIC(15,2),
  fee_basis TEXT CHECK (fee_basis IN (
    'nav', -- Net Asset Value
    'committed_capital',
    'invested_capital',
    'profits', -- For performance fees
    'transaction_value',
    'annual_flat'
  )),

  -- Frequency
  fee_frequency TEXT CHECK (fee_frequency IN (
    'one_time',
    'monthly',
    'quarterly',
    'annual',
    'on_exit',
    'on_distribution'
  )),

  -- Performance fee specifics
  hurdle_rate NUMERIC(6,4), -- Minimum return before performance fee
  high_water_mark BOOLEAN DEFAULT false, -- Only charge on new highs
  catch_up_provision BOOLEAN DEFAULT false,
  preferred_return NUMERIC(6,4),

  -- Status
  is_active BOOLEAN DEFAULT true,
  effective_date DATE DEFAULT CURRENT_DATE,
  end_date DATE,

  -- Metadata
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for fee schedules
CREATE INDEX IF NOT EXISTS idx_fees_offering ON offering_fee_schedules(offering_id);
CREATE INDEX IF NOT EXISTS idx_fees_type ON offering_fee_schedules(fee_type);

-- RLS Policies
ALTER TABLE asset_legal_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE reg_a_offerings ENABLE ROW LEVEL SECURITY;
ALTER TABLE investor_accreditation ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_agreements ENABLE ROW LEVEL SECURITY;
ALTER TABLE risk_disclosure_acknowledgments ENABLE ROW LEVEL SECURITY;
ALTER TABLE offering_fee_schedules ENABLE ROW LEVEL SECURITY;

-- Legal entities: public read (transparency)
CREATE POLICY "legal_entities_public_read" ON asset_legal_entities
  FOR SELECT USING (status = 'active');

CREATE POLICY "legal_entities_admin_all" ON asset_legal_entities
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND user_type = 'admin')
  );

-- Offerings: public read for qualified offerings
CREATE POLICY "offerings_public_read" ON reg_a_offerings
  FOR SELECT USING (offering_status IN ('qualified', 'open', 'fully_subscribed', 'closed'));

CREATE POLICY "offerings_admin_all" ON reg_a_offerings
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND user_type = 'admin')
  );

-- Accreditation: users see their own
CREATE POLICY "accreditation_user_policy" ON investor_accreditation
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "accreditation_admin_read" ON investor_accreditation
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND user_type = 'admin')
  );

-- Subscriptions: users see their own
CREATE POLICY "subscriptions_user_policy" ON subscription_agreements
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "subscriptions_admin_all" ON subscription_agreements
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND user_type = 'admin')
  );

-- Risk disclosures: users see their own
CREATE POLICY "disclosures_user_policy" ON risk_disclosure_acknowledgments
  FOR ALL USING (auth.uid() = user_id);

-- Fee schedules: public read
CREATE POLICY "fees_public_read" ON offering_fee_schedules
  FOR SELECT USING (true);

-- Function to check if user can invest in offering
CREATE OR REPLACE FUNCTION can_invest_in_offering(
  p_user_id UUID,
  p_offering_id UUID,
  p_amount NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_offering reg_a_offerings%ROWTYPE;
  v_accreditation investor_accreditation%ROWTYPE;
  v_kyc_verified BOOLEAN;
  v_disclosures_complete BOOLEAN;
  v_investment_limit NUMERIC;
  v_issues TEXT[] := '{}';
BEGIN
  -- Get offering
  SELECT * INTO v_offering FROM reg_a_offerings WHERE id = p_offering_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('can_invest', false, 'issues', ARRAY['Offering not found']);
  END IF;

  -- Check offering status
  IF v_offering.offering_status NOT IN ('open') THEN
    v_issues := array_append(v_issues, 'Offering is not currently open');
  END IF;

  -- Check available shares
  IF (v_offering.shares_offered - v_offering.shares_sold) * v_offering.price_per_share < p_amount THEN
    v_issues := array_append(v_issues, 'Not enough shares available');
  END IF;

  -- Check minimum investment
  IF p_amount < v_offering.min_investment THEN
    v_issues := array_append(v_issues, format('Minimum investment is %s', v_offering.min_investment));
  END IF;

  -- Get accreditation
  SELECT * INTO v_accreditation
  FROM investor_accreditation
  WHERE user_id = p_user_id
  AND (expiration_date IS NULL OR expiration_date >= CURRENT_DATE)
  ORDER BY created_at DESC
  LIMIT 1;

  -- Tier 2 has non-accredited investor limits
  IF v_offering.tier = 'tier_2' AND (v_accreditation IS NULL OR NOT v_accreditation.is_accredited) THEN
    IF v_accreditation IS NULL THEN
      v_investment_limit := 0;
    ELSE
      v_investment_limit := LEAST(
        v_accreditation.annual_income,
        v_accreditation.net_worth
      ) * 0.10; -- 10% limit
    END IF;

    IF p_amount > v_investment_limit THEN
      v_issues := array_append(v_issues, format('Investment exceeds 10%% limit (%s)', v_investment_limit));
    END IF;
  END IF;

  -- Check KYC
  SELECT phone_verified AND id_verification_status = 'approved'
  INTO v_kyc_verified
  FROM profiles
  WHERE id = p_user_id;

  IF NOT COALESCE(v_kyc_verified, false) THEN
    v_issues := array_append(v_issues, 'KYC verification required');
  END IF;

  -- Check required disclosures
  SELECT COUNT(*) = (
    SELECT COUNT(DISTINCT dt)
    FROM (VALUES ('illiquidity'), ('total_loss'), ('no_guarantee')) AS required(dt)
  )
  INTO v_disclosures_complete
  FROM risk_disclosure_acknowledgments
  WHERE user_id = p_user_id
  AND (offering_id = p_offering_id OR offering_id IS NULL)
  AND disclosure_type IN ('illiquidity', 'total_loss', 'no_guarantee');

  IF NOT COALESCE(v_disclosures_complete, false) THEN
    v_issues := array_append(v_issues, 'Risk disclosures must be acknowledged');
  END IF;

  RETURN jsonb_build_object(
    'can_invest', array_length(v_issues, 1) IS NULL,
    'issues', v_issues,
    'is_accredited', COALESCE(v_accreditation.is_accredited, false),
    'investment_limit', v_investment_limit,
    'kyc_verified', v_kyc_verified,
    'disclosures_complete', v_disclosures_complete
  );
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION can_invest_in_offering TO authenticated;

-- Comments
COMMENT ON TABLE asset_legal_entities IS 'Legal entities (Series LLCs) holding individual assets';
COMMENT ON TABLE reg_a_offerings IS 'Regulation A+ offerings for fractional ownership';
COMMENT ON TABLE investor_accreditation IS 'Investor accreditation status and verification';
COMMENT ON TABLE subscription_agreements IS 'Investment subscription agreements';
COMMENT ON TABLE risk_disclosure_acknowledgments IS 'Risk disclosure acknowledgments for compliance';
COMMENT ON TABLE offering_fee_schedules IS 'Fee structures for offerings';
