-- search_vehicles_browse: leave deleted records out, and price a row by its sale basis.
--
-- Measured on production 2026-10-20 05:50Z (bounded reads through scripts/data/q.sh):
--   * 79,617 of 983,252 public vehicles rows carry deleted_at (a March 2026 soft delete never flipped is_public).
--     The reader filtered on is_public only, so /browse?make=Porsche&model=Carrera%20GT listed "50 of 438
--     vehicles" of which 272 were deleted February stubs (source unknown, no year, no price, no photo) and 23 more
--     were deleted house records; the live population is 143. Every other public reader (treemap_populations,
--     popup_vehicle_intel_public_cohort, idx_vehicles_public_make_search_rank) already states deleted_at IS NULL.
--   * The reader printed and sorted v.sold_price, a legacy column set on 41,264 live public rows, while the
--     ledger's sale basis (sale_status = 'sold' AND sale_price > 0, what vehicle_sale_basis and the market readers
--     count) holds 344,753. On the Carrera GT page every Gooding, RM and Bonhams sale printed "--" and "PRICE HIGH"
--     ordered by a column those rows never had.
--
-- Change, from the live definition (prosrc sha256 EItN983ajYAB+EUxJktj5oVADPl4qiXBwWqv/4JGKnE=, the 2026-10-14
-- 18-argument form):
--   * The base WHERE adds v.deleted_at IS NULL and v.listing_kind IS DISTINCT FROM 'non_vehicle_item'.
--   * sold_price (the output column, the 'sold_price' sort, p_price_min / p_price_max and p_has_price) reads the
--     sale basis first: CASE WHEN v.sale_status = 'sold' AND v.sale_price > 0 THEN v.sale_price ELSE v.sold_price END.
--     The column name and type are unchanged, so every caller (BrowseVehicles, useLiveFloor) keeps its shape.
--   * Same signature, so CREATE OR REPLACE; the guard below refuses to replay over any other source than the one
--     this was written from, or its own.
-- Contract: supabase/sql/test_search_vehicles_browse_sale_basis.sql.
SET statement_timeout = '30s';
SET lock_timeout = '5s';
BEGIN;

DO $$
DECLARE
  v_fn regprocedure := to_regprocedure('public.search_vehicles_browse(text,text,integer,integer,numeric,numeric,text,text,text,text,boolean,boolean,text,text,text,integer,integer,boolean)');
  v_src text;
  v_hash text;
