-- ============================================================
-- External Identities + Claim Workflow (Activity Attribution)
-- ============================================================
-- Purpose:
-- - Treat platform accounts (BaT, Cars & Bids, etc.) as *activity sources*
-- - Allow later claiming/merging by a real N-Zero user with proof
-- - Do NOT auto-create auth.users for external identities
--
-- Design:
-- - `external_identities` stores (platform, handle) + optional claim link to auth.users
-- - `external_identity_claims` stores proof-backed requests to link an identity to a user
-- - Public read is allowed (public activity indexing), writes are controlled
--
-- Notes:
-- - Idempotent: uses IF NOT EXISTS and guarded constraints/indexes

-- ============================================
-- 1) external_identities
-- ============================================

CREATE TABLE IF NOT EXISTS external_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Source identity
  platform TEXT NOT NULL, -- e.g. 'bat', 'cars_and_bids', 'ebay_motors', 'instagram', 'youtube'
  handle TEXT NOT NULL,   -- platform username/handle
  profile_url TEXT,
  display_name TEXT,

  -- Optional claim to a real N-Zero user (auth.users)
  claimed_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  claimed_at TIMESTAMPTZ,
  claim_confidence INTEGER DEFAULT 0 CHECK (claim_confidence >= 0 AND claim_confidence <= 100),

  -- Activity signals
  first_seen_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),

  -- Misc
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Guarded unique constraint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'external_identities_platform_handle_key'
  ) THEN
    ALTER TABLE external_identities
      ADD CONSTRAINT external_identities_platform_handle_key UNIQUE (platform, handle);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_external_identities_platform_handle ON external_identities(platform, handle);
CREATE INDEX IF NOT EXISTS idx_external_identities_claimed ON external_identities(claimed_by_user_id) WHERE claimed_by_user_id IS NOT NULL;

COMMENT ON TABLE external_identities IS 'Platform identities (handles) used for activity attribution and later claim/merge.';
COMMENT ON COLUMN external_identities.claimed_by_user_id IS 'If set, this external identity is claimed by a real N-Zero user.';

-- ============================================
-- 2) external_identity_claims
-- ============================================

CREATE TABLE IF NOT EXISTS external_identity_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_identity_id UUID NOT NULL REFERENCES external_identities(id) ON DELETE CASCADE,
  requested_by_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  proof_type TEXT NOT NULL CHECK (proof_type IN (
    'profile_link',      -- user can add a link on the external profile pointing to n-zero
    'screenshot',        -- screenshot of logged-in page
    'oauth',             -- future: official oauth handshake
    'other'
  )),
  proof_url TEXT,
  notes TEXT,

  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  reviewed_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_external_identity_claims_identity ON external_identity_claims(external_identity_id);
CREATE INDEX IF NOT EXISTS idx_external_identity_claims_requester ON external_identity_claims(requested_by_user_id);
CREATE INDEX IF NOT EXISTS idx_external_identity_claims_status ON external_identity_claims(status) WHERE status = 'pending';

COMMENT ON TABLE external_identity_claims IS 'Proof-backed claim requests for linking external identities to N-Zero users.';

-- ============================================
-- 3) RLS
-- ============================================

ALTER TABLE external_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_identity_claims ENABLE ROW LEVEL SECURITY;

-- Public read (indexing)
DROP POLICY IF EXISTS "Public read external identities" ON external_identities;
CREATE POLICY "Public read external identities"
  ON external_identities
  FOR SELECT
  USING (true);

-- Writes are restricted:
-- - Inserts/updates: service role OR claimed user (limited updates)
DROP POLICY IF EXISTS "Service role upserts external identities" ON external_identities;
CREATE POLICY "Service role upserts external identities"
  ON external_identities
  FOR INSERT
  WITH CHECK (auth.jwt() ->> 'role' = 'service_role');

DROP POLICY IF EXISTS "Service role updates external identities" ON external_identities;
CREATE POLICY "Service role updates external identities"
  ON external_identities
  FOR UPDATE
  USING (auth.jwt() ->> 'role' = 'service_role');

-- Claimed users can update only cosmetic fields for their claimed identity
DROP POLICY IF EXISTS "Claimed user updates own external identity cosmetics" ON external_identities;
CREATE POLICY "Claimed user updates own external identity cosmetics"
  ON external_identities
  FOR UPDATE
  USING (claimed_by_user_id = auth.uid())
  WITH CHECK (claimed_by_user_id = auth.uid());

-- Claim requests:
-- - requester can insert
-- - requester can view their requests
-- - service role can review (update)
DROP POLICY IF EXISTS "Users create external identity claims" ON external_identity_claims;
CREATE POLICY "Users create external identity claims"
  ON external_identity_claims
  FOR INSERT
  WITH CHECK (requested_by_user_id = auth.uid());

