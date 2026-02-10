-- Optimize search_vehicles_fts: direct make/model lookup before FTS fallback
--
-- Before: "Porsche 911" → 938ms (FTS with ts_rank_cd on 21K rows)
-- After:  "Porsche 911" → 7ms (direct make/model, 134x faster)
--         "Porsche"     → 1.5ms (direct make match, 127x faster)
--         "BMW M3"      → 33ms
--         Complex query → ~190ms (FTS without ts_rank_cd)
--
-- Key insight: for "Make Model" patterns, B-tree index on make + ILIKE on model
-- with ORDER BY sale_price DESC uses idx_vehicles_sale_price for near-instant results.
-- ts_rank_cd was computing relevance for 21K+ rows when we only need 10.

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
  -- Tokenize the query (split by & which is how tsquery terms are joined)
  tokens := string_to_array(regexp_replace(query_text, '\s*&\s*', '&', 'g'), '&');

  -- Strategy 1a: Single token → try as make name
  IF array_length(tokens, 1) = 1 THEN
    parsed_make := trim(tokens[1]);

    RETURN QUERY
    SELECT v.id, v.year, v.make, v.model, v.vin, v.status, v.sale_price, v.current_value,
      0.9::real AS relevance
    FROM public.vehicles v
    WHERE v.is_public = true
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
      AND v.make = initcap(parsed_make)
      AND v.model ILIKE '%' || parsed_model || '%'
    ORDER BY v.sale_price DESC NULLS LAST, v.created_at DESC
    LIMIT limit_count;

    GET DIAGNOSTICS direct_count = ROW_COUNT;
    IF direct_count >= limit_count THEN
      RETURN;
    END IF;

    -- Fallback: case-insensitive make if initcap didn't match
    IF direct_count = 0 THEN
      RETURN QUERY
      SELECT v.id, v.year, v.make, v.model, v.vin, v.status, v.sale_price, v.current_value,
        0.85::real AS relevance
      FROM public.vehicles v
      WHERE v.is_public = true
        AND lower(v.make) = lower(parsed_make)
        AND v.model ILIKE '%' || parsed_model || '%'
      ORDER BY v.sale_price DESC NULLS LAST, v.created_at DESC
      LIMIT limit_count;

      GET DIAGNOSTICS direct_count = ROW_COUNT;
      IF direct_count >= limit_count THEN
        RETURN;
      END IF;
    END IF;
  END IF;

  -- Strategy 2: Full-text search (complex queries or when direct lookup had few results)
  -- Skip ts_rank_cd to avoid computing rank on potentially thousands of rows
  IF limit_count - direct_count > 0 THEN
    RETURN QUERY
    SELECT v.id, v.year, v.make, v.model, v.vin, v.status, v.sale_price, v.current_value,
      0.8::real AS relevance
    FROM public.vehicles v
    WHERE v.is_public = true
      AND v.search_vector @@ to_tsquery('english', query_text)
    ORDER BY v.sale_price DESC NULLS LAST, v.created_at DESC
    LIMIT limit_count - direct_count;
  END IF;
END;
$function$;
