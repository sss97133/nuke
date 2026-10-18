-- Replan each filtered inspection with its actual filter values. The old SQL
-- function retained a generic optional-filter plan; a three-row live Mustang
-- request timed out under both the role default and an 8s diagnostic budget.
-- Keep source-label matching, existing public/photo eligibility, return columns,
-- sorting, defaults, owner and ACL unchanged. No valuation/availability claims.
BEGIN;
SET LOCAL statement_timeout = '8s';
SET LOCAL lock_timeout = '2s';

-- This live function was not previously tracked. Refuse to overwrite a newer owner.
DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
    WHERE p.oid = to_regprocedure('public.vehicles_by_filters(jsonb,integer)')
      AND l.lanname = 'sql'
      AND p.prosecdef
      AND md5(p.prosrc) = 'e26413022ccc04aaaa79b00b1711cf10'
  ) THEN
    RAISE EXCEPTION 'vehicles_by_filters changed; review the current owner before replacing';
  END IF;
END;
$guard$;

CREATE OR REPLACE FUNCTION public.vehicles_by_filters(p_filters jsonb DEFAULT '{}'::jsonb, p_limit integer DEFAULT 60)
RETURNS TABLE(id uuid, year integer, make text, model text, "trim" text, primary_image_url text, city text, state text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO public
AS $function$
BEGIN
  RETURN QUERY EXECUTE $query$
    WITH v AS (
      SELECT id, trim AS trm, make, model, year, city, state, sale_date, color_family, mileage,
             bat_watchers AS watchers,
             COALESCE(sale_price, sold_price, canonical_sold_price) AS price,
             primary_image_url AS img,
             CASE WHEN canonical_platform IN ('bat','cars-and-bids','barrett-jackson','mecum','bonhams','classiccars-com','gooding','rm-sothebys','broad-arrow') THEN 0 ELSE 1 END AS plat_rank
      FROM public.vehicles WHERE is_public AND primary_image_url IS NOT NULL AND primary_image_url <> ''
    )
    SELECT id, year, make, model, trm, img, city, state
    FROM v
    WHERE TRUE
      AND (NOT ($1 ? 'make') OR (make) = $1->>'make')
      AND (NOT ($1 ? 'model') OR (model) = $1->>'model')
      AND (NOT ($1 ? 'year') OR (year::text) = $1->>'year')
      AND (NOT ($1 ? 'metro') OR (city||', '||state) = $1->>'metro')
      AND (NOT ($1 ? 'dow') OR (to_char(sale_date,'Dy')) = $1->>'dow')
      AND (NOT ($1 ? 'color') OR (color_family) = $1->>'color')
      AND (NOT ($1 ? 'price') OR (CASE WHEN price IS NULL THEN NULL WHEN price<10000 THEN '<$10k' WHEN price<25000 THEN '$10-25k' WHEN price<50000 THEN '$25-50k' WHEN price<100000 THEN '$50-100k' WHEN price<250000 THEN '$100-250k' WHEN price<1000000 THEN '$250k-1M' ELSE '$1M+' END) = $1->>'price')
      AND (NOT ($1 ? 'mileage') OR (CASE WHEN mileage IS NULL THEN NULL WHEN mileage<1000 THEN 'Under 1k mi' WHEN mileage<10000 THEN '1-10k mi' WHEN mileage<50000 THEN '10-50k mi' WHEN mileage<100000 THEN '50-100k mi' WHEN mileage<150000 THEN '100-150k mi' ELSE '150k+ mi' END) = $1->>'mileage')
      AND (NOT ($1 ? 'popularity') OR (CASE WHEN watchers IS NULL THEN NULL WHEN watchers>=500 THEN '500+ watching' WHEN watchers>=200 THEN '200-499 watching' WHEN watchers>=100 THEN '100-199 watching' WHEN watchers>=50 THEN '50-99 watching' WHEN watchers>=10 THEN '10-49 watching' ELSE 'Under 10 watching' END) = $1->>'popularity')
    ORDER BY plat_rank, (price IS NULL), price DESC NULLS LAST
    LIMIT $2
  $query$ USING p_filters, p_limit;
END;
$function$;

COMMIT;
