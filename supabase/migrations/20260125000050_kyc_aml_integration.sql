-- KYC/AML Integration
-- Identity verification and anti-money laundering checks
-- Part of Phase 5: Institutional-Grade Financial Infrastructure
-- Note: KYC provider integration mocked for demo phase

-- Extend user_verifications table for KYC provider integration
ALTER TABLE user_verifications ADD COLUMN IF NOT EXISTS kyc_provider TEXT;
ALTER TABLE user_verifications ADD COLUMN IF NOT EXISTS kyc_inquiry_id TEXT;
ALTER TABLE user_verifications ADD COLUMN IF NOT EXISTS kyc_template_id TEXT;
ALTER TABLE user_verifications ADD COLUMN IF NOT EXISTS kyc_response JSONB;
ALTER TABLE user_verifications ADD COLUMN IF NOT EXISTS kyc_status TEXT CHECK (kyc_status IN (
  'pending', 'in_progress', 'needs_review', 'approved', 'declined', 'expired', 'cancelled'
));
ALTER TABLE user_verifications ADD COLUMN IF NOT EXISTS risk_score NUMERIC(5,2);
ALTER TABLE user_verifications ADD COLUMN IF NOT EXISTS risk_level TEXT CHECK (risk_level IN (
  'low', 'medium', 'high', 'critical'
));
ALTER TABLE user_verifications ADD COLUMN IF NOT EXISTS watchlist_hits JSONB;
ALTER TABLE user_verifications ADD COLUMN IF NOT EXISTS pep_check_result TEXT; -- Politically Exposed Person
ALTER TABLE user_verifications ADD COLUMN IF NOT EXISTS sanctions_check_result TEXT;
ALTER TABLE user_verifications ADD COLUMN IF NOT EXISTS adverse_media_result TEXT;

-- AML transaction monitoring
CREATE TABLE IF NOT EXISTS aml_monitoring (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Transaction being monitored
  transaction_id UUID,
  transaction_type TEXT, -- 'deposit', 'withdrawal', 'trade', 'subscription'
  transaction_amount NUMERIC(15,2),
  transaction_currency TEXT DEFAULT 'USD',
  transaction_date TIMESTAMPTZ,

  -- Counterparty info
  counterparty_name TEXT,
  counterparty_id TEXT,
  counterparty_type TEXT, -- 'individual', 'entity', 'unknown'

  -- Risk assessment
  risk_level TEXT CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  risk_score NUMERIC(5,2),

  -- Flags triggered
  flags TEXT[], -- Array of triggered rule codes
  flag_descriptions JSONB, -- Details of each flag

  -- Common AML flags
  large_transaction BOOLEAN DEFAULT false, -- Over threshold
  structuring_suspected BOOLEAN DEFAULT false, -- Multiple small transactions
  unusual_pattern BOOLEAN DEFAULT false, -- Deviation from normal behavior
  high_risk_jurisdiction BOOLEAN DEFAULT false,
  pep_involvement BOOLEAN DEFAULT false,
  sanctions_match BOOLEAN DEFAULT false,

  -- SAR requirement
  requires_sar BOOLEAN DEFAULT false, -- Suspicious Activity Report
  sar_filed BOOLEAN DEFAULT false,
  sar_filed_date DATE,
  sar_reference TEXT,

  -- Review workflow
  auto_approved BOOLEAN DEFAULT false,
  requires_manual_review BOOLEAN DEFAULT false,
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  review_decision TEXT CHECK (review_decision IN (
    'approved', 'blocked', 'escalated', 'sar_filed', 'pending'
  )),
  review_notes TEXT,

  -- Audit trail
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'
);

-- Indexes for AML monitoring
CREATE INDEX IF NOT EXISTS idx_aml_monitoring_user ON aml_monitoring(user_id);
CREATE INDEX IF NOT EXISTS idx_aml_monitoring_transaction ON aml_monitoring(transaction_id);
CREATE INDEX IF NOT EXISTS idx_aml_monitoring_risk ON aml_monitoring(risk_level);
CREATE INDEX IF NOT EXISTS idx_aml_monitoring_flags ON aml_monitoring USING gin(flags);
CREATE INDEX IF NOT EXISTS idx_aml_monitoring_requires_review ON aml_monitoring(requires_manual_review) WHERE requires_manual_review = true;
CREATE INDEX IF NOT EXISTS idx_aml_monitoring_sar ON aml_monitoring(requires_sar) WHERE requires_sar = true;

