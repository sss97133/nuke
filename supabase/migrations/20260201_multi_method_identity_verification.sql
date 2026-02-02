-- ============================================================
-- Multi-Method Identity Verification System
-- ============================================================
-- Purpose:
-- - Multiple verification paths with different confidence levels
-- - Composite confidence scoring from all completed verifications
-- - Proxy credential storage for proxy bidding feature
-- - Automated verification checks where possible
--
-- Verification Methods (by confidence):
-- - proxy_credentials (95) - User provides login for proxy actions
-- - profile_link (85) - User adds N-Zero link to their platform bio
-- - comment_code (80) - User posts verification code as comment
-- - email_forward (70) - User forwards email from platform
-- - activity_correlation (60) - Pattern matching in activity
-- - screenshot (40) - Screenshot showing logged-in state
-- - self_attestation (20) - User claims without proof
--
-- Design:
-- - Extends existing external_identity_claims system
-- - New table for individual verification attempts
-- - Confidence is computed from best verification per method
-- ============================================================

-- ============================================
-- 1) Verification Methods Table
-- ============================================

CREATE TABLE IF NOT EXISTS identity_verification_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id UUID NOT NULL REFERENCES external_identity_claims(id) ON DELETE CASCADE,

  method TEXT NOT NULL CHECK (method IN (
    'proxy_credentials',     -- Highest: user provides login, we can act on their behalf
    'profile_link',          -- High: N-Zero link in their platform bio
    'comment_code',          -- High: verification code posted as comment
    'email_forward',         -- Medium: forwarded email from platform
    'activity_correlation',  -- Medium: matching activity patterns
    'screenshot',            -- Low: screenshot proof
    'self_attestation'       -- Lowest: just claiming it
  )),

  -- Proof data
  proof_data JSONB DEFAULT '{}', -- Method-specific proof storage
  proof_url TEXT,                -- URL to proof if applicable
  verification_code TEXT,        -- Generated code for comment/link verification

  -- Status
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending',        -- Awaiting verification
    'checking',       -- Automated check in progress
    'verified',       -- Confirmed valid
    'failed',         -- Check failed
    'expired'         -- Verification window expired
  )),

  -- Confidence
  base_confidence INTEGER NOT NULL, -- Method's base confidence (set by method type)
  actual_confidence INTEGER,        -- Actual confidence after verification (may be adjusted)

  -- Timestamps
  verified_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,           -- For time-limited verifications
  last_check_at TIMESTAMPTZ,
  check_count INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(claim_id, method)  -- One verification per method per claim
);

CREATE INDEX IF NOT EXISTS idx_verification_methods_claim ON identity_verification_methods(claim_id);
CREATE INDEX IF NOT EXISTS idx_verification_methods_status ON identity_verification_methods(status) WHERE status IN ('pending', 'checking');
CREATE INDEX IF NOT EXISTS idx_verification_methods_code ON identity_verification_methods(verification_code) WHERE verification_code IS NOT NULL;

COMMENT ON TABLE identity_verification_methods IS 'Individual verification attempts for identity claims, each with its own confidence level.';

-- ============================================
-- 2) Proxy Credentials (Encrypted Storage)
-- ============================================
-- For the "login to BaT through N-Zero" feature
-- Credentials are encrypted at rest

CREATE TABLE IF NOT EXISTS identity_proxy_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_identity_id UUID NOT NULL REFERENCES external_identities(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  platform TEXT NOT NULL,

  -- Encrypted credential storage
  -- In production, use pgcrypto or vault
  encrypted_username TEXT NOT NULL,
  encrypted_password TEXT NOT NULL,
  encryption_key_id TEXT NOT NULL, -- Reference to key management

  -- Status
  is_active BOOLEAN DEFAULT true,
  last_used_at TIMESTAMPTZ,
  last_verified_at TIMESTAMPTZ,
  verification_status TEXT DEFAULT 'unverified' CHECK (verification_status IN (
    'unverified',
    'valid',
    'invalid',
    'expired',
    'revoked'
  )),

  -- Consent and audit
  consent_given_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  consent_scope JSONB DEFAULT '{"proxy_bidding": true, "profile_access": true}',

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(external_identity_id, platform)
);

CREATE INDEX IF NOT EXISTS idx_proxy_credentials_user ON identity_proxy_credentials(user_id);
CREATE INDEX IF NOT EXISTS idx_proxy_credentials_identity ON identity_proxy_credentials(external_identity_id);

