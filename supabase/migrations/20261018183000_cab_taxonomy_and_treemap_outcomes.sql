-- Cars & Bids Multi-Axis Taxonomy (`series`, `trim`, `body_style`), Outcome & Sale Date Normalization,
-- and `treemap_family_sales` Series Facet Enrichment (2026-10-18)
--
-- Root causes addressed:
--   1. Over 13,500 sold Cars & Bids vehicles (`discovery_source = 'carsandbids'`) had `sale_price > 0`
--      or `auction_status = 'sold'` in `public.vehicles`, or a sold price in `vehicle_events` / `auction_events`,
--      but had `sale_status = 'available'`, `auction_outcome = NULL`, or `is_public = false`, leaving ~6,411
--      confirmed Cars & Bids sold lots out of `public.mv_treemap_outcomes`.
--   2. Over 15,000 sold Cars & Bids vehicles had `auction_end_date` / `vehicle_events.ended_at` /
--      `auction_events.auction_end_date` populated without `vehicles.sale_date`, excluding them from
--      `public.mv_family_sales` and `public.mv_family_market`.
--   3. Cars & Bids vehicles lacked structured `series` (96.7% NULL) and `trim` (79.1% NULL) facets, had
--      trailing `"Watch"` UI artifacts in `title` / `listing_title`, and used coarse C&B API model names
--      (`"Super Duty"`, `"2 Series"`, `"3 Series"`, `"4 Series"`, `"02 Series"`, `"GLK- Class"`).
--   4. `public.treemap_family_sales` enriched element [5] (`model`) with `v.trim`, `v.body_style`, and
--      `COALESCE(v.listing_title, v.title)`, but omitted `v.series` (e.g. `992`, `991`, `E46 M3`, `J80`, `C8`).

BEGIN;
SET LOCAL statement_timeout = '10min';
SET LOCAL lock_timeout = '15s';

-- 1. Canonical model aliases for Cars & Bids coarse model names so C&B sales key cleanly to canonical families
DO $cab_aliases$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('Ford',          'F-250',      ARRAY['super duty', 'f-250 super duty']),
      ('Ford',          'F-350',      ARRAY['f-350 super duty']),
      ('Ford',          'F-450',      ARRAY['f-450 super duty']),
      ('BMW',           '2002',       ARRAY['02 series', '2002tii', '2002 turbo', '1600-2', '1602']),
      ('BMW',           '328i',       ARRAY['3 series']),
      ('BMW',           '228i',       ARRAY['2 series']),
      ('BMW',           '435i',       ARRAY['4 series']),
      ('Mercedes-Benz', 'GLK-Class',  ARRAY['glk- class', 'glk class'])
    ) AS v(make_name, model_name, new_aliases)
  LOOP
    UPDATE public.canonical_models m
    SET aliases = (
      SELECT array_agg(a ORDER BY ord)
      FROM (
        SELECT a, min(ord) AS ord
        FROM unnest(coalesce(m.aliases, '{}'::text[]) || r.new_aliases) WITH ORDINALITY AS t(a, ord)
        GROUP BY a
      ) s
    )
    WHERE lower(m.make) = lower(r.make_name)
      AND lower(m.canonical_model) = lower(r.model_name)
      AND NOT (coalesce(m.aliases, '{}'::text[]) @> r.new_aliases);
  END LOOP;
END $cab_aliases$;

-- 2. Backfill missing `sale_price` on Cars & Bids sold rows where `vehicle_events` or `auction_events` holds the winning bid
WITH event_prices AS (
  SELECT
    v.id AS vehicle_id,
    COALESCE(
      (
        SELECT GREATEST(COALESCE(ve.final_price, 0), COALESCE(ve.current_price, 0))
        FROM public.vehicle_events ve
        WHERE ve.vehicle_id = v.id
          AND COALESCE(ve.final_price, ve.current_price, 0) > 0
        ORDER BY ve.ended_at DESC NULLS LAST, ve.created_at DESC NULLS LAST
        LIMIT 1
      ),
      (
        SELECT ae.winning_bid
        FROM public.auction_events ae
        WHERE ae.vehicle_id = v.id
          AND ae.winning_bid > 0
        ORDER BY ae.auction_end_date DESC NULLS LAST, ae.created_at DESC NULLS LAST
        LIMIT 1
      )
    ) AS event_price
  FROM public.vehicles v
  WHERE v.discovery_source = 'carsandbids'
    AND v.deleted_at IS NULL
    AND v.status IS DISTINCT FROM 'merged'
    AND (v.sale_price IS NULL OR v.sale_price = 0)
    AND v.auction_status = 'sold'
)
UPDATE public.vehicles v
SET sale_price = ep.event_price,
    sold_price = COALESCE(v.sold_price, ep.event_price),
    winning_bid = COALESCE(v.winning_bid, ep.event_price)
