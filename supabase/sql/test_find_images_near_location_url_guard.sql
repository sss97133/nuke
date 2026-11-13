-- Disposable PG17 only (PostGIS stood in). Proves 20261116054000_find_images_near_location_url_guard.sql: the reader
-- stops returning photos without an image (blank, whitespace-only or NULL image_url) and changes nothing else: same
-- rows otherwise, same order and distances, same signature, security invoker, grants kept; applies twice.
--   createdb dm_refinement_near_loc && psql -X -v ON_ERROR_STOP=1 -d dm_refinement_near_loc -f supabase/sql/test_find_images_near_location_url_guard.sql
\set ON_ERROR_STOP on
DO $$ BEGIN
 IF current_database() NOT LIKE 'dm_refinement_%' OR to_regclass('public.vehicle_images') IS NOT NULL
 THEN RAISE EXCEPTION 'Requires empty disposable dm_refinement_* database'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
SET statement_timeout = '30s';

-- PostGIS stand-ins with the same call shapes: a point type, great-circle distance in metres, and DWithin on it.
CREATE TYPE public.geography AS (lng float8, lat float8);
CREATE FUNCTION public.st_makepoint(float8, float8) RETURNS public.geography LANGUAGE sql IMMUTABLE AS $$ SELECT ROW($1, $2)::public.geography $$;
CREATE FUNCTION public.st_distance(a public.geography, b public.geography) RETURNS float8 LANGUAGE sql IMMUTABLE AS $$
  SELECT 2 * 6371008.8 * asin(sqrt(power(sin(radians(b.lat - a.lat) / 2), 2)
         + cos(radians(a.lat)) * cos(radians(b.lat)) * power(sin(radians(b.lng - a.lng) / 2), 2))) $$;
CREATE FUNCTION public.st_dwithin(a public.geography, b public.geography, d float8) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT public.st_distance(a, b) <= d $$;

CREATE TABLE public.vehicle_images (id uuid PRIMARY KEY, vehicle_id uuid, image_url text, latitude numeric, longitude numeric);
INSERT INTO public.vehicle_images VALUES
 ('00000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','https://x.invalid/a.jpg',35.97236333,-114.85599500),
 ('00000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','https://x.invalid/b.jpg',35.97250000,-114.85590000),
 ('00000000-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','',35.97236333,-114.85599500),
 ('00000000-0000-0000-0000-000000000004','11111111-1111-1111-1111-111111111111','   ',35.97240000,-114.85600000),
 ('00000000-0000-0000-0000-000000000005','11111111-1111-1111-1111-111111111111',NULL,35.97240000,-114.85600000),
 ('00000000-0000-0000-0000-000000000006','11111111-1111-1111-1111-111111111111','https://x.invalid/far.jpg',36.2,-115.1),
 ('00000000-0000-0000-0000-000000000007','22222222-2222-2222-2222-222222222222','https://x.invalid/other.jpg',35.97236333,-114.85599500),
 ('00000000-0000-0000-0000-000000000008','11111111-1111-1111-1111-111111111111','https://x.invalid/nopoint.jpg',NULL,NULL);

-- The live definition (production md5 a2d4a709b7d21baf6a0054571fdcad55 on 2026-11-13) and its grants.
CREATE OR REPLACE FUNCTION public.find_images_near_location(p_latitude numeric, p_longitude numeric, p_vehicle_id uuid, p_max_distance_meters integer DEFAULT 50)
 RETURNS TABLE(image_id uuid, distance_meters numeric)
 LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    vi.id AS image_id,
    ROUND(
      ST_Distance(
        ST_MakePoint(vi.longitude, vi.latitude)::geography,
        ST_MakePoint(p_longitude, p_latitude)::geography
      )::NUMERIC,
      2
    ) AS distance_meters
  FROM vehicle_images vi
  WHERE vi.vehicle_id = p_vehicle_id
    AND vi.latitude IS NOT NULL
    AND vi.longitude IS NOT NULL
    AND ST_DWithin(
      ST_MakePoint(vi.longitude, vi.latitude)::geography,
      ST_MakePoint(p_longitude, p_latitude)::geography,
      p_max_distance_meters
    )
  ORDER BY distance_meters ASC;
END;
$function$;
REVOKE ALL ON FUNCTION public.find_images_near_location(numeric,numeric,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.find_images_near_location(numeric,numeric,uuid,integer) TO PUBLIC, anon, authenticated, service_role;
DO $$ BEGIN
 ASSERT md5(pg_get_functiondef('public.find_images_near_location(numeric,numeric,uuid,integer)'::regprocedure)) = 'a2d4a709b7d21baf6a0054571fdcad55',
   'fixture holds the definition production has';
END $$;
CREATE TEMP TABLE before_rows AS
  SELECT row_number() OVER () AS n, f.* FROM public.find_images_near_location(35.97236333, -114.855995, '11111111-1111-1111-1111-111111111111', 50) f;
CREATE TEMP TABLE before_acl AS SELECT proacl::text AS acl FROM pg_proc WHERE oid = 'public.find_images_near_location(numeric,numeric,uuid,integer)'::regprocedure;
DO $$ BEGIN
 ASSERT (SELECT count(*) FROM before_rows) = 5, 'before: 2 with an image + 3 without (blank, whitespace, NULL)';
END $$;

\ir ../migrations/20261116054000_find_images_near_location_url_guard.sql
\ir ../migrations/20261116054000_find_images_near_location_url_guard.sql

DO $$ DECLARE got uuid[]; BEGIN
 SELECT array_agg(image_id ORDER BY ord) INTO got FROM (
   SELECT row_number() OVER () AS ord, f.image_id
   FROM public.find_images_near_location(35.97236333, -114.855995, '11111111-1111-1111-1111-111111111111', 50) f) x;
 ASSERT got = ARRAY['00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002']::uuid[],
   'after: only photos with an image, nearest first: ' || got::text;
 ASSERT (SELECT array_agg(image_id ORDER BY n) FROM before_rows
          WHERE image_id IN ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002')) = got,
   'rows with an image unchanged, same order';
 ASSERT (SELECT array_agg(distance_meters ORDER BY image_id)
           FROM public.find_images_near_location(35.97236333, -114.855995, '11111111-1111-1111-1111-111111111111', 50))
      = (SELECT array_agg(distance_meters ORDER BY image_id) FROM before_rows
          WHERE image_id IN ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002')), 'distances unchanged';
 ASSERT (SELECT count(*) FROM public.find_images_near_location(36.2, -115.1, '11111111-1111-1111-1111-111111111111', 50)) = 1,
   'far photo found at its own point';
 ASSERT (SELECT count(*) FROM public.find_images_near_location(35.97236333, -114.855995, '33333333-3333-3333-3333-333333333333', 50)) = 0,
   'unknown vehicle: none';
 ASSERT (SELECT proacl::text FROM pg_proc WHERE oid = 'public.find_images_near_location(numeric,numeric,uuid,integer)'::regprocedure)
      = (SELECT acl FROM before_acl), 'grants kept';
 ASSERT NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.find_images_near_location(numeric,numeric,uuid,integer)'::regprocedure),
   'still security invoker';
 ASSERT position('image_url_guard_v1' in pg_get_functiondef('public.find_images_near_location(numeric,numeric,uuid,integer)'::regprocedure)) > 0,
   'marker';
END $$;
SELECT 'PASS: find_images_near_location returns only photos with an image; rows, order, distances, grants and security unchanged' AS result;
