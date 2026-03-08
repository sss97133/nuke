-- ============================================================================
-- Nuke Organization Provenance Fix Script
-- Date: 2026-01-25
-- Purpose: Fix provenance issues found in audit
-- ============================================================================

-- Before running: Review the audit report at:
-- /Users/skylar/nuke/ORG_PROVENANCE_AUDIT_FINAL_2026-01-25.md

BEGIN;

-- ============================================================================
-- STEP 1: Migrate provenance from metadata to proper columns
-- ============================================================================
-- Found: 1 org ("Seller") has provenance in metadata.discovered_from
-- instead of source_url column

-- Extract source_url from metadata.discovered_from
UPDATE businesses
SET source_url = metadata->>'discovered_from'
WHERE source_url IS NULL
  AND metadata->>'discovered_from' IS NOT NULL;

-- Extract discovered_via from metadata.platform
UPDATE businesses
SET discovered_via = metadata->>'platform'
WHERE discovered_via IS NULL
  AND metadata->>'platform' IS NOT NULL;

-- Verify the fix
SELECT id, business_name, source_url, discovered_via, metadata
FROM businesses
WHERE metadata->>'discovered_from' IS NOT NULL;

-- ============================================================================
-- STEP 2: Create system user for backfilling discovered_by
-- ============================================================================
-- 216 orgs (96.4%) lack discovered_by field
-- These are system-created orgs from scrapers/imports

-- Check if system user exists
DO $$
BEGIN
  -- Create system user in auth.users if it doesn't exist
  -- NOTE: This may require superuser permissions or direct access to auth schema
  -- Adjust the user_id below if you have an existing system user

  -- For now, just prepare the update statement
  -- You'll need to replace '00000000-0000-0000-0000-000000000001' with actual system user ID

  RAISE NOTICE 'Ready to backfill discovered_by for % orgs',
    (SELECT COUNT(*) FROM businesses WHERE discovered_by IS NULL);
END $$;

-- Uncomment and run this after creating/identifying your system user:
/*
UPDATE businesses
SET discovered_by = '00000000-0000-0000-0000-000000000001'  -- Replace with actual system user ID
WHERE discovered_by IS NULL
  AND (source_url IS NOT NULL OR website IS NOT NULL);
*/

-- ============================================================================
-- STEP 3: Add org_intake metadata for tracking
-- ============================================================================
-- Currently 0 orgs have org_intake metadata
-- Add it retroactively for existing orgs based on available data

-- Backfill org_intake metadata for system-created orgs
UPDATE businesses
SET metadata = jsonb_set(
  COALESCE(metadata, '{}'::jsonb),
  '{org_intake}',
  jsonb_build_object(
    'method', 'scraper_import',
    'backfilled_at', NOW()::text,
    'backfilled_from', 'audit_2026_01_25'
  )
)
WHERE discovered_by IS NULL
  AND (source_url IS NOT NULL OR website IS NOT NULL)
  AND metadata->'org_intake' IS NULL;

-- Backfill org_intake metadata for user-created orgs
UPDATE businesses
SET metadata = jsonb_set(
  COALESCE(metadata, '{}'::jsonb),
  '{org_intake}',
  jsonb_build_object(
    'method', 'user_created',
    'user_id', discovered_by,
    'backfilled_at', NOW()::text,
    'backfilled_from', 'audit_2026_01_25'
  )
)
WHERE discovered_by IS NOT NULL
  AND metadata->'org_intake' IS NULL;

-- ============================================================================
-- STEP 4: Verification queries
-- ============================================================================

-- Check provenance quality after fixes
SELECT
  CASE
    WHEN discovered_by IS NOT NULL AND (source_url IS NOT NULL OR website IS NOT NULL) THEN 'good_provenance'
    WHEN discovered_by IS NOT NULL THEN 'has_user_no_url'
    WHEN source_url IS NOT NULL OR website IS NOT NULL THEN 'has_url_no_user'
    ELSE 'orphan_garbage'
  END as provenance_quality,
  COUNT(*) as count
FROM businesses
WHERE is_public = true
GROUP BY 1
ORDER BY count DESC;

-- Check org_intake metadata after backfill
SELECT
  metadata->'org_intake'->>'method' as creation_method,
  COUNT(*) as count
FROM businesses
WHERE metadata->'org_intake' IS NOT NULL
GROUP BY 1
ORDER BY count DESC;

-- Find remaining orphans (should be 0 after Step 1)
SELECT id, business_name, metadata
FROM businesses
WHERE is_public = true
  AND discovered_by IS NULL
  AND source_url IS NULL
  AND website IS NULL;

COMMIT;

-- ============================================================================
-- MANUAL ACTIONS STILL NEEDED
-- ============================================================================

-- 1. Add website URLs for these 6 user-created orgs:
--    - Desert Performance (57ab7cf9-4b8a-4176-a009-cc4834338f7e)
--    - Taylor Customs (66352790-b70e-4de8-bfb1-006b91fa556f)
--    - FBM (f26e26f9-78d6-4f73-820b-fa9015d9242b)
--    - Viva! Las Vegas Autos (c433d27e-2159-4f8c-b4ae-32a5e44a77cf)
--    - Ernies Upholstery (e796ca48-f3af-41b5-be13-5335bb422b41)
--    - Hot Kiss Restoration (1f76d43c-4dd6-4ee9-99df-6c46fd284654)

-- Example update:
/*
UPDATE businesses
SET website = 'https://example.com'
WHERE id = '57ab7cf9-4b8a-4176-a009-cc4834338f7e';
*/

-- 2. Create/identify system user ID for discovered_by backfill
--    Then uncomment and run the UPDATE in STEP 2 above

-- 3. Audit and deduplicate auction house entries
--    Found multiple instances of "Bring a Trailer", "Cars and Bids", etc.

-- ============================================================================
-- END OF SCRIPT
-- ============================================================================
