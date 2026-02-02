-- ============================================================
-- UNIFIED VERIFICATION SYSTEM
-- ============================================================
-- Consolidates the fragmented 22-table verification mess into
-- one simple flow: text us proof -> we verify -> you're in
--
-- This leverages existing tables but adds SMS integration:
-- - user_verifications (for ID/face/phone)
-- - ownership_verifications (for titles)
-- - external_identity_claims (for platform identity claims)
--
-- Core principle: SMS is the primary interface, web is backup
-- ============================================================

-- ============================================
-- 1) SMS Verification Submissions
-- ============================================
-- When someone texts a photo for verification, it lands here first
-- Then routes to the appropriate verification table

CREATE TABLE IF NOT EXISTS sms_verification_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Who submitted
  from_phone TEXT NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  message_sid TEXT, -- Twilio message ID

  -- What they're verifying
  verification_type TEXT NOT NULL CHECK (verification_type IN (
    'identity',        -- ID + face scan
    'title',           -- Vehicle title
    'platform_claim',  -- BaT/C&B username claim
    'phone'            -- Phone number verification
  )),

  -- Media
  media_urls TEXT[] DEFAULT '{}',
  message_body TEXT,

  -- AI Processing
  ai_processed_at TIMESTAMPTZ,
  ai_result JSONB DEFAULT '{}',
  ai_confidence NUMERIC(3,2),

  -- Extracted Data
  extracted_name TEXT,
  extracted_address TEXT,
  extracted_vin TEXT,
  extracted_platform TEXT,
  extracted_handle TEXT,

  -- Routing
  routed_to_table TEXT, -- 'user_verifications', 'ownership_verifications', 'external_identity_claims'
  routed_to_id UUID,

  -- Status
  status TEXT DEFAULT 'received' CHECK (status IN (
    'received',
    'processing',
    'routed',
    'needs_more',
    'verified',
    'rejected'
  )),

  -- Follow-up
  follow_up_sent_at TIMESTAMPTZ,
  follow_up_response TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sms_verif_phone ON sms_verification_submissions(from_phone);
CREATE INDEX IF NOT EXISTS idx_sms_verif_user ON sms_verification_submissions(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sms_verif_status ON sms_verification_submissions(status) WHERE status NOT IN ('verified', 'rejected');

COMMENT ON TABLE sms_verification_submissions IS 'Unified intake for all SMS-based verification submissions. Routes to user_verifications, ownership_verifications, or external_identity_claims.';

-- ============================================
-- 2) Verification Confidence Scores
-- ============================================
-- Central table for confidence levels across all verification types

CREATE TABLE IF NOT EXISTS verification_confidence_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  verification_type TEXT NOT NULL,
  proof_method TEXT NOT NULL,
  base_confidence INTEGER NOT NULL CHECK (base_confidence BETWEEN 0 AND 100),
  description TEXT,
  requires_ai BOOLEAN DEFAULT false,
  requires_human BOOLEAN DEFAULT false,
  UNIQUE(verification_type, proof_method)
);

-- Seed default confidence levels
INSERT INTO verification_confidence_config (verification_type, proof_method, base_confidence, description, requires_ai, requires_human) VALUES
  -- Identity verification
  ('identity', 'face_scan_live', 95, 'Live face scan matches ID', true, false),
  ('identity', 'id_photo', 80, 'Government ID photo', true, false),
  ('identity', 'id_with_selfie', 90, 'ID + selfie in same shot', true, false),
  ('identity', 'phone_verified', 60, 'Phone number confirmed via SMS code', false, false),
  ('identity', 'email_verified', 40, 'Email confirmed via link', false, false),

  -- Title/ownership verification
  ('title', 'title_photo', 85, 'Clear title document photo', true, false),
  ('title', 'title_with_id', 95, 'Title + matching ID', true, false),
  ('title', 'registration', 70, 'Current registration document', true, false),
  ('title', 'insurance_doc', 60, 'Insurance showing ownership', true, false),

  -- Platform identity claims
  ('platform_claim', 'proxy_login', 95, 'Login credentials that work', true, false),
  ('platform_claim', 'profile_code', 85, 'Verification code in profile bio', true, false),
  ('platform_claim', 'comment_code', 80, 'Verification code posted as comment', true, false),
  ('platform_claim', 'email_forward', 70, 'Forwarded email from platform', true, false),
  ('platform_claim', 'screenshot', 40, 'Screenshot of logged-in state', true, true),
  ('platform_claim', 'self_claim', 20, 'User claims without proof', false, true)
