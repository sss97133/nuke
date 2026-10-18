-- Live definitions as production had them on 2026-10-14 (pg_get_functiondef), the reader that
-- supabase/migrations/20261014052000_vehicles_priced_sales_partial_indexes.sql speeds up and its contract
-- supabase/sql/test_vehicles_priced_sales_indexes.sql. The migration changes neither function.
--   get_model_price_history(text,text,integer,integer,integer)  md5(pg_get_functiondef) a658400e5f10d1ddcc020b20f4ec31d1  -- gitleaks:allow (md5 checksum of a function definition, not a secret)
--   vehicle_sale_basis(text,text,text,text,text,numeric,text,jsonb,timestamptz)  md5(pg_get_functiondef) 4a648fbaef6ff2f41fb44226a8a68b08  -- gitleaks:allow (md5 checksum of a function definition, not a secret)

CREATE OR REPLACE FUNCTION public.vehicle_sale_basis(p_sale_status text, p_auction_outcome text, p_canonical_platform text, p_listing_url text, p_discovery_url text, p_sale_price numeric, p_notes text, p_import_metadata jsonb, p_created_at timestamp with time zone)
 RETURNS text
 LANGUAGE sql
 STABLE PARALLEL SAFE
AS $function$
  WITH x AS (
    SELECT
      CASE
        WHEN p_listing_url LIKE 'conceptcarz://%' OR p_listing_url LIKE 'https://conceptcarz://%' THEN 'conceptcarz'
        ELSE COALESCE(
          NULLIF(p_canonical_platform, 'unknown'),
          CASE
            WHEN COALESCE(p_listing_url, p_discovery_url, '') ~* 'carsandbids\.com'     THEN 'cars-and-bids'
            WHEN COALESCE(p_listing_url, p_discovery_url, '') ~* 'mecum\.com'           THEN 'mecum'
            WHEN COALESCE(p_listing_url, p_discovery_url, '') ~* 'barrett-jackson\.com' THEN 'barrett-jackson'
            WHEN COALESCE(p_listing_url, p_discovery_url, '') ~* 'goodingco\.com'       THEN 'gooding'
            ELSE NULL
          END)
      END AS plat
  )
  SELECT CASE
    -- contradicting testimony: an explicit no-sale on the row means the sale is not proven (2026-09-27, part 4)
    WHEN p_auction_outcome IN ('reserve_not_met', 'no_sale')
      OR p_sale_status IN ('not_sold', 'unsold', 'bid_to')
      OR (plat = 'mecum' AND p_notes ~ 'Result: bid-goes-on')                                              THEN NULL
    -- the rule: a status says money moved
    WHEN p_sale_status = 'sold' OR p_auction_outcome = 'sold' THEN 'status'
    -- after the cutover nothing but a status counts
    WHEN p_created_at >= '2026-09-27 00:00:00+00'::timestamptz THEN NULL
    -- legacy rows: the platform's own sale marker, left on the row by the writer
    WHEN plat = 'mecum'           AND p_sale_price > 0 AND p_notes ~ 'Result: sold'                       THEN 'mecum_sale_result'
    WHEN plat = 'cars-and-bids'   AND p_sale_price > 0 AND p_import_metadata->>'auction_status' = 'sold'  THEN 'cab_auction_status'
    WHEN plat = 'gooding'         AND p_sale_price > 0                                                    THEN 'gooding_sale_price'
    WHEN plat = 'barrett-jackson' AND p_sale_price > 0
         AND p_auction_outcome IS DISTINCT FROM 'no_sale' AND p_sale_status IS DISTINCT FROM 'not_sold'   THEN 'bj_result_price'
    WHEN plat = 'conceptcarz'     AND p_sale_price > 0 AND p_notes ~ '"status": "sold"'                   THEN 'conceptcarz_sold'
    -- everything else (BaT, pcarmarket, bonhams, rm-sothebys, broad-arrow, hagerty, every classified,
    -- every aggregator, unknown): not a sale until a status proves it
    ELSE NULL
  END
  FROM x;
$function$;

CREATE OR REPLACE FUNCTION public.get_model_price_history(p_make text, p_model text, p_limit integer DEFAULT 30, p_year_min integer DEFAULT NULL::integer, p_year_max integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  result jsonb;
BEGIN
  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'date', v.sale_date,
        'price', v.sale_price,
        'vehicle_id', v.id,
        'year', v.year,
        'model', v.model,
        'platform', v.platform
      ) ORDER BY v.sale_date ASC
    ),
    '[]'::jsonb
  ) INTO result
  FROM (
    SELECT id, year, model, sale_date, sale_price, coalesce(nullif(canonical_platform, 'unknown'), platform_source) AS platform
    FROM vehicles
    WHERE is_public
      AND lower(make) = lower(p_make)
      AND (lower(model) = lower(p_model) OR lower(normalized_model) = lower(p_model))
      AND (p_year_min IS NULL OR year >= p_year_min)
      AND (p_year_max IS NULL OR year <= p_year_max)
      AND sale_price > 0
      AND sale_date IS NOT NULL
      AND deleted_at IS NULL
      AND listing_kind IS DISTINCT FROM 'non_vehicle_item'
      AND vehicle_sale_basis(sale_status, auction_outcome, canonical_platform, listing_url, discovery_url,
                             sale_price::numeric, notes, import_metadata, created_at) IS NOT NULL
    ORDER BY sale_date DESC
    LIMIT least(greatest(coalesce(p_limit, 30), 1), 500)
  ) v;

  RETURN result;
END;
$function$;
