-- Overall provenance health
SELECT
  COUNT(*) as total_orgs,
  COUNT(discovered_by) as has_discovered_by,
  COUNT(source_url) as has_source_url,
  COUNT(website) as has_website,
  COUNT(metadata->'org_intake') as has_intake_metadata
FROM businesses
WHERE is_public = true;

-- Breakdown by provenance quality
SELECT
  CASE
    WHEN discovered_by IS NOT NULL AND (source_url IS NOT NULL OR website IS NOT NULL) THEN 'good_provenance'
    WHEN discovered_by IS NOT NULL THEN 'has_user_no_url'
    WHEN source_url IS NOT NULL OR website IS NOT NULL THEN 'has_url_no_user'
    ELSE 'orphan_garbage'
  END as provenance_quality,
  COUNT(*) as count,
  STRING_AGG(business_name, ', ' ORDER BY created_at DESC) as examples
FROM businesses
WHERE is_public = true
GROUP BY 1
ORDER BY count DESC;

-- Find garbage orgs (no provenance, no data)
SELECT
  id,
  business_name,
  business_type,
  created_at,
  discovered_by,
  source_url,
  website,
  description IS NOT NULL as has_description,
  logo_url IS NOT NULL as has_logo
FROM businesses
WHERE is_public = true
  AND discovered_by IS NULL
  AND source_url IS NULL
  AND website IS NULL
ORDER BY created_at DESC
LIMIT 50;

-- Check org_intake metadata patterns
SELECT
  metadata->'org_intake'->>'method' as creation_method,
  COUNT(*) as count
FROM businesses
WHERE metadata->'org_intake' IS NOT NULL
GROUP BY 1
ORDER BY count DESC;

-- Orgs with active contributors
SELECT
  b.id,
  b.business_name,
  COUNT(oc.id) as contributor_count,
  STRING_AGG(DISTINCT oc.role, ', ') as roles
FROM businesses b
LEFT JOIN organization_contributors oc ON oc.organization_id = b.id AND oc.status = 'active'
WHERE b.is_public = true
GROUP BY b.id, b.business_name
HAVING COUNT(oc.id) = 0
ORDER BY b.created_at DESC
LIMIT 30;
