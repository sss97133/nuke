-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_hero_public -f this-file.sql
-- Proves 20261125134500_hero_readers_public_test.sql: hero_deals, hero_heat (all three blocks) and
-- get_recent_squarebodies stop listing or counting a private, a deleted or a non-vehicle listing, keep the public ones,
-- and get_recent_squarebodies takes its photo only through the gallery rule. The functions start as production held
-- them on 2026-11-25 (pg_get_functiondef, embedded below), the leak is shown on them, the migration is applied twice,
-- and the same reads are repeated as anon. Security, settings and grants must not change. Rows are a disposable
-- database's rows, never testimony.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;
SET TimeZone = 'UTC';
DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = r) THEN EXECUTE format('CREATE ROLE %I NOLOGIN', r); END IF;
  END LOOP;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE TYPE public.vision_gate_status AS ENUM ('pending', 'approved', 'rejected_personal', 'rejected_misattributed', 'review_needed');
CREATE TYPE public.content_approval_status AS ENUM ('pending', 'approved', 'auto_approved', 'rejected');
CREATE TYPE public.content_redaction_level AS ENUM ('none', 'partial', 'full');
-- The columns the bodies read, with production's types.
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, year integer, make text, model text, is_public boolean DEFAULT true,
  deleted_at timestamptz, listing_kind text, deal_score numeric, heat_score numeric, is_for_sale boolean, sale_price integer,
  asking_price numeric, current_value numeric, nuke_estimate numeric, primary_image_url text, discovery_source text,
  discovery_url text, created_at timestamptz DEFAULT now());
CREATE TABLE public.auction_comments (id bigserial PRIMARY KEY, vehicle_id uuid REFERENCES public.vehicles(id), posted_at timestamptz);
CREATE TABLE public.vehicle_images (id uuid PRIMARY KEY, vehicle_id uuid REFERENCES public.vehicles(id), user_id uuid, image_url text,
  source text, is_document boolean, is_duplicate boolean, is_superseded boolean, is_sensitive boolean, image_vehicle_match_status text,
  vision_gate_status public.vision_gate_status, is_external boolean, is_approved boolean, approval_status public.content_approval_status,
  verification_status text, redaction_level public.content_redaction_level, is_primary boolean, created_at timestamptz DEFAULT now());
CREATE VIEW public.vehicle_images_public WITH (security_invoker = true) AS
  SELECT id, vehicle_id, user_id, image_url, source, is_document, is_duplicate, is_superseded, is_sensitive,
         image_vehicle_match_status, vision_gate_status, is_external, is_approved, approval_status, verification_status,
         redaction_level, is_primary, created_at
  FROM public.vehicle_images;
