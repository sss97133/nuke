-- Cleanup: Fake/invalid organizations created by process-import-queue
--
-- This script identifies and removes organizations created with invalid data
-- from the import_queue processing pipeline. The issues include:
-- 1. Organizations with null or empty business_name
-- 2. Organizations with invalid/malformed websites
-- 3. Duplicate organizations created due to race conditions
-- 4. Organizations with business_name containing URLs or other invalid patterns
--
-- IMPORTANT: This is a DRY-RUN by default. Review the results before running DELETE.

-- ======================================================================================
-- 1) DRY RUN: Find suspect organizations from import_queue
-- ======================================================================================
WITH suspects AS (
  SELECT
    b.id,
    b.business_name,
    b.website,
    b.email,
    b.phone,
    b.city,
    b.state,
    b.discovered_via,
    b.source_url,
    b.created_at,
    b.updated_at,
    -- Flag the specific issues
    CASE 
      WHEN b.business_name IS NULL THEN 'null_name'
      WHEN length(trim(b.business_name)) < 3 THEN 'too_short_name'
      WHEN b.business_name ~* 'https?://' THEN 'name_contains_url'
      WHEN b.website IS NOT NULL AND b.website !~* '^https?://[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}' THEN 'invalid_website'
      ELSE 'other'
    END as issue_type
  FROM businesses b
  WHERE b.discovered_via = 'import_queue'
    AND (
      -- Organizations with null or invalid business_name
      b.business_name IS NULL
      OR length(trim(b.business_name)) < 3
      OR b.business_name ~* 'https?://'
      -- Organizations with invalid website format
      OR (b.website IS NOT NULL AND b.website !~* '^https?://[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}')
    )
)
SELECT
  issue_type,
  count(*) AS suspect_count,
  min(created_at) AS oldest,
  max(created_at) AS newest
FROM suspects
GROUP BY issue_type
ORDER BY suspect_count DESC;

-- ======================================================================================
-- 2) DRY RUN: Sample suspect organizations for review
-- ======================================================================================
SELECT
  id,
  business_name,
  website,
  email,
  phone,
  city,
  state,
  discovered_via,
  source_url,
  created_at,
  CASE 
    WHEN business_name IS NULL THEN 'NULL name'
    WHEN length(trim(business_name)) < 3 THEN 'Name too short'
    WHEN business_name ~* 'https?://' THEN 'Name contains URL'
    WHEN website IS NOT NULL AND website !~* '^https?://[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}' THEN 'Invalid website'
    ELSE 'Other issue'
  END as issue_description
FROM businesses
WHERE discovered_via = 'import_queue'
  AND (
    business_name IS NULL
    OR length(trim(business_name)) < 3
    OR business_name ~* 'https?://'
    OR (website IS NOT NULL AND website !~* '^https?://[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}')
  )
ORDER BY created_at DESC
LIMIT 50;

-- ======================================================================================
-- 3) DRY RUN: Find safe-to-delete organizations (no dependencies)
-- ======================================================================================
WITH suspects AS (
  SELECT b.id, b.business_name, b.website, b.discovered_via, b.created_at
  FROM businesses b
  WHERE b.discovered_via = 'import_queue'
    AND (
      b.business_name IS NULL
      OR length(trim(b.business_name)) < 3
      OR b.business_name ~* 'https?://'
      OR (b.website IS NOT NULL AND b.website !~* '^https?://[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}')
    )
),
safe_to_delete AS (
  SELECT s.*
  FROM suspects s
  WHERE NOT EXISTS (SELECT 1 FROM organization_contributors oc WHERE oc.organization_id = s.id)
    AND NOT EXISTS (SELECT 1 FROM organization_vehicles ov WHERE ov.organization_id = s.id AND ov.status = 'active')
    AND NOT EXISTS (SELECT 1 FROM organization_images oi WHERE oi.organization_id = s.id)
    AND NOT EXISTS (SELECT 1 FROM business_team_data btd WHERE btd.business_id = s.id)
    AND NOT EXISTS (SELECT 1 FROM business_ownership bo WHERE bo.business_id = s.id)
    AND NOT EXISTS (SELECT 1 FROM business_user_roles bur WHERE bur.business_id = s.id)
)
SELECT
  count(*) AS safe_to_delete_count,
  min(created_at) AS oldest,
  max(created_at) AS newest,
  array_agg(id) as ids_to_delete
FROM safe_to_delete;

-- ======================================================================================
-- 4) DRY RUN: Find duplicate organizations (same website or name)
-- ======================================================================================
WITH duplicates_by_website AS (
  SELECT website, count(*) as count, array_agg(id ORDER BY created_at) as org_ids
  FROM businesses
  WHERE discovered_via = 'import_queue'
    AND website IS NOT NULL
    AND website ~* '^https?://[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}'
  GROUP BY website
  HAVING count(*) > 1
),
duplicates_by_name AS (
  SELECT business_name, count(*) as count, array_agg(id ORDER BY created_at) as org_ids
  FROM businesses
  WHERE discovered_via = 'import_queue'
    AND business_name IS NOT NULL
    AND length(trim(business_name)) >= 3
    AND business_name !~* 'https?://'
  GROUP BY business_name
  HAVING count(*) > 1
)
SELECT 
  'website' as duplicate_type,
  website as duplicate_key,
  count,
  org_ids[1] as keep_id,
  org_ids[2:] as duplicate_ids
FROM duplicates_by_website
UNION ALL
SELECT 
  'name' as duplicate_type,
  business_name as duplicate_key,
  count,
  org_ids[1] as keep_id,
  org_ids[2:] as duplicate_ids
FROM duplicates_by_name
ORDER BY count DESC
LIMIT 50;

-- ======================================================================================
-- 5) DELETE (DISABLED BY DEFAULT - REMOVE COMMENTS TO ENABLE)
-- ======================================================================================
-- WARNING: Review all DRY-RUN queries above before running this!
-- Set a created_at cutoff to limit the scope of deletion.
--
-- BEGIN;
-- 
-- -- Delete invalid organizations with no dependencies
-- WITH suspects AS (
--   SELECT b.id
--   FROM businesses b
--   WHERE b.discovered_via = 'import_queue'
--     AND b.created_at >= '2025-01-01T00:00:00Z'  -- ADJUST THIS DATE!
--     AND (
--       b.business_name IS NULL
--       OR length(trim(b.business_name)) < 3
--       OR b.business_name ~* 'https?://'
--       OR (b.website IS NOT NULL AND b.website !~* '^https?://[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}')
--     )
-- ),
-- safe_to_delete AS (
--   SELECT s.id
--   FROM suspects s
--   WHERE NOT EXISTS (SELECT 1 FROM organization_contributors oc WHERE oc.organization_id = s.id)
--     AND NOT EXISTS (SELECT 1 FROM organization_vehicles ov WHERE ov.organization_id = s.id AND ov.status = 'active')
--     AND NOT EXISTS (SELECT 1 FROM organization_images oi WHERE oi.organization_id = s.id)
--     AND NOT EXISTS (SELECT 1 FROM business_team_data btd WHERE btd.business_id = s.id)
--     AND NOT EXISTS (SELECT 1 FROM business_ownership bo WHERE bo.business_id = s.id)
--     AND NOT EXISTS (SELECT 1 FROM business_user_roles bur WHERE bur.business_id = s.id)
-- )
-- DELETE FROM businesses b
-- USING safe_to_delete d
-- WHERE b.id = d.id;
--
-- COMMIT;

