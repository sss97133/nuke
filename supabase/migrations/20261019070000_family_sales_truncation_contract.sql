-- treemap_family_sales: restore the reader's one-value contract {n, returned, truncated, window_from, rows}.
-- 20261018163000 returned that object, newest sales first, so a capped read said how many it held back.
-- 20261018183000 (Cars & Bids taxonomy) kept its own dedup but returned the rows alone, ordered by price and capped at
-- 15,000: an over-cap family silently lost its cheapest sales, the web chart read the bare array as complete
-- (parseFamilySales: truncated false), and the iOS ledger (FamilySalesData.parse needs n and rows) read nothing.
-- This keeps every step of the 20261018183000 body (live md5 d9e09ac4 matched it 2026-10-18 06:55Z) and changes only
-- the final page: newest first, at most min(p_limit, 15000) rows, with the window count and truncation stated.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '5s';

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
      -- Enrich model string with series / trim / body_style / listing_title when raw model lacks those tokens
      btrim(
        COALESCE(NULLIF(btrim(s.model), ''), NULLIF(btrim(v.model), ''), '')
        || CASE
             WHEN v.series IS NOT NULL AND btrim(v.series) <> ''
                  AND position(lower(btrim(v.series)) in lower(COALESCE(s.model, ''))) = 0
             THEN ' ' || btrim(v.series)
             ELSE ''
           END
        || CASE
             WHEN v.trim IS NOT NULL AND btrim(v.trim) <> ''
                  AND position(lower(btrim(v.trim)) in lower(COALESCE(s.model, '') || ' ' || COALESCE(v.series, ''))) = 0
             THEN ' ' || btrim(v.trim)
             ELSE ''
           END
        || CASE
             WHEN v.body_style IS NOT NULL AND btrim(v.body_style) <> ''
                  AND lower(btrim(v.body_style)) NOT IN ('truck', 'pickup', 'car', 'cars', 'other', 'subcompact cars', 'compact cars')
                  AND position(lower(btrim(v.body_style)) in lower(COALESCE(s.model, '') || ' ' || COALESCE(v.series, '') || ' ' || COALESCE(v.trim, ''))) = 0
             THEN ' ' || btrim(v.body_style)
             ELSE ''
           END
        || CASE
             WHEN COALESCE(v.listing_title, v.title) IS NOT NULL
                  AND length(COALESCE(s.model, '')) <= 18
             THEN ' · ' || btrim(COALESCE(v.listing_title, v.title))
             ELSE ''
           END
      ) AS model,
      v.vin,
      v.primary_image_url
    FROM raw_w s
    LEFT JOIN public.vehicles v ON v.id = s.vehicle_id
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
      (v.primary_image_url IS NOT NULL AND btrim(v.primary_image_url) <> '') DESC,
      (v.vin IS NOT NULL AND length(btrim(v.vin)) >= 5) DESC,
      s.sale_date DESC,
      s.vehicle_id
  ),
  deduped AS (
    SELECT DISTINCT ON (
      s.source,
      s.sale_date,
      s.usd,
      COALESCE(s.year, 0),
      CASE
        WHEN s.vin IS NOT NULL AND length(btrim(s.vin)) >= 5
        THEN 'vin:' || upper(btrim(s.vin))
        WHEN s.primary_image_url IS NOT NULL
          AND btrim(s.primary_image_url) <> ''
          AND s.primary_image_url !~* '(placeholder|default|no[-_]?image|blank)'
        THEN 'img:' || lower(regexp_replace(btrim(s.primary_image_url), '\?.*$', ''))
        ELSE 'id:' || s.vehicle_id::text
      END
    )
      s.vehicle_id,
      s.sale_date,
      s.usd,
      s.source,
      s.year,
      s.model
    FROM step1 s
    ORDER BY
      s.source,
      s.sale_date,
      s.usd,
      COALESCE(s.year, 0),
      CASE
        WHEN s.vin IS NOT NULL AND length(btrim(s.vin)) >= 5
        THEN 'vin:' || upper(btrim(s.vin))
        WHEN s.primary_image_url IS NOT NULL
          AND btrim(s.primary_image_url) <> ''
          AND s.primary_image_url !~* '(placeholder|default|no[-_]?image|blank)'
        THEN 'img:' || lower(regexp_replace(btrim(s.primary_image_url), '\?.*$', ''))
        ELSE 'id:' || s.vehicle_id::text
      END,
      (s.primary_image_url IS NOT NULL AND btrim(s.primary_image_url) <> '') DESC,
      s.vehicle_id
  ),
  page AS (
    SELECT *
    FROM deduped
    ORDER BY sale_date DESC, vehicle_id
    LIMIT LEAST(GREATEST(p_limit, 1), 15000)
  )
  SELECT jsonb_build_object(
    'n', (SELECT count(*) FROM deduped),
    'returned', (SELECT count(*) FROM page),
    'truncated', (SELECT count(*) FROM deduped) > (SELECT count(*) FROM page),
    'window_from', current_date - 1825,
    'rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_array(vehicle_id, sale_date, usd, source, year, model) ORDER BY sale_date DESC, vehicle_id)
      FROM page
    ), '[]'::jsonb)
  );
$function$;

GRANT EXECUTE ON FUNCTION public.treemap_family_sales(text, text, integer) TO anon, authenticated, service_role;

COMMIT;
