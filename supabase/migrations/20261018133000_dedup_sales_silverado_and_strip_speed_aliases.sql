-- 1. Strip generic transmission, door-count, and body-style aliases ('3 speed', '4 speed', '5 speed',
--    '6 speed', '2 door coupe', '2 door hardtop', '4 door sedan', 'station wagon', 'n a', 'flatbed',
--    'stake bed', 'panel truck', etc.) from canonical_models.aliases.
--    Because mv_model_family_names ranks alias matches by word count descending (g.n DESC), 2- and 3-word
--    generic aliases like '4 speed', '5 speed', and '2 door coupe' on rows such as Chevrolet Bel Air,
--    BMW 3 Series, Nissan Sentra, Ford Deluxe, Alfa Romeo Spider, Audi 5000, Fiat 500, and Saab 900
--    out-ranked 1-word canonical model names (Corvette, Camaro, Chevelle, Impala, C1500, K1500, Silverado,
--    2002tii, 535i, M3, Z3, 300ZX, 280Z, 240Z, 510, etc.) whenever a listing model ended in '4-Speed',
--    '5-Speed', or '2 Door Coupe'.
-- 2. Expand treemap_family_models and treemap_family_sales for Chevrolet Silverado (to include 1975-1998
--    C/K and Pickup rows with 'Silverado' in model), GMC Sierra (to include GMC truck rows with 'Sierra'
--    in model), and include 'Silverado', 'C3500', 'K3500' in the Chevrolet Pickup umbrella.
-- 3. Deduplicate same-day, same-price, same-source, same-year discovery/detail duplicate rows in
--    treemap_family_sales and treemap_sales, and expand treemap_years / treemap_sales model matching so
--    drilling into a family root or series name (e.g. Chevrolet -> Silverado -> 1976) returns all
--    matching Silverado sales rather than only bare-model strings.

UPDATE public.canonical_models m
SET aliases = COALESCE((
  SELECT array_agg(a ORDER BY ord)
  FROM (
    SELECT a, min(ord) AS ord
    FROM unnest(COALESCE(m.aliases, '{}'::text[])) WITH ORDINALITY AS t(a, ord)
    WHERE a NOT IN (
      '3 speed', '4 speed', '5 speed', '6 speed',
      '3-speed', '4-speed', '5-speed', '6-speed',
      '2 door', '4 door', '2-door', '4-door',
      '2 door coupe', '2 door hardtop', '2 door sedan', '4 door sedan',
      'station wagon', 'n a', 'n/a',
      'flatbed', 'stake bed', 'panel truck',
      'street rod', 'business coupe', 'sprint turbo', 'laguna s3'
    )
    AND NOT (
      a IN (
        'coupe', 'sedan', 'convertible', 'roadster', 'cabriolet',
        'wagon', 'hardtop', 'fastback', 'hatchback', 'targa',
        'pickup', 'truck', 'van'
      )
      AND lower(btrim(m.canonical_model)) <> a
      AND NOT (m.make = 'Mazda' AND m.canonical_model = 'MX-5 Miata' AND a = 'roadster')
    )
    GROUP BY a
  ) s
), '{}'::text[])
WHERE m.aliases IS NOT NULL
  AND array_length(m.aliases, 1) > 0;

UPDATE public.canonical_models m
SET aliases = (
  SELECT array_agg(a ORDER BY ord)
  FROM (
    SELECT a, min(ord) AS ord
    FROM unnest(COALESCE(m.aliases, '{}'::text[]) || ARRAY['stingray', 'sting ray']) WITH ORDINALITY AS t(a, ord)
    GROUP BY a
  ) s
)
WHERE m.make = 'Chevrolet'
  AND m.canonical_model = 'Corvette'
  AND NOT (COALESCE(m.aliases, '{}'::text[]) @> ARRAY['stingray', 'sting ray']);