-- KYC inquiry tracking
CREATE TABLE IF NOT EXISTS kyc_inquiries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Provider info
  provider TEXT NOT NULL CHECK (provider IN ('persona', 'jumio', 'onfido', 'manual', 'demo')),
  provider_inquiry_id TEXT UNIQUE,
  template_id TEXT,

  -- Status
  status TEXT DEFAULT 'created' CHECK (status IN (
    'created', 'pending', 'in_progress', 'completed', 'expired', 'failed'
  )),
  verification_status TEXT CHECK (verification_status IN (
    'pending', 'approved', 'declined', 'needs_review'
  )),

  -- Results
  checks_completed JSONB DEFAULT '[]', -- Array of completed verification steps
  checks_failed JSONB DEFAULT '[]', -- Array of failed verification steps
  overall_score NUMERIC(5,2),

  -- Document info
  document_type TEXT, -- 'passport', 'drivers_license', 'national_id'
  document_country TEXT,
  document_number_hash TEXT, -- Hashed for privacy
  document_expiry DATE,

  -- Extracted data (for demo/manual)
  extracted_first_name TEXT,
  extracted_last_name TEXT,
  extracted_dob DATE,
  extracted_address JSONB,

  -- Face verification
  face_match_score NUMERIC(5,2),
  liveness_check_passed BOOLEAN,

  -- Provider response
  raw_response JSONB,
  webhook_events JSONB DEFAULT '[]',

  -- Timestamps
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,

  -- Metadata
  session_metadata JSONB DEFAULT '{}'
);

-- Indexes for KYC inquiries
CREATE INDEX IF NOT EXISTS idx_kyc_inquiries_user ON kyc_inquiries(user_id);
CREATE INDEX IF NOT EXISTS idx_kyc_inquiries_provider_id ON kyc_inquiries(provider_inquiry_id);
CREATE INDEX IF NOT EXISTS idx_kyc_inquiries_status ON kyc_inquiries(status);
CREATE INDEX IF NOT EXISTS idx_kyc_inquiries_verification ON kyc_inquiries(verification_status);

-- AML rules configuration
CREATE TABLE IF NOT EXISTS aml_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_code TEXT UNIQUE NOT NULL,
  rule_name TEXT NOT NULL,
  rule_description TEXT,

  -- Rule logic
  rule_type TEXT CHECK (rule_type IN (
    'threshold', 'pattern', 'velocity', 'jurisdiction', 'watchlist', 'custom'
  )),
  conditions JSONB NOT NULL, -- Rule conditions

  -- Thresholds
  threshold_amount NUMERIC(15,2),
  threshold_count INTEGER,
  time_window_hours INTEGER,

  -- Actions
  risk_level_increase TEXT, -- How much to increase risk
  auto_block BOOLEAN DEFAULT false,
  require_review BOOLEAN DEFAULT false,
  require_sar BOOLEAN DEFAULT false,

  -- Status
  is_active BOOLEAN DEFAULT true,
  effective_date DATE DEFAULT CURRENT_DATE,
  end_date DATE,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed with default AML rules
INSERT INTO aml_rules (rule_code, rule_name, rule_description, rule_type, conditions, threshold_amount, require_review) VALUES
('CTR-10K', 'Currency Transaction Report Threshold', 'Transactions over $10,000 require CTR', 'threshold', '{"field": "amount", "operator": ">=", "value": 10000}', 10000, true),
('SAR-5K', 'SAR Threshold', 'Suspicious transactions over $5,000', 'threshold', '{"field": "amount", "operator": ">=", "value": 5000}', 5000, true),
('STRUCT-24H', 'Structuring Detection', 'Multiple transactions under threshold in 24h', 'velocity', '{"count_under_threshold": true, "max_count": 3}', 9000, true),
('HIGH-RISK-JUR', 'High Risk Jurisdiction', 'Transaction from/to high-risk country', 'jurisdiction', '{"check_countries": true}', NULL, true),
('PEP-MATCH', 'PEP Match', 'User matched as Politically Exposed Person', 'watchlist', '{"list": "pep"}', NULL, true),
('SANCTION-MATCH', 'Sanctions Match', 'User on sanctions list', 'watchlist', '{"list": "ofac,un,eu"}', NULL, true)
ON CONFLICT (rule_code) DO NOTHING;

