-- ============================================================================
-- Fuzzy Search (pg_trgm) RPCs
-- Adds similarity-based fallback search for typos / sparse FTS results.
-- ============================================================================

-- Ensure extension is available
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================================
-- Trigram indexes (expression GIN) for fast fuzzy matching
-- ============================================================================

CREATE INDEX IF NOT EXISTS vehicles_make_trgm_idx
ON vehicles
USING GIN (lower(make) gin_trgm_ops)
WHERE is_public = true;

CREATE INDEX IF NOT EXISTS vehicles_model_trgm_idx
ON vehicles
USING GIN (lower(model) gin_trgm_ops)
WHERE is_public = true;

CREATE INDEX IF NOT EXISTS vehicles_description_trgm_idx
ON vehicles
USING GIN (lower(description) gin_trgm_ops)
WHERE is_public = true;

CREATE INDEX IF NOT EXISTS vehicles_vin_trgm_idx
ON vehicles
USING GIN (lower(vin) gin_trgm_ops)
WHERE is_public = true;

CREATE INDEX IF NOT EXISTS businesses_business_name_trgm_idx
ON businesses
USING GIN (lower(business_name) gin_trgm_ops)
WHERE is_public = true;

CREATE INDEX IF NOT EXISTS businesses_legal_name_trgm_idx
ON businesses
USING GIN (lower(legal_name) gin_trgm_ops)
WHERE is_public = true;

CREATE INDEX IF NOT EXISTS businesses_description_trgm_idx
ON businesses
USING GIN (lower(description) gin_trgm_ops)
WHERE is_public = true;

CREATE INDEX IF NOT EXISTS businesses_city_trgm_idx
ON businesses
USING GIN (lower(city) gin_trgm_ops)
WHERE is_public = true;

CREATE INDEX IF NOT EXISTS businesses_state_trgm_idx
ON businesses
USING GIN (lower(state) gin_trgm_ops)
WHERE is_public = true;

CREATE INDEX IF NOT EXISTS profiles_username_trgm_idx
ON profiles
USING GIN (lower(username) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS profiles_full_name_trgm_idx
ON profiles
USING GIN (lower(full_name) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS profiles_bio_trgm_idx
ON profiles
USING GIN (lower(bio) gin_trgm_ops);

-- ============================================================================
-- RPCs
-- ============================================================================

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
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_limit(0.20);
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
      similarity(
        lower(
          coalesce(v.year::text, '') || ' ' ||
          coalesce(v.make, '') || ' ' ||
          coalesce(v.model, '') || ' ' ||
          coalesce(v.color, '') || ' ' ||
          coalesce(v.description, '') || ' ' ||
          coalesce(v.vin, '')
        ),
        lower(query_text)
      )
    )::real AS relevance
  FROM vehicles v
  WHERE v.is_public = true
    AND (
      lower(coalesce(v.make, '')) % lower(query_text)
      OR lower(coalesce(v.model, '')) % lower(query_text)
      OR lower(coalesce(v.description, '')) % lower(query_text)
      OR lower(coalesce(v.vin, '')) % lower(query_text)
    )
  ORDER BY relevance DESC, v.created_at DESC
  LIMIT limit_count;
END;
$$;

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
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_limit(0.20);
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
      similarity(lower(coalesce(b.legal_name, '')), lower(query_text)),
      similarity(
        lower(
          coalesce(b.business_name, '') || ' ' ||
          coalesce(b.legal_name, '') || ' ' ||
          coalesce(b.description, '') || ' ' ||
          coalesce(b.city, '') || ' ' ||
          coalesce(b.state, '')
        ),
        lower(query_text)
      )
    )::real AS relevance
  FROM businesses b
  WHERE b.is_public = true
    AND (
      lower(coalesce(b.business_name, '')) % lower(query_text)
      OR lower(coalesce(b.legal_name, '')) % lower(query_text)
      OR lower(coalesce(b.description, '')) % lower(query_text)
      OR lower(coalesce(b.city, '')) % lower(query_text)
      OR lower(coalesce(b.state, '')) % lower(query_text)
    )
  ORDER BY relevance DESC, b.created_at DESC
  LIMIT limit_count;
END;
$$;

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
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_limit(0.20);
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
      similarity(lower(coalesce(p.full_name, '')), lower(query_text)),
      similarity(lower(coalesce(p.bio, '')), lower(query_text))
    )::real AS relevance
  FROM profiles p
  WHERE (
      lower(coalesce(p.username, '')) % lower(query_text)
      OR lower(coalesce(p.full_name, '')) % lower(query_text)
      OR lower(coalesce(p.bio, '')) % lower(query_text)
    )
  ORDER BY relevance DESC, p.created_at DESC
  LIMIT limit_count;
END;
$$;