BEGIN
  IF v_fn IS NULL THEN
    RAISE EXCEPTION 'search_vehicles_browse (18 arguments) is missing; apply 20261014111500 first';
  END IF;
  SELECT prosrc, encode(sha256(convert_to(prosrc, 'UTF8')), 'base64') INTO v_src, v_hash FROM pg_proc WHERE oid = v_fn;
  IF v_hash <> 'EItN983ajYAB+EUxJktj5oVADPl4qiXBwWqv/4JGKnE=' AND v_src NOT LIKE '%sale basis (2026-10-20)%' THEN
    RAISE EXCEPTION 'search_vehicles_browse is not the 2026-10-14 source this migration was written from (sha256 %)', v_hash;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.search_vehicles_browse(p_make text DEFAULT NULL::text, p_model text DEFAULT NULL::text, p_year_min integer DEFAULT NULL::integer, p_year_max integer DEFAULT NULL::integer, p_price_min numeric DEFAULT NULL::numeric, p_price_max numeric DEFAULT NULL::numeric, p_status text DEFAULT NULL::text, p_source text DEFAULT NULL::text, p_era text DEFAULT NULL::text, p_body_style text DEFAULT NULL::text, p_has_image boolean DEFAULT NULL::boolean, p_has_price boolean DEFAULT NULL::boolean, p_color text DEFAULT NULL::text, p_sort_by text DEFAULT 'year'::text, p_sort_dir text DEFAULT 'desc'::text, p_page integer DEFAULT 1, p_page_size integer DEFAULT 50, p_include_total boolean DEFAULT true)
 RETURNS TABLE(id uuid, year integer, make text, model text, vin text, status text, source text, sold_price integer, primary_image_url text, era text, body_style text, total_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sql TEXT;
  -- Public, not deleted, a vehicle (not a non-vehicle item), of a road vehicle type or an unclassified one.
  v_where TEXT := 'WHERE v.is_public = true AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM ''non_vehicle_item'' AND (v.canonical_vehicle_type IS NULL OR v.canonical_vehicle_type IN (''CAR'',''TRUCK'',''SUV'',''VAN'',''MINIVAN''))';
  -- The row's price: its sale basis (2026-10-20) when the ledger says it sold for an amount, else the legacy column.
  v_price TEXT := '(CASE WHEN v.sale_status = ''sold'' AND v.sale_price > 0 THEN v.sale_price ELSE v.sold_price END)';
  v_sort_col TEXT;
  v_sort_direction TEXT;
  v_offset INT;
  v_nulls TEXT := ' NULLS LAST';
  v_total TEXT := CASE WHEN COALESCE(p_include_total, true) THEN 'COUNT(*) OVER()' ELSE 'NULL::bigint' END;
BEGIN
  v_sort_col := CASE p_sort_by
    WHEN 'year' THEN 'v.year'
    WHEN 'make' THEN 'v.make'
    WHEN 'sold_price' THEN v_price
    WHEN 'created_at' THEN 'v.created_at'
    WHEN 'newest' THEN 'v.created_at'
    WHEN 'status' THEN 'v.status'
    ELSE 'v.year'
  END;

  v_sort_direction := CASE WHEN lower(p_sort_dir) = 'asc' THEN 'ASC' ELSE 'DESC' END;

  -- created_at is never NULL (default now(); 0 NULL rows of 1,014,416 on 2026-10-14). Stating it lets the order use
  -- idx_vehicles_created_at in either direction, so a page walks the index; DESC NULLS LAST matched no index, and
  -- every call sorted all public vehicles (17 s cold for the newest 60 with an image).
  IF v_sort_col = 'v.created_at' THEN
    v_where := v_where || ' AND v.created_at IS NOT NULL';
    v_nulls := '';
  END IF;
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
    v_where := v_where || ' AND ' || v_price || ' >= ' || p_price_min::TEXT;
  END IF;
  IF p_price_max IS NOT NULL THEN
    v_where := v_where || ' AND ' || v_price || ' <= ' || p_price_max::TEXT;
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
    v_where := v_where || ' AND ' || v_price || ' > 0';
  END IF;
  IF p_color IS NOT NULL THEN
    v_where := v_where || ' AND lower(v.exterior_color) = lower(' || quote_literal(p_color) || ')';
  END IF;

  v_sql := format(
    'SELECT v.id, v.year, v.make, v.model, v.vin, v.status, v.source,
            %s::integer AS sold_price, v.primary_image_url, v.era, v.body_style,
            %s AS total_count
     FROM vehicles v
     %s
     ORDER BY %s %s%s
     OFFSET %s LIMIT %s',
    v_price, v_total, v_where, v_sort_col, v_sort_direction, v_nulls, v_offset, COALESCE(p_page_size, 50)
  );

  RETURN QUERY EXECUTE v_sql;
END;
$function$;

COMMENT ON FUNCTION public.search_vehicles_browse(text,text,integer,integer,numeric,numeric,text,text,text,text,boolean,boolean,text,text,text,integer,integer,boolean) IS
  'One page of public vehicles (not deleted, not non-vehicle items) by make, model, year, price, status, source, era, body style, image, color. sold_price is the sale basis (sale_status sold with sale_price) else the legacy sold_price; the sold_price sort, price bounds and p_has_price read the same expression. 2026-10-20.';

REVOKE ALL ON FUNCTION public.search_vehicles_browse(text,text,integer,integer,numeric,numeric,text,text,text,text,boolean,boolean,text,text,text,integer,integer,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_vehicles_browse(text,text,integer,integer,numeric,numeric,text,text,text,text,boolean,boolean,text,text,text,integer,integer,boolean) TO anon, authenticated, service_role;

COMMIT;
RESET statement_timeout;
RESET lock_timeout;
