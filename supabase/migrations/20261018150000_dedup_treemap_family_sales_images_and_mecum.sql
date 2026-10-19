-- Migration: Deduplicate Barrett-Jackson Jan-1 placeholder duplicates,
-- adjacent-day VINless Mecum duplicates, and non-Barrett-Jackson listings
-- polluted by Barrett-Jackson sale observations in treemap_family_sales.
--
-- 1. Barrett-Jackson rows that were ingested twice (once with a 'YYYY-01-01'
--    placeholder sale_date and once with the actual event date) share the
--    exact same primary_image_url, usd, source, and year, and collapse to
--    the real-date / VIN-bearing / photo-bearing row.
-- 2. Non-Barrett-Jackson listings (conceptcarz://, Craigslist, Hemmings,
--    Classic.com, Streetside, etc.) that received a Barrett-Jackson sale
--    observation and a pre-2021 Barrett-Jackson docket discovery_url are
--    excluded from the 5-year Barrett-Jackson treemap window so they cannot
--    impersonate recent Barrett-Jackson sales.
-- 3. Same-day duplicate rows at the same (sale_date, usd, source, year) order
--    VIN-bearing and photo-bearing rows first so the canonical record wins.
-- 4. Adjacent-day (<= 3 days) Mecum duplicates where one row has no VIN and
--    no photo at the exact same (usd, year) are dropped in favor of the
--    populated sibling.

CREATE OR REPLACE FUNCTION public.treemap_family_sales(
  p_brand text,
  p_family_key text,
  p_limit integer DEFAULT 12000
)
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
  step1 AS (
    SELECT DISTINCT ON (
      s.usd,
      s.source,
      COALESCE(s.year, 0),
      CASE
        WHEN s.source = 'Barrett-Jackson'
          AND v.primary_image_url IS NOT NULL
          AND btrim(v.primary_image_url) <> ''
        THEN 'bj-img:' || lower(regexp_replace(btrim(v.primary_image_url), '\?.*$', ''))
        WHEN s.source IN ('Bring a Trailer', 'Mecum', 'Bonhams')
          OR to_char(s.sale_date, 'MM-DD') <> '01-01'
        THEN 'dt:' || s.sale_date::text
        ELSE 'id:' || s.vehicle_id::text
      END
    )
      s.vehicle_id,
      s.sale_date,
      s.usd,
      s.source,
      s.year,
      s.model,
      v.vin,
      v.primary_image_url
    FROM raw_w s
    LEFT JOIN public.vehicles v ON v.id = s.vehicle_id
    WHERE NOT (
      s.source = 'Barrett-Jackson'
      AND (
        (
          v.listing_url IS NOT NULL
          AND v.listing_url NOT ILIKE '%barrett-jackson%'
        )
        OR (
          coalesce(v.discovery_url, v.listing_url, '') ~ '((?:19\d\d|20[01]\d)|(?:19\d\d|2020)-[^/]+)/docket/'
          AND coalesce(v.listing_url, '') !~ '202[1-9]'
        )
      )
    )
    ORDER BY
      s.usd DESC,
      s.source,
      COALESCE(s.year, 0),
      CASE
        WHEN s.source = 'Barrett-Jackson'
          AND v.primary_image_url IS NOT NULL
          AND btrim(v.primary_image_url) <> ''
        THEN 'bj-img:' || lower(regexp_replace(btrim(v.primary_image_url), '\?.*$', ''))
        WHEN s.source IN ('Bring a Trailer', 'Mecum', 'Bonhams')
          OR to_char(s.sale_date, 'MM-DD') <> '01-01'
        THEN 'dt:' || s.sale_date::text
        ELSE 'id:' || s.vehicle_id::text
      END,
      (to_char(s.sale_date, 'MM-DD') <> '01-01') DESC,
      (v.primary_image_url IS NOT NULL AND btrim(v.primary_image_url) <> '') DESC,
      (v.vin IS NOT NULL AND btrim(v.vin) <> '') DESC,
      s.sale_date DESC,
      length(COALESCE(s.model, '')) DESC,
      s.vehicle_id
  ),
  w AS (
    SELECT a.vehicle_id, a.sale_date, a.usd, a.source, a.year, a.model
    FROM step1 a
    WHERE NOT (
      a.source = 'Mecum'
      AND (a.vin IS NULL OR btrim(a.vin) = '')
      AND (a.primary_image_url IS NULL OR btrim(a.primary_image_url) = '')
      AND EXISTS (
        SELECT 1
        FROM step1 b
        WHERE b.vehicle_id <> a.vehicle_id
          AND b.source = a.source
          AND b.usd = a.usd
          AND COALESCE(b.year, 0) = COALESCE(a.year, 0)
          AND abs(b.sale_date - a.sale_date) <= 3
          AND (
            (b.vin IS NOT NULL AND btrim(b.vin) <> '')
            OR (b.primary_image_url IS NOT NULL AND btrim(b.primary_image_url) <> '')
            OR b.sale_date > a.sale_date
            OR (b.sale_date = a.sale_date AND b.vehicle_id < a.vehicle_id)
          )
      )
    )
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
