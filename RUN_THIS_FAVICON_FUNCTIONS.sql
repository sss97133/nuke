-- Add missing favicon cache functions to eliminate 404 errors
-- Run this in Supabase SQL Editor

-- Get cached favicon for a source URL
CREATE OR REPLACE FUNCTION get_source_favicon(p_url TEXT)
RETURNS TABLE (
  favicon_url TEXT,
  source_name TEXT,
  cached_at TIMESTAMPTZ
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- For now, just return empty - these are cosmetic features
  RETURN;
END;
$$;

-- Upsert favicon for a source
CREATE OR REPLACE FUNCTION upsert_source_favicon(
  p_url TEXT,
  p_favicon_url TEXT,
  p_source_name TEXT,
  p_source_type TEXT DEFAULT 'listing'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- No-op for now - silences errors
  NULL;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_source_favicon(TEXT) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION upsert_source_favicon(TEXT, TEXT, TEXT, TEXT) TO authenticated, anon;

