-- Add columns needed by refine-fb-listing and the local scraper
-- Safe to run: all ADD COLUMN IF NOT EXISTS

ALTER TABLE marketplace_listings
  -- New-style identifiers / metadata
  ADD COLUMN IF NOT EXISTS facebook_id    TEXT,
  ADD COLUMN IF NOT EXISTS price          NUMERIC,
  ADD COLUMN IF NOT EXISTS location       TEXT,
  ADD COLUMN IF NOT EXISTS image_url      TEXT,
  ADD COLUMN IF NOT EXISTS parsed_year    INTEGER,
  ADD COLUMN IF NOT EXISTS parsed_make    TEXT,
  ADD COLUMN IF NOT EXISTS parsed_model   TEXT,
  ADD COLUMN IF NOT EXISTS scraped_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS search_query   TEXT,
  -- Refinement enrichment
  ADD COLUMN IF NOT EXISTS mileage        INTEGER,
  ADD COLUMN IF NOT EXISTS transmission   TEXT,
  ADD COLUMN IF NOT EXISTS exterior_color TEXT,
  ADD COLUMN IF NOT EXISTS interior_color TEXT,
  ADD COLUMN IF NOT EXISTS all_images     TEXT[],
  ADD COLUMN IF NOT EXISTS refined_at     TIMESTAMPTZ;

-- Unique index on facebook_id for upsert queries
CREATE UNIQUE INDEX IF NOT EXISTS idx_marketplace_facebook_id
  ON marketplace_listings (facebook_id)
  WHERE facebook_id IS NOT NULL;

-- Fast lookup for refinement queue (needs refinement + active)
CREATE INDEX IF NOT EXISTS idx_marketplace_needs_refine
  ON marketplace_listings (first_seen_at DESC)
  WHERE refined_at IS NULL
    AND status = 'active'
    AND platform = 'facebook_marketplace';

COMMENT ON COLUMN marketplace_listings.facebook_id    IS 'Facebook Marketplace item ID (numeric string)';
COMMENT ON COLUMN marketplace_listings.price          IS 'Asking price in USD (mirrors asking_price, written by newer scrapers)';
COMMENT ON COLUMN marketplace_listings.location       IS 'Combined city+state string, e.g. "Austin, TX"';
COMMENT ON COLUMN marketplace_listings.image_url      IS 'Primary image URL (lookaside or scontent)';
COMMENT ON COLUMN marketplace_listings.parsed_year    IS 'Vehicle year parsed from title';
COMMENT ON COLUMN marketplace_listings.parsed_make    IS 'Vehicle make parsed from title (lowercase)';
COMMENT ON COLUMN marketplace_listings.parsed_model   IS 'Vehicle model parsed from title (lowercase)';
COMMENT ON COLUMN marketplace_listings.mileage        IS 'Odometer reading in miles';
COMMENT ON COLUMN marketplace_listings.transmission   IS 'Transmission type: Automatic, Manual, etc.';
COMMENT ON COLUMN marketplace_listings.exterior_color IS 'Exterior color from listing';
COMMENT ON COLUMN marketplace_listings.interior_color IS 'Interior color from listing';
COMMENT ON COLUMN marketplace_listings.all_images     IS 'All image URLs found on the listing page';
COMMENT ON COLUMN marketplace_listings.refined_at     IS 'Timestamp when refine-fb-listing last enriched this row';
