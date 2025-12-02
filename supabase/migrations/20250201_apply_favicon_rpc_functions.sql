-- Apply favicon RPC functions if they don't exist
-- This migration ensures get_source_favicon and upsert_source_favicon are available

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

COMMENT ON FUNCTION get_source_favicon IS 'Returns cached favicon URL for a given source URL, or NULL if not found.';
COMMENT ON FUNCTION upsert_source_favicon IS 'Upserts a favicon URL for a domain. Used by scraping functions to cache favicons.';

