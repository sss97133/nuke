-- RPC for backfill-vin-from-snapshots edge function.
-- Joins vehicles (missing VINs) to listing_page_snapshots in a single query,
-- handling trailing-slash URL mismatches.

CREATE OR REPLACE FUNCTION public.backfill_vin_find_candidates(
  p_batch_size INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0,
  p_platform TEXT DEFAULT NULL
)
RETURNS TABLE(
  vehicle_id UUID,
  vehicle_year INTEGER,
  vehicle_make TEXT,
  vehicle_model TEXT,
  snapshot_html TEXT,
  snapshot_platform TEXT
)
LANGUAGE plpgsql STABLE
AS $$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT
      v.id,
      v.year,
      v.make,
      v.model,
      -- Normalize URLs: strip trailing slash for consistent matching
      COALESCE(
        rtrim(v.bat_auction_url, '/'),
        rtrim(v.listing_url, '/'),
        rtrim(v.discovery_url, '/')
      ) AS normalized_url
    FROM vehicles v
    WHERE v.vin IS NULL
      AND v.deleted_at IS NULL
      AND (v.bat_auction_url IS NOT NULL
           OR v.listing_url IS NOT NULL
           OR v.discovery_url IS NOT NULL)
    ORDER BY v.created_at DESC
    OFFSET p_offset
    LIMIT p_batch_size
  )
  SELECT DISTINCT ON (c.id)
    c.id AS vehicle_id,
    c.year AS vehicle_year,
    c.make AS vehicle_make,
    c.model AS vehicle_model,
    s.html AS snapshot_html,
    s.platform AS snapshot_platform
  FROM candidates c
  JOIN listing_page_snapshots s
    ON rtrim(s.listing_url, '/') = c.normalized_url
    AND s.success = true
    AND s.html IS NOT NULL
    AND length(s.html) > 200
    AND (p_platform IS NULL OR s.platform = p_platform)
  ORDER BY c.id, s.fetched_at DESC;
END;
$$;

COMMENT ON FUNCTION public.backfill_vin_find_candidates IS
  'Batch-finds vehicles missing VINs that have matching archived HTML snapshots. Used by backfill-vin-from-snapshots edge function.';
