-- ============================================================================
-- Fix Fuzzy Search Timeout Issues
-- The fuzzy search on description was causing statement timeouts.
-- This migration:
-- 1. Adds statement timeout to fuzzy RPCs
-- 2. Removes description from fuzzy matching (too slow on large text)
-- 3. Focuses fuzzy on short columns: make, model, vin, business_name, username
-- ============================================================================

-- Drop and recreate search_vehicles_fuzzy with timeout and optimizations
CREATE OR REPLACE FUNCTION search_vehicles_fuzzy(
  query_text TEXT,
  limit_count INTEGER DEFAULT 20
)
RETURNS TABLE (
  id UUID,
  year INTEGER,
  make TEXT,
  model TEXT,
  color TEXT,
  description TEXT,
  created_at TIMESTAMPTZ,
  relevance REAL
)
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '3s'
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_limit(0.25);  -- Slightly higher threshold for speed
  RETURN QUERY
  SELECT
    v.id,
    v.year,
    v.make,
    v.model,
    v.color,
    v.description,
    v.created_at,
    GREATEST(
      similarity(lower(coalesce(v.make, '')), lower(query_text)),
      similarity(lower(coalesce(v.model, '')), lower(query_text)),
      similarity(lower(coalesce(v.vin, '')), lower(query_text))
    )::real AS relevance
  FROM vehicles v
  WHERE v.is_public = true
    AND (
      -- Only match on short columns for speed
      lower(coalesce(v.make, '')) % lower(query_text)
      OR lower(coalesce(v.model, '')) % lower(query_text)
      OR lower(coalesce(v.vin, '')) % lower(query_text)
    )
  ORDER BY relevance DESC, v.created_at DESC
  LIMIT limit_count;
END;
$$;

-- Drop and recreate search_businesses_fuzzy with timeout and optimizations
CREATE OR REPLACE FUNCTION search_businesses_fuzzy(
  query_text TEXT,
  limit_count INTEGER DEFAULT 15
)
RETURNS TABLE (
  id UUID,
  business_name TEXT,
  legal_name TEXT,
  description TEXT,
  city TEXT,
  state TEXT,
  created_at TIMESTAMPTZ,
  relevance REAL
)
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '3s'
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_limit(0.25);
  RETURN QUERY
  SELECT
    b.id,
    b.business_name,
    b.legal_name,
    b.description,
    b.city,
    b.state,
    b.created_at,
    GREATEST(
      similarity(lower(coalesce(b.business_name, '')), lower(query_text)),
      similarity(lower(coalesce(b.legal_name, '')), lower(query_text))
    )::real AS relevance
  FROM businesses b
  WHERE b.is_public = true
    AND (
      -- Only match on name columns for speed
      lower(coalesce(b.business_name, '')) % lower(query_text)
      OR lower(coalesce(b.legal_name, '')) % lower(query_text)
    )
  ORDER BY relevance DESC, b.created_at DESC
  LIMIT limit_count;
END;
$$;

-- Drop and recreate search_profiles_fuzzy with timeout
CREATE OR REPLACE FUNCTION search_profiles_fuzzy(
  query_text TEXT,
  limit_count INTEGER DEFAULT 10
)
RETURNS TABLE (
  id UUID,
  username TEXT,
  full_name TEXT,
  bio TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ,
  relevance REAL
)
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '3s'
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_limit(0.25);
  RETURN QUERY
  SELECT
    p.id,
    p.username,
    p.full_name,
    p.bio,
    p.avatar_url,
    p.created_at,
    GREATEST(
      similarity(lower(coalesce(p.username, '')), lower(query_text)),
      similarity(lower(coalesce(p.full_name, '')), lower(query_text))
    )::real AS relevance
  FROM profiles p
  WHERE (
      -- Only match on short columns
      lower(coalesce(p.username, '')) % lower(query_text)
      OR lower(coalesce(p.full_name, '')) % lower(query_text)
    )
  ORDER BY relevance DESC, p.created_at DESC
  LIMIT limit_count;
END;
$$;

COMMENT ON FUNCTION search_vehicles_fuzzy IS 'Fuzzy search for vehicles using pg_trgm. Excludes description for performance. 3s timeout.';
COMMENT ON FUNCTION search_businesses_fuzzy IS 'Fuzzy search for businesses using pg_trgm. Matches name columns only. 3s timeout.';
COMMENT ON FUNCTION search_profiles_fuzzy IS 'Fuzzy search for profiles using pg_trgm. Matches username/full_name only. 3s timeout.';
