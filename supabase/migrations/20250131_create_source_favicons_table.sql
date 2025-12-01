-- Source Favicons Table
-- Stores favicon URLs for all vehicle discovery sources (Craigslist, BaT, eBay, dealers, etc.)
-- This allows us to display consistent verification badges across the platform

CREATE TABLE IF NOT EXISTS public.source_favicons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain TEXT NOT NULL UNIQUE, -- e.g., 'craigslist.org', 'bringatrailer.com'
  favicon_url TEXT NOT NULL, -- Cached favicon URL (from Google's service or direct)
  source_type TEXT, -- 'marketplace', 'dealer', 'auction', 'classified', 'social'
  source_name TEXT, -- Human-readable name: 'Craigslist', 'Bring a Trailer', etc.
  extracted_at TIMESTAMPTZ DEFAULT NOW(),
  last_verified_at TIMESTAMPTZ, -- When we last verified the favicon still works
  verification_status TEXT DEFAULT 'pending' CHECK (verification_status IN ('pending', 'verified', 'failed', 'expired')),
  metadata JSONB DEFAULT '{}', -- Additional metadata (SVG data, alternative URLs, etc.)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_source_favicons_domain ON public.source_favicons(domain);
CREATE INDEX IF NOT EXISTS idx_source_favicons_source_type ON public.source_favicons(source_type);

-- Function to get or create favicon for a URL
CREATE OR REPLACE FUNCTION get_source_favicon(p_url TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_domain TEXT;
  v_favicon_url TEXT;
BEGIN
  -- Extract domain from URL
  BEGIN
    v_domain := (regexp_match(p_url, 'https?://([^/]+)'))[1];
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;

  -- Look up cached favicon
  SELECT favicon_url INTO v_favicon_url
  FROM source_favicons
  WHERE domain = v_domain
    AND verification_status IN ('verified', 'pending')
  LIMIT 1;

  RETURN v_favicon_url;
END;
$$;

-- Function to upsert favicon for a domain
CREATE OR REPLACE FUNCTION upsert_source_favicon(
  p_domain TEXT,
  p_favicon_url TEXT,
  p_source_type TEXT DEFAULT NULL,
  p_source_name TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO source_favicons (domain, favicon_url, source_type, source_name, metadata, verification_status)
  VALUES (p_domain, p_favicon_url, p_source_type, p_source_name, p_metadata, 'verified')
  ON CONFLICT (domain) DO UPDATE SET
    favicon_url = EXCLUDED.favicon_url,
    source_type = COALESCE(EXCLUDED.source_type, source_favicons.source_type),
    source_name = COALESCE(EXCLUDED.source_name, source_favicons.source_name),
    metadata = source_favicons.metadata || EXCLUDED.metadata,
    verification_status = 'verified',
    last_verified_at = NOW(),
    updated_at = NOW()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- RLS Policies
ALTER TABLE public.source_favicons ENABLE ROW LEVEL SECURITY;

-- Allow public read access (favicons are public data)
CREATE POLICY "Allow public read access to source favicons"
  ON public.source_favicons
  FOR SELECT
  USING (true);

-- Allow authenticated users to insert/update (for scraping functions)
CREATE POLICY "Allow authenticated users to manage source favicons"
  ON public.source_favicons
  FOR ALL
  USING (auth.role() = 'authenticated' OR auth.role() = 'service_role');

COMMENT ON TABLE public.source_favicons IS 'Cached favicon URLs for vehicle discovery sources. Used for verification badges across the platform.';
COMMENT ON FUNCTION get_source_favicon IS 'Returns cached favicon URL for a given source URL, or NULL if not found.';
COMMENT ON FUNCTION upsert_source_favicon IS 'Upserts a favicon URL for a domain. Used by scraping functions to cache favicons.';