ON CONFLICT (verification_type, proof_method) DO NOTHING;

-- ============================================
-- 3) Link existing claims to SMS flow
-- ============================================

-- Add SMS submission reference to external_identity_claims
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'external_identity_claims' AND column_name = 'sms_submission_id'
  ) THEN
    ALTER TABLE external_identity_claims
    ADD COLUMN sms_submission_id UUID REFERENCES sms_verification_submissions(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'external_identity_claims' AND column_name = 'confidence_score'
  ) THEN
    ALTER TABLE external_identity_claims
    ADD COLUMN confidence_score INTEGER DEFAULT 0;
  END IF;
END $$;

-- Add SMS submission reference to user_verifications
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_verifications' AND column_name = 'sms_submission_id'
  ) THEN
    ALTER TABLE user_verifications
    ADD COLUMN sms_submission_id UUID REFERENCES sms_verification_submissions(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Add SMS submission reference to ownership_verifications
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ownership_verifications' AND column_name = 'sms_submission_id'
  ) THEN
    ALTER TABLE ownership_verifications
    ADD COLUMN sms_submission_id UUID REFERENCES sms_verification_submissions(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ============================================
-- 4) Simple verification function
-- ============================================

-- Process a verification submission (called after AI analysis)
CREATE OR REPLACE FUNCTION process_verification_submission(
  p_submission_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sub RECORD;
  v_result JSONB := '{}';
  v_confidence INTEGER;
  v_routed_id UUID;
BEGIN
  -- Get submission
  SELECT * INTO v_sub FROM sms_verification_submissions WHERE id = p_submission_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Submission not found');
  END IF;

  -- Route based on type
  CASE v_sub.verification_type
    WHEN 'identity' THEN
      -- Route to user_verifications
      INSERT INTO user_verifications (
        user_id,
        verification_type,
        status,
        document_url,
        document_metadata,
        sms_submission_id,
        created_at
      ) VALUES (
        v_sub.user_id,
        'id_document',
        'pending',
        v_sub.media_urls[1],
        v_sub.ai_result,
        p_submission_id,
        NOW()
      )
      RETURNING id INTO v_routed_id;

      v_result := jsonb_build_object('routed_to', 'user_verifications', 'id', v_routed_id);

    WHEN 'title' THEN
      -- Route to ownership_verifications
      INSERT INTO ownership_verifications (
        user_id,
        status,
        title_document_url,
        extracted_data,
        title_owner_name,
        vehicle_vin_from_title,
        ai_confidence_score,
        sms_submission_id,
        submitted_at
      ) VALUES (
        v_sub.user_id,
        'pending',
        v_sub.media_urls[1],
        v_sub.ai_result,
        v_sub.extracted_name,
        v_sub.extracted_vin,
        v_sub.ai_confidence,
        p_submission_id,
        NOW()
      )
      RETURNING id INTO v_routed_id;

      v_result := jsonb_build_object('routed_to', 'ownership_verifications', 'id', v_routed_id);

    WHEN 'platform_claim' THEN
      -- Get confidence for this proof method
      SELECT base_confidence INTO v_confidence
      FROM verification_confidence_config
      WHERE verification_type = 'platform_claim'
      AND proof_method = COALESCE(v_sub.ai_result->>'detected_proof_method', 'self_claim');

      -- Upsert external identity
      INSERT INTO external_identities (platform, handle, profile_url, last_seen_at)
      VALUES (
        v_sub.extracted_platform,
        v_sub.extracted_handle,
        v_sub.ai_result->>'profile_url',
        NOW()
      )
      ON CONFLICT (platform, handle) DO UPDATE
      SET last_seen_at = NOW(), updated_at = NOW();

      -- Create claim
      INSERT INTO external_identity_claims (
        external_identity_id,
        requested_by_user_id,
        proof_type,
        proof_url,
        status,
        confidence_score,
        sms_submission_id,
        created_at
      )
      SELECT
        e.id,
        v_sub.user_id,
        COALESCE(v_sub.ai_result->>'detected_proof_method', 'other'),
        v_sub.media_urls[1],
        CASE WHEN COALESCE(v_confidence, 0) >= 70 THEN 'approved' ELSE 'pending' END,
        COALESCE(v_confidence, 20),
        p_submission_id,
        NOW()
      FROM external_identities e
      WHERE e.platform = v_sub.extracted_platform AND e.handle = v_sub.extracted_handle
      RETURNING id INTO v_routed_id;

      -- If high confidence, auto-approve
      IF COALESCE(v_confidence, 0) >= 70 THEN
        UPDATE external_identities
        SET
          claimed_by_user_id = v_sub.user_id,
          claimed_at = NOW(),
          claim_confidence = v_confidence
        WHERE platform = v_sub.extracted_platform AND handle = v_sub.extracted_handle;
      END IF;

      v_result := jsonb_build_object(
        'routed_to', 'external_identity_claims',
        'id', v_routed_id,
        'confidence', COALESCE(v_confidence, 20),
        'auto_approved', COALESCE(v_confidence, 0) >= 70
      );

    ELSE
      v_result := jsonb_build_object('error', 'Unknown verification type');
  END CASE;

  -- Update submission
  UPDATE sms_verification_submissions
  SET
    status = 'routed',
    routed_to_table = v_result->>'routed_to',
    routed_to_id = (v_result->>'id')::UUID,
    updated_at = NOW()
  WHERE id = p_submission_id;

  RETURN v_result;
END;
$$;

-- ============================================
-- 5) RLS
-- ============================================

