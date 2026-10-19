-- search_vehicles_browse: a created_at page walks idx_vehicles_created_at, and a caller that never reads the total can
-- skip it.
--
-- Measured on production 2026-10-14 (EXPLAIN ANALYZE, BUFFERS): /live asks for the 60 newest public vehicles with an
-- image (p_sort_by 'newest', p_has_image true). The function ordered by created_at DESC NULLS LAST, which matches no
-- index (idx_vehicles_created_at scans backward as DESC NULLS FIRST), and COUNT(*) OVER() counts every match, so each
-- call ran a parallel sequential scan of all 308k heap pages: 17.5 s for the page without the count, and the anon
-- 15 s statement timeout with it (both /live calls 500, 57014). The same page on the index: 113 ms cold, 74 buffers.
--
-- Change, from the live definition (supabase/sql/helpers/search_vehicles_browse_live_20261014.sql, guarded by its
-- source hash below):
--   * created_at sorts ('created_at', 'newest') add `v.created_at IS NOT NULL` and drop the explicit NULLS LAST, so
--     either direction matches the index. created_at is never NULL (default now(); 0 NULL rows of 1,014,416 on
--     2026-10-14); a row without one would now be left out of a created_at sort instead of listed last.
--   * New last argument p_include_total boolean DEFAULT true. false returns total_count NULL and skips the count;
--     /live (useLiveFloor) never reads it. Every existing call is unchanged: the header search reads the total and
--     keeps the exact count.
--   * The argument list changes, so the old function is dropped and the new one created in this transaction. Execute
--     is stated: anon, authenticated, service_role (the live ACL also granted PUBLIC).
-- Contract: supabase/sql/test_search_vehicles_browse_newest.sql.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $$
DECLARE
  v_old regprocedure := to_regprocedure('public.search_vehicles_browse(text,text,integer,integer,numeric,numeric,text,text,text,text,boolean,boolean,text,text,text,integer,integer)');
  v_new regprocedure := to_regprocedure('public.search_vehicles_browse(text,text,integer,integer,numeric,numeric,text,text,text,text,boolean,boolean,text,text,text,integer,integer,boolean)');
  v_hash text;
BEGIN
  IF v_old IS NOT NULL THEN
    SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'base64') INTO v_hash FROM pg_proc WHERE oid = v_old;
    IF v_hash <> 'HJuKY1g9UNGqE8HN1PQYIqyihj2UQoi1qlZH71XwEaI=' THEN
      RAISE EXCEPTION 'search_vehicles_browse is not the 2026-10-14 source this migration was written from (sha256 %)', v_hash;
    END IF;
    IF v_new IS NOT NULL THEN
      RAISE EXCEPTION 'search_vehicles_browse already has an 18-argument form beside the live one';
    END IF;
    EXECUTE 'DROP FUNCTION public.search_vehicles_browse(text,text,integer,integer,numeric,numeric,text,text,text,text,boolean,boolean,text,text,text,integer,integer)';
  ELSIF v_new IS NOT NULL THEN
    -- a re-run: this migration's function is in place; recreate it unchanged
    EXECUTE 'DROP FUNCTION public.search_vehicles_browse(text,text,integer,integer,numeric,numeric,text,text,text,text,boolean,boolean,text,text,text,integer,integer,boolean)';
  ELSE
    RAISE EXCEPTION 'search_vehicles_browse is missing';
  END IF;
END $$;

CREATE FUNCTION public.search_vehicles_browse(p_make text DEFAULT NULL::text, p_model text DEFAULT NULL::text, p_year_min integer DEFAULT NULL::integer, p_year_max integer DEFAULT NULL::integer, p_price_min numeric DEFAULT NULL::numeric, p_price_max numeric DEFAULT NULL::numeric, p_status text DEFAULT NULL::text, p_source text DEFAULT NULL::text, p_era text DEFAULT NULL::text, p_body_style text DEFAULT NULL::text, p_has_image boolean DEFAULT NULL::boolean, p_has_price boolean DEFAULT NULL::boolean, p_color text DEFAULT NULL::text, p_sort_by text DEFAULT 'year'::text, p_sort_dir text DEFAULT 'desc'::text, p_page integer DEFAULT 1, p_page_size integer DEFAULT 50, p_include_total boolean DEFAULT true)
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
  v_nulls TEXT := ' NULLS LAST';
  v_total TEXT := CASE WHEN COALESCE(p_include_total, true) THEN 'COUNT(*) OVER()' ELSE 'NULL::bigint' END;
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
            %s AS total_count
     FROM vehicles v
     %s
     ORDER BY %s %s%s
     OFFSET %s LIMIT %s',
    v_total, v_where, v_sort_col, v_sort_direction, v_nulls, v_offset, COALESCE(p_page_size, 50)
  );

  RETURN QUERY EXECUTE v_sql;
END;
$function$;

REVOKE ALL ON FUNCTION public.search_vehicles_browse(text,text,integer,integer,numeric,numeric,text,text,text,text,boolean,boolean,text,text,text,integer,integer,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_vehicles_browse(text,text,integer,integer,numeric,numeric,text,text,text,text,boolean,boolean,text,text,text,integer,integer,boolean) TO anon, authenticated, service_role;

COMMIT;
