-- Smart search RPCs: cascading strategy search + autocomplete
-- Uses existing search_vector (tsvector) column and pg_trgm for fallback

-- =============================================================================
-- 1. search_vehicles_smart — cascade strategy search
-- =============================================================================
-- Strategy cascade:
--   1. Exact make match → relevance 0.95
--   2. Make+model split (first word = make, rest = model) → relevance 0.90
--   3. FTS via search_vector → ts_rank as relevance
--   4. Trigram fallback (only if <5 results from above) → 0.7 * similarity

CREATE OR REPLACE FUNCTION search_vehicles_smart(
  p_query TEXT,
  p_limit INT DEFAULT 50,
  p_offset INT DEFAULT 0
)
RETURNS TABLE(
  id UUID,
  year INT,
  make TEXT,
  model TEXT,
  vin TEXT,
  status TEXT,
  source TEXT,
  sold_price INT,
  primary_image_url TEXT,
  relevance FLOAT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_query TEXT;
  v_make TEXT;
  v_model TEXT;
  v_tokens TEXT[];
  v_total_found INT := 0;
  v_batch_count INT := 0;
  v_tsquery tsquery;
BEGIN
  v_query := trim(p_query);
  IF v_query IS NULL OR v_query = '' THEN RETURN; END IF;

  v_tokens := string_to_array(v_query, ' ');

  -- Strategy 1: Exact make match → relevance 0.95
  RETURN QUERY
    SELECT v.id, v.year, v.make, v.model, v.vin, v.status, v.source,
           v.sold_price, v.primary_image_url, 0.95::FLOAT AS relevance
    FROM vehicles v
    WHERE v.is_public = true AND lower(v.make) = lower(v_query)
    ORDER BY v.sold_price DESC NULLS LAST, v.year DESC
    LIMIT p_limit OFFSET p_offset;
  GET DIAGNOSTICS v_batch_count = ROW_COUNT;
  v_total_found := v_total_found + v_batch_count;
  IF v_total_found >= p_limit THEN RETURN; END IF;

  -- Strategy 2: Make+model split → relevance 0.90
  IF array_length(v_tokens, 1) >= 2 THEN
    v_make := v_tokens[1];
    v_model := array_to_string(v_tokens[2:], ' ');
    RETURN QUERY
      SELECT v.id, v.year, v.make, v.model, v.vin, v.status, v.source,
             v.sold_price, v.primary_image_url, 0.90::FLOAT AS relevance
      FROM vehicles v
      WHERE v.is_public = true
        AND lower(v.make) = lower(v_make)
        AND lower(v.model) LIKE '%' || lower(v_model) || '%'
      ORDER BY v.sold_price DESC NULLS LAST, v.year DESC
      LIMIT p_limit - v_total_found
      OFFSET GREATEST(0, p_offset - v_total_found);
    GET DIAGNOSTICS v_batch_count = ROW_COUNT;
    v_total_found := v_total_found + v_batch_count;
    IF v_total_found >= p_limit THEN RETURN; END IF;
  END IF;

  -- Strategy 3: FTS via search_vector → ts_rank
  BEGIN
    v_tsquery := plainto_tsquery('english', v_query);
    IF v_tsquery IS NOT NULL AND v_tsquery::TEXT <> '' THEN
      RETURN QUERY
        SELECT v.id, v.year, v.make, v.model, v.vin, v.status, v.source,
               v.sold_price, v.primary_image_url,
               ts_rank(v.search_vector, v_tsquery)::FLOAT AS relevance
        FROM vehicles v
        WHERE v.is_public = true AND v.search_vector @@ v_tsquery
        ORDER BY relevance DESC, v.year DESC
        LIMIT p_limit - v_total_found
        OFFSET GREATEST(0, p_offset - v_total_found);
      GET DIAGNOSTICS v_batch_count = ROW_COUNT;
      v_total_found := v_total_found + v_batch_count;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL; -- tsquery parse failure, fall through
  END;

  -- Strategy 4: Trigram fallback (only if <5 results)
  IF v_total_found < 5 THEN
    RETURN QUERY
      SELECT v.id, v.year, v.make, v.model, v.vin, v.status, v.source,
             v.sold_price, v.primary_image_url,
             (0.7 * similarity(lower(v.make) || ' ' || lower(v.model), lower(v_query)))::FLOAT AS relevance
      FROM vehicles v
      WHERE v.is_public = true AND v.make IS NOT NULL AND v.model IS NOT NULL
        AND similarity(lower(v.make) || ' ' || lower(v.model), lower(v_query)) > 0.3
      ORDER BY relevance DESC, v.year DESC
      LIMIT p_limit - v_total_found
      OFFSET GREATEST(0, p_offset - v_total_found);
  END IF;
END;
$$;

COMMENT ON FUNCTION search_vehicles_smart IS 'Cascading smart search: exact make → make+model split → FTS → trigram fallback. Returns results ordered by relevance.';

-- =============================================================================
-- 2. search_autocomplete — categorized autocomplete results
-- =============================================================================

CREATE OR REPLACE FUNCTION search_autocomplete(
  p_prefix TEXT,
  p_limit INT DEFAULT 10
)
RETURNS TABLE(
  category TEXT,
  label TEXT,
  value TEXT,
  count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_prefix TEXT;
BEGIN
  v_prefix := trim(p_prefix);

  IF v_prefix IS NULL OR v_prefix = '' THEN
    RETURN;
  END IF;

  -- Makes matching prefix
  RETURN QUERY
    SELECT
      'make'::TEXT AS category,
      v.make AS label,
      v.make AS value,
      count(*)::BIGINT AS count
    FROM vehicles v
    WHERE v.is_public = true
      AND lower(v.make) LIKE lower(v_prefix) || '%'
      AND v.make IS NOT NULL
    GROUP BY v.make
    ORDER BY count(*) DESC
    LIMIT p_limit;

  -- Models matching prefix (as "make model" label)
  RETURN QUERY
    SELECT
      'model'::TEXT AS category,
      v.make || ' ' || v.model AS label,
      v.model AS value,
      count(*)::BIGINT AS count
    FROM vehicles v
    WHERE v.is_public = true
      AND v.make IS NOT NULL
      AND v.model IS NOT NULL
      AND (
        lower(v.model) LIKE lower(v_prefix) || '%'
        OR lower(v.make || ' ' || v.model) LIKE lower(v_prefix) || '%'
      )
    GROUP BY v.make, v.model
    ORDER BY count(*) DESC
    LIMIT p_limit;

  -- Specific vehicles via FTS (limited to 5)
  RETURN QUERY
    SELECT
      'vehicle'::TEXT AS category,
      v.year::TEXT || ' ' || v.make || ' ' || v.model AS label,
      v.id::TEXT AS value,
      0::BIGINT AS count
    FROM vehicles v
    WHERE v.is_public = true
      AND v.search_vector @@ plainto_tsquery('english', v_prefix)
    ORDER BY v.year DESC
    LIMIT 5;
END;
$$;

COMMENT ON FUNCTION search_autocomplete IS 'Returns categorized autocomplete results: makes, models, and specific vehicles matching prefix.';
