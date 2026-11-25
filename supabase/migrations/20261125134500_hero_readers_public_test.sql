-- hero_readers_public_test_v1: hero_deals, hero_heat and get_recent_squarebodies state the whole visibility test.
--
-- WHY. All three are SECURITY DEFINER readers anon executes (the feed's hero panels, the market stats squarebody list).
-- None stated any visibility test on vehicles, so a private, deleted or non-vehicle listing could be listed with its
-- id, image and price, and counted in the per-make aggregates. get_recent_squarebodies also took a car's first photo
-- from vehicle_images with no gallery rule, so a document scan or a gate-rejected photo could be its thumbnail.
-- Live 2026-11-25 as anon: hero_deals and hero_heat answer 500 after 10.1-10.3 s (statement timeout, a separate
-- defect); get_recent_squarebodies answers 200 in 0.5 s with 0 of 50 leaked, by luck of the newest rows.
--
-- WHAT CHANGES. Every read of vehicles in the three bodies gains
--   AND v.is_public = true AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
-- (hero_heat: the hot list, the comment-velocity list and the make aggregate). get_recent_squarebodies takes its photo
-- from vehicle_images_public through vehicle_image_gallery_eligible, the shared gallery rule. Nothing else changes:
-- the bodies are production's (pg_get_functiondef, 2026-11-25) with those lines added. CREATE OR REPLACE keeps
-- security, settings and grants.
-- Contract: supabase/sql/test_hero_readers_public_test.sql.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.hero_deals()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET statement_timeout TO '10s'
AS $function$
  WITH deal_vehicles AS (
    SELECT
      v.id,
      v.year,
      COALESCE(v.make, 'Unknown') AS make,
      v.model,
      v.deal_score,
      COALESCE(
        NULLIF(v.sale_price, 0)::numeric,
        NULLIF(v.asking_price, 0::numeric),
        NULLIF(v.current_value, 0::numeric)
      ) AS price,
      v.nuke_estimate,
      v.primary_image_url AS thumbnail,
      v.is_for_sale
    FROM vehicles v
    WHERE v.deal_score IS NOT NULL
      AND v.deal_score > 0
      AND v.is_for_sale = true
      AND v.is_public = true AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
  ),
  top_deals AS (
    SELECT id, year, make, model, deal_score, price, nuke_estimate, thumbnail
    FROM deal_vehicles
    ORDER BY deal_score DESC
    LIMIT 30
  ),
  deal_by_make AS (
    SELECT make, count(*) AS cnt, max(deal_score) AS best_score
    FROM deal_vehicles
    WHERE deal_score > 50
    GROUP BY make
    ORDER BY cnt DESC
    LIMIT 20
  ),
  price_vs_estimate AS (
    SELECT
      id, price, nuke_estimate,
      ROUND(((nuke_estimate - price) / NULLIF(nuke_estimate, 0)) * 100) AS discount_pct
    FROM deal_vehicles
    WHERE price IS NOT NULL AND price > 0
      AND nuke_estimate IS NOT NULL AND nuke_estimate > 0
    ORDER BY deal_score DESC
    LIMIT 50
  )
  SELECT jsonb_build_object(
    'total_deals', (SELECT count(*) FROM deal_vehicles WHERE deal_score > 50),
    'top_deals', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', id, 'year', year, 'make', make, 'model', model,
      'deal_score', deal_score, 'price', price, 'nuke_estimate', nuke_estimate,
      'thumbnail', thumbnail
    )), '[]'::jsonb) FROM top_deals),
    'deal_by_make', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'make', make, 'count', cnt, 'best_score', best_score
    )), '[]'::jsonb) FROM deal_by_make),
    'price_vs_estimate', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', id, 'price', price, 'estimate', nuke_estimate, 'discount_pct', discount_pct
    )), '[]'::jsonb) FROM price_vs_estimate)
  );
$function$;

CREATE OR REPLACE FUNCTION public.hero_heat()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET statement_timeout TO '10s'
AS $function$
  WITH hot_vehicles AS (
    SELECT
      v.id,
      v.year,
      COALESCE(v.make, 'Unknown') AS make,
      v.model,
      v.heat_score,
      v.primary_image_url AS thumbnail,
      COALESCE(
        NULLIF(v.sale_price, 0)::numeric,
        NULLIF(v.asking_price, 0::numeric),
        NULLIF(v.current_value, 0::numeric)
      ) AS price
    FROM vehicles v
    WHERE v.heat_score IS NOT NULL AND v.heat_score > 0
      AND v.is_public = true AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
    ORDER BY v.heat_score DESC
    LIMIT 30
  ),
  comment_velocity AS (
    SELECT
      ac.vehicle_id AS id,
      count(*) AS comment_count_7d,
      v.year,
      COALESCE(v.make, 'Unknown') AS make,
      v.model,
      v.primary_image_url AS thumbnail
    FROM auction_comments ac
    JOIN vehicles v ON v.id = ac.vehicle_id
    WHERE ac.posted_at > now() - interval '7 days'
      AND v.is_public = true AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
    GROUP BY ac.vehicle_id, v.year, v.make, v.model, v.primary_image_url
    ORDER BY count(*) DESC
    LIMIT 20
  ),
  make_heat AS (
    SELECT
      COALESCE(v.make, 'Unknown') AS make,
      SUM(v.heat_score) AS total_heat,
      count(*) AS cnt
    FROM vehicles v
    WHERE v.heat_score IS NOT NULL AND v.heat_score > 0
      AND v.is_public = true AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
    GROUP BY v.make
    ORDER BY total_heat DESC
    LIMIT 20
  )
  SELECT jsonb_build_object(
    'top_hot', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', id, 'year', year, 'make', make, 'model', model,
      'heat_score', heat_score, 'thumbnail', thumbnail, 'price', price
    )), '[]'::jsonb) FROM hot_vehicles),
    'comment_velocity', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', id, 'year', year, 'make', make, 'model', model,
      'comment_count_7d', comment_count_7d, 'thumbnail', thumbnail
    )), '[]'::jsonb) FROM comment_velocity),
    'make_heat', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'make', make, 'total_heat', total_heat, 'count', cnt
    )), '[]'::jsonb) FROM make_heat)
  );
$function$;

CREATE OR REPLACE FUNCTION public.get_recent_squarebodies(limit_count integer DEFAULT 12)
 RETURNS TABLE(id uuid, year integer, make text, model text, asking_price numeric, location text, image_url text, discovered_at timestamp with time zone, listing_url text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT
    v.id,
    v.year,
    v.make,
    v.model,
    COALESCE(v.sale_price, v.asking_price) as asking_price,
    COALESCE(v.discovery_source, 'unknown') AS location,
    (
      SELECT vi.image_url
      FROM public.vehicle_images_public vi
      WHERE vi.vehicle_id = v.id AND public.vehicle_image_gallery_eligible(vi)
      ORDER BY vi.is_primary DESC NULLS LAST, vi.created_at ASC
      LIMIT 1
    ) AS image_url,
    v.created_at AS discovered_at,
    v.discovery_url AS listing_url
  FROM vehicles v
  WHERE is_squarebody(v.year, v.make, v.model)
    AND v.is_public = true AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
  ORDER BY v.created_at DESC
  LIMIT limit_count;
$function$;
