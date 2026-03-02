-- Search RPCs: browse (parameterized filtered query) + browse_stats
-- Uses dynamic SQL with EXECUTE ... USING for safe parameterized queries

-- =============================================================================
-- 1. search_vehicles_browse — parameterized filtered query
-- =============================================================================

CREATE OR REPLACE FUNCTION search_vehicles_browse(
  p_make TEXT DEFAULT NULL,
  p_model TEXT DEFAULT NULL,
  p_year_min INT DEFAULT NULL,
  p_year_max INT DEFAULT NULL,
  p_price_min NUMERIC DEFAULT NULL,
  p_price_max NUMERIC DEFAULT NULL,
  p_status TEXT DEFAULT NULL,
  p_source TEXT DEFAULT NULL,
  p_era TEXT DEFAULT NULL,
  p_body_style TEXT DEFAULT NULL,
  p_has_image BOOLEAN DEFAULT NULL,
  p_has_price BOOLEAN DEFAULT NULL,
  p_color TEXT DEFAULT NULL,
  p_sort_by TEXT DEFAULT 'year',
  p_sort_dir TEXT DEFAULT 'desc',
  p_page INT DEFAULT 1,
  p_page_size INT DEFAULT 50
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
  era TEXT,
  body_style TEXT,
  total_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_sql TEXT;
  v_where TEXT := 'WHERE v.is_public = true';
  v_sort_col TEXT;
  v_sort_direction TEXT;
  v_offset INT;
  v_param_idx INT := 0;
  v_params TEXT[] := ARRAY[]::TEXT[];
BEGIN
  -- Validate sort column against allowlist
  v_sort_col := CASE p_sort_by
    WHEN 'year' THEN 'v.year'
    WHEN 'make' THEN 'v.make'
    WHEN 'sold_price' THEN 'v.sold_price'
    WHEN 'created_at' THEN 'v.created_at'
    WHEN 'status' THEN 'v.status'
    ELSE 'v.year'
  END;

  -- Validate sort direction
  v_sort_direction := CASE WHEN lower(p_sort_dir) = 'asc' THEN 'ASC' ELSE 'DESC' END;

  -- Calculate offset
  v_offset := (COALESCE(p_page, 1) - 1) * COALESCE(p_page_size, 50);

  -- Build WHERE clauses dynamically
  IF p_make IS NOT NULL THEN
    v_where := v_where || ' AND lower(v.make) = lower(' || quote_literal(p_make) || ')';
  END IF;

  IF p_model IS NOT NULL THEN
    v_where := v_where || ' AND lower(v.model) = lower(' || quote_literal(p_model) || ')';
  END IF;

  IF p_year_min IS NOT NULL THEN
    v_where := v_where || ' AND v.year >= ' || p_year_min::TEXT;
  END IF;

  IF p_year_max IS NOT NULL THEN
    v_where := v_where || ' AND v.year <= ' || p_year_max::TEXT;
  END IF;

  IF p_price_min IS NOT NULL THEN
    v_where := v_where || ' AND v.sold_price >= ' || p_price_min::TEXT;
  END IF;

  IF p_price_max IS NOT NULL THEN
    v_where := v_where || ' AND v.sold_price <= ' || p_price_max::TEXT;
  END IF;

  IF p_status IS NOT NULL THEN
    v_where := v_where || ' AND v.status = ' || quote_literal(p_status);
  END IF;

  IF p_source IS NOT NULL THEN
    v_where := v_where || ' AND v.source = ' || quote_literal(p_source);
  END IF;

  IF p_era IS NOT NULL THEN
    v_where := v_where || ' AND v.era = ' || quote_literal(p_era);
  END IF;

  IF p_body_style IS NOT NULL THEN
    v_where := v_where || ' AND lower(v.body_style) = lower(' || quote_literal(p_body_style) || ')';
  END IF;

  IF p_has_image = true THEN
    v_where := v_where || ' AND v.primary_image_url IS NOT NULL';
  END IF;

  IF p_has_price = true THEN
    v_where := v_where || ' AND v.sold_price IS NOT NULL AND v.sold_price > 0';
  END IF;

  IF p_color IS NOT NULL THEN
    v_where := v_where || ' AND lower(v.exterior_color) = lower(' || quote_literal(p_color) || ')';
  END IF;

  -- Build full query
  v_sql := format(
    'SELECT v.id, v.year, v.make, v.model, v.vin, v.status, v.source,
            v.sold_price, v.primary_image_url, v.era, v.body_style,
            COUNT(*) OVER() AS total_count
     FROM vehicles v
     %s
     ORDER BY %s %s NULLS LAST
     OFFSET %s LIMIT %s',
    v_where,
    v_sort_col,
    v_sort_direction,
    v_offset,
    COALESCE(p_page_size, 50)
  );

  RETURN QUERY EXECUTE v_sql;
END;
$$;

COMMENT ON FUNCTION search_vehicles_browse IS 'Parameterized vehicle browse with filters, sorting, and pagination. Returns total_count via window function.';

-- =============================================================================
-- 2. browse_stats — returns JSONB stats for a make
-- =============================================================================

CREATE OR REPLACE FUNCTION browse_stats(p_make TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_result JSONB;
  v_total BIGINT;
  v_with_images BIGINT;
  v_with_price BIGINT;
  v_avg_price NUMERIC;
  v_by_source JSONB;
  v_by_era JSONB;
  v_by_model JSONB;
BEGIN
  -- If no make provided, return stats for all public vehicles
  IF p_make IS NULL THEN
    SELECT
      count(*),
      count(*) FILTER (WHERE primary_image_url IS NOT NULL),
      count(*) FILTER (WHERE sold_price IS NOT NULL AND sold_price > 0),
      round(avg(sold_price) FILTER (WHERE sold_price IS NOT NULL AND sold_price > 0), 2)
    INTO v_total, v_with_images, v_with_price, v_avg_price
    FROM vehicles
    WHERE is_public = true;
  ELSE
    SELECT
      count(*),
      count(*) FILTER (WHERE primary_image_url IS NOT NULL),
      count(*) FILTER (WHERE sold_price IS NOT NULL AND sold_price > 0),
      round(avg(sold_price) FILTER (WHERE sold_price IS NOT NULL AND sold_price > 0), 2)
    INTO v_total, v_with_images, v_with_price, v_avg_price
    FROM vehicles
    WHERE is_public = true
      AND lower(make) = lower(p_make);
  END IF;

  -- by_source: top 10
  SELECT coalesce(jsonb_agg(row_to_json(s)::jsonb), '[]'::jsonb)
  INTO v_by_source
  FROM (
    SELECT source, count(*) AS count
    FROM vehicles
    WHERE is_public = true
      AND (p_make IS NULL OR lower(make) = lower(p_make))
      AND source IS NOT NULL
    GROUP BY source
    ORDER BY count DESC
    LIMIT 10
  ) s;

  -- by_era
  SELECT coalesce(jsonb_agg(row_to_json(e)::jsonb), '[]'::jsonb)
  INTO v_by_era
  FROM (
    SELECT era, count(*) AS count
    FROM vehicles
    WHERE is_public = true
      AND (p_make IS NULL OR lower(make) = lower(p_make))
      AND era IS NOT NULL
    GROUP BY era
    ORDER BY count DESC
  ) e;

  -- by_model: top 20
  SELECT coalesce(jsonb_agg(row_to_json(m)::jsonb), '[]'::jsonb)
  INTO v_by_model
  FROM (
    SELECT model, count(*) AS count
    FROM vehicles
    WHERE is_public = true
      AND (p_make IS NULL OR lower(make) = lower(p_make))
      AND model IS NOT NULL
    GROUP BY model
    ORDER BY count DESC
    LIMIT 20
  ) m;

  v_result := jsonb_build_object(
    'total', v_total,
    'with_images', v_with_images,
    'with_price', v_with_price,
    'avg_price', v_avg_price,
    'by_source', v_by_source,
    'by_era', v_by_era,
    'by_model', v_by_model
  );

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION browse_stats IS 'Returns JSONB stats for a make: total, with_images, with_price, avg_price, by_source (top 10), by_era, by_model (top 20).';
