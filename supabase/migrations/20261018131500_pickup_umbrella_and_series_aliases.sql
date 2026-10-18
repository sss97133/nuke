-- 1. Reclaim series-named custom pickup and Corvette split-window aliases from generic Chevrolet Pickup:
--    * Remove the overly broad 1-word alias 'window' from Chevrolet Pickup (which matched '327/340hp split window coupe',
--      a 1963 Corvette) and add 'split window' / 'split-window' / 'split window coupe' to Chevrolet Corvette.
--    * Add series-specific '... custom pickup', '... scottsdale', '... cheyenne', and '... 5-window' aliases to
--      Chevrolet series truck rows (3100, 3600, 3800, Apache, Cameo, C10, K10, C20, K20, C30, K30, C1500, K1500,
--      454 SS, Avalanche) so 3-word strings like '3100 Custom Pickup', 'Apache Custom Pickup', 'Cameo Custom Pickup',
--      'K20 Custom Pickup', 'K10 Cheyenne Super Custom Pickup', and 'Scottsdale K20' key to their series family while
--      generic 'Pickup' and 'Custom Pickup' continue to key to Chevrolet Pickup.
-- 2. Expand treemap_family_models(p_brand, p_family_key) and treemap_family_sales(p_brand, p_family_key, p_limit)
--    when (p_brand, p_family_key) is the brand's umbrella 'Pickup' family (Chevrolet, GMC, Ford) so drilling into
--    Pickup or filtering by truck generation era (Advance Design, Task Force, C/K, Squarebody, GMT400, etc.) includes
--    all pickup series families of that brand rather than only the residual generic 'Pickup' strings.

WITH remove_window AS (
  UPDATE public.canonical_models m
  SET aliases = array_remove(m.aliases, 'window')
  WHERE m.make = 'Chevrolet'
    AND m.canonical_model = 'Pickup'
    AND 'window' = ANY(COALESCE(m.aliases, '{}'::text[]))
  RETURNING m.id
),
patch(make, canonical_model, add_aliases) AS (
  VALUES
    ('Chevrolet', 'Corvette', ARRAY['split window', 'split-window', 'split window coupe']),
    ('Chevrolet', '3100', ARRAY['3100 custom pickup', '3100 5-window', '3100 5-window pickup', '3100 5-window custom pickup', '3100 3-window']),
    ('Chevrolet', '3600', ARRAY['3600 custom pickup', '3600 5-window']),
    ('Chevrolet', '3800', ARRAY['3800 custom pickup']),
    ('Chevrolet', 'Apache', ARRAY['apache custom pickup', 'apache 10', 'apache 20', 'apache 30', 'apache 31', 'apache 32']),
    ('Chevrolet', 'Cameo', ARRAY['cameo custom pickup', 'cameo carrier', '3124 cameo']),
    ('Chevrolet', 'C10', ARRAY['c10 custom pickup', 'c10 cheyenne', 'c10 scottsdale', 'c10 custom', 'c10 custom deluxe']),
    ('Chevrolet', 'K10', ARRAY['k10 custom pickup', 'k10 cheyenne', 'k10 cheyenne super custom pickup', 'k10 scottsdale', 'k10 scottsdale custom pickup', 'k10 custom']),
    ('Chevrolet', 'C20', ARRAY['c20 custom pickup', 'c20 cheyenne', 'c20 scottsdale', 'c20 custom', 'scottsdale c20']),
    ('Chevrolet', 'K20', ARRAY['k20 custom pickup', 'k20 cheyenne', 'k20 scottsdale', 'k20 custom', 'scottsdale k20']),
    ('Chevrolet', 'C30', ARRAY['c30 custom pickup', 'c30 dually camper special custom pickup', 'c30 scottsdale', 'c30 cheyenne']),
    ('Chevrolet', 'K30', ARRAY['k30 custom pickup', 'k30 scottsdale', 'k30 cheyenne']),
    ('Chevrolet', 'C1500', ARRAY['c1500 custom pickup', '1500 custom pickup']),
    ('Chevrolet', 'K1500', ARRAY['k1500 custom pickup']),
    ('Chevrolet', '454 SS', ARRAY['454ss custom pickup', '454 ss custom pickup']),
    ('Chevrolet', 'Avalanche', ARRAY['avalanche custom pickup'])
)
UPDATE public.canonical_models m
SET aliases = (
  SELECT array_agg(a ORDER BY ord)
  FROM (
    SELECT a, min(ord) AS ord
    FROM unnest(COALESCE(m.aliases, '{}'::text[]) || p.add_aliases) WITH ORDINALITY AS t(a, ord)
    GROUP BY a
  ) s
)
FROM patch p
WHERE m.make = p.make
  AND m.canonical_model = p.canonical_model
  AND NOT (COALESCE(m.aliases, '{}'::text[]) @> p.add_aliases);

SET enable_nestloop = off;
REFRESH MATERIALIZED VIEW public.mv_model_family_names;
RESET enable_nestloop;

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
          'C1500', 'K1500', '454 SS', 'C2500', 'K2500', '3500',
          'S10', 'S-10 Pickup'
        ))
        OR (p_brand = 'GMC' AND m.family IN (
          'Pickup', 'C1500', 'K1500', 'Sierra', 'Syclone',
          'Sonoma', 'S15 Pickup', 'Caballero', 'C2500', 'K2500', 'C3500', 'K3500'
        ))
        OR (p_brand = 'Ford' AND m.family IN (
          'Pickup', 'F-1', 'F-100', 'F-150', 'F-250', 'F-350', 'F-450', 'Ranger'
        ))
      )
  )
  SELECT nullif(m.model, ''), m.sold, m.sold_any, m.offered, m.usd, m.bat_dated,
         m.bat_sold_12m, m.bat_sold_prior_12m, m.bat_usd_12m, m.bat_usd_prior_12m, m.as_of
  FROM public.mv_family_market m
  JOIN target_keys tk ON tk.family_key = m.family_key
  WHERE m.brand = p_brand AND m.sold > 0
  ORDER BY m.usd DESC, m.model_key
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
          'C1500', 'K1500', '454 SS', 'C2500', 'K2500', '3500',
          'S10', 'S-10 Pickup'
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
  w AS (
    SELECT s.vehicle_id, s.sale_date, s.usd, s.source, s.year, s.model
    FROM public.mv_family_sales s
    JOIN target_keys tk ON tk.family_key = s.family_key
    WHERE s.brand = p_brand
      AND s.sale_date > current_date - 1826
      AND s.sale_date <= current_date
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