FROM event_prices ep
WHERE v.id = ep.vehicle_id
  AND ep.event_price > 0;

-- 3. Normalize `title`, `listing_title`, `is_public`, `auction_source`, `canonical_platform`, `platform_source`,
--    `sale_status`, and `auction_outcome` across all active unmerged Cars & Bids vehicles
UPDATE public.vehicles v
SET
  title = regexp_replace(btrim(v.title), '\s+Watch$', '', 'i'),
  listing_title = COALESCE(
    NULLIF(regexp_replace(btrim(v.listing_title), '\s+Watch$', '', 'i'), ''),
    regexp_replace(btrim(v.title), '\s+Watch$', '', 'i')
  ),
  is_public = true,
  auction_source = CASE
    WHEN v.listing_url ILIKE '%carsandbids.com%' OR v.discovery_url ILIKE '%carsandbids.com%' OR v.auction_source IS NULL
    THEN 'cars_and_bids'
    ELSE v.auction_source
  END,
  canonical_platform = CASE
    WHEN v.listing_url ILIKE '%carsandbids.com%' OR v.discovery_url ILIKE '%carsandbids.com%' OR v.canonical_platform IS NULL
    THEN 'cars-and-bids'
    ELSE v.canonical_platform
  END,
  platform_source = CASE
    WHEN v.platform_source IS NULL OR v.platform_source ILIKE 'http%' OR v.platform_source = 'carsandbids'
    THEN 'cars-and-bids'
    ELSE v.platform_source
  END,
  sale_status = CASE
    WHEN (v.sale_price > 0 AND COALESCE(v.auction_outcome, '') NOT IN ('reserve_not_met', 'no_sale', 'unsold', 'cancelled', 'withdrawn'))
      OR v.auction_status = 'sold'
    THEN 'sold'
    WHEN (v.sale_price IS NULL OR v.sale_price = 0)
      AND v.auction_status = 'ended'
      AND COALESCE(v.sale_status, 'available') = 'available'
    THEN 'not_sold'
    ELSE v.sale_status
  END,
  auction_outcome = CASE
    WHEN (v.sale_price > 0 AND COALESCE(v.auction_outcome, '') NOT IN ('reserve_not_met', 'no_sale', 'unsold', 'cancelled', 'withdrawn'))
      OR v.auction_status = 'sold'
    THEN 'sold'
    WHEN (v.sale_price IS NULL OR v.sale_price = 0)
      AND v.auction_status = 'ended'
      AND v.auction_outcome IS NULL
    THEN 'reserve_not_met'
    ELSE v.auction_outcome
  END,
  sold_price = CASE
    WHEN (v.sale_price > 0 AND COALESCE(v.auction_outcome, '') NOT IN ('reserve_not_met', 'no_sale', 'unsold', 'cancelled', 'withdrawn'))
    THEN COALESCE(v.sold_price, v.sale_price)
    ELSE v.sold_price
  END,
  winning_bid = CASE
    WHEN (v.sale_price > 0 AND COALESCE(v.auction_outcome, '') NOT IN ('reserve_not_met', 'no_sale', 'unsold', 'cancelled', 'withdrawn'))
    THEN COALESCE(v.winning_bid, v.sale_price)
    ELSE v.winning_bid
  END