UPDATE public.canonical_models m
SET aliases = (
  SELECT array_agg(a ORDER BY ord)
  FROM (
    SELECT a, min(ord) AS ord
    FROM unnest(COALESCE(m.aliases, '{}'::text[]) || ARRAY['silverado pickup']) WITH ORDINALITY AS t(a, ord)
    GROUP BY a
  ) s
)
WHERE m.make = 'Chevrolet'
  AND m.canonical_model = 'Silverado'
  AND NOT (COALESCE(m.aliases, '{}'::text[]) @> ARRAY['silverado pickup']);

CREATE OR REPLACE FUNCTION public.treemap_family_models(p_brand text, p_family_key text)
 RETURNS TABLE(model text, sold bigint, sold_any bigint, offered bigint, usd bigint, dated bigint,
               sold_12m bigint, sold_prior_12m bigint, usd_12m bigint, usd_prior_12m bigint, as_of timestamptz)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH target_keys AS (
    SELECT p_family_key AS family_key
    UNION
    SELECT DISTINCT m.family_key
    FROM public.mv_family_market m
    WHERE m.brand = p_brand
      AND EXISTS (
        SELECT 1
        FROM public.mv_family_market u
        WHERE u.brand = p_brand
          AND u.family_key = p_family_key
          AND u.family = 'Pickup'
      )
      AND (
        (p_brand = 'Chevrolet' AND m.family IN (
          'Pickup', '3100', '3600', '3800', 'Apache', 'Cameo',
          'C10', 'K10', 'C20', 'K20', 'C30', 'K30',
          'C1500', 'K1500', '454 SS', 'C2500', 'K2500', 'C3500', 'K3500', '3500',
          'S10', 'S-10 Pickup', 'Silverado'
        ))
        OR (p_brand = 'GMC' AND m.family IN (
          'Pickup', 'C1500', 'K1500', 'Sierra', 'Syclone',
          'Sonoma', 'S15 Pickup', 'Caballero', 'C2500', 'K2500', 'C3500', 'K3500'
        ))
        OR (p_brand = 'Ford' AND m.family IN (
          'Pickup', 'F-1', 'F-100', 'F-150', 'F-250', 'F-350', 'F-450', 'Ranger'
        ))
      )
  ),
  matched_models AS (
    SELECT nullif(m.model, '') AS model, m.model_key, m.sold, m.sold_any, m.offered, m.usd, m.bat_dated,
           m.bat_sold_12m, m.bat_sold_prior_12m, m.bat_usd_12m, m.bat_usd_prior_12m, m.as_of
    FROM public.mv_family_market m
    JOIN target_keys tk ON tk.family_key = m.family_key
    WHERE m.brand = p_brand AND m.sold > 0
    UNION
    SELECT nullif(m.model, '') AS model, m.model_key, m.sold, m.sold_any, m.offered, m.usd, m.bat_dated,
           m.bat_sold_12m, m.bat_sold_prior_12m, m.bat_usd_12m, m.bat_usd_prior_12m, m.as_of
    FROM public.mv_family_market m
    WHERE m.brand = p_brand AND m.sold > 0
      AND (
        (
          p_brand = 'Chevrolet'
          AND EXISTS (
            SELECT 1 FROM public.mv_family_market u
            WHERE u.brand = p_brand AND u.family_key = p_family_key AND u.family = 'Silverado'
          )
          AND m.model ILIKE '%silverado%'
        )
        OR (
          p_brand = 'GMC'
          AND EXISTS (
            SELECT 1 FROM public.mv_family_market u
            WHERE u.brand = p_brand AND u.family_key = p_family_key AND u.family = 'Sierra'
          )
          AND m.model ILIKE '%sierra%'
        )
      )
  )
  SELECT model, sold, sold_any, offered, usd, bat_dated,
         bat_sold_12m, bat_sold_prior_12m, bat_usd_12m, bat_usd_prior_12m, as_of
  FROM matched_models
  ORDER BY usd DESC, model_key
  LIMIT 200;
$function$;

