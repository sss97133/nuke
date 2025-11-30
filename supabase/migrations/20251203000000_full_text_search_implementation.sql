-- ============================================================================
-- PostgreSQL Full-Text Search Implementation
-- Phase 1: Foundation - Fast, ranked, native search
-- ============================================================================

-- Enable full-text search (already enabled by default in PostgreSQL)
-- No extension needed for basic full-text search

-- ============================================================================
-- 1. VEHICLES TABLE - Full-Text Search
-- ============================================================================

-- Add search vector column
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS search_vector tsvector;

-- Create GIN index for fast full-text searches
CREATE INDEX IF NOT EXISTS vehicles_search_idx 
ON vehicles USING GIN(search_vector);

-- Create function to update search vector
CREATE OR REPLACE FUNCTION vehicles_search_vector_update() 
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector :=
    -- Weight A (highest): Primary identifiers
    setweight(to_tsvector('english', coalesce(NEW.year::text, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.make, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.model, '')), 'A') ||
    -- Weight B (high): Descriptive
    setweight(to_tsvector('english', coalesce(NEW.color, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW.description, '')), 'B') ||
    -- Weight C (medium): Additional context
    setweight(to_tsvector('english', coalesce(NEW.notes, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(NEW.modification_details, '')), 'C') ||
    -- VIN uses simple config (no stemming for alphanumeric)
    setweight(to_tsvector('simple', coalesce(NEW.vin, '')), 'A');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to auto-update search vector
DROP TRIGGER IF EXISTS vehicles_search_vector_trigger ON vehicles;
CREATE TRIGGER vehicles_search_vector_trigger
BEFORE INSERT OR UPDATE ON vehicles
FOR EACH ROW EXECUTE FUNCTION vehicles_search_vector_update();

-- Backfill existing records
UPDATE vehicles 
SET search_vector = 
  setweight(to_tsvector('english', coalesce(year::text, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(make, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(model, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(color, '')), 'B') ||
  setweight(to_tsvector('english', coalesce(description, '')), 'B') ||
  setweight(to_tsvector('english', coalesce(notes, '')), 'C') ||
  setweight(to_tsvector('english', coalesce(modification_details, '')), 'C') ||
  setweight(to_tsvector('simple', coalesce(vin, '')), 'A')
WHERE search_vector IS NULL;

-- ============================================================================
-- 2. TIMELINE_EVENTS TABLE - Full-Text Search
-- ============================================================================

ALTER TABLE timeline_events ADD COLUMN IF NOT EXISTS search_vector tsvector;

CREATE INDEX IF NOT EXISTS timeline_events_search_idx 
ON timeline_events USING GIN(search_vector);

CREATE OR REPLACE FUNCTION timeline_events_search_vector_update() 
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.description, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW.event_type, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(NEW.location, '')), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS timeline_events_search_vector_trigger ON timeline_events;
CREATE TRIGGER timeline_events_search_vector_trigger
BEFORE INSERT OR UPDATE ON timeline_events
FOR EACH ROW EXECUTE FUNCTION timeline_events_search_vector_update();

-- Backfill
UPDATE timeline_events 
SET search_vector = 
  setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(description, '')), 'B') ||
  setweight(to_tsvector('english', coalesce(event_type, '')), 'C') ||
  setweight(to_tsvector('english', coalesce(location, '')), 'C')
WHERE search_vector IS NULL;

-- ============================================================================
-- 3. BUSINESSES TABLE - Full-Text Search
-- ============================================================================

ALTER TABLE businesses ADD COLUMN IF NOT EXISTS search_vector tsvector;

CREATE INDEX IF NOT EXISTS businesses_search_idx 
ON businesses USING GIN(search_vector);

CREATE OR REPLACE FUNCTION businesses_search_vector_update() 
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.business_name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.legal_name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.description, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW.city, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(NEW.state, '')), 'C') ||
    setweight(to_tsvector('english', array_to_string(COALESCE(NEW.specializations, ARRAY[]::TEXT[]), ' ')), 'B') ||
    setweight(to_tsvector('english', array_to_string(COALESCE(NEW.services_offered, ARRAY[]::TEXT[]), ' ')), 'B');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS businesses_search_vector_trigger ON businesses;
CREATE TRIGGER businesses_search_vector_trigger
BEFORE INSERT OR UPDATE ON businesses
FOR EACH ROW EXECUTE FUNCTION businesses_search_vector_update();

