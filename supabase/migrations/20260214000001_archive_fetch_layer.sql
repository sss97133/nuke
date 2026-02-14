-- Archive Fetch Layer
-- Extends listing_page_snapshots to support the universal archiveFetch() pattern.
-- Every external page fetch now archives automatically — no re-crawling ever.

-- Add markdown column for Firecrawl markdown output
ALTER TABLE public.listing_page_snapshots
  ADD COLUMN IF NOT EXISTS markdown TEXT;

-- Add index for fast cache lookups: "do we already have this URL recently?"
CREATE INDEX IF NOT EXISTS idx_lps_url_fetched
  ON public.listing_page_snapshots(listing_url, fetched_at DESC);

-- Add index for finding snapshots that haven't been re-extracted
CREATE INDEX IF NOT EXISTS idx_lps_platform_success_fetched
  ON public.listing_page_snapshots(platform, success, fetched_at DESC);

-- Also persist the two MSRP RPCs that were applied directly but never captured in a migration

-- Smart OEM MSRP lookup with bidirectional model matching
DROP FUNCTION IF EXISTS public.lookup_oem_msrp(text, text, integer, text);
CREATE OR REPLACE FUNCTION public.lookup_oem_msrp(
  p_make TEXT,
  p_model TEXT,
  p_year INTEGER DEFAULT NULL,
  p_trim TEXT DEFAULT NULL
)
RETURNS TABLE(base_msrp_usd NUMERIC, trim_name TEXT, model_family TEXT, year_start INTEGER, year_end INTEGER)
LANGUAGE plpgsql STABLE
AS $$
BEGIN
  RETURN QUERY
  WITH matches AS (
    SELECT
      t.base_msrp_usd,
      t.trim_name,
      t.model_family,
      t.year_start,
      t.year_end,
      -- Prefer exact trim matches
      CASE WHEN p_trim IS NOT NULL AND t.trim_name ILIKE '%' || p_trim || '%' THEN 1
           WHEN p_trim IS NOT NULL AND p_trim ILIKE '%' || t.trim_name || '%' THEN 1
           ELSE 0 END AS trim_match,
      -- Prefer exact year matches
      CASE WHEN p_year IS NOT NULL AND p_year BETWEEN t.year_start AND COALESCE(t.year_end, 2030) THEN 1
           ELSE 0 END AS year_match
    FROM oem_trim_levels t
    WHERE LOWER(t.make) = LOWER(p_make)
      AND (
        -- Bidirectional model matching for messy names
        -- "Boss 302 Mustang Fastback" matches model_family "Mustang"
        -- "Mustang" matches model_family "Mustang"
        LOWER(p_model) LIKE '%' || LOWER(t.model_family) || '%'
        OR LOWER(t.model_family) LIKE '%' || LOWER(p_model) || '%'
      )
      AND t.base_msrp_usd IS NOT NULL
      AND t.base_msrp_usd > 0
  )
  SELECT m.base_msrp_usd, m.trim_name, m.model_family, m.year_start, m.year_end
  FROM matches m
  ORDER BY m.trim_match DESC, m.year_match DESC, m.base_msrp_usd ASC
  LIMIT 1;
END;
$$;

-- Find vehicles that have real makes matching our OEM data (skip garbage makes)
CREATE OR REPLACE FUNCTION public.find_vehicles_for_msrp_enrichment(
  p_limit INTEGER DEFAULT 50
)
RETURNS TABLE(id UUID)
LANGUAGE plpgsql STABLE
AS $$
BEGIN
  RETURN QUERY
  WITH known_makes AS (
    SELECT DISTINCT LOWER(make) AS make FROM oem_trim_levels
  )
  SELECT v.id
  FROM vehicles v
  JOIN known_makes km ON LOWER(v.make) = km.make
  WHERE v.msrp IS NULL
    AND v.make IS NOT NULL
    AND v.model IS NOT NULL
  ORDER BY v.created_at DESC
  LIMIT p_limit;
END;
$$;