WHERE v.discovery_source = 'carsandbids'
  AND v.deleted_at IS NULL
  AND v.status IS DISTINCT FROM 'merged'
  AND (
    v.title ~* '\s+Watch$'
    OR v.listing_title IS NULL
    OR v.listing_title ~* '\s+Watch$'
    OR v.is_public IS DISTINCT FROM true
    OR v.auction_source IS DISTINCT FROM 'cars_and_bids'
    OR v.canonical_platform IS DISTINCT FROM 'cars-and-bids'
    OR v.platform_source IS DISTINCT FROM 'cars-and-bids'
    OR (
      ((v.sale_price > 0 AND COALESCE(v.auction_outcome, '') NOT IN ('reserve_not_met', 'no_sale', 'unsold', 'cancelled', 'withdrawn')) OR v.auction_status = 'sold')
      AND (v.sale_status IS DISTINCT FROM 'sold' OR v.auction_outcome IS DISTINCT FROM 'sold')
    )
    OR (
      (v.sale_price IS NULL OR v.sale_price = 0)
      AND v.auction_status = 'ended'
      AND (COALESCE(v.sale_status, 'available') = 'available' OR v.auction_outcome IS NULL)
    )
  );

-- 4. Backfill `sale_date` on Cars & Bids sold vehicles from `auction_end_date`, `vehicle_events`, or `auction_events`
WITH cab_dates AS (
  SELECT
    v.id AS vehicle_id,
    COALESCE(
      v.auction_end_date::date,
      (
        SELECT COALESCE(ve.sold_at::date, ve.ended_at::date)
        FROM public.vehicle_events ve
        WHERE ve.vehicle_id = v.id
          AND COALESCE(ve.sold_at, ve.ended_at) IS NOT NULL
        ORDER BY COALESCE(ve.sold_at, ve.ended_at) DESC
        LIMIT 1
      ),
      (
        SELECT ae.auction_end_date::date
        FROM public.auction_events ae
        WHERE ae.vehicle_id = v.id
          AND ae.auction_end_date IS NOT NULL
        ORDER BY ae.auction_end_date DESC
        LIMIT 1
      )
    ) AS derived_sale_date
  FROM public.vehicles v
  WHERE v.discovery_source = 'carsandbids'
    AND v.deleted_at IS NULL
    AND v.status IS DISTINCT FROM 'merged'
    AND v.sale_date IS NULL
    AND (v.sale_status = 'sold' OR v.auction_outcome = 'sold' OR v.sale_price > 0)
)
UPDATE public.vehicles v
SET sale_date = cd.derived_sale_date
FROM cab_dates cd
WHERE v.id = cd.vehicle_id
  AND cd.derived_sale_date IS NOT NULL
  AND cd.derived_sale_date >= DATE '2020-01-01'
  AND cd.derived_sale_date <= CURRENT_DATE + 1;

-- 5. Backfill `canonical_make_id` on Cars & Bids vehicles where missing
UPDATE public.vehicles v
SET canonical_make_id = cm.id
FROM public.canonical_makes cm
WHERE v.discovery_source = 'carsandbids'
  AND v.deleted_at IS NULL
  AND v.status IS DISTINCT FROM 'merged'
  AND v.canonical_make_id IS NULL
  AND v.make IS NOT NULL
  AND (
    lower(btrim(v.make)) = lower(cm.canonical_name)
    OR lower(btrim(v.make)) = ANY(SELECT lower(x) FROM unnest(coalesce(cm.aliases, '{}'::text[])) AS x)
  );

-- 6. Update `public.treemap_family_sales` to include `v.series` alongside `v.trim`, `v.body_style`, and `listing_title`
--    in element [5] (`model`) so the multi-axis taxonomy classifier (`SERIES` | `TRIM` | `BODY STYLE`) receives
--    the structured series/generation facet directly.
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
  w AS (
    SELECT *
    FROM deduped
    ORDER BY usd DESC, sale_date DESC
    LIMIT LEAST(GREATEST(p_limit, 100), 15000)
  )
  SELECT COALESCE(
    jsonb_agg(jsonb_build_array(vehicle_id, sale_date, usd, source, year, model) ORDER BY usd DESC, sale_date DESC),
    '[]'::jsonb
  )
  FROM w;
$function$;

COMMIT;
