-- Cleanup: Bad-quality scraped business/org profiles in public.businesses
--
-- Goal:
-- - Provide a SAFE, SCOPED cleanup path for businesses created by scrapers where fields are clearly mis-mapped.
-- - Default behavior is DRY-RUN (no mutations). The destructive section is explicit and requires toggling.
--
-- Recommended workflow:
-- 1) Run DRY-RUN queries and review sample rows.
-- 2) If it looks correct, set a time window (created_at cutoff) AND require "no dependencies".
-- 3) Only then run the DELETE section.
--
-- IMPORTANT:
-- - This script intentionally only targets records discovered via scraping pipelines.
-- - It also requires that the business has no dependent links (ownership, contributors, vehicles, team data, images, etc).
--
-- ======================================================================================
-- Parameters (edit these before running)
-- ======================================================================================
-- Adjust as needed: focus on the timeframe when the bad scraper ran.
-- Example: '2025-12-01T00:00:00Z'
DO $$
BEGIN
  -- No-op block: edit the variables below in your SQL client if supported, or just edit the literals in queries.
END $$;

-- ======================================================================================
-- 1) DRY RUN: Find suspect businesses created by scraping
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
    b.zip_code,
    b.dealer_license,
    b.type,
    b.business_type,
    b.discovered_via,
    b.source_url,
    b.created_at,
    b.updated_at
  FROM businesses b
  WHERE b.discovered_via IN ('scraper', 'classic_com_indexing', 'facebook_marketplace_import')
    AND (
      b.business_name IS NULL
      OR length(trim(b.business_name)) < 3
      OR b.business_name ~* 'https?://'
      OR b.business_name ~* 'facebook\.com|classic\.com'
      OR (b.website IS NOT NULL AND b.website !~* '^https?://')
      OR (b.email IS NOT NULL AND b.email !~* '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$')
      OR (b.state IS NOT NULL AND b.state !~ '^[A-Z]{2}$')
      OR (b.zip_code IS NOT NULL AND b.zip_code !~ '^\\d{5}(-\\d{4})?$')
    )
)
SELECT
  discovered_via,
  count(*) AS suspect_count,
  min(created_at) AS oldest,
  max(created_at) AS newest
FROM suspects
GROUP BY discovered_via
ORDER BY suspect_count DESC;

-- Sample the worst offenders (review manually)
WITH suspects AS (
  SELECT
    b.*,
    (b.business_name ~* 'https?://') AS name_looks_like_url,
    (b.website IS NOT NULL AND b.website !~* '^https?://') AS website_invalid,
    (b.email IS NOT NULL AND b.email !~* '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$') AS email_invalid,
    (b.state IS NOT NULL AND b.state !~ '^[A-Z]{2}$') AS state_invalid,
    (b.zip_code IS NOT NULL AND b.zip_code !~ '^\\d{5}(-\\d{4})?$') AS zip_invalid
  FROM businesses b
  WHERE b.discovered_via IN ('scraper', 'classic_com_indexing', 'facebook_marketplace_import')
)
SELECT
  id,
  business_name,
  website,
  email,
  phone,
  city,
  state,
  zip_code,
  dealer_license,
  type,
  business_type,
  discovered_via,
  source_url,
  created_at,
  name_looks_like_url,
  website_invalid,
  email_invalid,
  state_invalid,
  zip_invalid
FROM suspects
WHERE name_looks_like_url OR website_invalid OR email_invalid OR state_invalid OR zip_invalid
ORDER BY created_at DESC
LIMIT 50;

-- ======================================================================================
-- 2) DRY RUN: Narrow to SAFE-TO-DELETE (no dependencies)
-- ======================================================================================
-- Dependencies checked:
-- - organization_contributors
-- - organization_vehicles
-- - organization_images
-- - business_team_data
-- - business_ownership
-- - business_user_roles
WITH suspects AS (
  SELECT b.id, b.business_name, b.discovered_via, b.created_at
  FROM businesses b
  WHERE b.discovered_via IN ('scraper', 'classic_com_indexing', 'facebook_marketplace_import')
    AND (
      b.business_name IS NULL
      OR length(trim(b.business_name)) < 3
      OR b.business_name ~* 'https?://'
      OR (b.website IS NOT NULL AND b.website !~* '^https?://')
    )
),
safe_to_delete AS (
  SELECT s.*
  FROM suspects s
  WHERE NOT EXISTS (SELECT 1 FROM organization_contributors oc WHERE oc.organization_id = s.id)
    AND NOT EXISTS (SELECT 1 FROM organization_vehicles ov WHERE ov.organization_id = s.id)
    AND NOT EXISTS (SELECT 1 FROM organization_images oi WHERE oi.organization_id = s.id)
    AND NOT EXISTS (SELECT 1 FROM business_team_data btd WHERE btd.business_id = s.id)
    AND NOT EXISTS (SELECT 1 FROM business_ownership bo WHERE bo.business_id = s.id)
    AND NOT EXISTS (SELECT 1 FROM business_user_roles bur WHERE bur.business_id = s.id)
)
SELECT
  discovered_via,
  count(*) AS safe_to_delete_count,
  min(created_at) AS oldest,
  max(created_at) AS newest
FROM safe_to_delete
GROUP BY discovered_via
ORDER BY safe_to_delete_count DESC;

-- ======================================================================================
-- 3) DELETE (DISABLED BY DEFAULT)
-- ======================================================================================
-- To enable, remove the leading "-- " from the DELETE block and set a created_at cutoff.
--
-- SAFETY TIP:
-- - Start with a tight created_at window, confirm counts, then widen if needed.
--
-- BEGIN;
-- WITH suspects AS (
--   SELECT b.id
--   FROM businesses b
--   WHERE b.discovered_via IN ('scraper', 'classic_com_indexing', 'facebook_marketplace_import')
--     AND b.created_at >= '2025-12-01T00:00:00Z'
--     AND (
--       b.business_name IS NULL
--       OR length(trim(b.business_name)) < 3
--       OR b.business_name ~* 'https?://'
--       OR (b.website IS NOT NULL AND b.website !~* '^https?://')
--     )
-- ),
-- safe_to_delete AS (
--   SELECT s.id
--   FROM suspects s
--   WHERE NOT EXISTS (SELECT 1 FROM organization_contributors oc WHERE oc.organization_id = s.id)
--     AND NOT EXISTS (SELECT 1 FROM organization_vehicles ov WHERE ov.organization_id = s.id)
--     AND NOT EXISTS (SELECT 1 FROM organization_images oi WHERE oi.organization_id = s.id)
--     AND NOT EXISTS (SELECT 1 FROM business_team_data btd WHERE btd.business_id = s.id)
--     AND NOT EXISTS (SELECT 1 FROM business_ownership bo WHERE bo.business_id = s.id)
--     AND NOT EXISTS (SELECT 1 FROM business_user_roles bur WHERE bur.business_id = s.id)
-- )
-- DELETE FROM businesses b
-- USING safe_to_delete d
-- WHERE b.id = d.id;
-- COMMIT;


