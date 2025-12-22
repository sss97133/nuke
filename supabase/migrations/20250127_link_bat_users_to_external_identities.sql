-- ==========================================================================
-- LINK BaT USERS TO EXTERNAL IDENTITIES
-- ==========================================================================
-- Purpose: Create external_identities records for bat_users that don't have them
--          This enables claiming and profile stats aggregation
-- ==========================================================================

-- Create external_identities for bat_users that don't have them
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
  COALESCE(bu.first_seen_at, bu.created_at) as first_seen_at,
  COALESCE(bu.last_seen_at, bu.updated_at) as last_seen_at,
  COALESCE(bu.metadata, '{}'::jsonb) as metadata
FROM bat_users bu
WHERE NOT EXISTS (
  SELECT 1 FROM external_identities ei
  WHERE ei.platform = 'bat'
    AND ei.handle = bu.bat_username
)
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

-- Update bat_users to reference external_identities (if a column exists for this)
-- Note: This is optional - the link is via platform + handle, not a direct FK

COMMENT ON FUNCTION backfill_user_profile_stats IS 
  'Backfills profile stats for a user by aggregating data from external identities (BaT, etc.)';