CREATE FUNCTION public.bat_pending_image_listing_by_id(p_image_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO '' AS $$ SELECT false $$;

-- Live helper bodies, 2026-11-25.
CREATE OR REPLACE FUNCTION public.is_squarebody(p_year integer, p_make text, p_model text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT
    p_year BETWEEN 1973 AND 1991
    AND LOWER(COALESCE(p_make, '')) IN ('chevrolet', 'chevy', 'gmc')
    AND (
      LOWER(COALESCE(p_model, '')) ~ '(c10|c20|c30|k10|k20|k30|c1500|c2500|c3500|k1500|k2500|k3500|blazer|jimmy|suburban|sierra|silverado|scottsdale|cheyenne|custom.deluxe|pickup|stepside|fleetside|shortbed|longbed|crew.cab|r1500|r2500|r3500|v1500|v2500|v3500|454.ss|syclone|typhoon|el.camino|caballero|high.sierra)'
      AND LOWER(COALESCE(p_model, '')) !~ '(corvette|camaro|monte.carlo|caprice|malibu|nova|impala|chevelle|laguna|vega|monza|citation|celebrity|cavalier|beretta|lumina|s-10|s10|s-15|s15|astro|safari)'
    );
$function$;

CREATE OR REPLACE FUNCTION public.vehicle_image_gallery_eligible(vehicle_images_public)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  SELECT
    coalesce(($1).is_document,false)=false
    AND coalesce(($1).is_duplicate,false)=false
    AND coalesce(($1).is_superseded,false)=false
    AND nullif(btrim(($1).image_url),'') IS NOT NULL
    AND ($1).image_url NOT LIKE 'file://%'
    AND (($1).source IS NULL OR ($1).source <> 'e2e_test')
    AND coalesce(($1).image_vehicle_match_status,'') NOT IN ('mismatch','unrelated')
    AND CASE
      WHEN ($1).vision_gate_status IS NULL OR ($1).vision_gate_status::text='approved' THEN true
      WHEN ($1).vision_gate_status::text='pending' THEN
        coalesce(($1).is_sensitive,false)=false
        AND (
          (
            coalesce(($1).source='bat_import',false)
            AND ($1).is_external IS TRUE
            AND ($1).is_approved IS TRUE
            AND coalesce(($1).approval_status::text IN ('approved','auto_approved'),false)
            AND coalesce(($1).verification_status='approved',false)
            AND coalesce(($1).redaction_level::text='none',false)
            AND ($1).image_url ~* '^https://(www\.)?bringatrailer\.com/wp-content/uploads/'
            AND public.bat_pending_image_listing_by_id(($1).id)
          )
          OR (
            -- listing capture: a photo taken from a public web listing by an extractor, never an upload
            coalesce(($1).source='bat_import',false)=false
            AND ($1).is_external IS TRUE
            AND ($1).user_id IS NULL
            AND ($1).is_approved IS TRUE
            AND coalesce(($1).approval_status::text,'') <> 'rejected'
            AND coalesce(($1).verification_status='approved',false)
            AND coalesce(($1).redaction_level::text='none',false)
            AND ($1).image_url ~* '^https://'
          )
        )
      ELSE false
    END;
$function$;


-- Live reader bodies, 2026-11-25, with their live grants (PUBLIC, anon, authenticated, service_role execute).
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
      FROM vehicle_images vi
      WHERE vi.vehicle_id = v.id
      ORDER BY vi.is_primary DESC NULLS LAST, vi.created_at ASC
      LIMIT 1
    ) AS image_url,
    v.created_at AS discovered_at,
    v.discovery_url AS listing_url
  FROM vehicles v
  WHERE is_squarebody(v.year, v.make, v.model)
  ORDER BY v.created_at DESC
  LIMIT limit_count;
$function$;


GRANT EXECUTE ON FUNCTION public.hero_deals(), public.hero_heat(), public.get_recent_squarebodies(integer) TO anon, authenticated, service_role;

CREATE FUNCTION public.t_assert(v boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF v IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF; RAISE NOTICE 'PASS: %', label; END $$;
-- Labels (the model column) of the vehicles a jsonb list names, sorted.
CREATE FUNCTION public.t_list(j jsonb) RETURNS text LANGUAGE sql AS
$$ SELECT coalesce(string_agg(e->>'model', ',' ORDER BY e->>'model'), '') FROM jsonb_array_elements(j) e $$;
CREATE FUNCTION public.t_state() RETURNS text LANGUAGE sql AS
$$ SELECT string_agg(p.oid::regprocedure::text || ':' || p.prosecdef::text || ':' || p.provolatile::text || ':'
     || coalesce(array_to_string(p.proconfig, ';'), '') || ':' || coalesce(p.proacl::text, ''), ' | ' ORDER BY p.oid::regprocedure::text)
   FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('hero_deals', 'hero_heat', 'get_recent_squarebodies') $$;
GRANT EXECUTE ON FUNCTION public.t_assert(boolean, text), public.t_list(jsonb) TO anon;

-- Four 1978 Chevrolet K10s, one per visibility state (label in model): pub_k10, priv_k10, del_k10, item_k10
-- (listing_kind non_vehicle_item). Each is for sale with a deal score, has a heat score and a comment this week.
INSERT INTO public.vehicles (id, year, make, model, is_public, deleted_at, listing_kind, deal_score, heat_score, is_for_sale,
  asking_price, nuke_estimate, created_at) VALUES
  ('a0000000-0000-0000-0000-000000000001', 1978, 'Chevrolet', 'pub_k10',  true,  NULL,         'vehicle',          60, 10, true, 2, 3, '2026-11-20'),
  ('a0000000-0000-0000-0000-000000000002', 1978, 'Chevrolet', 'priv_k10', false, NULL,         'vehicle',          70, 20, true, 2, 3, '2026-11-21'),
  ('a0000000-0000-0000-0000-000000000003', 1978, 'Chevrolet', 'del_k10',  true,  '2026-11-22', 'vehicle',          80, 30, true, 2, 3, '2026-11-22'),
  ('a0000000-0000-0000-0000-000000000004', 1978, 'Chevrolet', 'item_k10', true,  NULL,         'non_vehicle_item', 90, 40, true, 2, 3, '2026-11-23');
INSERT INTO public.auction_comments (vehicle_id, posted_at)
  SELECT id, now() - interval '1 day' FROM public.vehicles;
-- pub_k10's photos: a document scan (primary, oldest) that the gallery rule refuses, and a gallery photo.
INSERT INTO public.vehicle_images (id, vehicle_id, image_url, is_document, vision_gate_status, is_primary, created_at) VALUES
  ('10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'https://x.invalid/doc.jpg', true,  'approved', true,  '2026-11-01'),
  ('10000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'https://x.invalid/car.jpg', false, 'approved', false, '2026-11-02');

CREATE TEMP TABLE t_before AS SELECT public.t_state() AS state;
GRANT SELECT ON t_before TO anon;

-- Before: the defect, read as anon.
SET ROLE anon;
SELECT t_assert(t_list(hero_deals()->'top_deals') = 'del_k10,item_k10,priv_k10,pub_k10'
  AND (hero_deals()->>'total_deals')::int = 4, 'before: hero_deals lists and counts all four');
SELECT t_assert(t_list(hero_heat()->'top_hot') = 'del_k10,item_k10,priv_k10,pub_k10'
  AND t_list(hero_heat()->'comment_velocity') = 'del_k10,item_k10,priv_k10,pub_k10'
  AND (hero_heat()->'make_heat'->0->>'count')::int = 4, 'before: hero_heat lists all four in both lists and counts four');
SELECT t_assert((SELECT string_agg(model, ',' ORDER BY model) FROM get_recent_squarebodies(12)) = 'del_k10,item_k10,priv_k10,pub_k10',
  'before: get_recent_squarebodies lists all four');
SELECT t_assert((SELECT image_url FROM get_recent_squarebodies(12) WHERE model = 'pub_k10') = 'https://x.invalid/doc.jpg',
  'before: get_recent_squarebodies shows the document scan as the thumbnail');
RESET ROLE;

\ir ../migrations/20261125134500_hero_readers_public_test.sql
\ir ../migrations/20261125134500_hero_readers_public_test.sql
RESET statement_timeout; RESET lock_timeout;

SELECT t_assert((SELECT state FROM t_before) = public.t_state(), 'security definer, volatility, settings and grants unchanged on all three');

SET ROLE anon;
SELECT t_assert(t_list(hero_deals()->'top_deals') = 'pub_k10' AND jsonb_array_length(hero_deals()->'price_vs_estimate') = 1
  AND (hero_deals()->>'total_deals')::int = 1 AND (hero_deals()->'deal_by_make'->0->>'count')::int = 1,
  'after: hero_deals lists and counts only the public car');
SELECT t_assert(t_list(hero_heat()->'top_hot') = 'pub_k10' AND t_list(hero_heat()->'comment_velocity') = 'pub_k10'
  AND (hero_heat()->'make_heat'->0->>'count')::int = 1, 'after: hero_heat lists and counts only the public car in all three blocks');
SELECT t_assert((SELECT string_agg(model, ',' ORDER BY model) FROM get_recent_squarebodies(12)) = 'pub_k10',
  'after: get_recent_squarebodies lists only the public car');
SELECT t_assert((SELECT image_url FROM get_recent_squarebodies(12)) = 'https://x.invalid/car.jpg',
  'after: get_recent_squarebodies takes the gallery photo, not the document scan');
RESET ROLE;
SELECT t_assert((SELECT count(*) FROM public.vehicles) = 4 AND (SELECT count(*) FROM public.vehicle_images) = 2, 'no row changed');
