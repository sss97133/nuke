-- Isolated PostgreSQL 17 contract for 20261016220000_gps_match_possession_check.sql.
-- Synthetic rows only; never production. Run in an empty disposable dm_refinement_* database:
--   createdb dm_refinement_gps_match_possession
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_gps_match_possession -f supabase/sql/test_gps_match_possession.sql
-- Fixtures carry the live shapes read from prod on 2026-10-15: vehicle_images' numeric latitude/longitude and the
-- partial idx_vehicle_images_gps, vehicles.merged_into_vehicle_id/deleted_at, vehicle_ownerships, vehicle_contributors,
-- ownership_transfers with the transfer_status enum, and auto_match_image_to_vehicles as live (first 16 hex characters
-- of md5(prosrc) 6f69f6a67e6c268d, = 20260610011000) with its live ACL. Cases:
--   * negative controls on the live body: the 2026-09-28 case (a truck transferred away before the photo) scores 0.95
--     and the GPS box walks the whole index;
--   * after the migration: that truck is not a candidate; a held vehicle alone scores above 0.7; an unknown holding,
--     a missing taken_at and two held vehicles within the margin cap at 0.5; acquired-after and merged vehicles never
--     come back; a vehicle sold before the photo no longer makes a held neighbour ambiguous;
--   * possession verdicts: transfer away, cancelled transfer, buy-back, open consignment, an ended period, an unknown
--     start, acquired after;
--   * an end user asking about another user's holdings gets the no-user score;
--   * the box is bounded by the index; signature, settings and ACL survive; the helper is service_role only.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
     OR to_regclass('public.vehicle_images') IS NOT NULL
     OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty, disposable dm_refinement_* database';
  END IF;
END $$;
SET statement_timeout = '60s';
SET lock_timeout = '3s';
SET TimeZone = 'UTC';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dm_contract_deployer') THEN CREATE ROLE dm_contract_deployer NOLOGIN; END IF;
END $$;

-- Supabase's auth helpers read the request's JWT claims.
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role' $$;
GRANT USAGE ON SCHEMA auth TO PUBLIC;

-- Prod's deploy role owns the tables and is not a superuser; the fixture is built, and the migration applied, as one.
GRANT CREATE ON SCHEMA public TO dm_contract_deployer;
SET ROLE dm_contract_deployer;
DO $$ BEGIN
  IF (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'the contract must run as a non-superuser after SET ROLE';
  END IF;
END $$;

CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;

-- Live shapes -------------------------------------------------------------------------------------------------------
CREATE TABLE public.vehicles (
  id uuid PRIMARY KEY,
  merged_into_vehicle_id uuid,
  deleted_at timestamptz
);
CREATE TABLE public.vehicle_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid,
  user_id uuid,
  latitude numeric,
  longitude numeric,
  taken_at timestamptz,
  is_duplicate boolean DEFAULT false
);
CREATE INDEX idx_vehicle_images_gps ON public.vehicle_images USING btree (latitude, longitude)
  WHERE ((latitude IS NOT NULL) AND (longitude IS NOT NULL));
CREATE TABLE public.vehicle_ownerships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL,
  owner_profile_id uuid NOT NULL,
  role text NOT NULL,
  is_current boolean DEFAULT false,
  start_date date,
  end_date date
);
CREATE TABLE public.vehicle_contributors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid,
  user_id uuid,
  role text NOT NULL,
  start_date date,
  end_date date,
  status text DEFAULT 'active',
  UNIQUE (vehicle_id, user_id, role)
);
CREATE TYPE public.transfer_status AS ENUM ('pending', 'in_progress', 'completed', 'cancelled', 'disputed', 'stalled');
CREATE TABLE public.ownership_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL,
  from_user_id uuid,
  to_user_id uuid,
  status public.transfer_status NOT NULL DEFAULT 'pending',
  sale_date timestamptz
);

