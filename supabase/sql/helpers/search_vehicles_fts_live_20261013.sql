-- Cached deployed definition, observed 2026-10-13 UTC; synthetic regression baseline only.
CREATE OR REPLACE FUNCTION public.search_vehicles_fts(query_text text, limit_count integer DEFAULT 20, p_auto_only boolean DEFAULT true, offset_count integer DEFAULT 0)
 RETURNS TABLE(id uuid, year integer, make text, model text, vin text, status text, sale_price integer, current_value numeric, relevance real)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  parsed_make text;
  tokens text[];
  batch_count integer := 0;
  direct_count integer := 0;
  raw_query text;
  year_val integer;
  rest_text text;
BEGIN
  tokens := string_to_array(regexp_replace(query_text, '\s*&\s*', ' ', 'g'), ' ');
  raw_query := regexp_replace(query_text, '\s*&\s*', ' ', 'g');

  -- Year prefix: "1967 camaro"
  IF array_length(tokens, 1) >= 2 AND tokens[1] ~ '^\d{4}$' THEN
    year_val := tokens[1]::integer;
    IF year_val BETWEEN 1886 AND 2030 THEN
      rest_text := trim(array_to_string(tokens[2:], ' '));
      RETURN QUERY
      SELECT v.id, v.year, v.make, v.model, v.vin, v.status, v.sale_price, v.current_value,
        0.98::real AS relevance
      FROM public.vehicles v
      WHERE v.is_public = true
        AND v.year = year_val
        AND v.make IS NOT NULL AND v.model IS NOT NULL
        AND (lower(v.make) || ' ' || lower(v.model)) ILIKE '%' || lower(rest_text) || '%'
        AND (NOT p_auto_only OR is_auto_vehicle(v.canonical_vehicle_type, v.make))
      ORDER BY (v.primary_image_url IS NOT NULL) DESC,
               COALESCE(v.image_count, 0) DESC,
               COALESCE(v.bat_view_count, v.view_count, 0) DESC,
               v.sale_price DESC NULLS LAST,
               v.year DESC, v.id
      LIMIT limit_count OFFSET offset_count;
      GET DIAGNOSTICS batch_count = ROW_COUNT;
      direct_count := direct_count + batch_count;
      IF direct_count >= limit_count THEN RETURN; END IF;
    END IF;
  END IF;

  -- Single token: exact make match
  IF array_length(tokens, 1) = 1 THEN
    parsed_make := trim(tokens[1]);
    RETURN QUERY
    SELECT v.id, v.year, v.make, v.model, v.vin, v.status, v.sale_price, v.current_value,
      0.95::real AS relevance
    FROM public.vehicles v
    WHERE v.is_public = true
      AND v.year IS NOT NULL AND v.make IS NOT NULL AND v.model IS NOT NULL
      AND v.make = initcap(parsed_make)
      AND (NOT p_auto_only OR is_auto_vehicle(v.canonical_vehicle_type, v.make))
    ORDER BY (v.primary_image_url IS NOT NULL) DESC,
             COALESCE(v.image_count, 0) DESC,
             COALESCE(v.bat_view_count, v.view_count, 0) DESC,
             v.sale_price DESC NULLS LAST,
             v.year DESC, v.id
    LIMIT limit_count OFFSET offset_count;
    GET DIAGNOSTICS batch_count = ROW_COUNT;
    direct_count := direct_count + batch_count;
    IF direct_count >= limit_count THEN RETURN; END IF;

    -- Trigram make+model search
    RETURN QUERY
    SELECT v.id, v.year, v.make, v.model, v.vin, v.status, v.sale_price, v.current_value,
      0.9::real AS relevance
    FROM public.vehicles v
    WHERE v.is_public = true
      AND v.year IS NOT NULL AND v.make IS NOT NULL AND v.model IS NOT NULL
      AND (lower(v.make) || ' ' || lower(v.model)) ILIKE '%' || lower(parsed_make) || '%'
      AND v.make != initcap(parsed_make)
      AND (NOT p_auto_only OR is_auto_vehicle(v.canonical_vehicle_type, v.make))
    ORDER BY (v.primary_image_url IS NOT NULL) DESC,
             COALESCE(v.image_count, 0) DESC,
             COALESCE(v.bat_view_count, v.view_count, 0) DESC,
             v.sale_price DESC NULLS LAST,
             v.year DESC, v.id
    LIMIT limit_count OFFSET offset_count;
    GET DIAGNOSTICS batch_count = ROW_COUNT;
    direct_count := direct_count + batch_count;
    IF direct_count >= limit_count THEN RETURN; END IF;
  END IF;

  -- 2+ tokens: trigram on make+model
  IF array_length(tokens, 1) >= 2 AND direct_count < limit_count THEN
    RETURN QUERY
    SELECT v.id, v.year, v.make, v.model, v.vin, v.status, v.sale_price, v.current_value,
      0.9::real AS relevance
    FROM public.vehicles v
    WHERE v.is_public = true
      AND v.year IS NOT NULL AND v.make IS NOT NULL AND v.model IS NOT NULL
      AND (lower(v.make) || ' ' || lower(v.model)) ILIKE '%' || lower(raw_query) || '%'
      AND (NOT p_auto_only OR is_auto_vehicle(v.canonical_vehicle_type, v.make))
    ORDER BY (v.primary_image_url IS NOT NULL) DESC,
             COALESCE(v.image_count, 0) DESC,
             COALESCE(v.bat_view_count, v.view_count, 0) DESC,
             v.sale_price DESC NULLS LAST,
             v.year DESC, v.id
    LIMIT limit_count OFFSET offset_count;
  END IF;
END;
$function$
;
