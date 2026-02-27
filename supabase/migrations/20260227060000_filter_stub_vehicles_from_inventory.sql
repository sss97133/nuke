-- Filter stub vehicles (missing year/make/model) from all inventory/search queries
--
-- Problem: 97K+ stub vehicles (no YMM) with is_public=true pollute search results.
-- These are created as placeholder rows when a listing URL is discovered and queued,
-- but before the extraction pipeline fills them in.
--
-- Solution: Add year/make/model IS NOT NULL filter to all search/inventory functions.
-- This is a pure read-side filter — no schema changes, no data loss, stubs
-- remain in the DB and will surface naturally once extraction completes.

-- 1. Update search_vehicles_fulltext
CREATE OR REPLACE FUNCTION public.search_vehicles_fulltext(query_text text, limit_count integer DEFAULT 20)
  RETURNS TABLE(id uuid, year integer, make text, model text, color text, description text, created_at timestamp with time zone, relevance real)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
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
  FROM public.vehicles v
  WHERE v.is_public = true
    AND v.year IS NOT NULL
    AND v.make IS NOT NULL
    AND v.model IS NOT NULL
    AND v.search_vector @@ to_tsquery('english', query_text)
  ORDER BY relevance DESC, v.created_at DESC
  LIMIT limit_count;
END;
$function$;

-- 2. Update search_vehicles_fuzzy
CREATE OR REPLACE FUNCTION public.search_vehicles_fuzzy(query_text text, limit_count integer DEFAULT 20)
  RETURNS TABLE(id uuid, year integer, make text, model text, color text, description text, created_at timestamp with time zone, relevance real)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  SET statement_timeout TO '3s'
AS $function$
BEGIN
  PERFORM set_limit(0.25);
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
    AND v.year IS NOT NULL
    AND v.make IS NOT NULL
    AND v.model IS NOT NULL
    AND (
      lower(coalesce(v.make, '')) % lower(query_text)
      OR lower(coalesce(v.model, '')) % lower(query_text)
      OR lower(coalesce(v.vin, '')) % lower(query_text)
    )
  ORDER BY relevance DESC, v.created_at DESC
  LIMIT limit_count;
END;
$function$;

-- 3. Update search_vehicles_fts (the primary search function)
CREATE OR REPLACE FUNCTION public.search_vehicles_fts(query_text text, limit_count integer DEFAULT 20)
  RETURNS TABLE(id uuid, year integer, make text, model text, vin text, status text, sale_price integer, current_value numeric, relevance real)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  parsed_make text;
  parsed_model text;
  tokens text[];
  direct_count integer := 0;
BEGIN
  -- Tokenize the query
  tokens := string_to_array(regexp_replace(query_text, '\s*&\s*', '&', 'g'), '&');

  -- Strategy 1a: Single token → try as make name
  IF array_length(tokens, 1) = 1 THEN
    parsed_make := trim(tokens[1]);

    RETURN QUERY
    SELECT v.id, v.year, v.make, v.model, v.vin, v.status, v.sale_price, v.current_value,
      0.9::real AS relevance
    FROM public.vehicles v
    WHERE v.is_public = true
      AND v.year IS NOT NULL
      AND v.make IS NOT NULL
      AND v.model IS NOT NULL
      AND v.make = initcap(parsed_make)
    ORDER BY v.sale_price DESC NULLS LAST, v.created_at DESC
    LIMIT limit_count;

    GET DIAGNOSTICS direct_count = ROW_COUNT;
    IF direct_count >= limit_count THEN
      RETURN;
    END IF;
  END IF;

  -- Strategy 1b: 2+ tokens → try as "Make Model" pattern
  IF array_length(tokens, 1) >= 2 THEN
    parsed_make := trim(tokens[1]);
    parsed_model := trim(array_to_string(tokens[2:], ' '));

    RETURN QUERY
    SELECT v.id, v.year, v.make, v.model, v.vin, v.status, v.sale_price, v.current_value,
      0.9::real AS relevance
    FROM public.vehicles v
    WHERE v.is_public = true
      AND v.year IS NOT NULL
      AND v.make IS NOT NULL
      AND v.model IS NOT NULL
      AND v.make = initcap(parsed_make)
      AND v.model ILIKE '%' || parsed_model || '%'
    ORDER BY v.sale_price DESC NULLS LAST, v.created_at DESC
    LIMIT limit_count;

    GET DIAGNOSTICS direct_count = ROW_COUNT;
    IF direct_count >= limit_count THEN
      RETURN;
    END IF;

    -- Try case-insensitive make if exact didn't return enough
    IF direct_count = 0 THEN
      RETURN QUERY
      SELECT v.id, v.year, v.make, v.model, v.vin, v.status, v.sale_price, v.current_value,
        0.85::real AS relevance
      FROM public.vehicles v
      WHERE v.is_public = true
        AND v.year IS NOT NULL
        AND v.make IS NOT NULL
        AND v.model IS NOT NULL
        AND v.make ILIKE parsed_make
        AND v.model ILIKE '%' || parsed_model || '%'
      ORDER BY v.sale_price DESC NULLS LAST, v.created_at DESC
      LIMIT limit_count;

      GET DIAGNOSTICS direct_count = ROW_COUNT;
      IF direct_count >= limit_count THEN
        RETURN;
      END IF;
    END IF;
  END IF;

  -- Strategy 2: Full-text search using search_vector
  RETURN QUERY
  SELECT v.id, v.year, v.make, v.model, v.vin, v.status, v.sale_price, v.current_value,
    ts_rank_cd(v.search_vector, to_tsquery('english', query_text))::real AS relevance
  FROM public.vehicles v
  WHERE v.is_public = true
    AND v.year IS NOT NULL
    AND v.make IS NOT NULL
    AND v.model IS NOT NULL
    AND v.search_vector @@ to_tsquery('english', query_text)
  ORDER BY relevance DESC, v.sale_price DESC NULLS LAST
  LIMIT limit_count;
END;
$function$;

-- 4. Create a helper view for public inventory (vehicles with minimum data)
-- This makes it easy for future queries to use a single filter point
CREATE OR REPLACE VIEW public.vehicles_inventory AS
SELECT *
FROM public.vehicles
WHERE is_public = true
  AND year IS NOT NULL
  AND make IS NOT NULL
  AND model IS NOT NULL;

COMMENT ON VIEW public.vehicles_inventory IS
  'Public vehicles that have minimum required data (year+make+model). '
  'Use this view instead of querying vehicles directly for inventory/search use cases. '
  'Stubs (no YMM) are excluded until extraction pipeline fills them in.';
