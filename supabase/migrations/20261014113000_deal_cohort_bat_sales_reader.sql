-- deal_cohort_bat_sales: the deal page's cohort of BaT-listed public vehicles (one make, a model token, a year range),
-- read through the make+model trigram index instead of under the row policies.
--
-- Measured on production 2026-10-14: /deal/<id> read the cohort straight from vehicles as anon
-- (make in (casings), model ilike '%token%', year range, deleted_at is null, listing_url ilike '%bringatrailer.com%').
-- Under the row policies the ilike tests cannot be index conditions, so the plan took every Chevrolet of 1969-1994
-- from idx_vehicles_make_year (66,581 rows, 48,975 heap blocks) to keep 828: 15.1 s, then the anon statement timeout
-- (500, 57014). The same 828 rows through idx_vehicles_make_model_trgm: 150 ms (377 index buffers for the model
-- token; 2,822 when the make's trigrams are in the pattern too).
--
-- The reader states its population itself: public, undeleted vehicles with a year, make and model (the trigram
-- index's own predicate), lower(make) equal to the subject's, the token inside lower(model), the year range, and a
-- BaT listing URL. A caller's private vehicles are not comparables; anon never saw them. It returns the 21 columns
-- the deal page reads (VehicleCompRow), all of them public; nothing else of the row. The query is planned
-- per call (EXECUTE with the values written in), so the trigram index is chosen for the actual token. In the token,
-- % _ and \ are literal (the old ilike treated % and _ as wildcards). Ordered by id, so a caller can page with
-- PostgREST's range like the old read.
-- Contract: supabase/sql/test_deal_cohort_bat_sales.sql.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $$ BEGIN
  IF to_regclass('public.idx_vehicles_make_model_trgm') IS NULL THEN
    RAISE EXCEPTION 'deal_cohort_bat_sales reads through idx_vehicles_make_model_trgm, which is missing';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.deal_cohort_bat_sales(p_make text, p_model text, p_year_start integer, p_year_end integer)
 RETURNS TABLE(id uuid, year integer, make text, model text, "trim" text, sale_price integer, sale_status text,
   auction_outcome text, sale_date date, listing_url text, bat_auction_url text, discovery_url text,
   bat_sold_price numeric, high_bid integer, mileage integer, transmission text, engine_size text, engine_type text,
   bat_listing_title text, title text, primary_image_url text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_make text := lower(btrim(p_make));
  v_model text := lower(btrim(p_model));
  v_token text;
  v_pattern text;
BEGIN
  IF coalesce(v_make, '') = '' OR coalesce(v_model, '') = '' OR p_year_start IS NULL OR p_year_end IS NULL THEN
    RETURN;
  END IF;
  -- LIKE treats % _ and \ as special; the token's own are literal
  v_token := replace(replace(replace(v_model, '\', '\\'), '%', '\%'), '_', '\_');
  -- a token of three characters or more carries its own trigrams; a shorter one leans on the make's
  v_pattern := CASE WHEN length(v_model) >= 3 THEN '%' || v_token || '%'
                    ELSE replace(replace(replace(v_make, '\', '\\'), '%', '\%'), '_', '\_') || ' %' || v_token || '%' END;
  RETURN QUERY EXECUTE format($q$
    SELECT v.id, v.year, v.make, v.model, v.trim, v.sale_price, v.sale_status, v.auction_outcome, v.sale_date,
           v.listing_url, v.bat_auction_url, v.discovery_url, v.bat_sold_price::numeric, v.high_bid, v.mileage,
           v.transmission, v.engine_size, v.engine_type, v.bat_listing_title, v.title, v.primary_image_url
    FROM public.vehicles v
    WHERE v.is_public = true AND v.year IS NOT NULL AND v.make IS NOT NULL AND v.model IS NOT NULL
      AND ((lower(v.make) || ' '::text) || lower(v.model)) LIKE %L
      AND lower(v.make) = %L
      AND lower(v.model) LIKE %L
      AND v.year >= %s AND v.year <= %s
      AND v.deleted_at IS NULL
      AND v.listing_url ILIKE '%%bringatrailer.com%%'
    ORDER BY v.id$q$, v_pattern, v_make, '%' || v_token || '%', p_year_start, p_year_end);
END
$function$;

COMMENT ON FUNCTION public.deal_cohort_bat_sales(text, text, integer, integer) IS
  'The deal page''s comparable cohort: public, undeleted vehicles of one make (lower-case equal), a model token inside the model, a year range and a BaT listing URL; the 21 public columns the deal page reads (VehicleCompRow), ordered by id. Reads idx_vehicles_make_model_trgm. 20261014113000.';
REVOKE ALL ON FUNCTION public.deal_cohort_bat_sales(text, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.deal_cohort_bat_sales(text, text, integer, integer) TO anon, authenticated, service_role;

COMMIT;