COMMENT ON TABLE identity_proxy_credentials IS 'Encrypted credentials for proxy actions on external platforms (e.g., proxy bidding on BaT).';

-- ============================================
-- 3) Verification Audit Log
-- ============================================

CREATE TABLE IF NOT EXISTS identity_verification_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id UUID REFERENCES external_identity_claims(id) ON DELETE SET NULL,
  verification_id UUID REFERENCES identity_verification_methods(id) ON DELETE SET NULL,

  action TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('user', 'system', 'admin')),
  actor_id UUID,

  details JSONB DEFAULT '{}',

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_verification_log_claim ON identity_verification_log(claim_id);
CREATE INDEX IF NOT EXISTS idx_verification_log_time ON identity_verification_log(created_at);

-- ============================================
-- 4) RLS Policies
-- ============================================

ALTER TABLE identity_verification_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_proxy_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_verification_log ENABLE ROW LEVEL SECURITY;

-- Verification methods: users see their own claims' verifications
DROP POLICY IF EXISTS "Users view own verification methods" ON identity_verification_methods;
CREATE POLICY "Users view own verification methods"
  ON identity_verification_methods
  FOR SELECT
  USING (
    claim_id IN (
      SELECT id FROM external_identity_claims WHERE requested_by_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users create verification methods" ON identity_verification_methods;
CREATE POLICY "Users create verification methods"
  ON identity_verification_methods
  FOR INSERT
  WITH CHECK (
    claim_id IN (
      SELECT id FROM external_identity_claims WHERE requested_by_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Service role manages verification methods" ON identity_verification_methods;
CREATE POLICY "Service role manages verification methods"
  ON identity_verification_methods
  FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

-- Proxy credentials: users see only their own
DROP POLICY IF EXISTS "Users view own proxy credentials" ON identity_proxy_credentials;
CREATE POLICY "Users view own proxy credentials"
  ON identity_proxy_credentials
  FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users manage own proxy credentials" ON identity_proxy_credentials;
CREATE POLICY "Users manage own proxy credentials"
  ON identity_proxy_credentials
  FOR ALL
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Service role manages proxy credentials" ON identity_proxy_credentials;
CREATE POLICY "Service role manages proxy credentials"
  ON identity_proxy_credentials
  FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

-- Log: service role only for writes, users can read their claims' logs
DROP POLICY IF EXISTS "Users view own verification logs" ON identity_verification_log;
CREATE POLICY "Users view own verification logs"
  ON identity_verification_log
  FOR SELECT
  USING (
    claim_id IN (
      SELECT id FROM external_identity_claims WHERE requested_by_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Service role manages verification logs" ON identity_verification_log;
CREATE POLICY "Service role manages verification logs"
  ON identity_verification_log
  FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

-- ============================================
-- 5) Helper Functions
-- ============================================

-- Get base confidence for a verification method
CREATE OR REPLACE FUNCTION get_verification_method_confidence(p_method TEXT)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_method
    WHEN 'proxy_credentials' THEN 95
    WHEN 'profile_link' THEN 85
    WHEN 'comment_code' THEN 80
    WHEN 'email_forward' THEN 70
    WHEN 'activity_correlation' THEN 60
    WHEN 'screenshot' THEN 40
    WHEN 'self_attestation' THEN 20
    ELSE 0
  END;
$$;

-- Generate a verification code
CREATE OR REPLACE FUNCTION generate_verification_code()
RETURNS TEXT
LANGUAGE sql
AS $$
  SELECT 'NZERO-' || upper(substring(md5(random()::text) from 1 for 8));
$$;

-- Start a verification attempt
CREATE OR REPLACE FUNCTION start_identity_verification(
  p_claim_id UUID,
  p_method TEXT,
  p_proof_url TEXT DEFAULT NULL,
  p_proof_data JSONB DEFAULT '{}'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_verification_id UUID;
  v_code TEXT;
  v_base_confidence INTEGER;
  v_expires_at TIMESTAMPTZ;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Verify the claim belongs to this user
  IF NOT EXISTS (
    SELECT 1 FROM external_identity_claims
    WHERE id = p_claim_id AND requested_by_user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Claim not found or not yours';
  END IF;

  v_base_confidence := get_verification_method_confidence(p_method);

  -- Generate code for methods that need it
  IF p_method IN ('profile_link', 'comment_code') THEN
    v_code := generate_verification_code();
    v_expires_at := NOW() + INTERVAL '7 days';
  ELSIF p_method = 'email_forward' THEN
    v_code := generate_verification_code();
    v_expires_at := NOW() + INTERVAL '24 hours';
  END IF;

  -- Insert or update verification attempt
  INSERT INTO identity_verification_methods (
    claim_id,
    method,
    proof_url,
    proof_data,
    verification_code,
    base_confidence,
    expires_at,
    status
  ) VALUES (
    p_claim_id,
    p_method,
    p_proof_url,
    p_proof_data,
    v_code,
    v_base_confidence,
    v_expires_at,
    CASE
      WHEN p_method = 'self_attestation' THEN 'verified'
      ELSE 'pending'
    END
  )
  ON CONFLICT (claim_id, method)
  DO UPDATE SET
    proof_url = COALESCE(EXCLUDED.proof_url, identity_verification_methods.proof_url),
    proof_data = identity_verification_methods.proof_data || EXCLUDED.proof_data,
    verification_code = COALESCE(EXCLUDED.verification_code, identity_verification_methods.verification_code),
    expires_at = COALESCE(EXCLUDED.expires_at, identity_verification_methods.expires_at),
    status = 'pending',
    updated_at = NOW()
  RETURNING id INTO v_verification_id;

  -- For self_attestation, mark as verified immediately (lowest confidence)
  IF p_method = 'self_attestation' THEN
    UPDATE identity_verification_methods
    SET
      status = 'verified',
      actual_confidence = v_base_confidence,
      verified_at = NOW()
    WHERE id = v_verification_id;
  END IF;

  -- Log the action
  INSERT INTO identity_verification_log (claim_id, verification_id, action, actor_type, actor_id, details)
  VALUES (p_claim_id, v_verification_id, 'verification_started', 'user', auth.uid(),
    jsonb_build_object('method', p_method, 'code', v_code));

  RETURN v_verification_id;
END;
$$;

GRANT EXECUTE ON FUNCTION start_identity_verification(UUID, TEXT, TEXT, JSONB) TO authenticated;

-- Calculate composite confidence for a claim
CREATE OR REPLACE FUNCTION calculate_claim_confidence(p_claim_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_max_confidence INTEGER := 0;
  v_verified_count INTEGER := 0;
  v_bonus INTEGER := 0;
BEGIN
  -- Get the highest confidence from verified methods
  SELECT
    COALESCE(MAX(actual_confidence), 0),
    COUNT(*)
  INTO v_max_confidence, v_verified_count
  FROM identity_verification_methods
  WHERE claim_id = p_claim_id AND status = 'verified';

  -- Bonus for multiple verification methods (caps at +10)
  IF v_verified_count > 1 THEN
    v_bonus := LEAST(10, (v_verified_count - 1) * 5);
  END IF;

  RETURN LEAST(100, v_max_confidence + v_bonus);
END;
$$;

-- Verify a claim by code (for profile_link or comment_code)
CREATE OR REPLACE FUNCTION verify_identity_by_code(
  p_code TEXT,
  p_found_at_url TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_verification RECORD;
  v_claim RECORD;
BEGIN
  -- Find the verification by code
  SELECT * INTO v_verification
  FROM identity_verification_methods
  WHERE verification_code = p_code
    AND status = 'pending'
    AND (expires_at IS NULL OR expires_at > NOW());

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  -- Mark as verified
  UPDATE identity_verification_methods
  SET
    status = 'verified',
    actual_confidence = base_confidence,
    verified_at = NOW(),
    proof_data = proof_data || jsonb_build_object('found_at', p_found_at_url, 'verified_by', 'code_match'),
    updated_at = NOW()
  WHERE id = v_verification.id;

  -- Log
  INSERT INTO identity_verification_log (claim_id, verification_id, action, actor_type, details)
  VALUES (v_verification.claim_id, v_verification.id, 'verification_completed', 'system',
    jsonb_build_object('method', v_verification.method, 'found_at', p_found_at_url));

  -- Update claim confidence
  SELECT * INTO v_claim FROM external_identity_claims WHERE id = v_verification.claim_id;

  -- If this brings confidence high enough, auto-approve
  IF calculate_claim_confidence(v_verification.claim_id) >= 70 THEN
    UPDATE external_identity_claims
    SET status = 'approved', reviewed_at = NOW(), updated_at = NOW()
    WHERE id = v_verification.claim_id AND status = 'pending';

    -- Link the identity
    UPDATE external_identities
    SET
      claimed_by_user_id = v_claim.requested_by_user_id,
      claimed_at = NOW(),
      claim_confidence = calculate_claim_confidence(v_verification.claim_id),
      updated_at = NOW()
    WHERE id = (SELECT external_identity_id FROM external_identity_claims WHERE id = v_verification.claim_id);
  END IF;

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION verify_identity_by_code(TEXT, TEXT) TO authenticated, service_role;

-- Store proxy credentials (encrypted)
CREATE OR REPLACE FUNCTION store_proxy_credentials(
  p_claim_id UUID,
  p_username TEXT,
  p_password TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claim RECORD;
  v_identity RECORD;
  v_cred_id UUID;
  v_verification_id UUID;
  v_encryption_key TEXT := 'nuke_proxy_v1'; -- In production, use vault/KMS
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Get the claim
  SELECT * INTO v_claim
  FROM external_identity_claims
  WHERE id = p_claim_id AND requested_by_user_id = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Claim not found or not yours';
  END IF;

  -- Get the identity
  SELECT * INTO v_identity
  FROM external_identities
  WHERE id = v_claim.external_identity_id;

  -- Store encrypted credentials
  -- NOTE: In production, use pgcrypto: pgp_sym_encrypt(p_password, key)
  -- For now, using base64 encoding as placeholder
  INSERT INTO identity_proxy_credentials (
    external_identity_id,
    user_id,
    platform,
    encrypted_username,
    encrypted_password,
    encryption_key_id,
    consent_given_at
  ) VALUES (
    v_identity.id,
    auth.uid(),
    v_identity.platform,
    encode(convert_to(p_username, 'UTF8'), 'base64'),
    encode(convert_to(p_password, 'UTF8'), 'base64'),
    v_encryption_key,
    NOW()
  )
  ON CONFLICT (external_identity_id, platform)
  DO UPDATE SET
    encrypted_username = EXCLUDED.encrypted_username,
    encrypted_password = EXCLUDED.encrypted_password,
    updated_at = NOW()
  RETURNING id INTO v_cred_id;

  -- Create/update verification for proxy_credentials method
  INSERT INTO identity_verification_methods (
    claim_id,
    method,
    proof_data,
    base_confidence,
    status,
    actual_confidence,
    verified_at
  ) VALUES (
    p_claim_id,
    'proxy_credentials',
    jsonb_build_object('credential_id', v_cred_id, 'needs_validation', true),
    95,
    'pending', -- Will be 'verified' after we test the credentials
    NULL,
    NULL
  )
  ON CONFLICT (claim_id, method)
  DO UPDATE SET
    proof_data = jsonb_build_object('credential_id', v_cred_id, 'needs_validation', true),
    status = 'pending',
    updated_at = NOW()
  RETURNING id INTO v_verification_id;

  -- Log
  INSERT INTO identity_verification_log (claim_id, verification_id, action, actor_type, actor_id, details)
  VALUES (p_claim_id, v_verification_id, 'proxy_credentials_stored', 'user', auth.uid(),
    jsonb_build_object('platform', v_identity.platform, 'needs_validation', true));

  RETURN v_cred_id;
END;
$$;

GRANT EXECUTE ON FUNCTION store_proxy_credentials(UUID, TEXT, TEXT) TO authenticated;

-- Get verification status for a claim
CREATE OR REPLACE FUNCTION get_claim_verification_status(p_claim_id UUID)
RETURNS TABLE (
  method TEXT,
  status TEXT,
  base_confidence INTEGER,
  actual_confidence INTEGER,
  verification_code TEXT,
  expires_at TIMESTAMPTZ,
  instructions TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only allow user to see their own claims
  IF NOT EXISTS (
    SELECT 1 FROM external_identity_claims
    WHERE id = p_claim_id AND requested_by_user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Claim not found or not yours';
  END IF;

  RETURN QUERY
  SELECT
    m.method,
    m.status,
    m.base_confidence,
    m.actual_confidence,
    m.verification_code,
    m.expires_at,
    CASE m.method
      WHEN 'profile_link' THEN 'Add this code to your profile bio: ' || COALESCE(m.verification_code, '')
      WHEN 'comment_code' THEN 'Post a comment containing this code: ' || COALESCE(m.verification_code, '')
      WHEN 'email_forward' THEN 'Forward any email from the platform to verify@nuke.app with subject: ' || COALESCE(m.verification_code, '')
      WHEN 'screenshot' THEN 'Upload a screenshot showing you logged in to this account'
      WHEN 'proxy_credentials' THEN 'Provide your login credentials for proxy bidding (highest verification)'
      WHEN 'self_attestation' THEN 'Self-claimed (lowest confidence)'
      ELSE 'Follow the verification instructions'
    END AS instructions
  FROM identity_verification_methods m
  WHERE m.claim_id = p_claim_id
  ORDER BY m.base_confidence DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_claim_verification_status(UUID) TO authenticated;

-- Update proof_type constraint on external_identity_claims to include new types
DO $$
BEGIN
  ALTER TABLE external_identity_claims
    DROP CONSTRAINT IF EXISTS external_identity_claims_proof_type_check;

  ALTER TABLE external_identity_claims
    ADD CONSTRAINT external_identity_claims_proof_type_check
    CHECK (proof_type IN (
      'profile_link',
      'screenshot',
      'oauth',
      'comment_code',
      'email_forward',
      'activity_correlation',
      'proxy_credentials',
      'self_attestation',
      'other'
    ));
END $$;

-- ============================================
-- 6) Admin Functions
-- ============================================

-- Admin: manually verify a method
CREATE OR REPLACE FUNCTION admin_verify_method(
  p_verification_id UUID,
  p_confidence INTEGER DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_verification RECORD;
  v_claim RECORD;
BEGIN
  IF (auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT * INTO v_verification FROM identity_verification_methods WHERE id = p_verification_id;
  IF NOT FOUND THEN RETURN FALSE; END IF;

  -- Update verification
  UPDATE identity_verification_methods
  SET
    status = 'verified',
    actual_confidence = COALESCE(p_confidence, base_confidence),
    verified_at = NOW(),
    proof_data = proof_data || COALESCE(jsonb_build_object('admin_notes', p_notes), '{}'),
    updated_at = NOW()
  WHERE id = p_verification_id;

  -- Log
  INSERT INTO identity_verification_log (claim_id, verification_id, action, actor_type, actor_id, details)
  VALUES (v_verification.claim_id, p_verification_id, 'admin_verified', 'admin', auth.uid(),
    jsonb_build_object('confidence', COALESCE(p_confidence, v_verification.base_confidence), 'notes', p_notes));

  -- Check if claim should be auto-approved
  SELECT * INTO v_claim FROM external_identity_claims WHERE id = v_verification.claim_id;

  IF calculate_claim_confidence(v_verification.claim_id) >= 70 AND v_claim.status = 'pending' THEN
    UPDATE external_identity_claims
    SET status = 'approved', reviewed_by_user_id = auth.uid(), reviewed_at = NOW(), updated_at = NOW()
    WHERE id = v_verification.claim_id;

    UPDATE external_identities
    SET
      claimed_by_user_id = v_claim.requested_by_user_id,
      claimed_at = NOW(),
      claim_confidence = calculate_claim_confidence(v_verification.claim_id),
      updated_at = NOW()
    WHERE id = v_claim.external_identity_id;
  END IF;

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_verify_method(UUID, INTEGER, TEXT) TO service_role;

-- ============================================
-- 7) Automated Check Queue View
-- ============================================

CREATE OR REPLACE VIEW pending_verification_checks AS
SELECT
  v.id AS verification_id,
  v.claim_id,
  v.method,
  v.verification_code,
  v.status,
  v.check_count,
  v.last_check_at,
  v.expires_at,
  c.requested_by_user_id AS user_id,
  e.platform,
  e.handle,
  e.profile_url
FROM identity_verification_methods v
JOIN external_identity_claims c ON c.id = v.claim_id
JOIN external_identities e ON e.id = c.external_identity_id
WHERE v.status IN ('pending', 'checking')
  AND v.method IN ('profile_link', 'comment_code')  -- Auto-checkable methods
  AND (v.expires_at IS NULL OR v.expires_at > NOW())
  AND (v.last_check_at IS NULL OR v.last_check_at < NOW() - INTERVAL '1 hour')
ORDER BY v.created_at;

COMMENT ON VIEW pending_verification_checks IS 'Verifications that need automated checking (profile scraping).';