-- auto_match_image_to_vehicles exactly as live on 2026-10-15 (pg_get_functiondef), with its live ACL.
CREATE OR REPLACE FUNCTION public.auto_match_image_to_vehicles(p_image_id uuid, p_latitude double precision, p_longitude double precision, p_taken_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(vehicle_id uuid, confidence numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '5s'
AS $function$
DECLARE
  v_lat_delta DOUBLE PRECISION := 0.0045;
  v_lon_delta DOUBLE PRECISION := 0.0045 / GREATEST(cos(radians(p_latitude)), 0.2);
  v_ambiguity_margin CONSTANT numeric := 0.15;
  v_top_vehicle uuid;
  v_top_conf numeric;
  v_second_conf numeric;
BEGIN
  IF p_latitude IS NULL OR p_longitude IS NULL THEN
    RETURN;
  END IF;

  -- Best confidence per candidate vehicle in the GPS box (one row per vehicle).
  CREATE TEMP TABLE _cand ON COMMIT DROP AS
  SELECT
    vi.vehicle_id AS vid,
    MAX(ROUND(GREATEST(0.05,
      0.95
      - LEAST(
          (111320.0 * sqrt(
            pow(vi.latitude - p_latitude, 2) +
            pow((vi.longitude - p_longitude) * cos(radians(p_latitude)), 2)
          )) / 100.0 * 0.05,
          0.30)
      - CASE WHEN p_user_id IS NOT NULL AND vi.user_id = p_user_id THEN 0.0 ELSE 0.35 END
      - CASE WHEN p_taken_at IS NOT NULL AND vi.taken_at IS NOT NULL
             THEN LEAST(abs(EXTRACT(EPOCH FROM (p_taken_at - vi.taken_at))) / 86400.0 / 180.0 * 0.15, 0.15)
             ELSE 0.10 END
    )::numeric, 3)) AS conf
  FROM vehicle_images vi
  WHERE vi.latitude  BETWEEN p_latitude  - v_lat_delta AND p_latitude  + v_lat_delta
    AND vi.longitude BETWEEN p_longitude - v_lon_delta AND p_longitude + v_lon_delta
    AND vi.vehicle_id IS NOT NULL
    AND vi.id IS DISTINCT FROM p_image_id
    AND COALESCE(vi.is_duplicate, false) = false
  GROUP BY vi.vehicle_id;

  SELECT vid, conf INTO v_top_vehicle, v_top_conf
  FROM _cand ORDER BY conf DESC LIMIT 1;

  IF v_top_vehicle IS NULL THEN
    RETURN;  -- nothing nearby
  END IF;

  SELECT conf INTO v_second_conf
  FROM _cand WHERE vid IS DISTINCT FROM v_top_vehicle ORDER BY conf DESC LIMIT 1;

  -- Ambiguous: a 2nd distinct vehicle is within the margin → GPS can't decide.
  -- Cap below the orchestrator's 0.7 assign threshold so it lands in inbox.
  IF v_second_conf IS NOT NULL AND (v_top_conf - v_second_conf) < v_ambiguity_margin THEN
    RETURN QUERY SELECT v_top_vehicle, LEAST(v_top_conf, 0.5::numeric);
  ELSE
    RETURN QUERY SELECT v_top_vehicle, v_top_conf;
  END IF;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.auto_match_image_to_vehicles(uuid, double precision, double precision, timestamptz, uuid)
  TO anon, authenticated, service_role;
SELECT pg_temp.ok('fixture: the live body is the one read from prod',
  left(md5((SELECT prosrc FROM pg_proc WHERE oid = 'public.auto_match_image_to_vehicles(uuid,double precision,double precision,timestamptz,uuid)'::regprocedure)), 16)
    = '6f69f6a67e6c268d');

-- Synthetic world -----------------------------------------------------------------------------------------------------
-- Owner O and another user X. Sites are 1 degree of latitude apart, so no box reaches another site.
CREATE TEMP TABLE ids (k text PRIMARY KEY, id uuid);
INSERT INTO ids VALUES
  ('owner',  'a0000000-0000-0000-0000-0000000000a1'), ('other', 'a0000000-0000-0000-0000-0000000000b2'),
  ('sold',   'c0000000-0000-0000-0000-000000000001'),  -- transferred away 2026-02-22 (the 2026-09-28 truck)
  ('held',   'c0000000-0000-0000-0000-000000000002'),  -- owned since 2014-12-24, current
  ('unknown','c0000000-0000-0000-0000-000000000003'),  -- nothing recorded
  ('twin_a', 'c0000000-0000-0000-0000-000000000004'),  -- two held vehicles at one site
  ('twin_b', 'c0000000-0000-0000-0000-000000000005'),
  ('later',  'c0000000-0000-0000-0000-000000000006'),  -- acquired 2026-05-24
  ('merged', 'c0000000-0000-0000-0000-000000000007'),  -- merged into 'held'
  ('nbr_held','c0000000-0000-0000-0000-000000000008'), -- held, next to a vehicle sold before the photo
  ('nbr_sold','c0000000-0000-0000-0000-000000000009'),
  ('consign','c0000000-0000-0000-0000-00000000000a'),  -- open consignment; a cancelled transfer away
  ('rebuy',  'c0000000-0000-0000-0000-00000000000b'),  -- sold 2024-01-01, bought back 2025-01-01
  ('ended',  'c0000000-0000-0000-0000-00000000000c'),  -- owned 2018-01-01 .. 2021-11-01
  ('nostart','c0000000-0000-0000-0000-00000000000d');  -- current owner, start unrecorded
CREATE FUNCTION pg_temp.v(k text) RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT id FROM ids WHERE ids.k = $1 $$;

INSERT INTO public.vehicles (id, merged_into_vehicle_id, deleted_at)
SELECT id, NULL, NULL FROM ids WHERE k NOT IN ('owner', 'other', 'merged');
INSERT INTO public.vehicles VALUES (pg_temp.v('merged'), pg_temp.v('held'), '2026-06-24');

-- Earlier photos by O that put each vehicle at its site (site lat, -62.85), a few metres off the probe point.
CREATE FUNCTION pg_temp.shoot(k text, lat numeric, lon numeric, at timestamptz, who text DEFAULT 'owner')
RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.vehicle_images (vehicle_id, user_id, latitude, longitude, taken_at)
  VALUES (pg_temp.v(k), pg_temp.v(who), lat, lon, at)
$$;
SELECT pg_temp.shoot('sold',     17.8995, -62.8500, '2026-02-15');
SELECT pg_temp.shoot('held',     18.8995, -62.8500, '2026-05-25');
SELECT pg_temp.shoot('unknown',  19.8995, -62.8500, '2026-05-25');
SELECT pg_temp.shoot('twin_a',   20.8995, -62.8500, '2026-05-25');
SELECT pg_temp.shoot('twin_b',   20.8995, -62.8501, '2026-05-25');
SELECT pg_temp.shoot('later',    21.8995, -62.8500, '2026-06-01');
SELECT pg_temp.shoot('merged',   22.8995, -62.8500, '2026-05-25');
SELECT pg_temp.shoot('nbr_held', 23.8995, -62.8500, '2026-05-25');
SELECT pg_temp.shoot('nbr_sold', 23.8995, -62.8501, '2026-01-10');

-- 3,000 photos of another vehicle in the same latitude band as the 'sold' site, 1.85-2.85 degrees of longitude away
-- (outside every box; the index's lat-then-lon order puts them inside a latitude-only bound).
INSERT INTO public.vehicles VALUES ('d0000000-0000-0000-0000-000000000001', NULL, NULL);
INSERT INTO public.vehicle_images (vehicle_id, user_id, latitude, longitude, taken_at)
SELECT 'd0000000-0000-0000-0000-000000000001', pg_temp.v('other'), 17.8995 + (g % 7) * 0.0001, -60.0 - (g % 2000) * 0.0005, '2026-01-01'
FROM generate_series(1, 3000) g;
ANALYZE public.vehicle_images;

-- What is recorded about O's holdings.
INSERT INTO public.ownership_transfers (vehicle_id, from_user_id, to_user_id, status, sale_date) VALUES
  (pg_temp.v('sold'),     pg_temp.v('owner'), NULL, 'stalled',   '2026-02-22 19:11:59+00'),
  (pg_temp.v('nbr_sold'), pg_temp.v('owner'), NULL, 'completed', '2026-02-01'),
  (pg_temp.v('consign'),  pg_temp.v('owner'), NULL, 'cancelled', '2025-12-01'),
  (pg_temp.v('rebuy'),    pg_temp.v('owner'), NULL, 'completed', '2024-01-01'),
  (pg_temp.v('rebuy'),    pg_temp.v('other'), pg_temp.v('owner'), 'completed', '2025-01-01');
INSERT INTO public.vehicle_ownerships (vehicle_id, owner_profile_id, role, is_current, start_date, end_date) VALUES
  (pg_temp.v('sold'),     pg_temp.v('owner'), 'previous_owner', false, NULL, '2026-05-24'),
  (pg_temp.v('held'),     pg_temp.v('owner'), 'verified_owner', true, '2014-12-24', NULL),
  (pg_temp.v('twin_a'),   pg_temp.v('owner'), 'verified_owner', true, '2020-01-01', NULL),
  (pg_temp.v('twin_b'),   pg_temp.v('owner'), 'verified_owner', true, '2020-01-01', NULL),
  (pg_temp.v('later'),    pg_temp.v('owner'), 'verified_owner', true, '2026-05-24', NULL),
  (pg_temp.v('nbr_held'), pg_temp.v('owner'), 'verified_owner', true, '2020-01-01', NULL),
  (pg_temp.v('nbr_sold'), pg_temp.v('owner'), 'verified_owner', false, '2019-01-01', NULL),
  (pg_temp.v('ended'),    pg_temp.v('owner'), 'previous_owner', false, '2018-01-01', '2021-11-01'),
  (pg_temp.v('nostart'),  pg_temp.v('owner'), 'verified_owner', true, NULL, NULL);
INSERT INTO public.vehicle_contributors (vehicle_id, user_id, role, start_date, end_date, status) VALUES
  (pg_temp.v('consign'), pg_temp.v('owner'), 'consigner', '2025-10-07', NULL, 'active'),
  (pg_temp.v('unknown'), pg_temp.v('owner'), 'photographer', '2020-01-01', NULL, 'active');

-- A probe: the best match for a new photo by `who` at (lat, -62.8500) taken at `at`.
CREATE FUNCTION pg_temp.probe(lat numeric, at timestamptz, who text DEFAULT 'owner')
RETURNS TABLE (vehicle_id uuid, confidence numeric) LANGUAGE sql AS $$
  SELECT m.vehicle_id, m.confidence
  FROM public.auto_match_image_to_vehicles(gen_random_uuid(), lat::float8, -62.8500::float8, at, pg_temp.v(who)) m
$$;

-- GPS index entries one probe reads. Pending statistics are flushed only between transactions, so the counter is read
-- before and after the probe inside one statement.
CREATE FUNCTION pg_temp.gps_index_entries_read(lat numeric, at timestamptz) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE before bigint := pg_stat_get_xact_tuples_returned('public.idx_vehicle_images_gps'::regclass);
BEGIN
  PERFORM count(*) FROM pg_temp.probe(lat, at);
  RETURN pg_stat_get_xact_tuples_returned('public.idx_vehicle_images_gps'::regclass) - before;
END $$;

-- Negative controls on the live body --------------------------------------------------------------------------------
SET enable_seqscan = off;
SELECT pg_temp.ok('live body: the truck transferred away on 2026-02-22 scores 0.95 for a photo taken 2026-07-15',
  (SELECT vehicle_id = pg_temp.v('sold') AND confidence > 0.7 FROM pg_temp.probe(17.8995, '2026-07-15')));
SELECT pg_temp.ok('live body: double precision bounds walk the whole GPS index (3,000+ entries for one box)',
  pg_temp.gps_index_entries_read(17.8995, '2026-07-15') > 3000);
RESET enable_seqscan;

-- The migration, as the deploy role ------------------------------------------------------------------------------------
\ir ../migrations/20261016220000_gps_match_possession_check.sql

-- Possession verdicts ---------------------------------------------------------------------------------------------------
CREATE FUNCTION pg_temp.held(k text, at timestamptz) RETURNS text LANGUAGE sql STABLE AS
$$ SELECT public.user_vehicle_possession_at(pg_temp.v('owner'), pg_temp.v(k), at) $$;
SELECT pg_temp.ok('possession: held before the transfer away is unknown (start unrecorded), not_held after it',
  pg_temp.held('sold', '2026-02-01') = 'unknown' AND pg_temp.held('sold', '2026-02-22 19:12:00+00') = 'not_held'
  AND pg_temp.held('sold', '2026-07-15') = 'not_held');
SELECT pg_temp.ok('possession: an open current period with a known start is held from its start, not before',
  pg_temp.held('held', '2014-12-24') = 'held' AND pg_temp.held('held', '2026-07-15') = 'held'
  AND pg_temp.held('held', '2014-12-23') = 'not_held');
SELECT pg_temp.ok('possession: nothing recorded, or only a photographer role, is unknown',
  pg_temp.held('unknown', '2026-07-15') = 'unknown');
SELECT pg_temp.ok('possession: acquired after the photo is not_held',
  pg_temp.held('later', '2025-06-01') = 'not_held' AND pg_temp.held('later', '2026-06-01') = 'held');
SELECT pg_temp.ok('possession: a cancelled transfer moves nothing; the open consignment is held',
  pg_temp.held('consign', '2026-08-14') = 'held');
SELECT pg_temp.ok('possession: sold then bought back is not_held between and held after',
  pg_temp.held('rebuy', '2024-06-01') = 'not_held' AND pg_temp.held('rebuy', '2025-06-01') = 'held');
SELECT pg_temp.ok('possession: a closed period is held inside it and not_held after it',
  pg_temp.held('ended', '2019-06-01') = 'held' AND pg_temp.held('ended', '2021-11-01') = 'held'
  AND pg_temp.held('ended', '2022-01-01') = 'not_held');
SELECT pg_temp.ok('possession: a current owner with no recorded start is unknown, never held',
  pg_temp.held('nostart', '2026-07-15') = 'unknown');
SELECT pg_temp.ok('possession: a missing user, vehicle or time is unknown',
  public.user_vehicle_possession_at(NULL, pg_temp.v('held'), '2026-07-15') = 'unknown'
  AND public.user_vehicle_possession_at(pg_temp.v('owner'), pg_temp.v('held'), NULL) = 'unknown'
  AND public.user_vehicle_possession_at(pg_temp.v('owner'), NULL, '2026-07-15') = 'unknown');

-- GPS matcher after the migration ---------------------------------------------------------------------------------------
SELECT pg_temp.ok('the 2026-09-28 case: a truck transferred away before the photo is not returned',
  NOT EXISTS (SELECT 1 FROM pg_temp.probe(17.8995, '2026-07-15')));
SELECT pg_temp.ok('a photo from before the transfer still finds the truck, capped at 0.5 (the holding''s start is unrecorded)',
  (SELECT vehicle_id = pg_temp.v('sold') AND confidence <= 0.5 FROM pg_temp.probe(17.8995, '2026-02-16')));
SELECT pg_temp.ok('a held vehicle alone at its site scores above the 0.7 assign bar',
  (SELECT vehicle_id = pg_temp.v('held') AND confidence > 0.7 FROM pg_temp.probe(18.8995, '2026-06-01')));
SELECT pg_temp.ok('an unknown holding caps at 0.5',
  (SELECT vehicle_id = pg_temp.v('unknown') AND confidence <= 0.5 FROM pg_temp.probe(19.8995, '2026-06-01')));
SELECT pg_temp.ok('a photo with no taken_at caps at 0.5 even on a held vehicle',
  (SELECT vehicle_id = pg_temp.v('held') AND confidence <= 0.5 FROM pg_temp.probe(18.8995, NULL)));
SELECT pg_temp.ok('two held vehicles within the margin stay ambiguous (0.5)',
  (SELECT vehicle_id IN (pg_temp.v('twin_a'), pg_temp.v('twin_b')) AND confidence <= 0.5 FROM pg_temp.probe(20.8995, '2026-06-01')));
SELECT pg_temp.ok('a vehicle acquired after the photo is not returned',
  NOT EXISTS (SELECT 1 FROM pg_temp.probe(21.8995, '2025-06-01')));
SELECT pg_temp.ok('a merged vehicle is never returned',
  NOT EXISTS (SELECT 1 FROM pg_temp.probe(22.8995, '2026-06-01')));
SELECT pg_temp.ok('a vehicle sold before the photo no longer makes its held neighbour ambiguous',
  (SELECT vehicle_id = pg_temp.v('nbr_held') AND confidence > 0.7 FROM pg_temp.probe(23.8995, '2026-06-01')));

-- End-user callers -----------------------------------------------------------------------------------------------------
SELECT set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', pg_temp.v('other'))::text, false);
SELECT pg_temp.ok('a signed-in user asking about another user''s holdings gets the no-user score',
  (SELECT confidence <= 0.5 FROM pg_temp.probe(18.8995, '2026-06-01')));
SELECT set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', pg_temp.v('owner'))::text, false);
SELECT pg_temp.ok('the owner signed in gets their own holdings judged',
  (SELECT vehicle_id = pg_temp.v('held') AND confidence > 0.7 FROM pg_temp.probe(18.8995, '2026-06-01')));
SELECT set_config('request.jwt.claims', json_build_object('role', 'anon')::text, false);
SELECT pg_temp.ok('an anonymous caller gets the no-user score',
  (SELECT confidence <= 0.5 FROM pg_temp.probe(18.8995, '2026-06-01')));
SELECT set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, false);
SELECT pg_temp.ok('the service role (the photo pipeline) passes the photo''s user',
  (SELECT confidence > 0.7 FROM pg_temp.probe(18.8995, '2026-06-01')));
SELECT set_config('request.jwt.claims', '', false);

-- Bounded scan, shape, settings and grants ------------------------------------------------------------------------------
SET enable_seqscan = off;
SELECT pg_temp.ok('numeric bounds: the GPS index returns only the box''s entries (the band''s 3,000 others are skipped)',
  pg_temp.gps_index_entries_read(17.8995, '2026-07-15') < 10);
RESET enable_seqscan;
SELECT pg_temp.ok('the function can be called twice in one transaction (no temp table left behind)',
  (SELECT count(*) FROM (SELECT * FROM pg_temp.probe(18.8995, '2026-06-01') UNION ALL SELECT * FROM pg_temp.probe(18.8995, '2026-06-02')) t) = 2);
SELECT pg_temp.ok('signature, SECURITY DEFINER, search_path and the 5 s timeout are unchanged',
  (SELECT p.prosecdef AND p.proconfig @> ARRAY['search_path=public', 'statement_timeout=5s']
     AND pg_get_function_result(p.oid) = 'TABLE(vehicle_id uuid, confidence numeric)'
   FROM pg_proc p WHERE p.oid = 'public.auto_match_image_to_vehicles(uuid,double precision,double precision,timestamptz,uuid)'::regprocedure));
SELECT pg_temp.ok('the matcher keeps its ACL (anon, authenticated, service_role execute)',
  has_function_privilege('anon', 'public.auto_match_image_to_vehicles(uuid,double precision,double precision,timestamptz,uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.auto_match_image_to_vehicles(uuid,double precision,double precision,timestamptz,uuid)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.auto_match_image_to_vehicles(uuid,double precision,double precision,timestamptz,uuid)', 'EXECUTE'));
SELECT pg_temp.ok('the possession helper is service_role only',
  NOT has_function_privilege('anon', 'public.user_vehicle_possession_at(uuid,uuid,timestamptz)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.user_vehicle_possession_at(uuid,uuid,timestamptz)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.user_vehicle_possession_at(uuid,uuid,timestamptz)', 'EXECUTE'));

-- Re-applying the migration changes nothing.
\ir ../migrations/20261016220000_gps_match_possession_check.sql
SELECT pg_temp.ok('re-apply: same verdicts',
  NOT EXISTS (SELECT 1 FROM pg_temp.probe(17.8995, '2026-07-15'))
  AND (SELECT confidence > 0.7 FROM pg_temp.probe(18.8995, '2026-06-01')));

DO $$ BEGIN RAISE NOTICE 'ALL PASS test_gps_match_possession'; END $$;