-- RLS Policies
ALTER TABLE aml_monitoring ENABLE ROW LEVEL SECURITY;
ALTER TABLE kyc_inquiries ENABLE ROW LEVEL SECURITY;
ALTER TABLE aml_rules ENABLE ROW LEVEL SECURITY;

-- AML monitoring: admins only
CREATE POLICY "aml_monitoring_admin_all" ON aml_monitoring
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND user_type = 'admin')
  );

-- KYC inquiries: users see their own, admins see all
CREATE POLICY "kyc_inquiries_user_read" ON kyc_inquiries
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "kyc_inquiries_admin_all" ON kyc_inquiries
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND user_type = 'admin')
  );

-- AML rules: public read, admin write
CREATE POLICY "aml_rules_public_read" ON aml_rules
  FOR SELECT USING (is_active = true);

CREATE POLICY "aml_rules_admin_write" ON aml_rules
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND user_type = 'admin')
  );

-- Function to initiate KYC verification (demo mode)
CREATE OR REPLACE FUNCTION initiate_kyc_verification(
  p_user_id UUID,
  p_provider TEXT DEFAULT 'demo'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_inquiry_id UUID;
  v_provider_id TEXT;
BEGIN
  -- In demo mode, create a mock inquiry
  v_provider_id := 'demo_' || gen_random_uuid()::TEXT;

  INSERT INTO kyc_inquiries (
    user_id,
    provider,
    provider_inquiry_id,
    status,
    session_metadata
  ) VALUES (
    p_user_id,
    p_provider,
    v_provider_id,
    'created',
    jsonb_build_object(
      'demo_mode', true,
      'initiated_at', NOW()
    )
  ) RETURNING id INTO v_inquiry_id;

  -- Log audit event
  PERFORM create_audit_log_entry(
    'kyc_started',
    p_user_id,
    NULL,
    'kyc',
    v_inquiry_id,
    NULL,
    NULL,
    jsonb_build_object('provider', p_provider, 'inquiry_id', v_provider_id),
    'KYC verification initiated'
  );

  RETURN jsonb_build_object(
    'success', true,
    'inquiry_id', v_inquiry_id,
    'provider_inquiry_id', v_provider_id,
    'status', 'created',
    'next_step', CASE
      WHEN p_provider = 'demo' THEN 'Demo mode: verification will auto-complete in 5 seconds'
      ELSE 'Redirect user to provider verification URL'
    END
  );
END;
$$;

-- Function to process KYC webhook (demo/real)
CREATE OR REPLACE FUNCTION process_kyc_webhook(
  p_provider TEXT,
  p_provider_inquiry_id TEXT,
  p_event_type TEXT,
  p_payload JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_inquiry kyc_inquiries%ROWTYPE;
  v_verification_status TEXT;
  v_audit_action TEXT;
BEGIN
  -- Find the inquiry
  SELECT * INTO v_inquiry
  FROM kyc_inquiries
  WHERE provider_inquiry_id = p_provider_inquiry_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Inquiry not found');
  END IF;

  -- Update based on event type
  IF p_event_type IN ('inquiry.completed', 'verification.passed', 'demo.approved') THEN
    v_verification_status := 'approved';
    v_audit_action := 'kyc_approved';
  ELSIF p_event_type IN ('inquiry.failed', 'verification.failed', 'demo.declined') THEN
    v_verification_status := 'declined';
    v_audit_action := 'kyc_rejected';
  ELSIF p_event_type IN ('inquiry.needs_review', 'verification.needs_review') THEN
    v_verification_status := 'needs_review';
    v_audit_action := 'kyc_document_uploaded';
  ELSE
    v_verification_status := 'pending';
    v_audit_action := 'kyc_document_uploaded';
  END IF;

  -- Update inquiry
  UPDATE kyc_inquiries
  SET
    status = 'completed',
    verification_status = v_verification_status,
    completed_at = NOW(),
    raw_response = p_payload,
    webhook_events = webhook_events || jsonb_build_array(
      jsonb_build_object('type', p_event_type, 'received_at', NOW(), 'payload', p_payload)
    )
  WHERE id = v_inquiry.id;

  -- Update user verification status
  UPDATE user_verifications
  SET
    kyc_status = v_verification_status,
    kyc_response = p_payload,
    status = CASE v_verification_status WHEN 'approved' THEN 'approved' ELSE 'pending' END,
    updated_at = NOW()
  WHERE user_id = v_inquiry.user_id
  AND verification_type = 'id_document'
  ORDER BY created_at DESC
  LIMIT 1;

  -- Update profile
  IF v_verification_status = 'approved' THEN
    UPDATE profiles
    SET
      id_verification_status = 'approved',
      verified_at = NOW()
    WHERE id = v_inquiry.user_id;

    -- Update verification level
    PERFORM update_user_verification_level(v_inquiry.user_id);
  END IF;

  -- Log audit event
  PERFORM create_audit_log_entry(
    v_audit_action,
    v_inquiry.user_id,
    NULL,
    'kyc',
    v_inquiry.id,
    NULL,
    to_jsonb(v_inquiry),
    jsonb_build_object(
      'verification_status', v_verification_status,
      'event_type', p_event_type
    ),
    format('KYC %s', v_verification_status)
  );

  RETURN jsonb_build_object(
    'success', true,
    'inquiry_id', v_inquiry.id,
    'user_id', v_inquiry.user_id,
    'verification_status', v_verification_status
  );
END;
$$;

-- Function to run AML check on transaction
CREATE OR REPLACE FUNCTION run_aml_check(
  p_user_id UUID,
  p_transaction_id UUID,
  p_transaction_type TEXT,
  p_amount NUMERIC,
  p_metadata JSONB DEFAULT '{}'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_monitoring_id UUID;
  v_flags TEXT[] := '{}';
  v_risk_level TEXT := 'low';
  v_risk_score NUMERIC := 0;
  v_requires_review BOOLEAN := false;
  v_requires_sar BOOLEAN := false;
  v_rule RECORD;
BEGIN
  -- Check each active rule
  FOR v_rule IN
    SELECT * FROM aml_rules
    WHERE is_active = true
    AND (effective_date IS NULL OR effective_date <= CURRENT_DATE)
    AND (end_date IS NULL OR end_date >= CURRENT_DATE)
  LOOP
    -- Threshold checks
    IF v_rule.rule_type = 'threshold' AND p_amount >= v_rule.threshold_amount THEN
      v_flags := array_append(v_flags, v_rule.rule_code);
      v_risk_score := v_risk_score + 25;
      IF v_rule.require_review THEN v_requires_review := true; END IF;
      IF v_rule.require_sar THEN v_requires_sar := true; END IF;
    END IF;

    -- Add more rule type checks as needed
  END LOOP;

  -- Determine risk level based on score
  IF v_risk_score >= 75 THEN
    v_risk_level := 'critical';
  ELSIF v_risk_score >= 50 THEN
    v_risk_level := 'high';
  ELSIF v_risk_score >= 25 THEN
    v_risk_level := 'medium';
  ELSE
    v_risk_level := 'low';
  END IF;

  -- Create monitoring record
  INSERT INTO aml_monitoring (
    user_id,
    transaction_id,
    transaction_type,
    transaction_amount,
    transaction_date,
    risk_level,
    risk_score,
    flags,
    requires_manual_review,
    requires_sar,
    auto_approved,
    metadata
  ) VALUES (
    p_user_id,
    p_transaction_id,
    p_transaction_type,
    p_amount,
    NOW(),
    v_risk_level,
    v_risk_score,
    v_flags,
    v_requires_review,
    v_requires_sar,
    v_risk_level = 'low',
    p_metadata
  ) RETURNING id INTO v_monitoring_id;

  RETURN jsonb_build_object(
    'success', true,
    'monitoring_id', v_monitoring_id,
    'risk_level', v_risk_level,
    'risk_score', v_risk_score,
    'flags', v_flags,
    'requires_review', v_requires_review,
    'approved', v_risk_level = 'low'
  );
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION initiate_kyc_verification TO authenticated;
GRANT EXECUTE ON FUNCTION process_kyc_webhook TO authenticated;
GRANT EXECUTE ON FUNCTION run_aml_check TO authenticated;

-- Comments
COMMENT ON TABLE aml_monitoring IS 'AML transaction monitoring and suspicious activity tracking';
COMMENT ON TABLE kyc_inquiries IS 'KYC verification inquiries and results';
COMMENT ON TABLE aml_rules IS 'Configurable AML detection rules';
COMMENT ON FUNCTION initiate_kyc_verification IS 'Start a KYC verification flow for a user';
COMMENT ON FUNCTION process_kyc_webhook IS 'Process KYC provider webhook events';
COMMENT ON FUNCTION run_aml_check IS 'Run AML checks on a transaction';
