-- ==========================================================================
-- LINK BaT COMMENTS TO EXTERNAL IDENTITIES
-- ==========================================================================
-- Purpose: Link bat_comments to external_identities so we can track user activity
--          This enables profile stats aggregation
-- ==========================================================================

-- Update bat_comments to link to external_identities
UPDATE bat_comments bc
SET external_identity_id = ei.id
FROM external_identities ei
WHERE ei.platform = 'bat'
  AND ei.handle = bc.bat_username
  AND bc.external_identity_id IS NULL
  AND bc.bat_username IS NOT NULL;

-- Verify the update
SELECT 
  COUNT(*) as total_comments,
  COUNT(CASE WHEN external_identity_id IS NOT NULL THEN 1 END) as linked_comments,
  COUNT(CASE WHEN external_identity_id IS NULL THEN 1 END) as unlinked_comments
FROM bat_comments;