REVOKE ALL ON FUNCTION public.treemap_family_models(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.treemap_family_models(text, text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.treemap_family_sales(p_brand text, p_family_key text, p_limit integer DEFAULT 12000)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH target_keys AS (
    SELECT p_family_key AS family_key
    UNION
    SELECT DISTINCT m.family_key
    FROM public.mv_family_market m
    WHERE m.brand = p_brand
      AND EXISTS (
        SELECT 1
        FROM public.mv_family_market u
        WHERE u.brand = p_brand
          AND u.family_key = p_family_key
          AND u.family = 'Pickup'
      )
      AND (
        (p_brand = 'Chevrolet' AND m.family IN (
          'Pickup', '3100', '3600', '3800', 'Apache', 'Cameo',
          'C10', 'K10', 'C20', 'K20', 'C30', 'K30',
          'C1500', 'K1500', '454 SS', 'C2500', 'K2500', 'C3500', 'K3500', '3500',
          'S10', 'S-10 Pickup', 'Silverado'
        ))
        OR (p_brand = 'GMC' AND m.family IN (
          'Pickup', 'C1500', 'K1500', 'Sierra', 'Syclone',
          'Sonoma', 'S15 Pickup', 'Caballero', 'C2500', 'K2500', 'C3500', 'K3500'
        ))
        OR (p_brand = 'Ford' AND m.family IN (
          'Pickup', 'F-1', 'F-100', 'F-150', 'F-250', 'F-350', 'F-450', 'Ranger'
        ))
      )
  ),
  raw_w AS (
    SELECT s.vehicle_id, s.sale_date, s.usd, s.source, s.year, s.model
    FROM public.mv_family_sales s
    JOIN target_keys tk ON tk.family_key = s.family_key
    WHERE s.brand = p_brand
      AND s.sale_date > current_date - 1826
      AND s.sale_date <= current_date
    UNION
    SELECT s.vehicle_id, s.sale_date, s.usd, s.source, s.year, s.model
    FROM public.mv_family_sales s
    WHERE s.brand = p_brand
      AND s.sale_date > current_date - 1826
      AND s.sale_date <= current_date
      AND (
        (
          p_brand = 'Chevrolet'
          AND EXISTS (
            SELECT 1 FROM public.mv_family_market u
            WHERE u.brand = p_brand AND u.family_key = p_family_key AND u.family = 'Silverado'
          )
          AND s.model ILIKE '%silverado%'
        )
        OR (
          p_brand = 'GMC'
          AND EXISTS (
            SELECT 1 FROM public.mv_family_market u
            WHERE u.brand = p_brand AND u.family_key = p_family_key AND u.family = 'Sierra'
          )
          AND s.model ILIKE '%sierra%'
        )
      )
  ),
  w AS (
    SELECT DISTINCT ON (
      s.sale_date,
      s.usd,
      s.source,
      COALESCE(s.year, 0),
      CASE
        WHEN s.source IN ('Bring a Trailer', 'Mecum', 'Bonhams')
          OR to_char(s.sale_date, 'MM-DD') <> '01-01'
        THEN ''
        ELSE s.vehicle_id::text
      END
    )
      s.vehicle_id, s.sale_date, s.usd, s.source, s.year, s.model
    FROM raw_w s
    ORDER BY
      s.sale_date DESC,
      s.usd DESC,
      s.source,
      COALESCE(s.year, 0),
      CASE
        WHEN s.source IN ('Bring a Trailer', 'Mecum', 'Bonhams')
          OR to_char(s.sale_date, 'MM-DD') <> '01-01'
        THEN ''
        ELSE s.vehicle_id::text
      END,
      length(COALESCE(s.model, '')) DESC,
      s.vehicle_id
  ),
  page AS (
    SELECT * FROM w ORDER BY sale_date DESC, vehicle_id LIMIT least(greatest(p_limit, 1), 12000)
  )
  SELECT jsonb_build_object(
    'n', (SELECT count(*) FROM w),
    'returned', (SELECT count(*) FROM page),
    'truncated', (SELECT count(*) FROM w) > (SELECT count(*) FROM page),
    'window_from', current_date - 1825,
    'rows', coalesce((
      SELECT jsonb_agg(jsonb_build_array(vehicle_id, sale_date, usd, source, year, model)
                       ORDER BY sale_date DESC, vehicle_id)
      FROM page
    ), '[]'::jsonb)
  );
$function$;

REVOKE ALL ON FUNCTION public.treemap_family_sales(text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.treemap_family_sales(text, text, integer) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.treemap_years(p_source text, p_make text, p_model text)
 RETURNS TABLE(name text, count bigint, value bigint, median_price bigint, sold_count bigint, auction_count bigint, avg_bids integer, avg_watchers integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH target_models AS (
    SELECT lower(p_model) AS model_l
    UNION
    SELECT fn.model_l
    FROM public.mv_model_family_names fn
    WHERE fn.make_l = lower(p_make)
      AND (
        lower(fn.family) = lower(p_model)
        OR fn.model_l LIKE lower(p_model) || ' %'
        OR (lower(p_make) = 'chevrolet' AND lower(p_model) = 'silverado' AND fn.model_l LIKE '%silverado%')
        OR (lower(p_make) = 'gmc' AND lower(p_model) = 'sierra' AND fn.model_l LIKE '%sierra%')
        OR (lower(p_make) = 'chevrolet' AND lower(p_model) = 'pickup' AND fn.family IN (
          'Pickup', '3100', '3600', '3800', 'Apache', 'Cameo',
          'C10', 'K10', 'C20', 'K20', 'C30', 'K30',
          'C1500', 'K1500', '454 SS', 'C2500', 'K2500', 'C3500', 'K3500', '3500',
          'S10', 'S-10 Pickup', 'Silverado'
        ))
        OR (lower(p_make) = 'gmc' AND lower(p_model) = 'pickup' AND fn.family IN (
          'Pickup', 'C1500', 'K1500', 'Sierra', 'Syclone',
          'Sonoma', 'S15 Pickup', 'Caballero', 'C2500', 'K2500', 'C3500', 'K3500'
        ))
        OR (lower(p_make) = 'ford' AND lower(p_model) = 'pickup' AND fn.family IN (
          'Pickup', 'F-1', 'F-100', 'F-150', 'F-250', 'F-350', 'F-450', 'Ranger'
        ))
      )
  )
  SELECT o.year::text AS name,
         count(*) FILTER (WHERE o.sold_amount > 0) AS count,
         (sum(o.sold_amount) FILTER (WHERE o.sold_amount > 0))::bigint AS value,
         CASE WHEN count(*) FILTER (WHERE o.sold_amount > 0) >= 5 THEN
           (percentile_cont(0.5) WITHIN GROUP (ORDER BY o.sold_amount::double precision) FILTER (WHERE o.sold_amount > 0))::bigint
         END AS median_price,
         count(*) FILTER (WHERE o.outcome = 'sold') AS sold_count,
         count(*) AS auction_count,
         round(avg(o.bat_bids) FILTER (WHERE o.sold_amount > 0 AND o.bat_bids > 0))::integer AS avg_bids,
         round(avg(o.bat_watchers) FILTER (WHERE o.sold_amount > 0 AND o.bat_watchers > 0))::integer AS avg_watchers
  FROM public.mv_treemap_outcomes o
  JOIN target_models tm ON lower(o.model) = tm.model_l
  WHERE lower(o.brand_name) = lower(p_make)
    AND o.year IS NOT NULL
    AND (p_source IS NULL OR o.source_name = p_source)
  GROUP BY o.year
  HAVING count(*) FILTER (WHERE o.sold_amount > 0) > 0
  ORDER BY value DESC, o.year DESC;
$function$;

REVOKE ALL ON FUNCTION public.treemap_years(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.treemap_years(text, text, text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.treemap_sales(p_make text, p_model text, p_year integer DEFAULT NULL::integer)
 RETURNS TABLE(id uuid, year integer, make text, model text, listing_title text, sold_amount bigint, sale_basis text, primary_image_url text, mileage integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH target_models AS (
    SELECT lower(p_model) AS model_l
    UNION
    SELECT fn.model_l
    FROM public.mv_model_family_names fn
    WHERE fn.make_l = lower(p_make)
      AND (
        lower(fn.family) = lower(p_model)
        OR fn.model_l LIKE lower(p_model) || ' %'
        OR (lower(p_make) = 'chevrolet' AND lower(p_model) = 'silverado' AND fn.model_l LIKE '%silverado%')
        OR (lower(p_make) = 'gmc' AND lower(p_model) = 'sierra' AND fn.model_l LIKE '%sierra%')
        OR (lower(p_make) = 'chevrolet' AND lower(p_model) = 'pickup' AND fn.family IN (
          'Pickup', '3100', '3600', '3800', 'Apache', 'Cameo',
          'C10', 'K10', 'C20', 'K20', 'C30', 'K30',
          'C1500', 'K1500', '454 SS', 'C2500', 'K2500', 'C3500', 'K3500', '3500',
          'S10', 'S-10 Pickup', 'Silverado'
        ))
        OR (lower(p_make) = 'gmc' AND lower(p_model) = 'pickup' AND fn.family IN (
          'Pickup', 'C1500', 'K1500', 'Sierra', 'Syclone',
          'Sonoma', 'S15 Pickup', 'Caballero', 'C2500', 'K2500', 'C3500', 'K3500'
        ))
        OR (lower(p_make) = 'ford' AND lower(p_model) = 'pickup' AND fn.family IN (
          'Pickup', 'F-1', 'F-100', 'F-150', 'F-250', 'F-350', 'F-450', 'Ranger'
        ))
      )
  ),
  deduped AS (
    SELECT DISTINCT ON (
      o.year,
      o.sold_amount::bigint,
      COALESCE(
        CASE WHEN v.sale_date IS NOT NULL AND to_char(v.sale_date, 'MM-DD') <> '01-01' THEN v.sale_date::text END,
        CASE WHEN v.mileage IS NOT NULL AND v.mileage > 0 THEN 'mi:' || v.mileage::text END,
        NULLIF(regexp_replace(lower(COALESCE(NULLIF(btrim(v.listing_url), ''), NULLIF(btrim(v.discovery_url), ''))), '^https?://(www\.)?|/+$|\?.*$', '', 'g'), ''),
        v.id::text
      )
    )
      v.id, v.year, v.make, v.model,
      COALESCE(v.listing_title, v.bat_listing_title) AS listing_title,
      o.sold_amount::bigint AS sold_amount,
      o.sale_basis, v.primary_image_url, v.mileage
    FROM public.mv_treemap_outcomes o
    JOIN target_models tm ON lower(o.model) = tm.model_l
    JOIN public.vehicles v ON v.id = o.id
    WHERE lower(o.brand_name) = lower(p_make)
      AND (p_year IS NULL OR o.year = p_year)
      AND o.sold_amount > 0
      AND v.is_public IS TRUE AND v.deleted_at IS NULL
    ORDER BY
      o.year,
      o.sold_amount::bigint DESC,
      COALESCE(
        CASE WHEN v.sale_date IS NOT NULL AND to_char(v.sale_date, 'MM-DD') <> '01-01' THEN v.sale_date::text END,
        CASE WHEN v.mileage IS NOT NULL AND v.mileage > 0 THEN 'mi:' || v.mileage::text END,
        NULLIF(regexp_replace(lower(COALESCE(NULLIF(btrim(v.listing_url), ''), NULLIF(btrim(v.discovery_url), ''))), '^https?://(www\.)?|/+$|\?.*$', '', 'g'), ''),
        v.id::text
      ),
      (COALESCE(v.listing_title, v.bat_listing_title) IS NOT NULL) DESC,
      (v.primary_image_url IS NOT NULL) DESC,
      (NULLIF(btrim(v.vin), '') IS NOT NULL) DESC,
      (NULLIF(btrim(v.listing_url), '') IS NOT NULL) DESC,
      length(COALESCE(v.model, '')) DESC,
      v.id
  )
  SELECT id, year, make, model, listing_title, sold_amount, sale_basis, primary_image_url, mileage
  FROM deduped
  ORDER BY sold_amount DESC, id
  LIMIT 200;
$function$;

REVOKE ALL ON FUNCTION public.treemap_sales(text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.treemap_sales(text, text, integer) TO anon, authenticated, service_role;