-- Backfill
UPDATE businesses 
SET search_vector = 
  setweight(to_tsvector('english', coalesce(business_name, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(legal_name, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(description, '')), 'B') ||
  setweight(to_tsvector('english', coalesce(city, '')), 'C') ||
  setweight(to_tsvector('english', coalesce(state, '')), 'C') ||
  setweight(to_tsvector('english', array_to_string(COALESCE(specializations, ARRAY[]::TEXT[]), ' ')), 'B') ||
  setweight(to_tsvector('english', array_to_string(COALESCE(services_offered, ARRAY[]::TEXT[]), ' ')), 'B')
WHERE search_vector IS NULL;

-- ============================================================================
-- 4. PROFILES TABLE - Full-Text Search
-- ============================================================================

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS search_vector tsvector;

CREATE INDEX IF NOT EXISTS profiles_search_idx 
ON profiles USING GIN(search_vector);

CREATE OR REPLACE FUNCTION profiles_search_vector_update() 
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.username, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.full_name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.bio, '')), 'B');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS profiles_search_vector_trigger ON profiles;
CREATE TRIGGER profiles_search_vector_trigger
BEFORE INSERT OR UPDATE ON profiles
FOR EACH ROW EXECUTE FUNCTION profiles_search_vector_update();

-- Backfill
UPDATE profiles 
SET search_vector = 
  setweight(to_tsvector('english', coalesce(username, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(full_name, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(bio, '')), 'B')
WHERE search_vector IS NULL;

-- ============================================================================
-- 5. SEARCH FUNCTIONS - Fast, Ranked Queries
-- ============================================================================

-- Vehicles search function
CREATE OR REPLACE FUNCTION search_vehicles_fulltext(
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
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    v.id,
    v.year,
    v.make,
    v.model,
    v.color,
    v.description,
    v.created_at,
    ts_rank_cd(v.search_vector, to_tsquery('english', query_text)) AS relevance
  FROM vehicles v
  WHERE v.is_public = true
    AND v.search_vector @@ to_tsquery('english', query_text)
  ORDER BY relevance DESC, v.created_at DESC
  LIMIT limit_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Timeline events search function
CREATE OR REPLACE FUNCTION search_timeline_events_fulltext(
  query_text TEXT,
  limit_count INTEGER DEFAULT 15
)
RETURNS TABLE (
  id UUID,
  title TEXT,
  description TEXT,
  event_type TEXT,
  created_at TIMESTAMPTZ,
  vehicle_id UUID,
  relevance REAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    te.id,
    te.title,
    te.description,
    te.event_type,
    te.created_at,
    te.vehicle_id,
    ts_rank_cd(te.search_vector, to_tsquery('english', query_text)) AS relevance
  FROM timeline_events te
  WHERE te.search_vector @@ to_tsquery('english', query_text)
  ORDER BY relevance DESC, te.created_at DESC
  LIMIT limit_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Businesses search function
CREATE OR REPLACE FUNCTION search_businesses_fulltext(
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
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    b.id,
    b.business_name,
    b.legal_name,
    b.description,
    b.city,
    b.state,
    b.created_at,
    ts_rank_cd(b.search_vector, to_tsquery('english', query_text)) AS relevance
  FROM businesses b
  WHERE b.search_vector @@ to_tsquery('english', query_text)
  ORDER BY relevance DESC, b.created_at DESC
  LIMIT limit_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Profiles search function
CREATE OR REPLACE FUNCTION search_profiles_fulltext(
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
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    p.id,
    p.username,
    p.full_name,
    p.bio,
    p.avatar_url,
    p.created_at,
    ts_rank_cd(p.search_vector, to_tsquery('english', query_text)) AS relevance
  FROM profiles p
  WHERE p.search_vector @@ to_tsquery('english', query_text)
  ORDER BY relevance DESC, p.created_at DESC
  LIMIT limit_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 6. HELPER FUNCTION - Convert user query to tsquery format
-- ============================================================================

CREATE OR REPLACE FUNCTION convert_to_tsquery(input_text TEXT)
RETURNS TEXT AS $$
DECLARE
  words TEXT[];
  word TEXT;
  result TEXT := '';
BEGIN
  -- Split into words, filter short words and stop words
  words := string_to_array(lower(trim(input_text)), ' ');
  
  FOR word IN SELECT unnest(words)
  LOOP
    -- Skip very short words and common stop words
    IF length(word) > 2 AND word NOT IN ('the', 'and', 'or', 'for', 'with', 'from') THEN
      IF result != '' THEN
        result := result || ' & ';
      END IF;
      -- Add prefix matching (:*)
      result := result || word || ':*';
    END IF;
  END LOOP;
  
  RETURN COALESCE(result, '');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================================================
-- 7. ANALYZE TABLES FOR QUERY PLANNER
-- ============================================================================

ANALYZE vehicles;
ANALYZE timeline_events;
ANALYZE businesses;
ANALYZE profiles;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON COLUMN vehicles.search_vector IS 'Full-text search vector for fast, ranked searches';
COMMENT ON COLUMN timeline_events.search_vector IS 'Full-text search vector for event searches';
COMMENT ON COLUMN businesses.search_vector IS 'Full-text search vector for organization searches';
COMMENT ON COLUMN profiles.search_vector IS 'Full-text search vector for user searches';

COMMENT ON FUNCTION search_vehicles_fulltext IS 'Fast, ranked vehicle search using PostgreSQL full-text search';
COMMENT ON FUNCTION convert_to_tsquery IS 'Converts user query to PostgreSQL tsquery format with prefix matching';

