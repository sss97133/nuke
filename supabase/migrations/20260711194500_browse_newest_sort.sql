-- /live (useLiveFloor.ts) calls search_vehicles_browse with p_sort_by='newest',
-- which was not in the sort CASE and silently fell back to v.year DESC — the "live"
-- floor was actually sorted by model year, burying freshly-synced live auctions.
-- Adds 'newest' => v.created_at. (2026-07-11, BAT-LIVE-INGEST)
CREATE OR REPLACE FUNCTION public.search_vehicles_browse(p_make text DEFAULT NULL::text, p_model text DEFAULT NULL::text, p_year_min integer DEFAULT NULL::integer, p_year_max integer DEFAULT NULL::integer, p_price_min numeric DEFAULT NULL::numeric, p_price_max numeric DEFAULT NULL::numeric, p_status text DEFAULT NULL::text, p_source text DEFAULT NULL::text, p_era text DEFAULT NULL::text, p_body_style text DEFAULT NULL::text, p_has_image boolean DEFAULT NULL::boolean, p_has_price boolean DEFAULT NULL::boolean, p_color text DEFAULT NULL::text, p_sort_by text DEFAULT 'year'::text, p_sort_dir text DEFAULT 'desc'::text, p_page integer DEFAULT 1, p_page_size integer DEFAULT 50)
 RETURNS TABLE(id uuid, year integer, make text, model text, vin text, status text, source text, sold_price integer, primary_image_url text, era text, body_style text, total_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sql TEXT;
  v_where TEXT := 'WHERE v.is_public = true AND (v.canonical_vehicle_type IS NULL OR v.canonical_vehicle_type IN (''CAR'',''TRUCK'',''SUV'',''VAN'',''MINIVAN''))';
  v_sort_col TEXT;
  v_sort_direction TEXT;
  v_offset INT;
BEGIN
  v_sort_col := CASE p_sort_by
    WHEN 'year' THEN 'v.year'
    WHEN 'make' THEN 'v.make'
    WHEN 'sold_price' THEN 'v.sold_price'
    WHEN 'created_at' THEN 'v.created_at'
    WHEN 'newest' THEN 'v.created_at'
    WHEN 'status' THEN 'v.status'
    ELSE 'v.year'
  END;

  v_sort_direction := CASE WHEN lower(p_sort_dir) = 'asc' THEN 'ASC' ELSE 'DESC' END;
  v_offset := (COALESCE(p_page, 1) - 1) * COALESCE(p_page_size, 50);

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

  v_sql := format(
    'SELECT v.id, v.year, v.make, v.model, v.vin, v.status, v.source,
            v.sold_price, v.primary_image_url, v.era, v.body_style,
            COUNT(*) OVER() AS total_count
     FROM vehicles v
     %s
     ORDER BY %s %s NULLS LAST
     OFFSET %s LIMIT %s',
    v_where, v_sort_col, v_sort_direction, v_offset, COALESCE(p_page_size, 50)
  );

  RETURN QUERY EXECUTE v_sql;
END;
$function$;