ALTER TABLE sms_verification_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification_confidence_config ENABLE ROW LEVEL SECURITY;

-- Users see their own submissions
DROP POLICY IF EXISTS "Users view own sms verifications" ON sms_verification_submissions;
CREATE POLICY "Users view own sms verifications"
  ON sms_verification_submissions
  FOR SELECT
  USING (user_id = auth.uid());

-- Service role manages all
DROP POLICY IF EXISTS "Service role manages sms verifications" ON sms_verification_submissions;
CREATE POLICY "Service role manages sms verifications"
  ON sms_verification_submissions
  FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

-- Public read on confidence config
DROP POLICY IF EXISTS "Public read confidence config" ON verification_confidence_config;
CREATE POLICY "Public read confidence config"
  ON verification_confidence_config
  FOR SELECT
  USING (true);

-- ============================================
-- 6) Cleanup: Drop overly-complex tables I created
-- ============================================
-- These added complexity without value

DROP TABLE IF EXISTS identity_verification_log CASCADE;
DROP TABLE IF EXISTS identity_proxy_credentials CASCADE;
DROP TABLE IF EXISTS identity_verification_methods CASCADE;

-- Remove the view that depends on dropped tables
DROP VIEW IF EXISTS pending_verification_checks CASCADE;

-- ============================================
-- 7) Unified verification status view
-- ============================================

CREATE OR REPLACE VIEW user_verification_status AS
SELECT
  u.id AS user_id,
  COALESCE(p.email, p.phone_number) AS identifier,

  -- Identity verification
  (SELECT status FROM user_verifications
   WHERE user_id = u.id AND verification_type = 'id_document'
   ORDER BY created_at DESC LIMIT 1) AS identity_status,

  -- Phone verification
  (SELECT status FROM user_verifications
   WHERE user_id = u.id AND verification_type = 'phone'
   ORDER BY created_at DESC LIMIT 1) AS phone_status,

  -- Claimed identities count
  (SELECT COUNT(*) FROM external_identities
   WHERE claimed_by_user_id = u.id) AS claimed_identities,

  -- Verified vehicles count
  (SELECT COUNT(*) FROM ownership_verifications
   WHERE user_id = u.id AND status = 'approved') AS verified_vehicles,

  -- Overall verification level
  CASE
    WHEN EXISTS (SELECT 1 FROM user_verifications WHERE user_id = u.id AND status = 'approved' AND verification_type = 'id_document')
         AND EXISTS (SELECT 1 FROM ownership_verifications WHERE user_id = u.id AND status = 'approved')
    THEN 'full'
    WHEN EXISTS (SELECT 1 FROM user_verifications WHERE user_id = u.id AND status = 'approved')
    THEN 'identity'
    WHEN EXISTS (SELECT 1 FROM external_identities WHERE claimed_by_user_id = u.id)
    THEN 'platform'
    ELSE 'none'
  END AS verification_level

FROM auth.users u
LEFT JOIN profiles p ON p.id = u.id;

COMMENT ON VIEW user_verification_status IS 'Unified view of all verification statuses per user.';
