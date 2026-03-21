-- SQL function to extract canonical listing ID from a URL
-- Used in entity resolution to group URL variants (e.g., JamesEdition clean vs title-appended)
-- Returns platform:listing_id format for known platforms, or cleaned URL for unknown

CREATE OR REPLACE FUNCTION normalize_listing_url(url text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  listing_id text;
BEGIN
  IF url IS NULL OR url = '' THEN
    RETURN NULL;
  END IF;

  -- JamesEdition: extract numeric listing ID (7+ digits)
  IF url ILIKE '%jamesedition.com%' THEN
    listing_id := (regexp_match(url, '(\d{7,})'))[1];
    IF listing_id IS NOT NULL THEN
      RETURN 'jamesedition:' || listing_id;
    END IF;
  END IF;

  -- RM Sotheby's: extract lot ID (rXXXX-slug)
  IF url ILIKE '%rmsothebys.com%' THEN
    listing_id := (regexp_match(url, '/(r\d+-[^/]+)'))[1];
    IF listing_id IS NOT NULL THEN
      RETURN 'rmsothebys:' || listing_id;
    END IF;
  END IF;

  -- BaT: extract listing slug
  IF url ILIKE '%bringatrailer.com/listing/%' THEN
    listing_id := (regexp_match(url, '/listing/([\w-]+)'))[1];
    IF listing_id IS NOT NULL THEN
      RETURN 'bat:' || listing_id;
    END IF;
  END IF;

  -- Cars & Bids
  IF url ILIKE '%carsandbids.com/auctions/%' THEN
    listing_id := (regexp_match(url, '/auctions/([\w-]+)'))[1];
    IF listing_id IS NOT NULL THEN
      RETURN 'carsandbids:' || listing_id;
    END IF;
  END IF;

  -- Barrett-Jackson: use path after domain
  IF url ILIKE '%barrett-jackson.com%' THEN
    listing_id := (regexp_match(url, 'barrett-jackson\.com/(.+?)/?(\?|$)'))[1];
    IF listing_id IS NOT NULL THEN
      RETURN 'barrett-jackson:' || regexp_replace(listing_id, '/$', '');
    END IF;
  END IF;

  -- Fallback: strip trailing slash, query params, appended titles in quotes
  RETURN regexp_replace(
    regexp_replace(
      regexp_replace(url, '\s*"[^"]*"?\s*$', ''),  -- strip appended titles
      '\?.*$', ''),                                   -- strip query params
    '/$', '');                                         -- strip trailing slash
END;
$$;

COMMENT ON FUNCTION normalize_listing_url IS 'Extracts canonical listing ID from URL for entity resolution. Returns platform:id format for known platforms. Used to prevent URL-variant duplicates (e.g., JamesEdition clean vs title-appended URLs).';

-- Create a partial index for fast duplicate detection using normalized URLs
-- This enables: SELECT normalize_listing_url(listing_url), count(*)
-- ... GROUP BY normalize_listing_url(listing_url) HAVING count(*) > 1
-- without scanning the entire table
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vehicles_normalized_listing_url
  ON vehicles (normalize_listing_url(listing_url))
  WHERE listing_url IS NOT NULL
    AND status NOT IN ('merged', 'deleted', 'archived');