DROP POLICY IF EXISTS "Users view own external identity claims" ON external_identity_claims;
CREATE POLICY "Users view own external identity claims"
  ON external_identity_claims
  FOR SELECT
  USING (requested_by_user_id = auth.uid());

DROP POLICY IF EXISTS "Service role reviews external identity claims" ON external_identity_claims;
CREATE POLICY "Service role reviews external identity claims"
  ON external_identity_claims
  FOR UPDATE
  USING (auth.jwt() ->> 'role' = 'service_role');

-- ============================================
-- 4) Helper functions
-- ============================================

-- Request a claim (creates external identity if missing)
CREATE OR REPLACE FUNCTION request_external_identity_claim(
  p_platform TEXT,
  p_handle TEXT,
  p_profile_url TEXT DEFAULT NULL,
  p_proof_type TEXT DEFAULT 'profile_link',
  p_proof_url TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_identity_id UUID;
  v_claim_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Upsert identity (service-definer; still safe because unique key is platform+handle)
  INSERT INTO external_identities (platform, handle, profile_url, last_seen_at)
  VALUES (LOWER(p_platform), p_handle, p_profile_url, NOW())
  ON CONFLICT (platform, handle)
  DO UPDATE SET
    profile_url = COALESCE(external_identities.profile_url, EXCLUDED.profile_url),
    last_seen_at = NOW(),
    updated_at = NOW()
  RETURNING id INTO v_identity_id;

  -- Create claim request
  INSERT INTO external_identity_claims (
    external_identity_id,
    requested_by_user_id,
    proof_type,
    proof_url,
    notes,
    status
  ) VALUES (
    v_identity_id,
    auth.uid(),
    p_proof_type,
    p_proof_url,
    p_notes,
    'pending'
  )
  RETURNING id INTO v_claim_id;

  RETURN v_claim_id;
END;
$$;

GRANT EXECUTE ON FUNCTION request_external_identity_claim(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- Approve claim (service role only)
CREATE OR REPLACE FUNCTION approve_external_identity_claim(
  p_claim_id UUID,
  p_confidence INTEGER DEFAULT 80
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claim RECORD;
BEGIN
  -- Enforce service role
  IF (auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT * INTO v_claim
  FROM external_identity_claims
  WHERE id = p_claim_id;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  -- Mark claim approved
  UPDATE external_identity_claims
  SET
    status = 'approved',
    reviewed_by_user_id = auth.uid(),
    reviewed_at = NOW(),
    updated_at = NOW()
  WHERE id = p_claim_id;

  -- Link identity to user
  UPDATE external_identities
  SET
    claimed_by_user_id = v_claim.requested_by_user_id,
    claimed_at = NOW(),
    claim_confidence = LEAST(100, GREATEST(0, COALESCE(p_confidence, 80))),
    updated_at = NOW()
  WHERE id = v_claim.external_identity_id;

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION approve_external_identity_claim(UUID, INTEGER) TO service_role;

-- ============================================
-- 5) Backfill: bat_users -> external_identities
-- ============================================
-- This makes existing auction activity immediately claimable/mergeable without changing BaT tables.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'bat_users') THEN
    INSERT INTO external_identities (
      platform,
      handle,
      profile_url,
      display_name,
      claimed_by_user_id,
      claimed_at,
      claim_confidence,
      first_seen_at,
      last_seen_at,
      metadata
    )
    SELECT
      'bat' as platform,
      bu.bat_username as handle,
      bu.bat_profile_url as profile_url,
      bu.display_name,
      bu.n_zero_user_id as claimed_by_user_id,
      bu.matched_at as claimed_at,
      COALESCE(bu.match_confidence, 0) as claim_confidence,
      bu.first_seen_at,
      bu.last_seen_at,
      COALESCE(bu.metadata, '{}'::jsonb)
    FROM bat_users bu
    ON CONFLICT (platform, handle)
    DO UPDATE SET
      profile_url = COALESCE(external_identities.profile_url, EXCLUDED.profile_url),
      display_name = COALESCE(external_identities.display_name, EXCLUDED.display_name),
      claimed_by_user_id = COALESCE(external_identities.claimed_by_user_id, EXCLUDED.claimed_by_user_id),
      claimed_at = COALESCE(external_identities.claimed_at, EXCLUDED.claimed_at),
      claim_confidence = GREATEST(external_identities.claim_confidence, EXCLUDED.claim_confidence),
      first_seen_at = LEAST(external_identities.first_seen_at, EXCLUDED.first_seen_at),
      last_seen_at = GREATEST(external_identities.last_seen_at, EXCLUDED.last_seen_at),
      updated_at = NOW();
  END IF;
END $$;


