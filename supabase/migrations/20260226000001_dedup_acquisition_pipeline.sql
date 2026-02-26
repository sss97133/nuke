-- Dedup acquisition_pipeline
--
-- Two patterns:
-- 1. cl:// stub + real https:// record for same vehicle — delete the stub
-- 2. Same CL listing ID appearing under multiple regional domains — keep best scored

-- -----------------------------------------------------------------------
-- 1. Delete cl:// stubs where a real https:// record exists for the same
--    vehicle (matched on year, make, model, asking_price, location_city, location_state)
-- -----------------------------------------------------------------------
DELETE FROM acquisition_pipeline
WHERE id IN (
  SELECT cl.id
  FROM acquisition_pipeline cl
  JOIN acquisition_pipeline real
    ON  cl.year              IS NOT DISTINCT FROM real.year
    AND cl.make              = real.make
    AND cl.model             IS NOT DISTINCT FROM real.model
    AND cl.asking_price      IS NOT DISTINCT FROM real.asking_price
    AND cl.location_city     IS NOT DISTINCT FROM real.location_city
    AND cl.location_state    IS NOT DISTINCT FROM real.location_state
  WHERE cl.discovery_url   LIKE 'cl://%'
    AND real.discovery_url LIKE 'https://%'
);

-- -----------------------------------------------------------------------
-- 2. Dedup cross-region reposts: same CL listing ID, different domains
--    Extract listing ID (trailing 10-digit number) from URL, keep the row
--    with the highest deal_score (or earliest created_at on tie)
-- -----------------------------------------------------------------------
DELETE FROM acquisition_pipeline
WHERE id IN (
  SELECT id FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY (regexp_match(discovery_url, '/(\d{10})(?:\.html)?$'))[1]
        ORDER BY deal_score DESC NULLS LAST, created_at ASC
      ) AS rn
    FROM acquisition_pipeline
    WHERE discovery_url LIKE 'https://%'
      AND discovery_url ~ '/\d{10}(\.html)?$'
  ) ranked
  WHERE rn > 1
);

-- Verify
SELECT
  COUNT(*) FILTER (WHERE discovery_url LIKE 'cl://%')   AS cl_stubs_remaining,
  COUNT(*) FILTER (WHERE discovery_url LIKE 'https://%') AS real_urls,
  COUNT(*) AS total
FROM acquisition_pipeline;
